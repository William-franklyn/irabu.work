"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Wordmark } from "@/components/ui/Logo";
import type { FormField } from "@/lib/forms/types";

function BrandMark() {
  return (
    <Link href="/" aria-label="iRABU home" className="mb-4 inline-flex">
      <Wordmark size={20} />
    </Link>
  );
}

interface PublicForm {
  id: string;
  title: string;
  description: string | null;
  fields: FormField[];
}

export function PublicFormFill({ formId }: { formId: string }) {
  const [form, setForm] = useState<PublicForm | null | "not_found">(null);
  const [answers, setAnswers] = useState<Record<string, string | number | boolean>>({});
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/public/forms/${formId}`)
      .then((res) => res.json())
      .then((data) => setForm(data.form ?? "not_found"));
  }, [formId]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const res = await fetch(`/api/public/forms/${formId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answers, respondentEmail: email || undefined }),
    });
    setSubmitting(false);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(body.error ?? "Could not submit");
      return;
    }
    setSubmitted(true);
  }

  if (form === null) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 size={20} className="animate-spin text-[var(--muted)]" />
      </div>
    );
  }

  if (form === "not_found") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center text-[var(--muted)]">
        <BrandMark />
        This form isn&apos;t accepting responses right now.
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center">
        <BrandMark />
        <CheckCircle2 size={32} className="text-[var(--success)]" />
        <p className="text-[var(--text-base)]">Thanks — your response was submitted.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto min-h-screen max-w-lg p-6 py-12">
      <BrandMark />
      <Card className="p-6">
        <h1 className="text-[var(--text-lg)] font-semibold">{form.title}</h1>
        {form.description && (
          <p className="mt-1 text-[var(--text-sm)] text-[var(--muted)]">{form.description}</p>
        )}

        <form onSubmit={submit} className="mt-6 flex flex-col gap-4">
          {form.fields.map((field) => (
            <label key={field.id} className="flex flex-col gap-1.5 text-[var(--text-sm)]">
              {field.label}
              {field.required && <span className="text-[var(--danger)]"> *</span>}
              {field.type === "textarea" ? (
                <textarea
                  required={field.required}
                  rows={3}
                  onChange={(e) => setAnswers((a) => ({ ...a, [field.id]: e.target.value }))}
                  className="resize-none rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg)] p-2.5"
                />
              ) : field.type === "select" ? (
                <select
                  required={field.required}
                  defaultValue=""
                  onChange={(e) => setAnswers((a) => ({ ...a, [field.id]: e.target.value }))}
                  className="h-9 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg)] px-2.5"
                >
                  <option value="" disabled>
                    Select…
                  </option>
                  {(field.options ?? []).map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              ) : field.type === "checkbox" ? (
                <input
                  type="checkbox"
                  onChange={(e) => setAnswers((a) => ({ ...a, [field.id]: e.target.checked }))}
                  className="h-4 w-4 self-start"
                />
              ) : (
                <input
                  type={field.type === "number" ? "number" : field.type === "date" ? "date" : field.type === "email" ? "email" : "text"}
                  required={field.required}
                  onChange={(e) =>
                    setAnswers((a) => ({
                      ...a,
                      [field.id]: field.type === "number" ? Number(e.target.value) : e.target.value,
                    }))
                  }
                  className="h-9 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg)] px-3"
                />
              )}
            </label>
          ))}

          <label className="flex flex-col gap-1.5 text-[var(--text-sm)] text-[var(--muted)]">
            Your email (optional)
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-9 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg)] px-3 text-[var(--ink)]"
            />
          </label>

          {error && <p className="text-[var(--text-sm)] text-[var(--danger)]">{error}</p>}

          <Button type="submit" disabled={submitting}>
            {submitting ? <Loader2 size={16} className="animate-spin" /> : null}
            Submit
          </Button>
        </form>
      </Card>
    </div>
  );
}
