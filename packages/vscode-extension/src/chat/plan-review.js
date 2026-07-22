const MAX_REVIEW_SNAPSHOT_CHARS = 24000;
const PLAN_REVIEW_STATE_SCHEMA = "cc-plan-review/v1";
const MAX_PERSISTED_PLAN_REVIEWS = 20;
const MAX_PERSISTED_PLAN_ITEMS = 128;
const MAX_PLAN_REVIEW_COMMENTS = 64;
const MAX_PLAN_REVIEW_COMMENT_CHARS = 2000;

function normalizePlanItems(items) {
  return (Array.isArray(items) ? items : []).map((item, index) => ({
    id: stringOr(item?.id, `item-${index + 1}`),
    title: stringOr(item?.title, "(untitled item)"),
    tool: stringOr(item?.tool, ""),
    impact: stringOr(item?.impact, "low"),
    status: stringOr(item?.status, "pending"),
    turn:
      Number.isInteger(item?.turn) && item.turn > 0 ? Number(item.turn) : null,
    toolUseId: stringOr(item?.toolUseId || item?.tool_use_id, ""),
    startedAt: stringOr(item?.startedAt || item?.started_at, ""),
    completedAt: stringOr(item?.completedAt || item?.completed_at, ""),
    error: stringOr(item?.error, ""),
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
      );
      const progress = formatPlanItemProgress(item);
      if (progress) lines.push(`   - progress: ${progress}`);
      if (item.error) lines.push(`   - error: ${item.error}`);
      lines.push("   - comment:");
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
  turn,
  now = new Date(),
} = {}) {
  const comments = extractPlanReviewComments(documentText, {
    turn: turn || latestPlanTurn(plan),
  });
  const record = {
    action: stringOr(action, "review"),
    reviewedAt: formatDate(now),
    conversationId: stringOr(conversationId, ""),
    conversationTitle: stringOr(conversationTitle, ""),
    sessionId: stringOr(sessionId, ""),
    planState: stringOr(plan?.state, ""),
    itemCount: normalizePlanItems(plan?.items).length,
    snapshot: trimReviewSnapshot(documentText),
    comments,
  };
  if (Number.isInteger(revision) && revision > 0) {
    record.revision = revision;
  }
  if (Number.isInteger(turn) && turn > 0) record.turn = turn;
  return record;
}

function latestPlanTurn(plan) {
  return normalizePlanItems(plan?.items).reduce(
    (latest, item) => Math.max(latest, item.turn || 0),
    0,
  );
}

function formatPlanItemProgress(item) {
  const parts = [];
  if (item.turn) parts.push(`turn ${item.turn}`);
  if (item.toolUseId) parts.push(`tool use ${item.toolUseId}`);
  if (item.startedAt) parts.push(`started ${item.startedAt}`);
  if (item.completedAt) parts.push(`completed ${item.completedAt}`);
  return parts.join("; ");
}

function fileReference(text) {
  const match = String(text || "").match(
    /((?:[A-Za-z]:[\\/])?(?:[\w@.+()-]+[\\/])*[\w@.+()-]+\.[A-Za-z0-9]+):(\d+)(?::(\d+))?/,
  );
  if (!match) return {};
  return {
    file: match[1].slice(0, 1024),
    line: Number(match[2]),
    ...(match[3] ? { column: Number(match[3]) } : {}),
  };
}

function normalizePlanReviewComment(value, index = 0) {
  if (!value || typeof value !== "object") return null;
  const text = boundedString(value.text, MAX_PLAN_REVIEW_COMMENT_CHARS).trim();
  if (!text) return null;
  const ref = fileReference(text);
  const positive = (candidate) => {
    const number = Number(candidate);
    return Number.isInteger(number) && number > 0 ? number : null;
  };
  return {
    id: boundedString(value.id, 160) || `comment-${index + 1}`,
    sourceLine: positive(value.sourceLine),
    itemId: boundedString(value.itemId, 160) || null,
    text,
    file: boundedString(value.file, 1024) || ref.file || null,
    line: positive(value.line) || ref.line || null,
    column: positive(value.column) || ref.column || null,
    turn: positive(value.turn),
  };
}

function normalizePlanReviewComments(values) {
  return (Array.isArray(values) ? values : [])
    .slice(0, MAX_PLAN_REVIEW_COMMENTS)
    .map(normalizePlanReviewComment)
    .filter(Boolean);
}

function extractPlanReviewComments(documentText, { turn = null } = {}) {
  const lines = String(documentText || "").split(/\r?\n/);
  const comments = [];
  let itemId = null;
  let reviewerNotes = false;
  const push = (text, sourceLine, targetItemId) => {
    if (comments.length >= MAX_PLAN_REVIEW_COMMENTS) return;
    const comment = normalizePlanReviewComment(
      { text, sourceLine, itemId: targetItemId, turn },
      comments.length,
    );
    if (comment) comments.push(comment);
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      reviewerNotes = /^Reviewer Notes$/i.test(heading[1]);
      itemId = null;
      continue;
    }
    if (/^\d+\.\s+/.test(line)) {
      reviewerNotes = false;
      itemId = null;
      continue;
    }
    const idMatch = line.match(/^\s*-\s*id:\s*(.+?)\s*$/i);
    if (idMatch) {
      itemId = boundedString(idMatch[1], 160);
      continue;
    }
    const commentMatch = line.match(/^\s*-\s*comment:\s*(.*)$/i);
    if (commentMatch) {
      const parts = [commentMatch[1].trim()].filter(Boolean);
      let cursor = index + 1;
      while (cursor < lines.length) {
        const continuation = lines[cursor];
        if (
          /^\s*-\s*(?:id|impact|status|progress|error|comment):/i.test(
            continuation,
          ) ||
          /^\d+\.\s+/.test(continuation) ||
          /^##\s+/.test(continuation)
        ) {
          break;
        }
        if (continuation.trim()) parts.push(continuation.trim());
        cursor += 1;
      }
      push(parts.join("\n"), index + 1, itemId);
      index = cursor - 1;
      continue;
    }
    if (reviewerNotes) {
      const note = line.match(/^\s*[-*]\s+(.+?)\s*$/);
      if (note) push(note[1], index + 1, null);
    }
  }
  return comments;
}

function mergePlanReviewProgress(documentText, plan = {}) {
  const items = new Map(
    normalizePlanItems(plan.items).map((item) => [item.id, item]),
  );
  const lines = String(documentText || "").split(/\r?\n/);
  const out = [];
  let itemId = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const idMatch = line.match(/^\s*-\s*id:\s*(.+?)\s*$/i);
    if (idMatch) itemId = idMatch[1];
    if (/^\d+\.\s+/.test(line) || /^##\s+/.test(line)) itemId = null;
    const statusMatch = line.match(/^(\s*-\s*status:)\s*.*$/i);
    const item = itemId ? items.get(itemId) : null;
    if (!statusMatch || !item) {
      if (item && /^\s*-\s*(?:progress|error):/i.test(line)) {
        continue;
      }
      out.push(line);
      continue;
    }
    out.push(`${statusMatch[1]} ${item.status}`);
    const progress = formatPlanItemProgress(item);
    const indent = statusMatch[1].match(/^\s*/)?.[0] || "";
    if (progress) out.push(`${indent}- progress: ${progress}`);
    if (item.error) out.push(`${indent}- error: ${item.error}`);
    while (
      index + 1 < lines.length &&
      /^\s*-\s*(?:progress|error):/i.test(lines[index + 1])
    ) {
      index += 1;
    }
  }
  return out.join("\n");
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
        ...(item.turn ? { turn: item.turn } : {}),
        ...(item.toolUseId
          ? { tool_use_id: boundedString(item.toolUseId, 160) }
          : {}),
        ...(item.startedAt
          ? { started_at: boundedString(item.startedAt, 64) }
          : {}),
        ...(item.completedAt
          ? { completed_at: boundedString(item.completedAt, 64) }
          : {}),
        ...(item.error ? { error: boundedString(item.error, 1000) } : {}),
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
  normalized.comments = normalizePlanReviewComments(
    Array.isArray(value.comments)
      ? value.comments
      : extractPlanReviewComments(normalized.snapshot, {
          turn: latestPlanTurn(normalized.plan),
        }),
  );
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
  comments,
  turn,
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
    comments:
      comments ||
      extractPlanReviewComments(documentText, {
        turn: turn || latestPlanTurn(plan),
      }),
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
  MAX_PLAN_REVIEW_COMMENTS,
  PLAN_REVIEW_STATE_SCHEMA,
  buildPlanReviewFeedbackPrompt,
  buildPlanReviewRecord,
  buildPersistedPlanReview,
  findPersistedPlanReview,
  extractPlanReviewComments,
  formatPlanReviewMarkdown,
  mergePlanReviewProgress,
  normalizePlanReviewComments,
  normalizePersistedPlanReview,
  normalizePlanItems,
  sanitizePlanSnapshot,
  trimReviewSnapshot,
  upsertPersistedPlanReview,
};
