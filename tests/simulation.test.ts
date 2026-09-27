import test from 'node:test';
import assert from 'node:assert/strict';
import { createSimulationSession, SIMULATION_STORAGE_KEY } from '../src/lib/simulationSession';
import { withSimulationTimer, simulationSourceKey } from '../src/domain/simulation';
import { applyAction, attention, needsAttention, state, DEMO_WAIT_MS } from '../src/domain/engine';
import { copilotContext, copilotKey } from '../src/domain/copilot';
import { createCase } from '../src/domain/seed';
const now=Date.parse('2026-09-28T00:00:00Z');
function oldCase(id='OLD-1'){const c=createCase('Synthetic','Example','No refills remaining',0,now-86400000);c.id=id;return c;}
const storage=()=>{const values=new Map<string,string>();return {values,setItem:(key:string,value:string)=>{values.set(key,value);}};};
test('fresh visits rebase old records, including duplicated tabs with inherited session storage',()=>{
 const c=oldCase(),original=structuredClone(c),saved=storage();
 assert.equal(needsAttention(c,now),true);
 const first=createSimulationSession(saved),view=first.project([c],now)[0];
 assert.equal(attention(view,now).remainingMs,DEMO_WAIT_MS);assert.equal(needsAttention(view,now+DEMO_WAIT_MS),true);
 assert.ok(saved.values.has(SIMULATION_STORAGE_KEY));
 const nextVisit=createSimulationSession(saved),fresh=nextVisit.project([c],now+DEMO_WAIT_MS*2)[0];
 assert.equal(attention(fresh,now+DEMO_WAIT_MS*2).remainingMs,DEMO_WAIT_MS);assert.deepEqual(c,original);
});
test('ticks, polling, role changes, and reaching expiry do not continually restart the current visit',()=>{
 const c=oldCase(),session=createSimulationSession();session.project([c],now);
 const view=session.project([structuredClone(c)],now+180001)[0];
 assert.equal(needsAttention(view,now+180001),true);assert.equal(state(view),'Awaiting clinician');
 for(const role of ['staff','clinician','pharmacy'] as const)assert.equal(copilotContext(view,role,now+180001).attentionState,'Needs Attention');
 assert.equal(needsAttention(session.project([c],now+400000)[0],now+400000),true);
});
test('manual restart changes only one case presentation timer and invalidates its copilot snapshot',()=>{
 const a=oldCase('A'),b=oldCase('B'),before=structuredClone([a,b]),session=createSimulationSession();
 const first=session.project([a,b],now);assert.equal(first.filter(c=>needsAttention(c,now+180000)).length,2);
 const oldKey=copilotKey(first[0],'staff',now+180000);
 session.restart(a,now+180000);const next=session.project([a,b],now+180000);
 assert.equal(attention(next[0],now+180000).remainingMs,DEMO_WAIT_MS);assert.equal(next.filter(c=>needsAttention(c,now+180000)).length,1);
 assert.notEqual(copilotKey(next[0],'staff',now+180000),oldKey);assert.deepEqual([a,b],before);
});
test('workflow progress gets a new timer while unrelated notes retain the existing deadline',()=>{
 const c=oldCase(),session=createSimulationSession();session.project([c],now);
 const noted=applyAction(c,{type:'patient_update',requestId:'note',expectedVersion:c.version,note:'Synthetic update'},'staff','Test',new Date(now+1000).toISOString());
 assert.equal(attention(session.project([noted],now+179000)[0],now+179000).remainingMs,1000);
 const approved=applyAction(noted,{type:'approve',requestId:'approve',expectedVersion:noted.version,note:'Human test decision'},'clinician','Test',new Date(now+179000).toISOString());
 const view=session.project([approved],now+179000)[0];assert.equal(state(view),'Ready to route');assert.equal(attention(view,now+180000).remainingMs,179000);assert.equal(view.resolvedAt,null);
});
test('closed and declined cases never receive or restart a simulation timer',()=>{
 const resolved={...oldCase(),transport:'dispensed' as const,resolvedAt:new Date(now).toISOString()},declined={...oldCase('DECLINED'),declined:true};
 const session=createSimulationSession();
 for(const c of session.project([resolved,declined],now)){assert.equal(attention(c,now).pending,false);assert.equal(session.restart(c,now),false);assert.equal(session.get(c),undefined);}
});
test('server projection rejects stale, malformed, or future timers without changing saved records',()=>{
 const c=oldCase(),before=structuredClone(c),timer={sourceKey:simulationSourceKey(c),startedAt:new Date(now).toISOString()};
 assert.equal(needsAttention(withSimulationTimer(c,timer,now),now),false);assert.deepEqual(c,before);
 assert.throws(()=>withSimulationTimer(c,{...timer,sourceKey:'other-case'},now),/step changed/);
 assert.throws(()=>withSimulationTimer(c,{...timer,startedAt:new Date(now+6000).toISOString()},now),/Invalid/);
 assert.throws(()=>withSimulationTimer(c,{...timer,startedAt:'invalid'},now),/Invalid/);
});
test('blocked session storage still supports a fresh in-memory demo timer',()=>{
 const session=createSimulationSession({setItem(){throw Error('Storage blocked');}}),c=oldCase();
 assert.equal(attention(session.project([c],now)[0],now).remainingMs,DEMO_WAIT_MS);
});
test('failed retries becoming escalation keep the original visit deadline',()=>{
 let c=oldCase();for(const evidence of Object.values(c.inputs))evidence.verified=true;c.transport='failed';c.attempts=1;c.owner='staff';
 const session=createSimulationSession();session.project([c],now);
 for(let attempt=2;attempt<=3;attempt++){
  c=applyAction(c,{type:'retry',requestId:`failed-${attempt}`,expectedVersion:c.version,note:'Synthetic failure',simulateFailure:true},'staff','Test',new Date(now+179000).toISOString());
  assert.equal(attention(session.project([c],now+179000)[0],now+179000).remainingMs,1000);
 }
 assert.equal(needsAttention(session.project([c],now+180000)[0],now+180000),true);
});
