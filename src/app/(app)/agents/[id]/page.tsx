import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth/guard";
import { AgentEditor } from "@/components/agents/AgentEditor";

export const metadata = { title: "Edit agent" };

export default async function AgentEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { canManageAgents } = await requireAuth();
  if (!canManageAgents) redirect("/dashboard");

  const { id } = await params;
  return <AgentEditor agentId={id} />;
}
