import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { getHomeDir } from "./paths.js";
import { MAX_RECENT_DENIALS, formatDenialChain } from "./repl-denials.js";

export const RECENT_DENIALS_VERSION = 1;
export const DEFAULT_RECENT_DENIAL_LIMIT = 100;

export const _deps = {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
  getHomeDir,
  now: () => Date.now(),
};

export function recentDenialsPath() {
  return join(_deps.getHomeDir(), "recent-denials.json");
}

function emptyStore() {
  return { version: RECENT_DENIALS_VERSION, denials: [] };
}

function readStore(file = recentDenialsPath()) {
  if (!_deps.existsSync(file)) return emptyStore();
  try {
    const parsed = JSON.parse(_deps.readFileSync(file, "utf8"));
    return {
      version: RECENT_DENIALS_VERSION,
      denials: Array.isArray(parsed?.denials) ? parsed.denials : [],
    };
  } catch {
    return emptyStore();
  }
}

function writeStore(store, file = recentDenialsPath()) {
  _deps.mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  _deps.writeFileSync(tmp, JSON.stringify(store, null, 2) + "\n", "utf8");
  _deps.renameSync(tmp, file);
}

function normalizeRecord(record, metadata = {}) {
  if (!record || typeof record !== "object") return null;
  return {
    at: typeof record.at === "number" ? record.at : _deps.now(),
    tool: String(record.tool || "?"),
    summary: String(record.summary || ""),
    reason: String(record.reason || ""),
    via: String(record.via || "policy"),
    rule: record.rule == null ? null : String(record.rule),
    count: Number.isFinite(record.count) && record.count > 1 ? record.count : 1,
    sessionId: metadata.sessionId || record.sessionId || null,
    permissionMode: metadata.permissionMode || record.permissionMode || null,
    cwd: metadata.cwd || record.cwd || null,
    source: metadata.source || record.source || "agent",
    // Layer-by-layer explanation (settings-rules → shell-policy →
    // approval-gate) when the denial carried one; null for older records.
    chain: Array.isArray(record.chain) ? record.chain : null,
  };
}

function sameRecentDenial(a, b) {
  return (
    a &&
    b &&
    a.tool === b.tool &&
    a.summary === b.summary &&
    a.via === b.via &&
    a.rule === b.rule &&
    a.sessionId === b.sessionId &&
    a.permissionMode === b.permissionMode &&
    a.cwd === b.cwd &&
    a.source === b.source
  );
}

function parseLimit(value, fallback = DEFAULT_RECENT_DENIAL_LIMIT) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export function appendRecentDenials(records, metadata = {}, options = {}) {
  const incoming = Array.isArray(records) ? records : [records];
  const normalized = incoming
    .map((record) => normalizeRecord(record, metadata))
    .filter(Boolean);
  if (!normalized.length) return readRecentDenials(options);

  const max = parseLimit(options.max || options.limit);
  const file = options.file || recentDenialsPath();
  const store = readStore(file);
  for (const record of normalized) {
    const last = store.denials[store.denials.length - 1];
    if (sameRecentDenial(last, record)) {
      last.count = (last.count || 1) + (record.count || 1);
      last.at = record.at;
      if (record.reason) last.reason = record.reason;
    } else {
      store.denials.push(record);
    }
  }
  while (store.denials.length > max) store.denials.shift();
  writeStore(store, file);
  return store.denials.slice(-Math.min(max, store.denials.length));
}

export function readRecentDenials(options = {}) {
  const max = parseLimit(options.limit);
  const store = readStore(options.file || recentDenialsPath());
  return store.denials.slice(-Math.min(max, store.denials.length));
}

export function clearRecentDenials(options = {}) {
  const file = options.file || recentDenialsPath();
  writeStore(emptyStore(), file);
  return { file, cleared: true };
}

export function formatRecentDenials(records, options = {}) {
  const now = typeof options.now === "number" ? options.now : _deps.now();
  const denials = Array.isArray(records) ? records : [];
  if (!denials.length) return "  (no recent policy denials)";
  const lines = [
    `  Recent policy denials (most recent first, ${denials.length}):`,
  ];
  for (let i = denials.length - 1; i >= 0; i--) {
    const d = denials[i] || {};
    const ago =
      typeof d.at === "number"
        ? ` · ${Math.max(0, Math.round((now - d.at) / 1000))}s ago`
        : "";
    const where = d.rule ? `${d.via}:${d.rule}` : d.via || "policy";
    const what = d.summary ? `${d.tool} ${d.summary}` : d.tool || "?";
    const times = d.count > 1 ? ` x${d.count}` : "";
    const session = d.sessionId ? ` · session ${d.sessionId}` : "";
    const mode = d.permissionMode ? ` · mode ${d.permissionMode}` : "";
    lines.push(`  - ${what}${times}  [${where}${session}${mode}${ago}]`);
    if (d.cwd) lines.push(`      cwd: ${d.cwd}`);
    const chainLine = formatDenialChain(d.chain);
    if (chainLine) lines.push(`      chain: ${chainLine}`);
    if (d.reason) lines.push(`      ${d.reason}`);
  }
  return lines.join("\n");
}

export function recentDenialRetentionLimit() {
  return Math.max(DEFAULT_RECENT_DENIAL_LIMIT, MAX_RECENT_DENIALS);
}
