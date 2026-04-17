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
