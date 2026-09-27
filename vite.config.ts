import { defineConfig, loadEnv } from 'vite';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import copilot from './api/copilot.js';
import workspace from './api/workspace.js';
import type { ApiRequest, ApiResponse } from './server/copilot.js';
// Vite-only server middleware. Secrets are never injected into the browser bundle.
function localApi():Plugin{return {name:'relayrx-local-api',configureServer(server){server.middlewares.use(async(req,res,next)=>{
 const path=req.url?.split('?')[0];if(!['/api/copilot','/api/workspace'].includes(path||''))return next();
 let raw='';try{for await(const chunk of req){raw+=chunk.toString();if(raw.length>30000){res.statusCode=413;res.end(JSON.stringify({error:'Request too large.'}));return;}}}
 catch{res.statusCode=400;res.end(JSON.stringify({error:'Request could not be read.'}));return;}
 const output:ApiResponse={status(n){res.statusCode=n;return output;},setHeader(k,v){res.setHeader(k,v);},json(v){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(v));}};
 await (path==='/api/copilot'?copilot:workspace)({method:req.method,headers:req.headers,body:raw||undefined} as ApiRequest,output);
});}};}
export default defineConfig(({mode})=>{
 const values=loadEnv(mode,process.cwd(),'');
 for(const name of ['GEMINI_API_KEY','GEMINI_MODEL','DEMO_COPILOT_ENABLED','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','VITE_DATA_MODE'])if(values[name])process.env[name]=values[name];
 return {plugins:[react(),localApi()],server:{host:'0.0.0.0',port:4173,strictPort:true,allowedHosts:['terminal.local']}};
});
