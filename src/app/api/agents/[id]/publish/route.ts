import { NextRequest, NextResponse } from "next/server";
import { requireAuthApi } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { logActivity } from "@/lib/activity";

const PUBLISH_THRESHOLD = 0.9;

// Higher-stakes than the Forms status PATCH (publishing opens a public API),
// so this gets a real server-side gate instead of accepting an arbitrary
// status value: the agent's most recent COMPLETED eval round must both clear
// the pass-rate bar and be newer than the agent's config_updated_at
// (trigger-maintained — bumps on any prompt/tool/knowledge-weight change).
// Without the freshness check, an admin could pass eval, loosen a tool
// grant afterward, and publish on stale results.
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
    .select("id, status, config_updated_at")
    .eq("id", id)
    .eq("organization_id", auth.orgId)
    .single();
  if (agentError || !agent) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (agent.status !== "draft" && agent.status !== "testing") {
    return NextResponse.json({ error: `Agent is already ${agent.status}` }, { status: 400 });
  }

  const { data: latestRound } = await supabase
    .from("agent_eval_rounds")
    .select("pass_rate, created_at")
    .eq("agent_id", id)
    .eq("status", "completed")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!latestRound || latestRound.pass_rate === null) {
    return NextResponse.json({ error: "Run an eval round before publishing" }, { status: 400 });
  }
  if (latestRound.pass_rate < PUBLISH_THRESHOLD) {
    return NextResponse.json(
      { error: `Latest eval round passed ${Math.round(latestRound.pass_rate * 100)}% — needs ${Math.round(PUBLISH_THRESHOLD * 100)}%` },
      { status: 400 },
    );
  }
  if (new Date(latestRound.created_at) <= new Date(agent.config_updated_at)) {
    return NextResponse.json(
      { error: "Config changed since the last passing round — run a new eval round first" },
      { status: 400 },
    );
  }

  const { error } = await supabase.from("agents").update({ status: "published" }).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logActivity(supabase, {
    organizationId: auth.orgId,
    actorId: auth.userId,
    action: "published_agent",
    detail: "Published an agent",
  });

  return NextResponse.json({ ok: true });
}
