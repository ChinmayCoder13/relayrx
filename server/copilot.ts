import { createClient } from '@supabase/supabase-js';
import { INPUTS } from '../src/domain/engine.js';
import type { RefillCase, Role } from '../src/domain/engine.js';
import { copilotContext, copilotGreeting, copilotInstruction, copilotKey } from '../src/domain/copilot.js';
import { logicEngineBackup } from '../src/domain/copilotFallback.js';
import { withSimulationTimer, SimulationTimerError } from '../src/domain/simulation.js';
import { DEFAULT_GEMINI_MODEL, GeminiFailure, generateGemini } from './gemini.js';

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
export function createCopilotHandler(options:{env?:()=>NodeJS.ProcessEnv;fetcher?:typeof fetch;clock?:()=>number;sleep?:(ms:number)=>Promise<void>;logger?:(message:string,error?:unknown)=>void;providerTimeoutMs?:number}={}){
 const env=options.env||(()=>process.env),fetcher=options.fetcher||((...args)=>fetch(...args)),clock=options.clock||Date.now;
 const log=options.logger||((message:string,error?:unknown)=>console.error(message,error));
 const limits=new Map<string,{until:number;used:number}>();
 function permit(key:string,max:number){const now=clock();let record=limits.get(key);if(!record||now>=record.until){record={until:now+60000,used:0};limits.set(key,record);}if(record.used>=max)return false;record.used++;if(limits.size>1000)for(const [k,v] of limits)if(v.until<now)limits.delete(k);return true;}
 return async function handler(req:ApiRequest,res:ApiResponse){
  res.setHeader('Cache-Control','private, no-store');res.setHeader('Vary','Authorization');
  if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({error:'Use POST to ask the copilot.'});}
  const config=env(),key=config.GEMINI_API_KEY?.trim();
  // Finish before Vercel's 30-second budget, including connected-state verification.
  const requestSignal=AbortSignal.timeout(26000);
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
    const db=createClient(config.SUPABASE_URL,config.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(input,init)=>fetcher(input,{...init,signal:AbortSignal.any([requestSignal,AbortSignal.timeout(5000)])})}});
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
   const view=withSimulationTimer(current,body.simulationTimer,clock());
   const initialKey=copilotKey(view,role,clock());
   if(body.snapshotKey!==initialKey)throw new RequestError(409,'The case or attention state changed. Use the current case and ask again.');
   const model=config.GEMINI_MODEL?.trim()||DEFAULT_GEMINI_MODEL;
   const greeting=copilotGreeting(role,body.question);
   let text=greeting||'',failure:GeminiFailure|undefined;
   if(!greeting)try{
    if(!permit(limitId,12)||!permit('all',40)){res.setHeader('Retry-After','60');throw new GeminiFailure('COPILOT_RATE_LIMITED','The copilot request limit was reached. Wait one minute before retrying Gemini.');}
    if(!key){log('GEMINI_API_KEY is undefined on server');throw new GeminiFailure('GEMINI_NOT_CONFIGURED','Gemini is not configured. Add GEMINI_API_KEY in Vercel Environment Variables, then redeploy.');}
    if(!/^[a-zA-Z0-9._-]{1,90}$/.test(model))throw new GeminiFailure('GEMINI_CONFIGURATION','GEMINI_MODEL must be a valid model ID.');
    const context={...copilotContext(view,role,clock()),timerScope:body.simulationTimer?'Current browser visit; presentation-only simulation clock. The stored workflow has not been modified.':'Stored workflow waiting timestamp.'};
    text=await generateGemini({model,key,fetcher,signal:requestSignal,sleep:options.sleep,timeoutMs:options.providerTimeoutMs,payload:{systemInstruction:{parts:[{text:copilotInstruction(role)}]},contents:[{role:'user',parts:[{text:JSON.stringify({currentCase:context,historyFromSameSnapshot:history,question:body.question.trim()})}]}],generationConfig:{temperature:0.2,maxOutputTokens:1600}}});
   }catch(error){
    failure=error instanceof GeminiFailure?error:new GeminiFailure('GEMINI_NETWORK','The Gemini request could not be completed.',true);
    // These error objects contain only controlled diagnostics, never raw provider bodies or secrets.
    log('Gemini Copilot Error:',failure);
   }
   // Both Gemini and backup answers must pass the same latest-state/tenant checks.
   const latest=withSimulationTimer(await loadLatest(),body.simulationTimer,clock());
   if(copilotKey(latest,role,clock())!==initialKey)throw new RequestError(409,'The case changed while Gemini was responding. Refresh the explanation for the current state.');
   if(greeting)return res.status(200).json({text,snapshotKey:initialKey,model:null,role,asOf:new Date(clock()).toISOString(),provider:'RelayRx',mode:'local'});
   if(failure)return res.status(200).json({text:logicEngineBackup(latest,role,body.question,clock()),snapshotKey:initialKey,model:null,role,asOf:new Date(clock()).toISOString(),provider:'Logic Engine',mode:'offline',code:failure.code,notice:failure.message,retryable:failure.retryable});
   return res.status(200).json({text,snapshotKey:initialKey,model,role,asOf:new Date(clock()).toISOString(),provider:'Gemini',mode:'online'});
  }catch(error){
   if(error instanceof SimulationTimerError)return res.status(409).json({error:error.message});
   if(error instanceof RequestError){if(error.code>=500)log('Gemini Copilot Error:',error);return res.status(error.code).json({error:error.message,...(error.code>=500?{code:'WORKSPACE_UNVERIFIED'}:{})});}
   log('Gemini Copilot Error:',new Error('Could not verify the authorized current workspace state. No fallback was returned.'));
   const timedOut=error instanceof Error&&['TimeoutError','AbortError'].includes(error.name);
   return res.status(timedOut?504:503).json({error:'Could not verify the current workspace state. Refresh before asking again.',code:'WORKSPACE_UNVERIFIED'});
  }
 };
}
export default createCopilotHandler();
