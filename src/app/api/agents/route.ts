import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuthApi } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { logActivity } from "@/lib/activity";

export async function GET() {
  const auth = await requireAuthApi();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!auth.canManageAgents) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const supabase = await createClient();
  const [{ data: agents, error }, { data: rounds }] = await Promise.all([
    supabase
      .from("agents")
      .select("id, name, status, created_at")
      .eq("organization_id", auth.orgId)
      .order("created_at", { ascending: false }),
    supabase
      .from("agent_eval_rounds")
      .select("agent_id, pass_rate, created_at")
      .eq("organization_id", auth.orgId)
      .eq("status", "completed")
      .order("created_at", { ascending: false }),
  ]);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const latestPassRate = new Map<string, number | null>();
  for (const r of rounds ?? []) {
    if (!latestPassRate.has(r.agent_id)) latestPassRate.set(r.agent_id, r.pass_rate);
  }

  return NextResponse.json({
    agents: (agents ?? []).map((a) => ({ ...a, lastPassRate: latestPassRate.get(a.id) ?? null })),
  });
}

const createSchema = z.object({
  name: z.string().min(1).max(200).default("Untitled agent"),
});

export async function POST(req: NextRequest) {
  const auth = await requireAuthApi();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!auth.canManageAgents) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = createSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("agents")
    .insert({
      organization_id: auth.orgId,
      created_by: auth.userId,
      name: parsed.data.name,
    })
    .select("id")
    .single();

  if (error || !data) return NextResponse.json({ error: "Could not create agent" }, { status: 500 });

  await logActivity(supabase, {
    organizationId: auth.orgId,
    actorId: auth.userId,
    action: "created_agent",
    detail: `Created agent: ${parsed.data.name}`,
  });

  return NextResponse.json({ id: data.id }, { status: 201 });
}
