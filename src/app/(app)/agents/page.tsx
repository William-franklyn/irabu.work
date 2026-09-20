import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth/guard";
import { AgentsManager } from "@/components/agents/AgentsManager";

export const metadata = { title: "Agents Lab" };

export default async function AgentsPage() {
  const { canManageAgents } = await requireAuth();
  if (!canManageAgents) redirect("/dashboard");

  return <AgentsManager />;
}
