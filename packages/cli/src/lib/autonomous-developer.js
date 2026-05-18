/**
 * Autonomous Developer — CLI port of Phase 63 autonomous-developer system
 * (docs/design/modules/35_自主开发者系统.md).
 *
 * The Desktop build drives an L2 autonomous-developer loop backed by a live
 * LLMSession + techLearningEngine: requirement → design → implementation →
 * testing → review → deployment, with auto-generated code / tests / ADRs.
 * The CLI can't host a long-running LLM loop, so this port ships the
 * tractable scaffolding:
 *
 *   - Dev session lifecycle (start / advance phase / pause / resume /
 *     complete / fail) with SQLite persistence.
 *   - Architecture Decision Record (ADR) store with status workflow
 *     (proposed / accepted / deprecated / superseded).
 *   - reviewCode(file): wraps Phase 62 detectAntiPatterns into a
 *     session-scoped review record (score + findings).
 *   - Refactoring-type + autonomy-level + phase catalogs.
 *
 * Auto-codegen, auto-test-gen and LLM-driven requirement parsing are
 * explicitly out of scope — they belong in Desktop + LLM-hosted paths.
 */

import crypto from "crypto";
import { detectAntiPatterns as _detectAntiPatterns } from "./tech-learning-engine.js";

/* ── Constants ─────────────────────────────────────────────── */

export const AUTONOMY_LEVELS = Object.freeze({
  L0: {
    level: 0,
    name: "Suggest Only",
    description: "Suggestions only; all actions need human approval",
    capabilities: ["suggest", "analyze"],
  },
  L1: {
    level: 1,
    name: "Simple Tasks",
    description: "Auto-execute simple tasks",
    capabilities: ["suggest", "analyze", "simple_code_gen"],
  },
  L2: {
    level: 2,
    name: "Medium Complexity",
    description: "Auto-execute medium-complexity tasks (default)",
    capabilities: ["suggest", "analyze", "code_gen", "refactor", "test_gen"],
  },
  L3: {
    level: 3,
    name: "Complex Tasks",
    description: "Auto-execute complex tasks",
    capabilities: ["full_feature_dev", "architecture_design"],
  },
  L4: {
    level: 4,
    name: "Full Autonomy",
    description: "Full autonomous development",
    capabilities: ["project_planning", "team_collaboration"],
  },
});

export const DEV_PHASES = Object.freeze({
  REQUIREMENT_ANALYSIS: "requirement_analysis",
  DESIGN: "design",
  IMPLEMENTATION: "implementation",
  TESTING: "testing",
  REVIEW: "review",
  DEPLOYMENT: "deployment",
});

const PHASE_ORDER = Object.freeze([
  DEV_PHASES.REQUIREMENT_ANALYSIS,
  DEV_PHASES.DESIGN,
  DEV_PHASES.IMPLEMENTATION,
  DEV_PHASES.TESTING,
  DEV_PHASES.REVIEW,
  DEV_PHASES.DEPLOYMENT,
]);

export const SESSION_STATUS = Object.freeze({
  ACTIVE: "active",
  PAUSED: "paused",
  COMPLETED: "completed",
  FAILED: "failed",
});

export const ADR_STATUS = Object.freeze({
  PROPOSED: "proposed",
  ACCEPTED: "accepted",
  DEPRECATED: "deprecated",
  SUPERSEDED: "superseded",
});

export const REFACTORING_TYPES = Object.freeze({
  EXTRACT_METHOD: "extract_method",
  RENAME_VARIABLE: "rename_variable",
  SIMPLIFY_LOGIC: "simplify_logic",
  INLINE_VARIABLE: "inline_variable",
  EXTRACT_CLASS: "extract_class",
  MOVE_METHOD: "move_method",
});

const VALID_PHASES = new Set(Object.values(DEV_PHASES));
const VALID_STATUS = new Set(Object.values(SESSION_STATUS));
const VALID_ADR_STATUS = new Set(Object.values(ADR_STATUS));
const VALID_AUTONOMY = new Set([0, 1, 2, 3, 4]);

/* ── State ─────────────────────────────────────────────────── */

const _sessions = new Map();
const _adrs = new Map();
let _seq = 0;

/* ── Schema ────────────────────────────────────────────────── */

export function ensureAutonomousDevTables(db) {
  if (!db) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS dev_sessions (
      session_id TEXT PRIMARY KEY,
      requirement TEXT NOT NULL,
      current_phase TEXT NOT NULL,
      status TEXT DEFAULT 'active',
      autonomy_level INTEGER DEFAULT 2,
      code_changes TEXT,
      test_results TEXT,
      review_feedback TEXT,
      started_at INTEGER NOT NULL,
      completed_at INTEGER,
      created_by TEXT,
      updated_at INTEGER NOT NULL
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS architecture_decisions (
      adr_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      title TEXT NOT NULL,
      context TEXT NOT NULL,
      decision TEXT NOT NULL,
      consequences TEXT,
      alternatives TEXT,
      status TEXT DEFAULT 'accepted',
      created_at INTEGER NOT NULL
    )
  `);
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_dev_sessions_status ON dev_sessions(status)`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_architecture_decisions_session ON architecture_decisions(session_id)`,
  );
}

/* ── Catalogs ──────────────────────────────────────────────── */

export function listAutonomyLevels() {
  return Object.values(AUTONOMY_LEVELS);
}

export function listPhases() {
  return [...PHASE_ORDER];
}

export function listRefactoringTypes() {
  return Object.values(REFACTORING_TYPES);
}

/* ── Sessions ──────────────────────────────────────────────── */

function _strip(row) {
  const { _seq: _omit, ...rest } = row;
  void _omit;
  return rest;
}

export function startDevSession(db, config = {}) {
  const requirement = String(config.requirement || "").trim();
  if (!requirement) throw new Error("requirement is required");

  const autonomyLevel =
    config.autonomyLevel == null ? 2 : Number(config.autonomyLevel);
  if (!VALID_AUTONOMY.has(autonomyLevel)) {
    throw new Error(
      `Invalid autonomy level: ${config.autonomyLevel} (must be 0..4)`,
    );
  }

  const now = Number(config.now ?? Date.now());
  const sessionId = config.sessionId || crypto.randomUUID();
  const session = {
    sessionId,
    requirement,
    currentPhase: DEV_PHASES.REQUIREMENT_ANALYSIS,
    status: SESSION_STATUS.ACTIVE,
    autonomyLevel,
    codeChanges: [],
    testResults: null,
    reviewFeedback: null,
    startedAt: now,
    completedAt: null,
    createdBy: config.createdBy || null,
    updatedAt: now,
    _seq: ++_seq,
  };
  _sessions.set(sessionId, session);

  if (db) {
    db.prepare(
      `INSERT INTO dev_sessions (session_id, requirement, current_phase, status, autonomy_level, code_changes, test_results, review_feedback, started_at, completed_at, created_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      sessionId,
      requirement,
      session.currentPhase,
      session.status,
      autonomyLevel,
      JSON.stringify(session.codeChanges),
      null,
      null,
      now,
      null,
      session.createdBy,
      now,
    );
  }

  return _strip(session);
}

export function getSession(sessionId) {
  const s = _sessions.get(sessionId);
  return s ? _strip(s) : null;
}

export function listSessions(opts = {}) {
  let rows = [..._sessions.values()];
  if (opts.status) {
    const st = String(opts.status).toLowerCase();
    rows = rows.filter((s) => s.status === st);
  }
  if (opts.phase) {
    const p = String(opts.phase).toLowerCase();
    rows = rows.filter((s) => s.currentPhase === p);
  }
  rows.sort((a, b) => b.startedAt - a.startedAt || b._seq - a._seq);
  const limit = opts.limit || 50;
  return rows.slice(0, limit).map(_strip);
}

function _mustGet(sessionId) {
  const s = _sessions.get(sessionId);
  if (!s) throw new Error(`Session not found: ${sessionId}`);
  return s;
}

function _persistUpdate(db, sessionId, fields) {
  if (!db) return;
  const setClauses = Object.keys(fields)
    .map((k) => `${k} = ?`)
    .join(", ");
  const values = Object.values(fields).map((v) =>
    v && typeof v === "object" ? JSON.stringify(v) : v,
  );
  db.prepare(`UPDATE dev_sessions SET ${setClauses} WHERE session_id = ?`).run(
    ...values,
    sessionId,
  );
}

export function advancePhase(db, sessionId, nextPhase) {
  const session = _mustGet(sessionId);
  if (session.status !== SESSION_STATUS.ACTIVE) {
    throw new Error(
      `Cannot advance phase on non-active session (status=${session.status})`,
    );
  }
  const target = String(nextPhase || "").toLowerCase();
  if (!VALID_PHASES.has(target)) {
    throw new Error(
      `Invalid phase: ${nextPhase} (known: ${[...VALID_PHASES].join("/")})`,
    );
  }
  const now = Date.now();
  session.currentPhase = target;
  session.updatedAt = now;
  _persistUpdate(db, sessionId, {
    current_phase: target,
    updated_at: now,
  });
  return _strip(session);
}

export function pauseSession(db, sessionId) {
  const session = _mustGet(sessionId);
  if (session.status !== SESSION_STATUS.ACTIVE) {
    throw new Error(
      `Cannot pause non-active session (status=${session.status})`,
    );
  }
  const now = Date.now();
  session.status = SESSION_STATUS.PAUSED;
  session.updatedAt = now;
  _persistUpdate(db, sessionId, {
    status: SESSION_STATUS.PAUSED,
    updated_at: now,
  });
  return _strip(session);
}

export function resumeSession(db, sessionId) {
  const session = _mustGet(sessionId);
  if (session.status !== SESSION_STATUS.PAUSED) {
    throw new Error(
      `Cannot resume non-paused session (status=${session.status})`,
    );
  }
  const now = Date.now();
  session.status = SESSION_STATUS.ACTIVE;
  session.updatedAt = now;
  _persistUpdate(db, sessionId, {
    status: SESSION_STATUS.ACTIVE,
    updated_at: now,
  });
  return _strip(session);
}

export function completeSession(db, sessionId) {
  const session = _mustGet(sessionId);
  if (
    session.status === SESSION_STATUS.COMPLETED ||
    session.status === SESSION_STATUS.FAILED
  ) {
    throw new Error(`Session already terminal (status=${session.status})`);
  }
  const now = Date.now();
  session.status = SESSION_STATUS.COMPLETED;
  session.completedAt = now;
  session.updatedAt = now;
  _persistUpdate(db, sessionId, {
    status: SESSION_STATUS.COMPLETED,
    completed_at: now,
    updated_at: now,
  });
  return _strip(session);
}

export function failSession(db, sessionId, reason) {
  const session = _mustGet(sessionId);
  if (
    session.status === SESSION_STATUS.COMPLETED ||
    session.status === SESSION_STATUS.FAILED
  ) {
    throw new Error(`Session already terminal (status=${session.status})`);
  }
  const now = Date.now();
  const feedback = session.reviewFeedback || {};
  if (reason) feedback.failureReason = reason;
  session.reviewFeedback = feedback;
  session.status = SESSION_STATUS.FAILED;
  session.completedAt = now;
  session.updatedAt = now;
  _persistUpdate(db, sessionId, {
    status: SESSION_STATUS.FAILED,
    review_feedback: feedback,
    completed_at: now,
    updated_at: now,
  });
  return _strip(session);
}

/* ── Code review ───────────────────────────────────────────── */

export function reviewCode(filePath, opts = {}) {
  const report = _detectAntiPatterns(filePath, opts);

  // score: 1.0 clean, penalize high/medium findings.
  let score = 1.0;
  for (const f of report.findings) {
    score -= f.severity === "high" ? 0.25 : 0.1;
  }
  if (score < 0) score = 0;

  let grade;
  if (score >= 0.9) grade = "A";
  else if (score >= 0.75) grade = "B";
  else if (score >= 0.6) grade = "C";
  else if (score >= 0.4) grade = "D";
  else grade = "F";

  const result = {
    filePath: report.filePath,
    lines: report.lines,
    functionCount: report.functionCount,
    totalFindings: report.totalFindings,
    findings: report.findings,
    score: Number(score.toFixed(3)),
    grade,
    passed: score >= (opts.minScore ?? 0.7),
  };

  // Optional: attach review feedback to a session.
  if (opts.sessionId) {
    const session = _sessions.get(opts.sessionId);
    if (session) {
      const feedback = session.reviewFeedback || { reviews: [] };
      if (!Array.isArray(feedback.reviews)) feedback.reviews = [];
      feedback.reviews.push(result);
      session.reviewFeedback = feedback;
      session.updatedAt = Date.now();
      if (opts.db) {
        _persistUpdate(opts.db, opts.sessionId, {
          review_feedback: feedback,
          updated_at: session.updatedAt,
        });
      }
    }
  }

  return result;
}

/* ── ADRs ──────────────────────────────────────────────────── */

export function recordADR(db, config = {}) {
  const sessionId = String(config.sessionId || "").trim();
  if (!sessionId) throw new Error("sessionId is required");
  if (!_sessions.has(sessionId)) {
    throw new Error(`Session not found: ${sessionId}`);
  }
  const title = String(config.title || "").trim();
  const context = String(config.context || "").trim();
  const decision = String(config.decision || "").trim();
  if (!title) throw new Error("title is required");
  if (!context) throw new Error("context is required");
  if (!decision) throw new Error("decision is required");

  const status = String(config.status || ADR_STATUS.ACCEPTED).toLowerCase();
  if (!VALID_ADR_STATUS.has(status)) {
    throw new Error(
      `Invalid ADR status: ${config.status} (known: ${[...VALID_ADR_STATUS].join("/")})`,
    );
  }

  const now = Number(config.now ?? Date.now());
  const adrId = config.adrId || crypto.randomUUID();
  const adr = {
    adrId,
    sessionId,
    title,
    context,
    decision,
    consequences: config.consequences || "",
    alternatives: Array.isArray(config.alternatives) ? config.alternatives : [],
    status,
    createdAt: now,
    _seq: ++_seq,
  };
  _adrs.set(adrId, adr);

  if (db) {
    db.prepare(
      `INSERT INTO architecture_decisions (adr_id, session_id, title, context, decision, consequences, alternatives, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      adrId,
      sessionId,
      title,
      context,
      decision,
      adr.consequences,
      JSON.stringify(adr.alternatives),
      status,
      now,
    );
  }

  return _strip(adr);
}

export function listADRs(opts = {}) {
  let rows = [..._adrs.values()];
  if (opts.sessionId) {
    rows = rows.filter((a) => a.sessionId === opts.sessionId);
  }
  if (opts.status) {
    const s = String(opts.status).toLowerCase();
    rows = rows.filter((a) => a.status === s);
  }
  rows.sort((a, b) => a.createdAt - b.createdAt || a._seq - b._seq);
  const limit = opts.limit || 50;
  return rows.slice(0, limit).map(_strip);
}

export function renderADR(adr) {
  const alts =
    Array.isArray(adr.alternatives) && adr.alternatives.length
      ? adr.alternatives.map((a) => `- ${a}`).join("\n")
      : "(none)";
  return `# ADR: ${adr.title}

## Status
${adr.status}

## Context
${adr.context}

## Decision
${adr.decision}

## Consequences
${adr.consequences || "(none)"}

## Alternatives
${alts}
`;
}

/* ── Reset (tests) ─────────────────────────────────────────── */

export function _resetState() {
  _sessions.clear();
  _adrs.clear();
  _seq = 0;
}

/* ── V2 Surface (Autonomous Developer) ─────────────────────
 * Strictly additive. Two parallel state machines:
 *   - ADR maturity (4 states, superseded terminal)
 *   - Dev session V2 lifecycle (5 states, 3 terminals)
 * Per-author active-ADR cap + per-developer running-session cap.
 * Auto-flip: stale draft ADRs → superseded; stuck running sessions → failed.
 */

export const ADR_MATURITY_V2 = Object.freeze({
  DRAFT: "draft",
  ACCEPTED: "accepted",
  DEPRECATED: "deprecated",
  SUPERSEDED: "superseded",
});

export const DEV_SESSION_V2 = Object.freeze({
  QUEUED: "queued",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELED: "canceled",
});

const _ADR_TRANSITIONS_V2 = new Map([
  [
    ADR_MATURITY_V2.DRAFT,
    new Set([ADR_MATURITY_V2.ACCEPTED, ADR_MATURITY_V2.SUPERSEDED]),
  ],
  [
    ADR_MATURITY_V2.ACCEPTED,
    new Set([ADR_MATURITY_V2.DEPRECATED, ADR_MATURITY_V2.SUPERSEDED]),
  ],
  [
    ADR_MATURITY_V2.DEPRECATED,
    new Set([ADR_MATURITY_V2.ACCEPTED, ADR_MATURITY_V2.SUPERSEDED]),
  ],
]);
const _ADR_TERMINAL_V2 = new Set([ADR_MATURITY_V2.SUPERSEDED]);

const _SESSION_TRANSITIONS_V2 = new Map([
  [
    DEV_SESSION_V2.QUEUED,
    new Set([
      DEV_SESSION_V2.RUNNING,
      DEV_SESSION_V2.CANCELED,
      DEV_SESSION_V2.FAILED,
    ]),
  ],
  [
    DEV_SESSION_V2.RUNNING,
    new Set([
      DEV_SESSION_V2.COMPLETED,
      DEV_SESSION_V2.FAILED,
      DEV_SESSION_V2.CANCELED,
    ]),
  ],
]);
const _SESSION_TERMINAL_V2 = new Set([
  DEV_SESSION_V2.COMPLETED,
  DEV_SESSION_V2.FAILED,
  DEV_SESSION_V2.CANCELED,
]);

export const AD_DEFAULT_MAX_ACTIVE_ADRS_PER_AUTHOR = 20;
export const AD_DEFAULT_MAX_RUNNING_SESSIONS_PER_DEVELOPER = 3;
export const AD_DEFAULT_ADR_STALE_MS = 90 * 86400000;
export const AD_DEFAULT_SESSION_STUCK_MS = 2 * 3600000;

let _adMaxActiveAdrsPerAuthor = AD_DEFAULT_MAX_ACTIVE_ADRS_PER_AUTHOR;
let _adMaxRunningSessionsPerDeveloper =
  AD_DEFAULT_MAX_RUNNING_SESSIONS_PER_DEVELOPER;
let _adAdrStaleMs = AD_DEFAULT_ADR_STALE_MS;
let _adSessionStuckMs = AD_DEFAULT_SESSION_STUCK_MS;

const _adrsV2 = new Map();
const _sessionsV2 = new Map();

function _positiveIntV2(n, label) {
  const f = Math.floor(n);
  if (!Number.isFinite(f) || f <= 0)
    throw new Error(`${label} must be a positive integer`);
  return f;
}

function _now() {
  return Date.now();
}

export function getMaxActiveAdrsPerAuthor() {
  return _adMaxActiveAdrsPerAuthor;
}
export function setMaxActiveAdrsPerAuthor(n) {
  _adMaxActiveAdrsPerAuthor = _positiveIntV2(n, "maxActiveAdrsPerAuthor");
  return _adMaxActiveAdrsPerAuthor;
}
export function getMaxRunningSessionsPerDeveloper() {
  return _adMaxRunningSessionsPerDeveloper;
}
export function setMaxRunningSessionsPerDeveloper(n) {
  _adMaxRunningSessionsPerDeveloper = _positiveIntV2(
    n,
    "maxRunningSessionsPerDeveloper",
  );
  return _adMaxRunningSessionsPerDeveloper;
}
export function getAdrStaleMs() {
  return _adAdrStaleMs;
}
export function setAdrStaleMs(n) {
  _adAdrStaleMs = _positiveIntV2(n, "adrStaleMs");
  return _adAdrStaleMs;
}
export function getSessionStuckMs() {
  return _adSessionStuckMs;
}
export function setSessionStuckMs(n) {
  _adSessionStuckMs = _positiveIntV2(n, "sessionStuckMs");
  return _adSessionStuckMs;
}

export function getActiveAdrCount(author) {
  let c = 0;
  for (const a of _adrsV2.values()) {
    if (_ADR_TERMINAL_V2.has(a.status)) continue;
    if (author !== undefined && a.author !== author) continue;
    c++;
  }
  return c;
}

export function getRunningSessionCount(developer) {
  let c = 0;
  for (const s of _sessionsV2.values()) {
    if (s.status !== DEV_SESSION_V2.RUNNING) continue;
    if (developer !== undefined && s.developer !== developer) continue;
    c++;
  }
  return c;
}

export function createAdrV2({
  id,
  author,
  title,
  initialStatus,
  metadata,
} = {}) {
  if (!id) throw new Error("id required");
  if (!author) throw new Error("author required");
  if (!title) throw new Error("title required");
  if (_adrsV2.has(id)) throw new Error(`ADR ${id} already exists`);
  const status = initialStatus ?? ADR_MATURITY_V2.DRAFT;
  if (!Object.values(ADR_MATURITY_V2).includes(status))
    throw new Error(`invalid initial status ${status}`);
  if (
    !_ADR_TERMINAL_V2.has(status) &&
    getActiveAdrCount(author) >= _adMaxActiveAdrsPerAuthor
  )
    throw new Error(`author ${author} active ADR cap reached`);
  const now = _now();
  const a = {
    id,
    author,
    title,
    status,
    metadata: metadata ? { ...metadata } : {},
    createdAt: now,
    updatedAt: now,
    acceptedAt: status === ADR_MATURITY_V2.ACCEPTED ? now : null,
  };
  _adrsV2.set(id, a);
  return { ...a, metadata: { ...a.metadata } };
}

export function getAdrV2(id) {
  const a = _adrsV2.get(id);
  return a ? { ...a, metadata: { ...a.metadata } } : null;
}

export function listAdrsV2({ author, status } = {}) {
  const out = [];
  for (const a of _adrsV2.values()) {
    if (author !== undefined && a.author !== author) continue;
    if (status !== undefined && a.status !== status) continue;
    out.push({ ...a, metadata: { ...a.metadata } });
  }
  return out;
}

export function setAdrMaturityV2(id, nextStatus, { reason, metadata } = {}) {
  const a = _adrsV2.get(id);
  if (!a) throw new Error(`ADR ${id} not found`);
  if (_ADR_TERMINAL_V2.has(a.status))
    throw new Error(`ADR ${id} is terminal (${a.status})`);
  const allowed = _ADR_TRANSITIONS_V2.get(a.status);
  if (!allowed || !allowed.has(nextStatus))
    throw new Error(`illegal transition ${a.status} → ${nextStatus}`);
  a.status = nextStatus;
  a.updatedAt = _now();
  if (reason !== undefined) a.reason = reason;
  if (metadata) a.metadata = { ...a.metadata, ...metadata };
  if (nextStatus === ADR_MATURITY_V2.ACCEPTED && !a.acceptedAt)
    a.acceptedAt = a.updatedAt;
  return { ...a, metadata: { ...a.metadata } };
}

export function acceptAdr(id, opts) {
  return setAdrMaturityV2(id, ADR_MATURITY_V2.ACCEPTED, opts);
}
export function deprecateAdr(id, opts) {
  return setAdrMaturityV2(id, ADR_MATURITY_V2.DEPRECATED, opts);
}
export function supersedeAdr(id, opts) {
  return setAdrMaturityV2(id, ADR_MATURITY_V2.SUPERSEDED, opts);
}

export function enqueueSessionV2({ id, developer, goal, metadata } = {}) {
  if (!id) throw new Error("id required");
  if (!developer) throw new Error("developer required");
  if (!goal) throw new Error("goal required");
  if (_sessionsV2.has(id)) throw new Error(`session ${id} already exists`);
  const now = _now();
  const s = {
    id,
    developer,
    goal,
    status: DEV_SESSION_V2.QUEUED,
    metadata: metadata ? { ...metadata } : {},
    createdAt: now,
    updatedAt: now,
    startedAt: null,
  };
  _sessionsV2.set(id, s);
  return { ...s, metadata: { ...s.metadata } };
}

export function getSessionV2(id) {
  const s = _sessionsV2.get(id);
  return s ? { ...s, metadata: { ...s.metadata } } : null;
}

export function listSessionsV2({ developer, status } = {}) {
  const out = [];
  for (const s of _sessionsV2.values()) {
    if (developer !== undefined && s.developer !== developer) continue;
    if (status !== undefined && s.status !== status) continue;
    out.push({ ...s, metadata: { ...s.metadata } });
  }
  return out;
}

export function setSessionStatusV2(id, nextStatus, { reason, metadata } = {}) {
  const s = _sessionsV2.get(id);
  if (!s) throw new Error(`session ${id} not found`);
  if (_SESSION_TERMINAL_V2.has(s.status))
    throw new Error(`session ${id} is terminal (${s.status})`);
  const allowed = _SESSION_TRANSITIONS_V2.get(s.status);
  if (!allowed || !allowed.has(nextStatus))
    throw new Error(`illegal transition ${s.status} → ${nextStatus}`);
  if (nextStatus === DEV_SESSION_V2.RUNNING) {
    if (
      getRunningSessionCount(s.developer) >= _adMaxRunningSessionsPerDeveloper
    )
      throw new Error(`developer ${s.developer} running session cap reached`);
  }
  s.status = nextStatus;
  s.updatedAt = _now();
  if (reason !== undefined) s.reason = reason;
  if (metadata) s.metadata = { ...s.metadata, ...metadata };
  if (nextStatus === DEV_SESSION_V2.RUNNING && !s.startedAt)
    s.startedAt = s.updatedAt;
  return { ...s, metadata: { ...s.metadata } };
}

export function startSessionV2(id, opts) {
  return setSessionStatusV2(id, DEV_SESSION_V2.RUNNING, opts);
}
export function completeSessionV2(id, opts) {
  return setSessionStatusV2(id, DEV_SESSION_V2.COMPLETED, opts);
}
export function failSessionV2(id, opts) {
  return setSessionStatusV2(id, DEV_SESSION_V2.FAILED, opts);
}
export function cancelSessionV2(id, opts) {
  return setSessionStatusV2(id, DEV_SESSION_V2.CANCELED, opts);
}

export function autoSupersedeStaleDrafts({ now } = {}) {
  const cutoff = (now ?? _now()) - _adAdrStaleMs;
  const flipped = [];
  for (const a of _adrsV2.values()) {
    if (a.status !== ADR_MATURITY_V2.DRAFT) continue;
    if ((a.updatedAt ?? a.createdAt) > cutoff) continue;
    a.status = ADR_MATURITY_V2.SUPERSEDED;
    a.updatedAt = now ?? _now();
    a.reason = "auto_supersede_stale_draft";
    flipped.push(a.id);
  }
  return flipped;
}

export function autoFailStuckSessions({ now } = {}) {
  const cutoff = (now ?? _now()) - _adSessionStuckMs;
  const flipped = [];
  for (const s of _sessionsV2.values()) {
    if (s.status !== DEV_SESSION_V2.RUNNING) continue;
    if (!s.startedAt || s.startedAt > cutoff) continue;
    s.status = DEV_SESSION_V2.FAILED;
    s.updatedAt = now ?? _now();
    s.reason = "auto_fail_stuck";
    flipped.push(s.id);
  }
  return flipped;
}

function _zeroByEnum(enumObj) {
  const out = {};
  for (const v of Object.values(enumObj)) out[v] = 0;
  return out;
}

export function getAutonomousDeveloperStatsV2() {
  const adrs = [..._adrsV2.values()];
  const sessions = [..._sessionsV2.values()];
  const adrsByStatus = _zeroByEnum(ADR_MATURITY_V2);
  for (const a of adrs) adrsByStatus[a.status]++;
  const sessionsByStatus = _zeroByEnum(DEV_SESSION_V2);
  for (const s of sessions) sessionsByStatus[s.status]++;
  return {
    totalAdrsV2: adrs.length,
    totalSessionsV2: sessions.length,
    maxActiveAdrsPerAuthor: _adMaxActiveAdrsPerAuthor,
    maxRunningSessionsPerDeveloper: _adMaxRunningSessionsPerDeveloper,
    adrStaleMs: _adAdrStaleMs,
    sessionStuckMs: _adSessionStuckMs,
    adrsByStatus,
    sessionsByStatus,
  };
}

export function _resetStateV2() {
  _adrsV2.clear();
  _sessionsV2.clear();
  _adMaxActiveAdrsPerAuthor = AD_DEFAULT_MAX_ACTIVE_ADRS_PER_AUTHOR;
  _adMaxRunningSessionsPerDeveloper =
    AD_DEFAULT_MAX_RUNNING_SESSIONS_PER_DEVELOPER;
  _adAdrStaleMs = AD_DEFAULT_ADR_STALE_MS;
  _adSessionStuckMs = AD_DEFAULT_SESSION_STUCK_MS;
}

// =====================================================================
// autonomous-developer V2 governance overlay (iter24)
// =====================================================================
export const DEVGOV_PROFILE_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  PAUSED: "paused",
  ARCHIVED: "archived",
});
export const DEVGOV_RUN_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  DEVELOPING: "developing",
  SHIPPED: "shipped",
  FAILED: "failed",
  CANCELLED: "cancelled",
});
const _devgovPTrans = new Map([
  [
    DEVGOV_PROFILE_MATURITY_V2.PENDING,
    new Set([
      DEVGOV_PROFILE_MATURITY_V2.ACTIVE,
      DEVGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    DEVGOV_PROFILE_MATURITY_V2.ACTIVE,
    new Set([
      DEVGOV_PROFILE_MATURITY_V2.PAUSED,
      DEVGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    DEVGOV_PROFILE_MATURITY_V2.PAUSED,
    new Set([
      DEVGOV_PROFILE_MATURITY_V2.ACTIVE,
      DEVGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [DEVGOV_PROFILE_MATURITY_V2.ARCHIVED, new Set()],
]);
const _devgovPTerminal = new Set([DEVGOV_PROFILE_MATURITY_V2.ARCHIVED]);
const _devgovJTrans = new Map([
  [
    DEVGOV_RUN_LIFECYCLE_V2.QUEUED,
    new Set([
      DEVGOV_RUN_LIFECYCLE_V2.DEVELOPING,
      DEVGOV_RUN_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [
    DEVGOV_RUN_LIFECYCLE_V2.DEVELOPING,
    new Set([
      DEVGOV_RUN_LIFECYCLE_V2.SHIPPED,
      DEVGOV_RUN_LIFECYCLE_V2.FAILED,
      DEVGOV_RUN_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [DEVGOV_RUN_LIFECYCLE_V2.SHIPPED, new Set()],
  [DEVGOV_RUN_LIFECYCLE_V2.FAILED, new Set()],
  [DEVGOV_RUN_LIFECYCLE_V2.CANCELLED, new Set()],
]);
const _devgovPsV2 = new Map();
const _devgovJsV2 = new Map();
let _devgovMaxActive = 6,
  _devgovMaxPending = 15,
  _devgovIdleMs = 30 * 24 * 60 * 60 * 1000,
  _devgovStuckMs = 60 * 1000;
function _devgovPos(n, label) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${label} must be positive integer`);
  return v;
}
function _devgovCheckP(from, to) {
  const a = _devgovPTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid devgov profile transition ${from} → ${to}`);
}
function _devgovCheckJ(from, to) {
  const a = _devgovJTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid devgov run transition ${from} → ${to}`);
}
function _devgovCountActive(owner) {
  let c = 0;
  for (const p of _devgovPsV2.values())
    if (p.owner === owner && p.status === DEVGOV_PROFILE_MATURITY_V2.ACTIVE)
      c++;
  return c;
}
function _devgovCountPending(profileId) {
  let c = 0;
  for (const j of _devgovJsV2.values())
    if (
      j.profileId === profileId &&
      (j.status === DEVGOV_RUN_LIFECYCLE_V2.QUEUED ||
        j.status === DEVGOV_RUN_LIFECYCLE_V2.DEVELOPING)
    )
      c++;
  return c;
}
export function setMaxActiveDevgovProfilesPerOwnerV2(n) {
  _devgovMaxActive = _devgovPos(n, "maxActiveDevgovProfilesPerOwner");
}
export function getMaxActiveDevgovProfilesPerOwnerV2() {
  return _devgovMaxActive;
}
export function setMaxPendingDevgovRunsPerProfileV2(n) {
  _devgovMaxPending = _devgovPos(n, "maxPendingDevgovRunsPerProfile");
}
export function getMaxPendingDevgovRunsPerProfileV2() {
  return _devgovMaxPending;
}
export function setDevgovProfileIdleMsV2(n) {
  _devgovIdleMs = _devgovPos(n, "devgovProfileIdleMs");
}
export function getDevgovProfileIdleMsV2() {
  return _devgovIdleMs;
}
export function setDevgovRunStuckMsV2(n) {
  _devgovStuckMs = _devgovPos(n, "devgovRunStuckMs");
}
export function getDevgovRunStuckMsV2() {
  return _devgovStuckMs;
}
export function _resetStateAutonomousDeveloperGovV2() {
  _devgovPsV2.clear();
  _devgovJsV2.clear();
  _devgovMaxActive = 6;
  _devgovMaxPending = 15;
  _devgovIdleMs = 30 * 24 * 60 * 60 * 1000;
  _devgovStuckMs = 60 * 1000;
}
export function registerDevgovProfileV2({ id, owner, level, metadata } = {}) {
  if (!id || !owner) throw new Error("id and owner required");
  if (_devgovPsV2.has(id))
    throw new Error(`devgov profile ${id} already exists`);
  const now = Date.now();
  const p = {
    id,
    owner,
    level: level || "assist",
    status: DEVGOV_PROFILE_MATURITY_V2.PENDING,
    createdAt: now,
    updatedAt: now,
    lastTouchedAt: now,
    activatedAt: null,
    archivedAt: null,
    metadata: { ...(metadata || {}) },
  };
  _devgovPsV2.set(id, p);
  return { ...p, metadata: { ...p.metadata } };
}
export function activateDevgovProfileV2(id) {
  const p = _devgovPsV2.get(id);
  if (!p) throw new Error(`devgov profile ${id} not found`);
  const isInitial = p.status === DEVGOV_PROFILE_MATURITY_V2.PENDING;
  _devgovCheckP(p.status, DEVGOV_PROFILE_MATURITY_V2.ACTIVE);
  if (isInitial && _devgovCountActive(p.owner) >= _devgovMaxActive)
    throw new Error(`max active devgov profiles for owner ${p.owner} reached`);
  const now = Date.now();
  p.status = DEVGOV_PROFILE_MATURITY_V2.ACTIVE;
  p.updatedAt = now;
  p.lastTouchedAt = now;
  if (!p.activatedAt) p.activatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function pauseDevgovProfileV2(id) {
  const p = _devgovPsV2.get(id);
  if (!p) throw new Error(`devgov profile ${id} not found`);
  _devgovCheckP(p.status, DEVGOV_PROFILE_MATURITY_V2.PAUSED);
  p.status = DEVGOV_PROFILE_MATURITY_V2.PAUSED;
  p.updatedAt = Date.now();
  return { ...p, metadata: { ...p.metadata } };
}
export function archiveDevgovProfileV2(id) {
  const p = _devgovPsV2.get(id);
  if (!p) throw new Error(`devgov profile ${id} not found`);
  _devgovCheckP(p.status, DEVGOV_PROFILE_MATURITY_V2.ARCHIVED);
  const now = Date.now();
  p.status = DEVGOV_PROFILE_MATURITY_V2.ARCHIVED;
  p.updatedAt = now;
  if (!p.archivedAt) p.archivedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function touchDevgovProfileV2(id) {
  const p = _devgovPsV2.get(id);
  if (!p) throw new Error(`devgov profile ${id} not found`);
  if (_devgovPTerminal.has(p.status))
    throw new Error(`cannot touch terminal devgov profile ${id}`);
  const now = Date.now();
  p.lastTouchedAt = now;
  p.updatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function getDevgovProfileV2(id) {
  const p = _devgovPsV2.get(id);
  if (!p) return null;
  return { ...p, metadata: { ...p.metadata } };
}
export function listDevgovProfilesV2() {
  return [..._devgovPsV2.values()].map((p) => ({
    ...p,
    metadata: { ...p.metadata },
  }));
}
export function createDevgovRunV2({ id, profileId, goal, metadata } = {}) {
  if (!id || !profileId) throw new Error("id and profileId required");
  if (_devgovJsV2.has(id)) throw new Error(`devgov run ${id} already exists`);
  if (!_devgovPsV2.has(profileId))
    throw new Error(`devgov profile ${profileId} not found`);
  if (_devgovCountPending(profileId) >= _devgovMaxPending)
    throw new Error(`max pending devgov runs for profile ${profileId} reached`);
  const now = Date.now();
  const j = {
    id,
    profileId,
    goal: goal || "",
    status: DEVGOV_RUN_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    settledAt: null,
    metadata: { ...(metadata || {}) },
  };
  _devgovJsV2.set(id, j);
  return { ...j, metadata: { ...j.metadata } };
}
export function developingDevgovRunV2(id) {
  const j = _devgovJsV2.get(id);
  if (!j) throw new Error(`devgov run ${id} not found`);
  _devgovCheckJ(j.status, DEVGOV_RUN_LIFECYCLE_V2.DEVELOPING);
  const now = Date.now();
  j.status = DEVGOV_RUN_LIFECYCLE_V2.DEVELOPING;
  j.updatedAt = now;
  if (!j.startedAt) j.startedAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function completeRunDevgovV2(id) {
  const j = _devgovJsV2.get(id);
  if (!j) throw new Error(`devgov run ${id} not found`);
  _devgovCheckJ(j.status, DEVGOV_RUN_LIFECYCLE_V2.SHIPPED);
  const now = Date.now();
  j.status = DEVGOV_RUN_LIFECYCLE_V2.SHIPPED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function failDevgovRunV2(id, reason) {
  const j = _devgovJsV2.get(id);
  if (!j) throw new Error(`devgov run ${id} not found`);
  _devgovCheckJ(j.status, DEVGOV_RUN_LIFECYCLE_V2.FAILED);
  const now = Date.now();
  j.status = DEVGOV_RUN_LIFECYCLE_V2.FAILED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.failReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function cancelDevgovRunV2(id, reason) {
  const j = _devgovJsV2.get(id);
  if (!j) throw new Error(`devgov run ${id} not found`);
  _devgovCheckJ(j.status, DEVGOV_RUN_LIFECYCLE_V2.CANCELLED);
  const now = Date.now();
  j.status = DEVGOV_RUN_LIFECYCLE_V2.CANCELLED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.cancelReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function getDevgovRunV2(id) {
  const j = _devgovJsV2.get(id);
  if (!j) return null;
  return { ...j, metadata: { ...j.metadata } };
}
export function listDevgovRunsV2() {
  return [..._devgovJsV2.values()].map((j) => ({
    ...j,
    metadata: { ...j.metadata },
  }));
}
export function autoPauseIdleDevgovProfilesV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const p of _devgovPsV2.values())
    if (
      p.status === DEVGOV_PROFILE_MATURITY_V2.ACTIVE &&
      t - p.lastTouchedAt >= _devgovIdleMs
    ) {
      p.status = DEVGOV_PROFILE_MATURITY_V2.PAUSED;
      p.updatedAt = t;
      flipped.push(p.id);
    }
  return { flipped, count: flipped.length };
}
export function autoFailStuckDevgovRunsV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const j of _devgovJsV2.values())
    if (
      j.status === DEVGOV_RUN_LIFECYCLE_V2.DEVELOPING &&
      j.startedAt != null &&
      t - j.startedAt >= _devgovStuckMs
    ) {
      j.status = DEVGOV_RUN_LIFECYCLE_V2.FAILED;
      j.updatedAt = t;
      if (!j.settledAt) j.settledAt = t;
      j.metadata.failReason = "auto-fail-stuck";
      flipped.push(j.id);
    }
  return { flipped, count: flipped.length };
}
export function getAutonomousDeveloperGovStatsV2() {
  const profilesByStatus = {};
  for (const v of Object.values(DEVGOV_PROFILE_MATURITY_V2))
    profilesByStatus[v] = 0;
  for (const p of _devgovPsV2.values()) profilesByStatus[p.status]++;
  const runsByStatus = {};
  for (const v of Object.values(DEVGOV_RUN_LIFECYCLE_V2)) runsByStatus[v] = 0;
  for (const j of _devgovJsV2.values()) runsByStatus[j.status]++;
  return {
    totalDevgovProfilesV2: _devgovPsV2.size,
    totalDevgovRunsV2: _devgovJsV2.size,
    maxActiveDevgovProfilesPerOwner: _devgovMaxActive,
    maxPendingDevgovRunsPerProfile: _devgovMaxPending,
    devgovProfileIdleMs: _devgovIdleMs,
    devgovRunStuckMs: _devgovStuckMs,
    profilesByStatus,
    runsByStatus,
  };
}
