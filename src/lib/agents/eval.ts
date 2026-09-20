import "server-only";
import { generateObject } from "ai";
import { z } from "zod";
import { chatModel } from "@/lib/ai/provider";
import { runAgentOnce, type AgentRuntimeConfig, type AgentRuntimeCtx } from "./runtime";

interface EvalCaseRow {
  id: string;
  prompt: string;
  expected_criteria: string;
}

const gradeSchema = z.object({
  pass: z.boolean(),
  reason: z.string().describe("One-sentence justification"),
});

// LLM-as-judge — generateObject isn't used anywhere else in this codebase
// yet, but is the idiomatic tool for structured pass/fail grading, and
// chatModel (src/lib/ai/provider.ts) is already a ready-to-use singleton.
async function gradeResponse(prompt: string, expectedCriteria: string, actual: string) {
  const { object } = await generateObject({
    model: chatModel,
    schema: gradeSchema,
    system:
      "You are grading whether an AI agent's response satisfies the given criteria. Be strict but fair — the response doesn't need to match word-for-word, but it must genuinely satisfy the criteria.",
    prompt: `Test prompt given to the agent:\n${prompt}\n\nExpected criteria:\n${expectedCriteria}\n\nAgent's actual response:\n${actual}\n\nDoes the actual response satisfy the expected criteria?`,
  });
  return object;
}

// Bounded concurrency, not fully serial or fully parallel — there's no
// background-job system in this app (runEvalRound executes synchronously
// inside the triggering request), so batching cuts wall-clock roughly
// proportionally without opening up unbounded concurrent model calls.
const CONCURRENCY = 4;

async function runInBatches<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    const batch = items.slice(i, i + size);
    results.push(...(await Promise.all(batch.map(fn))));
  }
  return results;
}

export async function runEvalRound(
  ctx: AgentRuntimeCtx,
  agent: AgentRuntimeConfig,
  cases: EvalCaseRow[],
): Promise<{ roundId: string; passRate: number }> {
  const { data: round, error: roundError } = await ctx.supabase
    .from("agent_eval_rounds")
    .insert({
      agent_id: agent.id,
      organization_id: ctx.orgId,
      triggered_by: ctx.userId,
      status: "running",
      total_cases: cases.length,
    })
    .select("id")
    .single();

  if (roundError || !round) throw new Error(roundError?.message ?? "Could not start eval round");

  try {
    const outcomes = await runInBatches(cases, CONCURRENCY, async (c) => {
      const { text, toolCalls } = await runAgentOnce(ctx, agent, c.prompt);
      const grade = await gradeResponse(c.prompt, c.expected_criteria, text);
      return { caseId: c.id, output: text, toolCalls, pass: grade.pass, reason: grade.reason };
    });

    await ctx.supabase.from("agent_eval_results").insert(
      outcomes.map((o) => ({
        round_id: round.id,
        case_id: o.caseId,
        organization_id: ctx.orgId,
        agent_output: o.output,
        pass: o.pass,
        judge_reason: o.reason,
        tool_calls: o.toolCalls,
      })),
    );

    const passedCases = outcomes.filter((o) => o.pass).length;
    const passRate = cases.length > 0 ? passedCases / cases.length : 0;

    await ctx.supabase
      .from("agent_eval_rounds")
      .update({
        status: "completed",
        passed_cases: passedCases,
        pass_rate: passRate,
        completed_at: new Date().toISOString(),
      })
      .eq("id", round.id);

    // Informational only — the publish gate checks the latest round's
    // pass_rate directly, not this status field.
    await ctx.supabase.from("agents").update({ status: "testing" }).eq("id", agent.id).eq("status", "draft");

    return { roundId: round.id, passRate };
  } catch (err) {
    await ctx.supabase
      .from("agent_eval_rounds")
      .update({ status: "failed", completed_at: new Date().toISOString() })
      .eq("id", round.id);
    throw err;
  }
}
