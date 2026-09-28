import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoSession } from '../src/lib/demoSession';
import { applyAction, state } from '../src/domain/engine';
import { createCase } from '../src/domain/seed';

test('fresh visits restore the original names, evidence, and six cases without affecting an open rehearsal',()=>{
 const first=createDemoSession(),original=first.load();
 const changed=applyAction(original[0],{type:'approve',requestId:'demo-review',expectedVersion:original[0].version,note:'Synthetic clinician review completed.'},'clinician','Demo reviewer');
 first.save([createCase('Fictional Rehearsal','Example','No refills remaining'),changed,...original.slice(1)]);
 assert.equal(first.load().length,7);
 assert.equal(state(first.load()[1]),'Ready to route');
 const next=createDemoSession().load();
 assert.deepEqual(next.map(c=>[c.id,c.patient,c.medication,state(c),c.version]),original.map(c=>[c.id,c.patient,c.medication,state(c),c.version]));
 assert.equal(next[0].inputs.approval.verified,false);
 assert.equal(next[0].events.length,1);
 assert.equal(first.load().length,7);
 assert.equal(state(first.load()[1]),'Ready to route');
});

test('reading the current visit preserves saved actions and cannot mutate its stored snapshot',()=>{
 const session=createDemoSession(),cases=session.load();
 cases[0].patient='Temporary alias';session.save(cases);
 cases[0].patient='Unsaved edit';
 assert.equal(session.load()[0].patient,'Temporary alias');
 const loaded=session.load();loaded.splice(0,1);
 assert.equal(session.load().length,6);
});
