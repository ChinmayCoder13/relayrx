import { pendingStep } from '../domain/engine.js';
import type { RefillCase } from '../domain/engine.js';
import { simulationSourceKey, withSimulationTimer } from '../domain/simulation.js';
import type { SimulationTimer } from '../domain/simulation.js';

export const SIMULATION_STORAGE_KEY='relayrx-visit-timers-v1';
type TimerStorage=Pick<Storage,'setItem'>;
export function browserTimerStorage():TimerStorage|undefined{
 try{return window.sessionStorage;}catch{return undefined;}
}
/** Each app mount is a fresh visit, even when a duplicated tab inherits storage. */
export function createSimulationSession(storage?:TimerStorage){
 const timers=new Map<string,SimulationTimer>();
 const persist=()=>{try{storage?.setItem(SIMULATION_STORAGE_KEY,JSON.stringify([...timers]));}catch{/* The current visit still works in memory. */}};
 persist();
 const session={
  project(records:RefillCase[],now=Date.now()){
   let changed=false;
   const ids=new Set(records.map(c=>c.id));
   for(const id of timers.keys())if(!ids.has(id)){timers.delete(id);changed=true;}
   const result=records.map(c=>{
    if(!pendingStep(c)){if(timers.delete(c.id))changed=true;return c;}
    let timer=timers.get(c.id);
    if(!timer||timer.sourceKey!==simulationSourceKey(c)){
     timer={sourceKey:simulationSourceKey(c),startedAt:new Date(now).toISOString()};
     timers.set(c.id,timer);changed=true;
    }
    return withSimulationTimer(c,timer,now);
   });
   if(changed)persist();
   return result;
  },
  get(c:RefillCase|undefined){return c&&pendingStep(c)?timers.get(c.id):undefined;},
  restart(c:RefillCase,now=Date.now()){
   if(!pendingStep(c))return false;
   timers.set(c.id,{sourceKey:simulationSourceKey(c),startedAt:new Date(now).toISOString()});persist();return true;
  },
  clear(){timers.clear();persist();},
 };
 return session;
}
