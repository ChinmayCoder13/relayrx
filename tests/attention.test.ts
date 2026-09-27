import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAction, attention, DEMO_WAIT_MS, needsAttention, state, signal, waitingSince } from '../src/domain/engine';
import type { ActionType, RefillCase, Role } from '../src/domain/engine';
import { createCase } from '../src/domain/seed';
import { copilotContext, copilotInstruction, copilotKey } from '../src/domain/copilot';
const start=Date.parse('2026-09-27T12:00:00Z'),at=(ms:number)=>new Date(start+ms).toISOString();
function fresh(){const c=createCase('Timer Test','Synthetic example','No refills remaining');c.createdAt=at(-72000000);c.waitingSince=at(0);return c;}
let sequence=0;
const act=(c:RefillCase,type:ActionType,role:Role,ms:number,simulateFailure=false)=>applyAction(c,{type,requestId:`timer-${++sequence}`,expectedVersion:c.version,note:'Verified synthetic test evidence only.',simulateFailure},role,'Test actor',at(ms));
test('180-second threshold flags a pending action without changing workflow, evidence or audit',()=>{
 const c=fresh(),before=structuredClone(c);
 assert.equal(needsAttention(c,start+179999),false);
 assert.equal(needsAttention(c,start+180000),true);
 assert.equal(attention(c,start+180000).simulatedHours,30);
 assert.equal(state(c),'Awaiting clinician');assert.equal(signal(c),12);
 assert.deepEqual(c,before);
});
test('completing an action at 179 seconds starts a new wait, with no stale old deadline',()=>{
 const c=act(fresh(),'approve','clinician',179000);
 assert.equal(state(c),'Ready to route');assert.equal(c.waitingSince,at(179000));
 assert.equal(needsAttention(c,start+180000),false);
 assert.equal(needsAttention(c,start+358999),false);
 assert.equal(needsAttention(c,start+359000),true);
});
test('taking the required action clears an existing attention flag and continues the workflow',()=>{
 const c=fresh();assert.equal(needsAttention(c,start+180000),true);
 const approved=act(c,'approve','clinician',200000);
 assert.equal(needsAttention(approved,start+200001),false);assert.equal(state(approved),'Ready to route');
 assert.equal(approved.resolvedAt,null);
});
test('15/15, routing, waiting, readiness and pickup remain separate gates',()=>{
 let c=act(fresh(),'approve','clinician',1000);
 c=act(c,'dispatch','staff',2000);
 assert.equal(signal(c),15);assert.equal(state(c),'Awaiting pharmacy');
 assert.equal(needsAttention(c,start+182000),true);assert.equal(c.transport,'queued');assert.equal(c.resolvedAt,null);
 assert.throws(()=>act(c,'dispense','pharmacy',183000),/readiness must be confirmed/);
 c=act(c,'acknowledge','pharmacy',190000);
 assert.equal(state(c),'Ready for pickup');assert.equal(needsAttention(c,start+190001),false);
 assert.equal(needsAttention(c,start+370000),true);
 c=act(c,'dispense','pharmacy',371000);
 assert.equal(state(c),'Resolved');assert.equal(c.waitingSince,null);
 assert.equal(needsAttention(c,start+100*DEMO_WAIT_MS),false);
});
test('completed and declined cases never enter Needs Attention, even with stale timestamps',()=>{
 let c=act(fresh(),'approve','clinician',1000);c=act(c,'dispatch','staff',2000);c=act(c,'acknowledge','pharmacy',3000);c=act(c,'dispense','pharmacy',4000);
 const declined=act(fresh(),'decline','clinician',1000);
 for(const closed of [c,declined]){closed.waitingSince=at(-90000000);assert.equal(attention(closed,start+90000000).pending,false);assert.equal(needsAttention(closed,start+90000000),false);}
});
test('viewing, preview messages, information requests and duplicate commands cannot restart a wait',()=>{
 let c=fresh();const originalSince=c.waitingSince;
 attention(c,start+180000);copilotContext(c,'staff',start+180000);
 c=act(c,'patient_update','staff',190000);c=act(c,'request_info','staff',200000);
 assert.equal(c.waitingSince,originalSince);assert.equal(needsAttention(c,start+200000),true);
 const action={type:'approve' as const,requestId:'repeat-command',expectedVersion:c.version,note:'Synthetic clinician review recorded.'};
 const saved=applyAction(c,action,'clinician','Test',at(201000));
 const repeated=applyAction(saved,action,'clinician','Test',at(300000));assert.deepEqual(repeated,saved);
});
test('failed retries and escalation do not conceal an unresolved wait',()=>{
 let c=act(fresh(),'approve','clinician',1000);c=act(c,'dispatch','staff',2000,true);
 const since=c.waitingSince;c=act(c,'retry','staff',180000,true);c=act(c,'retry','staff',181000,true);c=act(c,'escalate','staff',182000);
 assert.equal(c.waitingSince,since);assert.equal(needsAttention(c,start+182000),true);assert.equal(state(c),'Handoff failed');
});
test('a persisted case retains its deadline across serialization and reload',()=>{
 const c=JSON.parse(JSON.stringify(fresh())) as RefillCase;
 assert.equal(needsAttention(c,start+179999),false);assert.equal(needsAttention(c,start+180000),true);
 const legacy=structuredClone(c);delete legacy.waitingSince;legacy.events=[{...legacy.events[0],at:at(0)}];assert.equal(waitingSince(legacy),at(0));
});
test('all three copilots see authoritative attention, owner, missing evidence and completed state',()=>{
 for(const role of ['staff','clinician','pharmacy'] as Role[]){
  let c=fresh();let ctx=copilotContext(c,role,start+180000);
  assert.equal(ctx.attentionState,'Needs Attention');assert.equal(ctx.currentOwner,'Clinician');assert.equal(ctx.pendingAction?.type,'approve');assert.equal(ctx.evidence.find(i=>i.requirement==='Clinician authorization')?.verified,false);
  assert.match(ctx.authoritativeExplanation,/current owner is Clinician/);
  c=act(c,'approve','clinician',200000);ctx=copilotContext(c,role,start+200001);
  assert.equal(ctx.attentionState,'Within demo threshold');assert.equal(ctx.currentOwner,'Practice staff');assert.equal(ctx.pendingAction?.type,'dispatch');
  c=act(c,'dispatch','staff',201000);c=act(c,'acknowledge','pharmacy',202000);c=act(c,'dispense','pharmacy',203000);
  ctx=copilotContext(c,role,start+999000);assert.equal(ctx.workflowState,'Resolved');assert.equal(ctx.timer.stillWaiting,false);assert.equal(ctx.pendingAction,null);assert.equal(ctx.attentionState,'Timer stopped');
  assert.match(copilotInstruction(role),/No clinical prescribing decisions/);assert.match(copilotInstruction(role),/Read-only assistance/);
 }
});
test('response snapshots change at the threshold or workflow change, not on each countdown tick',()=>{
 const c=fresh();assert.equal(copilotKey(c,'staff',start+1),copilotKey(c,'staff',start+179999));
 assert.notEqual(copilotKey(c,'staff',start+179999),copilotKey(c,'staff',start+180000));
 assert.notEqual(copilotKey(c,'staff',start),copilotKey(c,'pharmacy',start));
 assert.notEqual(copilotKey(c,'staff',start),copilotKey(act(c,'approve','clinician',1000),'staff',start+1000));
});
