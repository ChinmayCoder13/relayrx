import { Check, LockKeyhole, Zap, ArrowRight, ShieldCheck } from 'lucide-react';
import { INPUTS, signal, gateOpen } from '../domain/engine';
import type { RefillCase, InputKey } from '../domain/engine';
export function Signal({value,small=false}:{value:number;small?:boolean}){
 return <span className={`signal-meter ${small?'small':''}`} role="img" aria-label={`Readiness signal ${value} of 15`}><span className="signal-bars">{Array.from({length:15},(_,i)=><i key={i} className={i<value?'on':''}/>)}</span><b>{value}<span>/15</span></b></span>;
}
export default function Circuit({c,onInput}:{c:RefillCase;onInput?:(key:InputKey)=>void}){
 const open=gateOpen(c);
 return <div className={`circuit-board ${open?'powered':''}`}>
  <div className="circuit-caption"><span><Zap size={15}/> REFILL CIRCUIT</span><span className="mono">5 inputs · threshold 15</span></div>
  <div className="circuit-inputs">{INPUTS.map(i=><button key={i.key} onClick={()=>onInput?.(i.key)} className={`circuit-input ${c.inputs[i.key].verified?'verified':''}`} title={`${i.name}: ${c.inputs[i.key].note}`}><span className="input-top"><span className="input-port">{c.inputs[i.key].verified?<Check size={13}/>:<span/>}</span><b>+{c.inputs[i.key].verified?3:0}</b></span><span>{i.short}</span><small>{c.inputs[i.key].verified?'Verified':'Missing'}</small></button>)}</div>
  <div className="circuit-bus"><i/><i/><i/><i/><i/></div>
  <div className="circuit-output"><div className="readiness"><span>Readiness signal</span><Signal value={signal(c)}/></div><div className="wire"/><div className={`comparator ${open?'active':''}`}><span className="comparator-symbol">▷</span><div><b>Comparator</b><small>{signal(c)} ≥ 15 {open?'· PASS':'· WAIT'}</small></div></div><div className="wire"/><div className={`output-lamp ${open?'lit':''}`}>{open?<ShieldCheck size={20}/>:<LockKeyhole size={19}/>}<span>{c.hold?'HOLD':open?'OPEN':'LOCKED'}</span></div></div>
  <div className="circuit-foot"><span className={open?'green':'muted'}>{open?<><Check size={13}/> All requirements met</>:<><LockKeyhole size={13}/> {c.hold?'Clinician hold overrides every signal':'Every requirement must pass'}</>}</span><span>Authorization stays human <ArrowRight size={12}/></span></div>
 </div>;
}
