"use client";

import { useEffect, useState } from "react";
import { Check, Copy, Key, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import type { AgentStatus } from "@/lib/agents/types";

interface ApiKeyRow {
  id: string;
  key_prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

export function PublishPanel({
  agentId,
  status,
  visibleInAssistant,
  onStatusChange,
  onVisibleChange,
}: {
  agentId: string;
  status: AgentStatus;
  visibleInAssistant: boolean;
  onStatusChange: (status: AgentStatus) => void;
  onVisibleChange: (visible: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [keys, setKeys] = useState<ApiKeyRow[] | null>(null);
  const [newKey, setNewKey] = useState<string | null>(null);

  async function refreshKeys() {
    const res = await fetch(`/api/agents/${agentId}/api-keys`);
    if (res.ok) {
      const data = await res.json();
      setKeys(data.keys ?? []);
    }
  }

  useEffect(() => {
    refreshKeys();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId]);

  async function publish() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/agents/${agentId}/publish`, { method: "POST" });
    setBusy(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Could not publish");
      return;
    }
    onStatusChange("published");
  }

  async function archive() {
    setBusy(true);
    await fetch(`/api/agents/${agentId}/archive`, { method: "POST" });
    setBusy(false);
    onStatusChange("archived");
    onVisibleChange(false);
  }

  async function unarchive() {
    setBusy(true);
    await fetch(`/api/agents/${agentId}/unarchive`, { method: "POST" });
    setBusy(false);
    onStatusChange("draft");
  }

  async function toggleVisible() {
    const next = !visibleInAssistant;
    onVisibleChange(next);
    const res = await fetch(`/api/agents/${agentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ visibleInAssistant: next }),
    });
    if (!res.ok) onVisibleChange(!next);
  }

  function copyTryLink() {
    navigator.clipboard.writeText(`${window.location.origin}/agents/${agentId}/try`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function generateKey() {
    setBusy(true);
    const res = await fetch(`/api/agents/${agentId}/api-keys`, { method: "POST" });
    setBusy(false);
    if (res.ok) {
      const data = await res.json();
      setNewKey(data.key);
      refreshKeys();
    }
  }

  async function revokeKey(keyId: string) {
    await fetch(`/api/agents/${agentId}/api-keys/${keyId}`, { method: "PATCH" });
    refreshKeys();
  }

  return (
    <div className="mx-auto mt-6 flex max-w-2xl flex-col gap-6">
      <Card className="p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[var(--text-sm)] font-medium">Status: <span className="uppercase">{status}</span></p>
            <p className="mt-1 text-[var(--text-xs)] text-[var(--muted)]">
              Publishing requires the most recent eval round to pass at 90% or higher against the current config.
            </p>
          </div>
          <div className="flex gap-2">
            {status === "archived" ? (
              <Button size="sm" variant="secondary" onClick={unarchive} disabled={busy}>
                Unarchive
              </Button>
            ) : (
              <>
                {status !== "published" && (
                  <Button size="sm" onClick={publish} disabled={busy}>
                    {busy ? <Loader2 size={14} className="animate-spin" /> : null}
                    Publish
                  </Button>
                )}
                <Button size="sm" variant="secondary" onClick={archive} disabled={busy}>
                  Archive
                </Button>
              </>
            )}
          </div>
        </div>
        {error && <p className="mt-2 text-[var(--text-sm)] text-[var(--danger)]">{error}</p>}
      </Card>

      {status === "published" && (
        <>
          <Card className="p-4">
            <p className="text-[var(--text-sm)] font-medium">Share with your team</p>
            <p className="mt-1 text-[var(--text-xs)] text-[var(--muted)]">
              Any teammate in this workspace can open this link and try the agent — they don't need
              Agents Lab access themselves.
            </p>
            <Button variant="secondary" size="sm" className="mt-2" onClick={copyTryLink}>
              {copied ? <Check size={14} /> : <Copy size={14} />}
              Copy test link
            </Button>
          </Card>

          <Card className="p-4">
            <label className="flex items-center justify-between text-[var(--text-sm)]">
              <span>
                <span className="font-medium">Available in main chat</span>
                <span className="block text-[var(--text-xs)] text-[var(--muted)]">
                  Let the main assistant delegate to this agent as a tool when relevant.
                </span>
              </span>
              <input type="checkbox" checked={visibleInAssistant} onChange={toggleVisible} />
            </label>
          </Card>

          <Card className="p-4">
            <div className="flex items-center justify-between">
              <p className="text-[var(--text-sm)] font-medium">External API</p>
              <Button variant="secondary" size="sm" onClick={generateKey} disabled={busy}>
                <Key size={14} />
                Generate key
              </Button>
            </div>
            <p className="mt-1 text-[var(--text-xs)] text-[var(--muted)]">
              Call <code>POST /api/public/agents/{agentId}/invoke</code> with{" "}
              <code>Authorization: Bearer &lt;key&gt;</code> and <code>{"{ \"input\": \"...\" }"}</code>.
            </p>

            {newKey && (
              <div className="mt-2 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-sunken)] p-2.5">
                <p className="text-[var(--text-xs)] text-[var(--muted)]">
                  Shown once — copy it now, it can't be retrieved again.
                </p>
                <code className="mt-1 block break-all text-[var(--text-sm)]">{newKey}</code>
              </div>
            )}

            {keys && keys.length > 0 && (
              <div className="mt-3 flex flex-col gap-1.5">
                {keys.map((k) => (
                  <div
                    key={k.id}
                    className="flex items-center justify-between rounded-[var(--radius-sm)] border border-[var(--border)] px-2.5 py-1.5 text-[var(--text-xs)]"
                  >
                    <code>{k.key_prefix}…</code>
                    <span className="text-[var(--muted)]">
                      {k.revoked_at ? "Revoked" : k.last_used_at ? `Used ${new Date(k.last_used_at).toLocaleDateString()}` : "Never used"}
                    </span>
                    {!k.revoked_at && (
                      <button onClick={() => revokeKey(k.id)} className="text-[var(--muted)] hover:text-[var(--danger)]">
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
