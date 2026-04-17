import { describe, it, expect, beforeEach } from "vitest";
import { MockDatabase } from "../helpers/mock-db.js";

import {
  MODALITY,
  VOICE_STATUS,
  ANALYSIS_TYPE,
  ensurePerceptionTables,
  recordPerception,
  getPerception,
  listPerceptions,
  startVoice,
  updateVoiceStatus,
  setTranscript,
  getVoiceSession,
  listVoiceSessions,
  addIndexEntry,
  getIndexEntry,
  listIndexEntries,
  removeIndexEntry,
  crossModalQuery,
  getPerceptionContext,
  getPerceptionStats,
  _resetState,
} from "../../src/lib/perception.js";

describe("perception", () => {
  let db;

  beforeEach(() => {
    _resetState();
    db = new MockDatabase();
    ensurePerceptionTables(db);
  });

  /* ── Schema ──────────────────────────────────────── */

  describe("ensurePerceptionTables", () => {
    it("creates all three tables", () => {
      expect(db.tables.has("perception_results")).toBe(true);
      expect(db.tables.has("voice_sessions")).toBe(true);
      expect(db.tables.has("multimodal_index")).toBe(true);
    });

    it("is idempotent", () => {
      ensurePerceptionTables(db);
      expect(db.tables.has("perception_results")).toBe(true);
    });
  });

  /* ── Catalogs ────────────────────────────────────── */

  describe("catalogs", () => {
    it("has 4 modalities", () => {
      expect(Object.keys(MODALITY)).toHaveLength(4);
    });

    it("has 4 voice statuses", () => {
      expect(Object.keys(VOICE_STATUS)).toHaveLength(4);
    });

    it("has 4 analysis types", () => {
      expect(Object.keys(ANALYSIS_TYPE)).toHaveLength(4);
    });
  });

  /* ── Perception Results ──────────────────────────── */

  describe("recordPerception", () => {
    it("records a screen perception", () => {
      const r = recordPerception(db, {
        modality: "screen",
        analysisType: "ocr",
        inputSource: "screenshot.png",
        resultData: '{"text":"Hello world"}',
        confidence: 0.95,
      });
      expect(r.recorded).toBe(true);
      expect(r.resultId).toBeTruthy();
    });

    it("records a document perception", () => {
      const r = recordPerception(db, {
        modality: "document",
        inputSource: "/docs/report.pdf",
        confidence: 0.8,
      });
      expect(r.recorded).toBe(true);
    });

    it("clamps confidence to 0-1", () => {
      recordPerception(db, { modality: "screen", confidence: 1.5 });
      const results = listPerceptions(db);
      expect(results[0].confidence).toBeLessThanOrEqual(1);
    });

    it("rejects invalid modality", () => {
      const r = recordPerception(db, { modality: "smell" });
      expect(r.recorded).toBe(false);
      expect(r.reason).toBe("invalid_modality");
    });

    it("rejects missing modality", () => {
      const r = recordPerception(db, {});
      expect(r.recorded).toBe(false);
    });
  });

  describe("getPerception / listPerceptions", () => {
    it("retrieves by id", () => {
      const { resultId } = recordPerception(db, {
        modality: "screen",
        confidence: 0.9,
      });
      const r = getPerception(db, resultId);
      expect(r.modality).toBe("screen");
      expect(r.confidence).toBe(0.9);
    });

    it("returns null for unknown id", () => {
      expect(getPerception(db, "nope")).toBeNull();
    });

    it("lists all results", () => {
      recordPerception(db, { modality: "screen" });
      recordPerception(db, { modality: "voice" });
      recordPerception(db, { modality: "document" });
      expect(listPerceptions(db)).toHaveLength(3);
    });

    it("filters by modality", () => {
      recordPerception(db, { modality: "screen" });
      recordPerception(db, { modality: "voice" });
      expect(listPerceptions(db, { modality: "screen" })).toHaveLength(1);
    });

    it("filters by analysis type", () => {
      recordPerception(db, { modality: "screen", analysisType: "ocr" });
      recordPerception(db, {
        modality: "screen",
        analysisType: "object_detection",
      });
      expect(listPerceptions(db, { analysisType: "ocr" })).toHaveLength(1);
    });
  });

  /* ── Voice Sessions ──────────────────────────────── */

  describe("startVoice", () => {
    it("starts a voice session", () => {
      const r = startVoice(db, { language: "en-US", model: "whisper" });
      expect(r.sessionId).toBeTruthy();
      expect(r.status).toBe("listening");
    });

    it("defaults to zh-CN language", () => {
      const { sessionId } = startVoice(db);
      expect(getVoiceSession(db, sessionId).language).toBe("zh-CN");
    });
  });

  describe("updateVoiceStatus", () => {
    let sessionId;
    beforeEach(() => {
      sessionId = startVoice(db).sessionId;
    });

    it("transitions listening → processing", () => {
      const r = updateVoiceStatus(db, sessionId, "processing");
      expect(r.updated).toBe(true);
      expect(r.status).toBe("processing");
    });

    it("transitions processing → speaking", () => {
      updateVoiceStatus(db, sessionId, "processing");
      const r = updateVoiceStatus(db, sessionId, "speaking");
      expect(r.updated).toBe(true);
      expect(r.status).toBe("speaking");
    });

    it("transitions to idle and sets duration", () => {
      updateVoiceStatus(db, sessionId, "processing");
      const r = updateVoiceStatus(db, sessionId, "idle");
      expect(r.updated).toBe(true);
      const s = getVoiceSession(db, sessionId);
      expect(s.status).toBe("idle");
      expect(s.duration_ms).toBeGreaterThanOrEqual(0);
      expect(s.ended_at).toBeTruthy();
    });

    it("rejects invalid transition", () => {
      const r = updateVoiceStatus(db, sessionId, "speaking"); // listening → speaking not allowed
      expect(r.updated).toBe(false);
      expect(r.reason).toBe("invalid_transition");
    });

    it("rejects unknown session", () => {
      expect(updateVoiceStatus(db, "nope", "idle").reason).toBe("not_found");
    });
  });

  describe("setTranscript", () => {
    it("sets transcript on a session", () => {
      const { sessionId } = startVoice(db);
      const r = setTranscript(db, sessionId, "Hello world");
      expect(r.updated).toBe(true);
      expect(getVoiceSession(db, sessionId).transcript).toBe("Hello world");
    });

    it("rejects empty transcript", () => {
      const { sessionId } = startVoice(db);
      expect(setTranscript(db, sessionId, "").reason).toBe("empty_transcript");
    });

    it("rejects unknown session", () => {
      expect(setTranscript(db, "nope", "text").reason).toBe("not_found");
    });
  });

  describe("listVoiceSessions", () => {
    it("lists sessions", () => {
      startVoice(db);
      startVoice(db, { language: "en-US" });
      expect(listVoiceSessions(db)).toHaveLength(2);
    });

    it("filters by status", () => {
      const { sessionId } = startVoice(db);
      startVoice(db);
      updateVoiceStatus(db, sessionId, "processing");
      expect(listVoiceSessions(db, { status: "processing" })).toHaveLength(1);
      expect(listVoiceSessions(db, { status: "listening" })).toHaveLength(1);
    });

    it("filters by language", () => {
      startVoice(db, { language: "en-US" });
      startVoice(db, { language: "zh-CN" });
      expect(listVoiceSessions(db, { language: "en-US" })).toHaveLength(1);
    });
  });

  /* ── Multimodal Index ────────────────────────────── */

  describe("addIndexEntry", () => {
    it("adds an index entry", () => {
      const { resultId } = recordPerception(db, { modality: "screen" });
      const r = addIndexEntry(db, {
        modality: "screen",
        sourceId: resultId,
        contentSummary: "Screenshot of login page",
        tags: ["login", "ui"],
      });
      expect(r.added).toBe(true);
      expect(r.indexId).toBeTruthy();
    });

    it("rejects invalid modality", () => {
      expect(
        addIndexEntry(db, { modality: "smell", sourceId: "x" }).reason,
      ).toBe("invalid_modality");
    });

    it("rejects missing source id", () => {
      expect(addIndexEntry(db, { modality: "screen" }).reason).toBe(
        "missing_source_id",
      );
    });
  });

  describe("getIndexEntry / listIndexEntries", () => {
    it("retrieves by id", () => {
      const { indexId } = addIndexEntry(db, {
        modality: "document",
        sourceId: "src1",
        contentSummary: "Annual report",
      });
      const e = getIndexEntry(db, indexId);
      expect(e.modality).toBe("document");
      expect(e.content_summary).toBe("Annual report");
    });

    it("returns null for unknown id", () => {
      expect(getIndexEntry(db, "nope")).toBeNull();
    });

    it("lists entries", () => {
      addIndexEntry(db, { modality: "screen", sourceId: "a" });
      addIndexEntry(db, { modality: "voice", sourceId: "b" });
      expect(listIndexEntries(db)).toHaveLength(2);
    });

    it("filters by modality", () => {
      addIndexEntry(db, { modality: "screen", sourceId: "a" });
      addIndexEntry(db, { modality: "voice", sourceId: "b" });
      expect(listIndexEntries(db, { modality: "screen" })).toHaveLength(1);
    });
  });

  describe("removeIndexEntry", () => {
    it("removes an entry", () => {
      const { indexId } = addIndexEntry(db, {
        modality: "screen",
        sourceId: "a",
      });
      const r = removeIndexEntry(db, indexId);
      expect(r.removed).toBe(true);
      expect(getIndexEntry(db, indexId)).toBeNull();
    });

    it("rejects unknown id", () => {
      expect(removeIndexEntry(db, "nope").reason).toBe("not_found");
    });
  });

  /* ── Cross-Modal Query ───────────────────────────── */

  describe("crossModalQuery", () => {
    beforeEach(() => {
      addIndexEntry(db, {
        modality: "screen",
        sourceId: "s1",
        contentSummary: "Login page screenshot",
        tags: ["login", "auth"],
      });
      addIndexEntry(db, {
        modality: "document",
        sourceId: "d1",
        contentSummary: "API documentation for authentication",
        tags: ["api", "auth"],
      });
      addIndexEntry(db, {
        modality: "voice",
        sourceId: "v1",
        contentSummary: "Meeting about project timeline",
        tags: ["meeting"],
      });
      addIndexEntry(db, {
        modality: "video",
        sourceId: "v2",
        contentSummary: "Demo video of login flow",
        tags: ["demo", "login"],
      });
    });

    it("finds matching entries by keyword", () => {
      const r = crossModalQuery(db, { query: "login" });
      expect(r.total).toBeGreaterThanOrEqual(2);
      expect(r.results[0].score).toBeGreaterThan(0);
    });

    it("filters by modality", () => {
      const r = crossModalQuery(db, { query: "login", modalities: ["screen"] });
      expect(r.results.every((e) => e.modality === "screen")).toBe(true);
    });

    it("returns empty for no match", () => {
      const r = crossModalQuery(db, { query: "blockchain" });
      expect(r.total).toBe(0);
    });

    it("requires query text", () => {
      const r = crossModalQuery(db, {});
      expect(r.reason).toBe("missing_query");
    });

    it("scores exact matches higher", () => {
      const r = crossModalQuery(db, { query: "authentication" });
      // "API documentation for authentication" should score high
      expect(r.results.length).toBeGreaterThanOrEqual(1);
      const docResult = r.results.find((e) => e.modality === "document");
      expect(docResult).toBeTruthy();
    });

    it("respects limit", () => {
      const r = crossModalQuery(db, { query: "login", limit: 1 });
      expect(r.results.length).toBeLessThanOrEqual(1);
    });
  });

  /* ── Context ─────────────────────────────────────── */

  describe("getPerceptionContext", () => {
    it("returns context with active sessions", () => {
      recordPerception(db, { modality: "screen" });
      startVoice(db);
      const ctx = getPerceptionContext(db);
      expect(ctx.activeSessions).toBe(1);
      expect(ctx.totalResults).toBe(1);
    });

    it("tracks modality coverage", () => {
      recordPerception(db, { modality: "screen" });
      recordPerception(db, { modality: "screen" });
      recordPerception(db, { modality: "voice" });
      const ctx = getPerceptionContext(db);
      expect(ctx.modalityCoverage.screen).toBe(2);
      expect(ctx.modalityCoverage.voice).toBe(1);
    });
  });

  /* ── Stats ───────────────────────────────────────── */

  describe("getPerceptionStats", () => {
    it("returns zeros when empty", () => {
      const s = getPerceptionStats(db);
      expect(s.results.total).toBe(0);
      expect(s.voiceSessions.total).toBe(0);
      expect(s.index.total).toBe(0);
    });

    it("computes correct stats", () => {
      recordPerception(db, {
        modality: "screen",
        analysisType: "ocr",
        confidence: 0.9,
      });
      recordPerception(db, { modality: "document", confidence: 0.7 });
      const { sessionId } = startVoice(db);
      updateVoiceStatus(db, sessionId, "processing");
      updateVoiceStatus(db, sessionId, "idle");
      addIndexEntry(db, { modality: "screen", sourceId: "a" });
      addIndexEntry(db, { modality: "document", sourceId: "b" });

      const s = getPerceptionStats(db);
      expect(s.results.total).toBe(2);
      expect(s.results.byModality.screen).toBe(1);
      expect(s.results.byModality.document).toBe(1);
      expect(s.results.byAnalysisType.ocr).toBe(1);
      expect(s.results.avgConfidence).toBeGreaterThan(0);
      expect(s.voiceSessions.total).toBe(1);
      expect(s.voiceSessions.completed).toBe(1);
      expect(s.index.total).toBe(2);
    });
  });
});
