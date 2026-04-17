import { describe, it, expect, beforeEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { MockDatabase } from "../helpers/mock-db.js";

import {
  MODALITIES,
  MODALITY_WEIGHTS,
  INPUT_FORMATS,
  NATIVE_FORMATS,
  OUTPUT_FORMATS,
  SESSION_STATUS,
  DEFAULT_MAX_TOKENS,
  ensureMultimodalTables,
  createSession,
  getSession,
  listSessions,
  completeSession,
  deleteSession,
  addModality,
  getSessionModalities,
  fuse,
  parseDocument,
  getSupportedFormats,
  buildContext,
  getContext,
  clearContext,
  trimContext,
  generateOutput,
  getOutputFormats,
  listArtifacts,
  getMultimodalStats,
  _resetState,
} from "../../src/lib/multimodal.js";

describe("multimodal", () => {
  let db;

  beforeEach(() => {
    _resetState();
    db = new MockDatabase();
    ensureMultimodalTables(db);
  });

  /* ── Schema ─────────────────────────────────────────── */

  describe("ensureMultimodalTables", () => {
    it("creates sessions and artifacts tables", () => {
      expect(db.tables.has("multimodal_sessions")).toBe(true);
      expect(db.tables.has("multimodal_artifacts")).toBe(true);
    });

    it("is idempotent", () => {
      ensureMultimodalTables(db);
      expect(db.tables.has("multimodal_sessions")).toBe(true);
    });
  });

  /* ── Catalogs ───────────────────────────────────────── */

  describe("catalogs", () => {
    it("has 5 modalities", () => {
      expect(MODALITIES).toHaveLength(5);
      expect(MODALITIES).toEqual([
        "text",
        "document",
        "image",
        "audio",
        "screen",
      ]);
    });

    it("has descending weights from text to screen", () => {
      expect(MODALITY_WEIGHTS.text).toBe(1.0);
      expect(MODALITY_WEIGHTS.document).toBe(0.9);
      expect(MODALITY_WEIGHTS.image).toBe(0.8);
      expect(MODALITY_WEIGHTS.audio).toBe(0.7);
      expect(MODALITY_WEIGHTS.screen).toBe(0.6);
    });

    it("has 7 input formats and 4 native", () => {
      expect(INPUT_FORMATS).toHaveLength(7);
      expect(NATIVE_FORMATS).toHaveLength(4);
      expect(NATIVE_FORMATS).toEqual(["txt", "md", "csv", "json"]);
    });

    it("has 6 output formats", () => {
      expect(OUTPUT_FORMATS).toHaveLength(6);
      expect(OUTPUT_FORMATS).toContain("markdown");
      expect(OUTPUT_FORMATS).toContain("chart");
    });

    it("session statuses has active and completed", () => {
      expect(Object.values(SESSION_STATUS)).toEqual(["active", "completed"]);
    });

    it("default max tokens is 4000", () => {
      expect(DEFAULT_MAX_TOKENS).toBe(4000);
    });
  });

  /* ── Session lifecycle ──────────────────────────────── */

  describe("createSession", () => {
    it("creates a session with a UUID", () => {
      const r = createSession(db, { title: "t" });
      expect(r.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    });

    it("creates a session with metadata", () => {
      const r = createSession(db, { metadata: { foo: "bar" } });
      const s = getSession(db, r.sessionId);
      expect(s.context).toEqual({ foo: "bar" });
    });

    it("session starts in active state with 0 tokens", () => {
      const r = createSession(db);
      const s = getSession(db, r.sessionId);
      expect(s.status).toBe("active");
      expect(s.tokenCount).toBe(0);
      expect(s.modalities).toEqual([]);
    });
  });

  describe("getSession", () => {
    it("returns null for unknown id", () => {
      expect(getSession(db, "bogus")).toBeNull();
    });
  });

  describe("listSessions", () => {
    it("lists all sessions sorted by created desc", () => {
      createSession(db);
      createSession(db);
      const rows = listSessions(db);
      expect(rows).toHaveLength(2);
    });

    it("filters by status", () => {
      const r1 = createSession(db);
      createSession(db);
      completeSession(db, r1.sessionId);
      expect(listSessions(db, { status: "completed" })).toHaveLength(1);
      expect(listSessions(db, { status: "active" })).toHaveLength(1);
    });

    it("honors limit", () => {
      createSession(db);
      createSession(db);
      createSession(db);
      expect(listSessions(db, { limit: 2 })).toHaveLength(2);
    });
  });

  describe("completeSession", () => {
    it("flips status to completed", () => {
      const { sessionId } = createSession(db);
      const r = completeSession(db, sessionId);
      expect(r.completed).toBe(true);
      expect(getSession(db, sessionId).status).toBe("completed");
    });

    it("rejects unknown id", () => {
      expect(completeSession(db, "bogus").reason).toBe("not_found");
    });
  });

  describe("deleteSession", () => {
    it("deletes session and its artifacts", () => {
      const { sessionId } = createSession(db);
      addModality(db, sessionId, "text", "content");
      deleteSession(db, sessionId);
      expect(getSession(db, sessionId)).toBeNull();
      expect(listArtifacts(db, sessionId)).toHaveLength(0);
    });

    it("rejects unknown id", () => {
      expect(deleteSession(db, "bogus").reason).toBe("not_found");
    });
  });

  /* ── Modalities ─────────────────────────────────────── */

  describe("addModality", () => {
    it("rejects unknown modality", () => {
      const { sessionId } = createSession(db);
      expect(addModality(db, sessionId, "bogus", "x").reason).toBe(
        "unknown_modality",
      );
    });

    it("rejects unknown session", () => {
      expect(addModality(db, "bogus", "text", "x").reason).toBe(
        "session_not_found",
      );
    });

    it("adds modality and updates session modalities list", () => {
      const { sessionId } = createSession(db);
      const r = addModality(db, sessionId, "text", "hello");
      expect(r.added).toBe(true);
      expect(r.modality).toBe("text");
      const s = getSession(db, sessionId);
      expect(s.modalities).toContain("text");
    });

    it("deduplicates modalities in session list", () => {
      const { sessionId } = createSession(db);
      addModality(db, sessionId, "text", "hello");
      addModality(db, sessionId, "text", "world");
      const s = getSession(db, sessionId);
      expect(s.modalities).toEqual(["text"]);
    });

    it("supports object content (stored as JSON)", () => {
      const { sessionId } = createSession(db);
      addModality(db, sessionId, "document", { title: "doc", pages: 3 });
      const arts = listArtifacts(db, sessionId);
      expect(arts[0].content).toEqual({ title: "doc", pages: 3 });
    });
  });

  describe("getSessionModalities", () => {
    it("groups artifacts by modality", () => {
      const { sessionId } = createSession(db);
      addModality(db, sessionId, "text", "a");
      addModality(db, sessionId, "text", "b");
      addModality(db, sessionId, "image", "img1");
      const r = getSessionModalities(db, sessionId);
      expect(r.text).toHaveLength(2);
      expect(r.image).toHaveLength(1);
    });

    it("returns empty for unknown session", () => {
      expect(getSessionModalities(db, "bogus")).toEqual([]);
    });
  });

  /* ── Fusion ─────────────────────────────────────────── */

  describe("fuse", () => {
    it("rejects unknown session", () => {
      expect(fuse(db, "bogus").reason).toBe("session_not_found");
    });

    it("rejects session with no input", () => {
      const { sessionId } = createSession(db);
      expect(fuse(db, sessionId).reason).toBe("no_input");
    });

    it("orders by priority (text before screen)", () => {
      const { sessionId } = createSession(db);
      addModality(db, sessionId, "screen", "screen content");
      addModality(db, sessionId, "text", "text content");
      const r = fuse(db, sessionId);
      expect(r.content.indexOf("text content")).toBeLessThan(
        r.content.indexOf("screen content"),
      );
    });

    it("sums weights across modalities", () => {
      const { sessionId } = createSession(db);
      addModality(db, sessionId, "text", "a"); // 1.0
      addModality(db, sessionId, "image", "b"); // 0.8
      const r = fuse(db, sessionId);
      expect(r.totalWeight).toBeCloseTo(1.8, 1);
    });

    it("returns per-modality summary with counts", () => {
      const { sessionId } = createSession(db);
      addModality(db, sessionId, "text", "a");
      addModality(db, sessionId, "text", "b");
      addModality(db, sessionId, "audio", "c");
      const r = fuse(db, sessionId);
      const textSummary = r.summary.find((s) => s.modality === "text");
      expect(textSummary.count).toBe(2);
    });
  });

  /* ── Document parsing ───────────────────────────────── */

  describe("parseDocument", () => {
    let tmpDir;
    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mm-test-"));
    });

    it("parses txt files", () => {
      const p = path.join(tmpDir, "a.txt");
      fs.writeFileSync(p, "hello world", "utf-8");
      const r = parseDocument(p);
      expect(r.parsed).toBe(true);
      expect(r.format).toBe("txt");
      expect(r.text).toBe("hello world");
    });

    it("parses md files", () => {
      const p = path.join(tmpDir, "a.md");
      fs.writeFileSync(p, "# Title\nbody", "utf-8");
      const r = parseDocument(p);
      expect(r.parsed).toBe(true);
      expect(r.format).toBe("md");
    });

    it("parses json files", () => {
      const p = path.join(tmpDir, "a.json");
      fs.writeFileSync(p, JSON.stringify({ foo: "bar" }), "utf-8");
      const r = parseDocument(p);
      expect(r.parsed).toBe(true);
      expect(r.json).toEqual({ foo: "bar" });
    });

    it("rejects invalid json", () => {
      const p = path.join(tmpDir, "a.json");
      fs.writeFileSync(p, "{ not json", "utf-8");
      const r = parseDocument(p);
      expect(r.parsed).toBe(false);
      expect(r.reason).toBe("invalid_json");
    });

    it("parses csv with header row", () => {
      const p = path.join(tmpDir, "a.csv");
      fs.writeFileSync(p, "a,b\n1,2\n3,4", "utf-8");
      const r = parseDocument(p);
      expect(r.parsed).toBe(true);
      expect(r.rowCount).toBe(2);
      expect(r.rows[0]).toEqual({ a: "1", b: "2" });
    });

    it("reports unsupported format for pdf", () => {
      const p = path.join(tmpDir, "a.pdf");
      fs.writeFileSync(p, "%PDF", "utf-8");
      const r = parseDocument(p);
      expect(r.parsed).toBe(false);
      expect(r.reason).toBe("parser_not_available");
      expect(r.ext).toBe("pdf");
    });

    it("rejects unknown extension", () => {
      const p = path.join(tmpDir, "a.xyz");
      fs.writeFileSync(p, "x", "utf-8");
      const r = parseDocument(p);
      expect(r.reason).toBe("unsupported_format");
    });

    it("accepts inline content override", () => {
      const r = parseDocument("/fake/path.txt", { content: "inline" });
      expect(r.parsed).toBe(true);
      expect(r.text).toBe("inline");
    });

    it("getSupportedFormats returns 7 formats", () => {
      const r = getSupportedFormats();
      expect(r.formats).toHaveLength(7);
      expect(r.native).toHaveLength(4);
    });
  });

  /* ── Context ────────────────────────────────────────── */

  describe("buildContext", () => {
    it("rejects unknown session", () => {
      expect(buildContext(db, "bogus").reason).toBe("session_not_found");
    });

    it("rejects empty session", () => {
      const { sessionId } = createSession(db);
      expect(buildContext(db, sessionId).reason).toBe("no_input");
    });

    it("builds context and caches it", () => {
      const { sessionId } = createSession(db);
      addModality(db, sessionId, "text", "hello world");
      const r = buildContext(db, sessionId);
      expect(r.built).toBe(true);
      expect(r.tokens).toBeGreaterThan(0);
      expect(r.itemCount).toBe(1);
    });

    it("orders items by modality priority", () => {
      const { sessionId } = createSession(db);
      addModality(db, sessionId, "audio", "audio data");
      addModality(db, sessionId, "text", "text data");
      const r = buildContext(db, sessionId);
      expect(r.items[0].modality).toBe("text");
      expect(r.items[1].modality).toBe("audio");
    });

    it("respects maxTokens cap and truncates overflow", () => {
      const { sessionId } = createSession(db);
      addModality(db, sessionId, "text", "a".repeat(2000));
      const r = buildContext(db, sessionId, { maxTokens: 100 });
      expect(r.tokens).toBeLessThanOrEqual(100);
      const last = r.items[r.items.length - 1];
      expect(last.truncated).toBe(true);
    });

    it("persists context on session row", () => {
      const { sessionId } = createSession(db);
      addModality(db, sessionId, "text", "hello");
      buildContext(db, sessionId);
      const s = getSession(db, sessionId);
      expect(s.tokenCount).toBeGreaterThan(0);
    });
  });

  describe("getContext", () => {
    it("returns cached after build", () => {
      const { sessionId } = createSession(db);
      addModality(db, sessionId, "text", "x");
      buildContext(db, sessionId);
      expect(getContext(db, sessionId)).toBeTruthy();
    });

    it("returns null when nothing built", () => {
      const { sessionId } = createSession(db);
      expect(getContext(db, sessionId)).toBeNull();
    });
  });

  describe("clearContext", () => {
    it("wipes cached + persisted context", () => {
      const { sessionId } = createSession(db);
      addModality(db, sessionId, "text", "x");
      buildContext(db, sessionId);
      clearContext(db, sessionId);
      expect(getContext(db, sessionId)).toBeNull();
      expect(getSession(db, sessionId).tokenCount).toBe(0);
    });

    it("rejects unknown session", () => {
      expect(clearContext(db, "bogus").reason).toBe("session_not_found");
    });
  });

  describe("trimContext", () => {
    it("trims an existing context to a smaller max", () => {
      const { sessionId } = createSession(db);
      addModality(db, sessionId, "text", "hello world");
      addModality(db, sessionId, "document", "doc content");
      const ctx = buildContext(db, sessionId);
      const r = trimContext(ctx, 3);
      expect(r.trimmed).toBe(true);
      expect(r.tokens).toBeLessThanOrEqual(3);
    });

    it("rejects invalid context", () => {
      expect(trimContext(null, 100).reason).toBe("invalid_context");
    });
  });

  /* ── Output generation ──────────────────────────────── */

  describe("generateOutput", () => {
    it("rejects unknown format", () => {
      const r = generateOutput(db, null, "x", "bogus");
      expect(r.generated).toBe(false);
      expect(r.reason).toBe("unsupported_format");
    });

    it("generates markdown passthrough", () => {
      const r = generateOutput(db, null, "# title", "markdown");
      expect(r.generated).toBe(true);
      expect(r.content).toBe("# title");
    });

    it("generates minimal HTML with UTF-8 meta", () => {
      const r = generateOutput(db, null, "<p>body</p>", "html");
      expect(r.generated).toBe(true);
      expect(r.content).toContain('<meta charset="UTF-8">');
      expect(r.content).toContain("<p>body</p>");
    });

    it("generates CSV from array-of-objects", () => {
      const r = generateOutput(
        db,
        null,
        [
          { a: 1, b: 2 },
          { a: 3, b: 4 },
        ],
        "csv",
      );
      expect(r.content).toBe("a,b\n1,2\n3,4");
    });

    it("generates JSON with indent", () => {
      const r = generateOutput(db, null, { x: 1 }, "json");
      expect(JSON.parse(r.content)).toEqual({ x: 1 });
    });

    it("generates Reveal.js slides skeleton", () => {
      const r = generateOutput(db, null, ["slide 1", "slide 2"], "slides");
      expect(r.content).toContain("reveal.js");
      expect(r.content).toContain("<section>slide 1</section>");
    });

    it("generates ECharts option JSON", () => {
      const r = generateOutput(
        db,
        null,
        { categories: ["a", "b"], values: [1, 2] },
        "chart",
        { chartType: "bar" },
      );
      const opt = JSON.parse(r.content);
      expect(opt.xAxis.data).toEqual(["a", "b"]);
      expect(opt.series[0].type).toBe("bar");
    });

    it("stores artifact when sessionId passed", () => {
      const { sessionId } = createSession(db);
      generateOutput(db, sessionId, "# x", "markdown");
      const arts = listArtifacts(db, sessionId, { type: "output" });
      expect(arts).toHaveLength(1);
      expect(arts[0].format).toBe("markdown");
    });

    it("getOutputFormats returns 6", () => {
      expect(getOutputFormats()).toHaveLength(6);
    });
  });

  /* ── Artifacts ──────────────────────────────────────── */

  describe("listArtifacts", () => {
    it("filters by type", () => {
      const { sessionId } = createSession(db);
      addModality(db, sessionId, "text", "a");
      generateOutput(db, sessionId, "out", "markdown");
      expect(listArtifacts(db, sessionId, { type: "input" })).toHaveLength(1);
      expect(listArtifacts(db, sessionId, { type: "output" })).toHaveLength(1);
    });

    it("filters by modality", () => {
      const { sessionId } = createSession(db);
      addModality(db, sessionId, "text", "a");
      addModality(db, sessionId, "image", "b");
      expect(listArtifacts(db, sessionId, { modality: "text" })).toHaveLength(
        1,
      );
    });

    it("honors limit", () => {
      const { sessionId } = createSession(db);
      for (let i = 0; i < 5; i++) addModality(db, sessionId, "text", `m${i}`);
      expect(listArtifacts(db, sessionId, { limit: 3 })).toHaveLength(3);
    });
  });

  /* ── Stats ──────────────────────────────────────────── */

  describe("getMultimodalStats", () => {
    it("counts sessions by status", () => {
      const s1 = createSession(db);
      createSession(db);
      completeSession(db, s1.sessionId);
      const stats = getMultimodalStats(db);
      expect(stats.sessions).toBe(2);
      expect(stats.byStatus.active).toBe(1);
      expect(stats.byStatus.completed).toBe(1);
    });

    it("counts inputs and outputs separately", () => {
      const { sessionId } = createSession(db);
      addModality(db, sessionId, "text", "in");
      generateOutput(db, sessionId, "out", "markdown");
      const stats = getMultimodalStats(db);
      expect(stats.inputs).toBe(1);
      expect(stats.outputs).toBe(1);
    });

    it("counts by modality across sessions", () => {
      const a = createSession(db);
      const b = createSession(db);
      addModality(db, a.sessionId, "text", "x");
      addModality(db, b.sessionId, "text", "y");
      addModality(db, b.sessionId, "image", "z");
      const stats = getMultimodalStats(db);
      expect(stats.byModality.text).toBe(2);
      expect(stats.byModality.image).toBe(1);
    });

    it("aggregates total tokens", () => {
      const { sessionId } = createSession(db);
      addModality(db, sessionId, "text", "hello world");
      buildContext(db, sessionId);
      const stats = getMultimodalStats(db);
      expect(stats.totalTokens).toBeGreaterThan(0);
    });
  });
});

/* ═════════════════════════════════════════════════════════ *
 *  Phase 27 V2 Tests
 * ═════════════════════════════════════════════════════════ */

import {
  SESSION_MATURITY_V2,
  ARTIFACT_LIFECYCLE_V2,
  MM_DEFAULT_MAX_ACTIVE_SESSIONS_PER_OWNER,
  MM_DEFAULT_MAX_ARTIFACTS_PER_SESSION,
  MM_DEFAULT_SESSION_IDLE_MS,
  MM_DEFAULT_ARTIFACT_STALE_MS,
  getDefaultMaxActiveSessionsPerOwnerV2,
  getMaxActiveSessionsPerOwnerV2,
  setMaxActiveSessionsPerOwnerV2,
  getDefaultMaxArtifactsPerSessionV2,
  getMaxArtifactsPerSessionV2,
  setMaxArtifactsPerSessionV2,
  getDefaultSessionIdleMsV2,
  getSessionIdleMsV2,
  setSessionIdleMsV2,
  getDefaultArtifactStaleMsV2,
  getArtifactStaleMsV2,
  setArtifactStaleMsV2,
  registerSessionV2,
  getSessionV2,
  setSessionMaturityV2,
  activateSession,
  pauseSession,
  completeSessionV2,
  archiveSession,
  touchSessionActivity,
  registerArtifactV2,
  getArtifactV2,
  setArtifactStatusV2,
  markArtifactReady,
  purgeArtifact,
  touchArtifactAccess,
  getActiveSessionCount,
  getArtifactCount,
  autoArchiveIdleSessions,
  autoPurgeStaleArtifacts,
  getMultimodalStatsV2,
  _resetStateV2,
} from "../../src/lib/multimodal.js";

describe("multimodal V2 (Phase 27)", () => {
  beforeEach(() => {
    _resetStateV2();
  });

  describe("enums + defaults", () => {
    it("frozen session maturity", () => {
      expect(() => {
        SESSION_MATURITY_V2.X = "y";
      }).toThrow();
      expect(Object.keys(SESSION_MATURITY_V2)).toEqual([
        "ONBOARDING",
        "ACTIVE",
        "PAUSED",
        "COMPLETED",
        "ARCHIVED",
      ]);
    });
    it("frozen artifact lifecycle", () => {
      expect(() => {
        ARTIFACT_LIFECYCLE_V2.X = "y";
      }).toThrow();
    });
    it("defaults exposed", () => {
      expect(MM_DEFAULT_MAX_ACTIVE_SESSIONS_PER_OWNER).toBe(50);
      expect(MM_DEFAULT_MAX_ARTIFACTS_PER_SESSION).toBe(200);
      expect(MM_DEFAULT_SESSION_IDLE_MS).toBe(30 * 86400000);
      expect(MM_DEFAULT_ARTIFACT_STALE_MS).toBe(14 * 86400000);
    });
  });

  describe("config mutators", () => {
    it("floors + rejects non-positive", () => {
      expect(setMaxActiveSessionsPerOwnerV2(75.9)).toBe(75);
      expect(() => setMaxActiveSessionsPerOwnerV2(0)).toThrow();
      expect(() => setMaxArtifactsPerSessionV2(-1)).toThrow();
      expect(() => setSessionIdleMsV2(NaN)).toThrow();
      expect(() => setArtifactStaleMsV2("x")).toThrow();
    });
    it("reset restores defaults", () => {
      setMaxActiveSessionsPerOwnerV2(5);
      setMaxArtifactsPerSessionV2(7);
      _resetStateV2();
      expect(getMaxActiveSessionsPerOwnerV2()).toBe(
        getDefaultMaxActiveSessionsPerOwnerV2(),
      );
      expect(getMaxArtifactsPerSessionV2()).toBe(
        getDefaultMaxArtifactsPerSessionV2(),
      );
      expect(getSessionIdleMsV2()).toBe(getDefaultSessionIdleMsV2());
      expect(getArtifactStaleMsV2()).toBe(getDefaultArtifactStaleMsV2());
    });
  });

  describe("registerSessionV2", () => {
    it("defaults to onboarding", () => {
      const r = registerSessionV2(null, { sessionId: "s1", ownerId: "o1" });
      expect(r.status).toBe("onboarding");
    });
    it("active initial passes cap check", () => {
      const r = registerSessionV2(null, {
        sessionId: "s1",
        ownerId: "o1",
        initialStatus: "active",
      });
      expect(r.status).toBe("active");
    });
    it("missing fields throw", () => {
      expect(() => registerSessionV2(null, { ownerId: "o1" })).toThrow(
        "sessionId",
      );
      expect(() => registerSessionV2(null, { sessionId: "s1" })).toThrow(
        "ownerId",
      );
    });
    it("duplicate throws", () => {
      registerSessionV2(null, { sessionId: "s1", ownerId: "o1" });
      expect(() =>
        registerSessionV2(null, { sessionId: "s1", ownerId: "o1" }),
      ).toThrow("already exists");
    });
    it("invalid + terminal initial throws", () => {
      expect(() =>
        registerSessionV2(null, {
          sessionId: "s1",
          ownerId: "o1",
          initialStatus: "nope",
        }),
      ).toThrow();
      expect(() =>
        registerSessionV2(null, {
          sessionId: "s1",
          ownerId: "o1",
          initialStatus: "archived",
        }),
      ).toThrow("terminal");
    });
    it("per-owner active cap", () => {
      setMaxActiveSessionsPerOwnerV2(2);
      registerSessionV2(null, {
        sessionId: "s1",
        ownerId: "o1",
        initialStatus: "active",
      });
      registerSessionV2(null, {
        sessionId: "s2",
        ownerId: "o1",
        initialStatus: "active",
      });
      expect(() =>
        registerSessionV2(null, {
          sessionId: "s3",
          ownerId: "o1",
          initialStatus: "active",
        }),
      ).toThrow("active-session cap");
      // different owner unaffected
      expect(
        registerSessionV2(null, {
          sessionId: "s4",
          ownerId: "o2",
          initialStatus: "active",
        }),
      ).toBeDefined();
    });
  });

  describe("setSessionMaturityV2", () => {
    it("full valid traversal", () => {
      registerSessionV2(null, { sessionId: "s1", ownerId: "o1" });
      expect(setSessionMaturityV2(null, "s1", "active").status).toBe("active");
      expect(setSessionMaturityV2(null, "s1", "paused").status).toBe("paused");
      expect(setSessionMaturityV2(null, "s1", "active").status).toBe("active");
      expect(setSessionMaturityV2(null, "s1", "completed").status).toBe(
        "completed",
      );
      expect(setSessionMaturityV2(null, "s1", "archived").status).toBe(
        "archived",
      );
    });
    it("terminal + unknown + invalid throw", () => {
      registerSessionV2(null, { sessionId: "s1", ownerId: "o1" });
      setSessionMaturityV2(null, "s1", "archived");
      expect(() => setSessionMaturityV2(null, "s1", "active")).toThrow(
        "Invalid transition",
      );
      expect(() => setSessionMaturityV2(null, "nope", "active")).toThrow(
        "Unknown",
      );
      registerSessionV2(null, { sessionId: "s2", ownerId: "o1" });
      expect(() => setSessionMaturityV2(null, "s2", "bogus")).toThrow(
        "Invalid status",
      );
    });
    it("activation cap + patch merge", () => {
      setMaxActiveSessionsPerOwnerV2(1);
      registerSessionV2(null, {
        sessionId: "s1",
        ownerId: "o1",
        initialStatus: "active",
      });
      registerSessionV2(null, { sessionId: "s2", ownerId: "o1" });
      expect(() => setSessionMaturityV2(null, "s2", "active")).toThrow(
        "active-session cap",
      );
      registerSessionV2(null, {
        sessionId: "s3",
        ownerId: "o1",
        metadata: { a: 1 },
      });
      const r = setSessionMaturityV2(null, "s3", "archived", {
        reason: "abc",
        metadata: { b: 2 },
      });
      expect(r.lastReason).toBe("abc");
      expect(r.metadata).toEqual({ a: 1, b: 2 });
    });
  });

  describe("shortcuts + touch", () => {
    it("activate/pause/complete/archive", () => {
      registerSessionV2(null, { sessionId: "s1", ownerId: "o1" });
      expect(activateSession(null, "s1", "r").status).toBe("active");
      expect(pauseSession(null, "s1", "r").status).toBe("paused");
      activateSession(null, "s1");
      expect(completeSessionV2(null, "s1", "done").status).toBe("completed");
      expect(archiveSession(null, "s1", "d").status).toBe("archived");
    });
    it("touchSessionActivity bumps + unknown throws", () => {
      registerSessionV2(null, { sessionId: "s1", ownerId: "o1" });
      const t1 = getSessionV2("s1").lastActivityAt;
      const r = touchSessionActivity("s1");
      expect(r.lastActivityAt).toBeGreaterThanOrEqual(t1);
      expect(() => touchSessionActivity("nope")).toThrow();
    });
    it("getSessionV2 unknown returns null", () => {
      expect(getSessionV2("nope")).toBeNull();
    });
  });

  describe("registerArtifactV2", () => {
    it("defaults + full flow", () => {
      registerSessionV2(null, { sessionId: "s1", ownerId: "o1" });
      const r = registerArtifactV2(null, {
        artifactId: "a1",
        sessionId: "s1",
        modality: "text",
      });
      expect(r.status).toBe("pending");
    });
    it("missing fields + invalid modality throw", () => {
      expect(() =>
        registerArtifactV2(null, { sessionId: "s1", modality: "text" }),
      ).toThrow("artifactId");
      expect(() =>
        registerArtifactV2(null, { artifactId: "a1", modality: "text" }),
      ).toThrow("sessionId");
      expect(() =>
        registerArtifactV2(null, { artifactId: "a1", sessionId: "s1" }),
      ).toThrow("modality");
      expect(() =>
        registerArtifactV2(null, {
          artifactId: "a1",
          sessionId: "s1",
          modality: "bogus",
        }),
      ).toThrow("Invalid modality");
    });
    it("duplicate + terminal initial throw", () => {
      registerArtifactV2(null, {
        artifactId: "a1",
        sessionId: "s1",
        modality: "text",
      });
      expect(() =>
        registerArtifactV2(null, {
          artifactId: "a1",
          sessionId: "s1",
          modality: "text",
        }),
      ).toThrow("already exists");
      expect(() =>
        registerArtifactV2(null, {
          artifactId: "a2",
          sessionId: "s1",
          modality: "text",
          initialStatus: "purged",
        }),
      ).toThrow("terminal");
    });
    it("per-session cap", () => {
      setMaxArtifactsPerSessionV2(2);
      registerArtifactV2(null, {
        artifactId: "a1",
        sessionId: "s1",
        modality: "text",
      });
      registerArtifactV2(null, {
        artifactId: "a2",
        sessionId: "s1",
        modality: "text",
      });
      expect(() =>
        registerArtifactV2(null, {
          artifactId: "a3",
          sessionId: "s1",
          modality: "text",
        }),
      ).toThrow("artifact cap");
      // other session unaffected
      expect(
        registerArtifactV2(null, {
          artifactId: "a4",
          sessionId: "s2",
          modality: "text",
        }),
      ).toBeDefined();
    });
    it("purged artifacts excluded from cap", () => {
      setMaxArtifactsPerSessionV2(2);
      registerArtifactV2(null, {
        artifactId: "a1",
        sessionId: "s1",
        modality: "text",
      });
      registerArtifactV2(null, {
        artifactId: "a2",
        sessionId: "s1",
        modality: "text",
      });
      purgeArtifact(null, "a1");
      expect(
        registerArtifactV2(null, {
          artifactId: "a3",
          sessionId: "s1",
          modality: "text",
        }),
      ).toBeDefined();
    });
  });

  describe("setArtifactStatusV2", () => {
    it("pending -> ready -> purged", () => {
      registerArtifactV2(null, {
        artifactId: "a1",
        sessionId: "s1",
        modality: "text",
      });
      expect(markArtifactReady(null, "a1").status).toBe("ready");
      expect(purgeArtifact(null, "a1").status).toBe("purged");
    });
    it("pending -> purged (direct)", () => {
      registerArtifactV2(null, {
        artifactId: "a1",
        sessionId: "s1",
        modality: "text",
      });
      expect(purgeArtifact(null, "a1").status).toBe("purged");
    });
    it("terminal + unknown + invalid throw", () => {
      registerArtifactV2(null, {
        artifactId: "a1",
        sessionId: "s1",
        modality: "text",
      });
      purgeArtifact(null, "a1");
      expect(() => purgeArtifact(null, "a1")).toThrow("Invalid transition");
      expect(() => markArtifactReady(null, "nope")).toThrow("Unknown");
      registerArtifactV2(null, {
        artifactId: "a2",
        sessionId: "s1",
        modality: "text",
      });
      expect(() => setArtifactStatusV2(null, "a2", "bogus")).toThrow(
        "Invalid status",
      );
    });
    it("touchArtifactAccess + getArtifactV2 null", () => {
      registerArtifactV2(null, {
        artifactId: "a1",
        sessionId: "s1",
        modality: "text",
      });
      const r = touchArtifactAccess("a1");
      expect(r.lastAccessAt).toBeGreaterThan(0);
      expect(() => touchArtifactAccess("nope")).toThrow();
      expect(getArtifactV2("nope")).toBeNull();
    });
  });

  describe("counts", () => {
    it("getActiveSessionCount scopes by owner", () => {
      registerSessionV2(null, {
        sessionId: "s1",
        ownerId: "o1",
        initialStatus: "active",
      });
      registerSessionV2(null, {
        sessionId: "s2",
        ownerId: "o1",
        initialStatus: "active",
      });
      registerSessionV2(null, {
        sessionId: "s3",
        ownerId: "o2",
        initialStatus: "active",
      });
      registerSessionV2(null, {
        sessionId: "s4",
        ownerId: "o1",
      });
      expect(getActiveSessionCount()).toBe(3);
      expect(getActiveSessionCount("o1")).toBe(2);
      expect(getActiveSessionCount("o2")).toBe(1);
    });
    it("getArtifactCount excludes terminals + scopes by session", () => {
      registerArtifactV2(null, {
        artifactId: "a1",
        sessionId: "s1",
        modality: "text",
      });
      registerArtifactV2(null, {
        artifactId: "a2",
        sessionId: "s1",
        modality: "text",
      });
      registerArtifactV2(null, {
        artifactId: "a3",
        sessionId: "s2",
        modality: "text",
      });
      purgeArtifact(null, "a2");
      expect(getArtifactCount("s1")).toBe(1);
      expect(getArtifactCount()).toBe(2);
    });
  });

  describe("autoArchiveIdleSessions", () => {
    it("archives idle active/paused/completed", () => {
      registerSessionV2(null, {
        sessionId: "s1",
        ownerId: "o1",
        initialStatus: "active",
      });
      registerSessionV2(null, {
        sessionId: "s2",
        ownerId: "o1",
      });
      setSessionIdleMsV2(1000);
      const future = Date.now() + 86400000;
      const r = autoArchiveIdleSessions(null, future);
      expect(r.flipped).toContain("s1");
      // onboarding (s2) skipped
      expect(r.flipped).not.toContain("s2");
      expect(getSessionV2("s1").status).toBe("archived");
    });
    it("skips fresh", () => {
      registerSessionV2(null, {
        sessionId: "s1",
        ownerId: "o1",
        initialStatus: "active",
      });
      const r = autoArchiveIdleSessions(null, Date.now());
      expect(r.count).toBe(0);
    });
  });

  describe("autoPurgeStaleArtifacts", () => {
    it("purges stale READY only", () => {
      registerArtifactV2(null, {
        artifactId: "a1",
        sessionId: "s1",
        modality: "text",
      });
      markArtifactReady(null, "a1");
      registerArtifactV2(null, {
        artifactId: "a2",
        sessionId: "s1",
        modality: "text",
      });
      // pending, NOT purged
      setArtifactStaleMsV2(1000);
      const future = Date.now() + 86400000;
      const r = autoPurgeStaleArtifacts(null, future);
      expect(r.flipped).toContain("a1");
      expect(r.flipped).not.toContain("a2");
    });
  });

  describe("getMultimodalStatsV2", () => {
    it("zero-init all enum keys", () => {
      const s = getMultimodalStatsV2();
      expect(Object.keys(s.sessionsByStatus).sort()).toEqual([
        "active",
        "archived",
        "completed",
        "onboarding",
        "paused",
      ]);
      expect(Object.keys(s.artifactsByStatus).sort()).toEqual([
        "pending",
        "purged",
        "ready",
      ]);
    });
    it("aggregates across states", () => {
      registerSessionV2(null, {
        sessionId: "s1",
        ownerId: "o1",
        initialStatus: "active",
      });
      registerSessionV2(null, { sessionId: "s2", ownerId: "o1" });
      registerArtifactV2(null, {
        artifactId: "a1",
        sessionId: "s1",
        modality: "text",
      });
      markArtifactReady(null, "a1");
      const s = getMultimodalStatsV2();
      expect(s.totalSessionsV2).toBe(2);
      expect(s.sessionsByStatus.active).toBe(1);
      expect(s.sessionsByStatus.onboarding).toBe(1);
      expect(s.totalArtifactsV2).toBe(1);
      expect(s.artifactsByStatus.ready).toBe(1);
    });
  });
});
