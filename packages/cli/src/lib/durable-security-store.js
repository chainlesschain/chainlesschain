/**
 * Crash-safe, fail-closed persistence for security metadata.
 *
 * Trust, consent and credential references are durable security decisions
 * shared by every CLI process. A plain read-modify-write can silently lose a
 * grant or a revocation, while treating a corrupt file as an empty object can
 * overwrite the only evidence that the store is unavailable. This helper
 * keeps the entire mutation under the canonical cross-process lock and
 * replaces the JSON file atomically.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { withFileLock } from "./with-file-lock.js";

function storeError(label, operation, filePath, cause) {
  const detail = cause?.message || String(cause || "unknown error");
  const error = new Error(
    `${label} store ${operation} failed (${filePath}): ${detail}`,
    { cause },
  );
  error.name = "DurableSecurityStoreError";
  error.code = `DURABLE_SECURITY_STORE_${operation.toUpperCase()}_FAILED`;
  error.filePath = filePath;
  return error;
}

export function readSecurityStore(filePath, label) {
  let serialized;
  try {
    serialized = fs.readFileSync(filePath, "utf8");
  } catch (cause) {
    if (cause?.code === "ENOENT") return {};
    throw storeError(label, "read", filePath, cause);
  }

  try {
    const parsed = JSON.parse(serialized);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new TypeError("top-level value must be an object");
    }
    return parsed;
  } catch (cause) {
    throw storeError(label, "corrupt", filePath, cause);
  }
}

export function writeSecurityStore(filePath, label, store) {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temporaryPath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`,
  );
  let descriptor = null;
  let renamed = false;

  try {
    descriptor = fs.openSync(temporaryPath, "wx", 0o600);
    fs.writeFileSync(
      descriptor,
      `${JSON.stringify(store, null, 2)}\n`,
      "utf8",
    );
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = null;
    fs.renameSync(temporaryPath, filePath);
    renamed = true;

    if (process.platform !== "win32") {
      const directoryDescriptor = fs.openSync(directory, "r");
      try {
        fs.fsyncSync(directoryDescriptor);
      } finally {
        fs.closeSync(directoryDescriptor);
      }
    }
  } catch (cause) {
    if (descriptor != null) {
      try {
        fs.closeSync(descriptor);
      } catch {
        // Preserve the original persistence error.
      }
    }
    if (!renamed) {
      try {
        fs.unlinkSync(temporaryPath);
      } catch {
        // Best-effort orphan cleanup.
      }
    }
    throw storeError(label, "write", filePath, cause);
  }
}

export function mutateSecurityStore(
  filePath,
  label,
  mutator,
  { lock = withFileLock, timeoutMs = 2000, staleMs = 30000 } = {},
) {
  // withFileLock expects the target's parent to exist. Directory creation is
  // idempotent and safe outside the critical section.
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  } catch (cause) {
    throw storeError(label, "prepare", filePath, cause);
  }

  return lock(
    filePath,
    () => {
      const current = readSecurityStore(filePath, label);
      const draft = structuredClone(current);
      const result = mutator(draft);
      writeSecurityStore(filePath, label, draft);
      return result;
    },
    { timeoutMs, staleMs, failIfUnavailable: true },
  );
}
