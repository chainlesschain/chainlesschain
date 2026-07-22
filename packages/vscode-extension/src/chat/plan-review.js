const MAX_REVIEW_SNAPSHOT_CHARS = 24000;
const PLAN_REVIEW_STATE_SCHEMA = "cc-plan-review/v1";
const MAX_PERSISTED_PLAN_REVIEWS = 20;
const MAX_PERSISTED_PLAN_ITEMS = 128;

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
  revision,
  now = new Date(),
} = {}) {
  const record = {
    action: stringOr(action, "review"),
    reviewedAt: formatDate(now),
    conversationId: stringOr(conversationId, ""),
    conversationTitle: stringOr(conversationTitle, ""),
    sessionId: stringOr(sessionId, ""),
    planState: stringOr(plan?.state, ""),
    itemCount: normalizePlanItems(plan?.items).length,
    snapshot: trimReviewSnapshot(documentText),
  };
  if (Number.isInteger(revision) && revision > 0) {
    record.revision = revision;
  }
  return record;
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

function boundedString(value, limit = 512) {
  return stringOr(value, "").slice(0, limit);
}

function sanitizePlanSnapshot(plan = {}) {
  const source = plan && typeof plan === "object" ? plan : {};
  const snapshot = {
    active: source.active === true,
    state: boundedString(source.state, 128),
    items: normalizePlanItems(source.items)
      .slice(0, MAX_PERSISTED_PLAN_ITEMS)
      .map((item) => ({
        id: boundedString(item.id, 160),
        title: boundedString(item.title, 512),
        tool: boundedString(item.tool, 160),
        impact: boundedString(item.impact, 64),
        status: boundedString(item.status, 64),
      })),
  };
  if (source.note != null) snapshot.note = boundedString(source.note, 2000);
  if (source.risk && typeof source.risk === "object") {
    snapshot.risk = {
      level: boundedString(source.risk.level, 64),
      ...(Number.isFinite(Number(source.risk.totalScore))
        ? { totalScore: Number(source.risk.totalScore) }
        : {}),
    };
  }
  return snapshot;
}

function persistedPlanReviewIdentity(value = {}) {
  const sessionId = boundedString(value.sessionId, 256);
  if (sessionId) return `session:${sessionId}`;
  const conversationId = boundedString(value.conversationId, 256);
  return conversationId ? `conversation:${conversationId}` : "";
}

function normalizePersistedPlanReview(value) {
  if (
    !value ||
    typeof value !== "object" ||
    value.schema !== PLAN_REVIEW_STATE_SCHEMA
  ) {
    return null;
  }
  const normalized = {
    schema: PLAN_REVIEW_STATE_SCHEMA,
    revision:
      Number.isInteger(value.revision) && value.revision > 0
        ? value.revision
        : 1,
    updatedAt: formatDate(value.updatedAt),
    conversationId: boundedString(value.conversationId, 256),
    conversationTitle: boundedString(value.conversationTitle, 256),
    sessionId: boundedString(value.sessionId, 256),
    status: boundedString(value.status, 64) || "draft",
    action: boundedString(value.action, 64),
    plan: sanitizePlanSnapshot(value.plan),
    snapshot: trimReviewSnapshot(value.snapshot),
  };
  return persistedPlanReviewIdentity(normalized) ? normalized : null;
}

function buildPersistedPlanReview({
  documentText,
  conversationId,
  conversationTitle,
  sessionId,
  plan,
  status = "draft",
  action = "",
  previous,
  now = new Date(),
} = {}) {
  const prior = normalizePersistedPlanReview(previous);
  return normalizePersistedPlanReview({
    schema: PLAN_REVIEW_STATE_SCHEMA,
    revision: prior ? prior.revision + 1 : 1,
    updatedAt: formatDate(now),
    conversationId,
    conversationTitle,
    sessionId,
    status,
    action,
    plan,
    snapshot: documentText,
  });
}

function findPersistedPlanReview(list, identity = {}) {
  const wanted = persistedPlanReviewIdentity(identity);
  if (!wanted) return null;
  const values = Array.isArray(list) ? list : [];
  for (let i = values.length - 1; i >= 0; i -= 1) {
    const state = normalizePersistedPlanReview(values[i]);
    if (state && persistedPlanReviewIdentity(state) === wanted) return state;
  }
  return null;
}

function upsertPersistedPlanReview(
  list,
  value,
  limit = MAX_PERSISTED_PLAN_REVIEWS,
) {
  const state = normalizePersistedPlanReview(value);
  if (!state) return (Array.isArray(list) ? list : []).slice(-limit);
  const identity = persistedPlanReviewIdentity(state);
  const kept = (Array.isArray(list) ? list : [])
    .map(normalizePersistedPlanReview)
    .filter(
      (entry) => entry && persistedPlanReviewIdentity(entry) !== identity,
    );
  kept.push(state);
  return kept.slice(-Math.max(1, Number(limit) || MAX_PERSISTED_PLAN_REVIEWS));
}

module.exports = {
  MAX_REVIEW_SNAPSHOT_CHARS,
  MAX_PERSISTED_PLAN_REVIEWS,
  PLAN_REVIEW_STATE_SCHEMA,
  buildPlanReviewFeedbackPrompt,
  buildPlanReviewRecord,
  buildPersistedPlanReview,
  findPersistedPlanReview,
  formatPlanReviewMarkdown,
  normalizePersistedPlanReview,
  normalizePlanItems,
  sanitizePlanSnapshot,
  trimReviewSnapshot,
  upsertPersistedPlanReview,
};
