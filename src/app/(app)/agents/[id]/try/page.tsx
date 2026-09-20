import { requireAuth } from "@/lib/auth/guard";
import { TryAgent } from "@/components/agents/TryAgent";

export const metadata = { title: "Try agent" };

// Deliberately does not require canManageAgents — any org member who
// received a shared link can try a published agent, matching the design's
// distinction between "who can build agents" and "who can use one."
export default async function TryAgentPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAuth();
  const { id } = await params;
  return <TryAgent agentId={id} />;
}
