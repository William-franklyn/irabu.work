"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { AgentBuilder } from "./AgentBuilder";
import { EvalDashboard } from "./EvalDashboard";
import { PublishPanel } from "./PublishPanel";
import type { AgentStatus } from "@/lib/agents/types";

interface AgentData {
  id: string;
  name: string;
  description: string | null;
  system_prompt: string;
  bias_instructions: string | null;
  enabled_tools: string[];
  status: AgentStatus;
  visible_in_assistant: boolean;
  config_updated_at: string;
}

export function AgentEditor({ agentId }: { agentId: string }) {
  const router = useRouter();
  const [agent, setAgent] = useState<AgentData | null>(null);
  const [tab, setTab] = useState<"build" | "eval" | "publish">("build");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(`/api/agents/${agentId}`)
      .then((res) => res.json())
      .then((data) => setAgent(data.agent));
  }, [agentId]);

  function update(patch: Partial<AgentData>) {
    setAgent((prev) => (prev ? { ...prev, ...patch } : prev));
  }

  async function save() {
    if (!agent) return;
    setSaving(true);
    await fetch(`/api/agents/${agentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: agent.name,
        description: agent.description,
        systemPrompt: agent.system_prompt,
        biasInstructions: agent.bias_instructions,
        enabledTools: agent.enabled_tools,
      }),
    });
    setSaving(false);
  }

  async function remove() {
    await fetch(`/api/agents/${agentId}`, { method: "DELETE" });
    router.push("/agents");
  }

  if (!agent) {
    return (
      <div className="flex justify-center p-12">
        <Loader2 size={20} className="animate-spin text-[var(--muted)]" />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="flex items-center justify-between">
        <div className="flex gap-1 rounded-[var(--radius)] border border-[var(--border)] p-1">
          {(["build", "eval", "publish"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-[var(--radius-sm)] px-3 py-1.5 text-[var(--text-sm)] capitalize ${
                tab === t ? "bg-[var(--accent-soft)] font-medium" : "text-[var(--muted)]"
              }`}
            >
              {t === "publish" ? "Publish & share" : t}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[var(--text-xs)] uppercase tracking-wide text-[var(--muted)]">
            {agent.status}
          </span>
          <button onClick={remove} aria-label="Delete agent" className="text-[var(--muted)] hover:text-[var(--danger)]">
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      {tab === "build" && (
        <div className="mx-auto mt-6 max-w-2xl">
          <AgentBuilder
            agentId={agentId}
            name={agent.name}
            description={agent.description ?? ""}
            systemPrompt={agent.system_prompt}
            biasInstructions={agent.bias_instructions ?? ""}
            enabledTools={agent.enabled_tools}
            onChange={(patch) => update(patch as Partial<AgentData>)}
          />
          <div className="mt-4 flex justify-end">
            <Button size="sm" onClick={save} disabled={saving}>
              {saving ? <Loader2 size={14} className="animate-spin" /> : null}
              Save
            </Button>
          </div>
        </div>
      )}

      {tab === "eval" && <EvalDashboard agentId={agentId} />}

      {tab === "publish" && (
        <PublishPanel
          agentId={agentId}
          status={agent.status}
          visibleInAssistant={agent.visible_in_assistant}
          onStatusChange={(status) => update({ status })}
          onVisibleChange={(visible_in_assistant) => update({ visible_in_assistant })}
        />
      )}
    </div>
  );
}
