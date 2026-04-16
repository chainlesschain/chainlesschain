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
