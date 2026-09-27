export type Role = 'staff' | 'clinician' | 'pharmacy';
export type InputKey = 'identity' | 'prescription' | 'visit' | 'coverage' | 'approval';
export type ActionType = 'verify_identity' | 'verify_prescription' | 'clear_visit' | 'confirm_coverage' | 'approve' | 'hold' | 'release_hold' | 'decline' | 'dispatch' | 'retry' | 'acknowledge' | 'dispense' | 'request_info' | 'patient_update' | 'invalidate' | 'escalate';
export interface Evidence { verified: boolean; note: string; at: string | null; by: string; }
export interface AuditEvent { id:string; at:string; type:string; actor:string; role:Role | 'system'; note:string; signal:number; }
export interface PatientUpdate { id:string; at:string; text:string; delivery:'preview'; }
export interface RefillCase {
 id:string; patient:string; initials:string; medication:string; pharmacy:string; reason:string; createdAt:string; dueAt:string;
 owner:Role; inputs:Record<InputKey,Evidence>; hold:boolean; declined:boolean;
 transport:'not_sent'|'queued'|'failed'|'acknowledged'|'dispensed'; attempts:number; version:number;
 events:AuditEvent[]; updates:PatientUpdate[]; resolvedAt:string|null;
 /** Start of the current required action's wait, never a completion deadline. */
 waitingSince?:string|null;
}
export interface CaseAction { type:ActionType; note:string; requestId:string; expectedVersion:number; simulateFailure?:boolean; }
export const roleNames:Record<Role,string> = {staff:'Practice staff',clinician:'Clinician',pharmacy:'Pharmacy'};
export const INPUTS:{key:InputKey;name:string;short:string;role:Role;action:ActionType;label:string}[] = [
 {key:'identity',name:'Patient identity',short:'Identity',role:'staff',action:'verify_identity',label:'Verify identity'},
 {key:'prescription',name:'Prescription details',short:'Prescription',role:'staff',action:'verify_prescription',label:'Verify prescription'},
 {key:'visit',name:'Visit / review requirement',short:'Visit check',role:'clinician',action:'clear_visit',label:'Record visit decision'},
 {key:'coverage',name:'Coverage / administration',short:'Coverage',role:'staff',action:'confirm_coverage',label:'Confirm coverage'},
 {key:'approval',name:'Clinician authorization',short:'Approval',role:'clinician',action:'approve',label:'Record approval'}
];
export function comparator(rear:number,side:number,mode:'compare'|'subtract'='compare') {
 const a=Math.max(0,Math.min(15,Math.floor(rear))), b=Math.max(0,Math.min(15,Math.floor(side)));
 return mode==='compare'?(a>=b?a:0):Math.max(a-b,0);
}
export function signal(c:RefillCase) {return INPUTS.reduce((n,i)=>n+(c.inputs[i.key].verified?3:0),0);}
export function gateOpen(c:RefillCase) {return comparator(signal(c),15)>0 && INPUTS.every(i=>c.inputs[i.key].verified) && !c.hold && !c.declined;}
export function state(c:RefillCase):string {
 if(c.declined)return 'Declined';
 if(c.transport==='dispensed')return 'Resolved';
 if(c.hold)return 'Clinical hold';
 if(c.transport==='acknowledged')return 'Ready for pickup';
 if(c.transport==='failed')return 'Handoff failed';
 if(c.transport==='queued')return 'Awaiting pharmacy';
 if(!c.inputs.identity.verified || !c.inputs.prescription.verified)return 'Needs information';
 if(!c.inputs.visit.verified)return c.reason==='Clinical review'?'Review required':'Visit required';
 if(!c.inputs.approval.verified)return 'Awaiting clinician';
 if(!c.inputs.coverage.verified)return 'Coverage blocked';
 return 'Ready to route';
}
export function nextAction(c:RefillCase):{type:ActionType|null;role:Role;label:string;why:string} {
 if(c.transport==='dispensed')return {type:null,role:'pharmacy',label:'Refill completed',why:'Pharmacy recorded medication pickup. The loop is closed.'};
 if(c.declined)return {type:null,role:'clinician',label:'Clinical decision recorded',why:'No refill will be sent. Staff should explain the clinician’s next step to the patient.'};
 if(c.hold)return {type:'release_hold',role:'clinician',label:'Review clinical hold',why:'An authorized clinician must resolve the hold before work can move forward.'};
 if(c.transport==='failed')return c.attempts>=3?{type:'escalate',role:'staff',label:'Escalate handoff',why:'Three attempts failed. Confirm with the pharmacy before attempting another handoff.'}:{type:'retry',role:'staff',label:'Retry pharmacy handoff',why:'No acknowledgment was received. The case stays open until the pharmacy confirms.'};
 if(c.transport==='queued')return {type:'acknowledge',role:'pharmacy',label:'Confirm ready for pickup',why:'The pharmacy must verify receipt, preparation, and final checks. Sending is not completion.'};
 if(c.transport==='acknowledged')return {type:'dispense',role:'pharmacy',label:'Confirm patient pickup',why:'Close the loop only after the pharmacy records dispensing or delivery.'};
 for(const key of ['identity','prescription','visit'] as InputKey[]) {
  if(!c.inputs[key].verified){const i=INPUTS.find(i=>i.key===key)!;return {type:i.action,role:i.role,label:i.label,why:`${i.name} is unverified. Capture evidence before the next handoff.`};}
 }
 if(!c.inputs.approval.verified)return {type:'approve',role:'clinician',label:'Review & record decision',why:'The existing prescription has no refill authorization. A clinician must decide whether to authorize it.'};
 if(!c.inputs.coverage.verified)return {type:'confirm_coverage',role:'staff',label:'Resolve coverage blocker',why:'Record a confirmed administrative resolution before routing.'};
 return {type:'dispatch',role:'staff',label:'Route to pharmacy',why:'All five requirements are verified. The workflow handoff is ready.'};
}
const permissions:Record<ActionType,Role[]> = {
 verify_identity:['staff','pharmacy'],verify_prescription:['staff','pharmacy'],clear_visit:['clinician'],confirm_coverage:['staff','pharmacy'],approve:['clinician'],
 hold:['clinician'],release_hold:['clinician'],decline:['clinician'],dispatch:['staff','pharmacy'],retry:['staff','pharmacy'],acknowledge:['pharmacy'],dispense:['pharmacy'],
 request_info:['staff','clinician','pharmacy'],patient_update:['staff','clinician','pharmacy'],invalidate:['staff','clinician','pharmacy'],escalate:['staff','pharmacy']
};
export const DEMO_WAIT_MS=3*60*1000;
export const SIMULATED_WAIT_HOURS=30;
export function pendingStep(c:RefillCase):string|null {
 const next=nextAction(c);
 return next.type===null?null:`${state(c)}:${next.type}`;
}
export function waitingSince(c:RefillCase):string|null {
 if(!pendingStep(c))return null;
 if(c.waitingSince && Number.isFinite(Date.parse(c.waitingSince)))return c.waitingSince;
 // Compatibility with connected records created before the timer existed.
 const progress=c.events.find(e=>!['patient_update','request_info','retry','escalate'].includes(e.type));
 return progress?.at||c.createdAt;
}
export function attention(c:RefillCase,now=Date.now()) {
 const since=waitingSince(c),pending=since!==null;
 const elapsedMs=pending?Math.max(0,now-Date.parse(since)):0;
 return {pending,since,elapsedMs,remainingMs:pending?Math.max(0,DEMO_WAIT_MS-elapsedMs):0,
  needsAttention:pending&&Number.isFinite(elapsedMs)&&elapsedMs>=DEMO_WAIT_MS,
  simulatedHours:elapsedMs/DEMO_WAIT_MS*SIMULATED_WAIT_HOURS};
}
export function needsAttention(c:RefillCase,now=Date.now()){return attention(c,now).needsAttention;}
export function waitingExplanation(c:RefillCase,now=Date.now()):string {
 const wait=attention(c,now),next=nextAction(c);
 if(!wait.pending)return c.declined?'This case was declined. There is no pending refill action, so the attention timer is stopped.':'This case is resolved after verified pickup or delivery. The attention timer is stopped.';
 if(wait.needsAttention)return `This case has been waiting for at least the 3-minute demo threshold (30 simulated hours) and has been marked Needs Attention. The current owner is ${roleNames[c.owner]}. The next action is ${next.label.toLowerCase()}. Its workflow state remains ${state(c)}.`;
 return `This case is waiting for ${next.label.toLowerCase()}. The current owner is ${roleNames[c.owner]}. It has not reached the 3-minute demo threshold. Its workflow state is ${state(c)}.`;
}
export function permitted(type:ActionType,role:Role){return permissions[type]?.includes(role)??false;}
export class WorkflowError extends Error {constructor(message:string,public status=422){super(message);}}
export function patientText(c:RefillCase):string {
 const status=state(c);
 if(status==='Resolved')return 'Your pharmacy has recorded your medication pickup or delivery. This refill request is complete.';
 if(status==='Ready for pickup')return 'Your pharmacy has confirmed your refill is ready for pickup. Please contact the pharmacy for collection details.';
 if(status==='Declined')return 'Your clinician has reviewed your request and has not authorized this refill. Please contact the practice for the next step.';
 if(status==='Clinical hold'||status==='Visit required'||status==='Review required')return 'Your care team needs to review your refill before it can proceed. The practice will help you with the next step.';
 if(status==='Awaiting pharmacy')return 'Your care team has prepared the pharmacy handoff. We are waiting for the pharmacy to confirm readiness; please wait for a pickup confirmation.';
 if(status==='Handoff failed')return 'Your team is following up with the pharmacy to confirm the refill handoff. Your refill is not yet confirmed ready for pickup.';
 if(status==='Needs information')return 'Your practice is checking the information needed to process your refill. A team member will contact you if anything is missing.';
 if(status==='Coverage blocked')return 'Your team is resolving an insurance or administrative question with the pharmacy. We will update you when there is a confirmed next step.';
 return 'Your refill request is with your care team. We will update you after the required review and pharmacy confirmation.';
}
export function applyAction(original:RefillCase,action:CaseAction,role:Role,actor:string,now=new Date().toISOString()):RefillCase {
 if(!permissions[action.type])throw new WorkflowError('Unknown action.');
 if(!permitted(action.type,role))throw new WorkflowError('This action requires a different authorized role.',403);
 if(!action.requestId||action.requestId.length>100)throw new WorkflowError('A valid request ID is required.');
 if(original.events.some(e=>e.id===action.requestId))return original;
 if(action.expectedVersion!==original.version)throw new WorkflowError('This refill changed. Refresh it before acting.',409);
 if(typeof action.note!=='string'||action.note.trim().length<8||action.note.length>1500)throw new WorkflowError('Add an evidence note of 8–1,500 characters.');
 if((original.declined||original.transport==='dispensed') && !['patient_update'].includes(action.type))throw new WorkflowError('This case is closed. Start a new request for additional work.');
 const c=structuredClone(original), a=action.type, note=action.note.trim();
 const verify=(key:InputKey)=>{c.inputs[key]={verified:true,note,at:now,by:actor};};
 const revoke=()=>{c.inputs.approval={verified:false,note:'Prior approval invalidated; a new clinician decision is required.',at:now,by:actor};};
 if(['verify_identity','verify_prescription','clear_visit','confirm_coverage','approve'].includes(a)) {
  if(c.transport!=='not_sent')throw new WorkflowError('A handoff already exists. Place a clinical hold and contact the pharmacy to reconcile changes.');
  if(c.hold)throw new WorkflowError('The clinician must resolve the hold first.');
  const key=INPUTS.find(i=>i.action===a)!.key;
  if(c.inputs[key].verified)throw new WorkflowError('This requirement is already verified.');
  if(a==='approve'&&(!c.inputs.identity.verified||!c.inputs.prescription.verified||!c.inputs.visit.verified))throw new WorkflowError('Identity, prescription details, and the visit requirement must be verified first.');
  if(['verify_identity','verify_prescription','clear_visit'].includes(a))revoke();
  verify(key);
 }
 if(a==='hold'){c.hold=true;revoke();c.owner='clinician';}
 if(a==='release_hold'){
  if(!c.hold)throw new WorkflowError('There is no active hold.');
  if(c.transport!=='not_sent')throw new WorkflowError('Contact the pharmacy and reconcile the existing handoff outside this prototype before releasing the hold.');
  c.hold=false;revoke();
 }
 if(a==='decline'){
  if(c.transport!=='not_sent')throw new WorkflowError('A pharmacy handoff exists. Place a hold and contact the pharmacy first.');
  c.declined=true;revoke();
 }
 if(a==='invalidate'){
  if(c.transport!=='not_sent')throw new WorkflowError('A handoff exists. A clinician must place a hold and contact the pharmacy.');
  c.inputs.identity={verified:false,note,at:now,by:actor};revoke();c.owner='staff';
 }
 if(a==='dispatch'||a==='retry'){
  if(!gateOpen(c))throw new WorkflowError('The comparator is locked. Verify all requirements and resolve every hold.');
  if(a==='dispatch'&&c.transport!=='not_sent')throw new WorkflowError('A handoff already exists. Do not create a duplicate.');
  if(a==='retry'&&(c.transport!=='failed'||c.attempts>=3))throw new WorkflowError('Retry unavailable. After three attempts, escalate for manual confirmation.');
  c.attempts++;c.transport=action.simulateFailure?'failed':'queued';c.owner=action.simulateFailure?'staff':'pharmacy';
 }
 if(a==='acknowledge'){
  if(!gateOpen(c)||!['queued','failed'].includes(c.transport))throw new WorkflowError('An unblocked handoff must exist before pharmacy confirmation.');
  c.transport='acknowledged';c.owner='pharmacy';
 }
 if(a==='dispense'){
  if(!gateOpen(c)||c.transport!=='acknowledged')throw new WorkflowError('Pharmacy readiness must be confirmed, with no clinical hold, before pickup can be recorded.');
  c.transport='dispensed';c.resolvedAt=now;
 }
 if(a==='escalate'){
  if(c.transport!=='failed')throw new WorkflowError('There is no failed handoff to escalate.');
  c.owner='staff';
 }
 if(a==='request_info')c.owner='staff';
 if(a==='patient_update')c.updates.unshift({id:action.requestId,at:now,text:patientText(c),delivery:'preview'});
 c.version++;
 if(c.transport==='not_sent'&&!c.declined)c.owner=nextAction(c).role;
 // Only moving to a new required step resets the clock. Views, drafts, notes,
 // unsuccessful retries and escalation cannot hide an unresolved wait.
 const noProgress=['patient_update','request_info','escalate'].includes(a)||(a==='retry'&&c.transport==='failed');
 c.waitingSince=pendingStep(c)===null?null:!noProgress&&pendingStep(c)!==pendingStep(original)?now:waitingSince(original);
 c.events.unshift({id:action.requestId,at:now,type:a,actor,role,note,signal:signal(c)});
 return c;
}
