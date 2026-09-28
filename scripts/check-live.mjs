import { createCase } from '../src/domain/seed.ts';
import { copilotKey } from '../src/domain/copilot.ts';

const root=new URL(process.env.RELAYRX_CHECK_URL||'https://relayrx-xi.vercel.app/');
if(!['https:','http:'].includes(root.protocol)||root.username||root.password)throw Error('Use an HTTP(S) deployment URL without credentials.');
const failures=[],degraded=[];
async function check(label,fn){
 const start=Date.now();
 try{await fn();console.log(`PASS ${label} (${Date.now()-start}ms)`);}
 catch(error){failures.push(label);console.error(`FAIL ${label}: ${error instanceof Error?error.message:'Unexpected response'}`);}
}
function requireThat(condition,message){if(!condition)throw Error(message);}
const get=(path,options={})=>fetch(new URL(path,root),{...options,signal:AbortSignal.timeout(30000)});
const assets=new Set();
await Promise.all(['/', '/workspace','/lab','/updates','/insights','/growth','/system'].map(path=>check(`page ${path}`,async()=>{
 const response=await get(path),html=await response.text();
 requireThat(response.status===200,`HTTP ${response.status}`);
 requireThat(html.includes('id="root"')&&html.includes('RelayRx'),'The application shell is missing.');
 for(const match of html.matchAll(/(?:src|href)="(\/assets\/[^"?#]+\.(?:js|css))"/g))assets.add(match[1]);
 requireThat(response.headers.get('x-content-type-options')==='nosniff','Expected security header is missing.');
})));
await check('JavaScript and styles',async()=>{
 requireThat(assets.size>=2,'Expected built assets were not found.');
 await Promise.all([...assets].map(async path=>{const response=await get(path);requireThat(response.status===200,`${path}: HTTP ${response.status}`);requireThat(!String(response.headers.get('content-type')).includes('text/html'),`${path} returned HTML instead of an asset.`);await response.body?.cancel();}));
});
await check('copilot function loads',async()=>{
 const response=await get('/api/copilot'),body=await response.json();
 requireThat(response.status===405&&body.error==='Use POST to ask the copilot.','Unexpected API response or serverless startup failure.');
 requireThat(response.headers.get('cache-control')?.includes('no-store'),'Copilot responses must not be cached.');
});

// Optional: three free built-in greetings and ONE synthetic Gemini request.
// No credentials, workspace writes, prescriptions, or patient messages are used.
if(process.argv.includes('--with-copilot')){
 for(const role of ['staff','clinician','pharmacy'])await check(`${role} greeting`,async()=>{
  const c=createCase('Synthetic health check','Example','No refills remaining');
  const response=await get('/api/copilot',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({case:c,role,question:'hi',snapshotKey:copilotKey(c,role),history:[]})}),body=await response.json();
  requireThat(response.status===200&&body.provider==='RelayRx'&&body.mode==='local'&&body.role===role&&body.text?.startsWith('Hi!'),'Greeting endpoint did not return the role-specific welcome.');
 });
 await check('Gemini / labeled backup',async()=>{
  const c=createCase('Synthetic health check','Example','No refills remaining'),snapshotKey=copilotKey(c,'staff');
  const response=await get('/api/copilot',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({case:c,role:'staff',question:'In one sentence, explain the blocker and next responsible role.',snapshotKey,history:[]})}),body=await response.json();
  requireThat(response.status===200&&body.snapshotKey===snapshotKey&&typeof body.text==='string'&&body.text.length>0,'Copilot did not return a current response.');
  requireThat(['Gemini','Logic Engine'].includes(body.provider),'Unexpected response source.');
  if(body.provider==='Logic Engine'){
   requireThat(body.mode==='offline'&&body.text.includes('[Offline Mode: Logic Engine Backup]'),'Backup response is not clearly labeled.');
   degraded.push(body.code||'GEMINI_UNAVAILABLE');console.warn(`DEGRADED Gemini: ${body.code||'GEMINI_UNAVAILABLE'}; logic backup is working.`);
  }
 });
}
console.log(JSON.stringify({checkedAt:new Date().toISOString(),origin:root.origin,failures,degraded}));
process.exitCode=failures.length?1:degraded.length?2:0;
