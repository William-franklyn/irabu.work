-- Eval harness: authored cases, executed rounds, per-case graded results.
-- All three are can_manage_agents-only in every direction — nothing here is
-- read by the teammate test link or the public API, so a single "for all"
-- policy per table is correct (nothing differs per command).

create table agent_eval_cases (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references agents (id) on delete cascade,
  organization_id uuid not null references organizations (id) on delete cascade,
  prompt text not null,
  expected_criteria text not null,
  position int not null default 0,
  created_at timestamptz not null default now()
);

create index agent_eval_cases_agent_id_idx on agent_eval_cases (agent_id, position);

alter table agent_eval_cases enable row level security;

create policy "managers manage own organization eval cases"
  on agent_eval_cases for all
  using (is_member_of(organization_id) and can_manage_agents(organization_id))
  with check (is_member_of(organization_id) and can_manage_agents(organization_id));

create table agent_eval_rounds (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references agents (id) on delete cascade,
  organization_id uuid not null references organizations (id) on delete cascade,
  triggered_by uuid references profiles (id),
  status text not null default 'running' check (status in ('running', 'completed', 'failed')),
  total_cases int not null default 0,
  passed_cases int not null default 0,
  pass_rate numeric,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index agent_eval_rounds_agent_id_idx on agent_eval_rounds (agent_id, created_at desc);

alter table agent_eval_rounds enable row level security;

create policy "managers manage own organization eval rounds"
  on agent_eval_rounds for all
  using (is_member_of(organization_id) and can_manage_agents(organization_id))
  with check (is_member_of(organization_id) and can_manage_agents(organization_id));

create table agent_eval_results (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references agent_eval_rounds (id) on delete cascade,
  case_id uuid not null references agent_eval_cases (id) on delete cascade,
  organization_id uuid not null references organizations (id) on delete cascade,
  agent_output text not null,
  pass boolean not null,
  judge_reason text not null,
  tool_calls jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index agent_eval_results_round_id_idx on agent_eval_results (round_id);

alter table agent_eval_results enable row level security;

create policy "managers manage own organization eval results"
  on agent_eval_results for all
  using (is_member_of(organization_id) and can_manage_agents(organization_id))
  with check (is_member_of(organization_id) and can_manage_agents(organization_id));
