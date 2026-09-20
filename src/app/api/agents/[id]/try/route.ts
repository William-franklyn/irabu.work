import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuthApi } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { runAgentOnce } from "@/lib/agents/runtime";

const bodySchema = z.object({ input: z.string().min(1).max(4000) });

// Any org member may try a PUBLISHED agent — unlike the builder routes,
// this deliberately does not require canManageAgents, so a teammate who
// received a shared link can use it without Agents Lab access themselves.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuthApi();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const { id } = await params;
  const supabase = await createClient();

  const { data: agent } = await supabase
    .from("agents")
    .select("id, name, system_prompt, bias_instructions, enabled_tools, status")
    .eq("id", id)
    .eq("organization_id", auth.orgId)
    .maybeSingle();
  if (!agent || agent.status !== "published") {
    return NextResponse.json({ error: "This agent isn't available" }, { status: 404 });
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const result = await runAgentOnce(
    { supabase, orgId: auth.orgId, userId: auth.userId, userEmail: user?.email ?? null },
    {
      id: agent.id,
      name: agent.name,
      systemPrompt: agent.system_prompt,
      biasInstructions: agent.bias_instructions,
      enabledTools: agent.enabled_tools,
    },
    parsed.data.input,
  );

  return NextResponse.json({ output: result.text });
}
