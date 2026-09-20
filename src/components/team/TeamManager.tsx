"use client";

import { useCallback, useEffect, useState } from "react";
import { Bot, Check, Copy, Mail, ShieldCheck, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

interface Member {
  id: string;
  full_name: string | null;
  role: "owner" | "admin" | "member";
  persona_verified: boolean;
  sensitive_access_approved: boolean;
  can_manage_agents: boolean;
}

interface Invite {
  id: string;
  email: string;
  role: string;
  grant_agents_access: boolean;
  token: string;
  created_at: string;
}

export function TeamManager({ canManage }: { canManage: boolean }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [grantAgentsAccess, setGrantAgentsAccess] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailStatus, setEmailStatus] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/team");
    if (res.ok) {
      const body = await res.json();
      setMembers(body.members);
      setInvites(body.invites);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function onInvite(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    setEmailStatus(null);

    const res = await fetch("/api/team/invites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        role: "member",
        message: message.trim() || undefined,
        grantAgentsAccess,
      }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Could not send invite");
    } else {
      const body = await res.json();
      setEmailStatus(body.emailSent ? `Emailed ${email}` : "Invite created — copy the link below to share it");
      setEmail("");
      setMessage("");
      setGrantAgentsAccess(false);
      refresh();
    }
    setPending(false);
  }

  function copyLink(invite: Invite) {
    const url = `${window.location.origin}/invite/${invite.token}`;
    navigator.clipboard.writeText(url);
    setCopiedId(invite.id);
    setTimeout(() => setCopiedId(null), 1500);
  }

  async function toggleSensitiveAccess(member: Member) {
    setMembers((prev) =>
      prev.map((m) => (m.id === member.id ? { ...m, sensitive_access_approved: !m.sensitive_access_approved } : m)),
    );
    const res = await fetch(`/api/team/members/${member.id}/sensitive-access`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approved: !member.sensitive_access_approved }),
    });
    if (!res.ok) refresh();
  }

  async function toggleAgentsAccess(member: Member) {
    setMembers((prev) =>
      prev.map((m) => (m.id === member.id ? { ...m, can_manage_agents: !m.can_manage_agents } : m)),
    );
    const res = await fetch(`/api/team/members/${member.id}/agents-permission`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ canManageAgents: !member.can_manage_agents }),
    });
    if (!res.ok) refresh();
  }

  return (
    <div>
      <h1 className="text-[var(--text-lg)] font-semibold">Team</h1>
      <p className="mt-1 text-[var(--text-sm)] text-[var(--muted)]">
        Invite teammates into this workspace.
      </p>

      <form onSubmit={onInvite} className="mt-6 flex flex-col gap-2 max-w-sm">
        <input
          required
          type="email"
          placeholder="teammate@company.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="h-9 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-3"
        />
        <input
          placeholder="Add a personal note (optional)"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          className="h-9 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-3 text-[var(--text-sm)]"
        />
        {canManage && (
          <label className="flex items-center gap-1.5 text-[var(--text-xs)] text-[var(--muted)]">
            <input
              type="checkbox"
              checked={grantAgentsAccess}
              onChange={(e) => setGrantAgentsAccess(e.target.checked)}
            />
            <Bot size={13} />
            Also grant Agents Lab access on acceptance
          </label>
        )}
        <Button type="submit" disabled={pending} className="w-fit">
          <UserPlus size={16} />
          Invite
        </Button>
      </form>
      {error && <p className="mt-2 text-[var(--text-sm)] text-[var(--danger)]">{error}</p>}
      {emailStatus && (
        <p className="mt-2 flex items-center gap-1.5 text-[var(--text-sm)] text-[var(--success)]">
          <Mail size={13} />
          {emailStatus}
        </p>
      )}

      <h2 className="mt-8 text-[var(--text-sm)] font-medium text-[var(--muted)]">
        Members
      </h2>
      <div className="mt-2 flex flex-col gap-2">
        {members.map((m) => (
          <Card key={m.id} className="flex items-center justify-between p-3.5">
            <div className="flex items-center gap-2">
              <span className="text-[var(--text-sm)]">{m.full_name ?? "Unnamed"}</span>
              {m.persona_verified && (
                <span
                  title="Completed identity verification (Persona)"
                  className="flex items-center gap-1 text-[var(--text-xs)] text-[var(--success)]"
                >
                  <ShieldCheck size={12} />
                  Verified
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              {canManage ? (
                <button
                  onClick={() => toggleAgentsAccess(m)}
                  className={`flex items-center gap-1 text-[var(--text-xs)] ${
                    m.can_manage_agents ? "text-[var(--accent)]" : "text-[var(--muted)]"
                  }`}
                >
                  <Bot size={12} />
                  {m.can_manage_agents ? "Agents Lab: granted" : "Grant Agents Lab access"}
                </button>
              ) : (
                m.can_manage_agents && (
                  <span className="flex items-center gap-1 text-[var(--text-xs)] text-[var(--muted)]">
                    <Bot size={12} />
                    Agents Lab access
                  </span>
                )
              )}
              {canManage && m.persona_verified ? (
                <button
                  onClick={() => toggleSensitiveAccess(m)}
                  className={`text-[var(--text-xs)] ${
                    m.sensitive_access_approved ? "text-[var(--accent)]" : "text-[var(--muted)]"
                  }`}
                >
                  {m.sensitive_access_approved ? "Sensitive access: approved" : "Approve sensitive access"}
                </button>
              ) : (
                m.sensitive_access_approved && (
                  <span className="text-[var(--text-xs)] text-[var(--muted)]">Sensitive access approved</span>
                )
              )}
              <span className="text-[var(--text-xs)] capitalize text-[var(--muted)]">{m.role}</span>
            </div>
          </Card>
        ))}
      </div>

      {invites.length > 0 && (
        <>
          <h2 className="mt-8 text-[var(--text-sm)] font-medium text-[var(--muted)]">
            Pending invites
          </h2>
          <div className="mt-2 flex flex-col gap-2">
            {invites.map((invite) => (
              <Card key={invite.id} className="flex items-center justify-between p-3.5">
                <span className="flex items-center gap-1.5 text-[var(--text-sm)]">
                  {invite.email}
                  {invite.grant_agents_access && (
                    <span
                      title="Grants Agents Lab access on acceptance"
                      className="flex items-center gap-1 text-[var(--text-xs)] text-[var(--accent)]"
                    >
                      <Bot size={12} />
                      + Agents Lab
                    </span>
                  )}
                </span>
                <button
                  onClick={() => copyLink(invite)}
                  className="flex items-center gap-1.5 text-[var(--text-xs)] text-[var(--accent)]"
                >
                  {copiedId === invite.id ? <Check size={13} /> : <Copy size={13} />}
                  {copiedId === invite.id ? "Copied" : "Copy invite link"}
                </button>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
