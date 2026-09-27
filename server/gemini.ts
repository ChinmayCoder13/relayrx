export const DEFAULT_GEMINI_MODEL='gemini-3.5-flash-lite';
export class GeminiFailure extends Error{
 constructor(public code:string,message:string,public retryable=false,public upstreamStatus?:number){super(message);this.name='GeminiFailure';}
}
type GeminiOptions={model:string;key:string;payload:unknown;signal:AbortSignal;fetcher:typeof fetch;sleep?:(ms:number)=>Promise<void>;timeoutMs?:number};
/** One bounded retry for service/network failures. Quota and configuration errors return immediately. */
export async function generateGemini({model,key,payload,signal,fetcher,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),timeoutMs=9000}:GeminiOptions){
 for(let attempt=0;attempt<2;attempt++){
  try{
   signal.throwIfAborted();
   const response=await fetcher(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,{
    method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':key},
    signal:AbortSignal.any([signal,AbortSignal.timeout(timeoutMs)]),body:JSON.stringify(payload),
   });
   if(!response.ok){
    // Do not put raw upstream payloads, prompts, or credentials into errors/logs.
    await response.body?.cancel();
    if(response.status===429)throw new GeminiFailure('GEMINI_RATE_LIMITED','Gemini quota or rate limit reached (HTTP 429). Check the project quota or try again later.',false,429);
    if([400,401,403].includes(response.status))throw new GeminiFailure('GEMINI_CONFIGURATION','Gemini rejected the server configuration. Check GEMINI_API_KEY, API restrictions, project access, and GEMINI_MODEL.',false,response.status);
    if(response.status===404)throw new GeminiFailure('GEMINI_MODEL_UNAVAILABLE','The configured Gemini model is unavailable. Check GEMINI_MODEL in Vercel.',false,404);
    throw new GeminiFailure('GEMINI_UNAVAILABLE',`Gemini service returned HTTP ${response.status}.`,[408,500,502,503,504].includes(response.status),response.status);
   }
   const result=await response.json();
   const candidate=result.candidates?.[0];
   if(candidate?.finishReason&&candidate.finishReason!=='STOP')throw new GeminiFailure('GEMINI_INCOMPLETE','Gemini did not return a complete answer.');
   const text=(candidate?.content?.parts||[]).filter((p:{thought?:boolean;text?:string})=>!p.thought&&typeof p.text==='string').map((p:{text:string})=>p.text).join('\n').trim();
   if(!text||text.length>12000)throw new GeminiFailure('GEMINI_EMPTY','Gemini returned no usable answer.');
   return text;
  }catch(raw){
   const timedOut=raw instanceof Error&&['TimeoutError','AbortError'].includes(raw.name);
   const error=raw instanceof GeminiFailure?raw:new GeminiFailure(timedOut?'GEMINI_TIMEOUT':'GEMINI_NETWORK',timedOut?'Gemini exceeded its response time budget.':'The Gemini network request failed.',true);
   if(attempt===0&&error.retryable&&!signal.aborted){await sleep(450);continue;}
   throw error;
  }
 }
 throw new GeminiFailure('GEMINI_UNAVAILABLE','Gemini is unavailable.');
}
