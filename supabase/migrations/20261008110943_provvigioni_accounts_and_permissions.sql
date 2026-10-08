-- Separate access and data for Gestione Provvigioni; existing PW apps stay intact.
create schema if not exists private;

create table public.provvigioni_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users(id) on delete set null,
  username text not null unique check (username ~ '^[a-z0-9][a-z0-9._-]{2,59}$'),
  display_name text not null check (length(display_name) between 1 and 200),
  role text not null check (role in ('office','agent')),
  active boolean not null default true,
  is_test boolean not null default false,
  valid_after bigint not null default 0,
  created_at timestamptz not null default now()
);
create table public.provvigioni_practices (
  uid uuid primary key default gen_random_uuid(),
  code text not null check (length(btrim(code)) between 1 and 160),
  agent_id uuid references public.provvigioni_accounts(id),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  version bigint not null default 1,
  created_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
create unique index provvigioni_practices_code_unique on public.provvigioni_practices (lower(code));
create index provvigioni_practices_agent_idx on public.provvigioni_practices (agent_id);
create index provvigioni_practices_created_by_idx on public.provvigioni_practices (created_by);
create table public.provvigioni_rules (
  id integer primary key check (id = 1),
  document jsonb not null,
  version bigint not null default 1,
  updated_at timestamptz not null default now()
);
insert into public.provvigioni_rules (id, document) values (1,
  '{"discounts":[0,0.10,0.20,0.30,0.40],"A":[0.44,0.35,0.25,0.16,0.08],"B":[0.28,0.22,0.15,0.10,0.04],"extraHold":0.11}'::jsonb);

alter table public.provvigioni_accounts enable row level security;
alter table public.provvigioni_practices enable row level security;
alter table public.provvigioni_rules enable row level security;
revoke all on public.provvigioni_accounts, public.provvigioni_practices, public.provvigioni_rules from public, anon, authenticated;
grant select on public.provvigioni_accounts to authenticated;
grant select, insert, update, delete on public.provvigioni_practices to authenticated;
grant select, update on public.provvigioni_rules to authenticated;
grant all on public.provvigioni_accounts, public.provvigioni_practices, public.provvigioni_rules to service_role;

-- Private predicates read live accounts and sessions; roles cannot be edited by agents.
create function private.provvigioni_account_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select a.id from public.provvigioni_accounts a
  where (select auth.uid()) is not null and a.user_id = (select auth.uid()) and a.active
    and coalesce(((select auth.jwt())->>'iat')::bigint,0) >= a.valid_after
    and exists (select 1 from auth.sessions s
      where s.id = nullif((select auth.jwt())->>'session_id','')::uuid
        and s.user_id = (select auth.uid())
        and s.created_at >= to_timestamp(a.valid_after))
  limit 1;
$$;
create function private.provvigioni_is_office() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.provvigioni_accounts a
    where (select auth.uid()) is not null and a.id = (select private.provvigioni_account_id())
      and a.role = 'office' and a.active);
$$;
revoke all on function private.provvigioni_account_id(), private.provvigioni_is_office() from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.provvigioni_account_id(), private.provvigioni_is_office() to authenticated;

create policy provvigioni_accounts_read on public.provvigioni_accounts for select to authenticated
  using (id = (select private.provvigioni_account_id()) or (select private.provvigioni_is_office()));
create policy provvigioni_practices_read on public.provvigioni_practices for select to authenticated
  using ((select private.provvigioni_is_office()) or agent_id = (select private.provvigioni_account_id()));
create policy provvigioni_practices_insert on public.provvigioni_practices for insert to authenticated
  with check ((select private.provvigioni_account_id()) is not null
    and ((select private.provvigioni_is_office()) or agent_id = (select private.provvigioni_account_id())));
create policy provvigioni_practices_update on public.provvigioni_practices for update to authenticated
  using ((select private.provvigioni_is_office()) or agent_id = (select private.provvigioni_account_id()))
  with check ((select private.provvigioni_account_id()) is not null
    and ((select private.provvigioni_is_office()) or agent_id = (select private.provvigioni_account_id())));
create policy provvigioni_practices_delete on public.provvigioni_practices for delete to authenticated
  using ((select private.provvigioni_is_office()) or agent_id = (select private.provvigioni_account_id()));
create policy provvigioni_rules_read on public.provvigioni_rules for select to authenticated
  using ((select private.provvigioni_account_id()) is not null);
create policy provvigioni_rules_update on public.provvigioni_rules for update to authenticated
  using ((select private.provvigioni_is_office())) with check ((select private.provvigioni_is_office()));

create function private.provvigioni_validate_practice() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare agent_name text; c numeric; s numeric; d numeric;
begin
  if length(new.payload::text)>100000
    or coalesce(new.payload->>'id','') <> new.code
    or coalesce(new.payload->>'_uid','') <> new.uid::text
    or length(btrim(coalesce(new.payload->>'client',''))) not between 1 and 300
    or coalesce(new.payload->>'option','') not in ('A','B')
    or coalesce(new.payload->>'status','') not in ('Aperta','Chiusa','Annullata')
    or length(coalesce(new.payload->>'notes','')) > 20000
  then raise exception 'Dati pratica non validi' using errcode = '22023'; end if;
  c := nullif(new.payload->>'close','')::numeric;
  s := coalesce(nullif(new.payload->>'services','')::numeric,0);
  d := nullif(new.payload->>'discount','')::numeric;
  if c is null or c<0 or c>1000000000000 or s<0 or s>c
    or (d is not null and (d<0 or d>100))
  then raise exception 'Importi o sconto non validi' using errcode = '22023'; end if;
  if new.agent_id is not null then
    select a.display_name into agent_name from public.provvigioni_accounts a
      where a.id=new.agent_id and a.role='agent';
    if agent_name is null then raise exception 'Agente non valido' using errcode='22023'; end if;
    new.payload := jsonb_set(new.payload,'{agent}',to_jsonb(agent_name));
  elsif length(btrim(coalesce(new.payload->>'agent',''))) = 0 then
    raise exception 'Inserisci un agente' using errcode='22023';
  end if;
  new.updated_at := now();
  if tg_op='INSERT' then new.created_by := auth.uid(); new.version := 1;
  else new.created_by := old.created_by; new.version := old.version+1; end if;
  return new;
end;
$$;
revoke all on function private.provvigioni_validate_practice() from public, anon, authenticated;
create trigger provvigioni_practice_validate before insert or update on public.provvigioni_practices
  for each row execute function private.provvigioni_validate_practice();

create function private.provvigioni_validate_rules() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare k text; n integer; val jsonb;
begin
  if jsonb_typeof(new.document) is distinct from 'object' or jsonb_typeof(new.document->'discounts') is distinct from 'array'
    or jsonb_typeof(new.document->'A') is distinct from 'array' or jsonb_typeof(new.document->'B') is distinct from 'array'
  then raise exception 'Tabella provvigioni non valida' using errcode='22023'; end if;
  n := jsonb_array_length(new.document->'discounts');
  if n<1 or n>50 or jsonb_array_length(new.document->'A')<>n or jsonb_array_length(new.document->'B')<>n
  then raise exception 'Tabella provvigioni non valida' using errcode='22023'; end if;
  foreach k in array array['discounts','A','B'] loop
    for val in select v from jsonb_array_elements(new.document->k) v loop
      if jsonb_typeof(val)<>'number' or val::text::numeric<0 or val::text::numeric>1
      then raise exception 'Percentuali non valide' using errcode='22023'; end if;
    end loop;
  end loop;
  new.version := old.version+1; new.updated_at := now(); return new;
end;
$$;
revoke all on function private.provvigioni_validate_rules() from public, anon, authenticated;
create trigger provvigioni_rules_validate before update on public.provvigioni_rules
  for each row execute function private.provvigioni_validate_rules();
