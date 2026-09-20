import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { types } from "node:util";

import { withFileLock } from "../with-file-lock.js";

export const VOLCENGINE_FUNCTION_REPLAY_STORE_SCHEMA =
  "chainlesschain.volcengine-function-replay-store/v1";
export const VOLCENGINE_FUNCTION_REPLAY_RESERVATION_SCHEMA =
  "chainlesschain.volcengine-function-replay-reservation/v1";
export const VOLCENGINE_FUNCTION_REPLAY_MODE =
  "cross-process-exclusive-file-fsync";

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const ID = /^[^\p{Cc}]{1,512}$/u;
const RECORD_FILE = /^[a-f0-9]{64}\.json$/u;
const MAX_RECORD_BYTES = 8 * 1024;
const MAX_RECORDS = 4_096;
const MAX_RETENTION_MS = 24 * 60 * 60 * 1000;
const stores = new WeakMap();

function canonical(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
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

function exactData(value, keys, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    types.isProxy(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Reflect.ownKeys(value).length !== keys.length ||
    keys.some((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return !descriptor?.enumerable || !Object.hasOwn(descriptor, "value");
    })
  ) {
    throw new TypeError(`${label} has unexpected or accessor fields`);
  }
}

function ownData(owner, name, label) {
  const descriptor = Object.getOwnPropertyDescriptor(owner, name);
  if (!descriptor || !Object.hasOwn(descriptor, "value")) {
    throw new TypeError(`${label} must be plain data`);
  }
  return descriptor.value;
}

function normalizeDescriptor(value) {
  exactData(
    value,
    [
      "schema",
      "replayStoreId",
      "authorityId",
      "tenantId",
      "handlerArtifactDigest",
      "policyRevision",
      "retentionMs",
      "mode",
    ],
    "Volcengine function replay store descriptor",
  );
  const descriptor = Object.freeze({
    schema: ownData(value, "schema", "Volcengine replay store schema"),
    replayStoreId: ownData(
      value,
      "replayStoreId",
      "Volcengine replay store identifier",
    ),
    authorityId: ownData(
      value,
      "authorityId",
      "Volcengine replay store authority",
    ),
    tenantId: ownData(value, "tenantId", "Volcengine replay store tenant"),
    handlerArtifactDigest: ownData(
      value,
      "handlerArtifactDigest",
      "Volcengine replay store artifact digest",
    ),
    policyRevision: ownData(
      value,
      "policyRevision",
      "Volcengine replay store policy revision",
    ),
    retentionMs: ownData(
      value,
      "retentionMs",
      "Volcengine replay store retention",
    ),
    mode: ownData(value, "mode", "Volcengine replay store mode"),
  });
  if (
    descriptor.schema !== VOLCENGINE_FUNCTION_REPLAY_STORE_SCHEMA ||
    !ID.test(descriptor.replayStoreId) ||
    !ID.test(descriptor.authorityId) ||
    !ID.test(descriptor.tenantId) ||
    !DIGEST.test(descriptor.handlerArtifactDigest) ||
    !ID.test(descriptor.policyRevision) ||
    !Number.isSafeInteger(descriptor.retentionMs) ||
    descriptor.retentionMs < 1 ||
    descriptor.retentionMs > MAX_RETENTION_MS ||
    descriptor.mode !== VOLCENGINE_FUNCTION_REPLAY_MODE
  ) {
    throw new TypeError(
      "Volcengine function replay store descriptor is invalid",
    );
  }
  return descriptor;
}

function normalizeReservation(value, descriptor) {
  exactData(
    value,
    [
      "schema",
      "replayStoreId",
      "authorityId",
      "tenantId",
      "handlerArtifactDigest",
      "policyRevision",
      "requestId",
      "requestDigest",
      "expiresAt",
      "reservationDigest",
    ],
    "Volcengine function replay reservation",
  );
  const core = Object.freeze({
    schema: ownData(value, "schema", "Volcengine replay reservation schema"),
    replayStoreId: ownData(
      value,
      "replayStoreId",
      "Volcengine replay reservation store",
    ),
    authorityId: ownData(
      value,
      "authorityId",
      "Volcengine replay reservation authority",
    ),
    tenantId: ownData(
      value,
      "tenantId",
      "Volcengine replay reservation tenant",
    ),
    handlerArtifactDigest: ownData(
      value,
      "handlerArtifactDigest",
      "Volcengine replay reservation artifact digest",
    ),
    policyRevision: ownData(
      value,
      "policyRevision",
      "Volcengine replay reservation policy revision",
    ),
    requestId: ownData(
      value,
      "requestId",
      "Volcengine replay reservation request",
    ),
    requestDigest: ownData(
      value,
      "requestDigest",
      "Volcengine replay reservation request digest",
    ),
    expiresAt: ownData(
      value,
      "expiresAt",
      "Volcengine replay reservation expiry",
    ),
  });
  const reservationDigest = ownData(
    value,
    "reservationDigest",
    "Volcengine replay reservation digest",
  );
  const expiresAtMs = Date.parse(core.expiresAt);
  if (
    core.schema !== VOLCENGINE_FUNCTION_REPLAY_RESERVATION_SCHEMA ||
    core.replayStoreId !== descriptor.replayStoreId ||
    core.authorityId !== descriptor.authorityId ||
    core.tenantId !== descriptor.tenantId ||
    core.handlerArtifactDigest !== descriptor.handlerArtifactDigest ||
    core.policyRevision !== descriptor.policyRevision ||
    !ID.test(core.requestId) ||
    !DIGEST.test(core.requestDigest) ||
    !Number.isFinite(expiresAtMs) ||
    new Date(expiresAtMs).toISOString() !== core.expiresAt ||
    reservationDigest !==
      digest(VOLCENGINE_FUNCTION_REPLAY_RESERVATION_SCHEMA, core)
  ) {
    throw new TypeError("Volcengine function replay reservation is invalid");
  }
  return Object.freeze({ ...core, reservationDigest, expiresAtMs });
}

function syncDirectory(directory) {
  const descriptor = fs.openSync(
    directory,
    process.platform === "win32" ? "r+" : "r",
  );
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function ensureDirectory(directory) {
  const requested = path.resolve(directory);
  const missing = [];
  let cursor = requested;
  for (;;) {
    try {
      const info = fs.lstatSync(cursor);
      if (!info.isDirectory() || info.isSymbolicLink()) {
        throw new Error(
          "Volcengine function replay store path is not a directory",
        );
      }
      break;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      missing.unshift(cursor);
      const parent = path.dirname(cursor);
      if (parent === cursor) throw error;
      cursor = parent;
    }
  }
  fs.mkdirSync(requested, { recursive: true, mode: 0o700 });
  for (const created of missing) syncDirectory(path.dirname(created));
  const info = fs.lstatSync(requested);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error("Volcengine function replay store path is not a directory");
  }
  return fs.realpathSync(requested);
}

function recordName(descriptor, requestId) {
  return `${createHash("sha256")
    .update("chainlesschain.volcengine-function-replay-record/v1\0")
    .update(descriptor.replayStoreId)
    .update("\0")
    .update(descriptor.authorityId)
    .update("\0")
    .update(requestId)
    .digest("hex")}.json`;
}

function readRecord(recordPath, descriptor) {
  const info = fs.lstatSync(recordPath);
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    info.nlink !== 1 ||
    info.size < 2 ||
    info.size > MAX_RECORD_BYTES
  ) {
    throw new Error("Volcengine function replay record is invalid");
  }
  const bytes = fs.readFileSync(recordPath);
  if (bytes.length !== info.size) {
    throw new Error(
      "Volcengine function replay record changed during readback",
    );
  }
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch (cause) {
    throw new Error("Volcengine function replay record is invalid", { cause });
  }
  return normalizeReservation(value, descriptor);
}

function writeReservation(recordPath, reservationsDirectory, reservation) {
  const storedReservation = Object.freeze({
    schema: reservation.schema,
    replayStoreId: reservation.replayStoreId,
    authorityId: reservation.authorityId,
    tenantId: reservation.tenantId,
    handlerArtifactDigest: reservation.handlerArtifactDigest,
    policyRevision: reservation.policyRevision,
    requestId: reservation.requestId,
    requestDigest: reservation.requestDigest,
    expiresAt: reservation.expiresAt,
    reservationDigest: reservation.reservationDigest,
  });
  const encoded = Buffer.from(JSON.stringify(storedReservation), "utf8");
  if (encoded.length < 2 || encoded.length > MAX_RECORD_BYTES) {
    throw new TypeError("Volcengine function replay reservation is too large");
  }
  let descriptor;
  try {
    descriptor = fs.openSync(recordPath, "wx", 0o600);
    let offset = 0;
    while (offset < encoded.length) {
      const written = fs.writeSync(
        descriptor,
        encoded,
        offset,
        encoded.length - offset,
      );
      if (!Number.isSafeInteger(written) || written < 1) {
        throw new Error("Volcengine function replay reservation write stalled");
      }
      offset += written;
    }
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    syncDirectory(reservationsDirectory);
  } catch (cause) {
    if (descriptor !== undefined) {
      try {
        fs.closeSync(descriptor);
      } catch {
        // Preserve the record because its durability and side-effect status are unknown.
      }
    }
    const error = new Error(
      "Volcengine function replay reservation durability is unknown",
      { cause },
    );
    error.code = "CC_VOLCENGINE_FUNCTION_REPLAY_DURABILITY_UNKNOWN";
    throw error;
  }
  try {
    const readback = readRecord(recordPath, {
      replayStoreId: reservation.replayStoreId,
      authorityId: reservation.authorityId,
      tenantId: reservation.tenantId,
      handlerArtifactDigest: reservation.handlerArtifactDigest,
      policyRevision: reservation.policyRevision,
    });
    if (readback.reservationDigest !== reservation.reservationDigest) {
      throw new Error(
        "Volcengine function replay reservation readback differs",
      );
    }
    return readback;
  } catch (cause) {
    const error = new Error(
      "Volcengine function replay reservation durability is unknown",
      { cause },
    );
    error.code = "CC_VOLCENGINE_FUNCTION_REPLAY_DURABILITY_UNKNOWN";
    throw error;
  }
}

function removeExpiredRecords(captured, nowMs) {
  const names = fs.readdirSync(captured.reservationsDirectory);
  if (names.some((name) => !RECORD_FILE.test(name))) {
    throw new Error(
      "Volcengine function replay store contains unknown entries",
    );
  }
  let removed = 0;
  for (const name of names) {
    const recordPath = path.join(captured.reservationsDirectory, name);
    let record;
    try {
      record = readRecord(recordPath, captured.descriptor);
    } catch {
      // A crash can leave an incomplete reservation. Retain and count it so
      // the affected request remains blocked without disabling unrelated IDs.
      continue;
    }
    if (record.expiresAtMs > nowMs) continue;
    fs.unlinkSync(recordPath);
    removed += 1;
  }
  if (removed > 0) syncDirectory(captured.reservationsDirectory);
  return names.length - removed;
}

export function createVolcengineFunctionReplayStore({
  descriptor,
  rootDir,
  now = () => Date.now(),
} = {}) {
  const normalizedDescriptor = normalizeDescriptor(descriptor);
  if (
    typeof rootDir !== "string" ||
    rootDir.length < 1 ||
    rootDir.length > 4096 ||
    rootDir.includes("\0") ||
    !path.isAbsolute(rootDir)
  ) {
    throw new TypeError("Volcengine function replay store root is invalid");
  }
  if (typeof now !== "function" || types.isProxy(now)) {
    throw new TypeError("Volcengine function replay store clock is invalid");
  }
  const root = ensureDirectory(rootDir);
  const reservationsDirectory = ensureDirectory(
    path.join(root, "reservations"),
  );
  if (path.dirname(reservationsDirectory) !== root) {
    throw new Error("Volcengine function replay store directory escaped root");
  }
  const store = Object.freeze({});
  stores.set(store, {
    descriptor: normalizedDescriptor,
    root,
    reservationsDirectory,
    lockTarget: path.join(root, "reservations-index"),
    now,
  });
  return store;
}

export function captureVolcengineFunctionReplayStore(value) {
  const captured = stores.get(value);
  if (!captured) {
    throw new TypeError(
      "A branded Volcengine function replay store is required",
    );
  }
  return Object.freeze({
    descriptor: captured.descriptor,
    reserve(value) {
      const reservation = normalizeReservation(value, captured.descriptor);
      const nowMs = captured.now();
      if (!Number.isFinite(nowMs) || reservation.expiresAtMs <= nowMs) {
        throw new TypeError(
          "Volcengine function replay reservation is expired",
        );
      }
      return withFileLock(
        captured.lockTarget,
        () => {
          const count = removeExpiredRecords(captured, nowMs);
          const name = recordName(captured.descriptor, reservation.requestId);
          const recordPath = path.join(captured.reservationsDirectory, name);
          try {
            const existing = readRecord(recordPath, captured.descriptor);
            if (existing.requestId !== reservation.requestId) {
              throw new Error(
                "Volcengine function replay record name collided",
              );
            }
            const error = new TypeError(
              "Volcengine function request was replayed",
            );
            error.code = "CC_VOLCENGINE_FUNCTION_REQUEST_REPLAYED";
            throw error;
          } catch (error) {
            if (error?.code !== "ENOENT") throw error;
          }
          if (count >= MAX_RECORDS) {
            throw new Error("Volcengine function replay store is full");
          }
          const readback = writeReservation(
            recordPath,
            captured.reservationsDirectory,
            reservation,
          );
          if (readback.reservationDigest !== reservation.reservationDigest) {
            throw new Error(
              "Volcengine function replay reservation readback differs",
            );
          }
          return Object.freeze({
            reservationDigest: reservation.reservationDigest,
            durable: true,
            readbackVerified: true,
          });
        },
        { failIfUnavailable: true, timeoutMs: 5_000 },
      );
    },
  });
}
