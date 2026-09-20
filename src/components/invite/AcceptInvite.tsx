"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Bot, Building2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

export function AcceptInvite({
  token,
  orgName,
  role,
  message,
  grantAgentsAccess,
}: {
  token: string;
  orgName: string;
  role: string;
  message: string | null;
  grantAgentsAccess: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function accept() {
    setPending(true);
    setError(null);
    const res = await fetch(`/api/invites/${token}/accept`, { method: "POST" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Could not accept this invite");
      setPending(false);
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-sm p-6 text-center">
        <Building2 size={24} className="mx-auto text-[var(--accent)]" />
        <h1 className="mt-3 text-[var(--text-lg)] font-medium">
          Join {orgName}?
        </h1>
        <p className="mt-1 text-[var(--text-sm)] text-[var(--muted)]">
          You'll be added as {role === "admin" ? "an" : "a"} {role}.
        </p>
        {grantAgentsAccess && (
          <p className="mt-2 flex items-center justify-center gap-1.5 text-[var(--text-xs)] text-[var(--accent)]">
            <Bot size={13} />
            Includes Agents Lab access
          </p>
        )}
        {message && (
          <p className="mt-3 rounded-[var(--radius)] bg-[var(--accent-soft)] p-3 text-[var(--text-sm)]">
            &ldquo;{message}&rdquo;
          </p>
        )}
        {error && <p className="mt-3 text-[var(--text-sm)] text-[var(--danger)]">{error}</p>}
        <Button onClick={accept} disabled={pending} className="mt-5 w-full justify-center">
          {pending ? "Joining…" : "Accept and join"}
        </Button>
      </Card>
    </main>
  );
}
