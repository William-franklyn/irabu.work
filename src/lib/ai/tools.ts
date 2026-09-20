import { tool } from "ai";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { searchKnowledge } from "@/lib/knowledge/retrieval";
import { logActivity } from "@/lib/activity";
import { sendMeetingInvite, sendMeetingCancellation } from "@/lib/email/meeting-invite";
import { summarizeDataset, groupByAggregate, type Aggregate } from "@/lib/knowledge/analyze";
import type { Dataset } from "@/lib/knowledge/tabular";
import type { FormField } from "@/lib/forms/types";
import { listTransactions, createDeposit } from "@/lib/nessie/client";
import { getEffectiveBalance } from "@/lib/nessie/balance";

async function fetchMembers(supabase: SupabaseClient, orgId: string) {
  const { data } = await supabase
    .from("memberships")
    .select("user_id, profiles(full_name)")
    .eq("organization_id", orgId);

  return (data ?? []).map((row) => {
    const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
    return { userId: row.user_id as string, fullName: (profile?.full_name ?? "") as string };
  });
}

function matchMemberByName(members: { userId: string; fullName: string }[], name: string) {
  const matches = members.filter((m) => m.fullName.toLowerCase().includes(name.toLowerCase()));
  return matches.length === 1 ? matches[0] : null;
}

export function buildTools(ctx: {
  supabase: SupabaseClient;
  orgId: string;
  userId: string;
  userEmail?: string | null;
}) {
  return {
    search_knowledge: tool({
      description:
        "Search the team's uploaded knowledge base for passages relevant to a question. Always use this before answering anything that could be grounded in the team's documents.",
      inputSchema: z.object({
        query: z.string().describe("The search query, in natural language"),
      }),
      execute: async ({ query }) => {
        const chunks = await searchKnowledge(ctx.supabase, ctx.orgId, ctx.userId, query);
        if (chunks.length === 0) {
          return { found: false as const };
        }
        return {
          found: true as const,
          chunks: chunks.map((c) => ({
            sourceId: c.sourceId,
            sourceName: c.sourceName,
            content: c.content,
          })),
        };
      },
    }),

    create_task: tool({
      description:
        "Create a task for the team — an action item or to-do to track. Assign it to a teammate by name if the user says who should do it.",
      inputSchema: z.object({
        title: z.string(),
        dueDate: z
          .string()
          .optional()
          .describe("ISO date (YYYY-MM-DD), if the user gave one"),
        assigneeName: z.string().optional().describe("Name of the teammate to assign this to, if given"),
      }),
      execute: async ({ title, dueDate, assigneeName }) => {
        let assignedTo: string | null = null;
        if (assigneeName) {
          const members = await fetchMembers(ctx.supabase, ctx.orgId);
          const match = matchMemberByName(members, assigneeName);
          if (!match) {
            return {
              ok: false as const,
              reason: "assignee_not_found" as const,
              availableNames: members.map((m) => m.fullName).filter(Boolean),
            };
          }
          assignedTo = match.userId;
        }

        const { data, error } = await ctx.supabase
          .from("tasks")
          .insert({
            organization_id: ctx.orgId,
            created_by: ctx.userId,
            title,
            due_date: dueDate ?? null,
            assigned_to: assignedTo,
          })
          .select("id")
          .single();

        if (error) return { ok: false as const, error: error.message };

        await logActivity(ctx.supabase, {
          organizationId: ctx.orgId,
          actorId: ctx.userId,
          action: "created_task",
          detail: assigneeName
            ? `Assistant created task: ${title} (assigned to ${assigneeName})`
            : `Assistant created task: ${title}`,
        });

        return { ok: true as const, taskId: data.id, title, assigneeName: assigneeName ?? null };
      },
    }),

    list_tasks: tool({
      description: "List the team's tasks — everything open by default, or filter to just the user's own.",
      inputSchema: z.object({
        assignedToMe: z.boolean().optional().describe("True to show only tasks assigned to the current user"),
        status: z.enum(["open", "done", "all"]).optional().describe("Defaults to 'open'"),
      }),
      execute: async ({ assignedToMe, status }) => {
        let query = ctx.supabase
          .from("tasks")
          .select("title, status, due_date, assigned_to")
          .eq("organization_id", ctx.orgId)
          .order("due_date", { ascending: true, nullsFirst: false });

        if (status !== "all") query = query.eq("status", status ?? "open");
        if (assignedToMe) query = query.eq("assigned_to", ctx.userId);

        const { data, error } = await query;
        if (error) return { ok: false as const, error: error.message };

        const members = await fetchMembers(ctx.supabase, ctx.orgId);
        const nameById = new Map(members.map((m) => [m.userId, m.fullName]));

        return {
          ok: true as const,
          tasks: (data ?? []).map((t) => ({
            title: t.title,
            status: t.status,
            dueDate: t.due_date,
            assigneeName: t.assigned_to ? nameById.get(t.assigned_to) ?? null : null,
          })),
        };
      },
    }),

    complete_task: tool({
      description: "Mark a task as done, matched by title.",
      inputSchema: z.object({
        titleQuery: z.string().describe("Text to match against task titles"),
      }),
      execute: async ({ titleQuery }) => {
        const { data, error } = await ctx.supabase
          .from("tasks")
          .select("id, title")
          .eq("organization_id", ctx.orgId)
          .eq("status", "open")
          .ilike("title", `%${titleQuery}%`);

        if (error) return { ok: false as const, reason: "error" as const, error: error.message };
        if (!data || data.length === 0) return { ok: false as const, reason: "not_found" as const };
        if (data.length > 1) {
          return { ok: false as const, reason: "ambiguous" as const, candidates: data.map((t) => t.title) };
        }

        const task = data[0];
        const { error: updateError } = await ctx.supabase
          .from("tasks")
          .update({ status: "done" })
          .eq("id", task.id);
        if (updateError) return { ok: false as const, reason: "error" as const, error: updateError.message };

        return { ok: true as const, title: task.title };
      },
    }),

    schedule_meeting: tool({
      description:
        "Schedule a meeting for the team, at a specific date and time. If the user gives an external attendee's email, invite them — they'll get an actual calendar invite by email.",
      inputSchema: z.object({
        title: z.string(),
        startsAt: z.string().describe("ISO 8601 date-time, e.g. 2026-09-20T14:00:00"),
        durationMinutes: z.number().optional().describe("Defaults to 30 if not given"),
        notes: z.string().optional(),
        attendeeEmail: z.string().email().optional().describe("External attendee to email an invite to, if given"),
      }),
      execute: async ({ title, startsAt, durationMinutes, notes, attendeeEmail }) => {
        const duration = durationMinutes ?? 30;
        const { data, error } = await ctx.supabase
          .from("meetings")
          .insert({
            organization_id: ctx.orgId,
            created_by: ctx.userId,
            title,
            starts_at: startsAt,
            duration_minutes: duration,
            notes: notes ?? null,
            attendee_email: attendeeEmail ?? null,
          })
          .select("id")
          .single();

        if (error) return { ok: false as const, error: error.message };

        await logActivity(ctx.supabase, {
          organizationId: ctx.orgId,
          actorId: ctx.userId,
          action: "scheduled_meeting",
          detail: `Assistant scheduled meeting: ${title}`,
        });

        let emailSent = false;
        if (attendeeEmail) {
          const result = await sendMeetingInvite({
            meetingId: data.id,
            title,
            startsAt,
            durationMinutes: duration,
            notes,
            attendeeEmail,
          });
          emailSent = result.sent;
        }

        return { ok: true as const, meetingId: data.id, title, startsAt, attendeeEmail, emailSent };
      },
    }),

    list_meetings: tool({
      description: "List the team's upcoming meetings.",
      inputSchema: z.object({}),
      execute: async () => {
        const { data, error } = await ctx.supabase
          .from("meetings")
          .select("id, title, starts_at, duration_minutes, attendee_email")
          .eq("organization_id", ctx.orgId)
          .gte("starts_at", new Date().toISOString())
          .order("starts_at", { ascending: true })
          .limit(20);

        if (error) return { ok: false as const, error: error.message };
        return { ok: true as const, meetings: data };
      },
    }),

    cancel_meeting: tool({
      description:
        "Cancel (delete) an upcoming meeting by matching its title. If more than one meeting matches, this returns the candidates instead of guessing which one to cancel.",
      inputSchema: z.object({
        titleQuery: z.string().describe("Text to match against upcoming meeting titles"),
      }),
      execute: async ({ titleQuery }) => {
        const { data, error } = await ctx.supabase
          .from("meetings")
          .select("id, title, starts_at, duration_minutes, notes, attendee_email")
          .eq("organization_id", ctx.orgId)
          .ilike("title", `%${titleQuery}%`)
          .gte("starts_at", new Date().toISOString())
          .order("starts_at", { ascending: true });

        if (error) return { ok: false as const, reason: "error" as const, error: error.message };
        if (!data || data.length === 0) {
          return { ok: false as const, reason: "not_found" as const };
        }
        if (data.length > 1) {
          return { ok: false as const, reason: "ambiguous" as const, candidates: data };
        }

        const meeting = data[0];
        const { error: deleteError } = await ctx.supabase
          .from("meetings")
          .delete()
          .eq("id", meeting.id)
          .eq("organization_id", ctx.orgId);
        if (deleteError) return { ok: false as const, reason: "error" as const, error: deleteError.message };

        await logActivity(ctx.supabase, {
          organizationId: ctx.orgId,
          actorId: ctx.userId,
          action: "cancelled_meeting",
          detail: `Assistant cancelled meeting: ${meeting.title}`,
        });

        if (meeting.attendee_email) {
          await sendMeetingCancellation({
            meetingId: meeting.id,
            title: meeting.title,
            startsAt: meeting.starts_at,
            durationMinutes: meeting.duration_minutes,
            notes: meeting.notes,
            attendeeEmail: meeting.attendee_email,
          });
        }

        return { ok: true as const, title: meeting.title };
      },
    }),

    draft_email: tool({
      description:
        "Draft an email for the user to review, edit, and send themselves. This NEVER sends anything — it only creates a draft that opens in a review panel. Use it whenever the user asks you to write, draft, or compose an email.",
      inputSchema: z.object({
        to: z.string().optional().describe("Recipient email address, if the user gave one — otherwise leave blank"),
        subject: z.string(),
        body: z.string().describe("Plain-text email body"),
      }),
      execute: async ({ to, subject, body }) => {
        const { data, error } = await ctx.supabase
          .from("email_drafts")
          .insert({
            organization_id: ctx.orgId,
            created_by: ctx.userId,
            to_email: to ?? "",
            subject,
            body,
            reply_to_email: ctx.userEmail ?? null,
          })
          .select("id")
          .single();

        if (error) return { ok: false as const, error: error.message };

        await logActivity(ctx.supabase, {
          organizationId: ctx.orgId,
          actorId: ctx.userId,
          action: "drafted_email",
          detail: `Assistant drafted email: ${subject}`,
        });

        return { ok: true as const, draftId: data.id, to: to ?? "", subject };
      },
    }),

    analyze_data: tool({
      description:
        "Compute real statistics over an uploaded data file (CSV or a JSON array of records) — sums, averages, min/max, and grouped breakdowns. Use this instead of search_knowledge whenever the question requires math across every row (totals, averages, \"which X has the highest Y\") rather than finding relevant passages. Follow up with generate_chart to visualize the result if useful.",
      inputSchema: z.object({
        sourceName: z.string().describe("Name (or partial name) of the uploaded data file to analyze"),
        groupBy: z.string().optional().describe("Column to break the metric down by, e.g. 'region' or 'quarter'"),
        metric: z.string().optional().describe("Numeric column to aggregate — required if groupBy is given"),
        aggregate: z
          .enum(["sum", "avg", "min", "max", "count"])
          .optional()
          .describe("How to aggregate the metric within each group. Defaults to sum."),
      }),
      execute: async ({ sourceName, groupBy, metric, aggregate }) => {
        const { data: matches, error } = await ctx.supabase
          .from("knowledge_sources")
          .select("id, name, dataset")
          .eq("organization_id", ctx.orgId)
          .not("dataset", "is", null)
          .ilike("name", `%${sourceName}%`);

        if (error) return { ok: false as const, reason: "error" as const, error: error.message };
        if (!matches || matches.length === 0) {
          return { ok: false as const, reason: "not_found" as const };
        }
        if (matches.length > 1) {
          return {
            ok: false as const,
            reason: "ambiguous" as const,
            candidates: matches.map((m) => m.name),
          };
        }

        const source = matches[0];
        const dataset = source.dataset as Dataset;
        const columnSummary = summarizeDataset(dataset);

        if (groupBy && metric) {
          if (!dataset.columns.includes(groupBy) || !dataset.columns.includes(metric)) {
            return {
              ok: false as const,
              reason: "unknown_column" as const,
              columns: dataset.columns,
            };
          }
          const grouped = groupByAggregate(dataset, groupBy, metric, (aggregate ?? "sum") as Aggregate);
          return {
            ok: true as const,
            sourceName: source.name,
            rowCount: dataset.rows.length,
            columns: dataset.columns,
            groupBy: { column: groupBy, metric, aggregate: aggregate ?? "sum", rows: grouped },
          };
        }

        return {
          ok: true as const,
          sourceName: source.name,
          rowCount: dataset.rows.length,
          columns: dataset.columns,
          summary: columnSummary,
        };
      },
    }),

    restrict_source_access: tool({
      description:
        "Restrict specific workspace members from accessing an uploaded knowledge source, or clear restrictions so everyone can access it again. Everyone in the workspace can access a source by default — this only adds or removes names from a deny-list on top of that.",
      inputSchema: z.object({
        sourceName: z.string().describe("Name (or partial name) of the uploaded document"),
        restrictNames: z
          .array(z.string())
          .optional()
          .describe("Names of members to restrict from this source"),
        clearAll: z
          .boolean()
          .optional()
          .describe("Set true to remove all restrictions on this source instead"),
      }),
      execute: async ({ sourceName, restrictNames, clearAll }) => {
        const { data: sourceMatches, error: sourceError } = await ctx.supabase
          .from("knowledge_sources")
          .select("id, name")
          .eq("organization_id", ctx.orgId)
          .ilike("name", `%${sourceName}%`);

        if (sourceError) return { ok: false as const, reason: "error" as const, error: sourceError.message };
        if (!sourceMatches || sourceMatches.length === 0) {
          return { ok: false as const, reason: "source_not_found" as const };
        }
        if (sourceMatches.length > 1) {
          return {
            ok: false as const,
            reason: "source_ambiguous" as const,
            candidates: sourceMatches.map((s) => s.name),
          };
        }
        const source = sourceMatches[0];

        if (clearAll) {
          await ctx.supabase.from("knowledge_source_restrictions").delete().eq("source_id", source.id);
          return { ok: true as const, sourceName: source.name, cleared: true as const };
        }

        if (!restrictNames || restrictNames.length === 0) {
          return { ok: false as const, reason: "no_names_given" as const };
        }

        const members = await fetchMembers(ctx.supabase, ctx.orgId);

        const matchedUserIds: string[] = [];
        const unmatched: string[] = [];
        for (const name of restrictNames) {
          const match = matchMemberByName(members, name);
          if (match) matchedUserIds.push(match.userId);
          else unmatched.push(name);
        }

        if (unmatched.length > 0) {
          return {
            ok: false as const,
            reason: "member_not_found" as const,
            unmatched,
            availableNames: members.map((m) => m.fullName).filter(Boolean),
          };
        }

        await ctx.supabase.from("knowledge_source_restrictions").upsert(
          matchedUserIds.map((userId) => ({
            source_id: source.id,
            organization_id: ctx.orgId,
            restricted_user_id: userId,
          })),
          { onConflict: "source_id,restricted_user_id", ignoreDuplicates: true },
        );

        await logActivity(ctx.supabase, {
          organizationId: ctx.orgId,
          actorId: ctx.userId,
          action: "restricted_source",
          detail: `Restricted access to ${source.name} for ${restrictNames.join(", ")}`,
        });

        return { ok: true as const, sourceName: source.name, restrictedCount: matchedUserIds.length };
      },
    }),

    create_form: tool({
      description:
        "Create a form with the given questions and publish it so it's ready to share. Use this when the user asks to create, build, or make a form or survey.",
      inputSchema: z.object({
        title: z.string(),
        description: z.string().optional(),
        fields: z
          .array(
            z.object({
              label: z.string(),
              type: z.enum(["text", "textarea", "number", "email", "select", "checkbox", "date"]),
              required: z.boolean().optional(),
              options: z.array(z.string()).optional().describe("Choices, only for type 'select'"),
            }),
          )
          .describe("The questions on the form, in order"),
        publish: z.boolean().optional().describe("Defaults to true — false creates it as an unpublished draft"),
      }),
      execute: async ({ title, description, fields, publish }) => {
        const formFields: FormField[] = fields.map((f) => ({
          id: crypto.randomUUID(),
          label: f.label,
          type: f.type,
          required: f.required ?? false,
          options: f.options,
        }));

        const { data, error } = await ctx.supabase
          .from("forms")
          .insert({
            organization_id: ctx.orgId,
            created_by: ctx.userId,
            title,
            description: description ?? null,
            fields: formFields,
            status: publish === false ? "draft" : "published",
          })
          .select("id")
          .single();

        if (error) return { ok: false as const, error: error.message };

        await logActivity(ctx.supabase, {
          organizationId: ctx.orgId,
          actorId: ctx.userId,
          action: "created_form",
          detail: `Assistant created form: ${title}`,
        });

        const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
        return {
          ok: true as const,
          formId: data.id,
          title,
          published: publish !== false,
          publicUrl: `${appUrl}/f/${data.id}`,
        };
      },
    }),

    list_form_responses: tool({
      description: "Look up responses submitted to a form the user has created.",
      inputSchema: z.object({
        formName: z.string().describe("Name (or partial name) of the form"),
      }),
      execute: async ({ formName }) => {
        const { data: matches, error } = await ctx.supabase
          .from("forms")
          .select("id, title, fields")
          .eq("organization_id", ctx.orgId)
          .ilike("title", `%${formName}%`);

        if (error) return { ok: false as const, reason: "error" as const, error: error.message };
        if (!matches || matches.length === 0) return { ok: false as const, reason: "not_found" as const };
        if (matches.length > 1) {
          return {
            ok: false as const,
            reason: "ambiguous" as const,
            candidates: matches.map((m) => m.title),
          };
        }

        const form = matches[0];
        const fields = form.fields as FormField[];
        const labelById = new Map(fields.map((f) => [f.id, f.label]));

        const { data: responses } = await ctx.supabase
          .from("form_responses")
          .select("answers, submitted_at")
          .eq("form_id", form.id)
          .order("submitted_at", { ascending: false })
          .limit(20);

        const readable = (responses ?? []).map((r) => {
          const answers = r.answers as Record<string, string | number | boolean>;
          const named: Record<string, string | number | boolean> = {};
          for (const [fieldId, value] of Object.entries(answers)) {
            named[labelById.get(fieldId) ?? fieldId] = value;
          }
          return { submittedAt: r.submitted_at, answers: named };
        });

        return {
          ok: true as const,
          formTitle: form.title,
          responseCount: readable.length,
          responses: readable,
        };
      },
    }),

    get_account_balance: tool({
      description: "Get the workspace's connected Capital One (demo) account balance.",
      inputSchema: z.object({}),
      execute: async () => {
        const { data: connection } = await ctx.supabase
          .from("nessie_connections")
          .select("account_id, nickname")
          .eq("organization_id", ctx.orgId)
          .maybeSingle();
        if (!connection) return { ok: false as const, reason: "not_connected" as const };

        try {
          const { nickname, balance } = await getEffectiveBalance(ctx.supabase, ctx.orgId, connection.account_id);
          return { ok: true as const, nickname, balance };
        } catch (err) {
          return { ok: false as const, reason: "error" as const, error: String(err) };
        }
      },
    }),

    list_transactions: tool({
      description: "List recent transactions on the workspace's connected Capital One (demo) account.",
      inputSchema: z.object({
        limit: z.number().optional().describe("Max transactions to return, defaults to 10"),
      }),
      execute: async ({ limit }) => {
        const { data: connection } = await ctx.supabase
          .from("nessie_connections")
          .select("account_id")
          .eq("organization_id", ctx.orgId)
          .maybeSingle();
        if (!connection) return { ok: false as const, reason: "not_connected" as const };

        try {
          const transactions = await listTransactions(connection.account_id);
          return { ok: true as const, transactions: transactions.slice(0, limit ?? 10) };
        } catch (err) {
          return { ok: false as const, reason: "error" as const, error: String(err) };
        }
      },
    }),

    analyze_spending: tool({
      description:
        "Break down spending on the workspace's connected Capital One (demo) account — totals, and by vendor/description. Use this instead of list_transactions when the user asks about totals or 'where did the money go' rather than a raw list.",
      inputSchema: z.object({}),
      execute: async () => {
        const { data: connection } = await ctx.supabase
          .from("nessie_connections")
          .select("account_id")
          .eq("organization_id", ctx.orgId)
          .maybeSingle();
        if (!connection) return { ok: false as const, reason: "not_connected" as const };

        try {
          const transactions = await listTransactions(connection.account_id);
          const spending = transactions.filter((t) => t.amount < 0);
          const totalSpent = spending.reduce((sum, t) => sum + Math.abs(t.amount), 0);

          const byVendor = new Map<string, number>();
          for (const t of spending) {
            byVendor.set(t.description, (byVendor.get(t.description) ?? 0) + Math.abs(t.amount));
          }
          const breakdown = [...byVendor.entries()]
            .map(([vendor, amount]) => ({ vendor, amount }))
            .sort((a, b) => b.amount - a.amount)
            .slice(0, 20);

          return { ok: true as const, totalSpent, transactionCount: spending.length, breakdown };
        } catch (err) {
          return { ok: false as const, reason: "error" as const, error: String(err) };
        }
      },
    }),

    pay_vendor: tool({
      description:
        "Draft a payment to a vendor from the workspace's connected Capital One (demo) account. This NEVER actually pays anyone — it only creates a pending payment that opens in a review panel for a human to approve and send.",
      inputSchema: z.object({
        vendorName: z.string(),
        amount: z.number().positive(),
        description: z.string().optional(),
      }),
      execute: async ({ vendorName, amount, description }) => {
        const { data: connection } = await ctx.supabase
          .from("nessie_connections")
          .select("id")
          .eq("organization_id", ctx.orgId)
          .maybeSingle();
        if (!connection) return { ok: false as const, reason: "not_connected" as const };

        const { data, error } = await ctx.supabase
          .from("pending_payments")
          .insert({
            organization_id: ctx.orgId,
            created_by: ctx.userId,
            vendor_name: vendorName,
            amount,
            description: description ?? null,
          })
          .select("id")
          .single();

        if (error) return { ok: false as const, reason: "error" as const, error: error.message };

        await logActivity(ctx.supabase, {
          organizationId: ctx.orgId,
          actorId: ctx.userId,
          action: "drafted_payment",
          detail: `Assistant drafted payment to ${vendorName}: $${amount.toFixed(2)}`,
        });

        return { ok: true as const, paymentId: data.id, vendorName, amount };
      },
    }),

    receive_payment: tool({
      description:
        "Record money received into the workspace's connected Capital One (demo) account — use this when the user says they got paid, were reimbursed, or received a deposit. Unlike pay_vendor this records immediately since receiving money carries no approval risk.",
      inputSchema: z.object({
        fromName: z.string().describe("Who or what the money came from"),
        amount: z.number().positive(),
        notes: z.string().optional(),
      }),
      execute: async ({ fromName, amount, notes }) => {
        const { data: connection } = await ctx.supabase
          .from("nessie_connections")
          .select("account_id")
          .eq("organization_id", ctx.orgId)
          .maybeSingle();
        if (!connection) return { ok: false as const, reason: "not_connected" as const };

        let depositId: string;
        try {
          depositId = await createDeposit({
            accountId: connection.account_id,
            amount,
            description: notes || `From ${fromName}`,
          });
        } catch (err) {
          return { ok: false as const, reason: "error" as const, error: String(err) };
        }

        await ctx.supabase.from("receipts").insert({
          organization_id: ctx.orgId,
          direction: "received",
          counterparty: fromName,
          amount,
          notes: notes ?? null,
          transaction_id: depositId,
          created_by: ctx.userId,
        });

        await logActivity(ctx.supabase, {
          organizationId: ctx.orgId,
          actorId: ctx.userId,
          action: "received_payment",
          detail: `Received from ${fromName}: $${amount.toFixed(2)}`,
        });

        return { ok: true as const, fromName, amount };
      },
    }),

    get_receipt: tool({
      description:
        "Look up the details of a specific past transaction — who it was with, the exact date and time, the transaction id, and any notes. Defaults to the most recent transaction if no name is given.",
      inputSchema: z.object({
        query: z.string().optional().describe("Name of the person or vendor to search for, if looking for a specific transaction"),
      }),
      execute: async ({ query }) => {
        let dbQuery = ctx.supabase
          .from("receipts")
          .select("direction, counterparty, amount, notes, transaction_id, occurred_at")
          .eq("organization_id", ctx.orgId)
          .order("occurred_at", { ascending: false });

        if (query) dbQuery = dbQuery.ilike("counterparty", `%${query}%`);

        const { data, error } = await dbQuery.limit(query ? 5 : 1);
        if (error) return { ok: false as const, reason: "error" as const, error: error.message };
        if (!data || data.length === 0) return { ok: false as const, reason: "not_found" as const };

        return {
          ok: true as const,
          receipts: data.map((r) => ({
            direction: r.direction,
            counterparty: r.counterparty,
            amount: Number(r.amount),
            notes: r.notes,
            transactionId: r.transaction_id,
            occurredAt: r.occurred_at,
          })),
        };
      },
    }),

    generate_chart: tool({
      description:
        "Render a chart or a single stat tile from numeric data for the user. Use this any time the user asks to visualize, chart, plot, graph, or break down numbers — including data they just gave you in the conversation.",
      inputSchema: z.object({
        kind: z.enum(["bar", "line", "stat"]),
        title: z.string(),
        categoryKey: z
          .string()
          .optional()
          .describe("The data field to use as the x-axis / category, for bar and line"),
        series: z
          .array(z.object({ key: z.string(), label: z.string() }))
          .optional()
          .describe("Numeric fields to plot, for bar and line"),
        data: z
          .array(z.record(z.string(), z.union([z.string(), z.number()])))
          .optional()
          .describe("Rows of data, for bar and line"),
        value: z.number().optional().describe("The number to show, for a stat tile"),
        unit: z.string().optional().describe("e.g. \"$\", \"%\", \"users\""),
      }),
      execute: async (spec) => spec,
    }),
  };
}

// The single source of truth for valid tool names — used by Agents Lab's
// tool-grant Zod schema and builder UI so a hand-synced second list can't
// drift from this one. Object.keys never invokes a tool's `execute`, so a
// dummy ctx is safe: only the eager description/inputSchema construction
// runs, and neither touches ctx.
export const TOOL_NAMES = Object.keys(
  buildTools({} as Parameters<typeof buildTools>[0]),
) as [string, ...string[]];
