/**
 * Shared IDE session index.
 *
 * VS Code and JetBrains both write ~/.chainlesschain/ide/session-index.json so
 * a session created in one IDE is discoverable from the other's session picker.
 * This deliberately stores metadata only; transcripts stay in the CLI session
 * store and are resumed by id.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");

const VALID_STATUS = new Set([
  "running",
  "waiting_approval",
  "errored",
  "stopped",
  "completed",
]);
const MAX_RECORDS = 200;
const DEFAULT_LOCK_TIMEOUT_MS = 2000;
const DEFAULT_LOCK_STALE_MS = 30000;
const DEFAULT_LOCK_RETRY_MS = 25;

function defaultIndexFile(home = os.homedir()) {
  return path.join(home, ".chainlesschain", "ide", "session-index.json");
}

function cleanString(v) {
  return typeof v === "string" ? v.trim() : "";
}

function cleanStatus(v) {
  const s = cleanString(v).replace(/\s+/g, "_").toLowerCase();
  return VALID_STATUS.has(s) ? s : "stopped";
}

function iso(v, fallback) {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString();
  if (typeof v === "string" && v) {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return fallback;
}

function normalizeRecord(input = {}, { now = new Date() } = {}) {
  const id = cleanString(input.id || input.sessionId);
  if (!id) return null;
  const updatedAt = iso(input.updatedAt, now.toISOString());
  const createdAt = iso(input.createdAt, updatedAt);
  const folders = Array.isArray(input.workspaceFolders)
    ? input.workspaceFolders.map(cleanString).filter(Boolean).slice(0, 8)
    : [];
  const workspace = cleanString(input.workspace) || folders[0] || "";
  return {
    id,
    title: cleanString(input.title),
    ide: cleanString(input.ide) || "unknown",
    conversationId: cleanString(input.conversationId),
    workspace,
    workspaceFolders: folders,
    status: cleanStatus(input.status),
    mode: cleanString(input.mode) || "default",
    createdAt,
    updatedAt,
  };
}

function indexError(code, message, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  return error;
}

function parseIndex(raw, { failIfUnavailable = false } = {}) {
  let parsed;
  try {
    parsed = JSON.parse(String(raw || "").trim());
  } catch (cause) {
    if (failIfUnavailable) {
      throw indexError(
        "IDE_SESSION_INDEX_CORRUPT",
        "IDE session index contains invalid JSON",
        cause,
      );
    }
    return [];
  }
  const rows = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.sessions)
      ? parsed.sessions
      : [];
  if (
    failIfUnavailable &&
    !Array.isArray(parsed) &&
    !Array.isArray(parsed?.sessions)
  ) {
    throw indexError(
      "IDE_SESSION_INDEX_CORRUPT",
      "IDE session index must contain a sessions array",
    );
  }
  return rows.map((r) => normalizeRecord(r)).filter(Boolean);
}

function mergeRecords(existing, incoming, { limit = MAX_RECORDS, now } = {}) {
  const byId = new Map();
  for (const row of existing || []) {
    const rec = normalizeRecord(row, { now });
    if (rec) byId.set(rec.id, rec);
  }
  for (const row of Array.isArray(incoming) ? incoming : [incoming]) {
    const rec = normalizeRecord(row, { now });
    if (!rec) continue;
    const prev = byId.get(rec.id);
    byId.set(rec.id, {
      ...(prev || {}),
      ...rec,
      createdAt: prev?.createdAt || rec.createdAt,
      title: rec.title || prev?.title || "",
      workspace: rec.workspace || prev?.workspace || "",
      workspaceFolders: rec.workspaceFolders.length
        ? rec.workspaceFolders
        : prev?.workspaceFolders || [],
    });
  }
  return [...byId.values()]
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
    .slice(0, limit);
}

function readIdeSessionIndex({
  file = defaultIndexFile(),
  deps = fs,
  failIfUnavailable = false,
} = {}) {
  try {
    return parseIndex(deps.readFileSync(file, "utf8"), {
      failIfUnavailable,
    });
  } catch (cause) {
    if (cause?.code === "ENOENT") return [];
    if (failIfUnavailable || cause?.code === "IDE_SESSION_INDEX_CORRUPT") {
      throw cause;
    }
    return [];
  }
}

function sleepSync(ms) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      // SharedArrayBuffer is unavailable; retain a bounded fallback.
    }
  }
}

/**
 * Cross-process protocol shared with the JetBrains implementation. The lock is
 * an atomic sibling DIRECTORY (`session-index.json.lock`), not an advisory file
 * lock, so Node and JVM writers exclude one another on Windows and POSIX.
 */
function withIdeSessionIndexLock(file, body, opts = {}) {
  const deps = opts.deps || fs;
  const timeoutMs = opts.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
  const staleMs = opts.lockStaleMs ?? DEFAULT_LOCK_STALE_MS;
  const retryMs = opts.lockRetryMs ?? DEFAULT_LOCK_RETRY_MS;
  const nowMs = opts.nowMs || Date.now;
  const sleep = opts.sleep || sleepSync;
  const lockDir = `${file}.lock`;
  const deadline = nowMs() + timeoutMs;
  let held = false;

  try {
    deps.mkdirSync(path.dirname(file), { recursive: true });
  } catch (cause) {
    throw indexError(
      "IDE_SESSION_INDEX_PREPARE_FAILED",
      `Could not prepare IDE session index directory: ${path.dirname(file)}`,
      cause,
    );
  }

  for (;;) {
    try {
      deps.mkdirSync(lockDir);
      held = true;
      break;
    } catch (cause) {
      if (cause?.code !== "EEXIST") {
        throw indexError(
          "IDE_SESSION_INDEX_LOCK_UNAVAILABLE",
          `Could not acquire IDE session index lock: ${lockDir}`,
          cause,
        );
      }
      try {
        const age = nowMs() - deps.statSync(lockDir).mtimeMs;
        if (age > staleMs) {
          deps.rmSync(lockDir, { recursive: true, force: true });
          continue;
        }
      } catch {
        // The holder may have released between mkdir and stat; retry boundedly.
      }
      if (nowMs() >= deadline) {
        throw indexError(
          "IDE_SESSION_INDEX_LOCK_UNAVAILABLE",
          `Timed out acquiring IDE session index lock: ${lockDir}`,
        );
      }
      sleep(retryMs);
    }
  }

  try {
    return body();
  } finally {
    if (held) {
      try {
        deps.rmSync(lockDir, { recursive: true, force: true });
      } catch {
        // The mutation is already durable. A stale lock is reclaimed later.
      }
    }
  }
}

function writeIdeSessionIndexUnlocked(
  records,
  { file = defaultIndexFile(), deps = fs } = {},
) {
  const dir = path.dirname(file);
  deps.mkdirSync(dir, { recursive: true });
  const body = JSON.stringify({ version: 1, sessions: records || [] }, null, 2);
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    deps.writeFileSync(tmp, body, { encoding: "utf8", mode: 0o600 });
    try {
      deps.chmodSync(tmp, 0o600);
    } catch {
      /* best-effort */
    }
    deps.renameSync(tmp, file);
  } catch (cause) {
    try {
      deps.rmSync(tmp, { force: true });
    } catch {
      // Preserve the original persistence error.
    }
    throw indexError(
      "IDE_SESSION_INDEX_WRITE_FAILED",
      `Could not atomically write IDE session index: ${file}`,
      cause,
    );
  }
  return file;
}

function writeIdeSessionIndex(records, opts = {}) {
  const file = opts.file || defaultIndexFile();
  return withIdeSessionIndexLock(
    file,
    () => writeIdeSessionIndexUnlocked(records, { ...opts, file }),
    opts,
  );
}

function upsertIdeSessionRecord(record, opts = {}) {
  const now = opts.now instanceof Date ? opts.now : new Date();
  const file = opts.file || defaultIndexFile();
  return withIdeSessionIndexLock(
    file,
    () => {
      const current = readIdeSessionIndex({
        ...opts,
        file,
        failIfUnavailable: true,
      });
      const sessions = mergeRecords(current, record, { now });
      writeIdeSessionIndexUnlocked(sessions, { ...opts, file });
      return normalizeRecord(record, { now });
    },
    opts,
  );
}

/**
 * Rename a session in the shared index. For sessions the index has never seen
 * (CLI-only sessions) a minimal overlay record is created — the picker merge
 * prefers the IDE-index title, so the rename shows up for those too.
 */
function renameIdeSessionRecord(id, title, opts = {}) {
  const key = cleanString(id);
  const nextTitle = cleanString(title);
  if (!key || !nextTitle) return null;
  const now = opts.now instanceof Date ? opts.now : new Date();
  const file = opts.file || defaultIndexFile();
  return withIdeSessionIndexLock(
    file,
    () => {
      const current = readIdeSessionIndex({
        ...opts,
        file,
        failIfUnavailable: true,
      });
      const existing = current.find((r) => r.id === key);
      const record = {
        ...(existing || { id: key }),
        title: nextTitle,
        updatedAt: now.toISOString(),
      };
      writeIdeSessionIndexUnlocked(mergeRecords(current, record, { now }), {
        ...opts,
        file,
      });
      return normalizeRecord(record, { now });
    },
    opts,
  );
}

/** Drop a session from the shared index. Returns whether anything was removed. */
function removeIdeSessionRecord(id, opts = {}) {
  const key = cleanString(id);
  if (!key) return false;
  const file = opts.file || defaultIndexFile();
  return withIdeSessionIndexLock(
    file,
    () => {
      const current = readIdeSessionIndex({
        ...opts,
        file,
        failIfUnavailable: true,
      });
      const next = current.filter((r) => r.id !== key);
      if (next.length === current.length) return false;
      writeIdeSessionIndexUnlocked(next, { ...opts, file });
      return true;
    },
    opts,
  );
}

function toSessionItems(records) {
  return (records || []).map((s) => ({
    id: s.id,
    title: s.title || "",
    updatedAt: s.updatedAt || null,
    store: `ide:${s.ide || "unknown"}`,
    status: s.status || "stopped",
    workspace: s.workspace || "",
  }));
}

module.exports = {
  defaultIndexFile,
  mergeRecords,
  normalizeRecord,
  parseIndex,
  readIdeSessionIndex,
  removeIdeSessionRecord,
  renameIdeSessionRecord,
  toSessionItems,
  upsertIdeSessionRecord,
  withIdeSessionIndexLock,
  writeIdeSessionIndex,
};
