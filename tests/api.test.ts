import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/workspace';
test('API fails closed when unconfigured and disallows unsupported methods',async()=>{
 const previous=process.env.SUPABASE_URL;delete process.env.SUPABASE_URL;
 let code=0,body:unknown;const headers:Record<string,string>={};
 const res={status(n:number){code=n;return this;},json(v:unknown){body=v;},setHeader(k:string,v:string){headers[k]=v;}};
 try{
  await handler({method:'GET',headers:{}},res);assert.equal(code,503);assert.match(JSON.stringify(body),/not configured/);assert.match(headers['Cache-Control'],/no-store/);
  await handler({method:'DELETE',headers:{}},res);assert.equal(code,405);
 }finally{if(previous!==undefined)process.env.SUPABASE_URL=previous;}
});
