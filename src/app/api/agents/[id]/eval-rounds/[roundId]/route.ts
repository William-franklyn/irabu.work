import { NextRequest, NextResponse } from "next/server";
import { requireAuthApi } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; roundId: string }> },
) {
  const auth = await requireAuthApi();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!auth.canManageAgents) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id, roundId } = await params;
  const supabase = await createClient();

  const { data: round, error } = await supabase
    .from("agent_eval_rounds")
    .select("id, status, total_cases, passed_cases, pass_rate, created_at, completed_at")
    .eq("id", roundId)
    .eq("agent_id", id)
    .eq("organization_id", auth.orgId)
    .single();
  if (error || !round) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: results } = await supabase
    .from("agent_eval_results")
    .select("id, case_id, agent_output, pass, judge_reason, tool_calls, agent_eval_cases(prompt, expected_criteria)")
    .eq("round_id", roundId)
    .order("created_at");

  return NextResponse.json({ round, results: results ?? [] });
}
