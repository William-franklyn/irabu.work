import { z } from "zod";
import { TOOL_NAMES } from "@/lib/ai/tools";

export const AGENT_STATUSES = ["draft", "testing", "published", "archived"] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

export const agentConfigSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).nullable().optional(),
  systemPrompt: z.string().max(20000).default(""),
  biasInstructions: z.string().max(5000).nullable().optional(),
  enabledTools: z.array(z.enum(TOOL_NAMES)).default([]),
});

export type AgentConfig = z.infer<typeof agentConfigSchema>;

export const knowledgeWeightSchema = z.object({
  sourceId: z.string().uuid(),
  weight: z.number().min(0).max(5),
});

export const evalCaseSchema = z.object({
  prompt: z.string().min(1).max(4000),
  expectedCriteria: z.string().min(1).max(4000),
});

export type EvalCase = z.infer<typeof evalCaseSchema>;
