-- Run once in a NEW Supabase sandbox. Only synthetic data is supported.
begin;
create table public.rr_tenants (
 id uuid primary key default gen_random_uuid(), name text not null check(length(name) between 2 and 100)
);
create table public.rr_memberships (
 user_id uuid primary key references auth.users(id) on delete cascade,
 tenant_id uuid not null references public.rr_tenants(id),
 role text not null check (role in ('staff','clinician','pharmacy')),
 display_name text not null check(length(display_name) between 2 and 100)
);
create index rr_memberships_tenant on public.rr_memberships(tenant_id);
create table public.rr_cases (
 tenant_id uuid not null references public.rr_tenants(id), id text not null,
 version integer not null check(version > 0), payload jsonb not null,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 primary key(tenant_id,id),
 check(jsonb_typeof(payload)='object'),check(payload->>'id'=id),check((payload->>'version')::integer=version)
);
create table public.rr_audit (
 tenant_id uuid not null, case_id text not null, request_id text not null,
 request_hash text not null, event jsonb not null, created_at timestamptz not null default now(),
 primary key(tenant_id,request_id),
 foreign key(tenant_id,case_id) references public.rr_cases(tenant_id,id)
);
create index rr_audit_case on public.rr_audit(tenant_id,case_id,created_at);
alter table public.rr_tenants enable row level security;
alter table public.rr_memberships enable row level security;
alter table public.rr_cases enable row level security;
alter table public.rr_audit enable row level security;
-- Membership is provisioned by an administrator, never by a browser.
create policy rr_member_self on public.rr_memberships for select to authenticated using(user_id=(select auth.uid()));
create policy rr_tenant_read on public.rr_tenants for select to authenticated using(exists(select 1 from public.rr_memberships m where m.user_id=(select auth.uid()) and m.tenant_id=id));
create policy rr_case_read on public.rr_cases for select to authenticated using(exists(select 1 from public.rr_memberships m where m.user_id=(select auth.uid()) and m.tenant_id=rr_cases.tenant_id));
create policy rr_audit_read on public.rr_audit for select to authenticated using(exists(select 1 from public.rr_memberships m where m.user_id=(select auth.uid()) and m.tenant_id=rr_audit.tenant_id));
revoke all on public.rr_tenants,public.rr_memberships,public.rr_cases,public.rr_audit from anon,authenticated;
grant select on public.rr_tenants,public.rr_memberships,public.rr_cases,public.rr_audit to authenticated;
grant all on public.rr_tenants,public.rr_memberships,public.rr_cases,public.rr_audit to service_role;
-- Atomic state + audit write. Not exposed to the authenticated browser role.
create function public.rr_commit(p_tenant uuid,p_case text,p_expected integer,p_payload jsonb,p_event jsonb,p_request text,p_hash text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare prior public.rr_audit%rowtype; current_version integer; output jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_tenant::text||':'||p_request,0));
 select * into prior from public.rr_audit where tenant_id=p_tenant and request_id=p_request;
 if found then
  if prior.request_hash<>p_hash or prior.case_id<>p_case then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
  select payload into output from public.rr_cases where tenant_id=p_tenant and id=p_case;
  return output;
 end if;
 if p_expected=0 then
  if (p_payload->>'version')::integer<>1 then raise exception 'VERSION_CONFLICT'; end if;
  insert into public.rr_cases(tenant_id,id,version,payload) values(p_tenant,p_case,1,p_payload);
 else
  select version into current_version from public.rr_cases where tenant_id=p_tenant and id=p_case for update;
  if current_version is null or current_version<>p_expected or (p_payload->>'version')::integer<>p_expected+1 then raise exception 'VERSION_CONFLICT'; end if;
  update public.rr_cases set payload=p_payload,version=p_expected+1,updated_at=now() where tenant_id=p_tenant and id=p_case;
 end if;
 insert into public.rr_audit(tenant_id,case_id,request_id,request_hash,event) values(p_tenant,p_case,p_request,p_hash,p_event);
 return p_payload;
end;
$$;
revoke all on function public.rr_commit(uuid,text,integer,jsonb,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.rr_commit(uuid,text,integer,jsonb,jsonb,text,text) to service_role;
commit;
