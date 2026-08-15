/**
 * Deterministic, host-neutral Context Center projection.
 *
 * Hosts provide bounded text candidates. This module assigns stable chip ids,
 * applies remove/pin/refresh intent, and trims content to one fixed token
 * budget. The Java twin consumes the same fixture.
 */
const crypto = require("node:crypto");

const CONTEXT_CENTER_SCHEMA = "cc-context-center/v1";
const SELECTION_ALGORITHM = "priority-stable-v1";
const DEFAULT_TOKEN_BUDGET = 4096;
const MAX_TOKEN_BUDGET = 32768;
const MAX_CANDIDATES = 64;
const MAX_CONTENT_BYTES = MAX_TOKEN_BUDGET * 4;
const CHIP_ID = /^ctx_[0-9a-f]{16}$/;

const CONTEXT_KINDS = Object.freeze([
  "selection",
  "active-file",
  "open-tabs",
  "diagnostics",
  "git-diff",
  "terminal-selection",
  "test-debug",
  "preview-evidence",
  "memory",
  "mcp-resource",
]);

const KIND_PRIORITY = Object.freeze(
  Object.fromEntries(CONTEXT_KINDS.map((kind, index) => [kind, index])),
);

function boundedText(value, fallback, limit) {
  const clean = String(value ?? "").trim();
  return (clean || fallback).slice(0, limit);
}

function truncateUtf8(value, maxBytes) {
  const text = String(value ?? "");
  if (maxBytes <= 0) return "";
  if (Buffer.byteLength(text, "utf8") <= maxBytes) return text;
  let out = "";
  let used = 0;
  for (const character of text) {
    const bytes = Buffer.byteLength(character, "utf8");
    if (used + bytes > maxBytes) break;
    out += character;
    used += bytes;
  }
  return out;
}

function estimateTokens(content) {
  return Math.max(1, Math.ceil(Buffer.byteLength(content, "utf8") / 4));
}

function stableChipId(candidate) {
  if (CHIP_ID.test(candidate?.id || "")) return candidate.id;
  const identity = [
    candidate?.kind,
    candidate?.source,
    candidate?.identity || candidate?.scope || candidate?.label,
  ].join("\n");
  return `ctx_${crypto
    .createHash("sha256")
    .update(identity, "utf8")
    .digest("hex")
    .slice(0, 16)}`;
}

function normalizeIdSet(values) {
  return new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => String(value || "").trim())
      .filter((value) => CHIP_ID.test(value))
      .slice(0, MAX_CANDIDATES),
  );
}

function normalizeCandidate(candidate) {
  if (!candidate || typeof candidate !== "object") return null;
  const kind = String(candidate.kind || "").trim();
  if (!CONTEXT_KINDS.includes(kind)) return null;
  const source = boundedText(candidate.source, "ide-host", 128);
  const label = boundedText(candidate.label, kind, 160);
  const scope = boundedText(
    candidate.scope,
    boundedText(candidate.identity, label, 512),
    512,
  );
  const content = truncateUtf8(candidate.content, MAX_CONTENT_BYTES);
  const explicitTokens = Number(candidate.estimatedTokens);
  const estimatedTokens = Number.isSafeInteger(explicitTokens)
    ? Math.max(1, Math.min(MAX_TOKEN_BUDGET, explicitTokens))
    : estimateTokens(content);
  return {
    id: stableChipId({ ...candidate, kind, source, label, scope }),
    kind,
    label,
    source,
    scope,
    content,
    estimatedTokens,
    range:
      candidate.range && typeof candidate.range === "object"
        ? structuredClone(candidate.range)
        : null,
    freshness: {
      state: boundedText(candidate.freshness?.state, "live-host", 48),
      capturedAt:
        typeof candidate.freshness?.capturedAt === "string"
          ? candidate.freshness.capturedAt.slice(0, 64)
          : null,
    },
    autoReason: boundedText(
      candidate.autoReason,
      `available ${kind} context`,
      240,
    ),
    refreshable: candidate.refreshable !== false,
    pinned: candidate.pinned === true,
  };
}

function buildContextCenter({
  workspaceId = null,
  candidates = [],
  tokenBudget = DEFAULT_TOKEN_BUDGET,
  pinnedIds = [],
  removedIds = [],
  refreshedIds = [],
} = {}) {
  const parsedBudget = Number(tokenBudget);
  const limit = Number.isSafeInteger(parsedBudget)
    ? Math.max(0, Math.min(MAX_TOKEN_BUDGET, parsedBudget))
    : DEFAULT_TOKEN_BUDGET;
  const pinned = normalizeIdSet(pinnedIds);
  const removed = normalizeIdSet(removedIds);
  const refreshed = normalizeIdSet(refreshedIds);

  // Sorting before de-duplication makes duplicate candidate resolution
  // independent of host enumeration order.
  const normalized = (Array.isArray(candidates) ? candidates : [])
    .slice(0, MAX_CANDIDATES)
    .map(normalizeCandidate)
    .filter(Boolean)
    .sort(
      (a, b) =>
        a.id.localeCompare(b.id) ||
        a.content.localeCompare(b.content) ||
        a.label.localeCompare(b.label),
    );
  const unique = [...new Map(normalized.map((item) => [item.id, item])).values()];
  unique.sort((a, b) => {
    const aRemoved = removed.has(a.id) ? 1 : 0;
    const bRemoved = removed.has(b.id) ? 1 : 0;
    const aPinned = !aRemoved && (pinned.has(a.id) || a.pinned) ? 0 : 1;
    const bPinned = !bRemoved && (pinned.has(b.id) || b.pinned) ? 0 : 1;
    return (
      aRemoved - bRemoved ||
      aPinned - bPinned ||
      KIND_PRIORITY[a.kind] - KIND_PRIORITY[b.kind] ||
      a.id.localeCompare(b.id)
    );
  });

  let remaining = limit;
  let allocated = 0;
  const chips = unique.map((candidate) => {
    const isRemoved = removed.has(candidate.id);
    const isPinned = !isRemoved && (pinned.has(candidate.id) || candidate.pinned);
    let allocatedTokens = 0;
    let status = "removed";
    if (!isRemoved && remaining > 0) {
      allocatedTokens = Math.min(candidate.estimatedTokens, remaining);
      remaining -= allocatedTokens;
      allocated += allocatedTokens;
      status =
        allocatedTokens < candidate.estimatedTokens ? "trimmed" : "included";
    } else if (!isRemoved) {
      status = "excluded-budget";
    }
    const content = truncateUtf8(candidate.content, allocatedTokens * 4);
    return {
      id: candidate.id,
      kind: candidate.kind,
      label: candidate.label,
      source: candidate.source,
      scope: candidate.scope,
      freshness: candidate.freshness,
      range: candidate.range,
      estimatedTokens: candidate.estimatedTokens,
      allocatedTokens,
      status,
      pinned: isPinned,
      refreshable: candidate.refreshable,
      reason: isRemoved
        ? "removed-by-user"
        : isPinned
          ? "user-pinned"
          : refreshed.has(candidate.id)
            ? "user-refreshed"
            : status === "excluded-budget"
              ? "budget-exhausted"
              : `auto:${candidate.autoReason}`,
      content,
      contentTruncated:
        status === "trimmed" ||
        Buffer.byteLength(content, "utf8") <
          Buffer.byteLength(candidate.content, "utf8"),
    };
  });

  return {
    schema: CONTEXT_CENTER_SCHEMA,
    workspaceId:
      typeof workspaceId === "string" && workspaceId ? workspaceId : null,
    selectionAlgorithm: SELECTION_ALGORITHM,
    budget: {
      limitTokens: limit,
      allocatedTokens: allocated,
      remainingTokens: Math.max(0, limit - allocated),
    },
    chips,
  };
}

module.exports = {
  CONTEXT_CENTER_SCHEMA,
  CONTEXT_KINDS,
  DEFAULT_TOKEN_BUDGET,
  MAX_TOKEN_BUDGET,
  buildContextCenter,
  stableChipId,
  truncateUtf8,
};
