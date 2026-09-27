import { newId } from './id';
import { demoActors } from '../domain/identity';
import { createClient } from '@supabase/supabase-js';
import { applyAction } from '../domain/engine';
import type { CaseAction, RefillCase, Role } from '../domain/engine';
import { createCase, seedCases } from '../domain/seed';
export const connected = import.meta.env.VITE_DATA_MODE === 'supabase';
export const supabase = connected && import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY ? createClient(import.meta.env.VITE_SUPABASE_URL,import.meta.env.VITE_SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:true}}) : null;
const KEY='relayrx-synthetic-demo-v1';
export function loadDemo():RefillCase[]{
 let records:RefillCase[]|undefined;
 try{const raw=JSON.parse(localStorage.getItem(KEY)||'null');if(Array.isArray(raw)&&raw.length<=200&&raw.every(c=>c.id&&c.patient&&c.inputs&&['identity','prescription','visit','coverage','approval'].every(k=>typeof c.inputs[k]?.verified==='boolean')&&Array.isArray(c.events)&&Array.isArray(c.updates)&&Number.isInteger(c.version)))records=raw;}catch{/* Start a clean demo if storage is unavailable or malformed. */}
 const now=new Date().toISOString();
 const result=(records||seedCases()).map(c=>c.waitingSince===undefined?{...c,waitingSince:c.declined||c.transport==='dispensed'?null:now}:c);
 // Preserve the durable workflow wait. Browser-visit simulation clocks are separate.
 if(!records||result.some((c,i)=>c!==records![i]))try{saveDemo(result);}catch{/* Storage failure is surfaced if a user tries to save an action. */}
 return result;
}
export function saveDemo(cases:RefillCase[]){localStorage.setItem(KEY,JSON.stringify(cases));}
export function demoAction(cases:RefillCase[],id:string,action:CaseAction,role:Role){
 const current=cases.find(c=>c.id===id);if(!current)throw new Error('Refill not found.');
 const changed=applyAction(current,action,role,`${demoActors[role]} (demo)`);
 const updated=cases.map(c=>c.id===id?changed:c);saveDemo(updated);return updated;
}
export function demoCreate(cases:RefillCase[],patient:string,medication:string,reason:string){
 if(cases.length>=200)throw new Error('The demo is limited to 200 cases. Reset the demo to start again.');
 const c=createCase(patient,medication,reason,cases.length);c.id=`RX-${newId().slice(0,8).toUpperCase()}`;c.events[0].id=`intake-${c.id}`;
 const updated=[c,...cases];saveDemo(updated);return updated;
}
export async function api(body?:unknown){
 if(!supabase)throw new Error('The connected sandbox needs Supabase configuration.');
 const {data:{session}}=await supabase.auth.getSession();if(!session)throw new Error('Sign in to your sandbox workspace.');
 const response=await fetch('/api/workspace',{method:body?'POST':'GET',headers:{Authorization:`Bearer ${session.access_token}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000)});
 const result=await response.json().catch(()=>({error:'The server returned an unexpected response.'}));
 if(!response.ok)throw new Error(result.error||'The request failed. Refresh before retrying.');return result;
}
