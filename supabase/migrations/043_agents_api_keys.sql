-- Issued, hashed API keys for the public per-agent invocation endpoint. A
-- bare agent id (the forms/sponsor-page pattern) is not a sufficient
-- credential here: a leaked agent id would let anyone run unbounded LLM
-- calls against the org's credit balance and probe its knowledge base
-- through a tool-armed agent — a materially bigger risk than spam into one
-- public form. The plaintext secret is generated and returned exactly once
-- by a service-role route (api/agents/[id]/api-keys/route.ts) — there is
-- deliberately NO insert policy for the authenticated role: if a member
-- could insert a row directly, they could pre-compute
-- key_hash = sha256("a secret they already know") and use that "known"
-- plaintext against the public API, defeating the point of a
-- server-generated random secret entirely.

create table agent_api_keys (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references agents (id) on delete cascade,
  organization_id uuid not null references organizations (id) on delete cascade,
  key_hash text not null unique,
  key_prefix text not null,
  created_by uuid references profiles (id),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

create index agent_api_keys_agent_id_idx on agent_api_keys (agent_id);

alter table agent_api_keys enable row level security;

-- Read-only for managers (app layer selects id/prefix/timestamps, never
-- key_hash, for display). Update is restricted at the app layer to only
-- ever set revoked_at.
create policy "managers read own organization agent api keys"
  on agent_api_keys for select
  using (is_member_of(organization_id) and can_manage_agents(organization_id));

create policy "managers revoke own organization agent api keys"
  on agent_api_keys for update
  using (is_member_of(organization_id) and can_manage_agents(organization_id))
  with check (is_member_of(organization_id) and can_manage_agents(organization_id));

-- Per-key daily call counter, same shape as increment_usage (011), scoped to
-- api_key_id instead of user_id since the caller is an anonymous external
-- system, not a Supabase session.
create table agent_api_daily_usage (
  api_key_id uuid not null references agent_api_keys (id) on delete cascade,
  day date not null default current_date,
  requests int not null default 0,
  primary key (api_key_id, day)
);

alter table agent_api_daily_usage enable row level security;

create policy "managers read own organization agent api usage"
  on agent_api_daily_usage for select
  using (
    exists (
      select 1 from agent_api_keys k
      where k.id = agent_api_daily_usage.api_key_id
        and is_member_of(k.organization_id)
        and can_manage_agents(k.organization_id)
    )
  );

-- Called only from the service-role public invoke route, after the route has
-- already validated the key hash — no authorization check needed here beyond
-- what the route already did.
create function increment_agent_api_usage(key_id uuid, daily_limit int)
returns int
language plpgsql security definer set search_path = public
as $$
declare
  current_count int;
begin
  insert into agent_api_daily_usage (api_key_id, day, requests)
  values (key_id, current_date, 1)
  on conflict (api_key_id, day)
  do update set requests = agent_api_daily_usage.requests + 1
  returning requests into current_count;

  if current_count > daily_limit then
    raise exception 'agent_api_daily_limit_exceeded' using errcode = 'P0001';
  end if;

  return current_count;
end;
$$;
