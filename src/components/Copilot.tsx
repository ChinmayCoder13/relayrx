import { useEffect, useRef, useState } from 'react';
import type { FormEvent, PointerEvent, KeyboardEvent } from 'react';
import { Sparkles, X, Send, LockKeyhole, Grip, ArrowUpRight, Copy, LoaderCircle, AlertTriangle } from 'lucide-react';
import type { RefillCase, Role } from '../domain/engine';
import { attention, nextAction, roleNames, state, waitingExplanation } from '../domain/engine';
import { copilotKey, copilotNames } from '../domain/copilot';
import { askCopilot, CopilotError } from '../lib/copilotClient';
import type { ChatTurn } from '../lib/copilotClient';
import type { SimulationTimer } from '../domain/simulation';
type Point={x:number;y:number};
const suggestions:Record<Role,string[]>={
 staff:['Why is this case blocked?','Why does it need attention?','Draft an update for the patient.'],
 clinician:['Summarize this case for review.','What is verified and what is missing?','Draft a review note with decision placeholders.'],
 pharmacy:['Explain this pharmacy handoff.','What remains to be verified?','Why is pickup not confirmed?']
};
const clamp=(p:Point)=>({x:Math.max(12,Math.min(window.innerWidth-68,p.x)),y:Math.max(12,Math.min(window.innerHeight-68,p.y))});
function startingPosition(){try{const saved=JSON.parse(sessionStorage.getItem('relayrx-copilot-position')||'null');if(saved&&Number.isFinite(saved.x)&&Number.isFinite(saved.y))return clamp(saved);}catch{/* Position is only a preference. */}return clamp({x:window.innerWidth-80,y:window.innerHeight-80});}
export default function Copilot({c,sourceCase,simulationTimer,role,now,onRoleChange,onRefresh}:{c?:RefillCase;sourceCase?:RefillCase;simulationTimer?:SimulationTimer;role:Role;now:number;onRoleChange?:(role:Role)=>void;onRefresh:()=>void}){
 const [open,setOpen]=useState(false),[position,setPosition]=useState(startingPosition),[viewport,setViewport]=useState({w:window.innerWidth,h:window.innerHeight});
 const [threads,setThreads]=useState<Record<string,ChatTurn[]>>({}),[question,setQuestion]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[copied,setCopied]=useState(false);
 const key=c?copilotKey(c,role,now):'',thread=`${c?.id}:${role}`,messages=threads[thread]||[],currentMessages=messages.filter(m=>m.snapshotKey===key);
 const latestAnswer=[...currentMessages].reverse().find(m=>m.role==='assistant'),lastQuestion=[...currentMessages].reverse().find(m=>m.role==='user')?.text;
 const offline=latestAnswer?.provider==='Logic Engine';
 const latest=useRef(key),request=useRef<AbortController|null>(null),launcher=useRef<HTMLButtonElement>(null),input=useRef<HTMLTextAreaElement>(null),scroll=useRef<HTMLDivElement>(null);
 const drag=useRef<{origin:Point;start:Point;moved:boolean}|null>(null),suppressClick=useRef(false);
 latest.current=key;
 useEffect(()=>{request.current?.abort();request.current=null;setBusy(false);setError('');setQuestion('');setCopied(false);return()=>{request.current?.abort();};},[key]);
 useEffect(()=>{const resize=()=>{setViewport({w:window.innerWidth,h:window.innerHeight});setPosition(p=>clamp(p));};window.addEventListener('resize',resize);return()=>window.removeEventListener('resize',resize);},[]);
 useEffect(()=>{try{sessionStorage.setItem('relayrx-copilot-position',JSON.stringify(position));}catch{/* Dragging still works without storage. */}},[position]);
 useEffect(()=>{if(open)input.current?.focus();},[open]);
 useEffect(()=>{scroll.current?.scrollTo({top:scroll.current.scrollHeight,behavior:'smooth'});},[messages.length,busy,error,key]);
 function close(){setOpen(false);launcher.current?.focus();}
 function pointerDown(e:PointerEvent<HTMLButtonElement>){if(e.button!==0)return;suppressClick.current=false;drag.current={origin:position,start:{x:e.clientX,y:e.clientY},moved:false};e.currentTarget.setPointerCapture(e.pointerId);}
 function pointerMove(e:PointerEvent<HTMLButtonElement>){const d=drag.current;if(!d)return;const dx=e.clientX-d.start.x,dy=e.clientY-d.start.y;if(Math.abs(dx)+Math.abs(dy)>5)d.moved=true;if(d.moved)setPosition(clamp({x:d.origin.x+dx,y:d.origin.y+dy}));}
 function pointerEnd(e:PointerEvent<HTMLButtonElement>){suppressClick.current=!!drag.current?.moved;drag.current=null;if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);}
 function moveKeys(e:KeyboardEvent<HTMLButtonElement>){const changes:Record<string,Point>={ArrowLeft:{x:-24,y:0},ArrowRight:{x:24,y:0},ArrowUp:{x:0,y:-24},ArrowDown:{x:0,y:24}};if(e.key==='Home'){e.preventDefault();setPosition(clamp({x:window.innerWidth-80,y:window.innerHeight-80}));}else if(changes[e.key]){e.preventDefault();setPosition(p=>clamp({x:p.x+changes[e.key].x,y:p.y+changes[e.key].y}));}}
 async function ask(value:string){
  const q=value.trim();if(!c||busy||q.length<2)return;
  const targetThread=thread,snapshot=key,controller=new AbortController();request.current=controller;setBusy(true);setError('');setQuestion('');setCopied(false);
  const user:ChatTurn={role:'user',text:q,snapshotKey:snapshot};
  setThreads(prev=>({...prev,[targetThread]:[...(prev[targetThread]||[]),user].slice(-30)}));
  try{const answer=await askCopilot(sourceCase||c,role,q,messages,snapshot,controller.signal,simulationTimer,now);
   if(controller.signal.aborted||latest.current!==snapshot||answer.snapshotKey!==snapshot)return;
   setThreads(prev=>({...prev,[targetThread]:[...(prev[targetThread]||[]),{role:'assistant' as const,text:answer.text,snapshotKey:snapshot,provider:answer.provider,notice:answer.notice}].slice(-30)}));
  }catch(e){if(controller.signal.aborted||latest.current!==snapshot)return;setError(e instanceof Error?e.message:'Could not contact Gemini. Please try again.');if(e instanceof CopilotError&&e.status===409)onRefresh();}
  finally{if(request.current===controller){request.current=null;setBusy(false);}}
 }
 function submit(e:FormEvent){e.preventDefault();void ask(question);}
 const wait=c?attention(c,now):null,panelWidth=Math.min(408,viewport.w-24),panelHeight=Math.min(660,viewport.h-96);
 const prompts=wait?.pending?suggestions[role]:['Summarize the final case outcome.','What evidence supports this outcome?','Draft an update explaining the recorded outcome.'];
 const panelLeft=Math.max(12,Math.min(viewport.w-panelWidth-12,position.x+56-panelWidth));
 const panelTop=Math.max(12,Math.min(viewport.h-panelHeight-80,position.y-panelHeight-12));
 return <>
  <button ref={launcher} className={`copilot-launcher ${open?'is-open':''}`} style={{left:position.x,top:position.y}} aria-label={open?'Close AI copilot':'Open AI copilot'} aria-expanded={open} aria-controls="relayrx-copilot" title="AI copilot · drag to move, or use arrow keys" onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerEnd} onPointerCancel={pointerEnd} onKeyDown={moveKeys} onClick={()=>{if(suppressClick.current){suppressClick.current=false;return;}if(open)close();else setOpen(true);}}><Sparkles size={24}/><span className="copilot-orbit">AI</span>{wait?.needsAttention&&<i className="copilot-attention-dot"/>}</button>
  {open&&<section id="relayrx-copilot" role="dialog" aria-modal="false" aria-labelledby="copilot-title" className="copilot-panel" style={{left:panelLeft,top:panelTop,width:panelWidth,maxHeight:panelHeight}} onKeyDown={e=>{if(e.key==='Escape'){e.stopPropagation();close();}}}>
   <header className="copilot-header"><span className="copilot-header-icon"><Sparkles size={20}/></span><div><h2 id="copilot-title">{copilotNames[role]}</h2><span>{offline?'Logic Engine Backup':latestAnswer?.provider==='RelayRx'?'RelayRx':'Gemini'} <i/> Read-only assistance</span></div><button className="icon-button" onClick={close} aria-label="Close copilot panel"><X size={18}/></button></header>
   {onRoleChange&&<div className="copilot-roles" aria-label="Demo copilot role">{(['staff','clinician','pharmacy'] as Role[]).map(r=><button key={r} className={r===role?'active':''} aria-pressed={r===role} onClick={()=>onRoleChange(r)}>{roleNames[r]}</button>)}</div>}
   <div className="copilot-scroll" ref={scroll}>
    {c?<><div className={`copilot-context ${wait?.needsAttention?'attention':''}`}><div><b>{c.id}</b><span>LIVE CASE STATE</span></div><h3>{state(c)}{wait?.needsAttention&&<span><AlertTriangle size={12}/>Needs Attention</span>}</h3><p>{waitingExplanation(c,now)}</p><dl><div><dt>Current owner</dt><dd>{roleNames[c.owner]}</dd></div><div><dt>Next action</dt><dd>{nextAction(c).label}</dd></div></dl><small>Verified workflow state · not an AI response</small></div>
     {messages.length>currentMessages.length&&<p className="copilot-changed" role="status">The case state changed. Earlier guidance is hidden; new questions use the current state.</p>}
     {!currentMessages.length&&<div className="copilot-intro"><p>{wait?.pending?'What would help move this refill forward?':'Review the recorded outcome.'}</p><div className="copilot-suggestions">{prompts.map(q=><button key={q} disabled={busy} onClick={()=>void ask(q)}>{q}<ArrowUpRight size={13}/></button>)}</div></div>}
     <div className="copilot-messages" aria-live="polite" aria-relevant="additions">{currentMessages.map((m,i)=><div className={`copilot-message ${m.role} ${m.provider==='Logic Engine'?'offline':''}`} key={`${key}-${i}`}><small>{m.role==='user'?'You':m.provider==='Logic Engine'?'Logic Engine Backup · not AI-generated':m.provider==='RelayRx'?'RelayRx · built-in welcome':'Gemini · review before using'}</small><p>{m.text}</p>{m.notice&&<small className="copilot-provider-notice">{m.notice}</small>}{m.role==='assistant'&&<button className="text-button" aria-label="Copy response" onClick={()=>void navigator.clipboard.writeText(m.text).then(()=>setCopied(true)).catch(()=>setError('Copy is unavailable in this browser. Select the text to copy it.'))}><Copy size={12}/>{copied?'Copied':'Copy'}</button>}</div>)}</div>
     {busy&&<div className="copilot-loading" role="status"><LoaderCircle size={16}/>Asking Gemini about this case…</div>}
     {offline&&!busy&&lastQuestion&&<button className="button copilot-retry" onClick={()=>void ask(lastQuestion)}>Try Gemini again</button>}
     {error&&<div className="copilot-error" role="alert">{error}</div>}
    </>:<p className="copilot-intro">Select or create a refill to use a role-specific copilot.</p>}
   </div>
   <form className="copilot-composer" onSubmit={submit}><label className="sr-only" htmlFor="copilot-question">Ask about the selected case</label><textarea ref={input} id="copilot-question" value={question} maxLength={1200} rows={2} placeholder="Ask about this refill…" disabled={!c} onChange={e=>setQuestion(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();void ask(question);}}}/><button className="copilot-send" type="submit" aria-label="Ask Gemini" disabled={!c||busy||question.trim().length<2}><Send size={17}/></button></form>
   <div className="copilot-footer"><LockKeyhole size={11}/><span>Humans decide and act. Synthetic data only.</span><Grip size={13}/></div>
  </section>}
 </>;
}
