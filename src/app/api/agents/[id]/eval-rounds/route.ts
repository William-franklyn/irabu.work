import { NextRequest, NextResponse } from "next/server";
import { requireAuthApi } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { runEvalRound } from "@/lib/agents/eval";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuthApi();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!auth.canManageAgents) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("agent_eval_rounds")
    .select("id, status, total_cases, passed_cases, pass_rate, created_at, completed_at")
    .eq("agent_id", id)
    .eq("organization_id", auth.orgId)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rounds: data ?? [] });
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuthApi();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!auth.canManageAgents) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const supabase = await createClient();

  const { data: agent, error: agentError } = await supabase
    .from("agents")
    .select("id, name, system_prompt, bias_instructions, enabled_tools")
    .eq("id", id)
    .eq("organization_id", auth.orgId)
    .single();
  if (agentError || !agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });

  const { data: cases } = await supabase
    .from("agent_eval_cases")
    .select("id, prompt, expected_criteria")
    .eq("agent_id", id)
    .order("position");

  if (!cases || cases.length === 0) {
    return NextResponse.json({ error: "Add at least one eval case before running a round" }, { status: 400 });
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  try {
    const result = await runEvalRound(
      { supabase, orgId: auth.orgId, userId: auth.userId, userEmail: user?.email ?? null },
      {
        id: agent.id,
        name: agent.name,
        systemPrompt: agent.system_prompt,
        biasInstructions: agent.bias_instructions,
        enabledTools: agent.enabled_tools,
      },
      cases,
    );
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
