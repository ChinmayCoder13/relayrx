import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createCase } from '../src/domain/seed';
import { applyAction } from '../src/domain/engine';

test('Postgres schema enforces tenant isolation, write restrictions, CAS, and atomic audit',async()=>{
 const db=new PGlite();
 try{
  await db.exec(`create schema auth; create table auth.users(id uuid primary key);
   create role anon; create role authenticated; create role service_role bypassrls;
   grant usage on schema public,auth to anon,authenticated,service_role;
   create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;`);
  await db.exec(await readFile(new URL('../supabase/schema.sql',import.meta.url),'utf8'));
  const t1='00000000-0000-0000-0000-000000000001',t2='00000000-0000-0000-0000-000000000002';
  const u1='10000000-0000-0000-0000-000000000001',u2='10000000-0000-0000-0000-000000000002';
  await db.query('insert into auth.users values ($1),($2)',[u1,u2]);
  await db.query('insert into public.rr_tenants(id,name) values ($1,\'Practice One\'),($2,\'Practice Two\')',[t1,t2]);
  await db.query('insert into public.rr_memberships values ($1,$2,\'staff\',\'User One\'),($3,$4,\'clinician\',\'User Two\')',[u1,t1,u2,t2]);
  const c=createCase('Test Alias','Example medication','No refills remaining');
  await db.exec('set role service_role');
  const commit=(tenant:string,expected:number,payload:unknown,event:unknown,request:string,hash:string)=>db.query('select public.rr_commit($1,$2,$3,$4,$5,$6,$7) as result',[tenant,c.id,expected,JSON.stringify(payload),JSON.stringify(event),request,hash]);
  await commit(t1,0,c,c.events[0],'request-create','hash-create');
  await commit(t2,0,c,c.events[0],'request-create','hash-create');
  const changed=applyAction(c,{type:'approve',note:'Synthetic clinician verified this test record.',requestId:'request-approve',expectedVersion:1},'clinician','Test');
  await commit(t1,1,changed,changed.events[0],'request-approve','hash-approve');
  await commit(t1,1,changed,changed.events[0],'request-approve','hash-approve');
  await assert.rejects(()=>commit(t1,1,changed,changed.events[0],'request-conflict','hash-conflict'),/VERSION_CONFLICT/);
  await assert.rejects(()=>commit(t1,1,changed,changed.events[0],'request-approve','different-hash'),/IDEMPOTENCY_CONFLICT/);
  const count=await db.query<{count:number}>('select count(*)::int as count from public.rr_audit where tenant_id=$1',[t1]);assert.equal(count.rows[0].count,2);
  await db.exec('reset role; set role authenticated');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[u1]);
  const rows=await db.query<{tenant_id:string;version:number}>('select tenant_id,version from public.rr_cases');assert.equal(rows.rows.length,1);assert.equal(rows.rows[0].tenant_id,t1);assert.equal(rows.rows[0].version,2);
  const audits=await db.query('select * from public.rr_audit');assert.equal(audits.rows.length,2);
  await assert.rejects(()=>db.query('update public.rr_cases set version=99'),/permission denied/);
  await assert.rejects(()=>commit(t1,2,changed,changed.events[0],'browser-write','browser-hash'),/permission denied/);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[u2]);
  const other=await db.query<{version:number}>('select version from public.rr_cases');assert.equal(other.rows.length,1);assert.equal(other.rows[0].version,1);
  await db.exec('reset role; set role anon');await assert.rejects(()=>db.query('select * from public.rr_cases'),/permission denied/);
 }finally{await db.close();}
});
