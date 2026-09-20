import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { z } from "zod";
import { requireAuthApi } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { logActivity } from "@/lib/activity";
import { sendWorkspaceInvite } from "@/lib/email/invite";

const bodySchema = z.object({
  email: z.string().email(),
  role: z.enum(["admin", "member"]).default("member"),
  message: z.string().max(500).optional(),
  grantAgentsAccess: z.boolean().default(false),
});

export async function POST(req: NextRequest) {
  const auth = await requireAuthApi();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.role === "member") {
    return NextResponse.json({ error: "Only owners and admins can invite" }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const supabase = await createClient();
  const token = randomBytes(24).toString("base64url");

  const { data, error } = await supabase
    .from("org_invites")
    .insert({
      organization_id: auth.orgId,
      email: parsed.data.email,
      role: parsed.data.role,
      message: parsed.data.message ?? null,
      grant_agents_access: parsed.data.grantAgentsAccess,
      token,
      created_by: auth.userId,
    })
    .select("id, email, role, message, grant_agents_access, token, created_at")
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Could not create invite" }, { status: 500 });
  }

  await logActivity(supabase, {
    organizationId: auth.orgId,
    actorId: auth.userId,
    action: "invited_teammate",
    detail: `Invited ${parsed.data.email}`,
  });

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const emailResult = await sendWorkspaceInvite({
    to: parsed.data.email,
    orgName: auth.orgName,
    inviteUrl: `${appUrl}/invite/${token}`,
    message: parsed.data.message,
  });

  return NextResponse.json({ invite: data, emailSent: emailResult.sent }, { status: 201 });
}
