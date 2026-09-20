"use client";

import { useEffect, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";

interface EvalCaseRow {
  id: string;
  prompt: string;
  expected_criteria: string;
}

export function EvalCaseEditor({ agentId, onCasesChanged }: { agentId: string; onCasesChanged?: () => void }) {
  const [cases, setCases] = useState<EvalCaseRow[] | null>(null);
  const [prompt, setPrompt] = useState("");
  const [expectedCriteria, setExpectedCriteria] = useState("");
  const [adding, setAdding] = useState(false);

  async function refresh() {
    const res = await fetch(`/api/agents/${agentId}/eval-cases`);
    if (res.ok) {
      const data = await res.json();
      setCases(data.cases ?? []);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId]);

  async function addCase() {
    if (!prompt.trim() || !expectedCriteria.trim()) return;
    setAdding(true);
    await fetch(`/api/agents/${agentId}/eval-cases`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: prompt.trim(), expectedCriteria: expectedCriteria.trim() }),
    });
    setPrompt("");
    setExpectedCriteria("");
    setAdding(false);
    await refresh();
    onCasesChanged?.();
  }

  async function removeCase(id: string) {
    await fetch(`/api/agents/${agentId}/eval-cases/${id}`, { method: "DELETE" });
    await refresh();
    onCasesChanged?.();
  }

  return (
    <div className="flex flex-col gap-3">
      {!cases ? (
        <Loader2 size={16} className="animate-spin text-[var(--muted)]" />
      ) : cases.length === 0 ? (
        <p className="text-[var(--text-xs)] text-[var(--muted)]">No test cases yet.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {cases.map((c, i) => (
            <div key={c.id} className="rounded-[var(--radius-sm)] border border-[var(--border)] p-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1">
                  <p className="text-[var(--text-xs)] text-[var(--muted)]">Case {i + 1} — prompt</p>
                  <p className="text-[var(--text-sm)]">{c.prompt}</p>
                  <p className="mt-1.5 text-[var(--text-xs)] text-[var(--muted)]">Expected criteria</p>
                  <p className="text-[var(--text-sm)]">{c.expected_criteria}</p>
                </div>
                <button
                  onClick={() => removeCase(c.id)}
                  aria-label="Remove case"
                  className="text-[var(--muted)] hover:text-[var(--danger)]"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-2 rounded-[var(--radius-sm)] border border-dashed border-[var(--border)] p-2.5">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Test prompt to send the agent"
          rows={2}
          className="resize-none rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg)] px-2.5 py-2 text-[var(--text-sm)]"
        />
        <textarea
          value={expectedCriteria}
          onChange={(e) => setExpectedCriteria(e.target.value)}
          placeholder="What a passing response must satisfy"
          rows={2}
          className="resize-none rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg)] px-2.5 py-2 text-[var(--text-sm)]"
        />
        <Button size="sm" variant="secondary" onClick={addCase} disabled={adding} className="w-fit">
          {adding ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
          Add case
        </Button>
      </div>
    </div>
  );
}
