/**
 * Lightweight `/recap` support for the interactive agent.
 *
 * The recap deliberately reads only the rebuildable session metadata sidecar
 * and at most the newest matching transcript records through the store's
 * reverse-reader. It never calls `readEvents()` or rebuilds the whole chat.
 */
import {
  findLatestEvent,
  getJsonlSessionMetadata,
  resolveSessionId,
} from "../harness/jsonl-session-store.js";

const DEFAULT_PREVIEW_CHARS = 180;

function safeLabel(value, maxChars = 200) {
  return String(value || "")
    .replace(/[\p{Cc}\p{Cf}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxChars);
}

function safeIso(value) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp)) return "";
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function flattenContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      return typeof part?.text === "string" ? part.text : "";
    })
    .join(" ");
}

export function recapPreview(content, maxChars = DEFAULT_PREVIEW_CHARS) {
  const normalized = flattenContent(content)
    .replace(/[\p{Cc}\p{Cf}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  const limit = Math.max(20, Number(maxChars) || DEFAULT_PREVIEW_CHARS);
  return normalized.length > limit
    ? `${normalized.slice(0, Math.max(1, limit - 1))}…`
    : normalized;
}

function latestCheckpointTurns(event, previewChars) {
  const messages = Array.isArray(event?.data?.messages)
    ? event.data.messages
    : [];
  const turns = [];
  for (
    let index = messages.length - 1;
    index >= 0 && turns.length < 2;
    index--
  ) {
    const message = messages[index];
    if (message?.role !== "user" && message?.role !== "assistant") continue;
    const preview = recapPreview(message.content, previewChars);
    if (preview) turns.push({ role: message.role, preview });
  }
  return turns.reverse();
}

function compactDetails(event, previewChars) {
  if (!event) return null;
  const data = event.data && typeof event.data === "object" ? event.data : {};
  const numeric = (value) => {
    if (value === null || value === undefined || value === "") return null;
    return Number.isFinite(Number(value)) ? Number(value) : null;
  };
  return {
    timestamp: safeIso(event.timestamp),
    strategy: typeof data.strategy === "string" ? data.strategy : "",
    originalMessages: numeric(data.originalMessages),
    compressedMessages: numeric(data.compressedMessages),
    savedTokens: numeric(data.saved),
    summary: recapPreview(data.summary, previewChars),
    turns: latestCheckpointTurns(event, previewChars),
  };
}

function latestTurnDetails(event, previewChars) {
  if (!event) return null;
  const role =
    event.type === "user_message"
      ? "user"
      : event.type === "assistant_message"
        ? "assistant"
        : "";
  const preview = recapPreview(event.data?.content, previewChars);
  if (!role || !preview) return null;
  return {
    role,
    preview,
    timestamp: safeIso(event.timestamp),
  };
}

/**
 * Build a bounded, provider-neutral recap projection.
 *
 * `store` is injectable to make the important no-full-transcript contract
 * directly testable. The default store methods all use metadata/reverse IO.
 */
export function buildSessionRecap(sessionId, options = {}) {
  const store = {
    resolveSessionId,
    getJsonlSessionMetadata,
    findLatestEvent,
    ...(options.store || {}),
  };
  const previewChars = Math.max(
    20,
    Number(options.previewChars) || DEFAULT_PREVIEW_CHARS,
  );
  const requestedId = String(sessionId || "").trim();
  if (!requestedId) {
    return { found: false, sessionId: "", reason: "session id is required" };
  }

  const resolvedId = store.resolveSessionId(requestedId);
  if (!resolvedId) {
    return {
      found: false,
      sessionId: requestedId,
      reason: `session not found: ${requestedId}`,
    };
  }
  const metadata = store.getJsonlSessionMetadata(resolvedId);
  if (!metadata) {
    return {
      found: false,
      sessionId: resolvedId,
      reason: `session metadata unavailable: ${resolvedId}`,
    };
  }

  const compact = store.findLatestEvent(resolvedId, "compact");
  const latestTurn = store.findLatestEvent(resolvedId, [
    "user_message",
    "assistant_message",
  ]);
  return {
    found: true,
    sessionId: safeLabel(resolvedId, 200),
    title: safeLabel(metadata.title, 200) || "Untitled",
    provider: safeLabel(metadata.provider, 80),
    model: safeLabel(metadata.model, 160),
    messageCount: Math.max(0, Number(metadata.message_count) || 0),
    createdAt: metadata.created_at || "",
    updatedAt: metadata.updated_at || "",
    checkpoint: compactDetails(compact, previewChars),
    latestTurn: latestTurnDetails(latestTurn, previewChars),
    source: "session-metadata+reverse-events",
  };
}

export function renderSessionRecap(recap) {
  if (!recap?.found) return recap?.reason || "Session recap unavailable.";
  const identity = [safeLabel(recap.provider, 80), safeLabel(recap.model, 160)]
    .filter(Boolean)
    .join(" / ");
  const lines = [
    `Session recap: ${safeLabel(recap.title, 200) || "Untitled"}`,
    `ID: ${safeLabel(recap.sessionId, 200)}`,
    `Messages: ${recap.messageCount}`,
  ];
  if (identity) lines.push(`Model: ${identity}`);
  if (recap.updatedAt) lines.push(`Updated: ${safeLabel(recap.updatedAt, 80)}`);

  const checkpoint = recap.checkpoint;
  if (checkpoint) {
    const stats = [];
    if (checkpoint.strategy) stats.push(checkpoint.strategy);
    if (
      checkpoint.originalMessages !== null &&
      checkpoint.compressedMessages !== null
    ) {
      stats.push(
        `${checkpoint.originalMessages} -> ${checkpoint.compressedMessages} messages`,
      );
    }
    if (checkpoint.savedTokens !== null) {
      stats.push(`${checkpoint.savedTokens} tokens saved`);
    }
    lines.push(`Checkpoint: ${stats.join(", ") || "available"}`);
    if (checkpoint.summary) lines.push(`Summary: ${checkpoint.summary}`);
    for (const turn of checkpoint.turns) {
      lines.push(
        `${turn.role === "user" ? "Checkpoint ask" : "Checkpoint reply"}: ${turn.preview}`,
      );
    }
  } else {
    lines.push("Checkpoint: none yet");
  }

  if (
    recap.latestTurn &&
    !checkpoint?.turns?.some(
      (turn) =>
        turn.role === recap.latestTurn.role &&
        turn.preview === recap.latestTurn.preview,
    )
  ) {
    lines.push(
      `${recap.latestTurn.role === "user" ? "Latest ask" : "Latest reply"}: ${recap.latestTurn.preview}`,
    );
  }
  return lines.join("\n");
}
