import { createClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import { applyAction, WorkflowError } from '../src/domain/engine.js';
import type { CaseAction, RefillCase, Role } from '../src/domain/engine.js';
import { createCase, SCENARIOS } from '../src/domain/seed.js';
type Request={method?:string;headers:Record<string,string|string[]|undefined>;body?:unknown};
type Response={status:(code:number)=>Response;json:(body:unknown)=>void;setHeader:(key:string,value:string)=>void};
// The service role key is used only here. Every query is explicitly tenant-scoped.
export default async function handler(req:Request,res:Response){
 res.setHeader('Cache-Control','private, no-store, max-age=0');
 res.setHeader('Vary','Authorization');
 if(!['GET','POST'].includes(req.method||'')){res.setHeader('Allow','GET, POST');return res.status(405).json({error:'Method not allowed.'});}
 const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url||!key)return res.status(503).json({error:'Connected sandbox is not configured. The synthetic demo does not need a server.'});
 const auth=req.headers.authorization;
 if(typeof auth!=='string'||!auth.startsWith('Bearer '))return res.status(401).json({error:'A valid session is required.'});
 const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(input,init)=>fetch(input,{...init,signal:AbortSignal.timeout(10000)})}});
 try{
  const {data:{user},error:authError}=await db.auth.getUser(auth.slice(7));
  if(authError||!user)return res.status(401).json({error:'Your session could not be verified. Sign in again.'});
  const {data:member,error:memberError}=await db.from('rr_memberships').select('tenant_id, role, display_name').eq('user_id',user.id).single();
  if(memberError||!member||!['staff','clinician','pharmacy'].includes(member.role))return res.status(403).json({error:'No authorized workspace membership was found.'});
  const tenant=member.tenant_id,role=member.role as Role,actor=member.display_name as string;
  if(req.method==='GET'){
   const [{data:rows,error},{data:org}]=await Promise.all([db.from('rr_cases').select('payload').eq('tenant_id',tenant).order('created_at',{ascending:true}).limit(200),db.from('rr_tenants').select('name').eq('id',tenant).single()]);
   if(error)throw new Error('database');
   return res.status(200).json({cases:(rows||[]).map(r=>r.payload),role,actor,tenant:org?.name||'Sandbox practice',serverNow:new Date().toISOString()});
  }
  if(!String(req.headers['content-type']||'').startsWith('application/json'))return res.status(415).json({error:'Use an application/json request.'});
  const serialized=typeof req.body==='string'?req.body:JSON.stringify(req.body??{});
  if(serialized.length>12000)return res.status(413).json({error:'Request is too large.'});
  let body;try{body=JSON.parse(serialized);}catch{return res.status(400).json({error:'Invalid JSON.'});}
  if(!body||typeof body!=='object'||Array.isArray(body))throw new WorkflowError('Invalid request.');
  let result:RefillCase,requestId:string,expected=0;
  const hash=createHash('sha256').update(JSON.stringify(body)).digest('hex');
  requestId=body.operation==='create'?body.requestId:body.action?.requestId;
  if(typeof requestId!=='string'||!/^[a-zA-Z0-9-]{8,100}$/.test(requestId))throw new WorkflowError('A valid idempotency key is required.');
  // A retry after an unknown network outcome must return the original committed result.
  const {data:receipt,error:receiptError}=await db.from('rr_audit').select('case_id,request_hash').eq('tenant_id',tenant).eq('request_id',requestId).maybeSingle();
  if(receiptError)throw new Error('database');
  if(receipt){
   if(receipt.request_hash!==hash)throw new WorkflowError('This request ID was already used for a different command.',409);
   const {data:existing,error}=await db.from('rr_cases').select('payload').eq('tenant_id',tenant).eq('id',receipt.case_id).single();
   if(error)throw new Error('database');return res.status(200).json({case:existing.payload,replayed:true});
  }
  if(body.operation==='create'){
   if(role==='clinician')throw new WorkflowError('Practice staff or pharmacy must create intake records.',403);
   if(typeof body.patient!=='string'||body.patient.trim().length<2||body.patient.length>70||typeof body.medication!=='string'||body.medication.trim().length<2||body.medication.length>80||!SCENARIOS.includes(body.reason))throw new WorkflowError('Invalid sample intake fields.');
   const {count,error}=await db.from('rr_cases').select('id',{count:'exact',head:true}).eq('tenant_id',tenant);if(error)throw new Error('database');
   if((count||0)>=200)throw new WorkflowError('This sandbox is limited to 200 cases.');
   result=createCase(body.patient.trim(),body.medication.trim(),body.reason);
   result.id=`RX-${requestId}`;
   result.events=[{id:requestId,at:result.createdAt,type:'intake',actor,role,note:'Synthetic intake created. Pre-filled evidence is simulated; not a source-system verification.',signal:result.events[0].signal}];
  }else if(body.operation==='act'){
   if(typeof body.caseId!=='string'||body.caseId.length>120||!body.action||typeof body.action!=='object')throw new WorkflowError('Invalid workflow command.');
   const {data:row,error}=await db.from('rr_cases').select('payload,version').eq('tenant_id',tenant).eq('id',body.caseId).maybeSingle();
   if(error)throw new Error('database');if(!row)throw new WorkflowError('Refill not found.',404);
   const action=body.action as CaseAction;
   if(typeof action.simulateFailure!=='undefined'&&typeof action.simulateFailure!=='boolean')throw new WorkflowError('Invalid simulated outcome.');
   expected=row.version;
   result=applyAction(row.payload as RefillCase,action,role,actor);
  }else throw new WorkflowError('Unknown operation.');
  const {data:saved,error}=await db.rpc('rr_commit',{p_tenant:tenant,p_case:result.id,p_expected:expected,p_payload:result,p_event:result.events[0],p_request:requestId,p_hash:hash});
  if(error){if(error.message?.includes('VERSION_CONFLICT')||error.message?.includes('IDEMPOTENCY_CONFLICT'))throw new WorkflowError('This refill changed or this command was already used. Refresh before acting.',409);throw new Error('database');}
  return res.status(200).json({case:saved});
 }catch(error){
  if(error instanceof WorkflowError)return res.status(error.status).json({error:error.message});
  // Deliberately avoid logging records, request bodies, tokens, and evidence notes.
  return res.status(503).json({error:'The workspace is temporarily unavailable. No success is assumed. Refresh to verify the outcome before retrying.'});
 }
}
