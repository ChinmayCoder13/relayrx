import { createClient } from '@supabase/supabase-js';
import { INPUTS } from '../src/domain/engine';
import type { RefillCase, Role } from '../src/domain/engine';
import { copilotContext, copilotInstruction, copilotKey } from '../src/domain/copilot';

export type ApiRequest={method?:string;headers:Record<string,string|string[]|undefined>;body?:unknown};
export type ApiResponse={status:(code:number)=>ApiResponse;json:(body:unknown)=>void;setHeader:(key:string,value:string)=>void};
class RequestError extends Error{constructor(public code:number,message:string){super(message);}}
const roles=['staff','clinician','pharmacy'];
function parseCase(raw:unknown):RefillCase {
 const c=raw as RefillCase;
 if(!c||typeof c!=='object'||typeof c.id!=='string'||c.id.length>120||typeof c.reason!=='string'||c.reason.length>150||!Number.isInteger(c.version)||!roles.includes(c.owner)||typeof c.hold!=='boolean'||typeof c.declined!=='boolean'||!['not_sent','queued','failed','acknowledged','dispensed'].includes(c.transport)||!Number.isInteger(c.attempts)||c.attempts<0||!Number.isFinite(Date.parse(c.createdAt))||!Array.isArray(c.events)||c.events.length>10||!c.inputs)throw new RequestError(400,'Invalid synthetic case snapshot.');
 for(const i of INPUTS){const v=c.inputs[i.key];if(!v||typeof v.verified!=='boolean'||typeof v.note!=='string'||v.note.length>1600||!(v.at===null||typeof v.at==='string'))throw new RequestError(400,'Invalid verification evidence.');}
 if(c.waitingSince!==undefined&&c.waitingSince!==null&&(typeof c.waitingSince!=='string'||!Number.isFinite(Date.parse(c.waitingSince))))throw new RequestError(400,'Invalid waiting timestamp.');
 if(c.resolvedAt!==null&&typeof c.resolvedAt!=='string')throw new RequestError(400,'Invalid completion timestamp.');
 for(const e of c.events)if(typeof e.type!=='string'||typeof e.at!=='string'||typeof e.note!=='string'||e.note.length>1600||typeof e.role!=='string')throw new RequestError(400,'Invalid case event.');
 // Names, identifiers beyond the case reference, and medication details are not needed.
 return {...c,patient:'Synthetic case',initials:'SC',medication:'',pharmacy:'',updates:[]};
}
export function createCopilotHandler(options:{env?:()=>NodeJS.ProcessEnv;fetcher?:typeof fetch;clock?:()=>number}={}){
 const env=options.env||(()=>process.env),fetcher=options.fetcher||((...args)=>fetch(...args)),clock=options.clock||Date.now;
 const limits=new Map<string,{until:number;used:number}>();
 function permit(key:string,max:number){const now=clock();let record=limits.get(key);if(!record||now>=record.until){record={until:now+60000,used:0};limits.set(key,record);}if(record.used>=max)return false;record.used++;if(limits.size>1000)for(const [k,v] of limits)if(v.until<now)limits.delete(k);return true;}
 return async function handler(req:ApiRequest,res:ApiResponse){
  res.setHeader('Cache-Control','private, no-store');res.setHeader('Vary','Authorization');
  if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({error:'Use POST to ask the copilot.'});}
  const config=env(),key=config.GEMINI_API_KEY?.trim();
  if(!key)return res.status(503).json({error:'Gemini is not configured. Add GEMINI_API_KEY to .env.local locally, or Vercel → Project Settings → Environment Variables, then restart or redeploy.',code:'GEMINI_NOT_CONFIGURED'});
  try{
   if(!String(req.headers['content-type']||'').startsWith('application/json'))throw new RequestError(415,'Use application/json.');
   const input=typeof req.body==='string'?req.body:JSON.stringify(req.body||{});
   if(input.length>26000)throw new RequestError(413,'The copilot request is too large.');
   let body;try{body=JSON.parse(input);}catch{throw new RequestError(400,'Invalid JSON.');}
   if(!body||typeof body.question!=='string'||body.question.trim().length<2||body.question.length>1200||typeof body.snapshotKey!=='string'||body.snapshotKey.length>500)throw new RequestError(400,'Include a question and the current case snapshot.');
   const history=body.history??[];
   if(!Array.isArray(history)||history.length>6||history.some(m=>!m||!['user','assistant'].includes(m.role)||typeof m.text!=='string'||m.text.length>2500))throw new RequestError(400,'Invalid conversation history.');
   let current:RefillCase,role:Role,loadLatest:()=>Promise<RefillCase>,limitId:string;
   if(config.VITE_DATA_MODE==='supabase'){
    if(!config.SUPABASE_URL||!config.SUPABASE_SERVICE_ROLE_KEY)throw new RequestError(503,'The connected workspace is not configured.');
    const auth=req.headers.authorization;
    if(typeof auth!=='string'||!auth.startsWith('Bearer '))throw new RequestError(401,'Sign in to your workspace first.');
    const db=createClient(config.SUPABASE_URL,config.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(input,init)=>fetcher(input,{...init,signal:AbortSignal.timeout(10000)})}});
    const {data:{user},error}=await db.auth.getUser(auth.slice(7));
    if(error||!user)throw new RequestError(401,'Your workspace session could not be verified.');
    const {data:member,error:memberError}=await db.from('rr_memberships').select('tenant_id,role').eq('user_id',user.id).single();
    if(memberError||!member||!roles.includes(member.role))throw new RequestError(403,'No authorized workspace membership was found.');
    role=member.role;
    if(body.role!==role)throw new RequestError(403,'This copilot must use your authorized workspace role.');
    if(typeof body.caseId!=='string'||body.caseId.length>120)throw new RequestError(400,'Select a case.');
    loadLatest=async()=>{const {data,error}=await db.from('rr_cases').select('payload').eq('tenant_id',member.tenant_id).eq('id',body.caseId).maybeSingle();if(error)throw new RequestError(503,'Could not verify the latest case.');if(!data)throw new RequestError(404,'Case not found in this workspace.');return data.payload as RefillCase;};
    current=await loadLatest();limitId=`user:${user.id}`;
   }else{
    if(config.DEMO_COPILOT_ENABLED==='false')throw new RequestError(403,'The public demo copilot is disabled.');
    if(!roles.includes(body.role))throw new RequestError(400,'Select a valid demo role.');
    role=body.role;current=parseCase(body.case);loadLatest=async()=>current;
    const address=String(req.headers['x-forwarded-for']||'local').split(',')[0].trim();limitId=`demo:${address}`;
   }
   const initialKey=copilotKey(current,role,clock());
   if(body.snapshotKey!==initialKey)throw new RequestError(409,'The case or attention state changed. Use the current case and ask again.');
   if(!permit(limitId,12)||!permit('all',40)){res.setHeader('Retry-After','60');throw new RequestError(429,'Too many copilot questions. Wait one minute before asking again.');}
   const model=config.GEMINI_MODEL?.trim()||'gemini-3.5-flash';
   if(!/^[a-zA-Z0-9._-]{1,90}$/.test(model))throw new RequestError(503,'GEMINI_MODEL must be a valid model ID.');
   const context=copilotContext(current,role,clock());
   const response=await fetcher(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,{
    method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':key},signal:AbortSignal.timeout(30000),
    body:JSON.stringify({systemInstruction:{parts:[{text:copilotInstruction(role)}]},contents:[{role:'user',parts:[{text:JSON.stringify({currentCase:context,historyFromSameSnapshot:history,question:body.question.trim()})}]}],generationConfig:{temperature:0.2,maxOutputTokens:2500}})
   });
   if(!response.ok){
    if(response.status===429)throw new RequestError(429,'Gemini quota or rate limit reached. Check your API quota, then try again.');
    if([400,401,403].includes(response.status))throw new RequestError(502,'Gemini rejected the request. Check your server-side key, API restrictions, project access, and GEMINI_MODEL.');
    if(response.status===404)throw new RequestError(502,'The configured Gemini model is unavailable. Set GEMINI_MODEL to a model enabled for your key.');
    throw new RequestError(502,'Gemini is temporarily unavailable. Your case was not changed.');
   }
   const result=await response.json();
   const candidate=result.candidates?.[0];
   if(candidate?.finishReason&&candidate.finishReason!=='STOP')throw new RequestError(502,'Gemini did not return a complete answer. Try a shorter question.');
   const text=(candidate?.content?.parts||[]).filter((p:{thought?:boolean;text?:string})=>!p.thought&&typeof p.text==='string').map((p:{text:string})=>p.text).join('\n').trim();
   if(!text||text.length>12000)throw new RequestError(502,'Gemini returned no usable answer. Your case was not changed.');
   const latest=await loadLatest();
   if(copilotKey(latest,role,clock())!==initialKey)throw new RequestError(409,'The case changed while Gemini was responding. Refresh the explanation for the current state.');
   return res.status(200).json({text,snapshotKey:initialKey,model,role,asOf:new Date(clock()).toISOString(),provider:'Gemini'});
  }catch(error){
   if(error instanceof RequestError)return res.status(error.code).json({error:error.message});
   // Never expose upstream errors, secrets, tokens, notes, or request bodies.
   const timedOut=error instanceof Error&&['TimeoutError','AbortError'].includes(error.name);
   return res.status(timedOut?504:503).json({error:timedOut?'Gemini timed out. Your case was not changed; you can try again.':'Copilot is temporarily unavailable. The human workflow is still available.'});
  }
 };
}
export default createCopilotHandler();
