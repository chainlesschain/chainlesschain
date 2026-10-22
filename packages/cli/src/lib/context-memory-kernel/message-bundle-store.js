import fs, {
  constants as fsConstants,
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  linkSync,
  openSync,
  opendirSync,
  realpathSync,
  readdirSync,
  rmdirSync,
  unlinkSync,
} from "node:fs";
import { createHash } from "node:crypto";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import { TextDecoder } from "node:util";
import { canonicalJson } from "@chainlesschain/context-memory-kernel";
import {
  normalizeSessionGenerationAuthority,
  SESSION_GENERATION_AUTHORITY_SCHEMA,
} from "../../harness/session-list-index.js";
import { getSessionStoreDir } from "../paths.js";
import {
  ensurePrivateDirectory,
  ensurePrivateFile,
  PRIVATE_FILE_MODE,
} from "../secure-fs.js";
import { readBoundedArtifactFile } from "../bounded-artifact-file-read.js";
import { withFileLock } from "../with-file-lock.js";
import { AGENT_MODEL_IMAGE_LIMITS } from "../evolution/agent-model-projection.js";
import { inspectCanonicalImageDataUrl } from "../image-token-estimate.js";

export const SESSION_MESSAGE_BUNDLE_STORE = "cli-session-message-bundles-v1";
export const SESSION_MESSAGE_BUNDLE_MAX_INLINE_BYTES = 4 * 1024 * 1024;
export const SESSION_MESSAGE_BUNDLE_MAX_BLOB_BYTES = 56 * 1024 * 1024;

const STORE_DIRECTORY = ".context-message-bundles-v1";
const STORE_SCHEMA = "chainlesschain.cli-session-message-bundle-store/v1";
const PENDING_SCHEMA =
  "chainlesschain.cli-session-message-bundle-delete-pending/v1";
const DELETED_SCHEMA = "chainlesschain.cli-session-message-bundle-deleted/v1";
const MESSAGE_BUNDLE_SCHEMA = "chainlesschain.cli-context-message-bundle/v1";
const MAX_DIRECTORY_SWEEP = 32;
const LOCK_OPTIONS = Object.freeze({
  failIfUnavailable: true,
  timeoutMs: 30_000,
  retryMs: 1,
  maxRetryMs: 8,
  retryJitterMs: 4,
  yieldAfterReleaseMs: 2,
});
const FATAL_UTF8 = new TextDecoder("utf-8", { fatal: true });
const MAX_IMAGE_DATA_URL_CHARS =
  Math.ceil(AGENT_MODEL_IMAGE_LIMITS.maxImageBytes / 3) * 4 + 128;

function imageBundleError(
  message,
  code = "CC_SESSION_MESSAGE_BUNDLE_INVALID",
  cause,
) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  return error;
}

function canonicalPath(value) {
  return process.platform === "win32" ? value.toLowerCase() : value;
}

function isContained(parent, candidate) {
  const relation = relative(parent, candidate);
  return (
    relation === "" ||
    (!relation.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) &&
      relation !== ".." &&
      !isAbsolute(relation))
  );
}

function assertSessionId(sessionId) {
  if (
    typeof sessionId !== "string" ||
    sessionId.length === 0 ||
    sessionId.includes("/") ||
    sessionId.includes("\\") ||
    sessionId.includes("..") ||
    Buffer.byteLength(sessionId, "utf8") > 200
  ) {
    throw imageBundleError("Session message bundle requires a safe session id");
  }
  return sessionId;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function sessionHash(sessionId) {
  return sha256(Buffer.from(sessionId, "utf8"));
}

function objectIdFor(sessionId, generationId, digest) {
  return `bundle-${sha256(
    Buffer.from(
      `${sessionHash(sessionId)}\0${generationId}\0${digest}`,
      "utf8",
    ),
  )}`;
}

function canonicalSessionRoot(create) {
  const configured = resolve(getSessionStoreDir());
  if (!create && !existsSync(configured)) return null;
  ensurePrivateDirectory(configured, {
    applyWindowsAcl: create,
    failIfUnavailable: true,
  });
  const sessionRoot = realpathSync.native(configured);
  ensureDirectory(sessionRoot, "session store root", false);
  return sessionRoot;
}

function storePaths(create = false) {
  const sessionRoot = canonicalSessionRoot(create);
  if (!sessionRoot) return null;
  const root = join(sessionRoot, STORE_DIRECTORY);
  const paths = {
    sessionRoot,
    root,
    sessions: join(root, "sessions"),
    tombstones: join(root, "tombstones"),
    locks: join(root, "locks"),
  };
  if (create) {
    ensureDirectory(root, "message bundle store root", true);
    ensureDirectory(paths.sessions, "message bundle sessions root", true);
    ensureDirectory(paths.tombstones, "message bundle tombstones root", true);
    ensureDirectory(paths.locks, "message bundle locks root", true);
  } else if (!existsSync(root)) {
    return null;
  } else {
    ensureDirectory(root, "message bundle store root", false);
    ensureDirectory(paths.sessions, "message bundle sessions root", false);
    ensureDirectory(paths.tombstones, "message bundle tombstones root", false);
    ensureDirectory(paths.locks, "message bundle locks root", false);
  }
  return paths;
}

function ensureDirectory(target, label, create) {
  const wasMissing = create && !existsSync(target);
  if (create) {
    ensurePrivateDirectory(target, {
      applyWindowsAcl: true,
      failIfUnavailable: true,
    });
  }
  let stat;
  try {
    stat = lstatSync(target);
  } catch (cause) {
    throw imageBundleError(`${label} is unavailable`, undefined, cause);
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw imageBundleError(`${label} must be a real directory`);
  }
  const actual = realpathSync.native(target);
  if (canonicalPath(actual) !== canonicalPath(resolve(target))) {
    throw imageBundleError(`${label} is not physically canonical`);
  }
  if (wasMissing) fsyncDirectory(dirname(target));
  return target;
}

function sessionObjectsDir(paths, sessionId) {
  const hash = sessionHash(sessionId);
  return join(paths.sessions, hash, "objects");
}

function ensureSessionObjectsDir(paths, sessionId) {
  const sessionDir = join(paths.sessions, sessionHash(sessionId));
  const objectsDir = join(sessionDir, "objects");
  if (
    !isContained(paths.sessions, sessionDir) ||
    !isContained(paths.root, objectsDir)
  ) {
    throw imageBundleError("Message bundle path escaped its private store");
  }
  ensureDirectory(sessionDir, "message bundle session directory", true);
  ensureDirectory(objectsDir, "message bundle objects directory", true);
  return objectsDir;
}

function assertExistingSessionObjectsDir(paths, sessionId) {
  const objectsDir = sessionObjectsDir(paths, sessionId);
  if (
    !isContained(paths.sessions, dirname(objectsDir)) ||
    !isContained(paths.root, objectsDir)
  ) {
    throw imageBundleError("Message bundle path escaped its private store");
  }
  if (!existsSync(objectsDir)) return null;
  ensureDirectory(
    dirname(objectsDir),
    "message bundle session directory",
    false,
  );
  ensureDirectory(objectsDir, "message bundle objects directory", false);
  return objectsDir;
}

function fsyncDirectory(directory) {
  if (process.platform === "win32") return;
  const descriptor = openSync(
    directory,
    fsConstants.O_RDONLY |
      Number(fsConstants.O_DIRECTORY || 0) |
      Number(fsConstants.O_NOFOLLOW || 0),
  );
  try {
    if (!fs.fstatSync(descriptor).isDirectory()) {
      throw imageBundleError(
        "Message bundle durability parent is not a directory",
      );
    }
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function fsyncDirectoryAncestry(paths, objectsDir) {
  for (const directory of [
    objectsDir,
    dirname(objectsDir),
    paths.sessions,
    paths.root,
    paths.sessionRoot,
  ]) {
    fsyncDirectory(directory);
  }
}

function writeExclusiveFile(target, bytes) {
  const tempPath = join(dirname(target), `.${basename(target)}.tmp`);
  recoverTemporaryLink(target, tempPath);
  let descriptor = null;
  let preservePublishedPair = false;
  try {
    descriptor = openSync(
      tempPath,
      fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY,
      PRIVATE_FILE_MODE,
    );
    const payload = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes, "utf8");
    let offset = 0;
    while (offset < payload.length) {
      const written = fs.writeSync(
        descriptor,
        payload,
        offset,
        payload.length - offset,
      );
      if (written <= 0) {
        throw imageBundleError("Message bundle write made no forward progress");
      }
      offset += written;
    }
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = null;
    ensurePrivateFile(tempPath);
    try {
      linkSync(tempPath, target);
      preservePublishedPair = true;
    } catch (cause) {
      if (cause?.code !== "EEXIST") throw cause;
      return false;
    }
    fsyncDirectory(dirname(target));
    preservePublishedPair = false;
    unlinkSync(tempPath);
    fsyncDirectory(dirname(target));
    return true;
  } finally {
    if (descriptor !== null) closeSync(descriptor);
    if (existsSync(tempPath) && !preservePublishedPair) unlinkSync(tempPath);
  }
}

function safeReadSmallFile(filePath, maximumBytes) {
  const stat = lstatSync(filePath, { bigint: true });
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.nlink !== 1n ||
    stat.size < 1n ||
    stat.size > BigInt(maximumBytes)
  ) {
    throw imageBundleError("Message bundle store metadata is unsafe");
  }
  const bytes = readBoundedArtifactFile(
    filePath,
    Number(stat.size),
    maximumBytes,
  );
  return FATAL_UTF8.decode(bytes);
}

function readJsonFile(filePath, maximumBytes) {
  try {
    return JSON.parse(safeReadSmallFile(filePath, maximumBytes));
  } catch (cause) {
    if (cause?.code === "ENOENT") throw cause;
    if (cause?.code === "CC_SESSION_MESSAGE_BUNDLE_INVALID") throw cause;
    throw imageBundleError(
      "Message bundle store metadata could not be verified",
      undefined,
      cause,
    );
  }
}

function inspectExternalizableBundle(payload) {
  if (
    !payload ||
    payload.schema !== MESSAGE_BUNDLE_SCHEMA ||
    !Array.isArray(payload.messages) ||
    !Array.isArray(payload.durableSystemKinds) ||
    payload.durableSystemKinds.length !== payload.messages.length
  ) {
    return null;
  }

  let imageCount = 0;
  let imageBytes = 0;
  const reduced = {
    ...payload,
    messages: payload.messages.map((message) => {
      if (message?.role !== "user" || !Array.isArray(message.content))
        return message;
      let messageImages = 0;
      let messageBytes = 0;
      return {
        ...message,
        content: message.content.map((block) => {
          if (
            !block ||
            typeof block !== "object" ||
            Array.isArray(block) ||
            Object.keys(block).sort().join() !== "image_url,type" ||
            block.type !== "image_url" ||
            !block.image_url ||
            typeof block.image_url !== "object" ||
            Array.isArray(block.image_url) ||
            Object.keys(block.image_url).some(
              (key) => !["url", "detail"].includes(key),
            ) ||
            (block.image_url.detail !== undefined &&
              !["auto", "low", "high"].includes(block.image_url.detail)) ||
            typeof block.image_url.url !== "string" ||
            block.image_url.url.length > MAX_IMAGE_DATA_URL_CHARS
          ) {
            return block;
          }
          const image = inspectCanonicalImageDataUrl(block.image_url.url);
          if (!image) return block;
          if (image.decodedBytes > AGENT_MODEL_IMAGE_LIMITS.maxImageBytes) {
            throw imageBundleError(
              "Image exceeds the existing per-image byte budget",
              "CC_CONTEXT_IMAGE_TRANSPORT_INVALID",
            );
          }
          messageImages += 1;
          messageBytes += image.decodedBytes;
          imageCount += 1;
          imageBytes += image.decodedBytes;
          if (
            messageImages > AGENT_MODEL_IMAGE_LIMITS.maxMessageImages ||
            messageBytes > AGENT_MODEL_IMAGE_LIMITS.maxMessageImageBytes
          ) {
            throw imageBundleError(
              "Images exceed the existing per-message image budget",
              "CC_CONTEXT_IMAGE_TRANSPORT_INVALID",
            );
          }
          return {
            ...block,
            image_url: { ...block.image_url, url: "" },
          };
        }),
      };
    }),
  };
  if (imageCount === 0) return null;
  return {
    reducedContent: canonicalJson(reduced),
    imageCount,
    imageBytes,
  };
}

function parseCanonicalBundle(content) {
  if (typeof content !== "string") {
    throw imageBundleError("Message bundle content must be a string");
  }
  const bytes = Buffer.from(content, "utf8");
  if (bytes.length > SESSION_MESSAGE_BUNDLE_MAX_BLOB_BYTES) {
    throw imageBundleError("Message bundle exceeds the 56 MiB blob limit");
  }
  let payload;
  try {
    payload = JSON.parse(content);
  } catch (cause) {
    throw imageBundleError(
      "Message bundle is not valid JSON",
      undefined,
      cause,
    );
  }
  if (canonicalJson(payload) !== content) {
    throw imageBundleError("Message bundle is not canonical JSON");
  }
  const inspected = inspectExternalizableBundle(payload);
  if (
    bytes.length <= SESSION_MESSAGE_BUNDLE_MAX_INLINE_BYTES ||
    !inspected ||
    Buffer.byteLength(inspected.reducedContent, "utf8") >
      SESSION_MESSAGE_BUNDLE_MAX_INLINE_BYTES
  ) {
    throw imageBundleError(
      "Only large canonical user image bundles may use out-of-line storage",
    );
  }
  return { bytes, payload, inspected };
}

function lockTargets(paths, sessionId) {
  const hash = sessionHash(sessionId);
  return {
    global: join(paths.locks, "global-store"),
    session: join(paths.locks, `session-${hash}`),
  };
}

function tombstonePath(paths, hash, suffix) {
  return join(paths.tombstones, `${hash}.${suffix}`);
}

function sessionTranscriptState(paths, sessionId) {
  const transcript = join(paths.sessionRoot, `${sessionId}.jsonl`);
  const metaPath = join(paths.sessionRoot, `${sessionId}.meta.json`);
  const markerPath = join(paths.sessionRoot, `${sessionId}.tombstone`);
  let transcriptExists = false;
  try {
    const stat = lstatSync(transcript);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw imageBundleError("Session transcript path is unsafe");
    }
    transcriptExists = true;
  } catch (cause) {
    if (cause?.code !== "ENOENT") throw cause;
  }
  let meta = null;
  let marker = null;
  for (const [path, assign] of [
    [metaPath, (value) => (meta = value)],
    [markerPath, (value) => (marker = value)],
  ]) {
    try {
      const value = readJsonFile(path, 256 * 1024);
      assign(value);
    } catch (cause) {
      if (cause?.code !== "ENOENT") throw cause;
    }
  }
  const metaMatches = meta?.schema === 2 && meta?.id === sessionId;
  const markerMatches =
    marker?.schema === "chainlesschain.session-tombstone/v1" &&
    marker?.id === sessionId;
  const metaGeneration = normalizeSessionGenerationAuthority(meta?.generation);
  const markerGeneration = normalizeSessionGenerationAuthority(
    marker?.generation,
  );
  const generationId =
    (metaGeneration?.sessionId === sessionId && metaGeneration.generationId) ||
    (markerGeneration?.sessionId === sessionId &&
      markerGeneration.generationId) ||
    null;
  const hasNewerLiveGeneration =
    metaMatches &&
    meta.deleted !== true &&
    metaGeneration?.sessionId === sessionId &&
    metaGeneration.generationId !== markerGeneration?.generationId;
  return {
    transcriptExists,
    metaMatches,
    metaDeleted: metaMatches && meta.deleted === true,
    deletedWitness:
      (metaMatches && meta.deleted === true) ||
      (markerMatches && !hasNewerLiveGeneration),
    generationId,
    liveGenerationId:
      metaMatches &&
      meta.deleted !== true &&
      metaGeneration?.sessionId === sessionId
        ? metaGeneration.generationId
        : null,
  };
}

function requireLiveSessionGeneration(paths, sessionId) {
  const state = sessionTranscriptState(paths, sessionId);
  if (state.deletedWitness || state.metaDeleted) {
    throw imageBundleError(
      `Session message bundle was deleted: ${sessionId}`,
      "SESSION_DELETED",
    );
  }
  if (
    !state.transcriptExists ||
    !state.metaMatches ||
    !state.liveGenerationId
  ) {
    throw imageBundleError(
      "Large session image bundles require a live JSONL session generation",
      "CC_CONTEXT_IMAGE_TRANSPORT_INVALID",
    );
  }
  return state.liveGenerationId;
}

function generationForDeletion(paths, sessionId) {
  return sessionTranscriptState(paths, sessionId).generationId;
}

function verifyPendingRecord(paths, hash) {
  const pendingPath = tombstonePath(paths, hash, "pending");
  recoverTemporaryLink(
    pendingPath,
    join(paths.tombstones, `.${hash}.pending.tmp`),
  );
  if (!existsSync(pendingPath)) return null;
  const value = readJsonFile(pendingPath, 4096);
  const generationId = value?.generationId ?? null;
  if (
    value?.schema !== PENDING_SCHEMA ||
    typeof value.sessionId !== "string" ||
    sessionHash(assertSessionId(value.sessionId)) !== hash ||
    (generationId !== null &&
      (typeof generationId !== "string" ||
        !/^generation-[0-9a-f-]{32,36}$/u.test(generationId)))
  ) {
    throw imageBundleError("Session image deletion marker is invalid");
  }
  return { sessionId: value.sessionId, generationId };
}

function assertStoreTombstone(paths, hash) {
  const filePath = tombstonePath(paths, hash, "deleted");
  recoverTemporaryLink(
    filePath,
    join(paths.tombstones, `.${hash}.deleted.tmp`),
  );
  if (!existsSync(filePath)) return false;
  const value = readJsonFile(filePath, 4096);
  const generationId = value?.generationId ?? null;
  if (
    value?.schema !== DELETED_SCHEMA ||
    value?.sessionHash !== hash ||
    (generationId !== null &&
      (typeof generationId !== "string" ||
        !/^generation-[0-9a-f-]{32,36}$/u.test(generationId)))
  ) {
    throw imageBundleError("Session image deletion tombstone is invalid");
  }
  return { generationId };
}

function assertOwnRegularFile(filePath, { allowLinked = false } = {}) {
  const stat = lstatSync(filePath, { bigint: true });
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.nlink < 1n ||
    (!allowLinked && stat.nlink !== 1n) ||
    (allowLinked && stat.nlink > 2n)
  ) {
    throw imageBundleError("Message bundle file is not a private regular file");
  }
  return stat;
}

function recoverTemporaryLink(target, tempPath) {
  if (!existsSync(tempPath)) return;
  const tempStat = assertOwnRegularFile(tempPath, { allowLinked: true });
  if (tempStat.nlink === 2n) {
    if (!existsSync(target)) {
      throw imageBundleError(
        "Message bundle temporary link has no published object",
      );
    }
    const targetStat = assertOwnRegularFile(target, { allowLinked: true });
    if (
      targetStat.dev !== tempStat.dev ||
      targetStat.ino !== tempStat.ino ||
      targetStat.nlink !== 2n
    ) {
      throw imageBundleError("Message bundle temporary link identity changed");
    }
  }
  unlinkSync(tempPath);
  fsyncDirectory(dirname(tempPath));
}

function sweepSessionTempsLocked(
  paths,
  hash,
  maxEntries = MAX_DIRECTORY_SWEEP,
) {
  const sessionDir = join(paths.sessions, hash);
  const objectsDir = join(sessionDir, "objects");
  if (!existsSync(objectsDir)) return;
  ensureDirectory(sessionDir, "message bundle session directory", false);
  ensureDirectory(objectsDir, "message bundle objects directory", false);
  const directory = opendirSync(objectsDir);
  let processed = 0;
  let scanned = 0;
  let removed = false;
  try {
    for (;;) {
      const entry = directory.readSync();
      if (!entry || scanned >= maxEntries * 8 || processed >= maxEntries) break;
      scanned += 1;
      if (!/^\.bundle-[a-f0-9]{64}\.json\.tmp$/u.test(entry.name)) continue;
      processed += 1;
      const target = join(objectsDir, entry.name);
      if (!isContained(objectsDir, target)) {
        throw imageBundleError(
          "Temporary message bundle path escaped its store",
        );
      }
      const tempStat = assertOwnRegularFile(target, { allowLinked: true });
      if (tempStat.nlink === 2n) {
        const bundleName = entry.name.slice(1, -".tmp".length);
        const finalPath = join(objectsDir, bundleName);
        if (!existsSync(finalPath)) {
          throw imageBundleError(
            "Orphan message bundle hard link could not be paired",
          );
        }
        const finalStat = assertOwnRegularFile(finalPath, {
          allowLinked: true,
        });
        if (
          finalStat.dev !== tempStat.dev ||
          finalStat.ino !== tempStat.ino ||
          finalStat.nlink !== 2n
        ) {
          throw imageBundleError("Message bundle hard link identity changed");
        }
      }
      unlinkSync(target);
      removed = true;
    }
  } finally {
    directory.closeSync();
  }
  if (removed) fsyncDirectory(objectsDir);
}

function cleanupSessionObjectsLocked(paths, hash) {
  const sessionDir = join(paths.sessions, hash);
  const objectsDir = join(sessionDir, "objects");
  if (!existsSync(sessionDir)) return;
  ensureDirectory(sessionDir, "message bundle session directory", false);
  if (!existsSync(objectsDir)) {
    rmdirSync(sessionDir);
    fsyncDirectory(paths.sessions);
    return;
  }
  ensureDirectory(objectsDir, "message bundle objects directory", false);
  const names = readdirSync(objectsDir);
  const known = names.every(
    (name) =>
      /^bundle-[a-f0-9]{64}\.json$/u.test(name) ||
      /^\.bundle-[a-f0-9]{64}\.json\.tmp$/u.test(name),
  );
  if (!known) {
    throw imageBundleError(
      "Session image cleanup found an unknown store entry",
    );
  }
  for (const name of names) {
    const target = join(objectsDir, name);
    if (!isContained(objectsDir, target)) {
      throw imageBundleError("Session image cleanup path escaped its store");
    }
    const stat = assertOwnRegularFile(target, { allowLinked: true });
    if (name.startsWith(".")) {
      const finalPath = join(objectsDir, name.slice(1, -".tmp".length));
      if (stat.nlink === 2n) {
        if (!names.includes(basename(finalPath))) {
          throw imageBundleError(
            "Session image cleanup found an external hard link",
          );
        }
        const finalStat = assertOwnRegularFile(finalPath, {
          allowLinked: true,
        });
        if (
          finalStat.dev !== stat.dev ||
          finalStat.ino !== stat.ino ||
          finalStat.nlink !== 2n
        ) {
          throw imageBundleError(
            "Session image cleanup hard link identity changed",
          );
        }
      }
    } else if (stat.nlink === 2n) {
      const tempPath = join(objectsDir, `.${name}.tmp`);
      if (!names.includes(basename(tempPath))) {
        throw imageBundleError(
          "Session image cleanup found an external hard link",
        );
      }
      const tempStat = assertOwnRegularFile(tempPath, { allowLinked: true });
      if (
        tempStat.dev !== stat.dev ||
        tempStat.ino !== stat.ino ||
        tempStat.nlink !== 2n
      ) {
        throw imageBundleError(
          "Session image cleanup hard link identity changed",
        );
      }
    }
  }
  for (const name of names.filter((entry) => entry.startsWith("."))) {
    unlinkSync(join(objectsDir, name));
  }
  for (const name of names.filter((entry) => !entry.startsWith("."))) {
    const target = join(objectsDir, name);
    if (assertOwnRegularFile(target).nlink !== 1n) {
      throw imageBundleError(
        "Session image cleanup left a hard link outside its store",
      );
    }
    unlinkSync(target);
  }
  fsyncDirectory(objectsDir);
  rmdirSync(objectsDir);
  fsyncDirectory(sessionDir);
  rmdirSync(sessionDir);
  fsyncDirectory(paths.sessions);
}

function publishDeletedTombstoneLocked(paths, hash, generationId) {
  const target = tombstonePath(paths, hash, "deleted");
  const payload = canonicalJson({
    schema: DELETED_SCHEMA,
    sessionHash: hash,
    generationId: generationId ?? null,
  });
  const created = writeExclusiveFile(target, payload);
  if (!created) {
    const existing = assertStoreTombstone(paths, hash);
    if (existing.generationId !== (generationId ?? null)) {
      throw imageBundleError(
        "Session image deletion tombstone generation changed",
      );
    }
  }
}

function removePendingTombstoneLocked(paths, hash) {
  const target = tombstonePath(paths, hash, "pending");
  if (!existsSync(target)) return;
  assertOwnRegularFile(target);
  unlinkSync(target);
  fsyncDirectory(paths.tombstones);
}

function finishPendingDeletionLocked(paths, sessionId, generationId) {
  const hash = sessionHash(sessionId);
  publishDeletedTombstoneLocked(paths, hash, generationId);
  cleanupSessionObjectsLocked(paths, hash);
  removePendingTombstoneLocked(paths, hash);
}

function resolvePendingDeletionLocked(paths, hash, sessionId) {
  const pending = verifyPendingRecord(paths, hash);
  if (pending === null) return null;
  if (pending.sessionId !== sessionId) {
    throw imageBundleError(
      "Session image deletion marker belongs to another session",
    );
  }
  const state = sessionTranscriptState(paths, sessionId);
  const supersededByNewGeneration =
    state.transcriptExists &&
    !state.deletedWitness &&
    state.liveGenerationId !== null &&
    state.liveGenerationId !== pending.generationId;
  if (
    !state.transcriptExists ||
    state.deletedWitness ||
    supersededByNewGeneration
  ) {
    finishPendingDeletionLocked(paths, sessionId, pending.generationId);
    return { generationId: pending.generationId };
  }
  removePendingTombstoneLocked(paths, hash);
  return null;
}

function resolveCurrentSessionStateLocked(paths, sessionId) {
  const hash = sessionHash(sessionId);
  const recovered = resolvePendingDeletionLocked(paths, hash, sessionId);
  const state = sessionTranscriptState(paths, sessionId);
  const tombstone = assertStoreTombstone(paths, hash);
  if (tombstone) {
    if (
      state.liveGenerationId === null ||
      tombstone.generationId === state.liveGenerationId
    ) {
      cleanupSessionObjectsLocked(paths, hash);
      throw imageBundleError(
        "Session message bundle was deleted: " + sessionId,
        "SESSION_DELETED",
      );
    }
    // The session id now names a newer JSONL generation. Retire only the old
    // generation's bundle namespace before admitting the new generation.
    retireStaleDeletedTombstoneLocked(paths, hash, state.liveGenerationId);
  }
  const generationId = requireLiveSessionGeneration(paths, sessionId);
  if (recovered && recovered.generationId === generationId) {
    throw imageBundleError(
      "Session message bundle deletion was recovered: " + sessionId,
      "SESSION_DELETED",
    );
  }
  return generationId;
}

function retireStaleDeletedTombstoneLocked(paths, hash, liveGenerationId) {
  if (liveGenerationId === null) return false;
  const tombstone = assertStoreTombstone(paths, hash);
  if (!tombstone || tombstone.generationId === liveGenerationId) return false;
  cleanupSessionObjectsLocked(paths, hash);
  const deletedPath = tombstonePath(paths, hash, "deleted");
  assertOwnRegularFile(deletedPath);
  unlinkSync(deletedPath);
  fsyncDirectory(paths.tombstones);
  return true;
}

function sweepOrphansLocked(paths, sessionId) {
  const hash = sessionHash(sessionId);
  sweepSessionTempsLocked(paths, hash);
  return resolvePendingDeletionLocked(paths, hash, sessionId);
}
function withStoreLocks(paths, sessionId, callback) {
  const targets = lockTargets(paths, sessionId);
  return withFileLock(
    targets.global,
    () => {
      return withFileLock(
        targets.session,
        () => {
          sweepOrphansLocked(paths, sessionId);
          const generationId = resolveCurrentSessionStateLocked(
            paths,
            sessionId,
          );
          return callback(generationId);
        },
        LOCK_OPTIONS,
      );
    },
    LOCK_OPTIONS,
  );
}

function publishContentLocked(paths, sessionId, generationId, bytes, digest) {
  const objectsDir = ensureSessionObjectsDir(paths, sessionId);
  const objectId = objectIdFor(sessionId, generationId, digest);
  const target = join(objectsDir, `${objectId}.json`);
  recoverTemporaryLink(target, join(objectsDir, `.${objectId}.json.tmp`));
  if (!isContained(objectsDir, target)) {
    throw imageBundleError("Message bundle object path escaped its store");
  }
  if (existsSync(target)) {
    const existing = readBoundedArtifactFile(
      target,
      bytes.length,
      SESSION_MESSAGE_BUNDLE_MAX_BLOB_BYTES,
    );
    if (sha256(existing) !== digest) {
      throw imageBundleError(
        "Existing session message bundle digest does not match",
      );
    }
  } else {
    const created = writeExclusiveFile(target, bytes);
    if (!created) {
      const existing = readBoundedArtifactFile(
        target,
        bytes.length,
        SESSION_MESSAGE_BUNDLE_MAX_BLOB_BYTES,
      );
      if (sha256(existing) !== digest) {
        throw imageBundleError(
          "Existing session message bundle digest does not match",
        );
      }
    }
  }
  const readback = readBoundedArtifactFile(
    target,
    bytes.length,
    SESSION_MESSAGE_BUNDLE_MAX_BLOB_BYTES,
  );
  if (sha256(readback) !== digest) {
    throw imageBundleError(
      "Session message bundle publication failed verification",
    );
  }
  assertOwnRegularFile(target);
  // Re-settle the published object and every newly-created directory entry,
  // including on EEXIST reuse after an earlier response was lost before a
  // parent-directory barrier completed.
  fsyncDirectoryAncestry(paths, objectsDir);
  return {
    store: SESSION_MESSAGE_BUNDLE_STORE,
    objectId,
    digest: `sha256:${digest}`,
    byteLength: bytes.length,
    mimeType: "application/json",
    summary: "Canonical user image message bundle",
    recoverable: true,
    accessPolicy: "same-session",
  };
}

export function storeSessionMessageBundle({
  sessionId: sessionIdInput,
  content,
}) {
  const sessionId = assertSessionId(sessionIdInput);
  const { bytes } = parseCanonicalBundle(content);
  const digest = sha256(bytes);
  const sessionRoot = canonicalSessionRoot(false);
  if (!sessionRoot) {
    throw imageBundleError(
      "Large session image bundles require a live JSONL session generation",
      "CC_CONTEXT_IMAGE_TRANSPORT_INVALID",
    );
  }
  const expectedGenerationId = requireLiveSessionGeneration(
    { sessionRoot },
    sessionId,
  );
  const paths = storePaths(true);
  return withStoreLocks(paths, sessionId, (generationId) => {
    if (generationId !== expectedGenerationId) {
      throw imageBundleError(
        "Session generation changed while publishing an image bundle",
        "SESSION_GENERATION_CHANGED",
      );
    }
    return publishContentLocked(paths, sessionId, generationId, bytes, digest);
  });
}

export function readSessionMessageBundle(contentRef, sessionIdInput) {
  const sessionId = assertSessionId(sessionIdInput);
  if (
    !contentRef ||
    contentRef.store !== SESSION_MESSAGE_BUNDLE_STORE ||
    typeof contentRef.objectId !== "string" ||
    !/^bundle-[a-f0-9]{64}$/u.test(contentRef.objectId) ||
    typeof contentRef.digest !== "string" ||
    !/^sha256-[a-f0-9]{64}$|^sha256:[a-f0-9]{64}$/u.test(contentRef.digest) ||
    !Number.isSafeInteger(contentRef.byteLength) ||
    contentRef.byteLength <= SESSION_MESSAGE_BUNDLE_MAX_INLINE_BYTES ||
    contentRef.byteLength > SESSION_MESSAGE_BUNDLE_MAX_BLOB_BYTES ||
    contentRef.mimeType !== "application/json" ||
    contentRef.summary !== "Canonical user image message bundle" ||
    contentRef.recoverable !== true ||
    contentRef.accessPolicy !== "same-session"
  ) {
    throw imageBundleError(
      "ContextItem contentRef is not a session message bundle",
    );
  }
  const expectedDigest = contentRef.digest.replace(":", "-");
  const digestHex = expectedDigest.slice("sha256-".length);
  const paths = storePaths(false);
  if (!paths) throw imageBundleError("Session message bundle is missing");
  return withStoreLocks(paths, sessionId, (generationId) => {
    if (
      objectIdFor(sessionId, generationId, digestHex) !== contentRef.objectId
    ) {
      throw imageBundleError(
        "Session message bundle reference belongs to another session generation",
      );
    }
    const objectsDir = assertExistingSessionObjectsDir(paths, sessionId);
    if (!objectsDir)
      throw imageBundleError("Session message bundle is missing");
    const target = join(objectsDir, `${contentRef.objectId}.json`);
    if (!isContained(objectsDir, target)) {
      throw imageBundleError("Session message bundle path escaped its store");
    }
    recoverTemporaryLink(
      target,
      join(objectsDir, `.${contentRef.objectId}.json.tmp`),
    );
    const bytes = readBoundedArtifactFile(
      target,
      contentRef.byteLength,
      SESSION_MESSAGE_BUNDLE_MAX_BLOB_BYTES,
    );
    if (sha256(bytes) !== digestHex) {
      throw imageBundleError(
        "Session message bundle digest does not match its reference",
      );
    }
    let content;
    try {
      content = FATAL_UTF8.decode(bytes);
    } catch (cause) {
      throw imageBundleError(
        "Session message bundle is not valid UTF-8",
        undefined,
        cause,
      );
    }
    parseCanonicalBundle(content);
    return content;
  });
}

/** Keep the session deletion lock order: JSONL writer lock, then store global, then store session. */
export function withSessionMessageBundleDeletion(sessionIdInput, task) {
  const sessionId = assertSessionId(sessionIdInput);
  if (
    typeof task !== "function" ||
    task.constructor?.name === "AsyncFunction"
  ) {
    throw new TypeError(
      "Session message bundle deletion callback must be synchronous",
    );
  }
  const paths = storePaths(true);
  const targets = lockTargets(paths, sessionId);
  return withFileLock(
    targets.global,
    () => {
      return withFileLock(
        targets.session,
        () => {
          const hash = sessionHash(sessionId);
          sweepOrphansLocked(paths, sessionId);
          const stateBeforeDelete = sessionTranscriptState(paths, sessionId);
          const generationId = stateBeforeDelete.generationId;
          retireStaleDeletedTombstoneLocked(
            paths,
            hash,
            stateBeforeDelete.liveGenerationId,
          );
          const currentTombstone = assertStoreTombstone(paths, hash);
          const alreadyDeleted =
            currentTombstone !== null &&
            currentTombstone.generationId === generationId;
          if (!alreadyDeleted) {
            const pendingPath = tombstonePath(paths, hash, "pending");
            const pending = canonicalJson({
              schema: PENDING_SCHEMA,
              sessionId,
              generationId: generationId ?? null,
            });
            if (!writeExclusiveFile(pendingPath, pending)) {
              const existing = verifyPendingRecord(paths, hash);
              if (
                existing?.sessionId !== sessionId ||
                existing?.generationId !== (generationId ?? null)
              ) {
                throw imageBundleError(
                  "Session image deletion marker belongs to another generation",
                );
              }
            }
          }
          let result;
          try {
            result = task();
          } catch (error) {
            if (!alreadyDeleted) {
              const state = sessionTranscriptState(paths, sessionId);
              if (state.transcriptExists && !state.deletedWitness) {
                removePendingTombstoneLocked(paths, hash);
              }
            }
            throw error;
          }
          try {
            finishPendingDeletionLocked(paths, sessionId, generationId);
          } catch (cause) {
            throw imageBundleError(
              `Session transcript was deleted, but image bundle cleanup failed; retry session deletion (${cause?.message || "unknown cleanup error"})`,
              "SESSION_IMAGE_BUNDLE_DELETE_FAILED",
              cause,
            );
          }
          return result;
        },
        LOCK_OPTIONS,
      );
    },
    LOCK_OPTIONS,
  );
}

export const _messageBundleStore = Object.freeze({
  storePaths,
  inspectExternalizableBundle,
  sessionHash,
});
