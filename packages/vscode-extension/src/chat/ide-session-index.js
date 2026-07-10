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

function parseIndex(raw) {
  let parsed;
  try {
    parsed = JSON.parse(String(raw || "").trim());
  } catch {
    return [];
  }
  const rows = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.sessions)
      ? parsed.sessions
      : [];
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

function readIdeSessionIndex({ file = defaultIndexFile(), deps = fs } = {}) {
  try {
    return parseIndex(deps.readFileSync(file, "utf8"));
  } catch {
    return [];
  }
}

function writeIdeSessionIndex(
  records,
  { file = defaultIndexFile(), deps = fs } = {},
) {
  const dir = path.dirname(file);
  deps.mkdirSync(dir, { recursive: true });
  const body = JSON.stringify({ version: 1, sessions: records || [] }, null, 2);
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  deps.writeFileSync(tmp, body, { encoding: "utf8", mode: 0o600 });
  try {
    deps.chmodSync(tmp, 0o600);
  } catch {
    /* best-effort */
  }
  deps.renameSync(tmp, file);
  return file;
}

function upsertIdeSessionRecord(record, opts = {}) {
  const now = opts.now instanceof Date ? opts.now : new Date();
  const current = readIdeSessionIndex(opts);
  const sessions = mergeRecords(current, record, { now });
  writeIdeSessionIndex(sessions, opts);
  return normalizeRecord(record, { now });
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
  const current = readIdeSessionIndex(opts);
  const existing = current.find((r) => r.id === key);
  const record = {
    ...(existing || { id: key }),
    title: nextTitle,
    updatedAt: now.toISOString(),
  };
  writeIdeSessionIndex(mergeRecords(current, record, { now }), opts);
  return normalizeRecord(record, { now });
}

/** Drop a session from the shared index. Returns whether anything was removed. */
function removeIdeSessionRecord(id, opts = {}) {
  const key = cleanString(id);
  if (!key) return false;
  const current = readIdeSessionIndex(opts);
  const next = current.filter((r) => r.id !== key);
  if (next.length === current.length) return false;
  writeIdeSessionIndex(next, opts);
  return true;
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
  writeIdeSessionIndex,
};
