import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  lstat,
  link,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
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
const CONTENT_TYPE =
  /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/u;
const MAX_BYTES = 100 * 1024 * 1024;
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

function pathlessBody(state, artifactId, file) {
  return Object.freeze({
    async *[Symbol.asyncIterator]() {
      if (state.disposals.has(artifactId))
        throw new Error("filesystem quarantine artifact disposal is active");
      state.readers.set(artifactId, (state.readers.get(artifactId) ?? 0) + 1);
      const stream = createReadStream(file);
      try {
        for await (const chunk of stream) yield Buffer.from(chunk);
      } finally {
        stream.destroy();
        const remaining = (state.readers.get(artifactId) ?? 1) - 1;
        if (remaining === 0) state.readers.delete(artifactId);
        else state.readers.set(artifactId, remaining);
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
  await prepare(state);
  if (state.active.has(input.artifactId))
    throw new Error("filesystem quarantine artifact is already active");
  const files = pathsFor(state.stateRoot, input.artifactId);
  if (
    (await exists(files.blob)) ||
    (await exists(files.metadata)) ||
    (await exists(files.deletionIntent)) ||
    (await exists(files.tombstone))
  )
    throw new Error("filesystem quarantine artifact already exists");
  const handle = await open(files.part, "wx", 0o600);
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
  await prepare(state);
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
    body: pathlessBody(state, artifactId, persisted.files.blob),
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
  await prepare(state);
  const artifactId = artifactIdFromRef(value.artifactRef);
  if (state.disposals.has(artifactId))
    throw new Error("filesystem quarantine artifact disposal is active");
  if (state.completions.has(artifactId))
    throw new Error("filesystem quarantine artifact completion is active");
  state.completions.add(artifactId);
  try {
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
  }
}

async function inspectArtifact(state, artifactRef) {
  await prepare(state);
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
  await prepare(state);
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
  try {
    return await disposeArtifactExclusive(
      state,
      disposalDescriptor,
      input,
      artifactId,
    );
  } finally {
    state.disposals.delete(artifactId);
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
    now,
    preparePromise: null,
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
  });
}
