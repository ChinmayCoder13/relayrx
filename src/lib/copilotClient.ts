import { connected, supabase } from './data';
import type { RefillCase, Role } from '../domain/engine';
import { copilotKey } from '../domain/copilot';
import { logicEngineBackup } from '../domain/copilotFallback';
import type { CopilotProvider, CopilotReply } from '../domain/copilotFallback';
import { withSimulationTimer } from '../domain/simulation';
import type { SimulationTimer } from '../domain/simulation';
export type ChatTurn={role:'user'|'assistant';text:string;snapshotKey:string;provider?:CopilotProvider;notice?:string};
export class CopilotError extends Error{constructor(message:string,public status=500){super(message);}}
export async function askCopilot(c:RefillCase,role:Role,question:string,history:ChatTurn[],snapshotKey:string,abort:AbortSignal,simulationTimer?:SimulationTimer,now=Date.now()):Promise<CopilotReply>{
 const started=Date.now();
 function backup(notice:string):CopilotReply{
  abort.throwIfAborted();
  const currentNow=now+Date.now()-started,view=withSimulationTimer(c,simulationTimer,currentNow);
  if(copilotKey(view,role,currentNow)!==snapshotKey)throw new CopilotError('The case or attention state changed. Ask again for its current state.',409);
  return {text:logicEngineBackup(view,role,question,currentNow),snapshotKey,provider:'Logic Engine',model:null,role,asOf:new Date(currentNow).toISOString(),mode:'offline',notice:notice+(connected?' This uses the last loaded authorized case; refresh connected data before acting.':''),code:'COPILOT_CONNECTION',retryable:true};
 }
 const headers:Record<string,string>={'Content-Type':'application/json'};
 if(connected){const {data:{session}}=await supabase!.auth.getSession();if(!session)throw new CopilotError('Sign in to use your role-specific copilot.',401);headers.Authorization=`Bearer ${session.access_token}`;}
 const body={role,question,snapshotKey,simulationTimer,history:history.filter(m=>m.snapshotKey===snapshotKey&&m.provider!=='Logic Engine').slice(-6).map(({role,text})=>({role,text:text.slice(0,2500)})),
  ...(connected?{caseId:c.id}:{case:{id:c.id,reason:c.reason,createdAt:c.createdAt,version:c.version,owner:c.owner,inputs:c.inputs,hold:c.hold,declined:c.declined,transport:c.transport,attempts:c.attempts,events:c.events.slice(0,5),resolvedAt:c.resolvedAt,waitingSince:c.waitingSince}})};
 let response:Response,result:Record<string,unknown>;
 try{
  response=await fetch('/api/copilot',{method:'POST',headers,body:JSON.stringify(body),signal:AbortSignal.any([abort,AbortSignal.timeout(28000)])});
  result=await response.json().catch(()=>({}));
 }catch{abort.throwIfAborted();return backup('The copilot service could not be reached. Showing the logic engine backup.');}
 if(!response.ok){
  if([429,500,502,503,504].includes(response.status)&&result.code!=='WORKSPACE_UNVERIFIED')return backup('The copilot service is unavailable. Showing the logic engine backup.');
  throw new CopilotError(typeof result.error==='string'?result.error:'Could not verify the current copilot request.',response.status);
 }
 if(typeof result.text!=='string'||!['Gemini','Logic Engine'].includes(String(result.provider))||result.snapshotKey!==snapshotKey)throw new CopilotError('The copilot response did not match the current case. Refresh and ask again.',409);
 return result as CopilotReply;
}
