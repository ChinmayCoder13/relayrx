import { Clock3, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { attention, waitingExplanation, roleNames, nextAction } from '../domain/engine';
import type { RefillCase } from '../domain/engine';
export function countdown(ms:number){const s=Math.ceil(Math.max(0,ms)/1000);return `${Math.floor(s/60).toString().padStart(2,'0')}:${(s%60).toString().padStart(2,'0')}`;}
export default function WaitingTimer({c,now,compact=false}:{c:RefillCase;now:number;compact?:boolean}){
 const wait=attention(c,now);
 if(compact)return <span className={`case-wait ${wait.needsAttention?'expired':''}`} title={waitingExplanation(c,now)}>{!wait.pending?<><CheckCircle2 size={12}/>Timer stopped</>:wait.needsAttention?<><AlertTriangle size={12}/>Needs attention</>:<><Clock3 size={12}/>{countdown(wait.remainingMs)} left</>}</span>;
 return <div className={`waiting-banner ${wait.needsAttention?'expired':''}`} data-testid="case-attention" data-attention={String(wait.needsAttention)}>
  <div className="waiting-banner-title">{wait.needsAttention?<AlertTriangle size={18}/>:wait.pending?<Clock3 size={18}/>:<CheckCircle2 size={18}/>}<b>{wait.needsAttention?'Needs Attention':wait.pending?'Waiting for the next action':'No pending action'}</b><strong>{wait.pending?(wait.needsAttention?`${wait.simulatedHours.toFixed(1)}h simulated`:countdown(wait.remainingMs)):'Timer stopped'}</strong></div>
  <p>{wait.needsAttention?waitingExplanation(c,now):wait.pending?`${roleNames[c.owner]} · ${nextAction(c).label}. Complete this step before its timer expires.`:waitingExplanation(c,now)}</p>
  {wait.pending&&<small>3 minutes = 30 hours in this demo. Viewing a case does not complete its action.</small>}
 </div>;
}
