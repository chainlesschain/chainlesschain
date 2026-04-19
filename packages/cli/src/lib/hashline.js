/**
 * Hashline — content-hash anchored line editing (v5.0.2.9)
 *
 * Inspired by oh-my-openagent's "Hashline" design: rather than referring to
 * code by line number (brittle across concurrent edits) or by exact string
 * match (brittle across whitespace drift), each line is tagged with a short
 * content hash. Edits reference the hash and are rejected if the current
 * file contents no longer match — preventing stale-line corruption.
 *
 * Pure functions only — zero side effects, fully testable.
 *
 * Tag format: `<6-char base64url>| <line content>`
 *   Empty / whitespace-only lines use `______` (6 underscores).
 *
 * Hash is computed over `line.trim()`, making it insensitive to leading /
 * trailing whitespace — rebust against auto-formatters and indentation drift.
 */

import crypto from "crypto";

const HASH_LENGTH = 6;
const EMPTY_HASH = "______";
const SEPARATOR = "| ";

/**
 * Compute the stable hash for a single line.
 * Whitespace-insensitive: `.trim()` is applied before hashing.
 *
 * @param {string} line
 * @returns {string} 6-char base64url hash, or "______" for empty/whitespace
 */
export function hashLine(line) {
  if (typeof line !== "string") return EMPTY_HASH;
  const trimmed = line.trim();
  if (trimmed.length === 0) return EMPTY_HASH;
  return crypto
    .createHash("sha256")
    .update(trimmed, "utf8")
    .digest("base64url")
    .slice(0, HASH_LENGTH);
}

/**
 * Split content into lines, preserving line-ending style for round-trips.
 * Detects CRLF vs LF; mixed endings fall back to LF.
 *
 * @param {string} content
 * @returns {{ lines: string[], eol: "\r\n" | "\n" }}
 */
export function splitLines(content) {
  if (typeof content !== "string") return { lines: [], eol: "\n" };
  const hasCRLF = content.includes("\r\n");
  const hasLF = content.includes("\n");
  // Only treat as CRLF if no bare LFs appear outside CRLF pairs
  if (hasCRLF) {
    // Count bare \n (\n not preceded by \r)
    const bareLFs = (content.match(/(^|[^\r])\n/g) || []).length;
    const crlfs = (content.match(/\r\n/g) || []).length;
    const eol = bareLFs === 0 || bareLFs < crlfs / 2 ? "\r\n" : "\n";
    return { lines: content.split(/\r?\n/), eol };
  }
  return { lines: hasLF ? content.split("\n") : [content], eol: "\n" };
}

/**
 * Annotate content: prepend each line with `<hash>| `.
 *
 * @param {string} content
 * @returns {string} annotated content
 */
export function annotateLines(content) {
  const { lines, eol } = splitLines(content);
  return lines.map((line) => `${hashLine(line)}${SEPARATOR}${line}`).join(eol);
}

/**
 * Find all lines whose hash matches the anchor.
 *
 * @param {string} content
 * @param {string} anchorHash
 * @returns {Array<{ index: number, lineNumber: number, content: string }>}
 */
export function findByHash(content, anchorHash) {
  if (!anchorHash || typeof anchorHash !== "string") return [];
  const { lines } = splitLines(content);
  const matches = [];
  for (let i = 0; i < lines.length; i++) {
    if (hashLine(lines[i]) === anchorHash) {
      matches.push({
        index: i,
        lineNumber: i + 1, // 1-based for human-friendly display
        content: lines[i],
      });
    }
  }
  return matches;
}

/**
 * Verify the current content of a line matches both the anchor hash and the
 * expected trimmed content. Used as a second-layer check to defend against
 * hash collisions.
 *
 * @param {string} currentLine
 * @param {string} anchorHash
 * @param {string} expectedLine - Expected content (compared trimmed)
 * @returns {boolean}
 */
export function verifyLine(currentLine, anchorHash, expectedLine) {
  if (hashLine(currentLine) !== anchorHash) return false;
  if (typeof expectedLine !== "string") return true;
  return currentLine.trim() === expectedLine.trim();
}

/**
 * Replace a single line at the given anchor hash. Returns either the new
 * content or a structured error.
 *
 * Error shapes (not thrown — returned so the agent loop can present them):
 *   { error: "hash_mismatch",    ... }   — anchor doesn't match any line
 *   { error: "ambiguous_anchor", ... }   — anchor matches multiple lines
 *   { error: "content_mismatch", ... }   — hash matches but expected_line differs
 *
 * @param {string} content - Full file content
 * @param {object} opts
 * @param {string} opts.anchorHash
 * @param {string} opts.expectedLine
 * @param {string} opts.newLine
 * @param {number} [opts.contextLines=3] - Lines of context for error snippets
 * @returns {{ success: true, content: string, lineNumber: number } | { success: false, error: string, [key: string]: any }}
 */
export function replaceByHash(content, opts) {
  const { anchorHash, expectedLine, newLine, contextLines = 3 } = opts;
  const { lines, eol } = splitLines(content);
  const matches = findByHash(content, anchorHash);

  if (matches.length === 0) {
    return {
      success: false,
      error: "hash_mismatch",
      message: `No line matches anchor hash "${anchorHash}"`,
      hint: "Re-read the file with hashed:true to get current hashes",
    };
  }

  if (matches.length > 1) {
    return {
      success: false,
      error: "ambiguous_anchor",
      message: `Anchor hash "${anchorHash}" matches ${matches.length} lines`,
      matches: matches.map((m) => ({
        lineNumber: m.lineNumber,
        content: m.content,
      })),
      hint: "Use edit_file with a unique old_string or refine the anchor",
    };
  }

  const match = matches[0];
  if (
    typeof expectedLine === "string" &&
    match.content.trim() !== expectedLine.trim()
  ) {
    return {
      success: false,
      error: "content_mismatch",
      message: `Line ${match.lineNumber} has hash ${anchorHash} but content differs from expected_line`,
      current: match.content,
      expected: expectedLine,
      hint: "Re-read the file to see current content",
    };
  }

  // Replace — preserve leading whitespace from original line if new_line has none
  const newLines = [...lines];
  newLines[match.index] = newLine;
  return {
    success: true,
    content: newLines.join(eol),
    lineNumber: match.lineNumber,
    previousContent: match.content,
  };
}

/**
 * Produce a small snippet of context around a given line index for error
 * messages. Uses annotated form so the agent can retry with fresh hashes.
 *
 * @param {string} content
 * @param {number} lineIndex - 0-based
 * @param {number} [contextLines=3]
 * @returns {string}
 */
export function snippetAround(content, lineIndex, contextLines = 3) {
  const { lines, eol } = splitLines(content);
  const start = Math.max(0, lineIndex - contextLines);
  const end = Math.min(lines.length, lineIndex + contextLines + 1);
  const slice = lines
    .slice(start, end)
    .map((line, i) => `${hashLine(line)}${SEPARATOR}${line}`);
  return slice.join(eol);
}

export const _internals = {
  HASH_LENGTH,
  EMPTY_HASH,
  SEPARATOR,
};

// =====================================================================
// hashline V2 governance overlay (iter26)
// =====================================================================
export const HLGOV_PROFILE_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  STALE: "stale",
  ARCHIVED: "archived",
});
export const HLGOV_DIGEST_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  HASHING: "hashing",
  HASHED: "hashed",
  FAILED: "failed",
  CANCELLED: "cancelled",
});
const _hlgovPTrans = new Map([
  [
    HLGOV_PROFILE_MATURITY_V2.PENDING,
    new Set([
      HLGOV_PROFILE_MATURITY_V2.ACTIVE,
      HLGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    HLGOV_PROFILE_MATURITY_V2.ACTIVE,
    new Set([
      HLGOV_PROFILE_MATURITY_V2.STALE,
      HLGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    HLGOV_PROFILE_MATURITY_V2.STALE,
    new Set([
      HLGOV_PROFILE_MATURITY_V2.ACTIVE,
      HLGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [HLGOV_PROFILE_MATURITY_V2.ARCHIVED, new Set()],
]);
const _hlgovPTerminal = new Set([HLGOV_PROFILE_MATURITY_V2.ARCHIVED]);
const _hlgovJTrans = new Map([
  [
    HLGOV_DIGEST_LIFECYCLE_V2.QUEUED,
    new Set([
      HLGOV_DIGEST_LIFECYCLE_V2.HASHING,
      HLGOV_DIGEST_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [
    HLGOV_DIGEST_LIFECYCLE_V2.HASHING,
    new Set([
      HLGOV_DIGEST_LIFECYCLE_V2.HASHED,
      HLGOV_DIGEST_LIFECYCLE_V2.FAILED,
      HLGOV_DIGEST_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [HLGOV_DIGEST_LIFECYCLE_V2.HASHED, new Set()],
  [HLGOV_DIGEST_LIFECYCLE_V2.FAILED, new Set()],
  [HLGOV_DIGEST_LIFECYCLE_V2.CANCELLED, new Set()],
]);
const _hlgovPsV2 = new Map();
const _hlgovJsV2 = new Map();
let _hlgovMaxActive = 8,
  _hlgovMaxPending = 20,
  _hlgovIdleMs = 30 * 24 * 60 * 60 * 1000,
  _hlgovStuckMs = 60 * 1000;
function _hlgovPos(n, label) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${label} must be positive integer`);
  return v;
}
function _hlgovCheckP(from, to) {
  const a = _hlgovPTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid hlgov profile transition ${from} → ${to}`);
}
function _hlgovCheckJ(from, to) {
  const a = _hlgovJTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid hlgov digest transition ${from} → ${to}`);
}
function _hlgovCountActive(owner) {
  let c = 0;
  for (const p of _hlgovPsV2.values())
    if (p.owner === owner && p.status === HLGOV_PROFILE_MATURITY_V2.ACTIVE) c++;
  return c;
}
function _hlgovCountPending(profileId) {
  let c = 0;
  for (const j of _hlgovJsV2.values())
    if (
      j.profileId === profileId &&
      (j.status === HLGOV_DIGEST_LIFECYCLE_V2.QUEUED ||
        j.status === HLGOV_DIGEST_LIFECYCLE_V2.HASHING)
    )
      c++;
  return c;
}
export function setMaxActiveHlgovProfilesPerOwnerV2(n) {
  _hlgovMaxActive = _hlgovPos(n, "maxActiveHlgovProfilesPerOwner");
}
export function getMaxActiveHlgovProfilesPerOwnerV2() {
  return _hlgovMaxActive;
}
export function setMaxPendingHlgovDigestsPerProfileV2(n) {
  _hlgovMaxPending = _hlgovPos(n, "maxPendingHlgovDigestsPerProfile");
}
export function getMaxPendingHlgovDigestsPerProfileV2() {
  return _hlgovMaxPending;
}
export function setHlgovProfileIdleMsV2(n) {
  _hlgovIdleMs = _hlgovPos(n, "hlgovProfileIdleMs");
}
export function getHlgovProfileIdleMsV2() {
  return _hlgovIdleMs;
}
export function setHlgovDigestStuckMsV2(n) {
  _hlgovStuckMs = _hlgovPos(n, "hlgovDigestStuckMs");
}
export function getHlgovDigestStuckMsV2() {
  return _hlgovStuckMs;
}
export function _resetStateHashlineGovV2() {
  _hlgovPsV2.clear();
  _hlgovJsV2.clear();
  _hlgovMaxActive = 8;
  _hlgovMaxPending = 20;
  _hlgovIdleMs = 30 * 24 * 60 * 60 * 1000;
  _hlgovStuckMs = 60 * 1000;
}
export function registerHlgovProfileV2({
  id,
  owner,
  algorithm,
  metadata,
} = {}) {
  if (!id || !owner) throw new Error("id and owner required");
  if (_hlgovPsV2.has(id)) throw new Error(`hlgov profile ${id} already exists`);
  const now = Date.now();
  const p = {
    id,
    owner,
    algorithm: algorithm || "sha256",
    status: HLGOV_PROFILE_MATURITY_V2.PENDING,
    createdAt: now,
    updatedAt: now,
    lastTouchedAt: now,
    activatedAt: null,
    archivedAt: null,
    metadata: { ...(metadata || {}) },
  };
  _hlgovPsV2.set(id, p);
  return { ...p, metadata: { ...p.metadata } };
}
export function activateHlgovProfileV2(id) {
  const p = _hlgovPsV2.get(id);
  if (!p) throw new Error(`hlgov profile ${id} not found`);
  const isInitial = p.status === HLGOV_PROFILE_MATURITY_V2.PENDING;
  _hlgovCheckP(p.status, HLGOV_PROFILE_MATURITY_V2.ACTIVE);
  if (isInitial && _hlgovCountActive(p.owner) >= _hlgovMaxActive)
    throw new Error(`max active hlgov profiles for owner ${p.owner} reached`);
  const now = Date.now();
  p.status = HLGOV_PROFILE_MATURITY_V2.ACTIVE;
  p.updatedAt = now;
  p.lastTouchedAt = now;
  if (!p.activatedAt) p.activatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function staleHlgovProfileV2(id) {
  const p = _hlgovPsV2.get(id);
  if (!p) throw new Error(`hlgov profile ${id} not found`);
  _hlgovCheckP(p.status, HLGOV_PROFILE_MATURITY_V2.STALE);
  p.status = HLGOV_PROFILE_MATURITY_V2.STALE;
  p.updatedAt = Date.now();
  return { ...p, metadata: { ...p.metadata } };
}
export function archiveHlgovProfileV2(id) {
  const p = _hlgovPsV2.get(id);
  if (!p) throw new Error(`hlgov profile ${id} not found`);
  _hlgovCheckP(p.status, HLGOV_PROFILE_MATURITY_V2.ARCHIVED);
  const now = Date.now();
  p.status = HLGOV_PROFILE_MATURITY_V2.ARCHIVED;
  p.updatedAt = now;
  if (!p.archivedAt) p.archivedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function touchHlgovProfileV2(id) {
  const p = _hlgovPsV2.get(id);
  if (!p) throw new Error(`hlgov profile ${id} not found`);
  if (_hlgovPTerminal.has(p.status))
    throw new Error(`cannot touch terminal hlgov profile ${id}`);
  const now = Date.now();
  p.lastTouchedAt = now;
  p.updatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function getHlgovProfileV2(id) {
  const p = _hlgovPsV2.get(id);
  if (!p) return null;
  return { ...p, metadata: { ...p.metadata } };
}
export function listHlgovProfilesV2() {
  return [..._hlgovPsV2.values()].map((p) => ({
    ...p,
    metadata: { ...p.metadata },
  }));
}
export function createHlgovDigestV2({ id, profileId, content, metadata } = {}) {
  if (!id || !profileId) throw new Error("id and profileId required");
  if (_hlgovJsV2.has(id)) throw new Error(`hlgov digest ${id} already exists`);
  if (!_hlgovPsV2.has(profileId))
    throw new Error(`hlgov profile ${profileId} not found`);
  if (_hlgovCountPending(profileId) >= _hlgovMaxPending)
    throw new Error(
      `max pending hlgov digests for profile ${profileId} reached`,
    );
  const now = Date.now();
  const j = {
    id,
    profileId,
    content: content || "",
    status: HLGOV_DIGEST_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    settledAt: null,
    metadata: { ...(metadata || {}) },
  };
  _hlgovJsV2.set(id, j);
  return { ...j, metadata: { ...j.metadata } };
}
export function hashingHlgovDigestV2(id) {
  const j = _hlgovJsV2.get(id);
  if (!j) throw new Error(`hlgov digest ${id} not found`);
  _hlgovCheckJ(j.status, HLGOV_DIGEST_LIFECYCLE_V2.HASHING);
  const now = Date.now();
  j.status = HLGOV_DIGEST_LIFECYCLE_V2.HASHING;
  j.updatedAt = now;
  if (!j.startedAt) j.startedAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function completeDigestHlgovV2(id) {
  const j = _hlgovJsV2.get(id);
  if (!j) throw new Error(`hlgov digest ${id} not found`);
  _hlgovCheckJ(j.status, HLGOV_DIGEST_LIFECYCLE_V2.HASHED);
  const now = Date.now();
  j.status = HLGOV_DIGEST_LIFECYCLE_V2.HASHED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function failHlgovDigestV2(id, reason) {
  const j = _hlgovJsV2.get(id);
  if (!j) throw new Error(`hlgov digest ${id} not found`);
  _hlgovCheckJ(j.status, HLGOV_DIGEST_LIFECYCLE_V2.FAILED);
  const now = Date.now();
  j.status = HLGOV_DIGEST_LIFECYCLE_V2.FAILED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.failReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function cancelHlgovDigestV2(id, reason) {
  const j = _hlgovJsV2.get(id);
  if (!j) throw new Error(`hlgov digest ${id} not found`);
  _hlgovCheckJ(j.status, HLGOV_DIGEST_LIFECYCLE_V2.CANCELLED);
  const now = Date.now();
  j.status = HLGOV_DIGEST_LIFECYCLE_V2.CANCELLED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.cancelReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function getHlgovDigestV2(id) {
  const j = _hlgovJsV2.get(id);
  if (!j) return null;
  return { ...j, metadata: { ...j.metadata } };
}
export function listHlgovDigestsV2() {
  return [..._hlgovJsV2.values()].map((j) => ({
    ...j,
    metadata: { ...j.metadata },
  }));
}
export function autoStaleIdleHlgovProfilesV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const p of _hlgovPsV2.values())
    if (
      p.status === HLGOV_PROFILE_MATURITY_V2.ACTIVE &&
      t - p.lastTouchedAt >= _hlgovIdleMs
    ) {
      p.status = HLGOV_PROFILE_MATURITY_V2.STALE;
      p.updatedAt = t;
      flipped.push(p.id);
    }
  return { flipped, count: flipped.length };
}
export function autoFailStuckHlgovDigestsV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const j of _hlgovJsV2.values())
    if (
      j.status === HLGOV_DIGEST_LIFECYCLE_V2.HASHING &&
      j.startedAt != null &&
      t - j.startedAt >= _hlgovStuckMs
    ) {
      j.status = HLGOV_DIGEST_LIFECYCLE_V2.FAILED;
      j.updatedAt = t;
      if (!j.settledAt) j.settledAt = t;
      j.metadata.failReason = "auto-fail-stuck";
      flipped.push(j.id);
    }
  return { flipped, count: flipped.length };
}
export function getHashlineGovStatsV2() {
  const profilesByStatus = {};
  for (const v of Object.values(HLGOV_PROFILE_MATURITY_V2))
    profilesByStatus[v] = 0;
  for (const p of _hlgovPsV2.values()) profilesByStatus[p.status]++;
  const digestsByStatus = {};
  for (const v of Object.values(HLGOV_DIGEST_LIFECYCLE_V2))
    digestsByStatus[v] = 0;
  for (const j of _hlgovJsV2.values()) digestsByStatus[j.status]++;
  return {
    totalHlgovProfilesV2: _hlgovPsV2.size,
    totalHlgovDigestsV2: _hlgovJsV2.size,
    maxActiveHlgovProfilesPerOwner: _hlgovMaxActive,
    maxPendingHlgovDigestsPerProfile: _hlgovMaxPending,
    hlgovProfileIdleMs: _hlgovIdleMs,
    hlgovDigestStuckMs: _hlgovStuckMs,
    profilesByStatus,
    digestsByStatus,
  };
}
