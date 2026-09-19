import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  lstat,
  link,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rmdir,
  stat,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import { types } from "node:util";

export const BROWSER_FILESYSTEM_QUARANTINE_CUSTODY_DESCRIPTOR_SCHEMA =
  "chainlesschain.browser-filesystem-quarantine-custody-descriptor/v1";
export const BROWSER_FILESYSTEM_QUARANTINE_METADATA_SCHEMA =
  "chainlesschain.browser-filesystem-quarantine-metadata/v1";
export const BROWSER_FILESYSTEM_QUARANTINE_DELETION_INTENT_SCHEMA =
  "chainlesschain.browser-filesystem-quarantine-deletion-intent/v1";
export const BROWSER_FILESYSTEM_QUARANTINE_TOMBSTONE_SCHEMA =
  "chainlesschain.browser-filesystem-quarantine-tombstone/v1";
export const BROWSER_FILESYSTEM_QUARANTINE_RETENTION_DESCRIPTOR_SCHEMA =
  "chainlesschain.browser-filesystem-quarantine-retention-descriptor/v1";
export const BROWSER_FILESYSTEM_QUARANTINE_EXPIRY_PLAN_SCHEMA =
  "chainlesschain.browser-filesystem-quarantine-expiry-plan/v1";
export const BROWSER_FILESYSTEM_QUARANTINE_OPERATOR_REVOCATION_DESCRIPTOR_SCHEMA =
  "chainlesschain.browser-filesystem-quarantine-operator-revocation-descriptor/v1";
export const BROWSER_FILESYSTEM_QUARANTINE_LOCK_OWNER_SCHEMA =
  "chainlesschain.browser-filesystem-quarantine-lock-owner/v1";

const QUARANTINE_COMMIT_ACK_SCHEMA =
  "chainlesschain.browser-download-quarantine-commit-ack/v1";
const COMPLETION_ACK_SCHEMA =
  "chainlesschain.browser-download-completion-ack/v1";
const DISPOSAL_DESCRIPTOR_SCHEMA =
  "chainlesschain.browser-download-artifact-disposal-descriptor/v1";
const DELETION_ACK_SCHEMA =
  "chainlesschain.browser-download-artifact-deletion-ack/v1";
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const ID = /^[A-Za-z0-9._:-]{1,128}$/u;
const ARTIFACT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/u;
const ARTIFACT_REF = /^quarantine:[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/u;
const METADATA_FILE = /^([A-Za-z0-9][A-Za-z0-9._-]{0,95})\.json$/u;
const CONTENT_TYPE =
  /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/u;
const MAX_BYTES = 100 * 1024 * 1024;
const LOCK_OWNER_INIT_TIMEOUT_MS = 30_000;
const LOCK_OPERATIONS = new Set([
  "write",
  "scan",
  "complete",
  "dispose",
  "recover",
]);
const LOCK_TEMP_FILE =
  /^owner\.json\.[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.tmp$/iu;
const OBJECT_FILE = /^([A-Za-z0-9][A-Za-z0-9._-]{0,95})\.(part|blob)$/u;
const METADATA_TEMP_FILE =
  /^([A-Za-z0-9][A-Za-z0-9._-]{0,95})\.json\.[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.tmp$/iu;
const DELETION_FILE =
  /^([A-Za-z0-9][A-Za-z0-9._-]{0,95})\.(intent|deleted)\.json$/u;
const DELETION_TEMP_FILE =
  /^([A-Za-z0-9][A-Za-z0-9._-]{0,95})\.(?:intent|deleted)\.json\.[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.tmp$/iu;
const LOCK_DIRECTORY = /^([A-Za-z0-9][A-Za-z0-9._-]{0,95})\.lock$/u;
const DISPOSAL_REASONS = new Set([
  "user-discard",
  "expired",
  "revoked",
  "delivery-failed",
]);
const METADATA_KEYS = [
  "schema",
  "custodyId",
  "tenantId",
  "artifactRef",
  "artifactDigest",
  "sizeBytes",
  "contentType",
  "networkReceiptDigest",
  "sourceActionReceiptDigest",
  "status",
  "committedAt",
  "expiresAt",
  "quarantineReceiptDigest",
  "scanEvidenceDigest",
  "completedAt",
  "completionReceiptDigest",
];
const custodies = new WeakMap();

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function digest(domain, value) {
  return `sha256:${createHash("sha256")
    .update(`${domain}\0`)
    .update(canonical(value))
    .digest("hex")}`;
}

function exact(value, keys, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    types.isProxy(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Reflect.ownKeys(value).length !== keys.length ||
    keys.some((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return !descriptor?.enumerable || !("value" in descriptor);
    })
  )
    throw new TypeError(`${label} has an invalid shape`);
}

function normalizeDescriptor(value) {
  exact(
    value,
    [
      "schema",
      "custodyId",
      "tenantId",
      "handlerArtifactDigest",
      "retentionMs",
      "custodyMode",
    ],
    "filesystem quarantine custody descriptor",
  );
  if (
    value.schema !== BROWSER_FILESYSTEM_QUARANTINE_CUSTODY_DESCRIPTOR_SCHEMA ||
    !ID.test(value.custodyId) ||
    !ID.test(value.tenantId) ||
    !DIGEST.test(value.handlerArtifactDigest) ||
    !Number.isSafeInteger(value.retentionMs) ||
    value.retentionMs < 1000 ||
    value.retentionMs > 30 * 24 * 60 * 60 * 1000 ||
    value.custodyMode !== "exclusive-stream-fsync"
  )
    throw new TypeError("filesystem quarantine custody descriptor is invalid");
  return Object.freeze({ ...value });
}

function normalizeStateRoot(value) {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 4096 ||
    value.includes("\0") ||
    !path.isAbsolute(value)
  )
    throw new TypeError("filesystem quarantine state root is invalid");
  return path.resolve(value);
}

function pathsFor(root, artifactId) {
  if (!ARTIFACT_ID.test(artifactId))
    throw new TypeError("filesystem quarantine artifact id is invalid");
  const objects = path.join(root, "objects");
  const metadata = path.join(root, "metadata");
  return Object.freeze({
    part: path.join(objects, `${artifactId}.part`),
    blob: path.join(objects, `${artifactId}.blob`),
    metadata: path.join(metadata, `${artifactId}.json`),
    deletionIntent: path.join(root, "deletions", `${artifactId}.intent.json`),
    tombstone: path.join(root, "deletions", `${artifactId}.deleted.json`),
    lockDirectory: path.join(root, "locks", `${artifactId}.lock`),
    lockOwner: path.join(root, "locks", `${artifactId}.lock`, "owner.json"),
  });
}

function artifactIdFromRef(value) {
  if (typeof value !== "string" || !ARTIFACT_REF.test(value))
    throw new TypeError("filesystem quarantine artifact reference is invalid");
  return value.slice("quarantine:".length);
}

async function exists(file) {
  try {
    await lstat(file);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function unlinkIfPresent(file) {
  try {
    await unlink(file);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

async function assertSafeDirectory(root, directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new Error("filesystem quarantine directory is unsafe");
  const resolved = await realpath(directory);
  const relative = path.relative(root, resolved);
  if (relative === ".." || relative.startsWith(`..${path.sep}`))
    throw new Error("filesystem quarantine directory escapes its state root");
}

async function prepare(state) {
  if (!state.preparePromise) {
    state.preparePromise = (async () => {
      await mkdir(state.stateRoot, { recursive: true, mode: 0o700 });
      const rootInfo = await lstat(state.stateRoot);
      if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink())
        throw new Error("filesystem quarantine state root is unsafe");
      const resolvedRoot = await realpath(state.stateRoot);
      if (path.relative(state.stateRoot, resolvedRoot) !== "")
        throw new Error("filesystem quarantine state root must not be a link");
      await assertSafeDirectory(state.stateRoot, state.objectsRoot);
      await assertSafeDirectory(state.stateRoot, state.metadataRoot);
      await assertSafeDirectory(state.stateRoot, state.deletionsRoot);
      await assertSafeDirectory(state.stateRoot, state.locksRoot);
    })();
  }
  await state.preparePromise;
}

async function hashFile(file) {
  const hash = createHash("sha256");
  let sizeBytes = 0;
  for await (const chunk of createReadStream(file)) {
    sizeBytes += chunk.byteLength;
    hash.update(chunk);
  }
  return Object.freeze({
    artifactDigest: `sha256:${hash.digest("hex")}`,
    sizeBytes,
  });
}

function pathlessBody(state, artifactId, file, expectedMetadata) {
  return Object.freeze({
    async *[Symbol.asyncIterator]() {
      const releaseLock = await acquireArtifactLock(state, artifactId, "scan");
      let readerRegistered = false;
      let stream = null;
      try {
        if (state.disposals.has(artifactId))
          throw new Error("filesystem quarantine artifact disposal is active");
        state.readers.set(artifactId, (state.readers.get(artifactId) ?? 0) + 1);
        readerRegistered = true;
        const persisted = await readMetadata(
          state,
          expectedMetadata.artifactRef,
        );
        if (
          persisted.metadata.status !== "quarantined" ||
          persisted.metadata.artifactDigest !==
            expectedMetadata.artifactDigest ||
          persisted.metadata.quarantineReceiptDigest !==
            expectedMetadata.quarantineReceiptDigest
        )
          throw new Error(
            "filesystem quarantine scan changed before streaming",
          );
        await verifyBlob(persisted.files, persisted.metadata);
        stream = createReadStream(file);
        for await (const chunk of stream) yield Buffer.from(chunk);
      } finally {
        stream?.destroy();
        if (readerRegistered) {
          const remaining = (state.readers.get(artifactId) ?? 1) - 1;
          if (remaining === 0) state.readers.delete(artifactId);
          else state.readers.set(artifactId, remaining);
        }
        await releaseLock();
      }
    },
  });
}

function normalizeMetadata(value, descriptor) {
  exact(value, METADATA_KEYS, "filesystem quarantine metadata");
  if (
    value.schema !== BROWSER_FILESYSTEM_QUARANTINE_METADATA_SCHEMA ||
    value.custodyId !== descriptor.custodyId ||
    value.tenantId !== descriptor.tenantId ||
    !ARTIFACT_REF.test(value.artifactRef) ||
    !DIGEST.test(value.artifactDigest) ||
    !Number.isSafeInteger(value.sizeBytes) ||
    value.sizeBytes < 1 ||
    value.sizeBytes > MAX_BYTES ||
    !CONTENT_TYPE.test(value.contentType) ||
    !DIGEST.test(value.networkReceiptDigest) ||
    !DIGEST.test(value.sourceActionReceiptDigest) ||
    !["quarantined", "ready"].includes(value.status) ||
    !Number.isFinite(Date.parse(value.committedAt)) ||
    !Number.isFinite(Date.parse(value.expiresAt)) ||
    Date.parse(value.expiresAt) <= Date.parse(value.committedAt) ||
    !DIGEST.test(value.quarantineReceiptDigest) ||
    (value.status === "quarantined" &&
      (value.scanEvidenceDigest !== null ||
        value.completedAt !== null ||
        value.completionReceiptDigest !== null)) ||
    (value.status === "ready" &&
      (!DIGEST.test(value.scanEvidenceDigest) ||
        !Number.isFinite(Date.parse(value.completedAt)) ||
        !DIGEST.test(value.completionReceiptDigest)))
  )
    throw new Error("filesystem quarantine metadata is invalid");
  return Object.freeze({ ...value });
}

async function writeMetadata(file, value) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  let handle = null;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(`${canonical(value)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(temporary, file);
    // Windows requires a write-capable handle for FlushFileBuffers/fsync.
    const committed = await open(file, "r+");
    try {
      await committed.sync();
    } finally {
      await committed.close();
    }
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    await unlinkIfPresent(temporary).catch(() => {});
    throw error;
  }
}

async function writeNewMetadata(file, value) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  let handle = null;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(`${canonical(value)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    await link(temporary, file);
    await unlink(temporary);
    const committed = await open(file, "r+");
    try {
      await committed.sync();
    } finally {
      await committed.close();
    }
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    await unlinkIfPresent(temporary).catch(() => {});
    throw error;
  }
}

function lockError(message) {
  const error = new Error(message);
  error.code = "BROWSER_FILESYSTEM_QUARANTINE_ARTIFACT_LOCKED";
  return error;
}

function normalizeLockOwner(value, state, artifactId) {
  exact(
    value,
    [
      "schema",
      "custodyId",
      "tenantId",
      "artifactId",
      "operation",
      "lockId",
      "pid",
      "acquiredAt",
    ],
    "filesystem quarantine lock owner",
  );
  if (
    value.schema !== BROWSER_FILESYSTEM_QUARANTINE_LOCK_OWNER_SCHEMA ||
    value.custodyId !== state.descriptor.custodyId ||
    value.tenantId !== state.descriptor.tenantId ||
    value.artifactId !== artifactId ||
    !LOCK_OPERATIONS.has(value.operation) ||
    typeof value.lockId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      value.lockId,
    ) ||
    !Number.isSafeInteger(value.pid) ||
    value.pid < 1 ||
    !Number.isFinite(Date.parse(value.acquiredAt))
  )
    throw new Error("filesystem quarantine lock owner is invalid");
  return Object.freeze({ ...value });
}

function isProcessAlive(pid) {
  if (pid === process.pid) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    if (error?.code === "EPERM") return true;
    throw error;
  }
}

async function inspectLockDirectory(files) {
  let info;
  try {
    info = await lstat(files.lockDirectory);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new Error("filesystem quarantine artifact lock is unsafe");
  const entries = await readdir(files.lockDirectory, { withFileTypes: true });
  for (const entry of entries) {
    if (
      (entry.name !== "owner.json" && !LOCK_TEMP_FILE.test(entry.name)) ||
      !entry.isFile() ||
      entry.isSymbolicLink()
    )
      throw new Error("filesystem quarantine artifact lock is unsafe");
  }
  return Object.freeze({ info, entries });
}

async function removeLockDirectory(files) {
  const inspected = await inspectLockDirectory(files);
  if (inspected === null) return;
  for (const entry of inspected.entries)
    await unlinkIfPresent(path.join(files.lockDirectory, entry.name));
  try {
    await rmdir(files.lockDirectory);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  if (await exists(files.lockDirectory))
    throw new Error("filesystem quarantine artifact lock cleanup failed");
}

async function recoverAbandonedLock(state, files, artifactId) {
  const inspected = await inspectLockDirectory(files);
  if (inspected === null) return;
  let parsed;
  try {
    parsed = JSON.parse(await readFile(files.lockOwner, "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    if (Date.now() - inspected.info.mtimeMs < LOCK_OWNER_INIT_TIMEOUT_MS)
      throw lockError("filesystem quarantine artifact lock is initializing");
    await removeLockDirectory(files);
    return;
  }
  const owner = normalizeLockOwner(parsed, state, artifactId);
  if (isProcessAlive(owner.pid))
    throw lockError(
      `filesystem quarantine artifact is locked for ${owner.operation}`,
    );
  await removeLockDirectory(files);
}

async function acquireArtifactLock(state, artifactId, operation) {
  if (!ARTIFACT_ID.test(artifactId) || !LOCK_OPERATIONS.has(operation))
    throw new TypeError("filesystem quarantine artifact lock input is invalid");
  await prepare(state);
  const files = pathsFor(state.stateRoot, artifactId);
  const ownerValue = Object.freeze({
    schema: BROWSER_FILESYSTEM_QUARANTINE_LOCK_OWNER_SCHEMA,
    custodyId: state.descriptor.custodyId,
    tenantId: state.descriptor.tenantId,
    artifactId,
    operation,
    lockId: randomUUID(),
    pid: process.pid,
    acquiredAt: new Date().toISOString(),
  });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await mkdir(files.lockDirectory, { mode: 0o700 });
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      await recoverAbandonedLock(state, files, artifactId);
      continue;
    }
    try {
      await writeNewMetadata(files.lockOwner, ownerValue);
      const readback = normalizeLockOwner(
        JSON.parse(await readFile(files.lockOwner, "utf8")),
        state,
        artifactId,
      );
      if (readback.lockId !== ownerValue.lockId)
        throw new Error("filesystem quarantine artifact lock differs");
    } catch (error) {
      await removeLockDirectory(files).catch(() => {});
      throw error;
    }
    let released = false;
    return async () => {
      if (released) return;
      const current = normalizeLockOwner(
        JSON.parse(await readFile(files.lockOwner, "utf8")),
        state,
        artifactId,
      );
      if (current.lockId !== ownerValue.lockId)
        throw new Error(
          "filesystem quarantine artifact lock ownership changed",
        );
      await removeLockDirectory(files);
      released = true;
    };
  }
  throw lockError("filesystem quarantine artifact lock acquisition raced");
}

function assertRegularRecoveryEntry(entry, label) {
  if (!entry.isFile() || entry.isSymbolicLink())
    throw new Error(`filesystem quarantine ${label} entry is unsafe`);
}

async function discoverRecoveryState(state) {
  const candidates = new Set();
  const temporaryFiles = new Map();
  const addTemporary = (artifactId, file) => {
    candidates.add(artifactId);
    let files = temporaryFiles.get(artifactId);
    if (!files) {
      files = new Set();
      temporaryFiles.set(artifactId, files);
    }
    files.add(file);
  };

  const metadataIds = new Set();
  for (const entry of await readdir(state.metadataRoot, {
    withFileTypes: true,
  })) {
    assertRegularRecoveryEntry(entry, "metadata");
    const metadataMatch = METADATA_FILE.exec(entry.name);
    if (metadataMatch) {
      metadataIds.add(metadataMatch[1]);
      continue;
    }
    const temporaryMatch = METADATA_TEMP_FILE.exec(entry.name);
    if (!temporaryMatch)
      throw new Error("filesystem quarantine metadata entry is unknown");
    addTemporary(temporaryMatch[1], path.join(state.metadataRoot, entry.name));
  }

  for (const entry of await readdir(state.objectsRoot, {
    withFileTypes: true,
  })) {
    assertRegularRecoveryEntry(entry, "object");
    const match = OBJECT_FILE.exec(entry.name);
    if (!match)
      throw new Error("filesystem quarantine object entry is unknown");
    if (match[2] === "part" || !metadataIds.has(match[1]))
      candidates.add(match[1]);
  }

  for (const entry of await readdir(state.deletionsRoot, {
    withFileTypes: true,
  })) {
    assertRegularRecoveryEntry(entry, "deletion");
    if (DELETION_FILE.test(entry.name)) continue;
    const temporaryMatch = DELETION_TEMP_FILE.exec(entry.name);
    if (!temporaryMatch)
      throw new Error("filesystem quarantine deletion entry is unknown");
    addTemporary(temporaryMatch[1], path.join(state.deletionsRoot, entry.name));
  }

  for (const entry of await readdir(state.locksRoot, {
    withFileTypes: true,
  })) {
    if (!entry.isDirectory() || entry.isSymbolicLink())
      throw new Error("filesystem quarantine lock entry is unsafe");
    const match = LOCK_DIRECTORY.exec(entry.name);
    if (!match) throw new Error("filesystem quarantine lock entry is unknown");
    candidates.add(match[1]);
  }
  return Object.freeze({ candidates, temporaryFiles });
}

async function findArtifactTemporaryFiles(state, artifactId) {
  const files = [];
  for (const [directory, pattern] of [
    [state.metadataRoot, METADATA_TEMP_FILE],
    [state.deletionsRoot, DELETION_TEMP_FILE],
  ]) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const match = pattern.exec(entry.name);
      if (!match || match[1] !== artifactId) continue;
      assertRegularRecoveryEntry(entry, "temporary");
      files.push(path.join(directory, entry.name));
    }
  }
  return files;
}

async function removeRecoveryTemporaryFiles(files) {
  for (const file of files) {
    let info;
    try {
      info = await lstat(file);
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    if (!info.isFile() || info.isSymbolicLink())
      throw new Error("filesystem quarantine temporary file is unsafe");
    await unlink(file);
    if (await exists(file))
      throw new Error("filesystem quarantine temporary cleanup failed");
  }
}

function normalizeRecoveryDeletionEvidence(value, state, kind) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(
      "filesystem quarantine recovery deletion evidence is invalid",
    );
  const descriptor = {
    authorityId: value.authorityId,
    tenantId: state.descriptor.tenantId,
    handlerArtifactDigest: state.descriptor.handlerArtifactDigest,
  };
  const input = {
    actionReceiptDigest: value.actionReceiptDigest,
    requestDigest: value.requestDigest,
    artifactRef: value.artifactRef,
    artifactDigest: value.artifactDigest,
    sourceActionReceiptDigest: value.sourceActionReceiptDigest,
    reason: value.reason,
  };
  return kind === "intent"
    ? normalizeDeletionIntent(value, state, descriptor, input)
    : normalizeTombstone(value, state, descriptor, input);
}

function sameDeletionBinding(left, right) {
  return [
    "custodyId",
    "tenantId",
    "authorityId",
    "handlerArtifactDigest",
    "actionReceiptDigest",
    "requestDigest",
    "artifactRef",
    "artifactDigest",
    "sourceActionReceiptDigest",
    "reason",
  ].every((key) => left[key] === right[key]);
}

async function reconcileArtifactDebris(state, artifactId, temporaryFiles = []) {
  const files = pathsFor(state.stateRoot, artifactId);
  const [intentValue, tombstoneValue] = await Promise.all([
    readJsonIfPresent(files.deletionIntent),
    readJsonIfPresent(files.tombstone),
  ]);
  const intent =
    intentValue === null
      ? null
      : normalizeRecoveryDeletionEvidence(intentValue, state, "intent");
  const tombstone =
    tombstoneValue === null
      ? null
      : normalizeRecoveryDeletionEvidence(tombstoneValue, state, "tombstone");
  if (intent && tombstone && !sameDeletionBinding(intent, tombstone))
    throw new Error(
      "filesystem quarantine recovery deletion evidence conflicts",
    );

  if (tombstone) {
    if (
      (await exists(files.part)) ||
      (await exists(files.blob)) ||
      (await exists(files.metadata))
    )
      throw new Error("filesystem quarantine tombstone conflicts with debris");
    await removeRecoveryTemporaryFiles(temporaryFiles);
    return "tombstoned";
  }
  if (intent) {
    await removeRecoveryTemporaryFiles(temporaryFiles);
    return "pending-deletion";
  }
  if (await exists(files.metadata)) {
    const persisted = await readMetadata(state, `quarantine:${artifactId}`);
    await verifyBlob(persisted.files, persisted.metadata);
    await unlinkIfPresent(files.part);
    if (await exists(files.part))
      throw new Error("filesystem quarantine partial cleanup failed");
    await removeRecoveryTemporaryFiles(temporaryFiles);
    return "verified-artifact";
  }

  await unlinkIfPresent(files.part);
  await unlinkIfPresent(files.blob);
  await removeRecoveryTemporaryFiles(temporaryFiles);
  if ((await exists(files.part)) || (await exists(files.blob)))
    throw new Error("filesystem quarantine orphan cleanup failed");
  return "removed-orphan";
}

async function recoverInterruptedArtifacts(state) {
  await prepare(state);
  const discovered = await discoverRecoveryState(state);
  let recoveredArtifacts = 0;
  let activeArtifacts = 0;
  for (const artifactId of [...discovered.candidates].sort()) {
    let releaseLock;
    try {
      releaseLock = await acquireArtifactLock(state, artifactId, "recover");
    } catch (error) {
      if (error?.code === "BROWSER_FILESYSTEM_QUARANTINE_ARTIFACT_LOCKED") {
        activeArtifacts += 1;
        continue;
      }
      throw error;
    }
    try {
      await reconcileArtifactDebris(state, artifactId, [
        ...(discovered.temporaryFiles.get(artifactId) ?? []),
      ]);
      recoveredArtifacts += 1;
    } finally {
      await releaseLock();
    }
  }
  return Object.freeze({ recoveredArtifacts, activeArtifacts });
}

async function ensureRecovered(state) {
  await prepare(state);
  if (!state.recoveryPromise) {
    state.recoveryPromise = recoverInterruptedArtifacts(state).then(
      (report) => {
        if (report.activeArtifacts > 0) state.recoveryPromise = null;
        return report;
      },
      (error) => {
        state.recoveryPromise = null;
        throw error;
      },
    );
  }
  return state.recoveryPromise;
}

async function readMetadata(state, artifactRef) {
  const artifactId = artifactIdFromRef(artifactRef);
  const files = pathsFor(state.stateRoot, artifactId);
  const parsed = JSON.parse(await readFile(files.metadata, "utf8"));
  const metadata = normalizeMetadata(parsed, state.descriptor);
  if (metadata.artifactRef !== artifactRef)
    throw new Error("filesystem quarantine metadata reference mismatch");
  return Object.freeze({ files, metadata });
}

async function verifyBlob(files, metadata) {
  const info = await stat(files.blob);
  if (!info.isFile() || info.size !== metadata.sizeBytes)
    throw new Error("filesystem quarantine blob size differs from metadata");
  const observed = await hashFile(files.blob);
  if (
    observed.sizeBytes !== metadata.sizeBytes ||
    observed.artifactDigest !== metadata.artifactDigest
  )
    throw new Error("filesystem quarantine blob digest differs from metadata");
}

function normalizeOpenInput(value, descriptor) {
  exact(
    value,
    [
      "artifactId",
      "tenantId",
      "maxBytes",
      "contentType",
      "networkReceiptDigest",
      "actionReceiptDigest",
    ],
    "filesystem quarantine open request",
  );
  if (
    !ARTIFACT_ID.test(value.artifactId) ||
    value.tenantId !== descriptor.tenantId ||
    !Number.isSafeInteger(value.maxBytes) ||
    value.maxBytes < 1 ||
    value.maxBytes > MAX_BYTES ||
    !CONTENT_TYPE.test(value.contentType) ||
    !DIGEST.test(value.networkReceiptDigest) ||
    !DIGEST.test(value.actionReceiptDigest)
  )
    throw new TypeError("filesystem quarantine open request is invalid");
  return Object.freeze({ ...value });
}

async function openQuarantine(state, value) {
  const input = normalizeOpenInput(value, state.descriptor);
  await ensureRecovered(state);
  const releaseLock = await acquireArtifactLock(
    state,
    input.artifactId,
    "write",
  );
  const files = pathsFor(state.stateRoot, input.artifactId);
  let handle;
  try {
    await reconcileArtifactDebris(
      state,
      input.artifactId,
      await findArtifactTemporaryFiles(state, input.artifactId),
    );
    if (state.active.has(input.artifactId))
      throw new Error("filesystem quarantine artifact is already active");
    if (
      (await exists(files.blob)) ||
      (await exists(files.metadata)) ||
      (await exists(files.deletionIntent)) ||
      (await exists(files.tombstone))
    )
      throw new Error("filesystem quarantine artifact already exists");
    handle = await open(files.part, "wx", 0o600);
  } catch (error) {
    await releaseLock().catch(() => {});
    throw error;
  }
  const session = {
    handle,
    state: "writing",
    sizeBytes: 0,
  };
  state.active.add(input.artifactId);
  const cleanup = async () => {
    if (session.handle) {
      await session.handle.close().catch(() => {});
      session.handle = null;
    }
    const failures = [];
    for (const file of [files.part, files.blob, files.metadata]) {
      try {
        await unlinkIfPresent(file);
        if (await exists(file))
          throw new Error("filesystem quarantine cleanup readback failed");
      } catch (error) {
        failures.push(error);
      }
    }
    state.active.delete(input.artifactId);
    try {
      await releaseLock();
    } catch (error) {
      failures.push(error);
    }
    session.state = failures.length === 0 ? "discarded" : "uncertain";
    if (failures.length > 0)
      throw new Error("filesystem quarantine cleanup failed", {
        cause: failures[0],
      });
  };
  return Object.freeze({
    writeChunk: async (chunk) => {
      if (
        session.state !== "writing" ||
        !(chunk instanceof Uint8Array) ||
        types.isProxy(chunk) ||
        chunk.byteLength < 1 ||
        chunk.byteLength > input.maxBytes - session.sizeBytes
      )
        throw new Error("filesystem quarantine chunk is invalid or oversized");
      const buffer = Buffer.from(chunk);
      let offset = 0;
      while (offset < buffer.byteLength) {
        const { bytesWritten } = await session.handle.write(
          buffer,
          offset,
          buffer.byteLength - offset,
          null,
        );
        if (!Number.isSafeInteger(bytesWritten) || bytesWritten < 1)
          throw new Error("filesystem quarantine write made no progress");
        offset += bytesWritten;
      }
      session.sizeBytes += buffer.byteLength;
    },
    commitArtifact: async (streamed) => {
      exact(
        streamed,
        ["artifactDigest", "sizeBytes", "contentType"],
        "filesystem quarantine streamed artifact",
      );
      if (
        session.state !== "writing" ||
        !DIGEST.test(streamed.artifactDigest) ||
        streamed.sizeBytes !== session.sizeBytes ||
        streamed.sizeBytes < 1 ||
        streamed.sizeBytes > input.maxBytes ||
        streamed.contentType !== input.contentType
      )
        throw new Error("filesystem quarantine streamed artifact is invalid");
      session.state = "committing";
      try {
        await session.handle.sync();
        await session.handle.close();
        session.handle = null;
        await rename(files.part, files.blob);
        const observed = await hashFile(files.blob);
        if (
          observed.sizeBytes !== streamed.sizeBytes ||
          observed.artifactDigest !== streamed.artifactDigest
        )
          throw new Error("filesystem quarantine commit readback failed");
        const committedAtMs = state.now();
        const expiresAtMs = committedAtMs + state.descriptor.retentionMs;
        if (
          !Number.isFinite(committedAtMs) ||
          !Number.isSafeInteger(expiresAtMs)
        )
          throw new Error("filesystem quarantine clock is invalid");
        const committedAt = new Date(committedAtMs).toISOString();
        const expiresAt = new Date(expiresAtMs).toISOString();
        const artifactRef = `quarantine:${input.artifactId}`;
        const receiptCore = Object.freeze({
          custodyId: state.descriptor.custodyId,
          tenantId: state.descriptor.tenantId,
          handlerArtifactDigest: state.descriptor.handlerArtifactDigest,
          artifactRef,
          artifactDigest: streamed.artifactDigest,
          sizeBytes: streamed.sizeBytes,
          contentType: streamed.contentType,
          networkReceiptDigest: input.networkReceiptDigest,
          sourceActionReceiptDigest: input.actionReceiptDigest,
          committedAt,
          expiresAt,
        });
        const quarantineReceiptDigest = digest(
          "chainlesschain.browser-filesystem-quarantine-commit/v1",
          receiptCore,
        );
        const metadata = Object.freeze({
          schema: BROWSER_FILESYSTEM_QUARANTINE_METADATA_SCHEMA,
          custodyId: state.descriptor.custodyId,
          tenantId: state.descriptor.tenantId,
          artifactRef,
          artifactDigest: streamed.artifactDigest,
          sizeBytes: streamed.sizeBytes,
          contentType: streamed.contentType,
          networkReceiptDigest: input.networkReceiptDigest,
          sourceActionReceiptDigest: input.actionReceiptDigest,
          status: "quarantined",
          committedAt,
          expiresAt,
          quarantineReceiptDigest,
          scanEvidenceDigest: null,
          completedAt: null,
          completionReceiptDigest: null,
        });
        await writeMetadata(files.metadata, metadata);
        const persisted = await readMetadata(state, artifactRef);
        await verifyBlob(files, persisted.metadata);
        session.state = "committed";
        state.active.delete(input.artifactId);
        await releaseLock();
        return Object.freeze({
          schema: QUARANTINE_COMMIT_ACK_SCHEMA,
          artifactRef,
          artifactDigest: streamed.artifactDigest,
          sizeBytes: streamed.sizeBytes,
          contentType: streamed.contentType,
          quarantineReceiptDigest,
          authenticated: true,
          durable: true,
          readbackVerified: true,
        });
      } catch (error) {
        await cleanup().catch((cleanupError) => {
          throw new Error("filesystem quarantine commit cleanup failed", {
            cause: cleanupError,
          });
        });
        throw error;
      }
    },
    discardArtifact: async () => {
      await cleanup();
    },
  });
}

async function openArtifactForScan(state, value) {
  exact(
    value,
    [
      "artifactRef",
      "artifactDigest",
      "sizeBytes",
      "contentType",
      "quarantineReceiptDigest",
    ],
    "filesystem quarantine scan request",
  );
  await ensureRecovered(state);
  const persisted = await readMetadata(state, value.artifactRef);
  const metadata = persisted.metadata;
  if (
    metadata.status !== "quarantined" ||
    metadata.artifactDigest !== value.artifactDigest ||
    metadata.sizeBytes !== value.sizeBytes ||
    metadata.contentType !== value.contentType ||
    metadata.quarantineReceiptDigest !== value.quarantineReceiptDigest
  )
    throw new Error("filesystem quarantine scan request differs from custody");
  await verifyBlob(persisted.files, metadata);
  const artifactId = artifactIdFromRef(value.artifactRef);
  return Object.freeze({
    artifactRef: metadata.artifactRef,
    artifactDigest: metadata.artifactDigest,
    sizeBytes: metadata.sizeBytes,
    contentType: metadata.contentType,
    body: pathlessBody(state, artifactId, persisted.files.blob, metadata),
  });
}

async function completeArtifact(state, value) {
  exact(
    value,
    [
      "artifactRef",
      "artifactDigest",
      "sizeBytes",
      "contentType",
      "networkReceiptDigest",
      "quarantineReceiptDigest",
      "scanEvidenceDigest",
      "completedAt",
    ],
    "filesystem quarantine completion request",
  );
  if (
    !ARTIFACT_REF.test(value.artifactRef) ||
    !DIGEST.test(value.artifactDigest) ||
    !Number.isSafeInteger(value.sizeBytes) ||
    value.sizeBytes < 1 ||
    !CONTENT_TYPE.test(value.contentType) ||
    !DIGEST.test(value.networkReceiptDigest) ||
    !DIGEST.test(value.quarantineReceiptDigest) ||
    !DIGEST.test(value.scanEvidenceDigest) ||
    !Number.isFinite(Date.parse(value.completedAt))
  )
    throw new TypeError("filesystem quarantine completion request is invalid");
  await ensureRecovered(state);
  const artifactId = artifactIdFromRef(value.artifactRef);
  if (state.disposals.has(artifactId))
    throw new Error("filesystem quarantine artifact disposal is active");
  if (state.completions.has(artifactId))
    throw new Error("filesystem quarantine artifact completion is active");
  state.completions.add(artifactId);
  let releaseLock = null;
  try {
    releaseLock = await acquireArtifactLock(state, artifactId, "complete");
    const persisted = await readMetadata(state, value.artifactRef);
    const metadata = persisted.metadata;
    if (
      metadata.status !== "quarantined" ||
      metadata.artifactDigest !== value.artifactDigest ||
      metadata.sizeBytes !== value.sizeBytes ||
      metadata.contentType !== value.contentType ||
      metadata.networkReceiptDigest !== value.networkReceiptDigest ||
      metadata.quarantineReceiptDigest !== value.quarantineReceiptDigest ||
      Date.parse(value.completedAt) < Date.parse(metadata.committedAt) ||
      Date.parse(value.completedAt) >= Date.parse(metadata.expiresAt)
    )
      throw new Error("filesystem quarantine completion differs from custody");
    await verifyBlob(persisted.files, metadata);
    const completionCore = Object.freeze({
      custodyId: state.descriptor.custodyId,
      tenantId: state.descriptor.tenantId,
      handlerArtifactDigest: state.descriptor.handlerArtifactDigest,
      artifactRef: value.artifactRef,
      artifactDigest: value.artifactDigest,
      scanEvidenceDigest: value.scanEvidenceDigest,
      completedAt: value.completedAt,
    });
    const completionReceiptDigest = digest(
      "chainlesschain.browser-filesystem-quarantine-completion/v1",
      completionCore,
    );
    const completed = Object.freeze({
      ...metadata,
      status: "ready",
      scanEvidenceDigest: value.scanEvidenceDigest,
      completedAt: value.completedAt,
      completionReceiptDigest,
    });
    await writeMetadata(persisted.files.metadata, completed);
    const readback = await readMetadata(state, value.artifactRef);
    if (
      readback.metadata.status !== "ready" ||
      readback.metadata.completionReceiptDigest !== completionReceiptDigest
    )
      throw new Error("filesystem quarantine completion readback failed");
    await verifyBlob(readback.files, readback.metadata);
    return Object.freeze({
      schema: COMPLETION_ACK_SCHEMA,
      artifactRef: value.artifactRef,
      artifactDigest: value.artifactDigest,
      scanEvidenceDigest: value.scanEvidenceDigest,
      completionReceiptDigest,
      authenticated: true,
      durable: true,
      readbackVerified: true,
    });
  } finally {
    state.completions.delete(artifactId);
    if (releaseLock) await releaseLock();
  }
}

async function inspectArtifact(state, artifactRef) {
  await ensureRecovered(state);
  const persisted = await readMetadata(state, artifactRef);
  await verifyBlob(persisted.files, persisted.metadata);
  const { metadata } = persisted;
  return Object.freeze({
    artifactRefDigest: digest(
      "chainlesschain.browser-download-artifact-ref/v1",
      metadata.artifactRef,
    ),
    artifactDigest: metadata.artifactDigest,
    sizeBytes: metadata.sizeBytes,
    contentType: metadata.contentType,
    sourceActionReceiptDigest: metadata.sourceActionReceiptDigest,
    status: metadata.status,
    committedAt: metadata.committedAt,
    expiresAt: metadata.expiresAt,
    quarantineReceiptDigest: metadata.quarantineReceiptDigest,
    scanEvidenceDigest: metadata.scanEvidenceDigest,
    completedAt: metadata.completedAt,
    completionReceiptDigest: metadata.completionReceiptDigest,
  });
}

function normalizeDisposalDescriptor(value, custodyDescriptor) {
  exact(
    value,
    [
      "schema",
      "authorityId",
      "tenantId",
      "handlerArtifactDigest",
      "policyRevision",
      "maxGrantTtlMs",
      "approvalMode",
      "auditMode",
      "effectMode",
    ],
    "filesystem quarantine disposal descriptor",
  );
  if (
    value.schema !== DISPOSAL_DESCRIPTOR_SCHEMA ||
    !ID.test(value.authorityId) ||
    value.tenantId !== custodyDescriptor.tenantId ||
    value.handlerArtifactDigest !== custodyDescriptor.handlerArtifactDigest ||
    !ID.test(value.policyRevision) ||
    !Number.isSafeInteger(value.maxGrantTtlMs) ||
    value.maxGrantTtlMs < 1 ||
    value.maxGrantTtlMs > 30_000 ||
    value.approvalMode !== "interactive" ||
    value.auditMode !== "authenticated-durable-readback" ||
    value.effectMode !== "irreversible-byte-disposal"
  )
    throw new TypeError("filesystem quarantine disposal descriptor is invalid");
  return Object.freeze({ ...value });
}

function normalizeRetentionDescriptor(value, custodyDescriptor) {
  exact(
    value,
    [
      "schema",
      "authorityId",
      "tenantId",
      "handlerArtifactDigest",
      "policyRevision",
      "maxBatchSize",
      "maxGrantTtlMs",
      "auditMode",
      "effectMode",
    ],
    "filesystem quarantine retention descriptor",
  );
  if (
    value.schema !==
      BROWSER_FILESYSTEM_QUARANTINE_RETENTION_DESCRIPTOR_SCHEMA ||
    !ID.test(value.authorityId) ||
    value.tenantId !== custodyDescriptor.tenantId ||
    value.handlerArtifactDigest !== custodyDescriptor.handlerArtifactDigest ||
    !ID.test(value.policyRevision) ||
    !Number.isSafeInteger(value.maxBatchSize) ||
    value.maxBatchSize < 1 ||
    value.maxBatchSize > 256 ||
    !Number.isSafeInteger(value.maxGrantTtlMs) ||
    value.maxGrantTtlMs < 1 ||
    value.maxGrantTtlMs > 30_000 ||
    value.auditMode !== "authenticated-durable-readback" ||
    value.effectMode !== "irreversible-expiry-disposal"
  )
    throw new TypeError(
      "filesystem quarantine retention descriptor is invalid",
    );
  return Object.freeze({ ...value });
}

function normalizeOperatorRevocationDescriptor(value, custodyDescriptor) {
  exact(
    value,
    [
      "schema",
      "authorityId",
      "tenantId",
      "handlerArtifactDigest",
      "policyRevision",
      "maxGrantTtlMs",
      "approvalMode",
      "auditMode",
      "effectMode",
    ],
    "filesystem quarantine operator revocation descriptor",
  );
  if (
    value.schema !==
      BROWSER_FILESYSTEM_QUARANTINE_OPERATOR_REVOCATION_DESCRIPTOR_SCHEMA ||
    !ID.test(value.authorityId) ||
    value.tenantId !== custodyDescriptor.tenantId ||
    value.handlerArtifactDigest !== custodyDescriptor.handlerArtifactDigest ||
    !ID.test(value.policyRevision) ||
    !Number.isSafeInteger(value.maxGrantTtlMs) ||
    value.maxGrantTtlMs < 1 ||
    value.maxGrantTtlMs > 30_000 ||
    value.approvalMode !== "operator-signed" ||
    value.auditMode !== "authenticated-durable-readback" ||
    value.effectMode !== "irreversible-byte-revocation"
  )
    throw new TypeError(
      "filesystem quarantine operator revocation descriptor is invalid",
    );
  return Object.freeze({ ...value });
}

function normalizeExpiryPlanInput(value, retentionDescriptor, nowMs) {
  exact(
    value,
    ["sweepId", "cutoffAt", "maxArtifacts"],
    "filesystem quarantine expiry plan request",
  );
  const cutoffMs = Date.parse(value.cutoffAt);
  if (
    !ID.test(value.sweepId) ||
    !Number.isFinite(cutoffMs) ||
    new Date(cutoffMs).toISOString() !== value.cutoffAt ||
    cutoffMs > nowMs ||
    !Number.isSafeInteger(value.maxArtifacts) ||
    value.maxArtifacts < 1 ||
    value.maxArtifacts > retentionDescriptor.maxBatchSize
  )
    throw new TypeError("filesystem quarantine expiry plan request is invalid");
  return Object.freeze({ ...value, cutoffMs });
}

async function planExpiredArtifacts(state, retentionDescriptor, value) {
  await ensureRecovered(state);
  const nowMs = state.now();
  if (!Number.isFinite(nowMs))
    throw new Error("filesystem quarantine clock is invalid");
  const input = normalizeExpiryPlanInput(value, retentionDescriptor, nowMs);
  const artifacts = [];
  const entries = (await readdir(state.metadataRoot, { withFileTypes: true }))
    .filter((entry) => METADATA_FILE.test(entry.name))
    .sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    if (!entry.isFile())
      throw new Error("filesystem quarantine metadata entry is unsafe");
    const artifactId = METADATA_FILE.exec(entry.name)?.[1];
    if (!artifactId)
      throw new Error("filesystem quarantine metadata entry is invalid");
    const artifactRef = `quarantine:${artifactId}`;
    const persisted = await readMetadata(state, artifactRef);
    const expiresAtMs = Date.parse(persisted.metadata.expiresAt);
    if (expiresAtMs > input.cutoffMs || expiresAtMs > nowMs) continue;
    await verifyBlob(persisted.files, persisted.metadata);
    artifacts.push(
      Object.freeze({
        artifactRef,
        artifactRefDigest: digest(
          "chainlesschain.browser-download-artifact-ref/v1",
          artifactRef,
        ),
        artifactDigest: persisted.metadata.artifactDigest,
        sourceActionReceiptDigest: persisted.metadata.sourceActionReceiptDigest,
        expiresAt: persisted.metadata.expiresAt,
      }),
    );
    if (artifacts.length === input.maxArtifacts) break;
  }
  const core = Object.freeze({
    schema: BROWSER_FILESYSTEM_QUARANTINE_EXPIRY_PLAN_SCHEMA,
    custodyId: state.descriptor.custodyId,
    authorityId: retentionDescriptor.authorityId,
    tenantId: retentionDescriptor.tenantId,
    handlerArtifactDigest: retentionDescriptor.handlerArtifactDigest,
    policyRevision: retentionDescriptor.policyRevision,
    sweepId: input.sweepId,
    cutoffAt: value.cutoffAt,
    plannedAt: new Date(nowMs).toISOString(),
    artifacts: Object.freeze(artifacts),
  });
  return Object.freeze({
    ...core,
    planDigest: digest(BROWSER_FILESYSTEM_QUARANTINE_EXPIRY_PLAN_SCHEMA, core),
  });
}

function normalizeExpiredDisposalInput(value) {
  exact(
    value,
    [
      "sweepReceiptDigest",
      "planDigest",
      "sweepId",
      "cutoffAt",
      "artifactRef",
      "artifactRefDigest",
      "artifactDigest",
      "sourceActionReceiptDigest",
      "expiresAt",
    ],
    "filesystem quarantine expired artifact disposal request",
  );
  const cutoffMs = Date.parse(value.cutoffAt);
  const expiresAtMs = Date.parse(value.expiresAt);
  if (
    !DIGEST.test(value.sweepReceiptDigest) ||
    !DIGEST.test(value.planDigest) ||
    !ID.test(value.sweepId) ||
    !Number.isFinite(cutoffMs) ||
    new Date(cutoffMs).toISOString() !== value.cutoffAt ||
    !ARTIFACT_REF.test(value.artifactRef) ||
    value.artifactRefDigest !==
      digest(
        "chainlesschain.browser-download-artifact-ref/v1",
        value.artifactRef,
      ) ||
    !DIGEST.test(value.artifactDigest) ||
    !DIGEST.test(value.sourceActionReceiptDigest) ||
    !Number.isFinite(expiresAtMs) ||
    new Date(expiresAtMs).toISOString() !== value.expiresAt ||
    expiresAtMs > cutoffMs
  )
    throw new TypeError(
      "filesystem quarantine expired artifact disposal request is invalid",
    );
  return Object.freeze({ ...value, cutoffMs, expiresAtMs });
}

async function disposeExpiredArtifact(state, retentionDescriptor, input) {
  await ensureRecovered(state);
  const nowMs = state.now();
  if (!Number.isFinite(nowMs) || input.cutoffMs > nowMs)
    throw new Error("filesystem quarantine expiry cutoff is not current");
  try {
    const persisted = await readMetadata(state, input.artifactRef);
    if (
      persisted.metadata.artifactDigest !== input.artifactDigest ||
      persisted.metadata.sourceActionReceiptDigest !==
        input.sourceActionReceiptDigest ||
      persisted.metadata.expiresAt !== input.expiresAt ||
      input.expiresAtMs > nowMs
    )
      throw new Error("filesystem quarantine expiry differs from custody");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const requestCore = Object.freeze({
    authorityId: retentionDescriptor.authorityId,
    tenantId: retentionDescriptor.tenantId,
    handlerArtifactDigest: retentionDescriptor.handlerArtifactDigest,
    policyRevision: retentionDescriptor.policyRevision,
    sweepReceiptDigest: input.sweepReceiptDigest,
    planDigest: input.planDigest,
    sweepId: input.sweepId,
    cutoffAt: input.cutoffAt,
    artifactRef: input.artifactRef,
    artifactDigest: input.artifactDigest,
    sourceActionReceiptDigest: input.sourceActionReceiptDigest,
    expiresAt: input.expiresAt,
  });
  return disposeArtifact(
    state,
    retentionDescriptor,
    Object.freeze({
      actionReceiptDigest: input.sweepReceiptDigest,
      requestDigest: digest(
        "chainlesschain.browser-filesystem-quarantine-expired-disposal/v1",
        requestCore,
      ),
      artifactRef: input.artifactRef,
      artifactDigest: input.artifactDigest,
      sourceActionReceiptDigest: input.sourceActionReceiptDigest,
      reason: "expired",
    }),
  );
}

function normalizeDisposalInput(value) {
  exact(
    value,
    [
      "actionReceiptDigest",
      "requestDigest",
      "artifactRef",
      "artifactDigest",
      "sourceActionReceiptDigest",
      "reason",
    ],
    "filesystem quarantine disposal request",
  );
  if (
    !DIGEST.test(value.actionReceiptDigest) ||
    !DIGEST.test(value.requestDigest) ||
    !ARTIFACT_REF.test(value.artifactRef) ||
    !DIGEST.test(value.artifactDigest) ||
    !DIGEST.test(value.sourceActionReceiptDigest) ||
    !DISPOSAL_REASONS.has(value.reason)
  )
    throw new TypeError("filesystem quarantine disposal request is invalid");
  return Object.freeze({ ...value });
}

function deletionBinding(descriptor, input) {
  return Object.freeze({
    custodyId: descriptor.custodyId,
    tenantId: descriptor.tenantId,
    authorityId: input.authorityId,
    handlerArtifactDigest: descriptor.handlerArtifactDigest,
    actionReceiptDigest: input.actionReceiptDigest,
    requestDigest: input.requestDigest,
    artifactRef: input.artifactRef,
    artifactDigest: input.artifactDigest,
    sourceActionReceiptDigest: input.sourceActionReceiptDigest,
    reason: input.reason,
  });
}

function normalizeDeletionIntent(value, state, disposalDescriptor, input) {
  const keys = [
    "schema",
    "custodyId",
    "tenantId",
    "authorityId",
    "handlerArtifactDigest",
    "actionReceiptDigest",
    "requestDigest",
    "artifactRef",
    "artifactDigest",
    "sourceActionReceiptDigest",
    "reason",
    "startedAt",
    "intentDigest",
  ];
  exact(value, keys, "filesystem quarantine deletion intent");
  const binding = deletionBinding(state.descriptor, {
    ...input,
    authorityId: disposalDescriptor.authorityId,
  });
  const core = Object.freeze({
    schema: BROWSER_FILESYSTEM_QUARANTINE_DELETION_INTENT_SCHEMA,
    ...binding,
    startedAt: value.startedAt,
  });
  if (
    value.schema !== core.schema ||
    keys.slice(1, -2).some((key) => value[key] !== core[key]) ||
    !Number.isFinite(Date.parse(value.startedAt)) ||
    value.intentDigest !==
      digest(BROWSER_FILESYSTEM_QUARANTINE_DELETION_INTENT_SCHEMA, core)
  )
    throw new Error("filesystem quarantine deletion intent is invalid");
  return Object.freeze({ ...value });
}

function normalizeTombstone(value, state, disposalDescriptor, input) {
  const keys = [
    "schema",
    "custodyId",
    "tenantId",
    "authorityId",
    "handlerArtifactDigest",
    "actionReceiptDigest",
    "requestDigest",
    "artifactRef",
    "artifactDigest",
    "sourceActionReceiptDigest",
    "reason",
    "discardedAt",
    "deletionReceiptDigest",
  ];
  exact(value, keys, "filesystem quarantine tombstone");
  const binding = deletionBinding(state.descriptor, {
    ...input,
    authorityId: disposalDescriptor.authorityId,
  });
  const core = Object.freeze({
    schema: BROWSER_FILESYSTEM_QUARANTINE_TOMBSTONE_SCHEMA,
    ...binding,
    discardedAt: value.discardedAt,
  });
  if (
    value.schema !== core.schema ||
    keys.slice(1, -2).some((key) => value[key] !== core[key]) ||
    !Number.isFinite(Date.parse(value.discardedAt)) ||
    value.deletionReceiptDigest !==
      digest(BROWSER_FILESYSTEM_QUARANTINE_TOMBSTONE_SCHEMA, core)
  )
    throw new Error("filesystem quarantine tombstone is invalid");
  return Object.freeze({ ...value });
}

async function readJsonIfPresent(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function deletionAck(disposalDescriptor, tombstone) {
  return Object.freeze({
    schema: DELETION_ACK_SCHEMA,
    authorityId: disposalDescriptor.authorityId,
    tenantId: disposalDescriptor.tenantId,
    handlerArtifactDigest: disposalDescriptor.handlerArtifactDigest,
    actionReceiptDigest: tombstone.actionReceiptDigest,
    requestDigest: tombstone.requestDigest,
    artifactRef: tombstone.artifactRef,
    artifactDigest: tombstone.artifactDigest,
    sourceActionReceiptDigest: tombstone.sourceActionReceiptDigest,
    discardedAt: tombstone.discardedAt,
    deletionReceiptDigest: tombstone.deletionReceiptDigest,
    authenticated: true,
    durable: true,
    readbackVerified: true,
    bytesUnavailable: true,
    qualifiesForPromotion: false,
  });
}

async function disposeArtifact(state, disposalDescriptor, value) {
  const input = normalizeDisposalInput(value);
  await ensureRecovered(state);
  const artifactId = artifactIdFromRef(input.artifactRef);
  if (state.disposals.has(artifactId))
    throw new Error(
      "filesystem quarantine artifact disposal is already active",
    );
  if (state.completions.has(artifactId))
    throw new Error("filesystem quarantine artifact completion is active");
  if ((state.readers.get(artifactId) ?? 0) > 0)
    throw new Error("filesystem quarantine artifact has active scan readers");
  state.disposals.add(artifactId);
  let releaseLock = null;
  try {
    releaseLock = await acquireArtifactLock(state, artifactId, "dispose");
    return await disposeArtifactExclusive(
      state,
      disposalDescriptor,
      input,
      artifactId,
    );
  } finally {
    state.disposals.delete(artifactId);
    if (releaseLock) await releaseLock();
  }
}

async function disposeArtifactExclusive(
  state,
  disposalDescriptor,
  input,
  artifactId,
) {
  const files = pathsFor(state.stateRoot, artifactId);
  const existingTombstone = await readJsonIfPresent(files.tombstone);
  if (existingTombstone !== null) {
    const tombstone = normalizeTombstone(
      existingTombstone,
      state,
      disposalDescriptor,
      input,
    );
    const existingIntent = await readJsonIfPresent(files.deletionIntent);
    if (existingIntent !== null)
      normalizeDeletionIntent(existingIntent, state, disposalDescriptor, input);
    if (
      (await exists(files.part)) ||
      (await exists(files.blob)) ||
      (await exists(files.metadata))
    )
      throw new Error("filesystem quarantine tombstone conflicts with bytes");
    await unlinkIfPresent(files.deletionIntent);
    if (await exists(files.deletionIntent))
      throw new Error("filesystem quarantine deletion intent cleanup failed");
    return deletionAck(disposalDescriptor, tombstone);
  }

  let intentValue = await readJsonIfPresent(files.deletionIntent);
  let intent;
  if (intentValue === null) {
    const persisted = await readMetadata(state, input.artifactRef);
    if (
      persisted.metadata.artifactDigest !== input.artifactDigest ||
      persisted.metadata.sourceActionReceiptDigest !==
        input.sourceActionReceiptDigest
    )
      throw new Error("filesystem quarantine disposal differs from custody");
    const startedAtMs = state.now();
    if (!Number.isFinite(startedAtMs))
      throw new Error("filesystem quarantine clock is invalid");
    const binding = deletionBinding(state.descriptor, {
      ...input,
      authorityId: disposalDescriptor.authorityId,
    });
    const core = Object.freeze({
      schema: BROWSER_FILESYSTEM_QUARANTINE_DELETION_INTENT_SCHEMA,
      ...binding,
      startedAt: new Date(startedAtMs).toISOString(),
    });
    intentValue = Object.freeze({
      ...core,
      intentDigest: digest(
        BROWSER_FILESYSTEM_QUARANTINE_DELETION_INTENT_SCHEMA,
        core,
      ),
    });
    try {
      await writeNewMetadata(files.deletionIntent, intentValue);
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      intentValue = await readJsonIfPresent(files.deletionIntent);
      if (intentValue === null)
        throw new Error("filesystem quarantine deletion intent is uncertain");
    }
  }
  intent = normalizeDeletionIntent(
    intentValue,
    state,
    disposalDescriptor,
    input,
  );

  for (const file of [files.part, files.blob, files.metadata])
    await unlinkIfPresent(file);
  if (
    (await exists(files.part)) ||
    (await exists(files.blob)) ||
    (await exists(files.metadata))
  )
    throw new Error("filesystem quarantine deletion readback failed");

  const binding = deletionBinding(state.descriptor, {
    ...input,
    authorityId: disposalDescriptor.authorityId,
  });
  const tombstoneCore = Object.freeze({
    schema: BROWSER_FILESYSTEM_QUARANTINE_TOMBSTONE_SCHEMA,
    ...binding,
    discardedAt: intent.startedAt,
  });
  const tombstoneValue = Object.freeze({
    ...tombstoneCore,
    deletionReceiptDigest: digest(
      BROWSER_FILESYSTEM_QUARANTINE_TOMBSTONE_SCHEMA,
      tombstoneCore,
    ),
  });
  try {
    await writeNewMetadata(files.tombstone, tombstoneValue);
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
  const tombstone = normalizeTombstone(
    JSON.parse(await readFile(files.tombstone, "utf8")),
    state,
    disposalDescriptor,
    input,
  );
  await unlinkIfPresent(files.deletionIntent);
  if (
    (await exists(files.part)) ||
    (await exists(files.blob)) ||
    (await exists(files.metadata))
  )
    throw new Error("filesystem quarantine deletion durability is uncertain");
  return deletionAck(disposalDescriptor, tombstone);
}

export function createBrowserFilesystemQuarantineCustody({
  descriptor,
  stateRoot,
  now = Date.now,
} = {}) {
  const normalizedDescriptor = normalizeDescriptor(descriptor);
  if (typeof now !== "function" || types.isProxy(now))
    throw new TypeError("filesystem quarantine clock is invalid");
  const normalizedRoot = normalizeStateRoot(stateRoot);
  const custody = Object.freeze({});
  custodies.set(custody, {
    descriptor: normalizedDescriptor,
    stateRoot: normalizedRoot,
    objectsRoot: path.join(normalizedRoot, "objects"),
    metadataRoot: path.join(normalizedRoot, "metadata"),
    deletionsRoot: path.join(normalizedRoot, "deletions"),
    locksRoot: path.join(normalizedRoot, "locks"),
    now,
    preparePromise: null,
    recoveryPromise: null,
    active: new Set(),
    readers: new Map(),
    disposals: new Set(),
    completions: new Set(),
  });
  return custody;
}

export function captureBrowserFilesystemQuarantineCustody(value) {
  const state = custodies.get(value);
  if (!state)
    throw new TypeError("A branded filesystem quarantine custody is required");
  return Object.freeze({
    descriptor: state.descriptor,
    openQuarantine: async (input) => openQuarantine(state, input),
    openArtifactForScan: async (input) => openArtifactForScan(state, input),
    completeArtifact: async (input) => completeArtifact(state, input),
    inspectArtifact: async (artifactRef) => inspectArtifact(state, artifactRef),
    bindDisposalAuthority: (descriptor) => {
      const disposalDescriptor = normalizeDisposalDescriptor(
        descriptor,
        state.descriptor,
      );
      return async (input) => disposeArtifact(state, disposalDescriptor, input);
    },
    bindRetentionAuthority: (descriptor) => {
      const retentionDescriptor = normalizeRetentionDescriptor(
        descriptor,
        state.descriptor,
      );
      const issuedPlans = new Map();
      return Object.freeze({
        planExpiredArtifacts: async (input) => {
          const plan = await planExpiredArtifacts(
            state,
            retentionDescriptor,
            input,
          );
          issuedPlans.clear();
          if (plan.artifacts.length > 0)
            issuedPlans.set(plan.planDigest, {
              sweepId: plan.sweepId,
              cutoffAt: plan.cutoffAt,
              artifacts: new Map(
                plan.artifacts.map((artifact) => [
                  artifact.artifactRef,
                  artifact,
                ]),
              ),
            });
          return plan;
        },
        disposeExpiredArtifact: async (input) => {
          const normalizedInput = normalizeExpiredDisposalInput(input);
          const plan = issuedPlans.get(normalizedInput.planDigest);
          const artifact = plan?.artifacts.get(normalizedInput.artifactRef);
          if (
            !plan ||
            !artifact ||
            plan.sweepId !== normalizedInput.sweepId ||
            plan.cutoffAt !== normalizedInput.cutoffAt ||
            [
              "artifactRefDigest",
              "artifactDigest",
              "sourceActionReceiptDigest",
              "expiresAt",
            ].some((key) => artifact[key] !== normalizedInput[key])
          )
            throw new Error(
              "filesystem quarantine expiry disposal is not in the active plan",
            );
          const acknowledgement = await disposeExpiredArtifact(
            state,
            retentionDescriptor,
            normalizedInput,
          );
          plan.artifacts.delete(normalizedInput.artifactRef);
          if (plan.artifacts.size === 0)
            issuedPlans.delete(normalizedInput.planDigest);
          return acknowledgement;
        },
      });
    },
    bindOperatorRevocationAuthority: (descriptor) => {
      const revocationDescriptor = normalizeOperatorRevocationDescriptor(
        descriptor,
        state.descriptor,
      );
      return async (input) => {
        const normalized = normalizeDisposalInput(input);
        if (normalized.reason !== "revoked")
          throw new Error(
            "filesystem quarantine operator revocation reason is invalid",
          );
        return disposeArtifact(state, revocationDescriptor, normalized);
      };
    },
  });
}
