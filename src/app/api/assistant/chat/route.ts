import { NextRequest, NextResponse } from "next/server";
import { streamText, convertToModelMessages, stepCountIs, type UIMessage } from "ai";
import { requireAuthApi } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { chatModel } from "@/lib/ai/provider";
import { buildTools, TOOL_NAMES } from "@/lib/ai/tools";
import { TOOL_DESCRIPTIONS } from "@/lib/ai/toolDescriptions";
import { buildDelegateTools } from "@/lib/agents/runtime";
import { getCitations, getChart, getText, classifyUsageEvents } from "@/lib/ai/message-parts";
import { settleUnsettledUsage, SETTLE_BATCH_SIZE } from "@/lib/solana/settlement";
import { isBackboardConfigured, getOrCreateAssistantId, searchMemories, writeMemory } from "@/lib/backboard/client";

function systemPrompt(memoryContext?: string, delegateDescriptions?: Record<string, string>) {
  const now = new Date();
  const today = now.toLocaleDateString("en-CA"); // YYYY-MM-DD
  const weekday = now.toLocaleDateString("en-US", { weekday: "long" });

  const memoryBlock = memoryContext
    ? `\n\nRelevant memory from past conversations with this workspace (use it silently — never mention "memory" or that you recalled something, just use the facts naturally if relevant; ignore anything irrelevant to the current question):\n${memoryContext}`
    : "";

  const toolBullets = TOOL_NAMES.map((name) => `- ${TOOL_DESCRIPTIONS[name]}`).join("\n");

  const delegateEntries = Object.entries(delegateDescriptions ?? {});
  const delegateBlock = delegateEntries.length
    ? `\n\nThis workspace also has specialized agents you can delegate to:\n${delegateEntries
        .map(([name, desc]) => `- ${name}: ${desc}`)
        .join("\n")}`
    : "";

  return `You are the iRABU assistant for this workspace. Today is ${weekday}, ${today} (use this to resolve relative dates like "tomorrow" or "next Friday" — never ask the user what today's date is). You have these tools:

${toolBullets}${delegateBlock}

Be concise and direct. When you cite knowledge, refer to the source naturally in your sentence (e.g. "According to the Q3 plan…") — the UI attaches full citation details on its own.${memoryBlock}`;
}

export async function POST(req: NextRequest) {
  const auth = await requireAuthApi();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { messages, conversationId }: { messages: UIMessage[]; conversationId: string } =
    await req.json();

  const supabase = await createClient();

  const dailyLimit = Number(process.env.ASSISTANT_DAILY_LIMIT ?? 100);
  const { error: limitError } = await supabase.rpc("increment_usage", {
    org_id: auth.orgId,
    daily_limit: dailyLimit,
  });
  if (limitError) {
    return NextResponse.json(
      {
        error: `You've reached today's limit of ${dailyLimit} assistant messages. Try again tomorrow.`,
      },
      { status: 429 },
    );
  }

  const lastMessage = messages[messages.length - 1];
  let userText = "";
  if (lastMessage?.role === "user") {
    userText = getText(lastMessage);
    await supabase.from("messages").insert({
      conversation_id: conversationId,
      role: "user",
      content: userText,
    });

    const { data: conversation } = await supabase
      .from("conversations")
      .select("title")
      .eq("id", conversationId)
      .single();
    if (conversation?.title === "New conversation") {
      await supabase
        .from("conversations")
        .update({ title: userText.slice(0, 60) })
        .eq("id", conversationId);
    }
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Cross-session memory (Backboard.io) — best-effort, never blocks the
  // chat turn. See docs/backboard-memory.md.
  const backboardAssistantId = isBackboardConfigured()
    ? await getOrCreateAssistantId(supabase, auth.orgId, auth.orgName)
    : null;
  const memories = backboardAssistantId && userText
    ? await searchMemories(backboardAssistantId, userText)
    : [];
  const memoryContext = memories.length
    ? memories.map((m) => `- ${m.content}`).join("\n")
    : undefined;

  const delegateCtx = { supabase, orgId: auth.orgId, userId: auth.userId, userEmail: user?.email ?? null };
  const { tools: delegateTools, descriptions: delegateDescriptions } = await buildDelegateTools(delegateCtx);

  const result = streamText({
    model: chatModel,
    system: systemPrompt(memoryContext, delegateDescriptions),
    messages: await convertToModelMessages(messages),
    tools: {
      ...buildTools(delegateCtx),
      ...delegateTools,
    },
    stopWhen: stepCountIs(5),
  });

  return result.toUIMessageStreamResponse({
    onFinish: async ({ messages: finished }) => {
      const assistantMessage = finished[finished.length - 1];
      if (assistantMessage?.role !== "assistant") return;

      const assistantText = getText(assistantMessage);
      await supabase.from("messages").insert({
        conversation_id: conversationId,
        role: "assistant",
        content: assistantText,
        citations: getCitations(assistantMessage),
        chart: getChart(assistantMessage),
      });

      if (backboardAssistantId && userText && assistantText) {
        await writeMemory(backboardAssistantId, `Q: ${userText}\nA: ${assistantText}`);
      }

      // Sponsored-credits usage ledger — one event per chargeable action in
      // this turn, refusals/failures are free. See docs/sponsored-credits.md.
      const usageEvents = classifyUsageEvents(assistantMessage);
      for (const event of usageEvents) {
        await supabase.rpc("record_usage_event", {
          org_id: auth.orgId,
          event_action: event.action,
          event_outcome: event.outcome,
          event_credits: event.credits,
        });
      }
      if (usageEvents.length === 0) return;

      const { count: unsettledCount } = await supabase
        .from("usage_events")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", auth.orgId)
        .is("tx_sig", null);

      if ((unsettledCount ?? 0) >= SETTLE_BATCH_SIZE) {
        await settleUnsettledUsage(auth.orgId).catch(() => {
          // Solana devnet unreachable or unfunded — events stay unsettled
          // and get picked up on the next trigger or a manual settle.
        });
      }
    },
  });
}
