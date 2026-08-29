import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { canonicalDigest } from "@chainlesschain/context-memory-kernel";
import { getHomeDir } from "../paths.js";
import { withFileLock } from "../with-file-lock.js";

const LEGACY_SCOPED_STORE = "cli-session-core-memory-store";
const LEGACY_SQLITE_STORE = "cli-sqlite-memory-entries";
const DEFAULT_MAX_FILE_BYTES = 64 * 1024 * 1024;

function purgeError(message, code, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  return error;
}

function matchingEvidenceIds(evidenceRefs, store) {
  return [
    ...new Set(
      (Array.isArray(evidenceRefs) ? evidenceRefs : [])
        .filter((entry) => entry?.store === store)
        .map((entry) => String(entry.id || "").trim())
        .filter(Boolean),
    ),
  ];
}

function assertRegularFile(filePath) {
  if (!existsSync(filePath)) return;
  const stat = lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw purgeError(
      "legacy memory projection path is not a regular file",
      "LEGACY_MEMORY_PROJECTION_UNSAFE",
    );
  }
}

function syncDirectory(directory) {
  if (process.platform === "win32") return;
  const descriptor = openSync(directory, "r");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function writeJsonAtomic(filePath, value) {
  const directory = dirname(filePath);
  const temporary = join(
    directory,
    `.${filePath.split(/[\\/]/u).at(-1)}.${process.pid}.${randomUUID()}.purge`,
  );
  let descriptor = null;
  let renamed = false;
  try {
    descriptor = openSync(temporary, "wx", 0o600);
    writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = null;
    assertRegularFile(filePath);
    renameSync(temporary, filePath);
    renamed = true;
    syncDirectory(directory);
  } finally {
    if (descriptor !== null) closeSync(descriptor);
    if (!renamed) rmSync(temporary, { force: true });
  }
}

function readLegacySnapshot(filePath, maxFileBytes) {
  assertRegularFile(filePath);
  if (!existsSync(filePath)) return null;
  const bytes = readFileSync(filePath);
  if (bytes.length > maxFileBytes) {
    throw purgeError(
      "legacy memory projection exceeds its byte limit",
      "LEGACY_MEMORY_PROJECTION_TOO_LARGE",
    );
  }
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch (cause) {
    throw purgeError(
      "legacy memory projection is not valid JSON",
      "LEGACY_MEMORY_PROJECTION_CORRUPT",
      cause,
    );
  }
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !Array.isArray(value.memories)
  ) {
    throw purgeError(
      "legacy memory projection has an invalid shape",
      "LEGACY_MEMORY_PROJECTION_CORRUPT",
    );
  }
  return value;
}

function purgeLegacyScopedFile(filePath, ids, maxFileBytes) {
  if (ids.length === 0 || !existsSync(filePath)) {
    return { applicable: ids.length > 0, removed: 0, remaining: 0 };
  }
  return withFileLock(
    filePath,
    () => {
      const snapshot = readLegacySnapshot(filePath, maxFileBytes);
      if (!snapshot) return { applicable: true, removed: 0, remaining: 0 };
      const targets = new Set(ids);
      const retained = snapshot.memories.filter(
        (entry) => !targets.has(String(entry?.id || "")),
      );
      const removed = snapshot.memories.length - retained.length;
      if (removed > 0) {
        writeJsonAtomic(filePath, { ...snapshot, memories: retained });
      }
      const verified = readLegacySnapshot(filePath, maxFileBytes);
      const remaining = (verified?.memories || []).filter((entry) =>
        targets.has(String(entry?.id || "")),
      ).length;
      if (remaining > 0) {
        throw purgeError(
          "legacy scoped memory remained after purge",
          "LEGACY_MEMORY_PURGE_VERIFY_FAILED",
        );
      }
      return { applicable: true, removed, remaining };
    },
    {
      failIfUnavailable: true,
      timeoutMs: 30_000,
      retryMs: 2,
      maxRetryMs: 32,
      retryJitterMs: 8,
    },
  );
}

function purgeLegacySqlite(db, ids) {
  if (ids.length === 0) {
    return { applicable: false, removed: 0, remaining: 0 };
  }
  if (!db || typeof db.prepare !== "function") {
    throw purgeError(
      "legacy SQLite memory purge requires the authoritative database handle",
      "LEGACY_SQLITE_PURGE_UNAVAILABLE",
    );
  }
  const table = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'memory_entries'",
    )
    .get();
  if (!table) return { applicable: true, removed: 0, remaining: 0 };
  const remove = db.prepare("DELETE FROM memory_entries WHERE id = ?");
  const exists = db.prepare("SELECT id FROM memory_entries WHERE id = ?");
  let removed = 0;
  const body = () => {
    for (const id of ids) removed += Number(remove.run(id)?.changes || 0);
  };
  if (typeof db.transaction === "function") db.transaction(body)();
  else body();
  const remaining = ids.filter((id) => Boolean(exists.get(id))).length;
  if (remaining > 0) {
    throw purgeError(
      "legacy SQLite memory remained after purge",
      "LEGACY_SQLITE_PURGE_VERIFY_FAILED",
    );
  }
  return { applicable: true, removed, remaining };
}

/** Purges first-party legacy copies referenced by a canonical MemoryRecord. */
export class CliLegacyMemoryPrivacyPurgePort {
  constructor({
    memoryStorePath = join(getHomeDir(), "memory-store.json"),
    legacyDb = null,
    maxFileBytes = DEFAULT_MAX_FILE_BYTES,
  } = {}) {
    this.name = "cli-legacy-memory-projections";
    this.memoryStorePath = memoryStorePath;
    this.legacyDb = legacyDb;
    this.maxFileBytes = maxFileBytes;
  }

  async purge(request = {}) {
    const scopedIds = matchingEvidenceIds(
      request.evidenceRefs,
      LEGACY_SCOPED_STORE,
    );
    const sqliteIds = matchingEvidenceIds(
      request.evidenceRefs,
      LEGACY_SQLITE_STORE,
    );
    const scoped = purgeLegacyScopedFile(
      this.memoryStorePath,
      scopedIds,
      this.maxFileBytes,
    );
    const sqlite = purgeLegacySqlite(this.legacyDb, sqliteIds);
    const receipt = {
      store: this.name,
      status: "purged",
      memoryId: String(request.memoryId || ""),
      fence: String(request.fence || ""),
      targets: {
        [LEGACY_SCOPED_STORE]: scoped,
        [LEGACY_SQLITE_STORE]: sqlite,
      },
    };
    receipt.digest = canonicalDigest(
      receipt,
      "chainlesschain.cli-legacy-memory-purge-receipt/v1",
    );
    return receipt;
  }
}

export {
  DEFAULT_MAX_FILE_BYTES,
  LEGACY_SCOPED_STORE,
  LEGACY_SQLITE_STORE,
  matchingEvidenceIds,
  purgeLegacyScopedFile,
  purgeLegacySqlite,
};
