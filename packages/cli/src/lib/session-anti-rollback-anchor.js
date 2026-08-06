/**
 * Machine-local anti-rollback witness for canonical session generations.
 *
 * Session transcripts, metadata and tombstones all live below
 * CHAINLESSCHAIN_HOME and can therefore be restored as one internally
 * consistent but stale snapshot. This store deliberately lives in a separate
 * OS user-state directory. Each session owns a small append-only witness log;
 * a 256-way namespace index keeps exact/prefix discovery bounded at 10k+
 * sessions without rewriting a global file for every transcript event.
 *
 * This is a cooperative same-user durability boundary, not tamper-proof
 * hardware. Deleting both the configured home and this independent witness is
 * outside its threat model.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import * as cliPaths from "./paths.js";
import {
  mutateSecurityStore,
  readSecurityStore,
} from "./durable-security-store.js";
import { ensurePrivateDirectory } from "./secure-fs.js";
import { withFileLock } from "./with-file-lock.js";
import { iterateFileLinesReverseSync } from "./file-lines.js";

export const SESSION_ANTI_ROLLBACK_DETECTED_CODE =
  "CC_SESSION_ANTI_ROLLBACK_DETECTED";
export const SESSION_ANTI_ROLLBACK_UNAVAILABLE_CODE =
  "CC_SESSION_ANTI_ROLLBACK_UNAVAILABLE";

const NAMESPACE_VERSION = 1;
const ANCHOR_SCHEMA = "chainlesschain.session-anti-rollback-anchor/v1";
const GENERATION_SCHEMA = "chainlesschain.session-generation-authority/v1";
const DIGEST_PATTERN = /^[0-9a-f]{64}$/;
const GENERATION_ID_PATTERN = /^generation-[0-9a-f-]{32,36}$/;
const MAX_SESSION_ID_BYTES = 1024;
const LOCK_OPTIONS = Object.freeze({
  timeoutMs: 30_000,
  staleMs: 30_000,
  failIfUnavailable: true,
});
const securedDirectories = new Map();
const testScopedDirectories = new Set();

function anchorError(code, message, cause = null, details = {}) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.name = "SessionAntiRollbackAnchorError";
  error.code = code;
  Object.assign(error, details);
  return error;
}

function unavailable(cause, filePath = null) {
  if (cause?.code === SESSION_ANTI_ROLLBACK_DETECTED_CODE) return cause;
  return anchorError(
    SESSION_ANTI_ROLLBACK_UNAVAILABLE_CODE,
    "Session anti-rollback witness is unavailable; canonical session access is denied",
    cause,
    filePath ? { filePath } : {},
  );
}

function rollback(sessionId, message, current = null, candidate = null) {
  return anchorError(
    SESSION_ANTI_ROLLBACK_DETECTED_CODE,
    `Session rollback detected for ${sessionId}: ${message}`,
    null,
    {
      sessionId,
      current: current ? structuredClone(current) : null,
      candidate: candidate ? structuredClone(candidate) : null,
    },
  );
}

function sha256(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function canonicalSessionId(value) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.includes("\0") ||
    Buffer.byteLength(value, "utf8") > MAX_SESSION_ID_BYTES
  ) {
    throw new TypeError("session anti-rollback witness requires a bounded id");
  }
  return value;
}

function canonicalPathIdentity(value) {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function isWithin(parentPath, childPath) {
  const relative = path.relative(parentPath, childPath);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

export function getSessionAntiRollbackDirectory({
  homeDir = cliPaths.getHomeDir(),
  anchorBase = null,
} = {}) {
  const canonicalHome = canonicalPathIdentity(homeDir);
  // Legacy Vitest mocks intentionally expose only getHomeDir/getStatePath. The
  // production module always exports getMachineSecurityAnchorDir, so a missing
  // provider is an explicit injected test seam rather than an environment-
  // variable downgrade a real CLI process can opt into.
  const machineDirectoryProvider = Object.prototype.hasOwnProperty.call(
    cliPaths,
    "getMachineSecurityAnchorDir",
  )
    ? cliPaths.getMachineSecurityAnchorDir
    : null;
  const hasProductionProvider = typeof machineDirectoryProvider === "function";
  const testBase = hasProductionProvider
    ? null
    : path.join(canonicalHome, ".test-machine-security-anchors");
  const canonicalBase = canonicalPathIdentity(
    anchorBase ||
      testBase ||
      (hasProductionProvider ? machineDirectoryProvider() : null),
  );
  if (hasProductionProvider && isWithin(canonicalHome, canonicalBase)) {
    throw anchorError(
      SESSION_ANTI_ROLLBACK_UNAVAILABLE_CODE,
      "Session anti-rollback witness must be outside CHAINLESSCHAIN_HOME",
      null,
      { homeDir: canonicalHome, anchorBase: canonicalBase },
    );
  }
  const directory = path.join(
    canonicalBase,
    "sessions-v1",
    sha256(canonicalHome),
  );
  if (!hasProductionProvider) testScopedDirectories.add(directory);
  return directory;
}

/**
 * Register one explicit anti-rollback directory as a test-owned filesystem.
 * This is an import-only test seam: production callers never invoke it, and
 * it does not change path separation, record validation, locking, or CAS.
 */
export function _registerTestScopedSessionAntiRollbackDirectory(options = {}) {
  const directory = getSessionAntiRollbackDirectory(options);
  testScopedDirectories.add(directory);
  return directory;
}

function anchorLocation(sessionId, options = {}) {
  const canonicalId = canonicalSessionId(sessionId);
  const sessionDigest = sha256(canonicalId);
  const directory = getSessionAntiRollbackDirectory(options);
  const prefix = sessionDigest.slice(0, 2);
  return Object.freeze({
    directory,
    namespaceDirectory: path.join(directory, "namespace"),
    recordDirectory: path.join(directory, "records", prefix),
    namespacePath: path.join(directory, "namespace", `${prefix}.json`),
    recordPath: path.join(
      directory,
      "records",
      prefix,
      `${sessionDigest}.ndjson`,
    ),
    homeDigest: path.basename(directory),
    sessionDigest,
    sessionId: canonicalId,
  });
}

function normalizeGeneration(value) {
  if (value === null) return null;
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    value.schema !== GENERATION_SCHEMA ||
    typeof value.sessionId !== "string" ||
    value.sessionId.length === 0 ||
    typeof value.generationId !== "string" ||
    !GENERATION_ID_PATTERN.test(value.generationId) ||
    !Number.isSafeInteger(value.ordinal) ||
    value.ordinal < 1
  ) {
    throw new TypeError("session generation authority is invalid");
  }
  let predecessor = null;
  if (value.predecessor !== null) {
    const previous = value.predecessor;
    if (
      !previous ||
      typeof previous !== "object" ||
      Array.isArray(previous) ||
      !["tombstone", "legacy-tombstone"].includes(previous.kind) ||
      (previous.generationId !== null &&
        (typeof previous.generationId !== "string" ||
          !GENERATION_ID_PATTERN.test(previous.generationId))) ||
      (previous.headHash !== null &&
        (typeof previous.headHash !== "string" ||
          !DIGEST_PATTERN.test(previous.headHash))) ||
      !Number.isSafeInteger(previous.eventCount) ||
      previous.eventCount < 0 ||
      (previous.tombstonedAtMs !== null &&
        (!Number.isSafeInteger(previous.tombstonedAtMs) ||
          previous.tombstonedAtMs < 0))
    ) {
      throw new TypeError("session generation predecessor is invalid");
    }
    predecessor = Object.freeze({
      kind: previous.kind,
      generationId: previous.generationId,
      headHash: previous.headHash,
      eventCount: previous.eventCount,
      tombstonedAtMs: previous.tombstonedAtMs,
    });
  }
  return Object.freeze({
    schema: GENERATION_SCHEMA,
    sessionId: value.sessionId,
    generationId: value.generationId,
    ordinal: value.ordinal,
    predecessor,
  });
}

function canonicalCandidate(sessionId, value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("session anti-rollback candidate must be an object");
  }
  if (!new Set(["live", "deleted"]).has(value.status)) {
    throw new TypeError("session anti-rollback status is invalid");
  }
  if (
    value.headHash !== null &&
    (typeof value.headHash !== "string" || !DIGEST_PATTERN.test(value.headHash))
  ) {
    throw new TypeError("session anti-rollback head hash is invalid");
  }
  if (!Number.isSafeInteger(value.eventCount) || value.eventCount < 0) {
    throw new TypeError("session anti-rollback event count is invalid");
  }
  const generation = normalizeGeneration(value.generation ?? null);
  if (generation !== null && generation.sessionId !== sessionId) {
    throw new TypeError("session anti-rollback generation id does not match");
  }
  const legacyDeletion =
    value.status === "deleted" &&
    generation === null &&
    value.headHash === null;
  if (
    !legacyDeletion &&
    (value.eventCount === 0) !== (value.headHash === null)
  ) {
    throw new TypeError("session anti-rollback head/count are inconsistent");
  }
  const deletedAtMs =
    value.status === "deleted"
      ? Math.max(0, Number(value.deletedAtMs) || 0)
      : null;
  if (
    value.status === "deleted" &&
    (!Number.isSafeInteger(deletedAtMs) || deletedAtMs < 0)
  ) {
    throw new TypeError("session deletion timestamp is invalid");
  }
  return Object.freeze({
    status: value.status,
    generation,
    headHash: value.headHash,
    eventCount: value.eventCount,
    deletedAtMs,
  });
}

function sameGeneration(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function recordCore(location, revision, previousRecordHash, candidate) {
  return {
    schema: ANCHOR_SCHEMA,
    stateHomeDigest: location.homeDigest,
    sessionDigest: location.sessionDigest,
    sessionId: location.sessionId,
    revision: String(revision),
    previousRecordHash,
    ...candidate,
  };
}

function normalizeRecord(value, location) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    value.schema !== ANCHOR_SCHEMA ||
    value.stateHomeDigest !== location.homeDigest ||
    value.sessionDigest !== location.sessionDigest ||
    value.sessionId !== location.sessionId ||
    typeof value.revision !== "string" ||
    !/^[1-9]\d*$/.test(value.revision) ||
    (value.previousRecordHash !== null &&
      (typeof value.previousRecordHash !== "string" ||
        !DIGEST_PATTERN.test(value.previousRecordHash))) ||
    typeof value.recordHash !== "string" ||
    !DIGEST_PATTERN.test(value.recordHash)
  ) {
    throw new TypeError("session anti-rollback record identity is invalid");
  }
  const candidate = canonicalCandidate(location.sessionId, value);
  const core = recordCore(
    location,
    value.revision,
    value.previousRecordHash,
    candidate,
  );
  if (sha256(JSON.stringify(core)) !== value.recordHash) {
    throw new TypeError("session anti-rollback record digest is invalid");
  }
  return Object.freeze({ ...core, recordHash: value.recordHash });
}

function normalizeNamespace(value, homeDigest, { missing = false } = {}) {
  if (missing && Object.keys(value).length === 0) {
    return Object.freeze({ entries: Object.freeze({}) });
  }
  if (
    value.version !== NAMESPACE_VERSION ||
    value.stateHomeDigest !== homeDigest ||
    !value.entries ||
    typeof value.entries !== "object" ||
    Array.isArray(value.entries)
  ) {
    throw new TypeError("session anti-rollback namespace bucket is invalid");
  }
  const entries = {};
  for (const [digest, sessionId] of Object.entries(value.entries)) {
    if (
      !DIGEST_PATTERN.test(digest) ||
      typeof sessionId !== "string" ||
      sha256(sessionId) !== digest
    ) {
      throw new TypeError("session anti-rollback namespace entry is invalid");
    }
    entries[digest] = sessionId;
  }
  return Object.freeze({ entries: Object.freeze(entries) });
}

function prepareDirectory(directory) {
  try {
    const testScoped = [...testScopedDirectories].some((root) =>
      isWithin(root, directory),
    );
    if (testScoped) {
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
      const testDirectory = fs.lstatSync(directory);
      if (testDirectory.isSymbolicLink() || !testDirectory.isDirectory()) {
        throw new TypeError("session anti-rollback test path is unsafe");
      }
      securedDirectories.set(
        directory,
        `${testDirectory.dev}:${testDirectory.ino}`,
      );
      return;
    }
    let current = null;
    try {
      current = fs.lstatSync(directory);
    } catch {
      // The secure helper below creates a missing directory.
    }
    const identity = current ? `${current.dev}:${current.ino}` : null;
    const unsafePosixMode =
      process.platform !== "win32" &&
      current !== null &&
      (current.mode & 0o777) !== 0o700;
    if (
      current?.isDirectory() &&
      !current.isSymbolicLink() &&
      !unsafePosixMode &&
      securedDirectories.get(directory) === identity
    ) {
      return;
    }
    ensurePrivateDirectory(directory, {
      failIfUnavailable: true,
    });
    const secured = fs.lstatSync(directory);
    securedDirectories.set(directory, `${secured.dev}:${secured.ino}`);
  } catch (cause) {
    throw unavailable(cause, directory);
  }
}

function assertRegularRecordPath(filePath) {
  if (!fs.existsSync(filePath)) return;
  const stats = fs.lstatSync(filePath);
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new TypeError("session anti-rollback record is not a regular file");
  }
}

function readLastRecord(location) {
  if (!fs.existsSync(location.recordPath)) return null;
  try {
    assertRegularRecordPath(location.recordPath);
    const stats = fs.statSync(location.recordPath);
    let endsWithNewline = false;
    if (stats.size > 0) {
      const descriptor = fs.openSync(location.recordPath, "r");
      try {
        const last = Buffer.allocUnsafe(1);
        fs.readSync(descriptor, last, 0, 1, stats.size - 1);
        endsWithNewline = last[0] === 0x0a;
      } finally {
        fs.closeSync(descriptor);
      }
    }
    let first = true;
    for (const item of iterateFileLinesReverseSync(location.recordPath)) {
      if (first && !endsWithNewline && !item.terminated) {
        first = false;
        continue;
      }
      return normalizeRecord(JSON.parse(item.line), location);
    }
    return null;
  } catch (cause) {
    throw unavailable(cause, location.recordPath);
  }
}

export function readSessionAntiRollbackAnchor(sessionId, options = {}) {
  return readLastRecord(anchorLocation(sessionId, options));
}

function successorMatchesDeleted(current, candidate) {
  const generation = candidate.generation;
  if (!generation || generation.predecessor === null) return false;
  const previous = generation.predecessor;
  const currentGeneration = current.generation;
  const expectedOrdinal = currentGeneration ? currentGeneration.ordinal + 1 : 2;
  return (
    generation.ordinal === expectedOrdinal &&
    previous.kind === (currentGeneration ? "tombstone" : "legacy-tombstone") &&
    previous.generationId === (currentGeneration?.generationId ?? null) &&
    previous.headHash === current.headHash &&
    previous.eventCount === current.eventCount &&
    previous.tombstonedAtMs === current.deletedAtMs
  );
}

function assertForwardTransition(sessionId, current, candidate, provePrefix) {
  if (current === null) return;
  if (current.status === "live" && candidate.status === "deleted") {
    if (
      !sameGeneration(current.generation, candidate.generation) ||
      current.headHash !== candidate.headHash ||
      current.eventCount !== candidate.eventCount
    ) {
      throw rollback(
        sessionId,
        "deletion does not preserve the anchored live generation",
        current,
        candidate,
      );
    }
    return;
  }
  if (current.status === "deleted" && candidate.status === "live") {
    if (!successorMatchesDeleted(current, candidate)) {
      throw rollback(
        sessionId,
        "live generation is not the anchored tombstone successor",
        current,
        candidate,
      );
    }
    return;
  }
  if (current.status !== candidate.status) {
    throw rollback(
      sessionId,
      "session status moved backward",
      current,
      candidate,
    );
  }
  if (!sameGeneration(current.generation, candidate.generation)) {
    throw rollback(
      sessionId,
      "generation identity moved backward or forked",
      current,
      candidate,
    );
  }
  if (candidate.status === "deleted") {
    if (
      current.headHash !== candidate.headHash ||
      current.eventCount !== candidate.eventCount ||
      candidate.deletedAtMs < current.deletedAtMs
    ) {
      throw rollback(
        sessionId,
        "tombstone witness moved backward",
        current,
        candidate,
      );
    }
    return;
  }
  if (candidate.eventCount < current.eventCount) {
    throw rollback(sessionId, "event count moved backward", current, candidate);
  }
  if (candidate.eventCount === current.eventCount) {
    if (candidate.headHash !== current.headHash) {
      throw rollback(
        sessionId,
        "equal event count has a different head",
        current,
        candidate,
      );
    }
    return;
  }
  let prefixProven = false;
  try {
    prefixProven = provePrefix?.(current) === true;
  } catch (cause) {
    throw unavailable(cause);
  }
  if (!prefixProven) {
    throw rollback(
      sessionId,
      "newer local head does not prove the external anchor as a prefix",
      current,
      candidate,
    );
  }
}

function truncatePartialTail(filePath) {
  if (!fs.existsSync(filePath)) return;
  let descriptor = null;
  try {
    let flags = fs.constants.O_RDWR;
    if (typeof fs.constants.O_NOFOLLOW === "number") {
      flags |= fs.constants.O_NOFOLLOW;
    }
    descriptor = fs.openSync(filePath, flags);
    const size = fs.fstatSync(descriptor).size;
    if (size === 0) return;
    const last = Buffer.allocUnsafe(1);
    fs.readSync(descriptor, last, 0, 1, size - 1);
    if (last[0] === 0x0a) return;

    const buffer = Buffer.allocUnsafe(4096);
    let position = size;
    let truncateAt = 0;
    while (position > 0) {
      const length = Math.min(buffer.length, position);
      position -= length;
      fs.readSync(descriptor, buffer, 0, length, position);
      for (let index = length - 1; index >= 0; index -= 1) {
        if (buffer[index] === 0x0a) {
          truncateAt = position + index + 1;
          position = 0;
          break;
        }
      }
    }
    fs.ftruncateSync(descriptor, truncateAt);
    fs.fsyncSync(descriptor);
  } finally {
    if (descriptor !== null) fs.closeSync(descriptor);
  }
}

function ensureNamespaceEntry(location) {
  prepareDirectory(location.namespaceDirectory);
  mutateSecurityStore(
    location.namespacePath,
    "Session anti-rollback namespace",
    (draft) => {
      const namespace = normalizeNamespace(draft, location.homeDigest, {
        missing: !fs.existsSync(location.namespacePath),
      });
      const existing = namespace.entries[location.sessionDigest];
      if (existing !== undefined && existing !== location.sessionId) {
        throw new TypeError("session anti-rollback namespace digest collision");
      }
      draft.version = NAMESPACE_VERSION;
      draft.stateHomeDigest = location.homeDigest;
      draft.entries = {
        ...namespace.entries,
        [location.sessionDigest]: location.sessionId,
      };
    },
    LOCK_OPTIONS,
  );
}

function appendRecord(location, record) {
  let descriptor = null;
  try {
    let flags = fs.constants.O_WRONLY | fs.constants.O_APPEND;
    const createsRecord = !fs.existsSync(location.recordPath);
    if (createsRecord) {
      flags |= fs.constants.O_CREAT | fs.constants.O_EXCL;
    }
    if (typeof fs.constants.O_NOFOLLOW === "number") {
      flags |= fs.constants.O_NOFOLLOW;
    }
    descriptor = fs.openSync(location.recordPath, flags, 0o600);
    const opened = fs.fstatSync(descriptor);
    const payload = Buffer.from(`${JSON.stringify(record)}\n`, "utf8");
    let offset = 0;
    while (offset < payload.length) {
      const written = fs.writeSync(
        descriptor,
        payload,
        offset,
        payload.length - offset,
      );
      if (!Number.isSafeInteger(written) || written <= 0) {
        throw new Error(
          "session anti-rollback append made no forward progress",
        );
      }
      offset += written;
    }
    fs.fsyncSync(descriptor);
    const published = fs.lstatSync(location.recordPath);
    if (
      published.isSymbolicLink() ||
      !published.isFile() ||
      String(opened.dev) !== String(published.dev) ||
      String(opened.ino) !== String(published.ino)
    ) {
      throw new Error("session anti-rollback record identity changed");
    }
    if (createsRecord && process.platform !== "win32") {
      const directoryDescriptor = fs.openSync(location.recordDirectory, "r");
      try {
        fs.fsyncSync(directoryDescriptor);
      } finally {
        fs.closeSync(directoryDescriptor);
      }
    }
  } finally {
    if (descriptor !== null) fs.closeSync(descriptor);
  }
}

export function publishSessionAntiRollbackAnchor(
  sessionId,
  value,
  { provePrefix = null, ...pathOptions } = {},
) {
  const location = anchorLocation(sessionId, pathOptions);
  const candidate = canonicalCandidate(location.sessionId, value);
  prepareDirectory(location.recordDirectory);
  try {
    return withFileLock(
      location.recordPath,
      () => {
        assertRegularRecordPath(location.recordPath);
        truncatePartialTail(location.recordPath);
        const current = readLastRecord(location);
        assertForwardTransition(
          location.sessionId,
          current,
          candidate,
          provePrefix,
        );
        const unchanged =
          current !== null &&
          current.status === candidate.status &&
          sameGeneration(current.generation, candidate.generation) &&
          current.headHash === candidate.headHash &&
          current.eventCount === candidate.eventCount &&
          current.deletedAtMs === candidate.deletedAtMs;
        if (unchanged) return current;
        if (current === null) ensureNamespaceEntry(location);
        const core = recordCore(
          location,
          BigInt(current?.revision || "0") + 1n,
          current?.recordHash || null,
          candidate,
        );
        const record = Object.freeze({
          ...core,
          recordHash: sha256(JSON.stringify(core)),
        });
        appendRecord(location, record);
        return record;
      },
      LOCK_OPTIONS,
    );
  } catch (cause) {
    throw unavailable(cause, location.recordPath);
  }
}

export function listSessionAntiRollbackIds(options = {}) {
  const directory = getSessionAntiRollbackDirectory(options);
  const namespaceDirectory = path.join(directory, "namespace");
  if (!fs.existsSync(namespaceDirectory)) return [];
  try {
    prepareDirectory(namespaceDirectory);
    const ids = new Set();
    for (const name of fs.readdirSync(namespaceDirectory)) {
      if (!/^[0-9a-f]{2}\.json$/.test(name)) continue;
      const filePath = path.join(namespaceDirectory, name);
      const namespace = normalizeNamespace(
        readSecurityStore(filePath, "Session anti-rollback namespace"),
        path.basename(directory),
      );
      for (const sessionId of Object.values(namespace.entries)) {
        ids.add(sessionId);
      }
    }
    return [...ids].sort();
  } catch (cause) {
    throw unavailable(cause, namespaceDirectory);
  }
}

export function sessionAntiRollbackPredecessorWitness(record) {
  if (!record || record.status !== "deleted") return null;
  return Object.freeze({
    generation: record.generation,
    last_hash: record.headHash,
    event_count: record.eventCount,
    deleted_at_ms: record.deletedAtMs,
    deleted: true,
  });
}
