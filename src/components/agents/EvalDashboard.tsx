"use client";

import { useEffect, useState } from "react";
import { Loader2, Play } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ChartRenderer } from "@/components/charts/ChartRenderer";
import { EvalCaseEditor } from "./EvalCaseEditor";
import type { ChartSpec } from "@/lib/charts/types";

interface RoundRow {
  id: string;
  status: "running" | "completed" | "failed";
  total_cases: number;
  passed_cases: number;
  pass_rate: number | null;
  created_at: string;
}

const PUBLISH_THRESHOLD = 0.9;
const ITERATION_BUDGET = 10;

export function EvalDashboard({ agentId }: { agentId: string }) {
  const [rounds, setRounds] = useState<RoundRow[] | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [caseCount, setCaseCount] = useState(0);

  async function refreshRounds() {
    const res = await fetch(`/api/agents/${agentId}/eval-rounds`);
    if (res.ok) {
      const data = await res.json();
      setRounds(data.rounds ?? []);
    }
  }

  useEffect(() => {
    refreshRounds();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId]);

  async function runRound() {
    setRunning(true);
    setError(null);
    const res = await fetch(`/api/agents/${agentId}/eval-rounds`, { method: "POST" });
    setRunning(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Could not run eval round");
      return;
    }
    await refreshRounds();
  }

  const completedRounds = (rounds ?? []).filter((r) => r.pass_rate !== null).slice().reverse();
  const latestPassRate = completedRounds[completedRounds.length - 1]?.pass_rate ?? null;

  const chartSpec: ChartSpec | null =
    completedRounds.length > 0
      ? {
          kind: "line",
          title: "Pass rate per round",
          categoryKey: "round",
          series: [{ key: "passRate", label: "Pass rate" }],
          data: completedRounds.map((r, i) => ({ round: `#${i + 1}`, passRate: Math.round((r.pass_rate ?? 0) * 100) })),
        }
      : null;

  return (
    <div className="mx-auto mt-6 flex max-w-2xl flex-col gap-6">
      <div>
        <h2 className="text-[var(--text-sm)] font-medium">Test cases</h2>
        <EvalCaseEditor agentId={agentId} onCasesChanged={() => setCaseCount((n) => n + 1)} />
      </div>

      <div>
        <div className="flex items-center justify-between">
          <h2 className="text-[var(--text-sm)] font-medium">Eval rounds</h2>
          <Button size="sm" onClick={runRound} disabled={running}>
            {running ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
            Run eval round
          </Button>
        </div>
        <p className="mt-1 text-[var(--text-xs)] text-[var(--muted)]">
          Aim for {Math.round(PUBLISH_THRESHOLD * 100)}% pass within roughly {ITERATION_BUDGET} rounds of
          adjusting the persona, tools, or knowledge weights — publishing requires the most recent completed
          round to clear that bar against the current config.
        </p>
        {error && <p className="mt-2 text-[var(--text-sm)] text-[var(--danger)]">{error}</p>}

        {latestPassRate !== null && (
          <p className="mt-2 text-[var(--text-sm)]">
            Latest round:{" "}
            <span className={latestPassRate >= PUBLISH_THRESHOLD ? "text-[var(--success)]" : "text-[var(--muted)]"}>
              {Math.round(latestPassRate * 100)}% pass
            </span>
          </p>
        )}

        {chartSpec && (
          <div className="mt-3">
            <ChartRenderer spec={chartSpec} />
          </div>
        )}

        {!rounds ? (
          <Loader2 size={16} className="mt-3 animate-spin text-[var(--muted)]" />
        ) : rounds.length === 0 ? (
          <Card className="mt-3 p-4 text-center text-[var(--text-sm)] text-[var(--muted)]">
            No eval rounds yet — add test cases above, then run one.
          </Card>
        ) : (
          <div className="mt-3 flex flex-col gap-1.5">
            {rounds.map((r) => (
              <Card key={r.id} className="flex items-center justify-between p-2.5 text-[var(--text-sm)]">
                <span className="text-[var(--muted)]">{new Date(r.created_at).toLocaleString()}</span>
                <span className="uppercase tracking-wide text-[var(--text-xs)] text-[var(--muted)]">{r.status}</span>
                <span>
                  {r.pass_rate !== null ? `${r.passed_cases}/${r.total_cases} · ${Math.round(r.pass_rate * 100)}%` : "—"}
                </span>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
