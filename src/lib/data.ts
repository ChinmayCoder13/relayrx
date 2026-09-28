import { newId } from './id';
import { demoActors } from '../domain/identity';
import { createClient } from '@supabase/supabase-js';
import { applyAction } from '../domain/engine';
import type { CaseAction, RefillCase, Role } from '../domain/engine';
import { createCase } from '../domain/seed';
import { createDemoSession } from './demoSession';
export const connected = import.meta.env.VITE_DATA_MODE === 'supabase';
export const supabase = connected && import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY ? createClient(import.meta.env.VITE_SUPABASE_URL,import.meta.env.VITE_SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:true}}) : null;
// Never hydrate yesterday's demo or a different tab's rehearsal from storage.
// Supabase persistence is independent and continues through api() below.
const demoSession=createDemoSession();
export function loadDemo():RefillCase[]{return demoSession.load();}
export function saveDemo(cases:RefillCase[]){demoSession.save(cases);}
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
