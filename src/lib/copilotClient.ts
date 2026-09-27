import { connected, supabase } from './data';
import type { RefillCase, Role } from '../domain/engine';
export type ChatTurn={role:'user'|'assistant';text:string;snapshotKey:string};
export class CopilotError extends Error{constructor(message:string,public status=500){super(message);}}
export async function askCopilot(c:RefillCase,role:Role,question:string,history:ChatTurn[],snapshotKey:string,abort:AbortSignal){
 const headers:Record<string,string>={'Content-Type':'application/json'};
 if(connected){const {data:{session}}=await supabase!.auth.getSession();if(!session)throw new CopilotError('Sign in to use your role-specific copilot.',401);headers.Authorization=`Bearer ${session.access_token}`;}
 const body={role,question,snapshotKey,history:history.filter(m=>m.snapshotKey===snapshotKey).slice(-6).map(({role,text})=>({role,text:text.slice(0,2500)})),
  ...(connected?{caseId:c.id}:{case:{id:c.id,reason:c.reason,createdAt:c.createdAt,version:c.version,owner:c.owner,inputs:c.inputs,hold:c.hold,declined:c.declined,transport:c.transport,attempts:c.attempts,events:c.events.slice(0,5),resolvedAt:c.resolvedAt,waitingSince:c.waitingSince}})};
 const response=await fetch('/api/copilot',{method:'POST',headers,body:JSON.stringify(body),signal:abort});
 const result=await response.json().catch(()=>({error:'The copilot API is unavailable. Run npm run dev locally, or deploy the complete project to Vercel.'}));
 if(!response.ok)throw new CopilotError(result.error||'Could not get a Gemini response.',response.status);
 return result as {text:string;snapshotKey:string;provider:string;model:string};
}
