import { pendingStep, waitingSince } from './engine.js';
import type { RefillCase } from './engine.js';

/** A presentation clock only. Never write this override into workflow storage. */
export type SimulationTimer={sourceKey:string;startedAt:string};
export function simulationSourceKey(c:RefillCase){
 const step=pendingStep(c);
 // Exhausting retries changes the next action to escalation, not the wait itself.
 return JSON.stringify([c.id,step?.startsWith('Handoff failed:')?'Handoff failed':step,waitingSince(c)]);
}
export class SimulationTimerError extends Error{}
export function withSimulationTimer(c:RefillCase,timer:unknown,now=Date.now()):RefillCase{
 if(timer===undefined||timer===null)return c;
 const value=timer as SimulationTimer;
 if(typeof value!=='object'||typeof value.startedAt!=='string'||typeof value.sourceKey!=='string'||value.sourceKey.length>500||!Number.isFinite(Date.parse(value.startedAt))||Date.parse(value.startedAt)>now+5000)throw new SimulationTimerError('Invalid simulation timer. Refresh the case and try again.');
 if(!pendingStep(c)||value.sourceKey!==simulationSourceKey(c))throw new SimulationTimerError('The workflow step changed. Use its current simulation timer.');
 return {...c,waitingSince:value.startedAt};
}
