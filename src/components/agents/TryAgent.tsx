"use client";

import { useState } from "react";
import { Check, Copy, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

export function TryAgent({ agentId }: { agentId: string }) {
  const [input, setInput] = useState("");
  const [output, setOutput] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [copied, setCopied] = useState(false);

  async function send() {
    if (!input.trim() || sending) return;
    setSending(true);
    setError(null);
    setOutput(null);
    const res = await fetch(`/api/agents/${agentId}/try`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: input.trim() }),
    });
    setSending(false);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(body.error ?? "This agent isn't available right now");
      return;
    }
    setOutput(body.output);
  }

  function copyLink() {
    navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="mx-auto max-w-lg p-6 py-12">
      <div className="flex items-center justify-between">
        <h1 className="text-[var(--text-lg)] font-semibold">Try this agent</h1>
        <Button variant="secondary" size="sm" onClick={copyLink}>
          {copied ? <Check size={14} /> : <Copy size={14} />}
          Copy link
        </Button>
      </div>

      <Card className="mt-4 p-4">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask this agent something…"
          rows={3}
          className="w-full resize-none rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg)] p-2.5 text-[var(--text-sm)]"
        />
        <div className="mt-2 flex justify-end">
          <Button size="sm" onClick={send} disabled={sending || !input.trim()}>
            {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            Send
          </Button>
        </div>
      </Card>

      {error && <p className="mt-3 text-[var(--text-sm)] text-[var(--danger)]">{error}</p>}
      {output && (
        <Card className="mt-3 p-4 text-[var(--text-sm)] whitespace-pre-wrap">{output}</Card>
      )}
    </div>
  );
}
