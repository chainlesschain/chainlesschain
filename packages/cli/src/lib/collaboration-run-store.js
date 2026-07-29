/**
 * Durable, secret-free governance records for short-lived `cc team` / `cc
 * batch` worktree runs.
 *
 * These are deliberately separate from background-agent state: a team/batch
 * task is not independently attachable or stoppable, and pretending otherwise
 * could make `cc daemon stop` kill the shared coordinator process. The daemon
 * JSON view may project these records read-only for IDE task rows.
 *
 * Prompts, argv, tool arguments, model output, credentials, and side-effect
 * metadata never enter this store.
 *
 * Each run has one immutable `<id>.json` base manifest. Mutations are bounded,
 * append-only `<id>.journal.jsonl` events replayed under the same fail-closed
 * file lock. History is never compacted or rewritten: a resume anchor can
 * therefore prove that its exact seq+digest remains a prefix of the journal.
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { isDeepStrictEqual, TextDecoder } from "node:util";
import { getHomeDir } from "./paths.js";
import { tightenPermissionMode } from "./subagent-contract.js";
import { withFileLock } from "./with-file-lock.js";

export const COLLABORATION_RUN_VERSION = 1;
export const MAX_COLLABORATION_UNITS = 10000;
export const COLLABORATION_JOURNAL_VERSION = 1;
export const MAX_COLLABORATION_JOURNAL_EVENTS = 50000;
export const MAX_COLLABORATION_JOURNAL_BYTES = 64 * 1024 * 1024;
export const MAX_COLLABORATION_JOURNAL_EVENT_BYTES = 32 * 1024;
const MAX_COLLABORATION_CACHE_ENTRIES = 64;
const MAX_COLLABORATION_CACHED_UNITS = 50000;
const RUN_KINDS = new Set(["team", "batch"]);
const PERMISSION_MODES = new Set([
  "manual",
  "auto",
  "dontAsk",
  "default",
  "plan",
  "acceptEdits",
  "bypassPermissions",
]);
const TERMINAL_RUN_STATUSES = new Set(["completed", "failed", "cancelled"]);
const UNIT_STATUSES = new Set([
  "pending",
  "running",
  "completed",
  "failed",
  "test-failed",
  "no-changes",
  "cancelled",
]);
const TERMINAL_UNIT_STATUSES = new Set([
  "completed",
  "failed",
  "test-failed",
  "no-changes",
  "cancelled",
]);

export const _deps = {
  now: () => Date.now(),
  randomHex: () => randomBytes(3).toString("hex"),
  withFileLock,
  maxJournalEvents: MAX_COLLABORATION_JOURNAL_EVENTS,
  maxJournalBytes: MAX_COLLABORATION_JOURNAL_BYTES,
};

// The cache owns normalized, secret-free state plus an O(1) unit-key index.
// Public APIs always return clones so callers cannot mutate cached state.
const runCache = new Map();
let cachedUnitCount = 0;

function advanceJournalDigest(previous, line) {
  return createHash("sha256")
    .update(previous || "", "utf8")
    .update("\0", "utf8")
    .update(line, "utf8")
    .digest("hex");
}

function collaborationStoreError(code, message, details = {}) {
  const error = new Error(message);
  error.name = "CollaborationRunStoreError";
  error.code = code;
  for (const [key, value] of Object.entries(details)) {
    if (value !== undefined && value !== null) error[key] = value;
  }
  return error;
}

function boundedString(value, max) {
  if (value === null || value === undefined) return null;
  const clean = String(value)
    .replace(/\p{Cc}/gu, "")
    .trim();
  return clean ? clean.slice(0, max) : null;
}

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function nonNegativeInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0;
}

function safeKind(kind) {
  const value = String(kind || "");
  if (!RUN_KINDS.has(value)) {
    throw new Error(
      `Unsupported collaboration run kind: ${value || "(empty)"}`,
    );
  }
  return value;
}

function safeRunId(id) {
  const value = String(id || "");
  if (value.length > 160 || !/^(team|batch)-[a-zA-Z0-9._-]+$/.test(value)) {
    throw new Error(`Invalid collaboration run id: ${value || "(empty)"}`);
  }
  return value;
}

export function collaborationRunsDir() {
  const dir =
    process.env.CC_COLLABORATION_RUNS_DIR ||
    join(getHomeDir(), "collaboration-runs");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

export function createCollaborationRunId(kind) {
  const normalizedKind = safeKind(kind);
  return `${normalizedKind}-${Math.floor(_deps.now())}-${_deps.randomHex()}`;
}

export function createCollaborationSessionId(runId, key) {
  const safeId = safeRunId(runId);
  const digest = createHash("sha256")
    .update(String(key || "unit"))
    .digest("hex")
    .slice(0, 12);
  return `session-${safeId}-${digest}`.slice(0, 256);
}

export function collaborationRunPath(id) {
  return join(collaborationRunsDir(), `${safeRunId(id)}.json`);
}

export function collaborationRunJournalPath(id) {
  return join(collaborationRunsDir(), `${safeRunId(id)}.journal.jsonl`);
}

function withCollaborationRunLock(target, fn) {
  return _deps.withFileLock(target, fn, { failIfUnavailable: true });
}

function journalEventLimit() {
  const value = Number(_deps.maxJournalEvents);
  return Number.isSafeInteger(value) && value > 0
    ? value
    : MAX_COLLABORATION_JOURNAL_EVENTS;
}

function journalByteLimit() {
  const value = Number(_deps.maxJournalBytes);
  return Number.isSafeInteger(value) && value > 0
    ? value
    : MAX_COLLABORATION_JOURNAL_BYTES;
}

function cloneRun(run) {
  return JSON.parse(JSON.stringify(run));
}

function cloneUnit(unit) {
  return JSON.parse(JSON.stringify(unit));
}

function buildUnitIndex(run) {
  return new Map(run.units.map((unit, index) => [unit.key, index]));
}

function setCachedState(target, state) {
  const previous = runCache.get(target);
  if (previous) {
    cachedUnitCount -= previous.cacheWeight ?? previous.run.units.length;
  }
  runCache.delete(target);
  state.cacheWeight = state.run.units.length;
  runCache.set(target, state);
  cachedUnitCount += state.cacheWeight;
  while (
    runCache.size > MAX_COLLABORATION_CACHE_ENTRIES ||
    cachedUnitCount > MAX_COLLABORATION_CACHED_UNITS
  ) {
    const oldestKey = runCache.keys().next().value;
    const oldest = runCache.get(oldestKey);
    runCache.delete(oldestKey);
    cachedUnitCount -= oldest?.cacheWeight ?? oldest?.run?.units?.length ?? 0;
  }
}

function dropCachedState(target) {
  const previous = runCache.get(target);
  if (previous) {
    cachedUnitCount -= previous.cacheWeight ?? previous.run.units.length;
  }
  runCache.delete(target);
}

function fileSignature(filePath) {
  if (!existsSync(filePath)) return null;
  const stat = statSync(filePath);
  return {
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    ctimeMs: stat.ctimeMs,
  };
}

function sameSignature(left, right) {
  if (left === null || right === null) return left === right;
  return (
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  );
}

function normalizeBudget(resourceBudget) {
  const source =
    resourceBudget && typeof resourceBudget === "object" ? resourceBudget : {};
  return {
    maxTurns: positiveNumber(source.maxTurns),
    maxCostUsd: positiveNumber(source.maxCostUsd),
    maxTasks: positiveNumber(source.maxTasks),
    maxTokens: positiveNumber(source.maxTokens),
    maxWallMs: positiveNumber(source.maxWallMs),
  };
}

function effectiveBudget(resourceBudget, parentBudget) {
  const child = normalizeBudget(resourceBudget);
  const parent = normalizeBudget(parentBudget);
  const cap = (childValue, parentValue) => {
    if (childValue == null) return parentValue;
    if (parentValue == null) return childValue;
    return Math.min(childValue, parentValue);
  };
  return {
    maxTurns: cap(child.maxTurns, parent.maxTurns),
    maxCostUsd: cap(child.maxCostUsd, parent.maxCostUsd),
    maxTasks: cap(child.maxTasks, parent.maxTasks),
    maxTokens: cap(child.maxTokens, parent.maxTokens),
    maxWallMs: cap(child.maxWallMs, parent.maxWallMs),
  };
}

function normalizeScopePaths(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  const seen = new Set();
  for (const item of value.slice(0, 128)) {
    const clean = boundedString(item, 1024);
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
  }
  return out;
}

function summarizeSideEffects(source) {
  const ops =
    source && typeof source.list === "function"
      ? source.list()
      : Array.isArray(source?.ops)
        ? source.ops
        : null;
  if (ops) {
    const count = (state) => ops.filter((op) => op?.state === state).length;
    return {
      total: ops.length,
      unsettled: ops.filter(
        (op) => op?.state === "prepared" || op?.state === "started",
      ).length,
      unknown: count("unknown"),
      committed: count("committed"),
      failed: count("failed"),
    };
  }
  const value = source && typeof source === "object" ? source : {};
  return {
    total: nonNegativeInteger(value.total),
    unsettled: nonNegativeInteger(value.unsettled),
    unknown: nonNegativeInteger(value.unknown),
    committed: nonNegativeInteger(value.committed),
    failed: nonNegativeInteger(value.failed),
  };
}

function normalizeUnit(unit, run) {
  const key = boundedString(unit?.key, 256);
  if (!key) throw new Error("Collaboration unit key is required");
  const status = UNIT_STATUSES.has(unit?.status) ? unit.status : "pending";
  const sessionId = boundedString(unit?.sessionId, 256);
  return {
    key,
    owner: `${run.kind}:${run.id}:${key}`.slice(0, 512),
    sessionId,
    branch: boundedString(unit?.branch, 512),
    worktreePath: boundedString(unit?.worktreePath, 4096),
    permissionMode: tightenPermissionMode(
      run.permissionMode,
      PERMISSION_MODES.has(unit?.permissionMode)
        ? unit.permissionMode
        : run.permissionMode,
    ),
    resourceBudget: effectiveBudget(unit?.resourceBudget, run.resourceBudget),
    checkpointRequired:
      run.checkpointRequired === true || unit?.checkpointRequired === true,
    worktreeRequired:
      run.worktreeRequired === true || unit?.worktreeRequired === true,
    scopePaths: normalizeScopePaths(unit?.scopePaths),
    status,
    startedAt: positiveNumber(unit?.startedAt),
    endedAt: positiveNumber(unit?.endedAt),
    sideEffects: summarizeSideEffects(unit?.sideEffects),
  };
}

function normalizeRun(input) {
  const kind = safeKind(input?.kind);
  const id = safeRunId(input?.id);
  if (!id.startsWith(`${kind}-`)) {
    throw new Error(
      `Collaboration run id "${id}" does not match kind "${kind}"`,
    );
  }
  const permissionMode = PERMISSION_MODES.has(input?.permissionMode)
    ? input.permissionMode
    : "default";
  const status = new Set(["running", ...TERMINAL_RUN_STATUSES]).has(
    input?.status,
  )
    ? input.status
    : "running";
  const startedAt = positiveNumber(input?.startedAt) || _deps.now();
  const run = {
    version: COLLABORATION_RUN_VERSION,
    journalRequired: input?.journalRequired === true,
    id,
    kind,
    owner: `${kind}:${id}`,
    status,
    repoRoot: boundedString(input?.repoRoot, 4096),
    permissionMode,
    resourceBudget: normalizeBudget(input?.resourceBudget),
    checkpointRequired: input?.checkpointRequired === true,
    worktreeRequired: input?.worktreeRequired === true,
    startedAt,
    updatedAt: positiveNumber(input?.updatedAt) || startedAt,
    endedAt: TERMINAL_RUN_STATUSES.has(status)
      ? positiveNumber(input?.endedAt) || startedAt
      : null,
    units: [],
  };
  const seen = new Set();
  const units = Array.isArray(input?.units) ? input.units : [];
  if (units.length > MAX_COLLABORATION_UNITS) {
    throw new Error(
      `Collaboration run has ${units.length} units; maximum is ${MAX_COLLABORATION_UNITS}`,
    );
  }
  for (const unit of units) {
    const normalized = normalizeUnit(unit, run);
    if (seen.has(normalized.key)) {
      throw new Error(`Duplicate collaboration unit key: ${normalized.key}`);
    }
    seen.add(normalized.key);
    run.units.push(normalized);
  }
  return run;
}

const UNIT_PATCH_KEYS = new Set([
  "branch",
  "worktreePath",
  "status",
  "startedAt",
  "endedAt",
  "sideEffects",
]);
const SIDE_EFFECT_KEYS = new Set([
  "total",
  "unsettled",
  "unknown",
  "committed",
  "failed",
]);

function journalCorrupt(id, line, reason) {
  return collaborationStoreError(
    "COLLABORATION_JOURNAL_CORRUPT",
    `Collaboration journal is corrupt for ${id} at line ${line}: ${reason}`,
    { runId: id, line },
  );
}

function assertExactKeys(value, allowed, required, id, line, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw journalCorrupt(id, line, `invalid ${label}`);
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw journalCorrupt(id, line, `unexpected ${label} field`);
    }
  }
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      throw journalCorrupt(id, line, `missing ${label} field`);
    }
  }
}

function decodeJsonObject(raw, id, label, line = 0) {
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(raw);
  } catch {
    throw collaborationStoreError(
      label === "journal"
        ? "COLLABORATION_JOURNAL_CORRUPT"
        : "COLLABORATION_RUN_CORRUPT",
      `Invalid UTF-8 in collaboration ${label} for ${id}`,
      { runId: id, ...(line > 0 ? { line } : {}) },
    );
  }
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new TypeError("not an object");
    }
    return value;
  } catch {
    throw collaborationStoreError(
      label === "journal"
        ? "COLLABORATION_JOURNAL_CORRUPT"
        : "COLLABORATION_RUN_CORRUPT",
      `Invalid JSON in collaboration ${label} for ${id}${
        line > 0 ? ` at line ${line}` : ""
      }`,
      { runId: id, ...(line > 0 ? { line } : {}) },
    );
  }
}

function atomicWrite(target, contents) {
  const temp = `${target}.${process.pid}.${_deps.randomHex()}.tmp`;
  try {
    writeFileSync(temp, contents, { mode: 0o600 });
    renameSync(temp, target);
  } finally {
    try {
      if (existsSync(temp)) rmSync(temp, { force: true });
    } catch {
      // A failed cleanup must not hide the original write/rename failure.
    }
  }
}

function buildUnitPatch(patch) {
  const source = patch && typeof patch === "object" ? patch : {};
  const result = {};
  if (source.branch !== undefined) {
    result.branch = boundedString(source.branch, 512);
  }
  if (source.worktreePath !== undefined) {
    result.worktreePath = boundedString(source.worktreePath, 4096);
  }
  if (UNIT_STATUSES.has(source.status)) result.status = source.status;
  if (source.startedAt !== undefined) {
    result.startedAt = positiveNumber(source.startedAt);
  }
  if (source.endedAt !== undefined) {
    result.endedAt = positiveNumber(source.endedAt);
  }
  if (source.sideEffects !== undefined) {
    result.sideEffects = summarizeSideEffects(source.sideEffects);
  }
  return result;
}

function validateJournalUnitPatch(raw, id, line) {
  assertExactKeys(raw, UNIT_PATCH_KEYS, [], id, line, "unit patch");
  const patch = {};
  for (const key of Object.keys(raw)) {
    if (key === "branch" || key === "worktreePath") {
      const max = key === "branch" ? 512 : 4096;
      const normalized = boundedString(raw[key], max);
      if (normalized !== raw[key]) {
        throw journalCorrupt(id, line, `invalid ${key}`);
      }
      patch[key] = normalized;
    } else if (key === "status") {
      if (!UNIT_STATUSES.has(raw.status)) {
        throw journalCorrupt(id, line, "invalid unit status");
      }
      patch.status = raw.status;
    } else if (key === "startedAt" || key === "endedAt") {
      if (raw[key] !== null && positiveNumber(raw[key]) !== raw[key]) {
        throw journalCorrupt(id, line, `invalid ${key}`);
      }
      patch[key] = raw[key];
    } else if (key === "sideEffects") {
      assertExactKeys(
        raw.sideEffects,
        SIDE_EFFECT_KEYS,
        SIDE_EFFECT_KEYS,
        id,
        line,
        "sideEffects",
      );
      for (const field of SIDE_EFFECT_KEYS) {
        if (
          !Number.isSafeInteger(raw.sideEffects[field]) ||
          raw.sideEffects[field] < 0
        ) {
          throw journalCorrupt(id, line, "invalid sideEffects count");
        }
      }
      patch.sideEffects = { ...raw.sideEffects };
    }
  }
  return patch;
}

function applyTrustedEvent(state, event) {
  if (event.type === "unit.update") {
    const index = state.unitIndex.get(event.key);
    state.run.units[index] = {
      ...state.run.units[index],
      ...event.patch,
    };
    state.run.updatedAt = event.at;
  } else if (event.type === "run.finalize") {
    state.run.status = event.status;
    state.run.updatedAt = event.at;
    state.run.endedAt = event.at;
  } else if (event.type === "run.snapshot") {
    state.run = event.run;
    state.unitIndex = buildUnitIndex(event.run);
  }
}

function validateAndApplyJournalEvent(state, raw, id, line) {
  const commonKeys = ["version", "runId", "seq", "type", "at"];
  const allowedByType = {
    "unit.update": new Set([...commonKeys, "key", "patch"]),
    "run.finalize": new Set([...commonKeys, "status"]),
    "run.snapshot": new Set([...commonKeys, "run"]),
  };
  const allowed = allowedByType[raw?.type];
  if (!allowed) throw journalCorrupt(id, line, "unsupported event type");
  assertExactKeys(raw, allowed, allowed, id, line, "event");
  if (
    raw.version !== COLLABORATION_JOURNAL_VERSION ||
    raw.runId !== id ||
    !Number.isSafeInteger(raw.seq) ||
    raw.seq <= 0 ||
    !Number.isFinite(raw.at) ||
    raw.at < 0
  ) {
    throw journalCorrupt(id, line, "invalid event envelope");
  }
  if (state.lastSeq === 0) {
    if (raw.type !== "run.snapshot" || raw.seq !== 1) {
      throw journalCorrupt(
        id,
        line,
        "journal must start with the genesis snapshot at sequence 1",
      );
    }
  } else if (raw.seq !== state.lastSeq + 1) {
    throw journalCorrupt(id, line, "journal sequence gap");
  }
  if (state.lastSeq > 0 && TERMINAL_RUN_STATUSES.has(state.run.status)) {
    throw journalCorrupt(id, line, "event appears after terminal run state");
  }
  if (state.lastSeq > 0 && raw.type === "run.snapshot") {
    throw journalCorrupt(id, line, "unexpected non-genesis run snapshot");
  }

  let event;
  if (raw.type === "unit.update") {
    if (
      typeof raw.key !== "string" ||
      boundedString(raw.key, 256) !== raw.key ||
      !state.unitIndex.has(raw.key)
    ) {
      throw journalCorrupt(id, line, "unknown collaboration unit");
    }
    const patch = validateJournalUnitPatch(raw.patch, id, line);
    const currentUnit = state.run.units[state.unitIndex.get(raw.key)];
    const currentStatus = currentUnit.status;
    if (
      TERMINAL_UNIT_STATUSES.has(currentStatus) &&
      Object.entries(patch).some(
        ([field, value]) => !isDeepStrictEqual(currentUnit[field], value),
      )
    ) {
      throw journalCorrupt(id, line, "terminal unit mutation");
    }
    event = {
      ...raw,
      patch,
    };
  } else if (raw.type === "run.finalize") {
    if (!TERMINAL_RUN_STATUSES.has(raw.status)) {
      throw journalCorrupt(id, line, "invalid terminal run status");
    }
    if (
      raw.status === "completed" &&
      state.run.units.some((unit) => unit.status !== "completed")
    ) {
      throw journalCorrupt(id, line, "completed run has incomplete units");
    }
    event = raw;
  } else {
    let normalized;
    try {
      normalized = normalizeRun(raw.run);
    } catch {
      throw journalCorrupt(id, line, "invalid run snapshot");
    }
    if (
      normalized.id !== id ||
      normalized.kind !== state.run.kind ||
      !isDeepStrictEqual(normalized, raw.run)
    ) {
      throw journalCorrupt(id, line, "non-canonical run snapshot");
    }
    event = { ...raw, run: normalized };
  }

  applyTrustedEvent(state, event);
  state.lastSeq = raw.seq;
  state.eventCount += 1;
}

function readBaseManifest(target, id) {
  let raw;
  try {
    raw = decodeJsonObject(readFileSync(target), id, "manifest");
    const run = normalizeRun(raw);
    if (run.id !== id) {
      throw new Error("run id mismatch");
    }
    return run;
  } catch (error) {
    if (error?.code === "COLLABORATION_RUN_CORRUPT") throw error;
    throw collaborationStoreError(
      "COLLABORATION_RUN_CORRUPT",
      `Invalid collaboration manifest for ${id}`,
      { runId: id },
    );
  }
}

function replayJournal(state, journalPath, id, signature) {
  if (signature === null) {
    if (state.run.journalRequired === true) {
      throw collaborationStoreError(
        "COLLABORATION_JOURNAL_MISSING",
        `Collaboration journal is missing for ${id}`,
        { runId: id },
      );
    }
    return;
  }
  const byteLimit = journalByteLimit();
  if (signature.size > byteLimit) {
    throw collaborationStoreError(
      "COLLABORATION_JOURNAL_BYTE_LIMIT",
      `Collaboration journal for ${id} exceeds ${byteLimit} bytes`,
      { runId: id, limit: byteLimit, actual: signature.size },
    );
  }

  const bytes = readFileSync(journalPath);
  // This store never creates an empty journal: the file appears with the first
  // complete append. An existing zero-byte file therefore means a torn first
  // write or external truncation and must not silently reset state to base.
  if (bytes.length === 0) {
    throw journalCorrupt(id, 1, "empty journal");
  }
  if (bytes[bytes.length - 1] !== 0x0a) {
    throw journalCorrupt(id, 1, "truncated final event");
  }
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw journalCorrupt(id, 1, "invalid UTF-8");
  }
  const lines = text.slice(0, -1).split("\n");
  const eventLimit = journalEventLimit();
  if (lines.length > eventLimit) {
    throw collaborationStoreError(
      "COLLABORATION_JOURNAL_EVENT_LIMIT",
      `Collaboration journal for ${id} exceeds ${eventLimit} events`,
      { runId: id, limit: eventLimit, actual: lines.length },
    );
  }
  for (let i = 0; i < lines.length; i += 1) {
    const lineNumber = i + 1;
    if (lines[i] === "") {
      throw journalCorrupt(id, lineNumber, "empty event");
    }
    const lineBytes = Buffer.byteLength(lines[i], "utf8");
    let raw;
    try {
      raw = JSON.parse(lines[i]);
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        throw new TypeError("not an object");
      }
    } catch {
      throw journalCorrupt(id, lineNumber, "invalid JSON");
    }
    if (
      raw.type !== "run.snapshot" &&
      lineBytes > MAX_COLLABORATION_JOURNAL_EVENT_BYTES
    ) {
      throw collaborationStoreError(
        "COLLABORATION_JOURNAL_EVENT_BYTES",
        `Collaboration journal event for ${id} exceeds ${MAX_COLLABORATION_JOURNAL_EVENT_BYTES} bytes`,
        {
          runId: id,
          line: lineNumber,
          limit: MAX_COLLABORATION_JOURNAL_EVENT_BYTES,
          actual: lineBytes,
        },
      );
    }
    validateAndApplyJournalEvent(state, raw, id, lineNumber);
    state.journalDigest = advanceJournalDigest(
      state.journalDigest,
      `${lines[i]}\n`,
    );
  }
}

function loadStateLocked(target, id) {
  const journalPath = collaborationRunJournalPath(id);
  const baseSignature = fileSignature(target);
  if (baseSignature === null) {
    dropCachedState(target);
    return null;
  }
  const journalSignature = fileSignature(journalPath);
  const cached = runCache.get(target);
  if (
    cached &&
    sameSignature(cached.baseSignature, baseSignature) &&
    sameSignature(cached.journalSignature, journalSignature)
  ) {
    if (cached.eventCount > journalEventLimit()) {
      throw collaborationStoreError(
        "COLLABORATION_JOURNAL_EVENT_LIMIT",
        `Collaboration journal for ${id} exceeds the configured event limit`,
        { runId: id, limit: journalEventLimit(), actual: cached.eventCount },
      );
    }
    if ((journalSignature?.size || 0) > journalByteLimit()) {
      throw collaborationStoreError(
        "COLLABORATION_JOURNAL_BYTE_LIMIT",
        `Collaboration journal for ${id} exceeds the configured byte limit`,
        {
          runId: id,
          limit: journalByteLimit(),
          actual: journalSignature?.size || 0,
        },
      );
    }
    return cached;
  }

  const run = readBaseManifest(target, id);
  const state = {
    run,
    unitIndex: buildUnitIndex(run),
    eventCount: 0,
    lastSeq: 0,
    journalDigest: null,
    baseSignature,
    journalSignature,
  };
  replayJournal(state, journalPath, id, journalSignature);
  setCachedState(target, state);
  return state;
}

function serializeJournalEvent(event) {
  const line = `${JSON.stringify(event)}\n`;
  const bytes = Buffer.byteLength(line, "utf8");
  if (
    event.type !== "run.snapshot" &&
    bytes > MAX_COLLABORATION_JOURNAL_EVENT_BYTES
  ) {
    throw collaborationStoreError(
      "COLLABORATION_JOURNAL_EVENT_BYTES",
      `Collaboration journal event exceeds ${MAX_COLLABORATION_JOURNAL_EVENT_BYTES} bytes`,
      {
        runId: event.runId,
        limit: MAX_COLLABORATION_JOURNAL_EVENT_BYTES,
        actual: bytes,
      },
    );
  }
  return { line, bytes };
}

function eventEnvelope(state, data, seq = state.lastSeq + 1) {
  return {
    version: COLLABORATION_JOURNAL_VERSION,
    runId: state.run.id,
    seq,
    type: data.type,
    at: data.at,
    ...(data.type === "unit.update"
      ? { key: data.key, patch: data.patch }
      : data.type === "run.finalize"
        ? { status: data.status }
        : { run: data.run }),
  };
}

function eventLimitError(state, limit, actual) {
  return collaborationStoreError(
    "COLLABORATION_JOURNAL_EVENT_LIMIT",
    `Collaboration journal for ${state.run.id} cannot stay within ${limit} events`,
    { runId: state.run.id, limit, actual },
  );
}

function appendJournalEventLocked(
  state,
  target,
  data,
  { returnUnit = false } = {},
) {
  const journalPath = collaborationRunJournalPath(state.run.id);
  const eventLimit = journalEventLimit();
  const byteLimit = journalByteLimit();
  const event = eventEnvelope(state, data);
  const serialized = serializeJournalEvent(event);
  const currentBytes = state.journalSignature?.size || 0;
  if (state.eventCount + 1 > eventLimit) {
    throw eventLimitError(state, eventLimit, state.eventCount + 1);
  }
  if (currentBytes + serialized.bytes > byteLimit) {
    throw collaborationStoreError(
      "COLLABORATION_JOURNAL_BYTE_LIMIT",
      `Collaboration journal for ${state.run.id} cannot exceed ${byteLimit} bytes`,
      {
        runId: state.run.id,
        limit: byteLimit,
        actual: currentBytes + serialized.bytes,
      },
    );
  }

  try {
    appendFileSync(journalPath, serialized.line, {
      encoding: "utf8",
      mode: 0o600,
    });
  } catch (error) {
    dropCachedState(target);
    throw error;
  }
  applyTrustedEvent(state, event);
  state.lastSeq = event.seq;
  state.eventCount += 1;
  state.journalDigest = advanceJournalDigest(
    state.journalDigest,
    serialized.line,
  );
  state.journalSignature = fileSignature(journalPath);
  setCachedState(target, state);
  if (returnUnit && event.type === "unit.update") {
    return cloneUnit(state.run.units[state.unitIndex.get(event.key)]);
  }
  return cloneRun(state.run);
}

export function writeCollaborationRun(input) {
  const run = normalizeRun({ ...input, journalRequired: true });
  const target = collaborationRunPath(run.id);
  const journalPath = collaborationRunJournalPath(run.id);
  return withCollaborationRunLock(target, () => {
    if (existsSync(target) || existsSync(journalPath)) {
      throw new Error(`Collaboration run already exists: ${run.id}`);
    }
    const state = {
      run,
      unitIndex: buildUnitIndex(run),
      eventCount: 0,
      lastSeq: 0,
      journalDigest: null,
      baseSignature: fileSignature(target),
      journalSignature: null,
    };
    const genesis = eventEnvelope(state, {
      type: "run.snapshot",
      at: run.updatedAt,
      run,
    });
    const serializedGenesis = serializeJournalEvent(genesis);
    if (serializedGenesis.bytes > journalByteLimit()) {
      throw collaborationStoreError(
        "COLLABORATION_JOURNAL_BYTE_LIMIT",
        `Initial collaboration journal for ${run.id} exceeds ${journalByteLimit()} bytes`,
        {
          runId: run.id,
          limit: journalByteLimit(),
          actual: serializedGenesis.bytes,
        },
      );
    }
    // The manifest is the visibility/commit point used by list/read APIs.
    // Materialize the validated journal first, then publish the manifest last.
    // A normal write failure removes the not-yet-visible journal.
    try {
      atomicWrite(journalPath, serializedGenesis.line);
      atomicWrite(target, JSON.stringify(run, null, 2));
    } catch (error) {
      try {
        if (!existsSync(target) && existsSync(journalPath)) {
          rmSync(journalPath, { force: true });
        }
      } catch {
        /* preserve the authoritative creation failure */
      }
      throw error;
    }
    state.baseSignature = fileSignature(target);
    state.eventCount = 1;
    state.lastSeq = genesis.seq;
    state.journalDigest = advanceJournalDigest(null, serializedGenesis.line);
    state.journalSignature = fileSignature(journalPath);
    setCachedState(target, state);
    return cloneRun(run);
  });
}

export function createCollaborationRun(input) {
  const kind = safeKind(input?.kind);
  const id = input?.id ? safeRunId(input.id) : createCollaborationRunId(kind);
  return writeCollaborationRun({
    ...input,
    id,
    kind,
    status: "running",
    startedAt: input?.startedAt || _deps.now(),
  });
}

export function readCollaborationRun(id) {
  const safeId = safeRunId(id);
  const target = collaborationRunPath(safeId);
  return withCollaborationRunLock(target, () => {
    const state = loadStateLocked(target, safeId);
    return state ? cloneRun(state.run) : null;
  });
}

function cursorFromState(state) {
  return {
    runId: state.run.id,
    lastSeq: state.lastSeq,
    eventCount: state.eventCount,
    journalBytes: state.journalSignature?.size || 0,
    journalDigest: state.journalDigest,
  };
}

function validateRecoveryAnchorLocked(state, anchor) {
  if (
    !anchor ||
    anchor.runId !== state.run.id ||
    !Number.isSafeInteger(anchor.lastSeq) ||
    anchor.lastSeq <= 0 ||
    !/^[a-f0-9]{64}$/.test(anchor.journalDigest || "")
  ) {
    throw collaborationStoreError(
      "COLLABORATION_JOURNAL_ANCHOR_INVALID",
      `Invalid collaboration recovery anchor for ${state.run.id}`,
      { runId: state.run.id },
    );
  }
  if (anchor.lastSeq > state.lastSeq) {
    throw collaborationStoreError(
      "COLLABORATION_JOURNAL_DIVERGED",
      `Collaboration journal diverges from the recovery anchor for ${state.run.id}`,
      { runId: state.run.id },
    );
  }

  const journalPath = collaborationRunJournalPath(state.run.id);
  const text = readFileSync(journalPath, "utf8");
  let digest = null;
  let matched = false;
  let eventCount = 0;
  let lastSeq = 0;
  try {
    if (!text.endsWith("\n")) {
      throw new Error("journal has no terminal newline");
    }
    for (const line of text.slice(0, -1).split("\n")) {
      digest = advanceJournalDigest(digest, `${line}\n`);
      const event = JSON.parse(line);
      eventCount += 1;
      lastSeq = event.seq;
      if (event.seq === anchor.lastSeq) {
        matched = digest === anchor.journalDigest;
      }
    }
  } catch {
    throw collaborationStoreError(
      "COLLABORATION_JOURNAL_DIVERGED",
      `Collaboration journal diverges from the recovery anchor for ${state.run.id}`,
      { runId: state.run.id },
    );
  }
  if (
    !matched ||
    eventCount !== state.eventCount ||
    lastSeq !== state.lastSeq ||
    digest !== state.journalDigest ||
    !sameSignature(fileSignature(journalPath), state.journalSignature)
  ) {
    throw collaborationStoreError(
      "COLLABORATION_JOURNAL_DIVERGED",
      `Collaboration journal diverges from the recovery anchor for ${state.run.id}`,
      { runId: state.run.id },
    );
  }
}

/** Monotonic recovery anchor for an external team-state snapshot. */
export function readCollaborationRunCursor(id) {
  const safeId = safeRunId(id);
  const target = collaborationRunPath(safeId);
  return withCollaborationRunLock(target, () => {
    const state = loadStateLocked(target, safeId);
    if (!state) return null;
    return cursorFromState(state);
  });
}

/**
 * Atomically read governance state and prove that an external resume cursor is
 * an exact prefix of the current append-only journal.
 */
export function readCollaborationRunRecovery(id, { anchor } = {}) {
  const safeId = safeRunId(id);
  const target = collaborationRunPath(safeId);
  return withCollaborationRunLock(target, () => {
    const state = loadStateLocked(target, safeId);
    if (!state) return null;
    validateRecoveryAnchorLocked(state, anchor);
    return {
      run: cloneRun(state.run),
      cursor: cursorFromState(state),
    };
  });
}

/**
 * Compatibility path retained for callers that probe/update without changing
 * anything. Generic snapshots cannot safely distinguish governance authority
 * from mutable progress, so any actual mutation is rejected. Use the
 * capability-scoped unit/finalize APIs below for state transitions.
 */
export function updateCollaborationRun(id, updater) {
  const safeId = safeRunId(id);
  const target = collaborationRunPath(safeId);
  return withCollaborationRunLock(target, () => {
    const state = loadStateLocked(target, safeId);
    if (!state) throw new Error(`Collaboration run not found: ${safeId}`);
    if (TERMINAL_RUN_STATUSES.has(state.run.status)) {
      throw collaborationStoreError(
        "COLLABORATION_RUN_TERMINAL",
        `Collaboration run is already terminal: ${safeId}`,
        { runId: safeId },
      );
    }
    const draft = cloneRun(state.run);
    const changed =
      typeof updater === "function"
        ? updater(draft) || draft
        : { ...draft, ...updater };
    if (!isDeepStrictEqual(changed, state.run)) {
      throw collaborationStoreError(
        "COLLABORATION_RUN_UPDATE_FORBIDDEN",
        `Generic updates cannot mutate collaboration run ${safeId}`,
        { runId: safeId },
      );
    }
    return cloneRun(state.run);
  });
}

/**
 * Append a secret-free unit update. The legacy/default return value is the
 * complete run. Large schedulers can pass `{returnUnit:true}` to clone only the
 * updated unit and avoid O(unit-count) serialization after every append.
 */
export function updateCollaborationUnit(
  runId,
  key,
  patch = {},
  { returnUnit = false } = {},
) {
  const safeId = safeRunId(runId);
  const targetKey = boundedString(key, 256);
  const target = collaborationRunPath(safeId);
  return withCollaborationRunLock(target, () => {
    const state = loadStateLocked(target, safeId);
    if (!state) throw new Error(`Collaboration run not found: ${safeId}`);
    if (TERMINAL_RUN_STATUSES.has(state.run.status)) {
      throw collaborationStoreError(
        "COLLABORATION_RUN_TERMINAL",
        `Collaboration run is already terminal: ${safeId}`,
        { runId: safeId },
      );
    }
    if (!targetKey || !state.unitIndex.has(targetKey)) {
      throw new Error(
        `Collaboration unit not found: ${targetKey || "(empty)"}`,
      );
    }
    const unit = state.run.units[state.unitIndex.get(targetKey)];
    const normalizedPatch = buildUnitPatch(patch);
    if (TERMINAL_UNIT_STATUSES.has(unit.status)) {
      const changed = Object.entries(normalizedPatch).some(
        ([field, value]) => !isDeepStrictEqual(unit[field], value),
      );
      if (changed) {
        throw collaborationStoreError(
          "COLLABORATION_UNIT_TERMINAL",
          `Collaboration unit ${targetKey} is already ${unit.status}`,
          { runId: safeId, unitKey: targetKey, status: unit.status },
        );
      }
      return returnUnit === true ? cloneUnit(unit) : cloneRun(state.run);
    }
    return appendJournalEventLocked(
      state,
      target,
      {
        type: "unit.update",
        at: _deps.now(),
        key: targetKey,
        patch: normalizedPatch,
      },
      {
        returnUnit: returnUnit === true,
      },
    );
  });
}

export function finalizeCollaborationRun(id, status = "completed") {
  if (!TERMINAL_RUN_STATUSES.has(status)) {
    throw new Error(`Invalid terminal collaboration status: ${status}`);
  }
  const safeId = safeRunId(id);
  const target = collaborationRunPath(safeId);
  return withCollaborationRunLock(target, () => {
    const state = loadStateLocked(target, safeId);
    if (!state) throw new Error(`Collaboration run not found: ${safeId}`);
    if (TERMINAL_RUN_STATUSES.has(state.run.status)) {
      if (state.run.status === status) return cloneRun(state.run);
      throw collaborationStoreError(
        "COLLABORATION_RUN_TERMINAL",
        `Collaboration run ${safeId} is already ${state.run.status}`,
        { runId: safeId },
      );
    }
    if (
      status === "completed" &&
      state.run.units.some((unit) => unit.status !== "completed")
    ) {
      throw collaborationStoreError(
        "COLLABORATION_RUN_INCOMPLETE",
        `Collaboration run ${safeId} has units that are not completed`,
        { runId: safeId },
      );
    }
    return appendJournalEventLocked(state, target, {
      type: "run.finalize",
      at: _deps.now(),
      status,
    });
  });
}

export function listCollaborationRuns({ limit = 200 } = {}) {
  const capped = Math.max(1, Math.min(1000, Number(limit) || 200));
  return readdirSync(collaborationRunsDir())
    .filter((name) => /^(team|batch)-[a-zA-Z0-9._-]+\.json$/.test(name))
    .map((name) => {
      try {
        return readCollaborationRun(name.slice(0, -5));
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.startedAt - a.startedAt)
    .slice(0, capped);
}

/**
 * Project run units into the bounded shape consumed by IDE worktree task rows.
 * The caller can publish this as `managedTasks`; no control operation consumes
 * these records.
 */
export function projectCollaborationTasks(runs) {
  const rows = [];
  for (const run of Array.isArray(runs) ? runs.slice(0, 200) : []) {
    for (const unit of Array.isArray(run?.units)
      ? run.units.slice(0, 1000)
      : []) {
      if (!unit.branch && !unit.worktreePath) continue;
      rows.push({
        managedTaskId: `${run.id}:${unit.key}`.slice(0, 512),
        runId: run.id,
        runKind: run.kind,
        branch: unit.branch,
        worktreePath: unit.worktreePath,
        status: unit.status,
        governance: {
          version: 1,
          owner: unit.owner,
          sessionId: unit.sessionId,
          permissionMode: unit.permissionMode,
          resourceBudget: unit.resourceBudget,
          checkpointRequired: unit.checkpointRequired,
          worktreeRequired: unit.worktreeRequired,
          scopePaths: unit.scopePaths,
        },
        sideEffects: summarizeSideEffects(unit.sideEffects),
      });
      if (rows.length >= 1000) return rows;
    }
  }
  return rows;
}
