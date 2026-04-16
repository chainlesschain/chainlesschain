/**
 * Unit tests for autonomous-developer (Phase 63 CLI port).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

import { MockDatabase } from "../helpers/mock-db.js";
import {
  ensureAutonomousDevTables,
  listAutonomyLevels,
  listPhases,
  listRefactoringTypes,
  startDevSession,
  getSession,
  listSessions,
  advancePhase,
  pauseSession,
  resumeSession,
  completeSession,
  failSession,
  reviewCode,
  recordADR,
  listADRs,
  renderADR,
  AUTONOMY_LEVELS,
  DEV_PHASES,
  SESSION_STATUS,
  ADR_STATUS,
  REFACTORING_TYPES,
  _resetState,
} from "../../src/lib/autonomous-developer.js";

describe("autonomous-developer", () => {
  let db;
  let tmpFile;

  beforeEach(() => {
    _resetState();
    db = new MockDatabase();
    ensureAutonomousDevTables(db);
  });

  afterEach(() => {
    if (tmpFile && fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    tmpFile = null;
  });

  /* ── Schema / constants ────────────────────────────────────── */

  describe("ensureAutonomousDevTables", () => {
    it("creates dev_sessions + architecture_decisions tables", () => {
      expect(db.tables.has("dev_sessions")).toBe(true);
      expect(db.tables.has("architecture_decisions")).toBe(true);
    });

    it("is idempotent", () => {
      ensureAutonomousDevTables(db);
      ensureAutonomousDevTables(db);
      expect(db.tables.has("dev_sessions")).toBe(true);
    });

    it("no-ops when db is null", () => {
      expect(() => ensureAutonomousDevTables(null)).not.toThrow();
    });
  });

  describe("Constants", () => {
    it("exposes 5 autonomy levels L0..L4", () => {
      const levels = listAutonomyLevels();
      expect(levels).toHaveLength(5);
      expect(levels.map((l) => l.level)).toEqual([0, 1, 2, 3, 4]);
    });

    it("L2 is default medium complexity", () => {
      expect(AUTONOMY_LEVELS.L2.level).toBe(2);
      expect(AUTONOMY_LEVELS.L2.capabilities).toContain("code_gen");
    });

    it("lists 6 phases in order", () => {
      const phases = listPhases();
      expect(phases).toEqual([
        "requirement_analysis",
        "design",
        "implementation",
        "testing",
        "review",
        "deployment",
      ]);
    });

    it("lists refactoring types", () => {
      const types = listRefactoringTypes();
      expect(types).toContain(REFACTORING_TYPES.EXTRACT_METHOD);
      expect(types).toContain(REFACTORING_TYPES.RENAME_VARIABLE);
      expect(types).toContain(REFACTORING_TYPES.SIMPLIFY_LOGIC);
    });
  });

  /* ── startDevSession ───────────────────────────────────────── */

  describe("startDevSession", () => {
    it("creates a session with default L2 + requirement_analysis phase", () => {
      const s = startDevSession(db, { requirement: "Build a login page" });
      expect(s.sessionId).toMatch(/^[0-9a-f-]{36}$/);
      expect(s.requirement).toBe("Build a login page");
      expect(s.currentPhase).toBe(DEV_PHASES.REQUIREMENT_ANALYSIS);
      expect(s.status).toBe(SESSION_STATUS.ACTIVE);
      expect(s.autonomyLevel).toBe(2);
      expect(s.startedAt).toBeGreaterThan(0);
    });

    it("persists to DB", () => {
      startDevSession(db, { requirement: "Req" });
      const rows = db.data.get("dev_sessions");
      expect(rows).toHaveLength(1);
      expect(rows[0].requirement).toBe("Req");
      expect(rows[0].status).toBe("active");
    });

    it("strips _seq from returned object", () => {
      const s = startDevSession(db, { requirement: "R" });
      expect(s).not.toHaveProperty("_seq");
    });

    it("accepts custom autonomy level", () => {
      const s = startDevSession(db, { requirement: "R", autonomyLevel: 3 });
      expect(s.autonomyLevel).toBe(3);
    });

    it("rejects empty requirement", () => {
      expect(() => startDevSession(db, { requirement: "" })).toThrow(
        /requirement/,
      );
      expect(() => startDevSession(db, {})).toThrow(/requirement/);
    });

    it("rejects invalid autonomy level", () => {
      expect(() =>
        startDevSession(db, { requirement: "R", autonomyLevel: 5 }),
      ).toThrow(/autonomy/);
      expect(() =>
        startDevSession(db, { requirement: "R", autonomyLevel: -1 }),
      ).toThrow(/autonomy/);
    });

    it("autonomyLevel 0 is not substituted by default", () => {
      const s = startDevSession(db, { requirement: "R", autonomyLevel: 0 });
      expect(s.autonomyLevel).toBe(0);
    });

    it("works without a db (in-memory only)", () => {
      const s = startDevSession(null, { requirement: "R" });
      expect(s.sessionId).toBeTruthy();
      expect(getSession(s.sessionId)).toMatchObject({ requirement: "R" });
    });
  });

  /* ── getSession / listSessions ─────────────────────────────── */

  describe("getSession / listSessions", () => {
    it("getSession returns null for unknown id", () => {
      expect(getSession("nope")).toBeNull();
    });

    it("getSession returns a stripped copy", () => {
      const s = startDevSession(db, { requirement: "R" });
      const got = getSession(s.sessionId);
      expect(got).not.toHaveProperty("_seq");
      expect(got.requirement).toBe("R");
    });

    it("listSessions sorts by startedAt desc", async () => {
      const a = startDevSession(db, { requirement: "A" });
      const b = startDevSession(db, { requirement: "B" });
      const rows = listSessions();
      expect(rows[0].sessionId).toBe(b.sessionId);
      expect(rows[1].sessionId).toBe(a.sessionId);
    });

    it("filters by status", () => {
      const a = startDevSession(db, { requirement: "A" });
      startDevSession(db, { requirement: "B" });
      pauseSession(db, a.sessionId);
      const paused = listSessions({ status: "paused" });
      expect(paused).toHaveLength(1);
      expect(paused[0].sessionId).toBe(a.sessionId);
    });

    it("filters by phase", () => {
      const a = startDevSession(db, { requirement: "A" });
      startDevSession(db, { requirement: "B" });
      advancePhase(db, a.sessionId, "design");
      const rows = listSessions({ phase: "design" });
      expect(rows).toHaveLength(1);
      expect(rows[0].sessionId).toBe(a.sessionId);
    });

    it("applies limit", () => {
      for (let i = 0; i < 5; i++) startDevSession(db, { requirement: `R${i}` });
      expect(listSessions({ limit: 3 })).toHaveLength(3);
    });
  });

  /* ── advancePhase ──────────────────────────────────────────── */

  describe("advancePhase", () => {
    it("advances to next phase and updates updatedAt", () => {
      const s = startDevSession(db, { requirement: "R" });
      const result = advancePhase(db, s.sessionId, "design");
      expect(result.currentPhase).toBe("design");
      expect(result.updatedAt).toBeGreaterThanOrEqual(s.updatedAt);
    });

    it("accepts any valid phase (not sequential)", () => {
      const s = startDevSession(db, { requirement: "R" });
      const result = advancePhase(db, s.sessionId, "deployment");
      expect(result.currentPhase).toBe("deployment");
    });

    it("rejects unknown phase", () => {
      const s = startDevSession(db, { requirement: "R" });
      expect(() => advancePhase(db, s.sessionId, "bogus")).toThrow(
        /Invalid phase/,
      );
    });

    it("rejects advancing a paused/completed/failed session", () => {
      const s = startDevSession(db, { requirement: "R" });
      pauseSession(db, s.sessionId);
      expect(() => advancePhase(db, s.sessionId, "design")).toThrow(
        /non-active/,
      );
    });

    it("throws on unknown session id", () => {
      expect(() => advancePhase(db, "nope", "design")).toThrow(
        /Session not found/,
      );
    });
  });

  /* ── pause / resume / complete / fail ──────────────────────── */

  describe("lifecycle transitions", () => {
    it("pause → resume round-trip", () => {
      const s = startDevSession(db, { requirement: "R" });
      const paused = pauseSession(db, s.sessionId);
      expect(paused.status).toBe("paused");
      const resumed = resumeSession(db, s.sessionId);
      expect(resumed.status).toBe("active");
    });

    it("pauseSession rejects already-paused", () => {
      const s = startDevSession(db, { requirement: "R" });
      pauseSession(db, s.sessionId);
      expect(() => pauseSession(db, s.sessionId)).toThrow(/non-active/);
    });

    it("resumeSession rejects non-paused", () => {
      const s = startDevSession(db, { requirement: "R" });
      expect(() => resumeSession(db, s.sessionId)).toThrow(/non-paused/);
    });

    it("completeSession sets completedAt + status", () => {
      const s = startDevSession(db, { requirement: "R" });
      const c = completeSession(db, s.sessionId);
      expect(c.status).toBe("completed");
      expect(c.completedAt).toBeGreaterThan(0);
    });

    it("cannot complete twice", () => {
      const s = startDevSession(db, { requirement: "R" });
      completeSession(db, s.sessionId);
      expect(() => completeSession(db, s.sessionId)).toThrow(/terminal/);
    });

    it("failSession persists reason in reviewFeedback", () => {
      const s = startDevSession(db, { requirement: "R" });
      const f = failSession(db, s.sessionId, "LLM timed out");
      expect(f.status).toBe("failed");
      expect(f.reviewFeedback).toEqual(
        expect.objectContaining({ failureReason: "LLM timed out" }),
      );
    });

    it("failSession without reason still transitions status", () => {
      const s = startDevSession(db, { requirement: "R" });
      const f = failSession(db, s.sessionId);
      expect(f.status).toBe("failed");
    });

    it("cannot fail a completed session", () => {
      const s = startDevSession(db, { requirement: "R" });
      completeSession(db, s.sessionId);
      expect(() => failSession(db, s.sessionId, "late")).toThrow(/terminal/);
    });

    it("can pause + complete (from paused, skipping resume)", () => {
      // status ACTIVE → PAUSED → COMPLETED is valid (non-terminal → terminal)
      const s = startDevSession(db, { requirement: "R" });
      pauseSession(db, s.sessionId);
      const c = completeSession(db, s.sessionId);
      expect(c.status).toBe("completed");
    });
  });

  /* ── reviewCode ────────────────────────────────────────────── */

  describe("reviewCode", () => {
    function _writeTmp(content) {
      tmpFile = path.join(
        os.tmpdir(),
        `review-${Date.now()}-${Math.random()}.js`,
      );
      fs.writeFileSync(tmpFile, content, "utf-8");
      return tmpFile;
    }

    it("returns grade A + passed=true for clean code", () => {
      const file = _writeTmp(
        "function add(a, b) { return a + b; }\nfunction mul(a, b) { return a * b; }\n",
      );
      const r = reviewCode(file);
      expect(r.totalFindings).toBe(0);
      expect(r.score).toBe(1);
      expect(r.grade).toBe("A");
      expect(r.passed).toBe(true);
    });

    it("penalizes findings with severity-weighted score", () => {
      // Create a clearly-too-long method
      const body = Array.from(
        { length: 100 },
        (_, i) => `  const a${i} = ${i % 2 ? "true" : "false"};`,
      ).join("\n");
      const file = _writeTmp(`function giant() {\n${body}\n}\n`);
      const r = reviewCode(file);
      expect(r.totalFindings).toBeGreaterThan(0);
      expect(r.score).toBeLessThan(1);
      expect(["A", "B", "C", "D", "F"]).toContain(r.grade);
    });

    it("respects custom minScore", () => {
      const file = _writeTmp("function a() { return 1; }\n");
      expect(reviewCode(file, { minScore: 2 }).passed).toBe(false);
      expect(reviewCode(file, { minScore: 0 }).passed).toBe(true);
    });

    it("attaches review to session when sessionId provided", () => {
      const file = _writeTmp("function a() { return 1; }\n");
      const s = startDevSession(db, { requirement: "R" });
      reviewCode(file, { sessionId: s.sessionId, db });
      const got = getSession(s.sessionId);
      expect(got.reviewFeedback.reviews).toHaveLength(1);
      expect(got.reviewFeedback.reviews[0].grade).toBe("A");
    });

    it("silently ignores unknown sessionId", () => {
      const file = _writeTmp("function a() { return 1; }\n");
      expect(() => reviewCode(file, { sessionId: "nope" })).not.toThrow();
    });

    it("throws when file is missing", () => {
      expect(() => reviewCode("C:/this/does/not/exist.js")).toThrow(
        /File not found/,
      );
    });
  });

  /* ── ADRs ──────────────────────────────────────────────────── */

  describe("recordADR / listADRs", () => {
    let sessionId;
    beforeEach(() => {
      sessionId = startDevSession(db, { requirement: "R" }).sessionId;
    });

    it("records an ADR with default accepted status", () => {
      const a = recordADR(db, {
        sessionId,
        title: "Use SQLite",
        context: "Need embedded DB",
        decision: "Choose SQLite for simplicity",
      });
      expect(a.adrId).toMatch(/^[0-9a-f-]{36}$/);
      expect(a.status).toBe(ADR_STATUS.ACCEPTED);
      expect(a.sessionId).toBe(sessionId);
    });

    it("persists to DB", () => {
      recordADR(db, {
        sessionId,
        title: "T",
        context: "C",
        decision: "D",
      });
      expect(db.data.get("architecture_decisions")).toHaveLength(1);
    });

    it("rejects missing session", () => {
      expect(() =>
        recordADR(db, {
          sessionId: "nope",
          title: "T",
          context: "C",
          decision: "D",
        }),
      ).toThrow(/Session not found/);
    });

    it("validates required fields", () => {
      expect(() =>
        recordADR(db, { sessionId, title: "", context: "C", decision: "D" }),
      ).toThrow(/title/);
      expect(() =>
        recordADR(db, { sessionId, title: "T", context: "", decision: "D" }),
      ).toThrow(/context/);
      expect(() =>
        recordADR(db, { sessionId, title: "T", context: "C", decision: "" }),
      ).toThrow(/decision/);
    });

    it("rejects invalid status", () => {
      expect(() =>
        recordADR(db, {
          sessionId,
          title: "T",
          context: "C",
          decision: "D",
          status: "bogus",
        }),
      ).toThrow(/ADR status/);
    });

    it("accepts alternatives array", () => {
      const a = recordADR(db, {
        sessionId,
        title: "T",
        context: "C",
        decision: "D",
        alternatives: ["MongoDB", "PostgreSQL"],
      });
      expect(a.alternatives).toEqual(["MongoDB", "PostgreSQL"]);
    });

    it("listADRs filters by sessionId", () => {
      const s2 = startDevSession(db, { requirement: "R2" }).sessionId;
      recordADR(db, {
        sessionId,
        title: "A1",
        context: "C",
        decision: "D",
      });
      recordADR(db, {
        sessionId: s2,
        title: "A2",
        context: "C",
        decision: "D",
      });
      const filtered = listADRs({ sessionId });
      expect(filtered).toHaveLength(1);
      expect(filtered[0].title).toBe("A1");
    });

    it("listADRs filters by status", () => {
      recordADR(db, {
        sessionId,
        title: "A1",
        context: "C",
        decision: "D",
        status: "proposed",
      });
      recordADR(db, {
        sessionId,
        title: "A2",
        context: "C",
        decision: "D",
        status: "accepted",
      });
      const proposed = listADRs({ status: "proposed" });
      expect(proposed).toHaveLength(1);
      expect(proposed[0].title).toBe("A1");
    });

    it("sorts by createdAt asc (chronological)", () => {
      const a1 = recordADR(db, {
        sessionId,
        title: "A1",
        context: "C",
        decision: "D",
      });
      const a2 = recordADR(db, {
        sessionId,
        title: "A2",
        context: "C",
        decision: "D",
      });
      const rows = listADRs();
      expect(rows[0].adrId).toBe(a1.adrId);
      expect(rows[1].adrId).toBe(a2.adrId);
    });

    it("applies limit", () => {
      for (let i = 0; i < 5; i++) {
        recordADR(db, {
          sessionId,
          title: `A${i}`,
          context: "C",
          decision: "D",
        });
      }
      expect(listADRs({ limit: 2 })).toHaveLength(2);
    });
  });

  /* ── renderADR ─────────────────────────────────────────────── */

  describe("renderADR", () => {
    it("produces a complete markdown template", () => {
      const sessionId = startDevSession(db, { requirement: "R" }).sessionId;
      const a = recordADR(db, {
        sessionId,
        title: "Use SQLite",
        context: "Need embedded DB",
        decision: "Choose SQLite",
        consequences: "Simple deployment",
        alternatives: ["PostgreSQL", "MongoDB"],
      });
      const md = renderADR(a);
      expect(md).toContain("# ADR: Use SQLite");
      expect(md).toContain("## Status");
      expect(md).toContain("## Context");
      expect(md).toContain("## Decision");
      expect(md).toContain("## Consequences");
      expect(md).toContain("## Alternatives");
      expect(md).toContain("- PostgreSQL");
    });

    it("shows (none) for empty fields", () => {
      const sessionId = startDevSession(db, { requirement: "R" }).sessionId;
      const a = recordADR(db, {
        sessionId,
        title: "T",
        context: "C",
        decision: "D",
      });
      const md = renderADR(a);
      expect(md).toMatch(/## Consequences\s*\n\(none\)/);
      expect(md).toMatch(/## Alternatives\s*\n\(none\)/);
    });
  });
});
