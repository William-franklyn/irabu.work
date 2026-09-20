import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuthApi } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";

const patchSchema = z.object({
  prompt: z.string().min(1).max(4000).optional(),
  expectedCriteria: z.string().min(1).max(4000).optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; caseId: string }> },
) {
  const auth = await requireAuthApi();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!auth.canManageAgents) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = patchSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const update: Record<string, unknown> = {};
  if (parsed.data.prompt !== undefined) update.prompt = parsed.data.prompt;
  if (parsed.data.expectedCriteria !== undefined) update.expected_criteria = parsed.data.expectedCriteria;

  const { id, caseId } = await params;
  const supabase = await createClient();
  const { error } = await supabase
    .from("agent_eval_cases")
    .update(update)
    .eq("id", caseId)
    .eq("agent_id", id)
    .eq("organization_id", auth.orgId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; caseId: string }> },
) {
  const auth = await requireAuthApi();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!auth.canManageAgents) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id, caseId } = await params;
  const supabase = await createClient();
  const { error } = await supabase
    .from("agent_eval_cases")
    .delete()
    .eq("id", caseId)
    .eq("agent_id", id)
    .eq("organization_id", auth.orgId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
