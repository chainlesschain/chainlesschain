/** Browser-safe cc-context-center/v1 projection shared by every desktop shell. */

export const DESKTOP_CONTEXT_CENTER_SCHEMA = "cc-context-center/v1";
export const DESKTOP_CONTEXT_SELECTION_ALGORITHM = "priority-stable-v1";
export const DESKTOP_CONTEXT_DEFAULT_TOKEN_BUDGET = 4096;
export const DESKTOP_CONTEXT_MAX_TOKEN_BUDGET = 32768;

const MAX_CANDIDATES = 64;
const MAX_CONTENT_BYTES = DESKTOP_CONTEXT_MAX_TOKEN_BUDGET * 4;
const CHIP_ID = /^ctx_[0-9a-f]{16}$/;
const encoder = new TextEncoder();

export type DesktopContextKind =
  | "selection"
  | "active-file"
  | "open-tabs"
  | "diagnostics"
  | "git-diff"
  | "terminal-selection"
  | "test-debug"
  | "preview-evidence"
  | "memory"
  | "mcp-resource";

const CONTEXT_KINDS: readonly DesktopContextKind[] = [
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
];

const KIND_PRIORITY = new Map(
  CONTEXT_KINDS.map((kind, index) => [kind, index]),
);

export interface DesktopContextCandidate {
  id?: string;
  kind: DesktopContextKind;
  label?: string;
  source?: string;
  identity?: string;
  scope?: string;
  content?: string;
  estimatedTokens?: number;
  range?: Record<string, unknown> | null;
  freshness?: { state?: string; capturedAt?: string | null };
  autoReason?: string;
  refreshable?: boolean;
  pinned?: boolean;
}

export interface DesktopContextChip {
  id: string;
  kind: DesktopContextKind;
  label: string;
  source: string;
  scope: string;
  freshness: { state: string; capturedAt: string | null };
  range: Record<string, unknown> | null;
  estimatedTokens: number;
  allocatedTokens: number;
  status: "included" | "trimmed" | "excluded-budget" | "removed";
  pinned: boolean;
  refreshable: boolean;
  reason: string;
  content: string;
  contentTruncated: boolean;
}

export interface DesktopContextProjection {
  schema: typeof DESKTOP_CONTEXT_CENTER_SCHEMA;
  workspaceId: string | null;
  selectionAlgorithm: typeof DESKTOP_CONTEXT_SELECTION_ALGORITHM;
  budget: {
    limitTokens: number;
    allocatedTokens: number;
    remainingTokens: number;
  };
  chips: DesktopContextChip[];
}

export interface DesktopContextDocument {
  name?: string;
  path?: string;
  content?: string;
  source?: string;
  selectionText?: string;
  selection?: Record<string, unknown> | null;
  diagnostics?: Array<{
    severity?: string;
    message?: string;
    line?: number;
    character?: number;
  }>;
  gitDiff?: string;
}

interface NormalizedCandidate {
  id: string;
  kind: DesktopContextKind;
  label: string;
  source: string;
  scope: string;
  content: string;
  estimatedTokens: number;
  range: Record<string, unknown> | null;
  freshness: { state: string; capturedAt: string | null };
  autoReason: string;
  refreshable: boolean;
  pinned: boolean;
}

function byteLength(value: string): number {
  return encoder.encode(value).byteLength;
}

function boundedText(value: unknown, fallback: string, limit: number): string {
  const clean = String(value ?? "").trim();
  return (clean || fallback).slice(0, limit);
}

export function truncateDesktopContextUtf8(
  value: unknown,
  maxBytes: number,
): string {
  const text = String(value ?? "");
  if (maxBytes <= 0) return "";
  if (byteLength(text) <= maxBytes) return text;
  let out = "";
  let used = 0;
  for (const character of text) {
    const bytes = byteLength(character);
    if (used + bytes > maxBytes) break;
    out += character;
    used += bytes;
  }
  return out;
}

function estimateTokens(content: string): number {
  return Math.max(1, Math.ceil(byteLength(content) / 4));
}

async function sha256Hex(value: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error("Web Crypto SHA-256 is unavailable");
  }
  const digest = await subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function stableDesktopContextChipId(
  candidate: DesktopContextCandidate,
): Promise<string> {
  if (CHIP_ID.test(candidate.id || "")) return candidate.id!;
  const identity = [
    candidate.kind,
    candidate.source,
    candidate.identity || candidate.scope || candidate.label,
  ].join("\n");
  return `ctx_${(await sha256Hex(identity)).slice(0, 16)}`;
}

function normalizeIdSet(values: unknown): Set<string> {
  return new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => String(value || "").trim())
      .filter((value) => CHIP_ID.test(value))
      .slice(0, MAX_CANDIDATES),
  );
}

async function normalizeCandidate(
  candidate: DesktopContextCandidate,
): Promise<NormalizedCandidate | null> {
  if (!candidate || typeof candidate !== "object") return null;
  const kind = String(candidate.kind || "").trim() as DesktopContextKind;
  if (!CONTEXT_KINDS.includes(kind)) return null;
  const source = boundedText(candidate.source, "desktop-host", 128);
  const label = boundedText(candidate.label, kind, 160);
  const scope = boundedText(
    candidate.scope,
    boundedText(candidate.identity, label, 512),
    512,
  );
  const content = truncateDesktopContextUtf8(
    candidate.content,
    MAX_CONTENT_BYTES,
  );
  const explicitTokens = Number(candidate.estimatedTokens);
  const estimatedTokens = Number.isSafeInteger(explicitTokens)
    ? Math.max(1, Math.min(DESKTOP_CONTEXT_MAX_TOKEN_BUDGET, explicitTokens))
    : estimateTokens(content);
  return {
    id: await stableDesktopContextChipId({
      ...candidate,
      kind,
      source,
      label,
      scope,
    }),
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

export async function buildDesktopContextCenter({
  workspaceId = null,
  candidates = [],
  tokenBudget = DESKTOP_CONTEXT_DEFAULT_TOKEN_BUDGET,
  pinnedIds = [],
  removedIds = [],
  refreshedIds = [],
}: {
  workspaceId?: string | null;
  candidates?: DesktopContextCandidate[];
  tokenBudget?: number;
  pinnedIds?: string[];
  removedIds?: string[];
  refreshedIds?: string[];
} = {}): Promise<DesktopContextProjection> {
  const parsedBudget = Number(tokenBudget);
  const limit = Number.isSafeInteger(parsedBudget)
    ? Math.max(0, Math.min(DESKTOP_CONTEXT_MAX_TOKEN_BUDGET, parsedBudget))
    : DESKTOP_CONTEXT_DEFAULT_TOKEN_BUDGET;
  const pinned = normalizeIdSet(pinnedIds);
  const removed = normalizeIdSet(removedIds);
  const refreshed = normalizeIdSet(refreshedIds);
  const normalized = (
    await Promise.all(
      (Array.isArray(candidates) ? candidates : [])
        .slice(0, MAX_CANDIDATES)
        .map(normalizeCandidate),
    )
  )
    .filter((item): item is NormalizedCandidate => item !== null)
    .sort(
      (left, right) =>
        left.id.localeCompare(right.id) ||
        left.content.localeCompare(right.content) ||
        left.label.localeCompare(right.label),
    );
  const unique = [
    ...new Map(normalized.map((item) => [item.id, item])).values(),
  ];
  unique.sort((left, right) => {
    const leftRemoved = removed.has(left.id) ? 1 : 0;
    const rightRemoved = removed.has(right.id) ? 1 : 0;
    const leftPinned =
      !leftRemoved && (pinned.has(left.id) || left.pinned) ? 0 : 1;
    const rightPinned =
      !rightRemoved && (pinned.has(right.id) || right.pinned) ? 0 : 1;
    return (
      leftRemoved - rightRemoved ||
      leftPinned - rightPinned ||
      (KIND_PRIORITY.get(left.kind) ?? MAX_CANDIDATES) -
        (KIND_PRIORITY.get(right.kind) ?? MAX_CANDIDATES) ||
      left.id.localeCompare(right.id)
    );
  });

  let remaining = limit;
  let allocated = 0;
  const chips: DesktopContextChip[] = unique.map((candidate) => {
    const isRemoved = removed.has(candidate.id);
    const isPinned =
      !isRemoved && (pinned.has(candidate.id) || candidate.pinned);
    let allocatedTokens = 0;
    let status: DesktopContextChip["status"] = "removed";
    if (!isRemoved && remaining > 0) {
      allocatedTokens = Math.min(candidate.estimatedTokens, remaining);
      remaining -= allocatedTokens;
      allocated += allocatedTokens;
      status =
        allocatedTokens < candidate.estimatedTokens ? "trimmed" : "included";
    } else if (!isRemoved) {
      status = "excluded-budget";
    }
    const content = truncateDesktopContextUtf8(
      candidate.content,
      allocatedTokens * 4,
    );
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
        byteLength(content) < byteLength(candidate.content),
    };
  });

  return {
    schema: DESKTOP_CONTEXT_CENTER_SCHEMA,
    workspaceId:
      typeof workspaceId === "string" && workspaceId ? workspaceId : null,
    selectionAlgorithm: DESKTOP_CONTEXT_SELECTION_ALGORITHM,
    budget: {
      limitTokens: limit,
      allocatedTokens: allocated,
      remainingTokens: Math.max(0, limit - allocated),
    },
    chips,
  };
}

/** Build host candidates with selection/diagnostics/diff ahead of whole file. */
export function buildDesktopDocumentCandidates(
  document: DesktopContextDocument | null | undefined,
  capturedAt = new Date().toISOString(),
): DesktopContextCandidate[] {
  if (!document) return [];
  const identity = document.path || document.name || "current-file";
  const source = document.source || "desktop.active-document";
  const candidates: DesktopContextCandidate[] = [];
  if (document.selectionText?.trim()) {
    candidates.push({
      kind: "selection",
      label: "Editor selection",
      source: `${source}.selection`,
      identity: `${identity}:${JSON.stringify(document.selection || null)}`,
      content: document.selectionText,
      range: document.selection || null,
      freshness: { state: "live-buffer", capturedAt },
      autoReason: "explicit editor selection",
    });
  }
  if (Array.isArray(document.diagnostics) && document.diagnostics.length > 0) {
    candidates.push({
      kind: "diagnostics",
      label: "Diagnostics",
      source: `${source}.diagnostics`,
      identity,
      content: document.diagnostics
        .slice(0, 100)
        .map(
          (item) =>
            `${item.severity || "diagnostic"} ${identity}:${Number(item.line) + 1 || "?"}:${Number(item.character) + 1 || "?"} ${item.message || ""}`,
        )
        .join("\n"),
      freshness: { state: "live-host", capturedAt },
      autoReason: "live errors or warnings are present",
    });
  }
  if (document.gitDiff?.trim()) {
    candidates.push({
      kind: "git-diff",
      label: "Relevant Git diff",
      source: `${source}.git-diff`,
      identity,
      content: document.gitDiff,
      freshness: { state: "live-vcs", capturedAt },
      autoReason: "uncommitted changes overlap the active document",
    });
  }
  // A whole-file body is only a fallback. Focused evidence is both cheaper
  // and more relevant, while preserving the shared kind-priority contract.
  if (document.content?.trim() && candidates.length === 0) {
    candidates.push({
      kind: "active-file",
      label: `Active file: ${document.name || identity}`,
      source,
      identity,
      content: document.content,
      freshness: { state: "live-buffer", capturedAt },
      autoReason: "active editor",
    });
  }
  return candidates;
}

export function formatDesktopContextCenter(
  projection: DesktopContextProjection,
): string | null {
  if (projection.schema !== DESKTOP_CONTEXT_CENTER_SCHEMA) return null;
  if (projection.chips.every((chip) => !chip.content)) return null;
  const json = JSON.stringify(projection, null, 2).replace(
    /<\/ide-context-center/gi,
    "<\\/ide-context-center",
  );
  return (
    '<ide-context-center note="desktop fixed-budget context">\n' +
    json +
    "\n</ide-context-center>"
  );
}

export async function composeDesktopContextPrompt(
  raw: string,
  {
    enabled,
    document,
    workspaceId = null,
    tokenBudget = DESKTOP_CONTEXT_DEFAULT_TOKEN_BUDGET,
  }: {
    enabled: boolean;
    document?: DesktopContextDocument | null;
    workspaceId?: string | null;
    tokenBudget?: number;
  },
): Promise<{ prompt: string; projection: DesktopContextProjection | null }> {
  if (!enabled) return { prompt: raw, projection: null };
  try {
    const projection = await buildDesktopContextCenter({
      workspaceId,
      candidates: buildDesktopDocumentCandidates(document),
      tokenBudget,
    });
    const block = formatDesktopContextCenter(projection);
    return {
      prompt: block ? `${block}\n\n${raw}` : raw,
      projection,
    };
  } catch {
    // Context is best-effort and must never prevent the raw user turn.
    return { prompt: raw, projection: null };
  }
}
