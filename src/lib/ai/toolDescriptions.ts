// One prose bullet per tool, extracted verbatim from what used to be a
// hand-written block inside chat/route.ts's systemPrompt(). Single-sourced
// here so both the main assistant (all tools) and an Agents Lab agent
// (a subset) generate their tool-description block from the same text
// instead of drifting the way the old inline copy already had from the
// capabilities pages (see src/lib/capabilities.ts).
export const TOOL_DESCRIPTIONS: Record<string, string> = {
  search_knowledge:
    "search_knowledge: look up passages from the team's uploaded documents. Use it before answering anything that could be grounded in their knowledge base, and say plainly when it finds nothing rather than guessing.",
  create_task:
    "create_task: create a to-do for the team when the user asks you to track an action item. If they say who should do it, pass assigneeName — otherwise leave it unassigned.",
  list_tasks:
    "list_tasks: list tasks when asked what's outstanding or what's assigned to someone. Defaults to open tasks; pass assignedToMe for \"my tasks.\"",
  complete_task:
    "complete_task: mark a task done by matching its title, when the user says something is finished.",
  schedule_meeting:
    "schedule_meeting: schedule a meeting when the user gives you a title and a time. Resolve relative dates yourself using today's date above — only ask if the time itself is genuinely missing or ambiguous. If they give you an external person's email, pass it as attendeeEmail — that person gets an actual calendar invite by email, so only do this when an email address was actually given, never invent one.",
  list_meetings: "list_meetings: list upcoming meetings when asked what's scheduled.",
  cancel_meeting:
    "cancel_meeting: cancel a meeting by matching its title. If it comes back ambiguous (multiple matches) or not found, tell the user what matched (or didn't) and ask them to be more specific rather than picking one yourself.",
  draft_email:
    "draft_email: draft an email when the user asks you to write, draft, or compose one. This never sends anything — it opens a review panel where the user edits and sends it themselves. If they didn't give a recipient address, leave \"to\" blank and say they'll need to fill it in.",
  analyze_data:
    "analyze_data: use this instead of search_knowledge whenever a question needs math across an entire uploaded data file (totals, averages, \"which region had the most\") rather than finding a relevant passage — search_knowledge only surfaces semantically similar snippets and can't add up a column. Follow up with generate_chart to visualize the result when it would help.",
  restrict_source_access:
    "restrict_source_access: use this when the user asks to restrict, hide, or block specific people from an uploaded document, or to lift that restriction. Everyone in the workspace can see a document by default — this only manages a deny-list of specific people on top of that.",
  create_form:
    "create_form: use this when the user asks to create, build, or make a form or survey. It publishes by default so the link is immediately shareable — share the returned link with the user.",
  list_form_responses:
    "list_form_responses: use this when the user asks what responses a form has gotten, or to summarize/read them back.",
  get_account_balance:
    "get_account_balance: use this when asked about the workspace's (demo Capital One) account balance.",
  list_transactions: "list_transactions: use this when asked to list or show recent transactions.",
  analyze_spending:
    "analyze_spending: use this instead of list_transactions when asked about totals or where money went — it groups by vendor. Follow up with generate_chart to visualize the breakdown when it would help.",
  pay_vendor:
    "pay_vendor: use this when the user asks to pay, send money to, or reimburse a vendor. This NEVER actually sends money — it only opens a review panel where a human approves and sends it themselves.",
  receive_payment:
    "receive_payment: use this when the user says they got paid, were reimbursed, or received money — this records immediately, no approval needed.",
  get_receipt:
    "get_receipt: use this when the user asks for the details of a specific past transaction (who, when, transaction id, notes) — defaults to the most recent one if they don't name someone.",
  generate_chart:
    "generate_chart: render a bar chart, line chart, or single stat tile when the user asks to visualize, chart, plot, or break down numbers — including numbers they just gave you in the conversation.",
};
