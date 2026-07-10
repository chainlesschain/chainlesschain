const MAX_REVIEW_SNAPSHOT_CHARS = 24000;

function normalizePlanItems(items) {
  return (Array.isArray(items) ? items : []).map((item, index) => ({
    id: stringOr(item?.id, `item-${index + 1}`),
    title: stringOr(item?.title, "(untitled item)"),
    tool: stringOr(item?.tool, ""),
    impact: stringOr(item?.impact, "low"),
    status: stringOr(item?.status, "pending"),
  }));
}

function stringOr(value, fallback = "") {
  if (value == null) return fallback;
  const s = String(value);
  return s || fallback;
}

function formatDate(when = new Date()) {
  try {
    return when instanceof Date
      ? when.toISOString()
      : new Date(when).toISOString();
  } catch {
    return new Date().toISOString();
  }
}

function formatPlanReviewMarkdown(plan = {}, opts = {}) {
  const items = normalizePlanItems(plan.items);
  const risk = plan.risk && typeof plan.risk === "object" ? plan.risk : null;
  const title = stringOr(opts.conversationTitle, "Chat");
  const sessionId = stringOr(opts.sessionId, "(pending)");
  const updatedAt = formatDate(opts.updatedAt);
  const lines = [
    "# ChainlessChain Plan Review",
    "",
    `- Conversation: ${title}`,
    `- Session: ${sessionId}`,
    `- State: ${stringOr(plan.state, "analyzing")}`,
    `- Updated: ${updatedAt}`,
  ];
  if (risk) {
    lines.push(
      `- Risk: ${stringOr(risk.level, "unknown")}` +
        (risk.totalScore == null ? "" : ` (${risk.totalScore})`),
    );
  }
  if (plan.note) lines.push(`- Note: ${String(plan.note)}`);
  lines.push(
    "",
    "## Review Actions",
    "",
    "Use the editor commands:",
    "",
    "- ChainlessChain: Approve Plan Review",
    "- ChainlessChain: Request Plan Changes",
    "- ChainlessChain: Regenerate Plan",
    "- ChainlessChain: Reject Plan Review",
    "",
    "## Inline Comments",
    "",
    "Add comments under the relevant plan item or in Reviewer Notes before choosing an action.",
    "",
    "## Plan Items",
    "",
  );
  if (!items.length) {
    lines.push(
      "- (No plan items yet. Blocked write/execute tools will appear here.)",
    );
  } else {
    items.forEach((item, index) => {
      const tool = item.tool ? `${item.tool}: ` : "";
      lines.push(
        `${index + 1}. ${tool}${item.title}`,
        `   - id: ${item.id}`,
        `   - impact: ${item.impact}`,
        `   - status: ${item.status}`,
        "   - comment:",
      );
    });
  }
  lines.push("", "## Reviewer Notes", "", "- ");
  return lines.join("\n");
}

function trimReviewSnapshot(text, limit = MAX_REVIEW_SNAPSHOT_CHARS) {
  const raw = String(text || "");
  if (raw.length <= limit) return raw;
  const omitted = raw.length - limit;
  return (
    raw.slice(0, limit) +
    `\n\n[review snapshot truncated: ${omitted} chars omitted]`
  );
}

function buildPlanReviewRecord({
  action,
  documentText,
  conversationId,
  conversationTitle,
  sessionId,
  plan,
  now = new Date(),
} = {}) {
  return {
    action: stringOr(action, "review"),
    reviewedAt: formatDate(now),
    conversationId: stringOr(conversationId, ""),
    conversationTitle: stringOr(conversationTitle, ""),
    sessionId: stringOr(sessionId, ""),
    planState: stringOr(plan?.state, ""),
    itemCount: normalizePlanItems(plan?.items).length,
    snapshot: trimReviewSnapshot(documentText),
  };
}

function buildPlanReviewFeedbackPrompt(action, documentText) {
  const verb =
    action === "regenerate"
      ? "Regenerate the plan from scratch"
      : "Revise the plan";
  return [
    `${verb} based on this plan review document.`,
    "",
    "Keep plan mode active. Do not execute write or shell tools until the revised plan is approved.",
    "",
    "```markdown",
    trimReviewSnapshot(documentText),
    "```",
  ].join("\n");
}

module.exports = {
  MAX_REVIEW_SNAPSHOT_CHARS,
  buildPlanReviewFeedbackPrompt,
  buildPlanReviewRecord,
  formatPlanReviewMarkdown,
  normalizePlanItems,
  trimReviewSnapshot,
};
