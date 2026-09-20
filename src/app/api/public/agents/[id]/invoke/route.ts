import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { runAgentOnce } from "@/lib/agents/runtime";
import { logActivity } from "@/lib/activity";

const bodySchema = z.object({ input: z.string().min(1).max(4000) });

const DAILY_LIMIT = Number(process.env.AGENT_API_DAILY_LIMIT ?? 200);

function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

// The external HTTP API for a published agent. No Supabase session exists
// here, so — same reasoning as api/public/forms/[id]/route.ts — the
// service-role client is the entire security boundary, not RLS. Unlike
// forms' bare-UUID public route, the credential here is an issued, hashed
// API key: a leaked agent id would otherwise let anyone run unbounded LLM
// calls against the org's credit balance and probe its knowledge base
// through a tool-armed agent. Missing/invalid/revoked key all fail the same
// way (404, not 401/403) to avoid confirming whether a given agent exists.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authHeader = req.headers.get("authorization");
  const presentedKey = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;
  if (!presentedKey) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const { id } = await params;
  const admin = createAdminClient();

  const { data: apiKey } = await admin
    .from("agent_api_keys")
    .select("id, agent_id, organization_id, revoked_at")
    .eq("key_hash", hashKey(presentedKey))
    .maybeSingle();

  if (!apiKey || apiKey.agent_id !== id || apiKey.revoked_at) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data: agent } = await admin
    .from("agents")
    .select("id, name, created_by, system_prompt, bias_instructions, enabled_tools, status")
    .eq("id", id)
    .eq("organization_id", apiKey.organization_id)
    .maybeSingle();

  if (!agent || agent.status !== "published") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    await admin.rpc("increment_agent_api_usage", { key_id: apiKey.id, daily_limit: DAILY_LIMIT });
  } catch {
    return NextResponse.json({ error: "Daily request limit reached" }, { status: 429 });
  }

  await admin.from("agent_api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", apiKey.id);

  const result = await runAgentOnce(
    { supabase: admin, orgId: apiKey.organization_id, userId: agent.created_by, userEmail: null },
    {
      id: agent.id,
      name: agent.name,
      systemPrompt: agent.system_prompt,
      biasInstructions: agent.bias_instructions,
      enabledTools: agent.enabled_tools,
    },
    parsed.data.input,
  );

  await logActivity(admin, {
    organizationId: apiKey.organization_id,
    actorId: null,
    action: "agent_api_invoked",
    detail: `External API call to agent: ${agent.name}`,
  });

  return NextResponse.json({ output: result.text });
}
