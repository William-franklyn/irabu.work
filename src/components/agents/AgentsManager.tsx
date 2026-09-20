"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Bot, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import type { AgentStatus } from "@/lib/agents/types";

interface AgentRow {
  id: string;
  name: string;
  status: AgentStatus;
  created_at: string;
  lastPassRate: number | null;
}

const statusStyles: Record<AgentStatus, string> = {
  draft: "text-[var(--muted)]",
  testing: "text-[var(--accent)]",
  published: "text-[var(--success)]",
  archived: "text-[var(--danger)]",
};

export function AgentsManager() {
  const router = useRouter();
  const [agents, setAgents] = useState<AgentRow[] | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    fetch("/api/agents")
      .then((res) => res.json())
      .then((data) => setAgents(data.agents ?? []));
  }, []);

  async function createAgent() {
    setCreating(true);
    const res = await fetch("/api/agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Untitled agent" }),
    });
    const data = await res.json();
    setCreating(false);
    if (res.ok) router.push(`/agents/${data.id}`);
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[var(--text-lg)] font-semibold">Agents Lab</h1>
          <p className="mt-1 text-[var(--text-sm)] text-[var(--muted)]">
            Build a named agent, test it, then publish it for your team or an external API.
          </p>
        </div>
        <Button onClick={createAgent} disabled={creating}>
          {creating ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
          New agent
        </Button>
      </div>

      <div className="mt-6 flex flex-col gap-2">
        {!agents ? (
          <Loader2 size={18} className="animate-spin text-[var(--muted)]" />
        ) : agents.length === 0 ? (
          <Card className="p-4 sm:p-6 lg:p-8 text-center text-[var(--text-sm)] text-[var(--muted)]">
            No agents yet — create one to give it a persona, tools, and knowledge.
          </Card>
        ) : (
          agents.map((a) => (
            <Card
              key={a.id}
              onClick={() => router.push(`/agents/${a.id}`)}
              className="flex cursor-pointer items-center gap-3 p-3.5 hover:bg-[var(--surface-sunken)]"
            >
              <Bot size={18} className="text-[var(--muted)]" />
              <span className="flex-1 truncate text-[var(--text-sm)]">{a.name}</span>
              {a.lastPassRate !== null && (
                <span className="text-[var(--text-xs)] text-[var(--muted)]">
                  {Math.round(a.lastPassRate * 100)}% pass
                </span>
              )}
              <span className={`text-[var(--text-xs)] uppercase tracking-wide ${statusStyles[a.status]}`}>
                {a.status}
              </span>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
