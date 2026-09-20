import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { AcceptInvite } from "@/components/invite/AcceptInvite";

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/signup?invite=${token}`);
  }

  const admin = createAdminClient();
  const { data: invite } = await admin
    .from("org_invites")
    .select("email, role, message, grant_agents_access, redeemed_at, organizations(name)")
    .eq("token", token)
    .maybeSingle();

  if (!invite || invite.redeemed_at) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6 text-center">
        <p className="text-[var(--text-sm)] text-[var(--muted)]">
          This invite is invalid or has already been used.
        </p>
      </main>
    );
  }

  const org = Array.isArray(invite.organizations) ? invite.organizations[0] : invite.organizations;

  return (
    <AcceptInvite
      token={token}
      orgName={org?.name ?? "a workspace"}
      role={invite.role}
      message={invite.message}
      grantAgentsAccess={invite.grant_agents_access}
    />
  );
}
