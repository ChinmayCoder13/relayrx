import { INPUTS, signal } from './engine.js';
import type { Evidence, InputKey, RefillCase } from './engine.js';
export const SCENARIOS = ['No refills remaining','Missing information','Visit required','Coverage issue','Clinical review'] as const;
export function createCase(patient:string,medication:string,reason:string,index=0,now=Date.now()):RefillCase {
 const stamp=new Date(now).toISOString();
 const inputs=Object.fromEntries(INPUTS.map(i=>[i.key,{verified:!['approval'].includes(i.key),note:i.key==='visit'?'Synthetic intake: no outstanding visit requirement recorded.':'Synthetic intake: information verified in sample record.',at:stamp,by:'Sample intake'}])) as Record<InputKey,Evidence>;
 inputs.approval={verified:false,note:'An authorized clinician must review this request.',at:null,by:''};
 if(reason==='Missing information')inputs.identity={verified:false,note:'Patient identifiers do not match. Staff verification required.',at:null,by:''};
 if(reason==='Visit required'||reason==='Clinical review')inputs.visit={verified:false,note:'A clinician must review the visit or follow-up requirement.',at:null,by:''};
 if(reason==='Coverage issue')inputs.coverage={verified:false,note:'The administrative requirement has not been resolved.',at:null,by:''};
 const c:RefillCase={id:`RX-${String(1042+index)}`,patient,initials:patient.split(' ').slice(0,2).map(s=>s[0]).join(''),medication,pharmacy:'Cedar Community Pharmacy',reason,createdAt:stamp,dueAt:new Date(now+24*3600000).toISOString(),owner:inputs.identity.verified?'clinician':'staff',inputs,hold:false,declined:false,transport:'not_sent',attempts:0,version:1,events:[],updates:[],resolvedAt:null,waitingSince:stamp};
 c.events=[{id:`intake-${c.id}`,at:stamp,type:'intake',actor:'Sample intake',role:'system',note:`Synthetic refill opened: ${reason.toLowerCase()}. Assigned to ${c.owner}.`,signal:signal(c)}];
 return c;
}
export function seedCases(now=Date.now()):RefillCase[]{
 const rows=[['Maya Bennett','Lisinopril','No refills remaining',29],['Oliver Chen','Metformin','Missing information',20],['Amara Wilson','Atorvastatin','Coverage issue',16],['Noah Patel','Amlodipine','Visit required',10],['Sofia Rivera','Levothyroxine','No refills remaining',7],['Ethan Brooks','Losartan','No refills remaining',32]] as const;
 return rows.map(([name,med,reason,age],i)=>{
  const c=createCase(name,med,reason,i,now-age*3600000);
  if(i===2||i===4||i===5)c.inputs.approval={verified:true,note:'Synthetic clinician authorization recorded for this exact request.',at:new Date(now-4*3600000).toISOString(),by:'Dr. Alex Morgan (demo)'};
  if(i===2||i===4)c.owner='staff';
  if(i===5){c.transport='dispensed';c.owner='pharmacy';c.attempts=1;c.resolvedAt=new Date(now-2*3600000).toISOString();c.events.unshift({id:'seed-resolution',type:'dispense',at:c.resolvedAt,actor:'Pharmacy (demo)',role:'pharmacy',note:'Synthetic pharmacy record confirms medication pickup.',signal:15});}
  c.waitingSince=c.transport==='dispensed'?null:new Date(now).toISOString();
  return c;
 });
}

export const SAMPLE_PATIENTS = ['Taylor Reed','Priya Nair','Lucas Ortiz','Hannah Kim','Marcus Bell','Elena Novak','Daniel Osei','Grace Holloway'] as const;
export const SAMPLE_MEDICATIONS = ['Sertraline','Omeprazole','Simvastatin','Hydrochlorothiazide','Montelukast','Gabapentin','Escitalopram','Pantoprazole'] as const;
/** Fictional patient/medication pair so intake needs no typing. Picks a different pair each call. */
export function sampleIntake(seed=Math.floor(Math.random()*1e6)){
 return {patient:SAMPLE_PATIENTS[seed%SAMPLE_PATIENTS.length],medication:SAMPLE_MEDICATIONS[(seed*3+1)%SAMPLE_MEDICATIONS.length]};
}
