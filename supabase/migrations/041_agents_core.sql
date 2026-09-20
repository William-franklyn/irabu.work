-- Agents Lab: named custom AI agents with a persona, a subset of the main
-- assistant's tools, and weighted knowledge sources. Access to the whole
-- Agents Lab area is a new permission orthogonal to owner/admin/member —
-- copies the exact shape of sensitive_access_approved (026/034/036): a
-- boolean on memberships, a security-definer helper scoped via auth.uid(),
-- and a trigger blocking a member from granting it to themselves directly.

alter table memberships add column if not exists can_manage_agents boolean not null default false;

create function can_manage_agents(org uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    (select m.can_manage_agents from memberships m
     where m.organization_id = org and m.user_id = auth.uid()),
    false
  )
$$;

-- Mirrors protect_membership_approval (034/036) exactly, as its own trigger
-- rather than folding into that one — this is an orthogonal grant on the same
-- table, and touching the already-twice-fixed sensitive-access trigger to
-- generalize it is a needless risk for this feature to take on.
create function protect_agents_permission()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.can_manage_agents is distinct from old.can_manage_agents
     and auth.uid() is not null then
    if not exists (
      select 1 from memberships
      where user_id = auth.uid()
        and organization_id = new.organization_id
        and role in ('owner', 'admin')
    ) then
      raise exception 'Only an owner or admin of this organization can change can_manage_agents';
    end if;
  end if;
  return new;
end;
$$;

create trigger protect_agents_permission
before update on memberships
for each row execute function protect_agents_permission();

create table agents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  created_by uuid references profiles (id),
  name text not null,
  description text,
  system_prompt text not null default '',
  bias_instructions text,
  enabled_tools text[] not null default '{}',
  status text not null default 'draft' check (status in ('draft', 'testing', 'published', 'archived')),
  visible_in_assistant boolean not null default false,
  -- Bumped by trigger whenever prompt/tools/knowledge-weights change, so the
  -- publish gate (043) can tell "eval round passed" from "eval round passed
  -- against a config that no longer exists."
  config_updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index agents_organization_id_idx on agents (organization_id, created_at desc);

alter table agents enable row level security;

-- Split per-command (per the 014 convention: a single "for all" would OR
-- together with a narrower policy and defeat it) because reads need to be
-- broader than writes: any org member may read a PUBLISHED agent (that's
-- what makes the teammate test link and the main-chat toggle work without
-- requiring can_manage_agents), but only a can_manage_agents member may read
-- a draft/testing agent or mutate anything.
create policy "members read published or manageable agents"
  on agents for select
  using (is_member_of(organization_id) and (status = 'published' or can_manage_agents(organization_id)));

create policy "managers insert agents"
  on agents for insert
  with check (is_member_of(organization_id) and can_manage_agents(organization_id));

create policy "managers update agents"
  on agents for update
  using (is_member_of(organization_id) and can_manage_agents(organization_id))
  with check (is_member_of(organization_id) and can_manage_agents(organization_id));

create policy "managers delete agents"
  on agents for delete
  using (is_member_of(organization_id) and can_manage_agents(organization_id));

create function touch_agent_config()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if TG_TABLE_NAME = 'agents' then
    new.config_updated_at = now();
    new.updated_at = now();
    return new;
  else
    update agents set config_updated_at = now(), updated_at = now()
      where id = coalesce(new.agent_id, old.agent_id);
    return coalesce(new, old);
  end if;
end;
$$;

create trigger touch_agent_config_on_agents
before update of system_prompt, bias_instructions, enabled_tools on agents
for each row execute function touch_agent_config();

create table agent_knowledge_sources (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references agents (id) on delete cascade,
  source_id uuid not null references knowledge_sources (id) on delete cascade,
  organization_id uuid not null references organizations (id) on delete cascade,
  weight numeric not null default 1.0 check (weight >= 0 and weight <= 5),
  created_at timestamptz not null default now(),
  unique (agent_id, source_id)
);

create index agent_knowledge_sources_agent_id_idx on agent_knowledge_sources (agent_id);

alter table agent_knowledge_sources enable row level security;

create policy "managers manage own organization agent knowledge sources"
  on agent_knowledge_sources for all
  using (is_member_of(organization_id) and can_manage_agents(organization_id))
  with check (is_member_of(organization_id) and can_manage_agents(organization_id));

-- Attaching/reweighting a source is a config change for freshness purposes
-- (see 043's publish guard) exactly like editing the system prompt is.
create trigger touch_agent_config_on_knowledge
after insert or update or delete on agent_knowledge_sources
for each row execute function touch_agent_config();
