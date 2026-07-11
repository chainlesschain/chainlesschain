/**
 * Session usage aggregation — Phase I of Managed Agents parity plan.
 *
 * Scans JSONL session events for token usage (emitted either as explicit
 * `token_usage` events or embedded under `event.data.usage` on
 * `assistant_message` / `llm_call` events) and produces roll-ups by model.
 *
 * Purely functional aggregation + file-reading helpers. No state.
 */

import {
  readEvents,
  listJsonlSessions,
} from "../harness/jsonl-session-store.js";

// Injectable disk seams (tests override). readEvents skips malformed JSON lines
// but does NOT guard readFileSync, so an unreadable session file (EACCES /
// EISDIR / a Windows lock / an ENOENT race after existsSync) throws — which
// allSessionsUsage tolerates per-session below.
export const _deps = { readEvents, listJsonlSessions };

const USAGE_EVENT_TYPES = new Set([
  "token_usage",
  "assistant_message",
  "llm_call",
  "llm_response",
]);

function toNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Extract the optional usage-attribution frame (用量归因) persisted alongside
 * a token_usage event's data: `{ origin, skill?, subagentId?, role?,
 * parentSessionId?, depth? }`. Written by the agent drivers for sub-agent /
 * isolated-skill usage; absent on legacy events and on plain main-loop usage
 * (absence ⇒ origin "main"). Returns a normalized copy or null.
 */
export function extractAttribution(event) {
  const a = event?.data?.attribution;
  if (!a || typeof a !== "object") return null;
  const origin = typeof a.origin === "string" && a.origin ? a.origin : null;
  if (!origin) return null;
  const out = { origin };
  if (typeof a.skill === "string" && a.skill) out.skill = a.skill;
  if (typeof a.subagentId === "string" && a.subagentId)
    out.subagentId = a.subagentId;
  if (typeof a.role === "string" && a.role) out.role = a.role;
  if (typeof a.parentSessionId === "string" && a.parentSessionId)
    out.parentSessionId = a.parentSessionId;
  const depth = Number(a.depth);
  if (Number.isFinite(depth)) out.depth = depth;
  return out;
}

/**
 * Extract a normalized usage record from a single event, or null if none.
 * Accepts both snake_case (OpenAI/Anthropic) and camelCase variants.
 */
export function extractUsage(event) {
  if (!event || typeof event !== "object") return null;
  if (!USAGE_EVENT_TYPES.has(event.type)) return null;

  const d = event.data || {};
  const raw =
    event.type === "token_usage"
      ? d.usage || d
      : d.usage || d.tokenUsage || null;
  if (!raw || typeof raw !== "object") return null;

  const inputTokens = toNumber(
    raw.input_tokens ?? raw.prompt_tokens ?? raw.inputTokens ?? 0,
  );
  const outputTokens = toNumber(
    raw.output_tokens ?? raw.completion_tokens ?? raw.outputTokens ?? 0,
  );
  const totalTokens = toNumber(
    raw.total_tokens ?? raw.totalTokens ?? inputTokens + outputTokens,
  );
  // Prompt-cache token counts (Anthropic caching): read tokens are billed at
  // ~10% and creation/write at ~1.25× the input rate, so they are tracked
  // separately for accurate cost. Absent on non-caching providers → 0.
  const cacheReadTokens = toNumber(
    raw.cache_read_input_tokens ?? raw.cacheReadTokens ?? 0,
  );
  const cacheCreationTokens = toNumber(
    raw.cache_creation_input_tokens ?? raw.cacheCreationTokens ?? 0,
  );

  if (
    inputTokens === 0 &&
    outputTokens === 0 &&
    totalTokens === 0 &&
    cacheReadTokens === 0 &&
    cacheCreationTokens === 0
  ) {
    return null;
  }

  // Attribution rides along ONLY when present, so records built from legacy
  // events stay byte-identical (callers using exact-equality keep passing).
  const attribution = extractAttribution(event);
  return {
    provider: d.provider || raw.provider || null,
    model: d.model || raw.model || null,
    inputTokens,
    outputTokens,
    totalTokens,
    cacheReadTokens,
    cacheCreationTokens,
    timestamp: event.timestamp || null,
    ...(attribution ? { attribution } : {}),
  };
}

// ── Usage attribution roll-ups (用量归因) ───────────────────────────────────

function _newSums() {
  return {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    calls: 0,
  };
}

function _addSums(sums, u) {
  sums.inputTokens += u.inputTokens || 0;
  sums.outputTokens += u.outputTokens || 0;
  sums.totalTokens += u.totalTokens || 0;
  sums.cacheReadTokens += u.cacheReadTokens || 0;
  sums.cacheCreationTokens += u.cacheCreationTokens || 0;
  sums.calls += u.calls != null ? u.calls : 1;
}

const _byTokensDesc = (a, b) => b.totalTokens - a.totalTokens;

/**
 * Roll usage events up by attribution: origin (main | subagent | skill —
 * events without an attribution frame count as "main", which keeps every
 * pre-attribution transcript aggregating exactly as before), by skill name,
 * and by individual sub-agent.
 */
export function aggregateUsageAttribution(events) {
  const byOrigin = new Map();
  const bySkill = new Map();
  const bySubagent = new Map();

  for (const evt of events || []) {
    const u = extractUsage(evt);
    if (!u) continue;
    const attr = u.attribution || null;
    const origin = attr?.origin || "main";

    const o = byOrigin.get(origin) || { origin, ..._newSums() };
    _addSums(o, u);
    byOrigin.set(origin, o);

    if (origin === "skill") {
      const key = attr?.skill || "?";
      const s = bySkill.get(key) || { skill: key, ..._newSums() };
      _addSums(s, u);
      bySkill.set(key, s);
    }

    if (attr?.subagentId) {
      const key = attr.subagentId;
      const r = bySubagent.get(key) || {
        subagentId: key,
        role: attr.role || null,
        origin,
        ..._newSums(),
      };
      _addSums(r, u);
      bySubagent.set(key, r);
    }
  }

  return {
    byOrigin: Array.from(byOrigin.values()).sort(_byTokensDesc),
    bySkill: Array.from(bySkill.values()).sort(_byTokensDesc),
    bySubagent: Array.from(bySubagent.values()).sort(_byTokensDesc),
  };
}

/**
 * MCP tools reach the loop as `mcp__<server>__<tool>`; returns the server
 * segment or null for a non-MCP tool name.
 */
export function mcpServerOf(toolName) {
  if (typeof toolName !== "string" || !toolName.startsWith("mcp__"))
    return null;
  const rest = toolName.slice(5);
  const sep = rest.indexOf("__");
  return sep > 0 ? rest.slice(0, sep) : null;
}

/** Lenient tool_result error detection (mirrors session-insights). */
function _isToolResultError(event) {
  const r = event?.data?.result;
  return Boolean(
    event?.data?.error ||
    (r && typeof r === "object" && (r.error || r.is_error || r.isError)),
  );
}

/**
 * Aggregate the transcript's tool events: per-tool call/error counts, an MCP
 * server bucket (`mcp__<server>__*`), and a turn-associated token figure.
 *
 * `turnTokens` is an APPROXIMATION: turns are delimited by `user_message`
 * events, and every token_usage event inside a turn is attributed to EVERY
 * tool that ran in that turn ("tokens of turns that used tool X"). A turn's
 * tokens therefore count once per distinct tool — do NOT sum turnTokens
 * across tools/servers, it is not a partition. Headless sessions persist one
 * aggregated usage event per run, so there the whole run's tokens associate
 * with each tool the run used.
 *
 * Accepts both the compact `tool_call` shape ({tool, is_error, skill?}) the
 * drivers write now and the legacy `tool_call`({tool, args}) + `tool_result`
 * pair (errors read off the result, calls only off tool_call — no double
 * count). Sessions without tool events aggregate to zeros.
 */
export function aggregateToolCalls(events) {
  const byTool = new Map();
  const byServer = new Map();
  let totalCalls = 0;
  let totalErrors = 0;

  const bumpTool = (name) => {
    let t = byTool.get(name);
    if (!t) {
      t = {
        tool: name,
        mcpServer: mcpServerOf(name),
        calls: 0,
        errors: 0,
        turnTokens: 0,
      };
      byTool.set(name, t);
    }
    return t;
  };
  const bumpServer = (server) => {
    let s = byServer.get(server);
    if (!s) {
      s = { server, calls: 0, errors: 0, turnTokens: 0 };
      byServer.set(server, s);
    }
    return s;
  };

  let turnTools = new Set();
  let turnServers = new Set();
  let turnTokens = 0;
  const flushTurn = () => {
    if (turnTokens > 0) {
      for (const name of turnTools) bumpTool(name).turnTokens += turnTokens;
      for (const server of turnServers)
        bumpServer(server).turnTokens += turnTokens;
    }
    turnTools = new Set();
    turnServers = new Set();
    turnTokens = 0;
  };

  for (const evt of events || []) {
    if (!evt || typeof evt !== "object") continue;
    if (evt.type === "user_message") {
      flushTurn();
      continue;
    }
    if (evt.type === "tool_call") {
      const name = evt.data?.tool || "?";
      totalCalls++;
      const t = bumpTool(name);
      t.calls++;
      const isErr = evt.data?.is_error === true;
      if (isErr) {
        totalErrors++;
        t.errors++;
      }
      turnTools.add(name);
      const server = mcpServerOf(name);
      if (server) {
        const s = bumpServer(server);
        s.calls++;
        if (isErr) s.errors++;
        turnServers.add(server);
      }
      continue;
    }
    if (evt.type === "tool_result") {
      const name = evt.data?.tool || "?";
      turnTools.add(name);
      const server = mcpServerOf(name);
      if (server) turnServers.add(server);
      if (_isToolResultError(evt)) {
        totalErrors++;
        bumpTool(name).errors++;
        if (server) bumpServer(server).errors++;
      }
      continue;
    }
    const u = extractUsage(evt);
    if (u) turnTokens += u.totalTokens;
  }
  flushTurn();

  const byCallsDesc = (a, b) => b.calls - a.calls;
  return {
    totalCalls,
    totalErrors,
    byTool: Array.from(byTool.values()).sort(byCallsDesc),
    byMcpServer: Array.from(byServer.values()).sort(byCallsDesc),
  };
}

/**
 * Full attribution section for a transcript: origin/skill/subagent usage
 * roll-ups + the tool/MCP call aggregation. Pure.
 */
export function sessionAttribution(events) {
  return {
    ...aggregateUsageAttribution(events),
    tools: aggregateToolCalls(events),
  };
}

/**
 * Aggregate a list of events into { total, byModel[] }.
 */
export function aggregateUsage(events) {
  const byKey = new Map();
  const total = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    calls: 0,
  };

  for (const evt of events || []) {
    const u = extractUsage(evt);
    if (!u) continue;

    total.inputTokens += u.inputTokens;
    total.outputTokens += u.outputTokens;
    total.totalTokens += u.totalTokens;
    total.cacheReadTokens += u.cacheReadTokens || 0;
    total.cacheCreationTokens += u.cacheCreationTokens || 0;
    total.calls += 1;

    const key = `${u.provider || "?"}/${u.model || "?"}`;
    const entry = byKey.get(key) || {
      provider: u.provider,
      model: u.model,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      calls: 0,
    };
    entry.inputTokens += u.inputTokens;
    entry.outputTokens += u.outputTokens;
    entry.totalTokens += u.totalTokens;
    entry.cacheReadTokens += u.cacheReadTokens || 0;
    entry.cacheCreationTokens += u.cacheCreationTokens || 0;
    entry.calls += 1;
    byKey.set(key, entry);
  }

  return {
    total,
    byModel: Array.from(byKey.values()).sort(
      (a, b) => b.totalTokens - a.totalTokens,
    ),
  };
}

/**
 * Roll up usage for a single JSONL session. The pre-attribution keys
 * (total/byModel) are unchanged; `attribution` is additive.
 */
export function sessionUsage(sessionId) {
  const events = _deps.readEvents(sessionId);
  const agg = aggregateUsage(events);
  return { sessionId, ...agg, attribution: sessionAttribution(events) };
}

/**
 * Roll up usage across every JSONL session on disk.
 */
export function allSessionsUsage({ limit = 1000 } = {}) {
  const sessions = _deps.listJsonlSessions({ limit });
  // One unreadable / corrupt session file (sessionUsage → readEvents →
  // readFileSync can throw on EACCES/EISDIR/lock) must NOT abort the whole
  // roll-up. Skip the failed session and report how many were skipped.
  const perSession = [];
  let skipped = 0;
  for (const s of sessions || []) {
    try {
      perSession.push(sessionUsage(s.id));
    } catch {
      skipped++;
    }
  }

  const total = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    calls: 0,
  };
  const byKey = new Map();

  for (const s of perSession) {
    total.inputTokens += s.total.inputTokens;
    total.outputTokens += s.total.outputTokens;
    total.totalTokens += s.total.totalTokens;
    total.cacheReadTokens += s.total.cacheReadTokens || 0;
    total.cacheCreationTokens += s.total.cacheCreationTokens || 0;
    total.calls += s.total.calls;
    for (const row of s.byModel) {
      const key = `${row.provider || "?"}/${row.model || "?"}`;
      const entry = byKey.get(key) || {
        provider: row.provider,
        model: row.model,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        calls: 0,
      };
      entry.inputTokens += row.inputTokens;
      entry.outputTokens += row.outputTokens;
      entry.totalTokens += row.totalTokens;
      entry.cacheReadTokens += row.cacheReadTokens || 0;
      entry.cacheCreationTokens += row.cacheCreationTokens || 0;
      entry.calls += row.calls;
      byKey.set(key, entry);
    }
  }

  // Global attribution roll-up: merge each session's attribution rows by key.
  const gOrigin = new Map();
  const gSkill = new Map();
  const gSubagent = new Map();
  const gTool = new Map();
  const gServer = new Map();
  let gToolCalls = 0;
  let gToolErrors = 0;
  const mergeRow = (map, key, row, seed) => {
    const entry = map.get(key) || { ...seed, ..._newSums() };
    _addSums(entry, row);
    map.set(key, entry);
  };
  for (const s of perSession) {
    const a = s.attribution;
    if (!a) continue;
    for (const row of a.byOrigin || []) {
      mergeRow(gOrigin, row.origin, row, { origin: row.origin });
    }
    for (const row of a.bySkill || []) {
      mergeRow(gSkill, row.skill, row, { skill: row.skill });
    }
    for (const row of a.bySubagent || []) {
      mergeRow(gSubagent, row.subagentId, row, {
        subagentId: row.subagentId,
        role: row.role || null,
        origin: row.origin,
      });
    }
    const tools = a.tools || {};
    gToolCalls += tools.totalCalls || 0;
    gToolErrors += tools.totalErrors || 0;
    for (const row of tools.byTool || []) {
      const entry = gTool.get(row.tool) || {
        tool: row.tool,
        mcpServer: row.mcpServer || null,
        calls: 0,
        errors: 0,
        turnTokens: 0,
      };
      entry.calls += row.calls || 0;
      entry.errors += row.errors || 0;
      entry.turnTokens += row.turnTokens || 0;
      gTool.set(row.tool, entry);
    }
    for (const row of tools.byMcpServer || []) {
      const entry = gServer.get(row.server) || {
        server: row.server,
        calls: 0,
        errors: 0,
        turnTokens: 0,
      };
      entry.calls += row.calls || 0;
      entry.errors += row.errors || 0;
      entry.turnTokens += row.turnTokens || 0;
      gServer.set(row.server, entry);
    }
  }
  const byCallsDesc = (a, b) => b.calls - a.calls;

  return {
    sessions: perSession,
    skipped,
    total,
    byModel: Array.from(byKey.values()).sort(
      (a, b) => b.totalTokens - a.totalTokens,
    ),
    attribution: {
      byOrigin: Array.from(gOrigin.values()).sort(_byTokensDesc),
      bySkill: Array.from(gSkill.values()).sort(_byTokensDesc),
      bySubagent: Array.from(gSubagent.values()).sort(_byTokensDesc),
      tools: {
        totalCalls: gToolCalls,
        totalErrors: gToolErrors,
        byTool: Array.from(gTool.values()).sort(byCallsDesc),
        byMcpServer: Array.from(gServer.values()).sort(byCallsDesc),
      },
    },
  };
}

// ===== V2 Surface: Session Usage governance overlay (CLI v0.142.0) =====
export const SUSE_BUDGET_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  EXHAUSTED: "exhausted",
  ARCHIVED: "archived",
});
export const SUSE_RECORD_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  RECORDING: "recording",
  RECORDED: "recorded",
  REJECTED: "rejected",
  CANCELLED: "cancelled",
});
const _suseBTrans = new Map([
  [
    SUSE_BUDGET_MATURITY_V2.PENDING,
    new Set([SUSE_BUDGET_MATURITY_V2.ACTIVE, SUSE_BUDGET_MATURITY_V2.ARCHIVED]),
  ],
  [
    SUSE_BUDGET_MATURITY_V2.ACTIVE,
    new Set([
      SUSE_BUDGET_MATURITY_V2.EXHAUSTED,
      SUSE_BUDGET_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    SUSE_BUDGET_MATURITY_V2.EXHAUSTED,
    new Set([SUSE_BUDGET_MATURITY_V2.ACTIVE, SUSE_BUDGET_MATURITY_V2.ARCHIVED]),
  ],
  [SUSE_BUDGET_MATURITY_V2.ARCHIVED, new Set()],
]);
const _suseBTerminal = new Set([SUSE_BUDGET_MATURITY_V2.ARCHIVED]);
const _suseRTrans = new Map([
  [
    SUSE_RECORD_LIFECYCLE_V2.QUEUED,
    new Set([
      SUSE_RECORD_LIFECYCLE_V2.RECORDING,
      SUSE_RECORD_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [
    SUSE_RECORD_LIFECYCLE_V2.RECORDING,
    new Set([
      SUSE_RECORD_LIFECYCLE_V2.RECORDED,
      SUSE_RECORD_LIFECYCLE_V2.REJECTED,
      SUSE_RECORD_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [SUSE_RECORD_LIFECYCLE_V2.RECORDED, new Set()],
  [SUSE_RECORD_LIFECYCLE_V2.REJECTED, new Set()],
  [SUSE_RECORD_LIFECYCLE_V2.CANCELLED, new Set()],
]);
const _suseBsV2 = new Map();
const _suseRsV2 = new Map();
let _suseMaxActive = 5,
  _suseMaxPending = 50,
  _suseIdleMs = 30 * 24 * 60 * 60 * 1000,
  _suseStuckMs = 30 * 1000;
function _susePos(n, label) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${label} must be positive integer`);
  return v;
}
function _suseCheckB(from, to) {
  const a = _suseBTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid suse budget transition ${from} → ${to}`);
}
function _suseCheckR(from, to) {
  const a = _suseRTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid suse record transition ${from} → ${to}`);
}
export function setMaxActiveSuseBudgetsPerOwnerV2(n) {
  _suseMaxActive = _susePos(n, "maxActiveSuseBudgetsPerOwner");
}
export function getMaxActiveSuseBudgetsPerOwnerV2() {
  return _suseMaxActive;
}
export function setMaxPendingSuseRecordsPerBudgetV2(n) {
  _suseMaxPending = _susePos(n, "maxPendingSuseRecordsPerBudget");
}
export function getMaxPendingSuseRecordsPerBudgetV2() {
  return _suseMaxPending;
}
export function setSuseBudgetIdleMsV2(n) {
  _suseIdleMs = _susePos(n, "suseBudgetIdleMs");
}
export function getSuseBudgetIdleMsV2() {
  return _suseIdleMs;
}
export function setSuseRecordStuckMsV2(n) {
  _suseStuckMs = _susePos(n, "suseRecordStuckMs");
}
export function getSuseRecordStuckMsV2() {
  return _suseStuckMs;
}
export function _resetStateSessionUsageV2() {
  _suseBsV2.clear();
  _suseRsV2.clear();
  _suseMaxActive = 5;
  _suseMaxPending = 50;
  _suseIdleMs = 30 * 24 * 60 * 60 * 1000;
  _suseStuckMs = 30 * 1000;
}
export function registerSuseBudgetV2({ id, owner, limit, metadata } = {}) {
  if (!id) throw new Error("suse budget id required");
  if (!owner) throw new Error("suse budget owner required");
  if (_suseBsV2.has(id))
    throw new Error(`suse budget ${id} already registered`);
  const now = Date.now();
  const lim =
    limit == null ? 1000 : Math.max(1, Math.floor(Number(limit)) || 1);
  const b = {
    id,
    owner,
    limit: lim,
    status: SUSE_BUDGET_MATURITY_V2.PENDING,
    createdAt: now,
    updatedAt: now,
    activatedAt: null,
    archivedAt: null,
    lastTouchedAt: now,
    metadata: { ...(metadata || {}) },
  };
  _suseBsV2.set(id, b);
  return { ...b, metadata: { ...b.metadata } };
}
function _suseCountActive(owner) {
  let n = 0;
  for (const b of _suseBsV2.values())
    if (b.owner === owner && b.status === SUSE_BUDGET_MATURITY_V2.ACTIVE) n++;
  return n;
}
export function activateSuseBudgetV2(id) {
  const b = _suseBsV2.get(id);
  if (!b) throw new Error(`suse budget ${id} not found`);
  _suseCheckB(b.status, SUSE_BUDGET_MATURITY_V2.ACTIVE);
  const recovery = b.status === SUSE_BUDGET_MATURITY_V2.EXHAUSTED;
  if (!recovery && _suseCountActive(b.owner) >= _suseMaxActive)
    throw new Error(`max active suse budgets for owner ${b.owner} reached`);
  const now = Date.now();
  b.status = SUSE_BUDGET_MATURITY_V2.ACTIVE;
  b.updatedAt = now;
  b.lastTouchedAt = now;
  if (!b.activatedAt) b.activatedAt = now;
  return { ...b, metadata: { ...b.metadata } };
}
export function exhaustSuseBudgetV2(id) {
  const b = _suseBsV2.get(id);
  if (!b) throw new Error(`suse budget ${id} not found`);
  _suseCheckB(b.status, SUSE_BUDGET_MATURITY_V2.EXHAUSTED);
  b.status = SUSE_BUDGET_MATURITY_V2.EXHAUSTED;
  b.updatedAt = Date.now();
  return { ...b, metadata: { ...b.metadata } };
}
export function archiveSuseBudgetV2(id) {
  const b = _suseBsV2.get(id);
  if (!b) throw new Error(`suse budget ${id} not found`);
  _suseCheckB(b.status, SUSE_BUDGET_MATURITY_V2.ARCHIVED);
  const now = Date.now();
  b.status = SUSE_BUDGET_MATURITY_V2.ARCHIVED;
  b.updatedAt = now;
  if (!b.archivedAt) b.archivedAt = now;
  return { ...b, metadata: { ...b.metadata } };
}
export function touchSuseBudgetV2(id) {
  const b = _suseBsV2.get(id);
  if (!b) throw new Error(`suse budget ${id} not found`);
  if (_suseBTerminal.has(b.status))
    throw new Error(`cannot touch terminal suse budget ${id}`);
  const now = Date.now();
  b.lastTouchedAt = now;
  b.updatedAt = now;
  return { ...b, metadata: { ...b.metadata } };
}
export function getSuseBudgetV2(id) {
  const b = _suseBsV2.get(id);
  if (!b) return null;
  return { ...b, metadata: { ...b.metadata } };
}
export function listSuseBudgetsV2() {
  return [..._suseBsV2.values()].map((b) => ({
    ...b,
    metadata: { ...b.metadata },
  }));
}
function _suseCountPending(budgetId) {
  let n = 0;
  for (const r of _suseRsV2.values())
    if (
      r.budgetId === budgetId &&
      (r.status === SUSE_RECORD_LIFECYCLE_V2.QUEUED ||
        r.status === SUSE_RECORD_LIFECYCLE_V2.RECORDING)
    )
      n++;
  return n;
}
export function createSuseRecordV2({ id, budgetId, amount, metadata } = {}) {
  if (!id) throw new Error("suse record id required");
  if (!budgetId) throw new Error("suse record budgetId required");
  if (_suseRsV2.has(id)) throw new Error(`suse record ${id} already exists`);
  if (!_suseBsV2.has(budgetId))
    throw new Error(`suse budget ${budgetId} not found`);
  if (_suseCountPending(budgetId) >= _suseMaxPending)
    throw new Error(`max pending suse records for budget ${budgetId} reached`);
  const now = Date.now();
  const amt = amount == null ? 0 : Math.max(0, Number(amount) || 0);
  const r = {
    id,
    budgetId,
    amount: amt,
    status: SUSE_RECORD_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    settledAt: null,
    metadata: { ...(metadata || {}) },
  };
  _suseRsV2.set(id, r);
  return { ...r, metadata: { ...r.metadata } };
}
export function recordingSuseRecordV2(id) {
  const r = _suseRsV2.get(id);
  if (!r) throw new Error(`suse record ${id} not found`);
  _suseCheckR(r.status, SUSE_RECORD_LIFECYCLE_V2.RECORDING);
  const now = Date.now();
  r.status = SUSE_RECORD_LIFECYCLE_V2.RECORDING;
  r.updatedAt = now;
  if (!r.startedAt) r.startedAt = now;
  return { ...r, metadata: { ...r.metadata } };
}
export function recordSuseRecordV2(id) {
  const r = _suseRsV2.get(id);
  if (!r) throw new Error(`suse record ${id} not found`);
  _suseCheckR(r.status, SUSE_RECORD_LIFECYCLE_V2.RECORDED);
  const now = Date.now();
  r.status = SUSE_RECORD_LIFECYCLE_V2.RECORDED;
  r.updatedAt = now;
  if (!r.settledAt) r.settledAt = now;
  return { ...r, metadata: { ...r.metadata } };
}
export function rejectSuseRecordV2(id, reason) {
  const r = _suseRsV2.get(id);
  if (!r) throw new Error(`suse record ${id} not found`);
  _suseCheckR(r.status, SUSE_RECORD_LIFECYCLE_V2.REJECTED);
  const now = Date.now();
  r.status = SUSE_RECORD_LIFECYCLE_V2.REJECTED;
  r.updatedAt = now;
  if (!r.settledAt) r.settledAt = now;
  if (reason) r.metadata.rejectReason = String(reason);
  return { ...r, metadata: { ...r.metadata } };
}
export function cancelSuseRecordV2(id, reason) {
  const r = _suseRsV2.get(id);
  if (!r) throw new Error(`suse record ${id} not found`);
  _suseCheckR(r.status, SUSE_RECORD_LIFECYCLE_V2.CANCELLED);
  const now = Date.now();
  r.status = SUSE_RECORD_LIFECYCLE_V2.CANCELLED;
  r.updatedAt = now;
  if (!r.settledAt) r.settledAt = now;
  if (reason) r.metadata.cancelReason = String(reason);
  return { ...r, metadata: { ...r.metadata } };
}
export function getSuseRecordV2(id) {
  const r = _suseRsV2.get(id);
  if (!r) return null;
  return { ...r, metadata: { ...r.metadata } };
}
export function listSuseRecordsV2() {
  return [..._suseRsV2.values()].map((r) => ({
    ...r,
    metadata: { ...r.metadata },
  }));
}
export function autoExhaustIdleSuseBudgetsV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const b of _suseBsV2.values())
    if (
      b.status === SUSE_BUDGET_MATURITY_V2.ACTIVE &&
      t - b.lastTouchedAt >= _suseIdleMs
    ) {
      b.status = SUSE_BUDGET_MATURITY_V2.EXHAUSTED;
      b.updatedAt = t;
      flipped.push(b.id);
    }
  return { flipped, count: flipped.length };
}
export function autoRejectStuckSuseRecordsV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const r of _suseRsV2.values())
    if (
      r.status === SUSE_RECORD_LIFECYCLE_V2.RECORDING &&
      r.startedAt != null &&
      t - r.startedAt >= _suseStuckMs
    ) {
      r.status = SUSE_RECORD_LIFECYCLE_V2.REJECTED;
      r.updatedAt = t;
      if (!r.settledAt) r.settledAt = t;
      r.metadata.rejectReason = "auto-reject-stuck";
      flipped.push(r.id);
    }
  return { flipped, count: flipped.length };
}
export function getSessionUsageGovStatsV2() {
  const budgetsByStatus = {};
  for (const v of Object.values(SUSE_BUDGET_MATURITY_V2))
    budgetsByStatus[v] = 0;
  for (const b of _suseBsV2.values()) budgetsByStatus[b.status]++;
  const recordsByStatus = {};
  for (const v of Object.values(SUSE_RECORD_LIFECYCLE_V2))
    recordsByStatus[v] = 0;
  for (const r of _suseRsV2.values()) recordsByStatus[r.status]++;
  return {
    totalSuseBudgetsV2: _suseBsV2.size,
    totalSuseRecordsV2: _suseRsV2.size,
    maxActiveSuseBudgetsPerOwner: _suseMaxActive,
    maxPendingSuseRecordsPerBudget: _suseMaxPending,
    suseBudgetIdleMs: _suseIdleMs,
    suseRecordStuckMs: _suseStuckMs,
    budgetsByStatus,
    recordsByStatus,
  };
}
