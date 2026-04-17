/**
 * Multimodal Collaboration — CLI port of Phase 27
 * (docs/design/modules/27_多模态协作.md).
 *
 * Desktop exposes 12 IPC handlers for ModalityFusion /
 * DocumentParser / MultimodalContext / MultimodalOutput.
 *
 * CLI port ships:
 *
 *   - 5 input modalities (text / document / image / audio / screen)
 *     with weighted fusion (same weights as desktop)
 *   - Session + artifact persistence in SQLite
 *   - Native parse for txt / md / csv / json; report-only for
 *     pdf / docx / xlsx (no heavy deps in CLI)
 *   - Context builder with 4000-token cap and heuristic token count
 *     (~chars/4). No cache TTL (CLI is one-shot).
 *   - 6 output formats: markdown / html / json / csv / slides
 *     (Reveal.js skeleton) / chart (ECharts option JSON)
 *
 * What does NOT port: OCR / ASR, real PDF/DOCX/XLSX parsing,
 * 5-minute cache, EventEmitter events, IPC channels.
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";

/* ── Constants ──────────────────────────────────────────── */

export const MODALITIES = Object.freeze([
  "text",
  "document",
  "image",
  "audio",
  "screen",
]);

export const MODALITY_WEIGHTS = Object.freeze({
  text: 1.0,
  document: 0.9,
  image: 0.8,
  audio: 0.7,
  screen: 0.6,
});

export const INPUT_FORMATS = Object.freeze([
  "pdf",
  "docx",
  "xlsx",
  "txt",
  "md",
  "csv",
  "json",
]);

export const NATIVE_FORMATS = Object.freeze(["txt", "md", "csv", "json"]);

export const OUTPUT_FORMATS = Object.freeze([
  "markdown",
  "html",
  "chart",
  "slides",
  "json",
  "csv",
]);

export const SESSION_STATUS = Object.freeze({
  ACTIVE: "active",
  COMPLETED: "completed",
});

export const DEFAULT_MAX_TOKENS = 4000;

const PRIORITY_ORDER = ["text", "document", "image", "audio", "screen"];

/* ── State ──────────────────────────────────────────────── */

let _contextCache = new Map(); // sessionId → { tokens, content, items }

/* ── Helpers ────────────────────────────────────────────── */

function _now() {
  return Date.now();
}

function _strip(row) {
  if (!row) return null;
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (k !== "_rowid_" && k !== "rowid") out[k] = v;
  }
  return out;
}

function _parseMaybe(raw) {
  if (raw == null) return null;
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch (_e) {
    return raw;
  }
}

function _estimateTokens(s) {
  if (!s) return 0;
  const str = typeof s === "string" ? s : JSON.stringify(s);
  return Math.ceil(str.length / 4);
}

/* ── Schema ─────────────────────────────────────────────── */

export function ensureMultimodalTables(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS multimodal_sessions (
    id TEXT PRIMARY KEY,
    modalities TEXT,
    context TEXT,
    status TEXT DEFAULT 'active',
    token_count INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS multimodal_artifacts (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    type TEXT NOT NULL,
    modality TEXT,
    format TEXT,
    content TEXT,
    metadata TEXT,
    created_at INTEGER NOT NULL
  )`);
}

/* ── Session management ─────────────────────────────────── */

export function createSession(db, { title, metadata } = {}) {
  const id = crypto.randomUUID();
  const now = _now();
  const meta = metadata
    ? typeof metadata === "string"
      ? metadata
      : JSON.stringify(metadata)
    : null;
  db.prepare(
    `INSERT INTO multimodal_sessions (id, modalities, context, status, token_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, JSON.stringify([]), meta, SESSION_STATUS.ACTIVE, 0, now, now);
  return { sessionId: id, createdAt: now };
}

export function getSession(db, sessionId) {
  const row = _strip(
    db.prepare("SELECT * FROM multimodal_sessions WHERE id = ?").get(sessionId),
  );
  if (!row) return null;
  return {
    id: row.id,
    modalities: _parseMaybe(row.modalities) || [],
    context: _parseMaybe(row.context),
    status: row.status,
    tokenCount: row.token_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listSessions(db, { status, limit = 50 } = {}) {
  let rows = db.prepare("SELECT * FROM multimodal_sessions").all();
  rows = rows.map(_strip);
  if (status) rows = rows.filter((r) => r.status === status);
  return rows
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, limit)
    .map((r) => ({
      id: r.id,
      status: r.status,
      tokenCount: r.token_count,
      modalities: _parseMaybe(r.modalities) || [],
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
}

export function completeSession(db, sessionId) {
  const s = getSession(db, sessionId);
  if (!s) return { completed: false, reason: "not_found" };
  db.prepare(
    "UPDATE multimodal_sessions SET status = ?, updated_at = ? WHERE id = ?",
  ).run(SESSION_STATUS.COMPLETED, _now(), sessionId);
  return { completed: true };
}

export function deleteSession(db, sessionId) {
  const s = getSession(db, sessionId);
  if (!s) return { deleted: false, reason: "not_found" };
  db.prepare("DELETE FROM multimodal_artifacts WHERE session_id = ?").run(
    sessionId,
  );
  db.prepare("DELETE FROM multimodal_sessions WHERE id = ?").run(sessionId);
  _contextCache.delete(sessionId);
  return { deleted: true };
}

/* ── Artifact storage ───────────────────────────────────── */

function _addArtifact(db, sessionId, kind) {
  const id = crypto.randomUUID();
  const now = _now();
  db.prepare(
    `INSERT INTO multimodal_artifacts (id, session_id, type, modality, format, content, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    sessionId,
    kind.type,
    kind.modality || null,
    kind.format || null,
    typeof kind.content === "string"
      ? kind.content
      : JSON.stringify(kind.content ?? null),
    kind.metadata ? JSON.stringify(kind.metadata) : null,
    now,
  );
  return { artifactId: id, createdAt: now };
}

export function listArtifacts(
  db,
  sessionId,
  { type, modality, limit = 100 } = {},
) {
  let rows = db
    .prepare("SELECT * FROM multimodal_artifacts WHERE session_id = ?")
    .all(sessionId);
  rows = rows.map(_strip);
  if (type) rows = rows.filter((r) => r.type === type);
  if (modality) rows = rows.filter((r) => r.modality === modality);
  return rows
    .sort((a, b) => a.created_at - b.created_at)
    .slice(0, limit)
    .map((r) => ({
      id: r.id,
      type: r.type,
      modality: r.modality,
      format: r.format,
      content: _parseMaybe(r.content),
      metadata: _parseMaybe(r.metadata),
      createdAt: r.created_at,
    }));
}

/* ── Modality operations ────────────────────────────────── */

export function addModality(db, sessionId, modality, data, { metadata } = {}) {
  if (!MODALITIES.includes(modality))
    return { added: false, reason: "unknown_modality" };
  const s = getSession(db, sessionId);
  if (!s) return { added: false, reason: "session_not_found" };

  const artifact = _addArtifact(db, sessionId, {
    type: "input",
    modality,
    format: metadata?.format || null,
    content: data,
    metadata,
  });

  const modalities = new Set(s.modalities);
  modalities.add(modality);
  db.prepare(
    "UPDATE multimodal_sessions SET modalities = ?, updated_at = ? WHERE id = ?",
  ).run(JSON.stringify([...modalities]), _now(), sessionId);
  _contextCache.delete(sessionId);

  return { added: true, modality, artifactId: artifact.artifactId };
}

export function getSessionModalities(db, sessionId) {
  const s = getSession(db, sessionId);
  if (!s) return [];
  const arts = listArtifacts(db, sessionId, { type: "input" });
  const byModality = {};
  for (const m of s.modalities) byModality[m] = [];
  for (const a of arts) {
    if (!byModality[a.modality]) byModality[a.modality] = [];
    byModality[a.modality].push({
      artifactId: a.id,
      content: a.content,
      format: a.format,
      metadata: a.metadata,
      createdAt: a.createdAt,
    });
  }
  return byModality;
}

export function fuse(db, sessionId) {
  const s = getSession(db, sessionId);
  if (!s) return { fused: false, reason: "session_not_found" };
  const arts = listArtifacts(db, sessionId, { type: "input" });
  if (arts.length === 0) return { fused: false, reason: "no_input" };

  // Weighted aggregation: concatenate contents ordered by priority,
  // compute sum(weight) and per-modality summary.
  const byModality = {};
  for (const a of arts) {
    if (!byModality[a.modality]) byModality[a.modality] = [];
    byModality[a.modality].push(a);
  }

  const parts = [];
  const summary = [];
  let totalWeight = 0;
  for (const m of PRIORITY_ORDER) {
    if (!byModality[m]) continue;
    const weight = MODALITY_WEIGHTS[m] || 0.5;
    totalWeight += weight;
    for (const a of byModality[m]) {
      const contentStr =
        typeof a.content === "string"
          ? a.content
          : JSON.stringify(a.content ?? "");
      parts.push(`[${m} w=${weight}] ${contentStr}`);
    }
    summary.push({
      modality: m,
      count: byModality[m].length,
      weight,
    });
  }

  const fused = parts.join("\n\n");
  return {
    fused: true,
    content: fused,
    summary,
    totalWeight: Number(totalWeight.toFixed(2)),
    tokenEstimate: _estimateTokens(fused),
  };
}

/* ── Document parsing ───────────────────────────────────── */

export function getSupportedFormats() {
  return { formats: [...INPUT_FORMATS], native: [...NATIVE_FORMATS] };
}

export function parseDocument(filePath, { content } = {}) {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  if (!INPUT_FORMATS.includes(ext))
    return { parsed: false, reason: "unsupported_format", ext };

  let text;
  if (content != null) {
    text = typeof content === "string" ? content : content.toString("utf-8");
  } else {
    try {
      text = fs.readFileSync(filePath, "utf-8");
    } catch (_e) {
      return { parsed: false, reason: "read_failed", ext };
    }
  }

  if (ext === "txt" || ext === "md") {
    return {
      parsed: true,
      format: ext,
      text,
      length: text.length,
      tokenEstimate: _estimateTokens(text),
    };
  }

  if (ext === "json") {
    let json;
    try {
      json = JSON.parse(text);
    } catch (_e) {
      return { parsed: false, reason: "invalid_json", ext };
    }
    return {
      parsed: true,
      format: "json",
      text,
      json,
      length: text.length,
      tokenEstimate: _estimateTokens(text),
    };
  }

  if (ext === "csv") {
    const rows = _parseCsv(text);
    return {
      parsed: true,
      format: "csv",
      text,
      rows,
      rowCount: rows.length,
      tokenEstimate: _estimateTokens(text),
    };
  }

  // pdf / docx / xlsx — not implemented in CLI port
  return {
    parsed: false,
    reason: "parser_not_available",
    ext,
    hint: `Install dedicated parser (pdf-parse / mammoth / xlsx) and use desktop for ${ext} parsing`,
  };
}

function _parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return [];
  const header = lines[0].split(",").map((c) => c.trim());
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(",").map((c) => c.trim());
    const row = {};
    header.forEach((h, idx) => {
      row[h] = cells[idx] ?? "";
    });
    out.push(row);
  }
  return out;
}

/* ── Context management ─────────────────────────────────── */

export function buildContext(
  db,
  sessionId,
  { maxTokens = DEFAULT_MAX_TOKENS } = {},
) {
  const s = getSession(db, sessionId);
  if (!s) return { built: false, reason: "session_not_found" };
  const arts = listArtifacts(db, sessionId, { type: "input" });
  if (arts.length === 0) return { built: false, reason: "no_input" };

  // Order artifacts by modality priority, then by createdAt
  const sorted = [...arts].sort((a, b) => {
    const pa = PRIORITY_ORDER.indexOf(a.modality);
    const pb = PRIORITY_ORDER.indexOf(b.modality);
    if (pa !== pb) return pa - pb;
    return a.createdAt - b.createdAt;
  });

  const items = [];
  let tokens = 0;
  for (const a of sorted) {
    const contentStr =
      typeof a.content === "string"
        ? a.content
        : JSON.stringify(a.content ?? "");
    const t = _estimateTokens(contentStr);
    if (tokens + t > maxTokens) {
      const remaining = maxTokens - tokens;
      if (remaining <= 0) break;
      const clipped = contentStr.slice(0, remaining * 4);
      items.push({
        modality: a.modality,
        content: clipped,
        tokens: _estimateTokens(clipped),
        truncated: true,
      });
      tokens += _estimateTokens(clipped);
      break;
    }
    items.push({
      modality: a.modality,
      content: contentStr,
      tokens: t,
      truncated: false,
    });
    tokens += t;
  }

  const content = items
    .map(
      (i) => `[${i.modality}${i.truncated ? " truncated" : ""}]\n${i.content}`,
    )
    .join("\n\n");

  const contextData = { items, tokens, maxTokens, content };
  _contextCache.set(sessionId, contextData);

  db.prepare(
    "UPDATE multimodal_sessions SET context = ?, token_count = ?, updated_at = ? WHERE id = ?",
  ).run(JSON.stringify(contextData), tokens, _now(), sessionId);

  return {
    built: true,
    tokens,
    maxTokens,
    itemCount: items.length,
    content,
    items,
  };
}

export function getContext(db, sessionId) {
  const cached = _contextCache.get(sessionId);
  if (cached) return cached;
  const s = getSession(db, sessionId);
  if (!s || !s.context) return null;
  return s.context;
}

export function clearContext(db, sessionId) {
  const s = getSession(db, sessionId);
  if (!s) return { cleared: false, reason: "session_not_found" };
  _contextCache.delete(sessionId);
  db.prepare(
    "UPDATE multimodal_sessions SET context = ?, token_count = ?, updated_at = ? WHERE id = ?",
  ).run(null, 0, _now(), sessionId);
  return { cleared: true };
}

export function trimContext(context, maxTokens) {
  if (!context || !Array.isArray(context.items))
    return { trimmed: false, reason: "invalid_context" };
  let tokens = 0;
  const items = [];
  for (const i of context.items) {
    const t = i.tokens ?? _estimateTokens(i.content);
    if (tokens + t > maxTokens) {
      const remaining = maxTokens - tokens;
      if (remaining <= 0) break;
      const clipped = (i.content || "").slice(0, remaining * 4);
      items.push({
        ...i,
        content: clipped,
        tokens: _estimateTokens(clipped),
        truncated: true,
      });
      tokens += _estimateTokens(clipped);
      break;
    }
    items.push(i);
    tokens += t;
  }
  const content = items
    .map(
      (i) => `[${i.modality}${i.truncated ? " truncated" : ""}]\n${i.content}`,
    )
    .join("\n\n");
  return { trimmed: true, items, tokens, maxTokens, content };
}

/* ── Output generation ──────────────────────────────────── */

export function getOutputFormats() {
  return [...OUTPUT_FORMATS];
}

export function generateOutput(db, sessionId, content, format, options = {}) {
  if (!OUTPUT_FORMATS.includes(format))
    return { generated: false, reason: "unsupported_format", format };

  let produced;
  switch (format) {
    case "markdown":
      produced =
        typeof content === "string"
          ? content
          : JSON.stringify(content, null, 2);
      break;
    case "html":
      produced = _renderHtml(content, options);
      break;
    case "json":
      produced =
        typeof content === "string"
          ? JSON.stringify({ content }, null, 2)
          : JSON.stringify(content, null, 2);
      break;
    case "csv":
      produced = _renderCsv(content);
      break;
    case "slides":
      produced = _renderSlides(content, options);
      break;
    case "chart":
      produced = _renderChart(content, options);
      break;
    default:
      return { generated: false, reason: "unsupported_format", format };
  }

  if (sessionId) {
    const s = getSession(db, sessionId);
    if (s) {
      _addArtifact(db, sessionId, {
        type: "output",
        format,
        content: produced,
      });
    }
  }

  return {
    generated: true,
    format,
    content: produced,
    size: typeof produced === "string" ? produced.length : 0,
  };
}

function _renderHtml(content, options) {
  const title = options.title || "Multimodal Output";
  const body =
    typeof content === "string"
      ? content
      : `<pre>${JSON.stringify(content, null, 2)}</pre>`;
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>${title}</title></head>
<body>
${body}
</body></html>`;
}

function _renderCsv(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  if (content.length === 0) return "";
  const header = Object.keys(content[0]);
  const lines = [header.join(",")];
  for (const row of content) {
    lines.push(header.map((h) => String(row[h] ?? "")).join(","));
  }
  return lines.join("\n");
}

function _renderSlides(content, options) {
  const title = options.title || "Multimodal Slides";
  const slides = Array.isArray(content)
    ? content
    : typeof content === "string"
      ? content.split(/\n---\n/)
      : [String(content)];
  const sections = slides
    .map((s) => `<section>${_escapeHtml(s)}</section>`)
    .join("\n");
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>${title}</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@5.0.0/dist/reveal.min.css">
</head><body>
<div class="reveal"><div class="slides">
${sections}
</div></div>
<script src="https://cdn.jsdelivr.net/npm/reveal.js@5.0.0/dist/reveal.min.js"></script>
<script>Reveal.initialize();</script>
</body></html>`;
}

function _renderChart(data, options) {
  const chartType = options.chartType || "line";
  const option = {
    title: { text: options.title || "Chart" },
    tooltip: {},
    xAxis: { data: data?.categories || [] },
    yAxis: {},
    series: Array.isArray(data?.series)
      ? data.series.map((s) => ({ ...s, type: s.type || chartType }))
      : [
          {
            name: options.title || "series",
            type: chartType,
            data: data?.values || [],
          },
        ],
  };
  return JSON.stringify(option, null, 2);
}

function _escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/* ── Stats ──────────────────────────────────────────────── */

export function getMultimodalStats(db) {
  const rows = db
    .prepare("SELECT * FROM multimodal_sessions")
    .all()
    .map(_strip);
  const arts = db
    .prepare("SELECT * FROM multimodal_artifacts")
    .all()
    .map(_strip);
  const byStatus = {};
  let totalTokens = 0;
  for (const r of rows) {
    byStatus[r.status] = (byStatus[r.status] || 0) + 1;
    totalTokens += r.token_count || 0;
  }
  const byModality = {};
  let inputs = 0;
  let outputs = 0;
  for (const a of arts) {
    if (a.type === "input") inputs++;
    else if (a.type === "output") outputs++;
    if (a.modality) byModality[a.modality] = (byModality[a.modality] || 0) + 1;
  }
  return {
    sessions: rows.length,
    byStatus,
    artifacts: arts.length,
    inputs,
    outputs,
    byModality,
    totalTokens,
  };
}

/* ── Reset (tests) ──────────────────────────────────────── */

export function _resetState() {
  _contextCache.clear();
}
