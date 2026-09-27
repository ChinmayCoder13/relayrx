import test from 'node:test';
import assert from 'node:assert/strict';
import { createCopilotHandler as makeCopilotHandler } from '../server/copilot';
import type { ApiRequest, ApiResponse } from '../server/copilot';
import { createCase } from '../src/domain/seed';
import { applyAction } from '../src/domain/engine';
import type { Role } from '../src/domain/engine';
import { copilotKey } from '../src/domain/copilot';
import { simulationSourceKey, withSimulationTimer } from '../src/domain/simulation';
function createCopilotHandler(options:Parameters<typeof makeCopilotHandler>[0]={}){return makeCopilotHandler({logger:()=>{},sleep:async()=>{},...options});}
const start=Date.parse('2026-09-27T12:00:00Z');
function fixture(){const c=createCase('Fictional Patient','Synthetic medication','No refills remaining');c.waitingSince=new Date(start).toISOString();return c;}
const output=()=>new Response(JSON.stringify({candidates:[{finishReason:'STOP',content:{parts:[{text:'Test Gemini response: clinician review is pending.'}]}}]}),{status:200,headers:{'Content-Type':'application/json'}});
const demoEnv=()=>({GEMINI_API_KEY:'test-only-secret',VITE_DATA_MODE:'demo'});
function request(c=fixture(),role:Role='staff',now=start+180000):ApiRequest{return {method:'POST',headers:{'content-type':'application/json'},body:{case:c,role,question:'Why is this case waiting?',snapshotKey:copilotKey(c,role,now),history:[]}};}
async function invoke(handler:ReturnType<typeof createCopilotHandler>,req:ApiRequest){let status=0,body:Record<string,any>={};const headers:Record<string,string>={};const res:ApiResponse={status(n){status=n;return res;},json(v){body=v as Record<string,any>;},setHeader(k,v){headers[k]=v;}};await handler(req,res);return {status,body,headers};}
test('unconfigured Gemini returns a labeled logic backup and logs the missing key after validating the request',async()=>{
 const logs:string[]=[];
 const handler=createCopilotHandler({env:()=>({}),clock:()=>start+180000,logger:message=>logs.push(message),fetcher:async()=>{throw Error('Must not fetch');}});
 const result=await invoke(handler,request());assert.equal(result.status,200);assert.equal(result.body.code,'GEMINI_NOT_CONFIGURED');assert.equal(result.body.provider,'Logic Engine');assert.match(result.body.notice,/GEMINI_API_KEY/);assert.match(result.headers['Cache-Control'],/no-store/);assert.ok(logs.includes('GEMINI_API_KEY is undefined on server'));assert.match(result.body.text,/\[Offline Mode: Logic Engine Backup\]/);
 assert.equal((await invoke(handler,{method:'GET',headers:{}})).status,405);
});
test('all three Gemini calls include current attention and role instructions, with a server-only key',async()=>{
 for(const role of ['staff','clinician','pharmacy'] as Role[]){
  let captured:any,endpoint='',headers:Headers|undefined;
  const handler=createCopilotHandler({env:demoEnv,clock:()=>start+180001,fetcher:async(url,init)=>{endpoint=String(url);headers=new Headers(init?.headers);captured=JSON.parse(String(init?.body));return output();}});
  const c=fixture(),before=structuredClone(c),result=await invoke(handler,request(c,role));
  assert.equal(result.status,200);assert.equal(result.body.provider,'Gemini');assert.equal(result.body.role,role);
  assert.equal(headers?.get('x-goog-api-key'),'test-only-secret');assert.doesNotMatch(endpoint,/test-only-secret/);assert.doesNotMatch(JSON.stringify(result.body),/test-only-secret/);
  const context=JSON.parse(captured.contents[0].parts[0].text).currentCase;
  assert.equal(context.attentionState,'Needs Attention');assert.equal(context.currentOwner,'Clinician');assert.equal(context.pendingAction.type,'approve');assert.equal(context.timer.thresholdSeconds,180);
  assert.match(captured.systemInstruction.parts[0].text,/Read-only assistance/);assert.doesNotMatch(JSON.stringify(context),/Fictional Patient|Synthetic medication/);assert.deepEqual(c,before);
 }
});
test('stale requests and responses spanning the attention threshold are rejected',async()=>{
 let now=start+179999,calls=0;
 const handler=createCopilotHandler({env:demoEnv,clock:()=>now,fetcher:async()=>{calls++;now=start+180000;return output();}});
 const req=request(fixture(),'staff',now);
 assert.equal((await invoke(handler,req)).status,409);assert.equal(calls,1);
 assert.equal((await invoke(handler,req)).status,409);assert.equal(calls,1);
});
test('bad input and demo opt-out are rejected; quota and incomplete provider answers use a labeled backup',async()=>{
 let handler=createCopilotHandler({env:()=>({...demoEnv(),DEMO_COPILOT_ENABLED:'false'}),clock:()=>start+180000});
 assert.equal((await invoke(handler,request())).status,403);
 handler=createCopilotHandler({env:demoEnv,clock:()=>start+180000,fetcher:async()=>new Response('{}',{status:429})});
 const quota=await invoke(handler,request());assert.equal(quota.status,200);assert.equal(quota.body.provider,'Logic Engine');assert.equal(quota.body.code,'GEMINI_RATE_LIMITED');
 assert.equal((await invoke(handler,{...request(),body:{question:'bad'}})).status,400);
 handler=createCopilotHandler({env:demoEnv,clock:()=>start+180000,fetcher:async()=>new Response(JSON.stringify({candidates:[{finishReason:'MAX_TOKENS',content:{parts:[{text:'Partial answer'}]}}]}),{status:200})});
 const incomplete=await invoke(handler,request());assert.equal(incomplete.status,200);assert.equal(incomplete.body.code,'GEMINI_INCOMPLETE');assert.doesNotMatch(incomplete.body.text,/Partial answer/);
});
test('demo endpoint bounds requests within a warm instance',async()=>{
 const handler=createCopilotHandler({env:demoEnv,clock:()=>start+180000,fetcher:async()=>output()});
 for(let i=0;i<12;i++)assert.equal((await invoke(handler,request())).status,200);
 const limited=await invoke(handler,request());assert.equal(limited.status,200);assert.equal(limited.body.code,'COPILOT_RATE_LIMITED');assert.equal(limited.body.provider,'Logic Engine');
});
test('connected Gemini uses authenticated role and tenant-scoped database state, not client evidence',async()=>{
 let latest=fixture(),caseReads=0,geminiCalls=0,context:any;
 const env=()=>({GEMINI_API_KEY:'test-only-secret',VITE_DATA_MODE:'supabase',SUPABASE_URL:'https://synthetic.invalid',SUPABASE_SERVICE_ROLE_KEY:'test-service-key'});
 const fetcher:typeof fetch=async(input,init)=>{
  const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
  if(url.hostname==='generativelanguage.googleapis.com'){geminiCalls++;context=JSON.parse(JSON.parse(String(init?.body)).contents[0].parts[0].text).currentCase;return output();}
  assert.ok(!init?.method||init.method==='GET','No database writes permitted by copilot');
  let data:unknown;
  if(url.pathname==='/auth/v1/user')data={id:'demo-user',aud:'authenticated',role:'authenticated'};
  else if(url.pathname==='/rest/v1/rr_memberships')data={tenant_id:'test-tenant',role:'clinician'};
  else if(url.pathname==='/rest/v1/rr_cases'){caseReads++;assert.equal(url.searchParams.get('tenant_id'),'eq.test-tenant');assert.equal(url.searchParams.get('id'),`eq.${latest.id}`);data={payload:latest};}
  else throw Error('Unexpected request');
  return new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});
 };
 const handler=createCopilotHandler({env,fetcher,clock:()=>start+180000});
 const base=request(latest,'clinician'),body=base.body as Record<string,unknown>;body.caseId=latest.id;body.case={transport:'dispensed'};
 base.headers.authorization='Bearer test-user-token';
 let result=await invoke(handler,base);assert.equal(result.status,200);assert.equal(caseReads,2);assert.equal(context.workflowState,'Awaiting clinician');assert.equal(context.attentionState,'Needs Attention');
 result=await invoke(handler,{...base,body:{...body,role:'staff'}});assert.equal(result.status,403);assert.equal(geminiCalls,1);
 result=await invoke(handler,{...base,headers:{'content-type':'application/json'}});assert.equal(result.status,401);
 const oldKey=body.snapshotKey;latest=applyAction(latest,{type:'approve',expectedVersion:latest.version,requestId:'connected-review',note:'Synthetic human authorization recorded.'},'clinician','Test',new Date(start+179000).toISOString());
 result=await invoke(handler,{...base,body:{...body,snapshotKey:oldKey}});assert.equal(result.status,409);assert.equal(geminiCalls,1);
});
test('one bounded retry recovers a transient service failure without changing the case',async()=>{
 let calls=0;const delays:number[]=[];
 const handler=createCopilotHandler({env:demoEnv,clock:()=>start+180000,sleep:async ms=>{delays.push(ms);},fetcher:async()=>++calls===1?new Response('{}',{status:503}):output()});
 const c=fixture(),before=structuredClone(c),result=await invoke(handler,request(c));
 assert.equal(result.status,200);assert.equal(result.body.provider,'Gemini');assert.equal(calls,2);assert.deepEqual(delays,[450]);assert.deepEqual(c,before);
});
test('persistent outages give all roles a deterministic state/owner/priority/signal backup',async()=>{
 for(const role of ['staff','clinician','pharmacy'] as const){
  let calls=0;const c=fixture(),before=structuredClone(c);
  const handler=createCopilotHandler({env:demoEnv,clock:()=>start+180000,fetcher:async()=>{calls++;return new Response('{}',{status:503});}});
  const result=await invoke(handler,request(c,role));
  assert.equal(result.status,200);assert.equal(result.body.provider,'Logic Engine');assert.equal(result.body.mode,'offline');assert.equal(calls,2);
  assert.match(result.body.text,/Offline Mode: Logic Engine Backup/);assert.match(result.body.text,/Awaiting clinician/);assert.match(result.body.text,/Current owner: Clinician/);assert.match(result.body.text,/Queue priority: Needs Attention/);assert.match(result.body.text,/12\/15/);
  assert.deepEqual(c,before);
  if(role==='clinician')assert.match(result.body.text,/Verified:.*Patient identity/);
  if(role==='pharmacy')assert.match(result.body.text,/has not been routed/);
  if(role==='staff')assert.match(result.body.text,/Administrative next step/);
 }
});
test('network errors are backed up with safe diagnostics and never expose keys or provider payloads',async()=>{
 const logs:string[]=[];let calls=0;
 const handler=createCopilotHandler({env:demoEnv,clock:()=>start+180000,logger:(label,error)=>logs.push(label+' '+(error instanceof Error?error.stack:String(error))),fetcher:async()=>{calls++;throw Error('test-only-secret Fictional Patient private note');}});
 const result=await invoke(handler,request());assert.equal(calls,2);assert.equal(result.body.code,'GEMINI_NETWORK');assert.equal(result.body.provider,'Logic Engine');assert.match(logs.join('\n'),/Gemini Copilot Error:.*GeminiFailure/);assert.doesNotMatch(logs.join('\n')+JSON.stringify(result.body),/test-only-secret|Fictional Patient|private note/);
});
test('slow provider calls are aborted and fall back within the configured attempt budget',async()=>{
 let aborted=0;
 const handler=createCopilotHandler({env:demoEnv,clock:()=>start+180000,providerTimeoutMs:5,fetcher:async(_url,init)=>new Promise<Response>((resolve,reject)=>{
  const timer=setTimeout(()=>resolve(output()),1000);
  init!.signal!.addEventListener('abort',()=>{clearTimeout(timer);aborted++;reject(new DOMException('Timed out','TimeoutError'));},{once:true});
 })});
 const result=await invoke(handler,request());assert.equal(aborted,2);assert.equal(result.body.code,'GEMINI_TIMEOUT');assert.equal(result.body.provider,'Logic Engine');
});
test('quota and configuration failures do not retry or leak raw upstream messages',async()=>{
 for(const status of [429,400,401,403,404]){
  let calls=0;const handler=createCopilotHandler({env:demoEnv,clock:()=>start+180000,fetcher:async()=>{calls++;return new Response('test-only-secret raw provider body',{status});}});
  const result=await invoke(handler,request());assert.equal(calls,1);assert.equal(result.body.provider,'Logic Engine');assert.doesNotMatch(JSON.stringify(result.body),/test-only-secret|raw provider body/);
 }
});
test('Gemini model defaults to a supported Flash-Lite model and retains explicit environment overrides',async()=>{
 for(const model of [undefined,'custom-enabled-model']){
  let url='';const handler=createCopilotHandler({env:()=>({...demoEnv(),GEMINI_MODEL:model}),clock:()=>start+180000,fetcher:async input=>{url=String(input);return output();}});
  const result=await invoke(handler,request());assert.equal(result.body.model,model||'gemini-3.5-flash-lite');assert.ok(url.includes(`/models/${model||'gemini-3.5-flash-lite'}:generateContent`));
 }
});
test('session timer context agrees with the UI and backup when the stored wait is already expired',async()=>{
 const now=start+360000,c=fixture(),simulationTimer={sourceKey:simulationSourceKey(c),startedAt:new Date(now).toISOString()};
 const view=withSimulationTimer(c,simulationTimer,now),req=request(c,'staff',now);
 req.body={...(req.body as object),simulationTimer,snapshotKey:copilotKey(view,'staff',now)};
 const handler=createCopilotHandler({env:demoEnv,clock:()=>now,fetcher:async()=>new Response('{}',{status:429})});
 const result=await invoke(handler,req);assert.equal(result.status,200);assert.match(result.body.text,/Queue priority: Within the demo waiting threshold/);assert.equal(c.waitingSince,new Date(start).toISOString());
 const invalid={...req,body:{...(req.body as object),simulationTimer:{...simulationTimer,sourceKey:'other-step'}}};assert.equal((await invoke(handler,invalid)).status,409);
});
test('backup answers also reject stale snapshots when attention changes during a provider failure',async()=>{
 let now=start+179999;const handler=createCopilotHandler({env:demoEnv,clock:()=>now,fetcher:async()=>{now++;return new Response('{}',{status:429});}});
 const result=await invoke(handler,request(fixture(),'staff',now));assert.equal(result.status,409);assert.equal(result.body.provider,undefined);
});
test('logic backup does not invent pickup or reopen completed cases',async()=>{
 for(const transport of ['queued','acknowledged','dispensed'] as const){
  const c=fixture();for(const evidence of Object.values(c.inputs))evidence.verified=true;
  c.transport=transport;c.owner='pharmacy';if(transport==='dispensed')c.resolvedAt=new Date(start).toISOString();
  const handler=createCopilotHandler({env:demoEnv,clock:()=>start+180000,fetcher:async()=>new Response('{}',{status:429})});
  const result=await invoke(handler,request(c,'pharmacy'));
  if(transport==='dispensed'){assert.match(result.body.text,/Workflow: Resolved/);assert.match(result.body.text,/Queue priority: No pending action/);assert.match(result.body.text,/Pickup is confirmed/);}
  else {assert.match(result.body.text,/Pickup is not confirmed/);assert.doesNotMatch(result.body.text,/Workflow: Resolved/);}
 }
});
test('missing Gemini configuration cannot bypass demo opt-out or connected authentication',async()=>{
 const disabled=createCopilotHandler({env:()=>({DEMO_COPILOT_ENABLED:'false'}),clock:()=>start+180000});
 assert.equal((await invoke(disabled,request())).status,403);
 const connected=createCopilotHandler({env:()=>({VITE_DATA_MODE:'supabase',SUPABASE_URL:'https://synthetic.invalid',SUPABASE_SERVICE_ROLE_KEY:'test-service-key'}),clock:()=>start+180000,fetcher:async()=>{throw Error('No unauthenticated network access');}});
 const denied=await invoke(connected,request());assert.equal(denied.status,401);assert.equal(denied.body.provider,undefined);
});
test('connected fallback verifies the latest tenant-scoped case and fails closed if it cannot be read',async()=>{
 const c=fixture();let reads=0,failLatest=false;
 const env=()=>({...demoEnv(),VITE_DATA_MODE:'supabase',SUPABASE_URL:'https://synthetic.invalid',SUPABASE_SERVICE_ROLE_KEY:'test-service-key'});
 const handler=createCopilotHandler({env,clock:()=>start+180000,fetcher:async(input,init)=>{
  const url=new URL(String(input));if(url.hostname==='generativelanguage.googleapis.com')return new Response('{}',{status:429});
  assert.ok(!init?.method||init.method==='GET');
  let data:unknown;
  if(url.pathname==='/auth/v1/user')data={id:'member',aud:'authenticated',role:'authenticated'};
  else if(url.pathname==='/rest/v1/rr_memberships')data={tenant_id:'authorized-tenant',role:'clinician'};
  else {reads++;assert.equal(url.searchParams.get('tenant_id'),'eq.authorized-tenant');if(failLatest&&reads%2===0)return new Response('{"message":"unavailable"}',{status:400});data={payload:c};}
  return new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
 }});
 const req=request(c,'clinician');req.headers.authorization='Bearer synthetic-user-token';req.body={...(req.body as object),caseId:c.id,case:{transport:'dispensed'}};
 const backup=await invoke(handler,req);assert.equal(backup.body.provider,'Logic Engine');assert.match(backup.body.text,/Workflow: Awaiting clinician/);assert.equal(reads,2);
 failLatest=true;const denied=await invoke(handler,req);assert.equal(denied.status,503);assert.equal(denied.body.code,'WORKSPACE_UNVERIFIED');assert.equal(denied.body.provider,undefined);
});
