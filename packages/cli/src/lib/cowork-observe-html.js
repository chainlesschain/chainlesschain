/**
 * Cowork Observe HTML — builds a static single-page dashboard from an
 * aggregate snapshot. Pure function; no I/O.
 *
 * @module cowork-observe-html
 */

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeJsonForScript(obj) {
  return JSON.stringify(obj)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}

/**
 * Build a self-contained HTML dashboard from aggregate output.
 * @param {object} data - result of `aggregate()`
 * @returns {string} full HTML document
 */
export function buildHtml(data) {
  const safeJson = escapeJsonForScript(data || {});
  const win = data?.window || {};
  const t = data?.tasks || {};
  const templates = data?.templates || [];
  const failures = data?.failures || [];
  const next = data?.schedules?.nextTriggers || [];

  const templateRows = templates
    .slice(0, 10)
    .map(
      (row) =>
        `<tr><td>${escapeHtml(row.templateName || row.templateId)}</td>` +
        `<td>${row.runs}</td><td>${Math.round((row.successRate || 0) * 100)}%</td>` +
        `<td>${row.avgTokens || 0}</td></tr>`,
    )
    .join("");

  const failureRows = failures
    .slice(0, 10)
    .map(
      (row) =>
        `<tr><td>${escapeHtml(row.templateName || row.templateId)}</td>` +
        `<td>${row.failureCount}</td>` +
        `<td>${escapeHtml((row.commonSummaries?.[0]?.summary || "—").slice(0, 80))}</td></tr>`,
    )
    .join("");

  const nextRows = next
    .map(
      (n) =>
        `<tr><td>${escapeHtml(n.at)}</td><td>${escapeHtml(n.cron)}</td><td>${escapeHtml(n.scheduleId || "—")}</td></tr>`,
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Cowork Observe — ChainlessChain</title>
  <script>window.__COWORK_OBSERVE__ = ${safeJson};</script>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; padding: 20px; background: #0e1116; color: #e6edf3; }
    h1 { margin: 0 0 8px; font-size: 22px; }
    h2 { margin: 24px 0 8px; font-size: 16px; color: #9ec5ff; }
    .meta { color: #7d8590; font-size: 13px; }
    .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin: 16px 0; }
    .card { background: #161b22; border: 1px solid #30363d; border-radius: 6px; padding: 14px; }
    .card .num { font-size: 24px; font-weight: 600; color: #58a6ff; }
    .card .lbl { color: #7d8590; font-size: 12px; margin-top: 4px; }
    table { width: 100%; border-collapse: collapse; background: #161b22; border: 1px solid #30363d; border-radius: 6px; overflow: hidden; }
    th, td { padding: 8px 12px; text-align: left; border-bottom: 1px solid #30363d; font-size: 13px; }
    th { background: #1f242c; color: #9ec5ff; font-weight: 500; }
    tr:last-child td { border-bottom: none; }
    .empty { color: #7d8590; font-style: italic; padding: 12px 0; }
  </style>
</head>
<body>
  <h1>Cowork Observe</h1>
  <div class="meta">Window: ${escapeHtml(win.days || 7)} days · ${escapeHtml(win.from || "")} → ${escapeHtml(win.to || "")}</div>
  <div class="cards">
    <div class="card"><div class="num">${t.total || 0}</div><div class="lbl">Tasks</div></div>
    <div class="card"><div class="num">${Math.round((t.successRate || 0) * 100)}%</div><div class="lbl">Success rate</div></div>
    <div class="card"><div class="num">${t.failed || 0}</div><div class="lbl">Failed</div></div>
    <div class="card"><div class="num">${t.avgTokens || 0}</div><div class="lbl">Avg tokens</div></div>
    <div class="card"><div class="num">${data?.schedules?.active || 0}</div><div class="lbl">Active schedules</div></div>
  </div>

  <h2>Templates (top 10 by runs)</h2>
  ${templates.length ? `<table><thead><tr><th>Template</th><th>Runs</th><th>Success</th><th>Avg tokens</th></tr></thead><tbody>${templateRows}</tbody></table>` : `<div class="empty">No template runs in window.</div>`}

  <h2>Failures (top 10)</h2>
  ${failures.length ? `<table><thead><tr><th>Template</th><th>Count</th><th>Common summary</th></tr></thead><tbody>${failureRows}</tbody></table>` : `<div class="empty">No failures in window — nice.</div>`}

  <h2>Next scheduled triggers</h2>
  ${next.length ? `<table><thead><tr><th>At</th><th>Cron</th><th>Schedule</th></tr></thead><tbody>${nextRows}</tbody></table>` : `<div class="empty">No upcoming triggers.</div>`}
</body>
</html>`;
}

// =====================================================================
// cowork-observe-html V2 governance overlay (iter27)
// =====================================================================
export const COHTGOV_PROFILE_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  STALE: "stale",
  ARCHIVED: "archived",
});
export const COHTGOV_RENDER_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  RENDERING: "rendering",
  RENDERED: "rendered",
  FAILED: "failed",
  CANCELLED: "cancelled",
});
const _cohtgovPTrans = new Map([
  [
    COHTGOV_PROFILE_MATURITY_V2.PENDING,
    new Set([
      COHTGOV_PROFILE_MATURITY_V2.ACTIVE,
      COHTGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    COHTGOV_PROFILE_MATURITY_V2.ACTIVE,
    new Set([
      COHTGOV_PROFILE_MATURITY_V2.STALE,
      COHTGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    COHTGOV_PROFILE_MATURITY_V2.STALE,
    new Set([
      COHTGOV_PROFILE_MATURITY_V2.ACTIVE,
      COHTGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [COHTGOV_PROFILE_MATURITY_V2.ARCHIVED, new Set()],
]);
const _cohtgovPTerminal = new Set([COHTGOV_PROFILE_MATURITY_V2.ARCHIVED]);
const _cohtgovJTrans = new Map([
  [
    COHTGOV_RENDER_LIFECYCLE_V2.QUEUED,
    new Set([
      COHTGOV_RENDER_LIFECYCLE_V2.RENDERING,
      COHTGOV_RENDER_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [
    COHTGOV_RENDER_LIFECYCLE_V2.RENDERING,
    new Set([
      COHTGOV_RENDER_LIFECYCLE_V2.RENDERED,
      COHTGOV_RENDER_LIFECYCLE_V2.FAILED,
      COHTGOV_RENDER_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [COHTGOV_RENDER_LIFECYCLE_V2.RENDERED, new Set()],
  [COHTGOV_RENDER_LIFECYCLE_V2.FAILED, new Set()],
  [COHTGOV_RENDER_LIFECYCLE_V2.CANCELLED, new Set()],
]);
const _cohtgovPsV2 = new Map();
const _cohtgovJsV2 = new Map();
let _cohtgovMaxActive = 6,
  _cohtgovMaxPending = 15,
  _cohtgovIdleMs = 30 * 24 * 60 * 60 * 1000,
  _cohtgovStuckMs = 60 * 1000;
function _cohtgovPos(n, label) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${label} must be positive integer`);
  return v;
}
function _cohtgovCheckP(from, to) {
  const a = _cohtgovPTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid cohtgov profile transition ${from} → ${to}`);
}
function _cohtgovCheckJ(from, to) {
  const a = _cohtgovJTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid cohtgov render transition ${from} → ${to}`);
}
function _cohtgovCountActive(owner) {
  let c = 0;
  for (const p of _cohtgovPsV2.values())
    if (p.owner === owner && p.status === COHTGOV_PROFILE_MATURITY_V2.ACTIVE)
      c++;
  return c;
}
function _cohtgovCountPending(profileId) {
  let c = 0;
  for (const j of _cohtgovJsV2.values())
    if (
      j.profileId === profileId &&
      (j.status === COHTGOV_RENDER_LIFECYCLE_V2.QUEUED ||
        j.status === COHTGOV_RENDER_LIFECYCLE_V2.RENDERING)
    )
      c++;
  return c;
}
export function setMaxActiveCohtgovProfilesPerOwnerV2(n) {
  _cohtgovMaxActive = _cohtgovPos(n, "maxActiveCohtgovProfilesPerOwner");
}
export function getMaxActiveCohtgovProfilesPerOwnerV2() {
  return _cohtgovMaxActive;
}
export function setMaxPendingCohtgovRendersPerProfileV2(n) {
  _cohtgovMaxPending = _cohtgovPos(n, "maxPendingCohtgovRendersPerProfile");
}
export function getMaxPendingCohtgovRendersPerProfileV2() {
  return _cohtgovMaxPending;
}
export function setCohtgovProfileIdleMsV2(n) {
  _cohtgovIdleMs = _cohtgovPos(n, "cohtgovProfileIdleMs");
}
export function getCohtgovProfileIdleMsV2() {
  return _cohtgovIdleMs;
}
export function setCohtgovRenderStuckMsV2(n) {
  _cohtgovStuckMs = _cohtgovPos(n, "cohtgovRenderStuckMs");
}
export function getCohtgovRenderStuckMsV2() {
  return _cohtgovStuckMs;
}
export function _resetStateCoworkObserveHtmlGovV2() {
  _cohtgovPsV2.clear();
  _cohtgovJsV2.clear();
  _cohtgovMaxActive = 6;
  _cohtgovMaxPending = 15;
  _cohtgovIdleMs = 30 * 24 * 60 * 60 * 1000;
  _cohtgovStuckMs = 60 * 1000;
}
export function registerCohtgovProfileV2({
  id,
  owner,
  template,
  metadata,
} = {}) {
  if (!id || !owner) throw new Error("id and owner required");
  if (_cohtgovPsV2.has(id))
    throw new Error(`cohtgov profile ${id} already exists`);
  const now = Date.now();
  const p = {
    id,
    owner,
    template: template || "default",
    status: COHTGOV_PROFILE_MATURITY_V2.PENDING,
    createdAt: now,
    updatedAt: now,
    lastTouchedAt: now,
    activatedAt: null,
    archivedAt: null,
    metadata: { ...(metadata || {}) },
  };
  _cohtgovPsV2.set(id, p);
  return { ...p, metadata: { ...p.metadata } };
}
export function activateCohtgovProfileV2(id) {
  const p = _cohtgovPsV2.get(id);
  if (!p) throw new Error(`cohtgov profile ${id} not found`);
  const isInitial = p.status === COHTGOV_PROFILE_MATURITY_V2.PENDING;
  _cohtgovCheckP(p.status, COHTGOV_PROFILE_MATURITY_V2.ACTIVE);
  if (isInitial && _cohtgovCountActive(p.owner) >= _cohtgovMaxActive)
    throw new Error(`max active cohtgov profiles for owner ${p.owner} reached`);
  const now = Date.now();
  p.status = COHTGOV_PROFILE_MATURITY_V2.ACTIVE;
  p.updatedAt = now;
  p.lastTouchedAt = now;
  if (!p.activatedAt) p.activatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function staleCohtgovProfileV2(id) {
  const p = _cohtgovPsV2.get(id);
  if (!p) throw new Error(`cohtgov profile ${id} not found`);
  _cohtgovCheckP(p.status, COHTGOV_PROFILE_MATURITY_V2.STALE);
  p.status = COHTGOV_PROFILE_MATURITY_V2.STALE;
  p.updatedAt = Date.now();
  return { ...p, metadata: { ...p.metadata } };
}
export function archiveCohtgovProfileV2(id) {
  const p = _cohtgovPsV2.get(id);
  if (!p) throw new Error(`cohtgov profile ${id} not found`);
  _cohtgovCheckP(p.status, COHTGOV_PROFILE_MATURITY_V2.ARCHIVED);
  const now = Date.now();
  p.status = COHTGOV_PROFILE_MATURITY_V2.ARCHIVED;
  p.updatedAt = now;
  if (!p.archivedAt) p.archivedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function touchCohtgovProfileV2(id) {
  const p = _cohtgovPsV2.get(id);
  if (!p) throw new Error(`cohtgov profile ${id} not found`);
  if (_cohtgovPTerminal.has(p.status))
    throw new Error(`cannot touch terminal cohtgov profile ${id}`);
  const now = Date.now();
  p.lastTouchedAt = now;
  p.updatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function getCohtgovProfileV2(id) {
  const p = _cohtgovPsV2.get(id);
  if (!p) return null;
  return { ...p, metadata: { ...p.metadata } };
}
export function listCohtgovProfilesV2() {
  return [..._cohtgovPsV2.values()].map((p) => ({
    ...p,
    metadata: { ...p.metadata },
  }));
}
export function createCohtgovRenderV2({ id, profileId, page, metadata } = {}) {
  if (!id || !profileId) throw new Error("id and profileId required");
  if (_cohtgovJsV2.has(id))
    throw new Error(`cohtgov render ${id} already exists`);
  if (!_cohtgovPsV2.has(profileId))
    throw new Error(`cohtgov profile ${profileId} not found`);
  if (_cohtgovCountPending(profileId) >= _cohtgovMaxPending)
    throw new Error(
      `max pending cohtgov renders for profile ${profileId} reached`,
    );
  const now = Date.now();
  const j = {
    id,
    profileId,
    page: page || "",
    status: COHTGOV_RENDER_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    settledAt: null,
    metadata: { ...(metadata || {}) },
  };
  _cohtgovJsV2.set(id, j);
  return { ...j, metadata: { ...j.metadata } };
}
export function renderingCohtgovRenderV2(id) {
  const j = _cohtgovJsV2.get(id);
  if (!j) throw new Error(`cohtgov render ${id} not found`);
  _cohtgovCheckJ(j.status, COHTGOV_RENDER_LIFECYCLE_V2.RENDERING);
  const now = Date.now();
  j.status = COHTGOV_RENDER_LIFECYCLE_V2.RENDERING;
  j.updatedAt = now;
  if (!j.startedAt) j.startedAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function completeRenderCohtgovV2(id) {
  const j = _cohtgovJsV2.get(id);
  if (!j) throw new Error(`cohtgov render ${id} not found`);
  _cohtgovCheckJ(j.status, COHTGOV_RENDER_LIFECYCLE_V2.RENDERED);
  const now = Date.now();
  j.status = COHTGOV_RENDER_LIFECYCLE_V2.RENDERED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function failCohtgovRenderV2(id, reason) {
  const j = _cohtgovJsV2.get(id);
  if (!j) throw new Error(`cohtgov render ${id} not found`);
  _cohtgovCheckJ(j.status, COHTGOV_RENDER_LIFECYCLE_V2.FAILED);
  const now = Date.now();
  j.status = COHTGOV_RENDER_LIFECYCLE_V2.FAILED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.failReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function cancelCohtgovRenderV2(id, reason) {
  const j = _cohtgovJsV2.get(id);
  if (!j) throw new Error(`cohtgov render ${id} not found`);
  _cohtgovCheckJ(j.status, COHTGOV_RENDER_LIFECYCLE_V2.CANCELLED);
  const now = Date.now();
  j.status = COHTGOV_RENDER_LIFECYCLE_V2.CANCELLED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.cancelReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function getCohtgovRenderV2(id) {
  const j = _cohtgovJsV2.get(id);
  if (!j) return null;
  return { ...j, metadata: { ...j.metadata } };
}
export function listCohtgovRendersV2() {
  return [..._cohtgovJsV2.values()].map((j) => ({
    ...j,
    metadata: { ...j.metadata },
  }));
}
export function autoStaleIdleCohtgovProfilesV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const p of _cohtgovPsV2.values())
    if (
      p.status === COHTGOV_PROFILE_MATURITY_V2.ACTIVE &&
      t - p.lastTouchedAt >= _cohtgovIdleMs
    ) {
      p.status = COHTGOV_PROFILE_MATURITY_V2.STALE;
      p.updatedAt = t;
      flipped.push(p.id);
    }
  return { flipped, count: flipped.length };
}
export function autoFailStuckCohtgovRendersV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const j of _cohtgovJsV2.values())
    if (
      j.status === COHTGOV_RENDER_LIFECYCLE_V2.RENDERING &&
      j.startedAt != null &&
      t - j.startedAt >= _cohtgovStuckMs
    ) {
      j.status = COHTGOV_RENDER_LIFECYCLE_V2.FAILED;
      j.updatedAt = t;
      if (!j.settledAt) j.settledAt = t;
      j.metadata.failReason = "auto-fail-stuck";
      flipped.push(j.id);
    }
  return { flipped, count: flipped.length };
}
export function getCoworkObserveHtmlGovStatsV2() {
  const profilesByStatus = {};
  for (const v of Object.values(COHTGOV_PROFILE_MATURITY_V2))
    profilesByStatus[v] = 0;
  for (const p of _cohtgovPsV2.values()) profilesByStatus[p.status]++;
  const rendersByStatus = {};
  for (const v of Object.values(COHTGOV_RENDER_LIFECYCLE_V2))
    rendersByStatus[v] = 0;
  for (const j of _cohtgovJsV2.values()) rendersByStatus[j.status]++;
  return {
    totalCohtgovProfilesV2: _cohtgovPsV2.size,
    totalCohtgovRendersV2: _cohtgovJsV2.size,
    maxActiveCohtgovProfilesPerOwner: _cohtgovMaxActive,
    maxPendingCohtgovRendersPerProfile: _cohtgovMaxPending,
    cohtgovProfileIdleMs: _cohtgovIdleMs,
    cohtgovRenderStuckMs: _cohtgovStuckMs,
    profilesByStatus,
    rendersByStatus,
  };
}
