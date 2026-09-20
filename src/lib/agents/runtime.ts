import "server-only";
import { tool, generateText, stepCountIs } from "ai";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { chatModel } from "@/lib/ai/provider";
import { buildTools } from "@/lib/ai/tools";
import { TOOL_DESCRIPTIONS } from "@/lib/ai/toolDescriptions";
import { searchKnowledgeWeighted } from "@/lib/knowledge/agentRetrieval";

/**
 * The single shared invocation core for a custom agent — imported by the
 * eval harness, the teammate test route, and the public API route, so all
 * three always run the identical prompt/tool-set/retrieval. This is the
 * load-bearing correctness property of the whole feature: if eval graded a
 * different effective config than what actually runs, "test until 90% pass
 * rate then publish" would be a lie the product tells itself.
 */
export interface AgentRuntimeConfig {
  id: string;
  name: string;
  systemPrompt: string;
  biasInstructions: string | null;
  enabledTools: string[];
}

export interface AgentRuntimeCtx {
  supabase: SupabaseClient;
  orgId: string;
  userId: string;
  userEmail?: string | null;
}

export function buildAgentSystemPrompt(agent: AgentRuntimeConfig): string {
  const toolBullets = agent.enabledTools
    .filter((name) => TOOL_DESCRIPTIONS[name])
    .map((name) => `- ${TOOL_DESCRIPTIONS[name]}`)
    .join("\n");

  const toolsBlock = toolBullets
    ? `\n\nYou have these tools:\n${toolBullets}`
    : "\n\nYou have no tools — answer from the persona above alone.";

  const biasBlock = agent.biasInstructions
    ? `\n\nAdditional guidance for how you respond:\n${agent.biasInstructions}`
    : "";

  const persona = agent.systemPrompt.trim() || `You are ${agent.name}, a specialized assistant.`;

  return `${persona}${toolsBlock}${biasBlock}`;
}

async function getSourceWeights(
  supabase: SupabaseClient,
  agentId: string,
): Promise<Record<string, number>> {
  const { data } = await supabase
    .from("agent_knowledge_sources")
    .select("source_id, weight")
    .eq("agent_id", agentId);

  const weights: Record<string, number> = {};
  for (const row of data ?? []) weights[row.source_id as string] = row.weight as number;
  return weights;
}

export async function buildAgentTools(ctx: AgentRuntimeCtx, agent: AgentRuntimeConfig) {
  const allTools = buildTools({
    supabase: ctx.supabase,
    orgId: ctx.orgId,
    userId: ctx.userId,
    userEmail: ctx.userEmail,
  });

  const filtered = Object.fromEntries(
    Object.entries(allTools).filter(([name]) => agent.enabledTools.includes(name)),
  ) as typeof allTools;

  // Same description/schema as the main assistant's search_knowledge — only
  // the closure differs, so it retrieves from this agent's hard-scoped,
  // weighted knowledge sources instead of the whole org's knowledge base.
  if ("search_knowledge" in filtered) {
    const sourceWeights = await getSourceWeights(ctx.supabase, agent.id);
    filtered.search_knowledge = tool({
      description:
        "Search the team's uploaded knowledge base for passages relevant to a question. Always use this before answering anything that could be grounded in the team's documents.",
      inputSchema: z.object({
        query: z.string().describe("The search query, in natural language"),
      }),
      execute: async ({ query }) => {
        const chunks = await searchKnowledgeWeighted(ctx.supabase, ctx.orgId, query, sourceWeights);
        if (chunks.length === 0) return { found: false as const };
        return {
          found: true as const,
          chunks: chunks.map((c) => ({ sourceId: c.sourceId, sourceName: c.sourceName, content: c.content })),
        };
      },
    });
  }

  return filtered;
}

export async function runAgentOnce(ctx: AgentRuntimeCtx, agent: AgentRuntimeConfig, input: string) {
  const tools = await buildAgentTools(ctx, agent);
  const result = await generateText({
    model: chatModel,
    system: buildAgentSystemPrompt(agent),
    prompt: input,
    tools,
    stopWhen: stepCountIs(5),
  });
  return { text: result.text, toolCalls: result.toolCalls };
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || "agent";
}

/**
 * Delegation-as-a-tool: a published + visible_in_assistant agent becomes one
 * more tool the main assistant can call, additive to its existing single
 * system prompt/tool-loop rather than swapping the main assistant's identity
 * mid-conversation — the smaller, lower-risk shape for a v1 chat toggle.
 */
export async function buildDelegateTools(ctx: AgentRuntimeCtx) {
  const { data: published } = await ctx.supabase
    .from("agents")
    .select("id, name, description, system_prompt, bias_instructions, enabled_tools")
    .eq("organization_id", ctx.orgId)
    .eq("status", "published")
    .eq("visible_in_assistant", true);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tools: Record<string, any> = {};
  // Returned alongside tools (not read off the tool object) so the caller
  // can build a prompt bullet list without depending on how the `ai` SDK
  // exposes a tool's description internally.
  const descriptions: Record<string, string> = {};
  const usedNames = new Set<string>();

  for (const row of published ?? []) {
    let toolName = `ask_${slugify(row.name)}`;
    while (usedNames.has(toolName)) toolName = `${toolName}_`;
    usedNames.add(toolName);

    const agent: AgentRuntimeConfig = {
      id: row.id,
      name: row.name,
      systemPrompt: row.system_prompt,
      biasInstructions: row.bias_instructions,
      enabledTools: row.enabled_tools,
    };

    const description =
      row.description?.trim() ||
      `Ask the specialized agent "${row.name}" a question — use this when the request is specifically in its domain rather than general.`;
    descriptions[toolName] = description;

    tools[toolName] = tool({
      description,
      inputSchema: z.object({ query: z.string().describe("What to ask this agent, in natural language") }),
      execute: async ({ query }) => {
        const result = await runAgentOnce(ctx, agent, query);
        return { answer: result.text };
      },
    });
  }

  return { tools, descriptions };
}
