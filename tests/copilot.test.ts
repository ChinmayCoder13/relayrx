import test from 'node:test';
import assert from 'node:assert/strict';
import { createCopilotHandler } from '../server/copilot';
import type { ApiRequest, ApiResponse } from '../server/copilot';
import { createCase } from '../src/domain/seed';
import { applyAction } from '../src/domain/engine';
import type { Role } from '../src/domain/engine';
import { copilotKey } from '../src/domain/copilot';
const start=Date.parse('2026-09-27T12:00:00Z');
function fixture(){const c=createCase('Fictional Patient','Synthetic medication','No refills remaining');c.waitingSince=new Date(start).toISOString();return c;}
const output=()=>new Response(JSON.stringify({candidates:[{finishReason:'STOP',content:{parts:[{text:'Test Gemini response: clinician review is pending.'}]}}]}),{status:200,headers:{'Content-Type':'application/json'}});
const demoEnv=()=>({GEMINI_API_KEY:'test-only-secret',VITE_DATA_MODE:'demo'});
function request(c=fixture(),role:Role='staff',now=start+180000):ApiRequest{return {method:'POST',headers:{'content-type':'application/json'},body:{case:c,role,question:'Why is this case waiting?',snapshotKey:copilotKey(c,role,now),history:[]}};}
async function invoke(handler:ReturnType<typeof createCopilotHandler>,req:ApiRequest){let status=0,body:Record<string,any>={};const headers:Record<string,string>={};const res:ApiResponse={status(n){status=n;return res;},json(v){body=v as Record<string,any>;},setHeader(k,v){headers[k]=v;}};await handler(req,res);return {status,body,headers};}
test('unconfigured Gemini has an actionable setup error and never fabricates a response',async()=>{
 const handler=createCopilotHandler({env:()=>({}),fetcher:async()=>{throw Error('Must not fetch');}});
 const result=await invoke(handler,request());assert.equal(result.status,503);assert.equal(result.body.code,'GEMINI_NOT_CONFIGURED');assert.match(result.body.error,/GEMINI_API_KEY/);assert.match(result.headers['Cache-Control'],/no-store/);
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
test('bad input, public-demo opt-out, upstream quota and incomplete answers fail without workflow writes',async()=>{
 let handler=createCopilotHandler({env:()=>({...demoEnv(),DEMO_COPILOT_ENABLED:'false'}),clock:()=>start+180000});
 assert.equal((await invoke(handler,request())).status,403);
 handler=createCopilotHandler({env:demoEnv,clock:()=>start+180000,fetcher:async()=>new Response('{}',{status:429})});
 assert.equal((await invoke(handler,request())).status,429);
 assert.equal((await invoke(handler,{...request(),body:{question:'bad'}})).status,400);
 handler=createCopilotHandler({env:demoEnv,clock:()=>start+180000,fetcher:async()=>new Response(JSON.stringify({candidates:[{finishReason:'MAX_TOKENS',content:{parts:[{text:'Partial answer'}]}}]}),{status:200})});
 assert.equal((await invoke(handler,request())).status,502);
});
test('demo endpoint bounds requests within a warm instance',async()=>{
 const handler=createCopilotHandler({env:demoEnv,clock:()=>start+180000,fetcher:async()=>output()});
 for(let i=0;i<12;i++)assert.equal((await invoke(handler,request())).status,200);
 assert.equal((await invoke(handler,request())).status,429);
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
