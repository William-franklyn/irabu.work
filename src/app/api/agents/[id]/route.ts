import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuthApi } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { TOOL_NAMES } from "@/lib/ai/tools";

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
    .from("agents")
    .select(
      "id, name, description, system_prompt, bias_instructions, enabled_tools, status, visible_in_assistant, config_updated_at, created_at",
    )
    .eq("id", id)
    .eq("organization_id", auth.orgId)
    .single();

  if (error || !data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ agent: data });
}

// Config edits only — status never moves through this route. Publishing,
// archiving and unarchiving are higher-stakes than a Forms-style status
// PATCH (publishing opens a public API), so each gets its own dedicated
// route with a real server-side guard instead of accepting an arbitrary
// status value here.
const patchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  systemPrompt: z.string().max(20000).optional(),
  biasInstructions: z.string().max(5000).nullable().optional(),
  enabledTools: z.array(z.enum(TOOL_NAMES)).optional(),
  visibleInAssistant: z.boolean().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuthApi();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!auth.canManageAgents) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = patchSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const { id } = await params;
  const supabase = await createClient();

  if (parsed.data.visibleInAssistant !== undefined) {
    const { data: agent } = await supabase
      .from("agents")
      .select("status")
      .eq("id", id)
      .eq("organization_id", auth.orgId)
      .maybeSingle();
    if (!agent) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (parsed.data.visibleInAssistant && agent.status !== "published") {
      return NextResponse.json({ error: "Publish the agent before adding it to the main chat" }, { status: 400 });
    }
  }

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (parsed.data.name !== undefined) update.name = parsed.data.name;
  if (parsed.data.description !== undefined) update.description = parsed.data.description;
  if (parsed.data.systemPrompt !== undefined) update.system_prompt = parsed.data.systemPrompt;
  if (parsed.data.biasInstructions !== undefined) update.bias_instructions = parsed.data.biasInstructions;
  if (parsed.data.enabledTools !== undefined) update.enabled_tools = parsed.data.enabledTools;
  if (parsed.data.visibleInAssistant !== undefined) update.visible_in_assistant = parsed.data.visibleInAssistant;

  const { error } = await supabase
    .from("agents")
    .update(update)
    .eq("id", id)
    .eq("organization_id", auth.orgId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuthApi();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!auth.canManageAgents) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const supabase = await createClient();
  const { error } = await supabase
    .from("agents")
    .delete()
    .eq("id", id)
    .eq("organization_id", auth.orgId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
