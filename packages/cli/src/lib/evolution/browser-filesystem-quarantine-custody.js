import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  lstat,
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

const QUARANTINE_COMMIT_ACK_SCHEMA =
  "chainlesschain.browser-download-quarantine-commit-ack/v1";
const COMPLETION_ACK_SCHEMA =
  "chainlesschain.browser-download-completion-ack/v1";
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const ID = /^[A-Za-z0-9._:-]{1,128}$/u;
const ARTIFACT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/u;
const ARTIFACT_REF = /^quarantine:[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/u;
const CONTENT_TYPE =
  /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/u;
const MAX_BYTES = 100 * 1024 * 1024;
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

function pathlessBody(file) {
  return Object.freeze({
    async *[Symbol.asyncIterator]() {
      const stream = createReadStream(file);
      try {
        for await (const chunk of stream) yield Buffer.from(chunk);
      } finally {
        stream.destroy();
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
  if ((await exists(files.blob)) || (await exists(files.metadata)))
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
  return Object.freeze({
    artifactRef: metadata.artifactRef,
    artifactDigest: metadata.artifactDigest,
    sizeBytes: metadata.sizeBytes,
    contentType: metadata.contentType,
    body: pathlessBody(persisted.files.blob),
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
    now,
    preparePromise: null,
    active: new Set(),
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
  });
}
