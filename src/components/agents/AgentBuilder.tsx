"use client";

import { useEffect, useState } from "react";
import { TOOL_DESCRIPTIONS } from "@/lib/ai/toolDescriptions";

// Reads from toolDescriptions.ts, not tools.ts — tools.ts pulls in Resend,
// Nessie, Voyage embeddings and the admin Supabase client at module scope,
// none of which are safe to bundle into a "use client" component.
// toolDescriptions.ts has no imports, so it's safe on both sides.
const TOOL_NAMES = Object.keys(TOOL_DESCRIPTIONS);

interface KnowledgeSourceOption {
  id: string;
  name: string;
  status: string;
}

interface AttachedSource {
  sourceId: string;
  name: string;
  weight: number;
}

export function AgentBuilder({
  agentId,
  name,
  description,
  systemPrompt,
  biasInstructions,
  enabledTools,
  onChange,
}: {
  agentId: string;
  name: string;
  description: string;
  systemPrompt: string;
  biasInstructions: string;
  enabledTools: string[];
  onChange: (next: {
    name?: string;
    description?: string;
    systemPrompt?: string;
    biasInstructions?: string;
    enabledTools?: string[];
  }) => void;
}) {
  const [sources, setSources] = useState<KnowledgeSourceOption[] | null>(null);
  const [attached, setAttached] = useState<AttachedSource[] | null>(null);

  useEffect(() => {
    fetch("/api/knowledge/sources")
      .then((res) => res.json())
      .then((data) => setSources(data.sources ?? []));
    refreshAttached();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId]);

  async function refreshAttached() {
    const res = await fetch(`/api/agents/${agentId}/knowledge-sources`);
    if (res.ok) {
      const data = await res.json();
      setAttached(data.attached ?? []);
    }
  }

  function toggleTool(toolName: string) {
    onChange({
      enabledTools: enabledTools.includes(toolName)
        ? enabledTools.filter((t) => t !== toolName)
        : [...enabledTools, toolName],
    });
  }

  async function attachSource(sourceId: string) {
    await fetch(`/api/agents/${agentId}/knowledge-sources`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceId, weight: 1 }),
    });
    refreshAttached();
  }

  async function reweight(sourceId: string, weight: number) {
    setAttached((prev) => prev?.map((a) => (a.sourceId === sourceId ? { ...a, weight } : a)) ?? prev);
    await fetch(`/api/agents/${agentId}/knowledge-sources/${sourceId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ weight }),
    });
  }

  async function detach(sourceId: string) {
    await fetch(`/api/agents/${agentId}/knowledge-sources/${sourceId}`, { method: "DELETE" });
    refreshAttached();
  }

  const attachedIds = new Set((attached ?? []).map((a) => a.sourceId));
  const availableSources = (sources ?? []).filter((s) => s.status === "ready" && !attachedIds.has(s.id));

  return (
    <div className="flex flex-col gap-5">
      <input
        value={name}
        onChange={(e) => onChange({ name: e.target.value })}
        placeholder="Agent name"
        className="h-11 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-3.5 text-[var(--text-lg)] font-semibold"
      />
      <textarea
        value={description}
        onChange={(e) => onChange({ description: e.target.value })}
        placeholder="Description (optional) — shown when this agent is offered inside the main chat"
        rows={2}
        className="resize-none rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2.5 text-[var(--text-sm)]"
      />

      <div className="flex flex-col gap-1.5">
        <label className="text-[var(--text-sm)] font-medium">Persona / system prompt</label>
        <textarea
          value={systemPrompt}
          onChange={(e) => onChange({ systemPrompt: e.target.value })}
          placeholder="You are a specialist that only answers questions about..."
          rows={6}
          className="resize-none rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2.5 text-[var(--text-sm)]"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-[var(--text-sm)] font-medium">Bias instructions (optional)</label>
        <p className="text-[var(--text-xs)] text-[var(--muted)]">
          Appended after the persona — tone, emphasis, or a hard rule the agent should never break.
        </p>
        <textarea
          value={biasInstructions}
          onChange={(e) => onChange({ biasInstructions: e.target.value })}
          rows={3}
          className="resize-none rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2.5 text-[var(--text-sm)]"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-[var(--text-sm)] font-medium">Tools granted</label>
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
          {TOOL_NAMES.map((toolName) => (
            <label
              key={toolName}
              className="flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--border)] px-2.5 py-1.5 text-[var(--text-xs)]"
            >
              <input
                type="checkbox"
                checked={enabledTools.includes(toolName)}
                onChange={() => toggleTool(toolName)}
              />
              {toolName}
            </label>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-[var(--text-sm)] font-medium">Knowledge sources</label>
        <p className="text-[var(--text-xs)] text-[var(--muted)]">
          Retrieval is scoped to exactly what's attached here — nothing else in the org's knowledge base
          is visible to this agent. Weight governs relative ranking among attached sources.
        </p>

        {!attached ? null : attached.length === 0 ? (
          <p className="text-[var(--text-xs)] text-[var(--muted)]">No sources attached yet.</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {attached.map((a) => (
              <div
                key={a.sourceId}
                className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--border)] px-2.5 py-1.5"
              >
                <span className="flex-1 truncate text-[var(--text-sm)]">{a.name}</span>
                <input
                  type="range"
                  min={0}
                  max={5}
                  step={0.5}
                  value={a.weight}
                  onChange={(e) => reweight(a.sourceId, Number(e.target.value))}
                  className="w-28"
                />
                <span className="w-8 text-right text-[var(--text-xs)] text-[var(--muted)]">{a.weight}</span>
                <button
                  onClick={() => detach(a.sourceId)}
                  className="text-[var(--text-xs)] text-[var(--muted)] hover:text-[var(--danger)]"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}

        {availableSources.length > 0 && (
          <select
            value=""
            onChange={(e) => e.target.value && attachSource(e.target.value)}
            className="h-9 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg)] px-2.5 text-[var(--text-sm)]"
          >
            <option value="">Attach a knowledge source…</option>
            {availableSources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
      </div>
    </div>
  );
}
