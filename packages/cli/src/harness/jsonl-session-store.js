/**
 * JSONL Session Store — append-only session persistence.
 */

import {
  constants as fsConstants,
  existsSync,
  appendFileSync,
  readFileSync,
  readdirSync,
  copyFileSync,
  renameSync,
  rmSync,
  openSync,
  closeSync,
  fstatSync,
  lstatSync,
  readSync,
  ftruncateSync,
} from "node:fs";
import { join, basename, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { TextDecoder } from "node:util";
import { getHomeDir } from "../lib/paths.js";
import { ensurePrivateDirectory, ensurePrivateFile } from "../lib/secure-fs.js";
import {
  computeEventHash,
  TRANSCRIPT_CHAIN_STATUS,
} from "./transcript-integrity.js";
import { withFileLock } from "../lib/with-file-lock.js";
import {
  decodeVerifiedPersistedMessage,
  DURABLE_SYSTEM_MESSAGE_KINDS,
  encodePersistedMessage,
  markDurableSystemMessage,
  projectCanonicalResumeMessages,
  sanitizePersistedMessage,
  SESSION_FORK_AUTHORITY_FIELD,
} from "../lib/session-message-provenance.js";
import {
  iterateFileLinesSync,
  iterateFileLinesReverseSync,
} from "../lib/file-lines.js";
import {
  emptySessionMeta,
  applyEventToSessionMeta,
  listIndexedSessions,
  publicSessionMeta,
  readLatestSessionActivity,
  readSessionMeta,
  recordSessionDeleted,
  recordSessionEvent,
  recordSessionActivity,
  replaceSessionMeta,
  SESSION_TOMBSTONE_MARKER_SUFFIX,
} from "./session-list-index.js";
import { createSessionPersistenceFailure } from "../lib/session-persistence-failure.js";

let securedSessionsDir = null;
let securedSessionsDirIdentity = null;

// Deterministic process-crash injection for the independent session-scale
// gate. The hooks are inert unless the dedicated child process opts in; this
// keeps production behavior and ordinary tests on the exact same append path.
export const _sessionScaleFaultHooks = Object.seal({
  beforeTranscriptAppend: null,
  afterTranscriptAppend: null,
  afterForkCopy: null,
  afterForkLineage: null,
  afterForkPublish: null,
  afterForkMeta: null,
});

export const WS_TURN_EVENT = "ws_turn";
export const WS_TURN_CLAIM_EVENT = "ws_turn_claim";
export const WS_TURN_SCHEMA_VERSION = 1;
export const WS_TURN_REQUEST_ID_MAX_BYTES = 128;
const WS_TURN_CONTENT_MAX_BYTES = 4 * 1024 * 1024;
const WS_TURN_REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@-]*$/;
const WS_TURN_INPUT_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const WS_TURN_CLAIM_ID_PATTERN = /^claim-[0-9a-f-]{36}$/;
const WS_TURN_FAILURE_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;

function wsTurnError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function hasExactKeys(value, expectedKeys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

export function normalizeWsTurnRequestId(value) {
  if (typeof value !== "string") {
    throw wsTurnError(
      "Canonical WebSocket turns require a string request id",
      "CC_WS_REQUEST_ID_REQUIRED",
    );
  }
  const canonical = value.normalize("NFC");
  if (
    canonical !== value ||
    !WS_TURN_REQUEST_ID_PATTERN.test(canonical) ||
    Buffer.byteLength(canonical, "utf8") > WS_TURN_REQUEST_ID_MAX_BYTES
  ) {
    throw wsTurnError(
      "WebSocket request id is not bounded canonical ASCII",
      "CC_WS_REQUEST_ID_INVALID",
    );
  }
  return canonical;
}

function normalizeWsTurnContent(value, role) {
  if (
    typeof value !== "string" ||
    (role === "assistant" && value.trim().length === 0)
  ) {
    throw wsTurnError(
      `Canonical WebSocket ${role} content is invalid`,
      role === "assistant"
        ? "CC_WS_EMPTY_ASSISTANT_RESPONSE"
        : "CC_WS_USER_MESSAGE_INVALID",
    );
  }
  if (Buffer.byteLength(value, "utf8") > WS_TURN_CONTENT_MAX_BYTES) {
    throw wsTurnError(
      `Canonical WebSocket ${role} content exceeds the durable event limit`,
      "CC_WS_TURN_CONTENT_TOO_LARGE",
    );
  }
  return value;
}

function normalizeWsTurnInputDigest(value) {
  if (typeof value !== "string" || !WS_TURN_INPUT_DIGEST_PATTERN.test(value)) {
    throw wsTurnError(
      "Canonical WebSocket turn input digest is invalid",
      "CC_WS_TURN_INPUT_DIGEST_INVALID",
    );
  }
  return value;
}

function normalizeWsTurnClaimId(value) {
  if (typeof value !== "string" || !WS_TURN_CLAIM_ID_PATTERN.test(value)) {
    throw wsTurnError(
      "Canonical WebSocket turn claim id is invalid",
      "CC_WS_TURN_CLAIM_ID_INVALID",
    );
  }
  return value;
}

function normalizeWsTurnFailureCode(value) {
  if (typeof value !== "string" || !WS_TURN_FAILURE_CODE_PATTERN.test(value)) {
    throw wsTurnError(
      "Canonical WebSocket turn failure code is invalid",
      "CC_WS_TURN_FAILURE_CODE_INVALID",
    );
  }
  return value;
}

export function createWsTurnClaimId() {
  return `claim-${randomUUID()}`;
}

export function computeWsTurnInputDigest(user) {
  const content = normalizeWsTurnContent(user, "user");
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

function canonicalWsTurnClaimData({ requestId, inputDigest, opaqueClaimId }) {
  return Object.freeze({
    schemaVersion: WS_TURN_SCHEMA_VERSION,
    requestId: normalizeWsTurnRequestId(requestId),
    inputDigest: normalizeWsTurnInputDigest(inputDigest),
    opaqueClaimId: normalizeWsTurnClaimId(opaqueClaimId),
  });
}

function canonicalWsTurnCompletedData({
  requestId,
  inputDigest = null,
  opaqueClaimId = null,
  user,
  assistant,
}) {
  const normalizedUser = normalizeWsTurnContent(user, "user");
  const hasClaimAuthority = inputDigest != null || opaqueClaimId != null;
  const data = {
    schemaVersion: WS_TURN_SCHEMA_VERSION,
    requestId: normalizeWsTurnRequestId(requestId),
    outcome: "completed",
    user: Object.freeze({
      role: "user",
      content: normalizedUser,
    }),
    assistant: Object.freeze({
      role: "assistant",
      content: normalizeWsTurnContent(assistant, "assistant"),
    }),
  };
  if (hasClaimAuthority) {
    data.inputDigest = normalizeWsTurnInputDigest(inputDigest);
    data.opaqueClaimId = normalizeWsTurnClaimId(opaqueClaimId);
    if (data.inputDigest !== computeWsTurnInputDigest(normalizedUser)) {
      throw wsTurnError(
        "WebSocket turn settlement input does not match its durable claim",
        "CC_WS_TURN_INPUT_DIGEST_MISMATCH",
      );
    }
  }
  return Object.freeze(data);
}

function canonicalWsTurnFailedData({
  requestId,
  inputDigest,
  opaqueClaimId,
  failureCode,
}) {
  return Object.freeze({
    schemaVersion: WS_TURN_SCHEMA_VERSION,
    requestId: normalizeWsTurnRequestId(requestId),
    inputDigest: normalizeWsTurnInputDigest(inputDigest),
    opaqueClaimId: normalizeWsTurnClaimId(opaqueClaimId),
    outcome: "failed",
    failure: Object.freeze({ code: normalizeWsTurnFailureCode(failureCode) }),
  });
}

export function projectWsTurnClaim(event) {
  if (event?.type !== WS_TURN_CLAIM_EVENT) return null;
  try {
    if (
      !hasExactKeys(event.data, [
        "schemaVersion",
        "requestId",
        "inputDigest",
        "opaqueClaimId",
      ])
    ) {
      return null;
    }
    const data = canonicalWsTurnClaimData(event.data || {});
    if (event.data?.schemaVersion !== WS_TURN_SCHEMA_VERSION) return null;
    return Object.freeze({
      ...data,
      eventHash: typeof event.hash === "string" ? event.hash : null,
    });
  } catch {
    return null;
  }
}

export function projectWsTurnSettlement(event) {
  if (event?.type !== WS_TURN_EVENT) return null;
  try {
    if (event.data?.outcome === "failed") {
      if (
        !hasExactKeys(event.data, [
          "schemaVersion",
          "requestId",
          "inputDigest",
          "opaqueClaimId",
          "outcome",
          "failure",
        ]) ||
        !hasExactKeys(event.data?.failure, ["code"])
      ) {
        return null;
      }
      const data = canonicalWsTurnFailedData({
        requestId: event.data?.requestId,
        inputDigest: event.data?.inputDigest,
        opaqueClaimId: event.data?.opaqueClaimId,
        failureCode: event.data?.failure?.code,
      });
      if (event.data?.schemaVersion !== WS_TURN_SCHEMA_VERSION) return null;
      return Object.freeze({
        ...data,
        eventHash: typeof event.hash === "string" ? event.hash : null,
      });
    }
    const claimedSettlement =
      event.data?.inputDigest != null || event.data?.opaqueClaimId != null;
    if (
      !hasExactKeys(
        event.data,
        claimedSettlement
          ? [
              "schemaVersion",
              "requestId",
              "inputDigest",
              "opaqueClaimId",
              "outcome",
              "user",
              "assistant",
            ]
          : ["schemaVersion", "requestId", "outcome", "user", "assistant"],
      ) ||
      !hasExactKeys(event.data?.user, ["role", "content"]) ||
      !hasExactKeys(event.data?.assistant, ["role", "content"])
    ) {
      return null;
    }
    const data = canonicalWsTurnCompletedData({
      requestId: event.data?.requestId,
      inputDigest: event.data?.inputDigest,
      opaqueClaimId: event.data?.opaqueClaimId,
      user: event.data?.user?.content,
      assistant: event.data?.assistant?.content,
    });
    if (
      event.data?.schemaVersion !== WS_TURN_SCHEMA_VERSION ||
      event.data?.outcome !== "completed" ||
      event.data?.user?.role !== "user" ||
      event.data?.assistant?.role !== "assistant"
    ) {
      return null;
    }
    return Object.freeze({
      ...data,
      eventHash: typeof event.hash === "string" ? event.hash : null,
    });
  } catch {
    return null;
  }
}

export function projectWsTurnMessages(event) {
  const settlement = projectWsTurnSettlement(event);
  return settlement?.outcome === "completed" ? settlement : null;
}

function wsTurnAuthorityError(message, code = "CC_WS_TURN_AUTHORITY_INVALID") {
  return wsTurnError(message, code);
}

export function createWsTurnLifecycleReducer({
  requestId,
  inputDigest = null,
} = {}) {
  const canonicalRequestId = normalizeWsTurnRequestId(requestId);
  const expectedInputDigest =
    inputDigest == null ? null : normalizeWsTurnInputDigest(inputDigest);
  let claim = null;
  let settlement = null;

  return {
    accept(event) {
      if (
        event?.type !== WS_TURN_CLAIM_EVENT &&
        event?.type !== WS_TURN_EVENT
      ) {
        return;
      }
      if (event?.data?.requestId !== canonicalRequestId) return;

      if (event.type === WS_TURN_CLAIM_EVENT) {
        const projected = projectWsTurnClaim(event);
        if (!projected?.eventHash) {
          throw wsTurnAuthorityError(
            "WebSocket request claim is malformed or unchained",
          );
        }
        if (claim || settlement) {
          throw wsTurnAuthorityError(
            "WebSocket request has duplicate or out-of-order claim authority",
            "CC_WS_TURN_CLAIM_DUPLICATE",
          );
        }
        claim = projected;
        return;
      }

      const projected = projectWsTurnSettlement(event);
      if (!projected?.eventHash) {
        throw wsTurnAuthorityError(
          "WebSocket request settlement is malformed or unchained",
        );
      }
      if (settlement) {
        throw wsTurnAuthorityError(
          "WebSocket request has multiple durable settlements",
          "CC_WS_TURN_IDEMPOTENCY_DUPLICATE",
        );
      }
      const claimedSettlement = projected.opaqueClaimId != null;
      if (claimedSettlement) {
        if (
          !claim ||
          claim.opaqueClaimId !== projected.opaqueClaimId ||
          claim.inputDigest !== projected.inputDigest
        ) {
          throw wsTurnAuthorityError(
            "WebSocket request settlement does not match its preceding claim",
            "CC_WS_TURN_CLAIM_MISMATCH",
          );
        }
      } else if (claim) {
        throw wsTurnAuthorityError(
          "Claimed WebSocket request used a legacy unfenced settlement",
          "CC_WS_TURN_CLAIM_MISMATCH",
        );
      }
      settlement = projected;
    },
    finish(authority = {}) {
      const durableInputDigest =
        claim?.inputDigest ||
        settlement?.inputDigest ||
        (settlement?.outcome === "completed"
          ? computeWsTurnInputDigest(settlement.user.content)
          : null);
      if (
        expectedInputDigest &&
        durableInputDigest &&
        expectedInputDigest !== durableInputDigest
      ) {
        throw wsTurnAuthorityError(
          "WebSocket request id was already claimed with different input",
          "CC_WS_REQUEST_ID_CONFLICT",
        );
      }
      const status = settlement?.outcome || (claim ? "pending" : "none");
      return Object.freeze({
        requestId: canonicalRequestId,
        inputDigest: durableInputDigest || expectedInputDigest,
        status,
        claim,
        settlement,
        turn: settlement?.outcome === "completed" ? settlement : null,
        headHash:
          typeof authority.headHash === "string" ? authority.headHash : null,
        eventCount: Number.isSafeInteger(authority.eventCount)
          ? authority.eventCount
          : 0,
      });
    },
  };
}

function runSessionScaleFaultHook(name, payload) {
  if (process.env.CC_SESSION_SCALE_FAULT_INJECTION !== "1") return;
  const hook = _sessionScaleFaultHooks[name];
  if (typeof hook === "function") hook(payload);
}

function getSessionsDir() {
  const dir = join(getHomeDir(), "sessions");
  let current = null;
  try {
    current = lstatSync(dir);
  } catch {
    // The owner-only helper below creates a missing directory and surfaces any
    // other unsafe filesystem state with its canonical error.
  }
  const currentIdentity = current ? `${current.dev}:${current.ino}` : null;
  const unsafePosixMode =
    process.platform !== "win32" &&
    current !== null &&
    (current.mode & 0o777) !== 0o700;
  if (
    securedSessionsDir !== dir ||
    currentIdentity === null ||
    currentIdentity !== securedSessionsDirIdentity ||
    unsafePosixMode
  ) {
    ensurePrivateDirectory(dir);
    securedSessionsDir = dir;
    const secured = lstatSync(dir);
    securedSessionsDirIdentity = `${secured.dev}:${secured.ino}`;
  }
  return dir;
}

/**
 * A session id must be a single safe path segment. Ids are generated as
 * `session-<ts>-<hex>`, but also arrive from CLI args (`cc agent --resume <id>`,
 * `cc insights <id>`, `cc session show <id>`), so an id like `../../etc/x` would
 * otherwise let sessionPath() read / append / delete a .jsonl OUTSIDE the
 * sessions dir. Reject any separator or `..` (mirrors goal-store's
 * isUnsafeGoalId / FileUploadService.isUnsafeSegment).
 */
export function isUnsafeSessionId(id) {
  return (
    id == null ||
    id === "" ||
    typeof id !== "string" ||
    id.includes("/") ||
    id.includes("\\") ||
    id.includes("..")
  );
}

export function sessionPath(sessionId) {
  // Fail closed for path building: every write/delete goes through here, so a
  // traversal id can never escape the sessions dir. Reads guard separately and
  // degrade to not-found instead of throwing.
  if (isUnsafeSessionId(sessionId)) {
    throw new Error(`unsafe session id: ${String(sessionId).slice(0, 60)}`);
  }
  return join(getSessionsDir(), `${sessionId}.jsonl`);
}

export function appendTokenUsage(sessionId, usage) {
  appendEvent(sessionId, "token_usage", usage || {});
}

function inspectPhysicalTail(filePath, { dryRun = false } = {}) {
  const result = {
    action: "none",
    changed: false,
    discardedBytes: 0,
    discardedRecords: 0,
    fileSize: 0,
  };
  if (!existsSync(filePath)) return result;
  const fd = openSync(filePath, "r+");
  let normalizeNewline = false;
  try {
    const size = fstatSync(fd).size;
    result.fileSize = size;
    if (size > 0) {
      const lastByte = Buffer.allocUnsafe(1);
      readSync(fd, lastByte, 0, 1, size - 1);
      if (lastByte[0] !== 0x0a) {
        // Locate the beginning of the physical tail using bounded reverse IO.
        let cursor = size;
        let tailStart = 0;
        let found = false;
        const chunkSize = 64 * 1024;
        while (cursor > 0 && !found) {
          const length = Math.min(chunkSize, cursor);
          cursor -= length;
          const chunk = Buffer.allocUnsafe(length);
          readSync(fd, chunk, 0, length, cursor);
          const newline = chunk.lastIndexOf(0x0a);
          if (newline >= 0) {
            tailStart = cursor + newline + 1;
            found = true;
          }
        }
        const tail = Buffer.allocUnsafe(size - tailStart);
        if (tail.length > 0) readSync(fd, tail, 0, tail.length, tailStart);
        try {
          const text = new TextDecoder("utf-8", { fatal: true }).decode(tail);
          JSON.parse(text);
          // A valid legacy/manual last record merely lacks its newline; retain
          // it and normalize before appending the next chained event.
          result.action = "normalize-newline";
          result.changed = true;
          normalizeNewline = !dryRun;
        } catch {
          // Crash tail: discard only the one incomplete physical record.
          result.action = "discard-partial-record";
          result.changed = true;
          result.discardedBytes = size - tailStart;
          result.discardedRecords = 1;
          if (!dryRun) ftruncateSync(fd, tailStart);
        }
      }
    }
  } finally {
    closeSync(fd);
  }
  if (normalizeNewline) {
    appendFileSync(filePath, "\n", { encoding: "utf8", mode: 0o600 });
  }
  if (!dryRun && result.changed) ensurePrivateFile(filePath);
  return result;
}

/**
 * Repair at most one crash-truncated physical tail and resolve the chain hash.
 * This is called only while the transcript's cross-process lock is held, so a
 * second writer can never reuse a stale in-process hash.
 */
function _resolveChainTail(filePath) {
  if (!existsSync(filePath)) return { prevHash: null, recovery: null };
  // Fast path: almost every append follows a newline-terminated record. Read
  // that tail once and avoid opening the file a second time just to inspect its
  // last byte. The slow repair path runs only for an unterminated crash tail.
  const initial = iterateFileLinesReverseSync(filePath);
  const first = initial.next();
  if (!first.done && first.value.terminated) {
    try {
      let current = first;
      while (!current.done) {
        try {
          const event = JSON.parse(current.value.line);
          return {
            prevHash: typeof event?.hash === "string" ? event.hash : null,
            recovery: null,
          };
        } catch {
          current = initial.next();
        }
      }
      return { prevHash: null, recovery: null };
    } finally {
      initial.return?.();
    }
  }
  initial.return?.();

  const recovery = inspectPhysicalTail(filePath);
  for (const { line } of iterateFileLinesReverseSync(filePath)) {
    try {
      const event = JSON.parse(line);
      return {
        prevHash: typeof event?.hash === "string" ? event.hash : null,
        recovery: recovery.changed ? recovery : null,
      };
    } catch {
      // A malformed historical line is verified separately; keep searching so
      // this append never chains from arbitrary bytes.
    }
  }
  return { prevHash: null, recovery: recovery.changed ? recovery : null };
}

function readVerifiedWsAuthorityLocked(
  sessionId,
  filePath,
  requestId,
  inputDigest,
) {
  const reducer = createWsTurnLifecycleReducer({ requestId, inputDigest });
  const verification = verifyTranscriptFile(filePath, {
    onVerifiedEvent: (event) => reducer.accept(event),
  });
  assertVerifiedTranscriptAnchor(sessionId, verification);
  const authority = Object.freeze({
    headHash: verification.lastHash,
    eventCount: verification.chainedEvents,
  });
  return Object.freeze({
    authority,
    state: reducer.finish(authority),
    messages: Object.freeze([...rebuildVerifiedMessagesFromFile(filePath)]),
  });
}

function appendVerifiedWsAuthorityEventLocked(
  sessionId,
  filePath,
  type,
  data,
  previousHeadHash,
  { verifySettlement = true } = {},
) {
  const core = { type, timestamp: Date.now(), data };
  const hash = computeEventHash(previousHeadHash, core);
  const event = { ...core, prevHash: previousHeadHash, hash };
  appendTranscriptEvent(sessionId, type, event, filePath);
  try {
    recordSessionEvent(getSessionsDir(), sessionId, event, hash);
  } catch (cause) {
    const error = new Error(
      `Session authority anchor could not be persisted: ${sessionId}`,
      { cause },
    );
    error.code = "SESSION_INDEX_ANCHOR_FAILED";
    error.sessionId = sessionId;
    error.commitState = "unknown";
    throw error;
  }
  if (verifySettlement) {
    const verification = verifyTranscriptFile(filePath);
    try {
      assertVerifiedTranscriptAnchor(sessionId, verification);
    } catch (cause) {
      const error = new Error(
        `Session authority settlement could not be verified: ${sessionId}`,
        { cause },
      );
      error.code = "SESSION_INDEX_ANCHOR_FAILED";
      error.sessionId = sessionId;
      error.commitState = "unknown";
      throw error;
    }
    if (verification.lastHash !== hash || event.prevHash !== previousHeadHash) {
      const error = new Error(
        `Session authority settlement head is not durable: ${sessionId}`,
      );
      error.code = "SESSION_INDEX_ANCHOR_FAILED";
      error.sessionId = sessionId;
      error.commitState = "unknown";
      throw error;
    }
  }
  return Object.freeze({ hash, event });
}

function withVerifiedWsTurnLock(sessionId, task) {
  const filePath = sessionPath(sessionId);
  return withFileLock(filePath, () => task(filePath), {
    failIfUnavailable: true,
    timeoutMs: 30_000,
    retryMs: 1,
    maxRetryMs: 8,
    retryJitterMs: 4,
    yieldAfterReleaseMs: 2,
  });
}

function encodeEventMessageProvenance(type, data) {
  if (
    (type === "compact" || type === "checkpoint_timeline_commit") &&
    data &&
    typeof data === "object" &&
    !Array.isArray(data) &&
    Array.isArray(data.messages)
  ) {
    return {
      ...data,
      messages: data.messages.map(encodePersistedMessage),
    };
  }
  if (type === "system") return encodePersistedMessage(data);
  return data;
}

function appendTranscriptEvent(sessionId, type, event, filePath) {
  const payload = { sessionId, type, event, filePath };
  try {
    runSessionScaleFaultHook("beforeTranscriptAppend", payload);
  } catch (cause) {
    throw createSessionPersistenceFailure(cause, {
      sessionId,
      operation: "transcript-append",
      commitState: "not-committed",
    });
  }
  try {
    appendFileSync(filePath, `${JSON.stringify(event)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
  } catch (cause) {
    throw createSessionPersistenceFailure(cause, {
      sessionId,
      operation: "transcript-append",
      // ENOSPC can follow a short write. EROFS fails before the append can
      // mutate the target.
      commitState: cause?.code === "EROFS" ? "not-committed" : "unknown",
    });
  }
  try {
    ensurePrivateFile(filePath);
    runSessionScaleFaultHook("afterTranscriptAppend", payload);
  } catch (cause) {
    throw createSessionPersistenceFailure(cause, {
      sessionId,
      operation: "transcript-settlement",
      commitState: "unknown",
    });
  }
}

const SESSION_AUTHORITY_RECOVERY_TEXT_LIMITS = Object.freeze({
  safetyId: 512,
  safetyIdentity: 512,
  safetyPlanIdentity: 1024,
  safetyCoverage: 64,
  restorePhase: 64,
  branchSessionId: 512,
});
const SESSION_AUTHORITY_RECOVERY_CREATED_PATH_LIMIT = 256;
const SESSION_AUTHORITY_RECOVERY_PATH_LENGTH_LIMIT = 4096;

function sanitizeSessionAuthorityRecoveryEvidence(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const evidence = {};
  for (const [field, limit] of Object.entries(
    SESSION_AUTHORITY_RECOVERY_TEXT_LIMITS,
  )) {
    if (typeof value[field] === "string" && value[field].length > 0) {
      evidence[field] = value[field].slice(0, limit);
    }
  }
  if (Array.isArray(value.createdPaths)) {
    evidence.createdPaths = Object.freeze(
      value.createdPaths
        .filter((item) => typeof item === "string")
        .slice(0, SESSION_AUTHORITY_RECOVERY_CREATED_PATH_LIMIT)
        .map((item) =>
          item.slice(0, SESSION_AUTHORITY_RECOVERY_PATH_LENGTH_LIMIT),
        ),
    );
  }
  return Object.keys(evidence).length > 0 ? Object.freeze(evidence) : null;
}

function appendEventLocked(
  sessionId,
  type,
  data,
  { expectedHeadHash, compareHead = false, requireIndexAnchor = false } = {},
) {
  const filePath = sessionPath(sessionId);
  return withFileLock(
    filePath,
    () => {
      const existingMeta = readSessionMeta(getSessionsDir(), sessionId);
      const persistedWitness = existingMeta;
      const transcriptExists = existsSync(filePath);
      const startsNewGeneration =
        !transcriptExists &&
        persistedWitness?.deleted === true &&
        type === "session_start";
      if (
        persistedWitness?.deleted === true &&
        (transcriptExists || type !== "session_start")
      ) {
        const error = new Error(`Session was deleted: ${sessionId}`);
        error.code = "SESSION_DELETED";
        throw error;
      }
      if (
        !transcriptExists &&
        persistedWitness !== null &&
        persistedWitness?.deleted !== true
      ) {
        throw unverifiedTranscriptError(
          sessionId,
          missingTranscriptVerification(),
        );
      }
      const { prevHash, recovery } = _resolveChainTail(filePath);
      if (
        transcriptExists &&
        existingMeta !== null &&
        existingMeta?.deleted !== true &&
        (existingMeta.last_hash ?? null) !== prevHash
      ) {
        throw unverifiedTranscriptError(
          sessionId,
          transcriptAnchorMismatchVerification(prevHash),
        );
      }
      if (transcriptExists && existingMeta === null) {
        const verification = verifyTranscriptFile(filePath);
        if (
          verification.status === TRANSCRIPT_CHAIN_STATUS.TAMPERED ||
          verification.malformedLines > 0 ||
          verification.truncatedTail
        ) {
          throw unverifiedTranscriptError(sessionId, verification);
        }
        // A sidecar is rebuildable, but appending before rebuilding it would
        // publish a count of one for a multi-event transcript. Restore the
        // projection under the same writer lock before advancing the chain.
        rebuildSessionMetaUnlocked(getSessionsDir(), sessionId, filePath);
      }
      if (compareHead && prevHash !== (expectedHeadHash || null)) {
        const error = new Error(
          `Session revision changed for ${sessionId}; refresh the checkpoint timeline`,
        );
        error.code = "SESSION_REVISION_STALE";
        error.expectedHeadHash = expectedHeadHash || null;
        error.actualHeadHash = prevHash;
        throw error;
      }
      const persistedData = encodeEventMessageProvenance(type, data);
      const core = { type, timestamp: Date.now(), data: persistedData };
      const hash = computeEventHash(prevHash, core);
      const event = { ...core, prevHash, hash };
      appendTranscriptEvent(sessionId, type, event, filePath);
      try {
        recordSessionEvent(getSessionsDir(), sessionId, event, hash, {
          resetGeneration: startsNewGeneration,
        });
      } catch (cause) {
        if (requireIndexAnchor) {
          const error = new Error(
            `Session authority anchor could not be persisted: ${sessionId}`,
            { cause },
          );
          error.code = "SESSION_INDEX_ANCHOR_FAILED";
          error.sessionId = sessionId;
          error.commitState = "unknown";
          throw error;
        }
        // The metadata index is explicitly rebuildable. Never turn a committed
        // transcript event into an apparent failure that a caller may retry.
      }
      if (requireIndexAnchor) {
        const verification = verifyTranscriptFile(filePath);
        const anchoredMeta = readSessionMeta(getSessionsDir(), sessionId);
        const anchored =
          verification.status === TRANSCRIPT_CHAIN_STATUS.VERIFIED &&
          verification.malformedLines === 0 &&
          !verification.truncatedTail &&
          anchoredMeta?.deleted !== true &&
          anchoredMeta?.last_hash === hash &&
          Number(anchoredMeta?.event_count) === verification.chainedEvents;
        if (!anchored) {
          const error = new Error(
            `Session authority anchor does not match the transcript: ${sessionId}`,
          );
          error.code = "SESSION_INDEX_ANCHOR_FAILED";
          error.sessionId = sessionId;
          error.verification = verification;
          error.commitState = "unknown";
          throw error;
        }
      }
      return { hash, recovery, commitState: "committed" };
    },
    {
      failIfUnavailable: true,
      timeoutMs: 30_000,
      retryMs: 1,
      maxRetryMs: 8,
      retryJitterMs: 4,
      yieldAfterReleaseMs: 2,
    },
  );
}

function runClassifiedAppend(sessionId, operation, append) {
  try {
    return append();
  } catch (cause) {
    throw createSessionPersistenceFailure(cause, {
      sessionId,
      operation,
      // Preserve an inner append/settlement classification. Without one,
      // EROFS defaults to not-committed and ENOSPC remains unknown.
      commitState: cause?.commitState,
    });
  }
}

export function appendEvent(sessionId, type, data) {
  return runClassifiedAppend(sessionId, "append-event", () =>
    appendEventLocked(sessionId, type, data),
  );
}

/**
 * Append an authority-bearing event only when both the transcript and its
 * crash/tail-truncation anchor are durably updated and still agree.
 */
export function appendAuthorityEvent(sessionId, type, data) {
  return runClassifiedAppend(sessionId, "append-authority-event", () =>
    appendEventLocked(sessionId, type, data, {
      requireIndexAnchor: true,
    }),
  );
}

/**
 * Compare-and-append for revisioned IDE actions. The head check and append run
 * under the transcript's canonical writer lock, so a stale preview can never
 * commit after another session writer advances the chain.
 */
export function appendEventIfHead(
  sessionId,
  type,
  data,
  expectedHeadHash = null,
) {
  return runClassifiedAppend(sessionId, "compare-and-append-event", () =>
    appendEventLocked(sessionId, type, data, {
      expectedHeadHash,
      compareHead: true,
    }),
  );
}

/** Authority-bearing compare-and-append with a mandatory index anchor. */
export function appendAuthorityEventIfHead(
  sessionId,
  type,
  data,
  expectedHeadHash = null,
) {
  return runClassifiedAppend(
    sessionId,
    "compare-and-append-authority-event",
    () =>
      appendEventLocked(sessionId, type, data, {
        expectedHeadHash,
        compareHead: true,
        requireIndexAnchor: true,
      }),
  );
}

/**
 * Validate a caller-owned projection and append one authority event while the
 * same transcript writer lock remains held. This closes the read/validate to
 * append race for authorities (such as MCP host fencing) that are derived from
 * the complete verified transcript rather than from the head hash alone.
 *
 * Both callbacks must be synchronous. The projection remains caller-owned and
 * only its validation result controls whether the event is appended.
 */
export function appendAuthorityEventWithVerifiedProjection(
  sessionId,
  type,
  data,
  { createProjection, validateProjection } = {},
) {
  if (
    typeof createProjection !== "function" ||
    typeof validateProjection !== "function"
  ) {
    throw new TypeError(
      "Authority projection append requires projection and validation callbacks",
    );
  }
  if (
    createProjection.constructor?.name === "AsyncFunction" ||
    validateProjection.constructor?.name === "AsyncFunction"
  ) {
    throw new TypeError(
      "Authority projection append callbacks must be synchronous",
    );
  }
  const filePath = sessionPath(sessionId);
  return withFileLock(
    filePath,
    () => {
      const projection = createProjection();
      if (
        !projection ||
        typeof projection.accept !== "function" ||
        typeof projection.finish !== "function"
      ) {
        throw new TypeError(
          "Authority projection must provide accept() and finish()",
        );
      }
      if (!existsSync(filePath)) {
        throw unverifiedTranscriptError(sessionId, {
          status: "missing",
          reason: "authority transcript does not exist",
          lastHash: null,
          chainedEvents: 0,
        });
      }
      _resolveChainTail(filePath);
      const verification = verifyTranscriptFile(filePath, {
        onVerifiedEvent: (event) => {
          const accepted = projection.accept(event);
          if (accepted && typeof accepted.then === "function") {
            throw new TypeError(
              "Authority projection accept() must be synchronous",
            );
          }
        },
      });
      assertVerifiedTranscriptAnchor(sessionId, verification);
      const authority = Object.freeze({
        headHash: verification.lastHash,
        eventCount: verification.chainedEvents,
        readMessages: () => rebuildVerifiedMessagesFromFile(filePath),
      });
      const projected = projection.finish(authority);
      if (projected && typeof projected.then === "function") {
        throw new TypeError(
          "Authority projection finish() must be synchronous",
        );
      }
      const validation = validateProjection(projected, authority);
      if (validation && typeof validation.then === "function") {
        throw new TypeError(
          "Authority projection validation must be synchronous",
        );
      }
      if (validation === false) {
        throw new Error("Authority projection validation rejected the append");
      }
      const persistedData = encodeEventMessageProvenance(type, data);
      const appended = appendVerifiedWsAuthorityEventLocked(
        sessionId,
        filePath,
        type,
        persistedData,
        authority.headHash,
      );
      return Object.freeze({ hash: appended.hash });
    },
    {
      failIfUnavailable: true,
      timeoutMs: 30_000,
      retryMs: 1,
      maxRetryMs: 8,
      retryJitterMs: 4,
      yieldAfterReleaseMs: 2,
    },
  );
}

/**
 * Run a synchronous authority transaction while holding the canonical
 * transcript writer lock for its whole lifetime.
 *
 * A sequence of separate compare-and-appends leaves a gap between commits:
 * callers may mutate an external resource after the first event, then lose the
 * second CAS to another session writer. This primitive closes that gap. It
 * validates the transcript + sidecar anchor and the caller's expected head
 * before invoking `task`, then keeps every authority append on the same locked
 * chain. The callback must be synchronous; retaining the writer beyond the
 * lock lifetime would make the apparent transaction unsafe.
 *
 * External mutations may register bounded, recovery-only evidence through the
 * writer. It is attached only when final settlement is unverifiable; the
 * callback's arbitrary return value is never copied into an error.
 *
 * This is a transaction-scoped writer lease, not a general host/session lease
 * and not a filesystem power-loss transaction. Callers that coordinate an
 * external resource must still journal crash recovery for that resource.
 */
export function withSessionAuthorityTransaction(
  sessionId,
  expectedHeadHash,
  task,
) {
  if (typeof task !== "function") {
    throw new TypeError("Session authority transaction callback is required");
  }
  if (task.constructor?.name === "AsyncFunction") {
    throw new TypeError(
      "Session authority transaction callback must be synchronous",
    );
  }

  const filePath = sessionPath(sessionId);
  return withFileLock(
    filePath,
    () => {
      const existingMeta = readSessionMeta(getSessionsDir(), sessionId);
      const persistedWitness = existingMeta;
      if (persistedWitness?.deleted === true) {
        const error = new Error(`Session was deleted: ${sessionId}`);
        error.code = "SESSION_DELETED";
        throw error;
      }
      if (!existsSync(filePath) && persistedWitness !== null) {
        throw unverifiedTranscriptError(sessionId, {
          status: "missing",
          reason: "session sidecar exists without its transcript",
          lastHash: null,
          chainedEvents: 0,
        });
      }

      let currentHeadHash = null;
      if (existsSync(filePath)) {
        // Normalize or discard only an incomplete physical tail before the
        // verified sample. The existing sidecar already anchors the last
        // complete event, so a crash tail never becomes transaction authority.
        _resolveChainTail(filePath);
        const verification = verifyTranscriptFile(filePath);
        assertVerifiedTranscriptAnchor(sessionId, verification);
        currentHeadHash = verification.lastHash;
      }

      const expected = expectedHeadHash || null;
      if (currentHeadHash !== expected) {
        const error = new Error(
          `Session revision changed for ${sessionId}; refresh the checkpoint timeline`,
        );
        error.code = "SESSION_REVISION_STALE";
        error.expectedHeadHash = expected;
        error.actualHeadHash = currentHeadHash;
        throw error;
      }

      let appendAttempts = 0;
      let writerActive = true;
      let writerPoisoned = false;
      let transactionRecoveryEvidence = null;
      const writer = Object.freeze({
        initialHeadHash: currentHeadHash,
        currentHeadHash: () => currentHeadHash,
        retainRecoveryEvidence(evidence) {
          if (!writerActive) {
            const error = new Error(
              `Session authority transaction is already closed: ${sessionId}`,
            );
            error.code = "SESSION_AUTHORITY_TRANSACTION_CLOSED";
            throw error;
          }
          const sanitized = sanitizeSessionAuthorityRecoveryEvidence(evidence);
          if (sanitized) {
            transactionRecoveryEvidence = Object.freeze({
              ...(transactionRecoveryEvidence || {}),
              ...sanitized,
            });
          }
          return transactionRecoveryEvidence;
        },
        appendAuthorityEvent(type, data) {
          if (!writerActive) {
            const error = new Error(
              `Session authority transaction is already closed: ${sessionId}`,
            );
            error.code = "SESSION_AUTHORITY_TRANSACTION_CLOSED";
            throw error;
          }
          if (writerPoisoned) {
            const error = new Error(
              `Session authority transaction writer is poisoned: ${sessionId}`,
            );
            error.code = "SESSION_AUTHORITY_TRANSACTION_POISONED";
            error.commitState = "unknown";
            throw error;
          }
          const persistedData = encodeEventMessageProvenance(type, data);
          appendAttempts += 1;
          let appended;
          try {
            appended = appendVerifiedWsAuthorityEventLocked(
              sessionId,
              filePath,
              type,
              persistedData,
              currentHeadHash,
              { verifySettlement: false },
            );
          } catch (error) {
            // Bytes may already have reached the transcript before a
            // sidecar/activity failure. The actual head is then unknown, so a
            // second append from this writer would risk forking the chain.
            writerPoisoned = true;
            if (error && !error.commitState) error.commitState = "unknown";
            throw error;
          }
          currentHeadHash = appended.hash;
          return appended;
        },
      });

      let result;
      let bodyError = null;
      let bodyThrew = false;
      try {
        result = task(writer);
        if (result && typeof result.then === "function") {
          const error = new TypeError(
            "Session authority transaction callback must be synchronous",
          );
          error.code = "SESSION_AUTHORITY_TRANSACTION_ASYNC";
          error.commitState = "unknown";
          throw error;
        }
      } catch (error) {
        bodyThrew = true;
        bodyError = error;
      } finally {
        // A callback can retain this object or return a Promise/thenable. Revoke
        // it before settlement and before releasing the lock so no later
        // microtask can append outside the transaction critical section.
        writerActive = false;
      }

      if (appendAttempts > 0) {
        try {
          const verification = verifyTranscriptFile(filePath);
          assertVerifiedTranscriptAnchor(sessionId, verification);
          if (verification.lastHash !== currentHeadHash) {
            throw new Error(
              `Session authority settlement head is not durable: ${sessionId}`,
            );
          }
        } catch (cause) {
          const error = new Error(
            `Session authority transaction could not be verified: ${sessionId}`,
            { cause },
          );
          error.code = "SESSION_INDEX_ANCHOR_FAILED";
          error.sessionId = sessionId;
          error.commitState = "unknown";
          if (bodyThrew) error.transactionError = bodyError;
          if (transactionRecoveryEvidence) {
            // Never attach the arbitrary callback result. Callers must opt in
            // to this bounded recovery-only projection before settlement.
            error.transactionRecoveryEvidence = transactionRecoveryEvidence;
          }
          throw error;
        }
      }
      if (bodyThrew) throw bodyError;
      return result;
    },
    {
      failIfUnavailable: true,
      timeoutMs: 30_000,
      retryMs: 1,
      maxRetryMs: 8,
      retryJitterMs: 4,
      yieldAfterReleaseMs: 2,
    },
  );
}

function verifyTranscriptFile(filePath, options = {}) {
  const onVerifiedEvent =
    typeof options.onVerifiedEvent === "function"
      ? options.onVerifiedEvent
      : null;
  const ioMetrics = options.ioMetrics ?? null;
  const result = {
    status: TRANSCRIPT_CHAIN_STATUS.EMPTY,
    chainedEvents: 0,
    legacyEvents: 0,
    malformedLines: 0,
    truncatedTail: false,
    firstInvalidLine: null,
    reason: null,
    lastHash: null,
  };
  let lastHash = null;
  let sawChain = false;
  const tampered = (lineNo, reason) => ({
    ...result,
    status: TRANSCRIPT_CHAIN_STATUS.TAMPERED,
    firstInvalidLine: lineNo,
    reason,
  });

  for (const { line, lineNo, terminated } of iterateFileLinesSync(filePath, {
    ioMetrics,
  })) {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      result.malformedLines += 1;
      if (!terminated) {
        result.truncatedTail = true;
        continue;
      }
      if (sawChain) {
        return tampered(lineNo, "malformed line inside hash chain");
      }
      continue;
    }

    if (event && typeof event.hash === "string") {
      const expectedPrev = sawChain ? lastHash : null;
      if ((event.prevHash ?? null) !== expectedPrev) {
        return tampered(
          lineNo,
          sawChain
            ? "hash chain linkage broken (record deleted, inserted, or reordered)"
            : "chain does not start at a genesis record (head records removed)",
        );
      }
      if (computeEventHash(expectedPrev, event) !== event.hash) {
        return tampered(lineNo, "event content does not match its hash");
      }
      sawChain = true;
      lastHash = event.hash;
      result.lastHash = lastHash;
      result.chainedEvents += 1;
      onVerifiedEvent?.(event);
    } else {
      if (sawChain) {
        return tampered(
          lineNo,
          "unchained record after hash chain started (manual append or downgrade write)",
        );
      }
      result.legacyEvents += 1;
    }
  }

  if (result.chainedEvents > 0) {
    result.status =
      result.legacyEvents > 0
        ? TRANSCRIPT_CHAIN_STATUS.PARTIAL
        : TRANSCRIPT_CHAIN_STATUS.VERIFIED;
  } else if (result.legacyEvents > 0 || result.malformedLines > 0) {
    result.status = TRANSCRIPT_CHAIN_STATUS.LEGACY;
  }
  return result;
}

/**
 * Verify a session transcript's hash chain (tamper-evidence).
 * Statuses: verified | partial (legacy prefix + valid chain) | legacy
 * (pre-chaining transcript) | tampered | empty — plus not-found / invalid-id.
 */
export function verifySession(sessionId) {
  if (isUnsafeSessionId(sessionId)) {
    return { sessionId, status: "invalid-id", reason: "invalid session id" };
  }
  const filePath = sessionPath(sessionId);
  const presence = getSessionPresence(sessionId);
  if (presence === SESSION_PRESENCE.CONFLICT) {
    return {
      sessionId,
      status: "conflict",
      reason: "tombstoned session has a restored transcript path",
    };
  }
  if (!existsSync(filePath)) {
    if (presence === SESSION_PRESENCE.MISSING_TRANSCRIPT) {
      return { sessionId, ...missingTranscriptVerification() };
    }
    return { sessionId, status: "not-found", reason: "session file not found" };
  }
  return {
    sessionId,
    ...verifyTranscriptFile(filePath),
  };
}

export function verifyAllSessions(options = {}) {
  const dir = getSessionsDir();
  if (!existsSync(dir)) return [];
  const sessionIds = new Set(listSessionIds());
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".meta.json")) continue;
    const sessionId = file.slice(0, -".meta.json".length);
    if (
      !isUnsafeSessionId(sessionId) &&
      getSessionPresence(sessionId) === SESSION_PRESENCE.MISSING_TRANSCRIPT
    ) {
      sessionIds.add(sessionId);
    }
  }
  return [...sessionIds]
    .slice(0, options.limit || 1000)
    .map((sessionId) => verifySession(sessionId));
}

function indexedProjectionMatchesTranscript(meta, verification, validation) {
  return (
    verification.status === TRANSCRIPT_CHAIN_STATUS.VERIFIED &&
    validation.valid === true &&
    meta?.deleted !== true &&
    Number(meta?.event_count) === validation.eventCount &&
    (meta?.last_hash ?? null) === (verification.lastHash ?? null)
  );
}

/**
 * Diagnose and repair the final physical transcript record plus its rebuildable
 * metadata projection. Interior corruption and hash-chain tampering are never
 * rewritten: repair may append a missing newline, discard one crash-partial
 * record, or rebuild a stale sidecar/activity index from a healthy transcript.
 */
export function repairSession(sessionId, options = {}) {
  const dryRun = options.dryRun === true;
  if (isUnsafeSessionId(sessionId)) {
    return {
      sessionId,
      dryRun,
      changed: false,
      healthy: false,
      status: "invalid-id",
      reason: "invalid session id",
    };
  }
  const filePath = sessionPath(sessionId);
  if (!existsSync(filePath)) {
    return {
      sessionId,
      dryRun,
      changed: false,
      healthy: false,
      status: "not-found",
      reason: "session file not found",
    };
  }

  const result = withFileLock(
    filePath,
    () => {
      const dir = getSessionsDir();
      if (getSessionPresence(sessionId) === SESSION_PRESENCE.CONFLICT) {
        return {
          sessionId,
          dryRun,
          changed: false,
          physicalChanged: false,
          indexChanged: false,
          wouldChange: false,
          action: "none",
          physicalAction: "none",
          indexAction: "none",
          indexRepairRequired: false,
          indexRebuilt: false,
          indexRepairError: null,
          discardedBytes: 0,
          discardedRecords: 0,
          healthy: false,
          transcriptHealthy: false,
          status: "conflict",
          before: null,
          after: null,
          beforeValidation: null,
          afterValidation: null,
          reason: "tombstoned session has a restored transcript path",
        };
      }
      const before = verifyTranscriptFile(filePath);
      const beforeValidation = validateJsonlSession(sessionId);
      const repair = inspectPhysicalTail(filePath, { dryRun });
      const after = dryRun ? null : verifyTranscriptFile(filePath);
      const afterValidation = dryRun ? null : validateJsonlSession(sessionId);
      const effective = after || before;
      const effectiveValidation = afterValidation || beforeValidation;
      const transcriptHealthy =
        effective.status !== TRANSCRIPT_CHAIN_STATUS.TAMPERED &&
        !(dryRun
          ? before.truncatedTail || repair.changed
          : after.truncatedTail) &&
        effectiveValidation.valid;
      const currentMeta = readSessionMeta(dir, sessionId);
      const currentActivity = readLatestSessionActivity(dir, sessionId);
      const indexRepairRequired =
        transcriptHealthy &&
        (!indexedProjectionMatchesTranscript(
          currentMeta,
          effective,
          effectiveValidation,
        ) ||
          !indexedProjectionMatchesTranscript(
            currentActivity,
            effective,
            effectiveValidation,
          ));
      let indexRebuilt = false;
      let indexRepairError = null;
      if (!dryRun && indexRepairRequired) {
        try {
          rebuildSessionMetaUnlocked(dir, sessionId, filePath);
          indexRebuilt = true;
        } catch (cause) {
          indexRepairError = {
            code: cause?.code || null,
            message: String(cause?.message || cause),
          };
        }
      }
      const healthy = dryRun
        ? transcriptHealthy && !repair.changed && !indexRepairRequired
        : transcriptHealthy && (!indexRepairRequired || indexRebuilt);
      return {
        sessionId,
        dryRun,
        changed: repair.changed || indexRebuilt,
        physicalChanged: repair.changed,
        indexChanged: indexRebuilt,
        wouldChange: dryRun && (repair.changed || indexRepairRequired),
        action:
          repair.action === "none" && indexRepairRequired
            ? "rebuild-index"
            : repair.action,
        physicalAction: repair.action,
        indexAction: indexRepairRequired ? "rebuild-index" : "none",
        indexRepairRequired,
        indexRebuilt,
        indexRepairError,
        discardedBytes: repair.discardedBytes,
        discardedRecords: repair.discardedRecords,
        healthy,
        transcriptHealthy,
        status: effective.status,
        before,
        after,
        beforeValidation,
        afterValidation,
        reason:
          effective.status === TRANSCRIPT_CHAIN_STATUS.TAMPERED
            ? effective.reason || "transcript remains tampered"
            : !effectiveValidation.valid
              ? effectiveValidation.reason ||
                "transcript remains structurally invalid"
              : indexRepairError
                ? `session metadata index rebuild failed: ${indexRepairError.message}`
                : indexRepairRequired && dryRun
                  ? "session metadata index requires rebuild"
                  : null,
      };
    },
    { failIfUnavailable: true },
  );

  return result;
}

/** All locally-stored session ids (the source of truth a mirror derives from). */
export function listSessionIds() {
  const dir = getSessionsDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => file.endsWith(".jsonl"))
    .map((file) => basename(file, ".jsonl"));
}

/** Resolve an exact id or one unambiguous prefix without reading transcripts. */
export function resolveSessionId(input) {
  if (isUnsafeSessionId(input)) return null;
  if (sessionExists(input)) return input;
  const matches = listSessionIds().filter(
    (id) => id.startsWith(input) && sessionExists(id),
  );
  if (matches.length > 1) {
    const error = new Error(`Ambiguous session id prefix: ${input}`);
    error.code = "AMBIGUOUS_SESSION_ID";
    error.matches = matches.slice(0, 20);
    throw error;
  }
  return matches[0] || null;
}

export { TRANSCRIPT_CHAIN_STATUS };

export function startSession(sessionId, meta = {}) {
  const id =
    sessionId ||
    `session-${Date.now()}-${createHash("sha256").update(Math.random().toString()).digest("hex").slice(0, 6)}`;

  appendEvent(id, "session_start", {
    title: meta.title || "Untitled",
    provider: meta.provider || "",
    model: meta.model || "",
  });

  return id;
}

export function appendUserMessage(sessionId, content) {
  return appendEvent(sessionId, "user_message", {
    role: "user",
    content,
  });
}

export function appendAssistantMessage(sessionId, content) {
  return appendEvent(sessionId, "assistant_message", {
    role: "assistant",
    content,
  });
}

function wsTurnLifecycleResult(snapshot, overrides = {}) {
  return Object.freeze({
    ...snapshot.state,
    messages: snapshot.messages,
    ...overrides,
  });
}

/**
 * Claim one canonical WebSocket request before any model/tool execution.
 * Full chain verification, metadata-anchor validation, expected-head CAS and
 * claim append all execute under the cross-process transcript writer lock.
 */
export function claimWsTurnIfHead(
  sessionId,
  { requestId, user, inputDigest, opaqueClaimId },
  expectedHeadHash = null,
) {
  const normalizedUser = normalizeWsTurnContent(user, "user");
  const computedDigest = computeWsTurnInputDigest(normalizedUser);
  const canonicalDigest = normalizeWsTurnInputDigest(
    inputDigest || computedDigest,
  );
  if (canonicalDigest !== computedDigest) {
    throw wsTurnAuthorityError(
      "WebSocket request input does not match its proposed claim digest",
      "CC_WS_TURN_INPUT_DIGEST_MISMATCH",
    );
  }
  const data = canonicalWsTurnClaimData({
    requestId,
    inputDigest: canonicalDigest,
    opaqueClaimId,
  });

  return withVerifiedWsTurnLock(sessionId, (filePath) => {
    const snapshot = readVerifiedWsAuthorityLocked(
      sessionId,
      filePath,
      data.requestId,
      data.inputDigest,
    );
    if (snapshot.state.status !== "none") {
      return wsTurnLifecycleResult(snapshot, {
        acquired: false,
        deduplicated: true,
      });
    }
    if (snapshot.authority.headHash !== (expectedHeadHash || null)) {
      const error = new Error(
        `Session revision changed for ${sessionId}; refresh the canonical turn authority`,
      );
      error.code = "SESSION_REVISION_STALE";
      error.expectedHeadHash = expectedHeadHash || null;
      error.actualHeadHash = snapshot.authority.headHash;
      throw error;
    }
    const appended = appendVerifiedWsAuthorityEventLocked(
      sessionId,
      filePath,
      WS_TURN_CLAIM_EVENT,
      data,
      snapshot.authority.headHash,
    );
    const claim = projectWsTurnClaim(appended.event);
    return Object.freeze({
      ...snapshot.state,
      status: "pending",
      claim,
      headHash: appended.hash,
      eventCount: snapshot.authority.eventCount + 1,
      messages: snapshot.messages,
      acquired: true,
      deduplicated: false,
    });
  });
}

/** Settle only the exact durable claim that fenced model/tool execution. */
export function settleWsTurnClaim(
  sessionId,
  {
    requestId,
    inputDigest,
    opaqueClaimId,
    outcome,
    user,
    assistant,
    failureCode = "CC_WS_TURN_FAILED",
  },
) {
  const identity = canonicalWsTurnClaimData({
    requestId,
    inputDigest,
    opaqueClaimId,
  });
  const data =
    outcome === "completed"
      ? canonicalWsTurnCompletedData({
          ...identity,
          user,
          assistant,
        })
      : outcome === "failed"
        ? canonicalWsTurnFailedData({
            ...identity,
            failureCode,
          })
        : (() => {
            throw wsTurnAuthorityError(
              "WebSocket turn settlement outcome is invalid",
              "CC_WS_TURN_OUTCOME_INVALID",
            );
          })();

  return withVerifiedWsTurnLock(sessionId, (filePath) => {
    const snapshot = readVerifiedWsAuthorityLocked(
      sessionId,
      filePath,
      identity.requestId,
      identity.inputDigest,
    );
    if (snapshot.state.settlement) {
      if (snapshot.state.settlement.opaqueClaimId !== identity.opaqueClaimId) {
        throw wsTurnAuthorityError(
          "WebSocket request is settled by a different durable claim",
          "CC_WS_TURN_CLAIM_NOT_OWNER",
        );
      }
      return wsTurnLifecycleResult(snapshot, {
        acquired: false,
        deduplicated: true,
      });
    }
    if (
      snapshot.state.status !== "pending" ||
      snapshot.state.claim?.opaqueClaimId !== identity.opaqueClaimId
    ) {
      throw wsTurnAuthorityError(
        "WebSocket request has no matching pending claim to settle",
        "CC_WS_TURN_CLAIM_NOT_OWNER",
      );
    }
    const appended = appendVerifiedWsAuthorityEventLocked(
      sessionId,
      filePath,
      WS_TURN_EVENT,
      data,
      snapshot.authority.headHash,
    );
    const settlement = projectWsTurnSettlement(appended.event);
    return Object.freeze({
      ...snapshot.state,
      status: settlement.outcome,
      settlement,
      turn: settlement.outcome === "completed" ? settlement : null,
      headHash: appended.hash,
      eventCount: snapshot.authority.eventCount + 1,
      messages:
        settlement.outcome === "completed"
          ? Object.freeze([
              ...snapshot.messages,
              settlement.user,
              settlement.assistant,
            ])
          : snapshot.messages,
      acquired: false,
      deduplicated: false,
    });
  });
}

/**
 * Compatibility-only atomic settlement for callers that already hold a full
 * response. Canonical WS handlers must use claimWsTurnIfHead() first.
 */
export function appendWsTurnIfHead(
  sessionId,
  { requestId, user, assistant },
  expectedHeadHash = null,
) {
  const data = canonicalWsTurnCompletedData({ requestId, user, assistant });
  const inputDigest = computeWsTurnInputDigest(data.user.content);
  return withVerifiedWsTurnLock(sessionId, (filePath) => {
    const snapshot = readVerifiedWsAuthorityLocked(
      sessionId,
      filePath,
      data.requestId,
      inputDigest,
    );
    if (snapshot.state.status === "completed") {
      return Object.freeze({
        ...snapshot.state.turn,
        hash: snapshot.state.turn.eventHash,
        deduplicated: true,
      });
    }
    if (snapshot.state.status !== "none") {
      throw wsTurnAuthorityError(
        "WebSocket request already has claimed lifecycle authority",
        "CC_WS_TURN_CLAIM_REQUIRED",
      );
    }
    if (snapshot.authority.headHash !== (expectedHeadHash || null)) {
      const error = new Error(
        `Session revision changed for ${sessionId}; refresh the checkpoint timeline`,
      );
      error.code = "SESSION_REVISION_STALE";
      error.expectedHeadHash = expectedHeadHash || null;
      error.actualHeadHash = snapshot.authority.headHash;
      throw error;
    }
    const appended = appendVerifiedWsAuthorityEventLocked(
      sessionId,
      filePath,
      WS_TURN_EVENT,
      data,
      snapshot.authority.headHash,
    );
    return Object.freeze({
      ...projectWsTurnMessages(appended.event),
      hash: appended.hash,
      deduplicated: false,
    });
  });
}

export function appendToolCall(sessionId, toolName, args) {
  appendEvent(sessionId, "tool_call", { tool: toolName, args });
}

/**
 * Compact tool-call record for usage attribution (用量归因): tool name +
 * error flag (+ optional skill, plugin/version, and bounded observed duration)
 * — deliberately NOT the args, which can carry whole file bodies (write_file
 * content) and would bloat the transcript. Written at tool-result time by the
 * agent drivers so `cc session usage --by tool|mcp|plugin` and `cc insights`
 * can aggregate tool use for any persisted session.
 */
export function appendToolCallCompact(
  sessionId,
  { tool, isError, skill, plugin, pluginVersion, durationMs } = {},
) {
  const duration = normalizeCompactDuration(durationMs);
  appendEvent(sessionId, "tool_call", {
    tool: tool || "?",
    is_error: Boolean(isError),
    ...(skill ? { skill: String(skill) } : {}),
    ...(plugin ? { plugin: String(plugin) } : {}),
    ...(pluginVersion ? { plugin_version: String(pluginVersion) } : {}),
    ...(duration !== null ? { duration_ms: duration } : {}),
  });
}

/** Hard cap for one observed failed LLM/tool attempt (seven days). */
export const MAX_COMPACT_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

function normalizeCompactDuration(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  return Math.min(MAX_COMPACT_DURATION_MS, Math.round(number));
}

/**
 * Persist one automatic LLM stream retry without raw errors, prompts, URLs, or
 * credentials. Provider/model are bounded identity labels; reason is a closed
 * vocabulary produced by classifyStreamRetryReason().
 */
export function appendLlmRetryCompact(
  sessionId,
  { attempt, durationMs, provider, model, reason } = {},
) {
  const attemptNumber = Math.max(
    1,
    Math.min(15, Math.trunc(Number(attempt) || 1)),
  );
  const duration = normalizeCompactDuration(durationMs);
  const cleanLabel = (value, max) => {
    if (typeof value !== "string") return null;
    const clean = value.replace(/\p{Cc}/gu, "").trim();
    return clean ? clean.slice(0, max) : null;
  };
  const allowedReasons = new Set([
    "timeout",
    "dns",
    "connection_refused",
    "network_unreachable",
    "connection_reset",
    "unknown",
  ]);
  const cleanReason = allowedReasons.has(reason) ? reason : "unknown";
  const cleanProvider = cleanLabel(provider, 64);
  const cleanModel = cleanLabel(model, 128);
  appendEvent(sessionId, "llm_retry", {
    attempt: attemptNumber,
    duration_ms: duration ?? 0,
    reason: cleanReason,
    ...(cleanProvider ? { provider: cleanProvider } : {}),
    ...(cleanModel ? { model: cleanModel } : {}),
  });
}

export function appendToolResult(sessionId, toolName, result) {
  appendEvent(sessionId, "tool_result", { tool: toolName, result });
}

export function appendCompactEvent(sessionId, stats) {
  appendEvent(sessionId, "compact", stats);
}

function canonicalReplayFingerprint(messages) {
  return JSON.stringify(
    projectCanonicalResumeMessages(messages, { strict: true }).map(
      encodePersistedMessage,
    ),
  );
}

/**
 * Persist a compact checkpoint only while the verified active replay still
 * equals the caller's last known projection. Head-only CAS is insufficient for
 * a long-lived REPL: it could sample a newer head that already contains turns
 * absent from its local context and then accidentally hide those turns.
 */
export function appendCompactEventIfMessagesMatch(
  sessionId,
  stats,
  expectedMessages,
) {
  const expectedFingerprint = canonicalReplayFingerprint(expectedMessages);
  const persistedData = encodeEventMessageProvenance("compact", stats);
  return withVerifiedWsTurnLock(sessionId, (filePath) => {
    const verification = verifyTranscriptFile(filePath);
    assertVerifiedTranscriptAnchor(sessionId, verification);
    const actualMessages = rebuildVerifiedMessagesFromFile(filePath);
    if (canonicalReplayFingerprint(actualMessages) !== expectedFingerprint) {
      const error = new Error(
        `Session messages changed for ${sessionId}; refresh before compacting`,
      );
      error.code = "SESSION_REVISION_STALE";
      error.actualHeadHash = verification.lastHash;
      throw error;
    }
    return appendVerifiedWsAuthorityEventLocked(
      sessionId,
      filePath,
      "compact",
      persistedData,
      verification.lastHash,
    );
  });
}

export function readEvents(sessionId) {
  if (isUnsafeSessionId(sessionId)) return []; // traversal id → treat as empty
  const presence = getSessionPresence(sessionId);
  if (presence === SESSION_PRESENCE.MISSING_TRANSCRIPT) {
    throw unverifiedTranscriptError(sessionId, missingTranscriptVerification());
  }
  if (presence === SESSION_PRESENCE.CONFLICT) {
    throw unverifiedTranscriptError(
      sessionId,
      transcriptAnchorMismatchVerification(),
    );
  }
  const filePath = sessionPath(sessionId);
  if (!existsSync(filePath)) return [];

  const events = [];
  for (const { line } of iterateFileLinesSync(filePath)) {
    try {
      events.push(JSON.parse(line));
    } catch {
      // Skip malformed lines
    }
  }

  return events;
}

function unverifiedTranscriptError(sessionId, verification) {
  const error = new Error(
    `session transcript is not fully verified and anchored (${verification.status})`,
  );
  error.code = "SESSION_TRANSCRIPT_UNVERIFIED";
  error.sessionId = sessionId;
  error.verification = verification;
  return error;
}

function missingTranscriptVerification() {
  return Object.freeze({
    status: "missing",
    reason: "persisted session witness exists without its transcript",
    lastHash: null,
    chainedEvents: 0,
    malformedLines: 0,
    truncatedTail: false,
  });
}

function transcriptAnchorMismatchVerification(lastHash = null) {
  return Object.freeze({
    status: "anchor-mismatch",
    reason: "persisted session witness does not match its transcript",
    lastHash,
    chainedEvents: 0,
    malformedLines: 0,
    truncatedTail: false,
  });
}

function readSessionPersistenceWitness(sessionId) {
  return readSessionMeta(getSessionsDir(), sessionId);
}

function hasLiveSessionWitness(sessionId) {
  const witness = readSessionPersistenceWitness(sessionId);
  return witness !== null && witness?.deleted !== true;
}

function assertVerifiedTranscriptAnchor(sessionId, verification) {
  const meta = readSessionMeta(getSessionsDir(), sessionId);
  const trustedStatus =
    verification.status === TRANSCRIPT_CHAIN_STATUS.VERIFIED;
  const anchoredHead =
    meta?.deleted !== true &&
    meta?.last_hash === verification.lastHash &&
    Number(meta?.event_count) === verification.chainedEvents;
  if (
    !trustedStatus ||
    !anchoredHead ||
    verification.malformedLines > 0 ||
    verification.truncatedTail
  ) {
    throw unverifiedTranscriptError(sessionId, verification);
  }
}

/**
 * Fold a fully verified transcript into a caller-owned projection.
 *
 * The projection factory and its `accept(event)` / `finish(authority)` methods
 * execute while the canonical writer lock is held. Hash-chain verification,
 * event reduction, and the independently persisted head/count check share one
 * forward transcript pass. `finish()` may call `authority.readMessages()` to
 * recover only the active context with bounded reverse IO (latest compact
 * checkpoint plus its suffix).
 *
 * This removes the mandatory all-event array from resume projections. It does
 * not make verification IO sublinear: authenticating a plain chained JSONL
 * transcript remains O(N), and the local sidecar is not an anti-rollback
 * anchor or a cross-process lease.
 */
export function readVerifiedProjection(
  sessionId,
  createProjection,
  options = {},
) {
  if (typeof createProjection !== "function") {
    throw new TypeError("Verified transcript projection factory is required");
  }
  if (isUnsafeSessionId(sessionId)) {
    const error = new Error(
      `unsafe session id: ${String(sessionId).slice(0, 60)}`,
    );
    error.code = "SESSION_TRANSCRIPT_UNVERIFIED";
    error.sessionId = sessionId;
    throw error;
  }
  const filePath = sessionPath(sessionId);

  return withFileLock(
    filePath,
    () => {
      const projection = createProjection();
      if (
        !projection ||
        typeof projection.accept !== "function" ||
        typeof projection.finish !== "function"
      ) {
        throw new TypeError(
          "Verified transcript projection must provide accept() and finish()",
        );
      }
      if (!existsSync(filePath)) {
        const witness = readSessionPersistenceWitness(sessionId);
        if (witness?.deleted === true) {
          const error = new Error(`Session was deleted: ${sessionId}`);
          error.code = "SESSION_DELETED";
          throw error;
        }
        if (witness !== null) {
          throw unverifiedTranscriptError(
            sessionId,
            missingTranscriptVerification(),
          );
        }
        return projection.finish(
          Object.freeze({
            headHash: null,
            eventCount: 0,
            readMessages: () => [],
          }),
        );
      }
      const verification = verifyTranscriptFile(filePath, {
        ioMetrics: options.ioMetrics,
        onVerifiedEvent: (event) => projection.accept(event),
      });
      assertVerifiedTranscriptAnchor(sessionId, verification);
      return projection.finish(
        Object.freeze({
          headHash: verification.lastHash,
          eventCount: verification.chainedEvents,
          readMessages: () =>
            rebuildVerifiedMessagesFromFile(filePath, {
              ioMetrics: options.messageIoMetrics,
            }),
        }),
      );
    },
    {
      failIfUnavailable: true,
      timeoutMs: 30_000,
      retryMs: 1,
      maxRetryMs: 8,
      retryJitterMs: 4,
      yieldAfterReleaseMs: 2,
    },
  );
}

/**
 * Compatibility reader for consumers that still require the complete event
 * array. New resume projections should use `readVerifiedProjection()` so their
 * heap is bounded by active context plus reducer authority state.
 */
export function readVerifiedEvents(sessionId) {
  return readVerifiedProjection(sessionId, () => {
    const events = [];
    return {
      accept(event) {
        events.push(event);
      },
      finish() {
        return events;
      },
    };
  });
}

/**
 * Read the active context only after transcript and sidecar-anchor validation.
 * Unlike the compatibility `rebuildMessages()` reader, this is allowed to
 * restore hash-covered durable system-message provenance.
 */
export function readVerifiedMessages(sessionId, options = {}) {
  return readVerifiedProjection(
    sessionId,
    () => ({
      accept() {},
      finish(authority) {
        return Object.freeze([...authority.readMessages()]);
      },
    }),
    options,
  );
}

/**
 * Read the verified head, active messages, and (when present) one durable
 * WebSocket request settlement from the same locked transcript sample.
 * Tracking only the requested id keeps idempotency lookup heap-bounded.
 */
export function readVerifiedWsTurnState(sessionId, requestId, options = {}) {
  const canonicalRequestId = normalizeWsTurnRequestId(requestId);
  const inputDigest =
    options.inputDigest == null
      ? null
      : normalizeWsTurnInputDigest(options.inputDigest);
  return readVerifiedProjection(
    sessionId,
    () => {
      const reducer = createWsTurnLifecycleReducer({
        requestId: canonicalRequestId,
        inputDigest,
      });
      return {
        accept(event) {
          reducer.accept(event);
        },
        finish(authority) {
          const state = reducer.finish(authority);
          return Object.freeze({
            sessionId,
            ...state,
            messages: Object.freeze([...authority.readMessages()]),
          });
        },
      };
    },
    options,
  );
}

/**
 * Return the newest event matching a type/predicate using bounded reverse IO.
 * This is the recovery path for snapshots and ledgers: callers never need to
 * materialize a multi-gigabyte transcript merely to inspect its latest state.
 */
export function findLatestEvent(sessionId, type, predicate = null) {
  if (isUnsafeSessionId(sessionId)) return null;
  const filePath = sessionPath(sessionId);
  if (!existsSync(filePath)) return null;
  const wanted = Array.isArray(type) ? new Set(type) : null;
  for (const { line } of iterateFileLinesReverseSync(filePath)) {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    const typeMatches = wanted
      ? wanted.has(event?.type)
      : type == null || event?.type === type;
    if (!typeMatches) continue;
    if (typeof predicate === "function" && !predicate(event)) continue;
    return event;
  }
  return null;
}

/**
 * A replayable chat message must be a `{ role, content }` object — guard
 * against a corrupt / partially-written / hand-edited event whose `data` is
 * missing, null, or not a message (it would otherwise inject `undefined` into
 * the resumed history and break the next LLM request).
 */
function isReplayableMessage(m) {
  return Boolean(m) && typeof m === "object" && typeof m.role === "string";
}

function rebuildMessagesFromFile(
  filePath,
  options = {},
  decodeMessage = sanitizePersistedMessage,
) {
  const ioMetrics = options?.ioMetrics ?? null;
  // Scan newest-first and stop at the latest valid compact checkpoint. Memory
  // is therefore proportional to the active context suffix, not transcript
  // size. Without a compact event the full conversation is necessarily the
  // replay state, but the file itself is still never loaded as one giant string.
  const suffix = [];
  let checkpoint = [];
  for (const { line } of iterateFileLinesReverseSync(filePath, { ioMetrics })) {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (
      (event?.type === "compact" ||
        event?.type === "checkpoint_timeline_commit") &&
      Array.isArray(event.data?.messages)
    ) {
      checkpoint = event.data.messages
        .map(decodeMessage)
        .filter(isReplayableMessage);
      break;
    }
    if (
      event &&
      (event.type === "user_message" ||
        event.type === "assistant_message" ||
        event.type === "system") &&
      isReplayableMessage(event.data)
    ) {
      suffix.push(decodeMessage(event.data));
    } else if (event?.type === WS_TURN_EVENT) {
      const turn = projectWsTurnMessages(event);
      if (turn) {
        // The file is scanned newest-first. Push the pair in reverse so the
        // final suffix.reverse() restores user → assistant atomically.
        suffix.push(turn.assistant, turn.user);
      }
    }
  }
  suffix.reverse();
  return [...checkpoint, ...suffix];
}

function rebuildVerifiedMessagesFromFile(filePath, options = {}) {
  return rebuildMessagesFromFile(
    filePath,
    options,
    decodeVerifiedPersistedMessage,
  );
}

export function rebuildMessages(sessionId, options = {}) {
  if (isUnsafeSessionId(sessionId)) return [];
  const presence = getSessionPresence(sessionId);
  if (presence === SESSION_PRESENCE.MISSING_TRANSCRIPT) {
    throw unverifiedTranscriptError(sessionId, missingTranscriptVerification());
  }
  if (presence === SESSION_PRESENCE.CONFLICT) {
    throw unverifiedTranscriptError(
      sessionId,
      transcriptAnchorMismatchVerification(),
    );
  }
  const filePath = sessionPath(sessionId);
  if (!existsSync(filePath)) return [];
  return rebuildMessagesFromFile(filePath, options);
}

/** ISO string for a numeric ms timestamp, or "" when missing / non-finite /
 * invalid — `new Date(undefined).toISOString()` (and `new Date("garbage")`)
 * throw "Invalid time value", and one corrupt event must not crash a whole
 * `cc session list` / `cc session search`. Exported so command-layer readers of
 * the same (hand-editable) JSONL share the guard. */
export function toIsoSafe(ts) {
  if (ts == null) return ""; // null/undefined → "" (Number(null) is 0 = epoch)
  const n = Number(ts);
  if (!Number.isFinite(n)) return "";
  const d = new Date(n);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

function rebuildSessionMetaUnlocked(dir, sessionId, filePath) {
  let meta = emptySessionMeta(sessionId);
  for (const { line } of iterateFileLinesSync(filePath)) {
    try {
      const event = JSON.parse(line);
      meta = applyEventToSessionMeta(meta, event, event?.hash);
    } catch {
      // The validator/repair path reports malformed records. The index remains
      // a best-effort projection over all intact events.
    }
  }
  return replaceSessionMeta(dir, meta);
}

function rebuildSessionMeta(sessionId) {
  const dir = getSessionsDir();
  const filePath = sessionPath(sessionId);
  if (!existsSync(filePath)) return null;
  return withFileLock(
    filePath,
    () => rebuildSessionMetaUnlocked(dir, sessionId, filePath),
    {
      failIfUnavailable: true,
      timeoutMs: 30_000,
      retryMs: 1,
      maxRetryMs: 8,
      retryJitterMs: 4,
    },
  );
}

/** Read canonical session metadata without loading the transcript body. */
export function getJsonlSessionMetadata(sessionId) {
  if (isUnsafeSessionId(sessionId) || !sessionExists(sessionId)) return null;
  const dir = getSessionsDir();
  const meta = readSessionMeta(dir, sessionId) || rebuildSessionMeta(sessionId);
  return meta ? publicSessionMeta(meta) : null;
}

export function listJsonlSessions(options = {}) {
  const dir = getSessionsDir();
  if (!existsSync(dir)) return [];

  const limit = options.limit || 20;
  const sessionIds = listSessionIds();
  let indexScan = null;
  let indexed = listIndexedSessions(dir, {
    limit,
    hasSession: (id) => sessionExists(id),
    onScanComplete: (scan) => {
      indexScan = scan;
    },
  });

  // First use after upgrade (or a lost/corrupt rebuildable index): stream each
  // legacy transcript once to seed its small sidecar and activity record.
  const expected = Math.min(Math.max(0, Number(limit) || 0), sessionIds.length);
  if (indexed.length < expected) {
    const rebuilt = [];
    for (const id of sessionIds) {
      // A physical path restored behind a tombstone is a conflict, not a live
      // list entry. Never re-emit its deleted snapshot as list activity.
      if (!sessionExists(id)) continue;
      const meta = readSessionMeta(dir, id) || rebuildSessionMeta(id);
      if (!meta) continue;
      const indexedMeta = indexScan?.latestBySessionId?.get(id) || null;
      if (
        indexedMeta?.deleted !== true &&
        indexedMeta?.last_hash === meta.last_hash &&
        Number(indexedMeta?.updated_at_ms || 0) ===
          Number(meta.updated_at_ms || 0) &&
        Number(indexedMeta?.event_count || 0) === Number(meta.event_count || 0)
      ) {
        continue;
      }
      rebuilt.push(meta);
    }
    // Directory enumeration order is not activity order. Re-append the rebuilt
    // snapshots oldest-first so reverse journal reads preserve the transcript
    // timestamps even on the first post-upgrade listing.
    for (const meta of rebuilt
      .filter(Boolean)
      .sort((a, b) => (a.updated_at_ms || 0) - (b.updated_at_ms || 0))) {
      recordSessionActivity(dir, meta);
    }
    indexed = listIndexedSessions(dir, {
      limit,
      hasSession: (id) => sessionExists(id),
    });
  }
  return indexed;
}

/**
 * Rename a session (gap-analysis 2026-07-11 P1 "命名会话"): appends a
 * `session_rename` event so the hash chain stays intact (no rewrite). The
 * LAST rename wins when listing/showing.
 */
export function renameSession(sessionId, title) {
  if (!sessionExists(sessionId)) {
    throw new Error(`Session not found: ${sessionId}`);
  }
  const normalized = String(title || "").trim();
  if (!normalized) throw new Error("A non-empty title is required");
  appendEvent(sessionId, "session_rename", { title: normalized.slice(0, 200) });
  return { id: sessionId, title: normalized.slice(0, 200) };
}

/** Delete the canonical transcript under its writer lock and publish durable
 * tombstone witnesses so an already-waiting stale writer cannot resurrect the
 * session after the deletion commits. */
export function deleteJsonlSession(sessionId) {
  if (isUnsafeSessionId(sessionId)) return false;
  const filePath = sessionPath(sessionId);
  if (!existsSync(filePath) && !hasLiveSessionWitness(sessionId)) return false;
  return withFileLock(
    filePath,
    () => {
      const transcriptExists = existsSync(filePath);
      const existingMeta = readSessionPersistenceWitness(sessionId);
      if (
        !transcriptExists &&
        (existingMeta === null || existingMeta?.deleted === true)
      ) {
        return false;
      }
      if (transcriptExists) rmSync(filePath, { force: true });
      try {
        recordSessionDeleted(getSessionsDir(), sessionId);
      } catch (error) {
        // writeMetaAtomic precedes the activity-journal append. If only the
        // rebuildable journal lock/release failed, the durable sidecar still
        // prevents a stale writer from resurrecting this deleted session.
        if (readSessionMeta(getSessionsDir(), sessionId)?.deleted !== true) {
          throw error;
        }
      }
      return true;
    },
    {
      failIfUnavailable: true,
      timeoutMs: 30_000,
      retryMs: 1,
      maxRetryMs: 8,
      retryJitterMs: 4,
      yieldAfterReleaseMs: 2,
    },
  );
}

/**
 * Prune old sessions (gap-analysis 2026-07-11 P1 "保留期限"): delete session
 * transcripts whose LAST activity is older than `olderThanDays`, always
 * keeping the newest `keep` (default 10) regardless of age. Dry-run returns
 * the same shape without deleting.
 */
export function pruneJsonlSessions(options = {}) {
  const olderThanDays = Number(options.olderThanDays);
  if (!Number.isFinite(olderThanDays) || olderThanDays < 0) {
    throw new Error(
      "prune requires --older-than <days> (a non-negative number)",
    );
  }
  const keep = Number.isFinite(Number(options.keep))
    ? Math.max(0, Math.floor(Number(options.keep)))
    : 10;
  const now = typeof options.now === "number" ? options.now : Date.now();
  const cutoff = now - olderThanDays * 24 * 60 * 60 * 1000;
  // listJsonlSessions sorts by last activity DESC — the first `keep` entries
  // survive unconditionally.
  const all = listJsonlSessions({ limit: 100000 });
  const candidates = all.slice(keep).filter((s) => {
    const last = Date.parse(s.updated_at || s.created_at || "");
    return Number.isFinite(last) && last < cutoff;
  });
  const deleted = [];
  for (const s of candidates) {
    if (options.dryRun === true) {
      deleted.push(s.id);
      continue;
    }
    try {
      if (deleteJsonlSession(s.id)) deleted.push(s.id);
    } catch {
      /* per-file failures never abort the sweep */
    }
  }
  return {
    scanned: all.length,
    kept: all.length - deleted.length,
    deleted,
    dryRun: options.dryRun === true,
  };
}

function compareFilePrefix(candidatePath, fullPath) {
  const candidateFd = openSync(candidatePath, "r");
  const fullFd = openSync(fullPath, "r");
  try {
    const candidateSize = fstatSync(candidateFd).size;
    const fullSize = fstatSync(fullFd).size;
    if (candidateSize > fullSize) {
      return { matches: false, candidateSize, fullSize };
    }
    const candidateBuffer = Buffer.allocUnsafe(64 * 1024);
    const fullBuffer = Buffer.allocUnsafe(64 * 1024);
    let offset = 0;
    while (offset < candidateSize) {
      const length = Math.min(candidateBuffer.length, candidateSize - offset);
      const candidateRead = readSync(
        candidateFd,
        candidateBuffer,
        0,
        length,
        offset,
      );
      const fullRead = readSync(fullFd, fullBuffer, 0, length, offset);
      if (
        candidateRead !== length ||
        fullRead !== length ||
        !candidateBuffer
          .subarray(0, length)
          .equals(fullBuffer.subarray(0, length))
      ) {
        return { matches: false, candidateSize, fullSize };
      }
      offset += length;
    }
    return { matches: true, candidateSize, fullSize };
  } finally {
    closeSync(candidateFd);
    closeSync(fullFd);
  }
}

const SESSION_FORK_AUTHORITY_SCHEMA =
  "chainlesschain.session-fork-authority/v1";

function normalizeForkRequestId(options) {
  const requestId = options?.requestId ?? "default";
  if (
    typeof requestId !== "string" ||
    requestId.length === 0 ||
    Buffer.byteLength(requestId, "utf8") > 256
  ) {
    throw new TypeError(
      "fork requestId must be a non-empty string <= 256 bytes",
    );
  }
  return requestId;
}

/**
 * Copy one verified source revision into an idempotent successor. The target is
 * bound to (sourceId, requestId), while its lineage record commits the source
 * revision selected by the first completed attempt. Callers that intentionally
 * need separate forks must pass separate requestId values.
 */
export function forkSession(sourceId, options = {}) {
  if (isUnsafeSessionId(sourceId)) return null;
  const requestId = normalizeForkRequestId(options);
  const sourcePath = sessionPath(sourceId);
  if (!existsSync(sourcePath)) return null;

  return withFileLock(
    sourcePath,
    () => {
      if (!existsSync(sourcePath)) return null;
      const sourceVerification = verifyTranscriptFile(sourcePath);
      assertVerifiedTranscriptAnchor(sourceId, sourceVerification);
      const forkIdentity = JSON.stringify({
        schemaVersion: 1,
        sourceSessionId: sourceId,
        requestId,
      });
      const forkDigest = createHash("sha256")
        .update(forkIdentity, "utf8")
        .digest("hex");
      const requestDigest = `sha256:${forkDigest}`;
      const newId = `session-fork-${forkDigest.slice(0, 32)}`;
      const filePath = sessionPath(newId);
      const sessionsDir = getSessionsDir();
      const pendingPath = join(sessionsDir, `${newId}.fork.pending`);
      const persistedData = encodeEventMessageProvenance(
        "system",
        markDurableSystemMessage(
          {
            role: "system",
            content: `[Forked from session ${sourceId}]`,
          },
          DURABLE_SYSTEM_MESSAGE_KINDS.FORK_LINEAGE,
        ),
      );

      return withFileLock(
        filePath,
        () => {
          let targetMeta = readSessionMeta(sessionsDir, newId);
          const finalExists = existsSync(filePath);
          const pendingExists = existsSync(pendingPath);
          if (finalExists && pendingExists) {
            throw unverifiedTranscriptError(
              newId,
              verifyTranscriptFile(filePath),
            );
          }
          if (!finalExists && targetMeta !== null) {
            throw unverifiedTranscriptError(newId, {
              status: "not-found",
              chainedEvents: 0,
              malformedLines: 0,
              truncatedTail: false,
              lastHash: null,
            });
          }
          let workingPath = finalExists ? filePath : pendingPath;
          if (!finalExists && !pendingExists) {
            if (targetMeta !== null) {
              throw unverifiedTranscriptError(newId, {
                status: "not-found",
                chainedEvents: 0,
                malformedLines: 0,
                truncatedTail: false,
                lastHash: null,
              });
            }
            copyFileSync(sourcePath, workingPath, fsConstants.COPYFILE_EXCL);
            ensurePrivateFile(workingPath);
            runSessionScaleFaultHook("afterForkCopy", {
              sourceId,
              sessionId: newId,
              filePath: workingPath,
            });
          } else {
            const prefix = compareFilePrefix(workingPath, sourcePath);
            if (prefix.matches && prefix.candidateSize < prefix.fullSize) {
              if (targetMeta !== null) {
                throw unverifiedTranscriptError(
                  newId,
                  verifyTranscriptFile(workingPath),
                );
              }
              // copyFileSync can leave an exact byte prefix after a hard exit.
              // The deterministic target lock and prefix proof make replacing
              // only that unpublished target safe and crash-resumable.
              rmSync(workingPath, { force: true });
              copyFileSync(sourcePath, workingPath, fsConstants.COPYFILE_EXCL);
              ensurePrivateFile(workingPath);
              runSessionScaleFaultHook("afterForkCopy", {
                sourceId,
                sessionId: newId,
                filePath: workingPath,
              });
            }
          }

          const inspectTarget = () => {
            let sourceBoundaryHash = null;
            let lineageEvent = null;
            let lineageEventIndex = null;
            let lineageAuthority = null;
            let matchingLineageEvents = 0;
            let eventIndex = 0;
            const verification = verifyTranscriptFile(workingPath, {
              onVerifiedEvent(event) {
                eventIndex += 1;
                if (eventIndex === sourceVerification.chainedEvents) {
                  sourceBoundaryHash = event.hash;
                }
                const authority = event?.data?.[SESSION_FORK_AUTHORITY_FIELD];
                if (
                  event?.type === "system" &&
                  authority?.schema === SESSION_FORK_AUTHORITY_SCHEMA &&
                  authority?.requestDigest === requestDigest &&
                  authority?.sourceSessionId === sourceId
                ) {
                  matchingLineageEvents += 1;
                  lineageEvent = event;
                  lineageEventIndex = eventIndex;
                  lineageAuthority = authority;
                }
              },
            });
            return {
              verification,
              sourceBoundaryHash,
              lineageEvent,
              lineageEventIndex,
              lineageAuthority,
              matchingLineageEvents,
            };
          };

          let target = inspectTarget();
          if (
            target.sourceBoundaryHash === sourceVerification.lastHash &&
            target.verification.chainedEvents ===
              sourceVerification.chainedEvents &&
            target.verification.truncatedTail &&
            targetMeta === null
          ) {
            // A hard exit can cut the one lineage append. Discard only that
            // unanchored physical tail, then prove the copied source again.
            inspectPhysicalTail(workingPath);
            target = inspectTarget();
          }

          const cleanTarget =
            target.verification.status === TRANSCRIPT_CHAIN_STATUS.VERIFIED &&
            target.verification.malformedLines === 0 &&
            !target.verification.truncatedTail;
          const exactSourceCopy =
            cleanTarget &&
            target.sourceBoundaryHash === sourceVerification.lastHash &&
            target.verification.chainedEvents ===
              sourceVerification.chainedEvents;

          if (exactSourceCopy) {
            if (targetMeta !== null) {
              throw unverifiedTranscriptError(newId, target.verification);
            }
            const { prevHash } = _resolveChainTail(workingPath);
            if (prevHash !== sourceVerification.lastHash) {
              const error = new Error(
                `Fork source changed while copying: ${sourceId}`,
              );
              error.code = "SESSION_REVISION_STALE";
              throw error;
            }
            const forkAuthority = {
              schema: SESSION_FORK_AUTHORITY_SCHEMA,
              requestDigest,
              sourceSessionId: sourceId,
              sourceHeadHash: sourceVerification.lastHash,
              sourceEventCount: sourceVerification.chainedEvents,
            };
            const core = {
              type: "system",
              timestamp: Date.now(),
              data: {
                ...persistedData,
                [SESSION_FORK_AUTHORITY_FIELD]: forkAuthority,
              },
            };
            const hash = computeEventHash(prevHash, core);
            appendFileSync(
              workingPath,
              `${JSON.stringify({ ...core, prevHash, hash })}\n`,
              { encoding: "utf8", mode: 0o600 },
            );
            ensurePrivateFile(workingPath);
            runSessionScaleFaultHook("afterForkLineage", {
              sourceId,
              sessionId: newId,
              filePath: workingPath,
              event: { ...core, prevHash, hash },
            });
            target = inspectTarget();
            targetMeta = readSessionMeta(sessionsDir, newId);
          }

          const authority = target.lineageAuthority;
          const authorityEventCount = Number(authority?.sourceEventCount);
          const creationEventCount = authorityEventCount + 1;
          const expectedAuthority = {
            schema: SESSION_FORK_AUTHORITY_SCHEMA,
            requestDigest,
            sourceSessionId: sourceId,
            sourceHeadHash: authority?.sourceHeadHash,
            sourceEventCount: authorityEventCount,
          };
          const lineageMatches =
            target.matchingLineageEvents === 1 &&
            target.lineageEvent?.type === "system" &&
            Number.isSafeInteger(authorityEventCount) &&
            authorityEventCount > 0 &&
            typeof authority?.sourceHeadHash === "string" &&
            target.lineageEventIndex === creationEventCount &&
            target.lineageEvent?.prevHash === authority.sourceHeadHash &&
            JSON.stringify(target.lineageEvent?.data) ===
              JSON.stringify({
                ...persistedData,
                [SESSION_FORK_AUTHORITY_FIELD]: expectedAuthority,
              });
          if (
            target.verification.status !== TRANSCRIPT_CHAIN_STATUS.VERIFIED ||
            target.verification.chainedEvents < creationEventCount ||
            !lineageMatches ||
            target.verification.malformedLines > 0 ||
            target.verification.truncatedTail
          ) {
            throw unverifiedTranscriptError(newId, target.verification);
          }

          const anchorMatchesTarget =
            targetMeta?.deleted !== true &&
            targetMeta?.last_hash === target.verification.lastHash &&
            Number(targetMeta?.event_count) ===
              target.verification.chainedEvents;
          if (anchorMatchesTarget) {
            const activity = readLatestSessionActivity(sessionsDir, newId);
            if (
              activity?.deleted === true ||
              activity?.last_hash !== targetMeta.last_hash ||
              Number(activity?.event_count) !== Number(targetMeta.event_count)
            ) {
              recordSessionActivity(sessionsDir, targetMeta);
            }
            return newId;
          }

          // A completed or progressed successor with a non-matching anchor is a
          // rollback/conflict, never a crash prefix that this request may bless.
          if (
            targetMeta !== null ||
            target.verification.chainedEvents > creationEventCount
          ) {
            throw unverifiedTranscriptError(newId, target.verification);
          }

          let sourceAuthorityHash = null;
          if (authorityEventCount === sourceVerification.chainedEvents) {
            sourceAuthorityHash = sourceVerification.lastHash;
          } else if (authorityEventCount < sourceVerification.chainedEvents) {
            let index = 0;
            const authorityVerification = verifyTranscriptFile(sourcePath, {
              onVerifiedEvent(event) {
                index += 1;
                if (index === authorityEventCount) {
                  sourceAuthorityHash = event.hash;
                }
              },
            });
            assertVerifiedTranscriptAnchor(sourceId, authorityVerification);
          }
          if (sourceAuthorityHash !== authority.sourceHeadHash) {
            const error = new Error(
              `Fork source revision no longer contains the claimed authority: ${sourceId}`,
            );
            error.code = "SESSION_REVISION_STALE";
            throw error;
          }

          if (workingPath === pendingPath) {
            if (existsSync(filePath)) {
              throw unverifiedTranscriptError(
                newId,
                verifyTranscriptFile(filePath),
              );
            }
            renameSync(pendingPath, filePath);
            workingPath = filePath;
            ensurePrivateFile(workingPath);
            runSessionScaleFaultHook("afterForkPublish", {
              sourceId,
              sessionId: newId,
              filePath: workingPath,
            });
          }

          rebuildSessionMetaUnlocked(sessionsDir, newId, filePath);
          runSessionScaleFaultHook("afterForkMeta", {
            sourceId,
            sessionId: newId,
            filePath,
          });
          assertVerifiedTranscriptAnchor(newId, target.verification);
          return newId;
        },
        {
          failIfUnavailable: true,
          timeoutMs: 30_000,
          retryMs: 1,
          maxRetryMs: 8,
          retryJitterMs: 4,
        },
      );
    },
    {
      failIfUnavailable: true,
      timeoutMs: 30_000,
      retryMs: 1,
      maxRetryMs: 8,
      retryJitterMs: 4,
      yieldAfterReleaseMs: 2,
    },
  );
}

/**
 * Create an independent BRANCH session ("从这里分支" — P0-3's fourth restore
 * action) that keeps a parent's conversation up to a chosen turn and diverges
 * from there. Unlike forkSession() (a whole-session copy with revision-scoped
 * request identity), this writes ONLY the caller-supplied pre-branch messages
 * id (see deriveBranchSessionId) and records parent lineage — so the origin
 * session is never touched (preservesParent) and a replayed branch request
 * resolves to the SAME file instead of a duplicate (idempotent).
 *
 * @param {object} params
 * @param {string} params.branchSessionId   deterministic branch id
 * @param {string|null} [params.parentSessionId]
 * @param {string|null} [params.parentTurnId]
 * @param {Array<{role:string,content:any}>} [params.messages]  pre-branch turns
 * @param {{title?:string,provider?:string,model?:string}} [params.meta]
 * @returns {{branchSessionId:string, created:boolean, messages:number}}
 */
export function createBranchSession({
  branchSessionId,
  parentSessionId = null,
  parentTurnId = null,
  messages = [],
  meta = {},
} = {}) {
  if (isUnsafeSessionId(branchSessionId)) {
    throw new Error(
      `unsafe branch session id: ${String(branchSessionId).slice(0, 60)}`,
    );
  }
  // Validate and clone the complete message projection before creating the
  // deterministic branch file. A validation failure must leave no partial
  // session that would make a later, valid retry look idempotently complete.
  const canonicalMessages = projectCanonicalResumeMessages(messages, {
    strict: true,
  });
  if (
    (parentSessionId !== null && typeof parentSessionId !== "string") ||
    (parentTurnId !== null && typeof parentTurnId !== "string")
  ) {
    throw new TypeError("Branch lineage ids must be strings or null");
  }
  const branchParentSessionId = parentSessionId;
  const branchParentTurnId = parentTurnId;
  const cleanMeta = sanitizePersistedMessage(meta);
  if (!cleanMeta || typeof cleanMeta !== "object") {
    throw new TypeError("Branch metadata must contain JSON-safe data");
  }
  const startData = {
    title:
      typeof cleanMeta.title === "string" && cleanMeta.title
        ? cleanMeta.title
        : `Branch of ${branchParentSessionId ?? "session"}`,
    provider: typeof cleanMeta.provider === "string" ? cleanMeta.provider : "",
    model: typeof cleanMeta.model === "string" ? cleanMeta.model : "",
  };
  const plannedEvents = [
    { type: "session_start", data: startData },
    {
      type: "session_branch",
      data: {
        parentSessionId: branchParentSessionId,
        parentTurnId: branchParentTurnId,
      },
    },
  ];
  let count = 0;
  for (const m of canonicalMessages) {
    if (m.role === "user") {
      plannedEvents.push({
        type: "user_message",
        data: { role: "user", content: m.content },
      });
      count += 1;
    } else if (m.role === "assistant") {
      plannedEvents.push({
        type: "assistant_message",
        data: { role: "assistant", content: m.content },
      });
      count += 1;
    } else if (m.role === "system") {
      plannedEvents.push({
        type: "system",
        data: encodePersistedMessage(m),
      });
      count += 1;
    }
    // Host prompts and tool scaffolding are re-established on resume. The
    // canonical projection above retains only explicitly durable systems.
  }
  const inputDigest = `sha256:${createHash("sha256")
    .update(JSON.stringify(plannedEvents), "utf8")
    .digest("hex")}`;
  plannedEvents.push({
    type: "session_branch_complete",
    data: {
      schemaVersion: 1,
      inputDigest,
      messageCount: count,
    },
  });

  const filePath = sessionPath(branchSessionId);
  const sessionsDir = getSessionsDir();
  return withFileLock(
    filePath,
    () => {
      if (existsSync(filePath)) inspectPhysicalTail(filePath);
      let verification = existsSync(filePath)
        ? verifyTranscriptFile(filePath)
        : {
            status: TRANSCRIPT_CHAIN_STATUS.EMPTY,
            chainedEvents: 0,
            malformedLines: 0,
            truncatedTail: false,
            lastHash: null,
          };
      if (
        verification.status !== TRANSCRIPT_CHAIN_STATUS.EMPTY &&
        verification.status !== TRANSCRIPT_CHAIN_STATUS.VERIFIED
      ) {
        throw unverifiedTranscriptError(branchSessionId, verification);
      }
      const existingEvents = existsSync(filePath)
        ? readEvents(branchSessionId)
        : [];
      const prefixMatches = existingEvents
        .slice(0, Math.min(existingEvents.length, plannedEvents.length))
        .every(
          (event, index) =>
            event.type === plannedEvents[index].type &&
            JSON.stringify(event.data) ===
              JSON.stringify(plannedEvents[index].data),
        );
      if (!prefixMatches) {
        const error = new Error(
          `Branch session conflicts with its deterministic input: ${branchSessionId}`,
        );
        error.code = "SESSION_BRANCH_CONFLICT";
        throw error;
      }

      // Once the exact completion marker is anchored, later branch turns are
      // outside the idempotent creation transaction. A replay resolves to that
      // progressed branch, but an unanchored suffix is never re-blessed.
      if (existingEvents.length > plannedEvents.length) {
        assertVerifiedTranscriptAnchor(branchSessionId, verification);
        return { branchSessionId, created: false, messages: 0 };
      }

      // A crashed writer can leave a hash-valid planned prefix ahead of its
      // sidecar. Only advance an existing anchor along that exact prefix. Never
      // lower or replace a higher/different anchor: doing so would legitimize a
      // truncated deterministic branch and permanently discard later turns.
      const anchoredMeta = readSessionMeta(sessionsDir, branchSessionId);
      const anchoredCount = Number(anchoredMeta?.event_count);
      const anchorMatchesCurrent =
        anchoredMeta?.deleted !== true &&
        anchoredMeta?.last_hash === verification.lastHash &&
        anchoredCount === verification.chainedEvents;
      const anchorIsStrictPriorPrefix =
        anchoredMeta?.deleted !== true &&
        Number.isSafeInteger(anchoredCount) &&
        anchoredCount >= 0 &&
        anchoredCount < verification.chainedEvents &&
        verification.chainedEvents === existingEvents.length &&
        (anchoredCount === 0
          ? anchoredMeta?.last_hash === null
          : existingEvents[anchoredCount - 1]?.hash ===
            anchoredMeta?.last_hash);
      if (
        anchoredMeta !== null &&
        !anchorMatchesCurrent &&
        !anchorIsStrictPriorPrefix
      ) {
        throw unverifiedTranscriptError(branchSessionId, verification);
      }
      if (existsSync(filePath) && !anchorMatchesCurrent) {
        rebuildSessionMetaUnlocked(sessionsDir, branchSessionId, filePath);
      }
      if (existingEvents.length > 0) {
        assertVerifiedTranscriptAnchor(branchSessionId, verification);
      }
      if (existingEvents.length === plannedEvents.length) {
        return { branchSessionId, created: false, messages: 0 };
      }

      let prevHash = verification.lastHash;
      for (
        let index = existingEvents.length;
        index < plannedEvents.length;
        index += 1
      ) {
        const planned = plannedEvents[index];
        const core = {
          type: planned.type,
          timestamp: Date.now(),
          data: planned.data,
        };
        const hash = computeEventHash(prevHash, core);
        const event = { ...core, prevHash, hash };
        appendTranscriptEvent(branchSessionId, planned.type, event, filePath);
        prevHash = hash;
      }

      verification = verifyTranscriptFile(filePath);
      if (
        verification.status !== TRANSCRIPT_CHAIN_STATUS.VERIFIED ||
        verification.chainedEvents !== plannedEvents.length ||
        verification.lastHash !== prevHash ||
        verification.malformedLines > 0 ||
        verification.truncatedTail
      ) {
        throw unverifiedTranscriptError(branchSessionId, verification);
      }
      rebuildSessionMetaUnlocked(sessionsDir, branchSessionId, filePath);
      assertVerifiedTranscriptAnchor(branchSessionId, verification);
      return { branchSessionId, created: true, messages: count };
    },
    {
      failIfUnavailable: true,
      timeoutMs: 30_000,
      retryMs: 1,
      maxRetryMs: 8,
      retryJitterMs: 4,
      yieldAfterReleaseMs: 2,
    },
  );
}

export const SESSION_PRESENCE = Object.freeze({
  ABSENT: "absent",
  PRESENT: "present",
  MISSING_TRANSCRIPT: "missing-transcript",
  TOMBSTONED: "tombstoned",
  CONFLICT: "conflict",
});

export function getSessionPresence(sessionId) {
  if (isUnsafeSessionId(sessionId)) return SESSION_PRESENCE.ABSENT;
  const transcriptExists = existsSync(sessionPath(sessionId));
  const witness = readSessionPersistenceWitness(sessionId);
  if (transcriptExists && witness?.deleted === true) {
    return SESSION_PRESENCE.CONFLICT;
  }
  if (transcriptExists) return SESSION_PRESENCE.PRESENT;
  if (witness?.deleted === true) return SESSION_PRESENCE.TOMBSTONED;
  if (witness !== null) return SESSION_PRESENCE.MISSING_TRANSCRIPT;
  return SESSION_PRESENCE.ABSENT;
}

/** True when a host must treat this id as canonical instead of falling back. */
export function sessionHasPersistedEvidence(sessionId) {
  return [
    SESSION_PRESENCE.PRESENT,
    SESSION_PRESENCE.MISSING_TRANSCRIPT,
    SESSION_PRESENCE.TOMBSTONED,
    SESSION_PRESENCE.CONFLICT,
  ].includes(getSessionPresence(sessionId));
}

/** True only for a physical, non-tombstoned transcript path. */
export function sessionExists(sessionId) {
  return getSessionPresence(sessionId) === SESSION_PRESENCE.PRESENT;
}

export function getLastSessionId() {
  // Seed/rebuild missing indexes for physical transcripts first, then include
  // a live missing-transcript witness so --continue fails closed on the newest
  // canonical identity instead of silently selecting an older healthy chat.
  const dir = getSessionsDir();
  listJsonlSessions({ limit: 1 });
  const sessions = listIndexedSessions(dir, {
    limit: 1,
    hasSession: (id) =>
      [
        SESSION_PRESENCE.PRESENT,
        SESSION_PRESENCE.MISSING_TRANSCRIPT,
        SESSION_PRESENCE.CONFLICT,
      ].includes(getSessionPresence(id)),
    includeDeleted: (id) =>
      getSessionPresence(id) === SESSION_PRESENCE.CONFLICT,
  });
  const candidateRisk = (presence) =>
    [SESSION_PRESENCE.MISSING_TRANSCRIPT, SESSION_PRESENCE.CONFLICT].includes(
      presence,
    )
      ? 1
      : 0;
  let latest =
    sessions.length > 0
      ? {
          id: sessions[0].id,
          updatedAt: Date.parse(sessions[0].updated_at) || 0,
          risk: candidateRisk(getSessionPresence(sessions[0].id)),
        }
      : null;

  // A stale/corrupt disposable activity journal cannot rediscover a sidecar-
  // only missing witness. Directory enumeration already occurs in the list
  // path; normally read only metadata files that have no transcript
  // counterpart. Durable tombstone namespace witnesses are enumerable, so
  // restored transcript conflicts are checked without opening every live
  // sidecar. This remains correct when the disposable activity journal is
  // absent, corrupt, or a parseable stale prefix.
  if (existsSync(dir)) {
    const files = readdirSync(dir);
    const transcriptIds = new Set(
      files
        .filter((file) => file.endsWith(".jsonl"))
        .map((file) => basename(file, ".jsonl")),
    );
    const tombstoneIds = new Set(
      files
        .filter((file) => file.endsWith(SESSION_TOMBSTONE_MARKER_SUFFIX))
        .map((file) => file.slice(0, -SESSION_TOMBSTONE_MARKER_SUFFIX.length)),
    );
    for (const file of files) {
      if (!file.endsWith(".meta.json")) continue;
      const id = file.slice(0, -".meta.json".length);
      const hasTranscript = transcriptIds.has(id);
      if (isUnsafeSessionId(id) || (hasTranscript && !tombstoneIds.has(id))) {
        continue;
      }
      const meta = readSessionMeta(dir, id);
      const presence = getSessionPresence(id);
      const isMissing = presence === SESSION_PRESENCE.MISSING_TRANSCRIPT;
      const isRecoveredConflict = presence === SESSION_PRESENCE.CONFLICT;
      if (!meta || (!isMissing && !isRecoveredConflict)) continue;
      const updatedAt = Math.max(0, Number(meta?.updated_at_ms) || 0);
      const risk = candidateRisk(presence);
      if (
        latest === null ||
        updatedAt > latest.updatedAt ||
        (updatedAt === latest.updatedAt && risk > latest.risk) ||
        (updatedAt === latest.updatedAt &&
          risk === latest.risk &&
          id > latest.id)
      ) {
        latest = { id, updatedAt, risk };
      }
    }
  }
  return latest?.id || null;
}

export function migrateLegacySessions(sourceDir, options = {}) {
  return migrateLegacySessionsBatch(sourceDir, options).results;
}

export function migrateLegacySessionsBatch(sourceDir, options = {}) {
  const directory = resolve(sourceDir || getSessionsDir());
  if (!existsSync(directory)) {
    throw new Error(`Directory not found: ${directory}`);
  }

  const files = readdirSync(directory).filter(
    (file) =>
      file.endsWith(".json") &&
      !file.endsWith(".jsonl") &&
      !file.endsWith(".migrated.json"),
  );

  const results = [];
  for (const file of files) {
    const filePath = join(directory, file);
    results.push(migrateLegacySessionFile(filePath, options));
  }

  const summary = buildMigrationSummary(results, {
    directory,
    dryRun: Boolean(options.dryRun),
  });
  const sampledValidation = options.dryRun
    ? []
    : sampleMigratedSessionsValidation(results, {
        sampleSize: options.sampleSize,
      });

  return {
    directory,
    results,
    summary,
    sampledValidation,
  };
}

export function migrateLegacySessionFile(filePath, options = {}) {
  const sourcePath = resolve(filePath);
  const maxAttempts = Math.max(
    1,
    (options.retryFailures ? 2 : 1) + Math.max(0, options.retryCount || 0),
  );
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = performLegacySessionMigration(sourcePath, options);
      return {
        ...result,
        attempts: attempt,
        retried: attempt > 1,
      };
    } catch (error) {
      lastError = error;
    }
  }

  return {
    file: sourcePath,
    sessionId: basename(sourcePath, ".json"),
    migrated: false,
    failed: true,
    dryRun: Boolean(options.dryRun),
    attempts: maxAttempts,
    reason: lastError?.message || "migration failed",
  };
}

export function validateJsonlSession(sessionId) {
  if (isUnsafeSessionId(sessionId)) {
    return {
      sessionId,
      valid: false,
      reason: "invalid session id",
      malformedLines: 0,
      eventCount: 0,
    };
  }
  const filePath = sessionPath(sessionId);
  if (!existsSync(filePath)) {
    return {
      sessionId,
      valid: false,
      reason: "session file not found",
      malformedLines: 0,
      eventCount: 0,
    };
  }

  let malformedLines = 0;
  let eventCount = 0;
  let messageCount = 0;
  let invalidWsTurns = 0;
  let invalidWsClaims = 0;
  let hasStartEvent = false;
  for (const { line } of iterateFileLinesSync(filePath)) {
    try {
      const event = JSON.parse(line);
      eventCount += 1;
      if (event?.type === "session_start") hasStartEvent = true;
      if (
        event?.type === "user_message" ||
        event?.type === "assistant_message"
      ) {
        messageCount += 1;
      } else if (event?.type === WS_TURN_EVENT) {
        const settlement = projectWsTurnSettlement(event);
        if (!settlement) invalidWsTurns += 1;
        else if (settlement.outcome === "completed") messageCount += 2;
      } else if (
        event?.type === WS_TURN_CLAIM_EVENT &&
        !projectWsTurnClaim(event)
      ) {
        invalidWsClaims += 1;
      }
    } catch {
      malformedLines++;
    }
  }

  return {
    sessionId,
    valid:
      malformedLines === 0 &&
      invalidWsTurns === 0 &&
      invalidWsClaims === 0 &&
      hasStartEvent,
    malformedLines,
    invalidWsTurns,
    invalidWsClaims,
    eventCount,
    messageCount,
    hasStartEvent,
  };
}

export function validateAllJsonlSessions(options = {}) {
  const files = readdirSync(getSessionsDir())
    .filter((file) => file.endsWith(".jsonl"))
    .slice(0, options.limit || 1000);
  return files.map((file) => validateJsonlSession(basename(file, ".jsonl")));
}

export function sampleMigratedSessionsValidation(results, options = {}) {
  const sampleSize = Math.max(0, parseInt(options.sampleSize || 3, 10));
  const migrated = results.filter((item) => item.migrated && !item.dryRun);
  return migrated.slice(0, sampleSize).map((item) => {
    const validation = validateJsonlSession(item.sessionId);
    return {
      sessionId: item.sessionId,
      file: item.file,
      valid: validation.valid,
      messageCount: validation.messageCount,
      expectedMessageCount: item.messageCount,
      matchesExpectedMessages: validation.messageCount === item.messageCount,
      malformedLines: validation.malformedLines,
    };
  });
}

function performLegacySessionMigration(sourcePath, options) {
  const parsed = JSON.parse(readFileSync(sourcePath, "utf-8"));
  const legacy = normalizeLegacySession(parsed, basename(sourcePath, ".json"));
  const sessionId = legacy.id;

  // A legacy file carries its OWN `id` (payload.id), so a crafted file could
  // name a traversal target like "../../evil". sessionPath() throws on write
  // (the backstop), but fail-fast HERE with a clear reason so the migration
  // doesn't burn retry attempts on a deterministic error.
  if (isUnsafeSessionId(sessionId)) {
    return {
      file: sourcePath,
      sessionId,
      migrated: false,
      failed: true,
      dryRun: Boolean(options.dryRun),
      reason: "unsafe session id in legacy file",
    };
  }

  const existingPresence = getSessionPresence(sessionId);
  if (!options.force && existingPresence !== SESSION_PRESENCE.ABSENT) {
    return {
      file: sourcePath,
      sessionId,
      skipped: true,
      reason: "jsonl session already exists",
    };
  }

  if (!options.dryRun) {
    if (
      options.force &&
      ![SESSION_PRESENCE.ABSENT, SESSION_PRESENCE.TOMBSTONED].includes(
        existingPresence,
      )
    ) {
      if (!deleteJsonlSession(sessionId)) {
        throw new Error(
          `could not tombstone existing JSONL session before forced migration: ${sessionId}`,
        );
      }
    }
    startSession(sessionId, legacy.meta);
    for (const message of legacy.messages) {
      appendLegacyMessage(sessionId, message);
    }
    if (legacy.summary) {
      appendEvent(
        sessionId,
        "system",
        markDurableSystemMessage(
          {
            role: "system",
            content: `[Migrated Summary]\n${legacy.summary}`,
          },
          DURABLE_SYSTEM_MESSAGE_KINDS.MIGRATION_SUMMARY,
        ),
      );
    }

    const validation = validateJsonlSession(sessionId);
    // Verify EVERY legacy message persisted, by event count — NOT by
    // `messageCount`, which counts only user_message/assistant_message events.
    // A legacy `system` message becomes a `system` event and a `tool` message a
    // `tool_result` event (see appendLegacyMessage); neither is a "message" by
    // that count, so comparing messageCount to legacy.messages.length wrongly
    // FAILED migration for any session with a system prompt or tool call.
    // appendLegacyMessage writes exactly one event per message, plus the leading
    // session_start and an optional trailing summary event.
    const expectedEvents =
      1 + legacy.messages.length + (legacy.summary ? 1 : 0);
    if (!validation.valid || validation.eventCount !== expectedEvents) {
      throw new Error(
        `post-migration validation failed for ${sessionId} (${validation.eventCount}/${expectedEvents} events)`,
      );
    }

    if (options.archive !== false) {
      copyFileSync(sourcePath, `${sourcePath}.migrated.json`);
    }
  }

  return {
    file: sourcePath,
    sessionId,
    migrated: true,
    messageCount: legacy.messages.length,
    archived: options.archive !== false && !options.dryRun,
    dryRun: Boolean(options.dryRun),
  };
}

function buildMigrationSummary(results, options = {}) {
  const summary = {
    directory: options.directory || null,
    dryRun: Boolean(options.dryRun),
    scanned: results.length,
    migrated: 0,
    skipped: 0,
    failed: 0,
    retries: 0,
  };

  for (const result of results) {
    if (result.migrated) summary.migrated += 1;
    if (result.skipped) summary.skipped += 1;
    if (result.failed) summary.failed += 1;
    if (result.retried) summary.retries += 1;
  }

  return summary;
}

function normalizeLegacySession(payload, fallbackId) {
  const messages = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.messages)
      ? payload.messages
      : [];

  return {
    id: payload?.id || fallbackId || `session-${Date.now()}`,
    meta: {
      title:
        payload?.title || payload?.name || fallbackId || "Migrated Session",
      provider: payload?.provider || "",
      model: payload?.model || "",
    },
    summary: payload?.summary || "",
    messages: messages.map(normalizeLegacyMessage).filter(Boolean),
  };
}

function normalizeLegacyMessage(message) {
  if (!message) return null;
  if (typeof message === "string") {
    return { role: "user", content: message };
  }

  const role = message.role || message.sender || message.type || "user";
  const content =
    message.content ?? message.text ?? message.message ?? message.result ?? "";

  return {
    role,
    content: typeof content === "string" ? content : JSON.stringify(content),
    tool: message.tool || message.name || null,
    args: message.args || message.arguments || null,
  };
}

function appendLegacyMessage(sessionId, message) {
  switch (message.role) {
    case "assistant":
      appendAssistantMessage(sessionId, message.content);
      break;
    case "tool":
      appendToolResult(
        sessionId,
        message.tool || "legacy-tool",
        message.content,
      );
      break;
    case "system":
      appendEvent(sessionId, "system", {
        role: "system",
        content: message.content,
      });
      break;
    default:
      appendUserMessage(sessionId, message.content);
      break;
  }
}
