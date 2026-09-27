import { INPUTS, attention, gateOpen, nextAction, patientText, roleNames, signal, state, waitingExplanation } from './engine.js';
import type { RefillCase, Role } from './engine.js';
import { copilotNames } from './copilot.js';

export type CopilotProvider='Gemini'|'Logic Engine';
export type CopilotReply={text:string;snapshotKey:string;provider:CopilotProvider;model:string|null;role:Role;asOf:string;mode:'online'|'offline';notice?:string;code?:string;retryable?:boolean};

/** Deterministic case facts, not a substitute model or a clinical recommendation. */
export function logicEngineBackup(c:RefillCase,role:Role,question:string,now=Date.now()){
 const wait=attention(c,now),next=nextAction(c);
 const verified=INPUTS.filter(i=>c.inputs[i.key].verified).map(i=>i.name);
 const missing=INPUTS.filter(i=>!c.inputs[i.key].verified).map(i=>i.name);
 const lines=[
  '[Offline Mode: Logic Engine Backup]',
  `${copilotNames[role]} — rule-based case summary, not an AI-generated answer.`,
  `Workflow: ${state(c)}. Current owner: ${roleNames[c.owner]}.`,
  `Queue priority: ${wait.needsAttention?'Needs Attention':wait.pending?'Within the demo waiting threshold':'No pending action'}. This is a simulation flag, not clinical urgency.`,
  waitingExplanation(c,now),
  `Next required action: ${next.label}${next.type?` — ${roleNames[next.role]} is responsible`:''}. ${next.why}`,
  `Redstone signal: ${signal(c)}/15; comparator threshold: 15. ${!wait.pending?'This case has no pending workflow action.':c.hold?'The clinical hold blocks routing regardless of signal.':gateOpen(c)?'All five inputs pass the routing gate. Routing is not fulfillment.':'The routing gate remains blocked until every required input is verified.'}`,
 ];
 if(role==='staff')lines.push(next.type?`Administrative next step: ${next.role==='staff'?next.label:`coordinate with ${roleNames[next.role]} for ${next.label.toLowerCase()}`}. Record only confirmed information; leave prescribing decisions with the clinician.`:'Administrative next step: communicate the recorded outcome using the existing patient-update preview.');
 if(role==='clinician')lines.push(`Verified: ${verified.join(', ')||'None'}. Missing: ${missing.join(', ')||'None'}.`,next.type&&next.role==='clinician'?'Clinician review is pending. Review the evidence and document your own decision. This backup cannot approve, decline, diagnose, or recommend a dose.':'No clinician decision is currently the next required action. Use the recorded workflow outcome and owner above.');
 if(role==='pharmacy'){
  const handoff={not_sent:'The prescription has not been routed to the pharmacy.',queued:'The handoff is queued; pharmacy receipt, preparation, and final checks still need confirmation.',failed:'The handoff failed; receipt has not been confirmed. Coordinate with the current owner.',acknowledged:'Pharmacy readiness is confirmed. Actual patient pickup or delivery still needs to be recorded.',dispensed:'Pharmacy has recorded actual pickup or delivery; fulfillment is confirmed.'};
  lines.push(`Pharmacy handoff: ${handoff[c.transport]}`,c.declined?'The clinician declined this refill; there is no active fulfillment action.':c.transport==='dispensed'?'Pickup is confirmed. Do not reopen this case because of its age.':'Pickup is not confirmed. A sent request, approval, or 15/15 signal cannot close this case.');
 }
 if(/\b(draft|message|update|note|documentation)\b/i.test(question))lines.push(role==='clinician'?`DRAFT review note: Current state ${state(c)}. Verified: ${verified.join(', ')||'None'}. Missing: ${missing.join(', ')||'None'}. Clinician assessment/decision: [complete after review]. Nothing has been signed or sent.`:`DRAFT patient update — human review required: ${patientText(c)} Nothing has been sent.`);
 lines.push('This backup summarizes the loaded workflow; it does not answer general medical questions or change the case.');
 return lines.join('\n\n');
}
