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

  // Phase 84 V2
  SENSOR_MATURITY_V2,
  CAPTURE_LIFECYCLE_V2,
  PCP_DEFAULT_MAX_ACTIVE_SENSORS_PER_OPERATOR,
  PCP_DEFAULT_MAX_PENDING_CAPTURES_PER_SENSOR,
  PCP_DEFAULT_SENSOR_IDLE_MS,
  PCP_DEFAULT_CAPTURE_STUCK_MS,
  getDefaultMaxActiveSensorsPerOperatorV2,
  getMaxActiveSensorsPerOperatorV2,
  setMaxActiveSensorsPerOperatorV2,
  getDefaultMaxPendingCapturesPerSensorV2,
  getMaxPendingCapturesPerSensorV2,
  setMaxPendingCapturesPerSensorV2,
  getDefaultSensorIdleMsV2,
  getSensorIdleMsV2,
  setSensorIdleMsV2,
  getDefaultCaptureStuckMsV2,
  getCaptureStuckMsV2,
  setCaptureStuckMsV2,
  registerSensorV2,
  getSensorV2,
  setSensorMaturityV2,
  activateSensor,
  degradeSensor,
  offlineSensor,
  retireSensor,
  touchSensorHeartbeat,
  registerCaptureV2,
  getCaptureV2,
  setCaptureStatusV2,
  startProcessingCapture,
  markCaptureReady,
  failCapture,
  discardCapture,
  getActiveSensorCount,
  getPendingCaptureCount,
  autoOfflineStaleSensors,
  autoFailStuckProcessingCaptures,
  getPerceptionStatsV2,
  _resetStateV2,
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

/* ═════════════════════════════════════════════════════════ *
 *  Phase 84 V2 — Sensor Maturity + Capture Lifecycle
 * ═════════════════════════════════════════════════════════ */

describe("perception V2 (Phase 84)", () => {
  beforeEach(() => {
    _resetStateV2();
  });

  describe("enums", () => {
    it("SENSOR_MATURITY_V2 has 5 frozen states", () => {
      expect(Object.keys(SENSOR_MATURITY_V2)).toHaveLength(5);
      expect(Object.isFrozen(SENSOR_MATURITY_V2)).toBe(true);
      expect(SENSOR_MATURITY_V2.ONBOARDING).toBe("onboarding");
      expect(SENSOR_MATURITY_V2.ACTIVE).toBe("active");
      expect(SENSOR_MATURITY_V2.DEGRADED).toBe("degraded");
      expect(SENSOR_MATURITY_V2.OFFLINE).toBe("offline");
      expect(SENSOR_MATURITY_V2.RETIRED).toBe("retired");
    });

    it("CAPTURE_LIFECYCLE_V2 has 5 frozen states", () => {
      expect(Object.keys(CAPTURE_LIFECYCLE_V2)).toHaveLength(5);
      expect(Object.isFrozen(CAPTURE_LIFECYCLE_V2)).toBe(true);
      expect(CAPTURE_LIFECYCLE_V2.PENDING).toBe("pending");
      expect(CAPTURE_LIFECYCLE_V2.PROCESSING).toBe("processing");
      expect(CAPTURE_LIFECYCLE_V2.READY).toBe("ready");
      expect(CAPTURE_LIFECYCLE_V2.FAILED).toBe("failed");
      expect(CAPTURE_LIFECYCLE_V2.DISCARDED).toBe("discarded");
    });
  });

  describe("config defaults + setters", () => {
    it("exposes defaults", () => {
      expect(getDefaultMaxActiveSensorsPerOperatorV2()).toBe(
        PCP_DEFAULT_MAX_ACTIVE_SENSORS_PER_OPERATOR,
      );
      expect(getDefaultMaxPendingCapturesPerSensorV2()).toBe(
        PCP_DEFAULT_MAX_PENDING_CAPTURES_PER_SENSOR,
      );
      expect(getDefaultSensorIdleMsV2()).toBe(PCP_DEFAULT_SENSOR_IDLE_MS);
      expect(getDefaultCaptureStuckMsV2()).toBe(PCP_DEFAULT_CAPTURE_STUCK_MS);
    });

    it("getters return current", () => {
      expect(getMaxActiveSensorsPerOperatorV2()).toBe(
        PCP_DEFAULT_MAX_ACTIVE_SENSORS_PER_OPERATOR,
      );
      expect(getMaxPendingCapturesPerSensorV2()).toBe(
        PCP_DEFAULT_MAX_PENDING_CAPTURES_PER_SENSOR,
      );
      expect(getSensorIdleMsV2()).toBe(PCP_DEFAULT_SENSOR_IDLE_MS);
      expect(getCaptureStuckMsV2()).toBe(PCP_DEFAULT_CAPTURE_STUCK_MS);
    });

    it("setters validate positive ints", () => {
      expect(setMaxActiveSensorsPerOperatorV2(10)).toBe(10);
      expect(setMaxPendingCapturesPerSensorV2(100)).toBe(100);
      expect(setSensorIdleMsV2(60000)).toBe(60000);
      expect(setCaptureStuckMsV2(30000)).toBe(30000);

      expect(() => setMaxActiveSensorsPerOperatorV2(0)).toThrow(/positive/);
      expect(() => setMaxPendingCapturesPerSensorV2(-1)).toThrow(/positive/);
      expect(() => setSensorIdleMsV2("abc")).toThrow(/positive/);
      expect(() => setCaptureStuckMsV2(Number.NaN)).toThrow(/positive/);
    });

    it("floors non-integer positives", () => {
      expect(setMaxActiveSensorsPerOperatorV2(3.7)).toBe(3);
    });
  });

  describe("registerSensorV2", () => {
    it("registers with onboarding default + timestamps", () => {
      const r = registerSensorV2(null, {
        sensorId: "s1",
        operatorId: "op1",
        modality: MODALITY.SCREEN,
      });
      expect(r.sensorId).toBe("s1");
      expect(r.status).toBe("onboarding");
      expect(r.createdAt).toBeGreaterThan(0);
      expect(r.lastHeartbeatAt).toBeGreaterThan(0);
    });

    it("validates required fields", () => {
      expect(() => registerSensorV2(null, {})).toThrow(/sensorId/);
      expect(() => registerSensorV2(null, { sensorId: "s" })).toThrow(
        /operatorId/,
      );
      expect(() =>
        registerSensorV2(null, { sensorId: "s", operatorId: "o" }),
      ).toThrow(/modality/);
    });

    it("rejects invalid modality", () => {
      expect(() =>
        registerSensorV2(null, {
          sensorId: "s",
          operatorId: "o",
          modality: "telepathy",
        }),
      ).toThrow(/Invalid modality/);
    });

    it("rejects duplicate sensorId", () => {
      registerSensorV2(null, {
        sensorId: "s1",
        operatorId: "op1",
        modality: MODALITY.SCREEN,
      });
      expect(() =>
        registerSensorV2(null, {
          sensorId: "s1",
          operatorId: "op2",
          modality: MODALITY.SCREEN,
        }),
      ).toThrow(/already exists/);
    });

    it("rejects invalid initial status", () => {
      expect(() =>
        registerSensorV2(null, {
          sensorId: "s1",
          operatorId: "op1",
          modality: MODALITY.SCREEN,
          initialStatus: "galaxy",
        }),
      ).toThrow(/Invalid initial status/);
    });

    it("rejects terminal initial status", () => {
      expect(() =>
        registerSensorV2(null, {
          sensorId: "s1",
          operatorId: "op1",
          modality: MODALITY.SCREEN,
          initialStatus: "retired",
        }),
      ).toThrow(/terminal/);
    });

    it("enforces per-operator active cap on register (active initial)", () => {
      setMaxActiveSensorsPerOperatorV2(2);
      registerSensorV2(null, {
        sensorId: "s1",
        operatorId: "op1",
        modality: MODALITY.SCREEN,
        initialStatus: "active",
      });
      registerSensorV2(null, {
        sensorId: "s2",
        operatorId: "op1",
        modality: MODALITY.SCREEN,
        initialStatus: "active",
      });
      expect(() =>
        registerSensorV2(null, {
          sensorId: "s3",
          operatorId: "op1",
          modality: MODALITY.SCREEN,
          initialStatus: "active",
        }),
      ).toThrow(/cap/);
    });
  });

  describe("getSensorV2", () => {
    it("returns null for unknown", () => {
      expect(getSensorV2("nope")).toBeNull();
    });

    it("returns defensive copy", () => {
      registerSensorV2(null, {
        sensorId: "s1",
        operatorId: "op1",
        modality: MODALITY.VOICE,
        metadata: { v: 1 },
      });
      const r = getSensorV2("s1");
      r.metadata.v = 999;
      expect(getSensorV2("s1").metadata.v).toBe(1);
    });
  });

  describe("setSensorMaturityV2 + shortcuts", () => {
    beforeEach(() => {
      registerSensorV2(null, {
        sensorId: "s1",
        operatorId: "op1",
        modality: MODALITY.SCREEN,
      });
    });

    it("onboarding → active", () => {
      const r = activateSensor(null, "s1", "ready");
      expect(r.status).toBe("active");
      expect(r.lastReason).toBe("ready");
    });

    it("active → degraded → active", () => {
      activateSensor(null, "s1");
      const d = degradeSensor(null, "s1", "noisy");
      expect(d.status).toBe("degraded");
      const a = activateSensor(null, "s1", "recovered");
      expect(a.status).toBe("active");
    });

    it("active → offline → active", () => {
      activateSensor(null, "s1");
      offlineSensor(null, "s1");
      expect(getSensorV2("s1").status).toBe("offline");
      activateSensor(null, "s1");
      expect(getSensorV2("s1").status).toBe("active");
    });

    it("any → retired (terminal)", () => {
      retireSensor(null, "s1");
      expect(getSensorV2("s1").status).toBe("retired");
      expect(() => activateSensor(null, "s1")).toThrow(/Invalid transition/);
    });

    it("rejects unknown sensor", () => {
      expect(() => activateSensor(null, "nope")).toThrow(/Unknown sensor/);
    });

    it("rejects invalid target status", () => {
      expect(() => setSensorMaturityV2(null, "s1", "galaxy")).toThrow(
        /Invalid status/,
      );
    });

    it("rejects invalid transition", () => {
      expect(() => degradeSensor(null, "s1")).toThrow(/Invalid transition/);
    });

    it("enforces active cap on re-activate transition", () => {
      setMaxActiveSensorsPerOperatorV2(1);
      activateSensor(null, "s1");
      registerSensorV2(null, {
        sensorId: "s2",
        operatorId: "op1",
        modality: MODALITY.SCREEN,
      });
      expect(() => activateSensor(null, "s2")).toThrow(/cap/);
    });

    it("merges metadata patch", () => {
      activateSensor(null, "s1");
      const r = setSensorMaturityV2(null, "s1", "degraded", {
        metadata: { lane: "x" },
      });
      expect(r.metadata.lane).toBe("x");
    });
  });

  describe("touchSensorHeartbeat", () => {
    it("updates lastHeartbeatAt", async () => {
      registerSensorV2(null, {
        sensorId: "s1",
        operatorId: "op1",
        modality: MODALITY.SCREEN,
      });
      const before = getSensorV2("s1").lastHeartbeatAt;
      await new Promise((r) => setTimeout(r, 2));
      const r = touchSensorHeartbeat("s1");
      expect(r.lastHeartbeatAt).toBeGreaterThanOrEqual(before);
    });

    it("throws on unknown", () => {
      expect(() => touchSensorHeartbeat("nope")).toThrow(/Unknown sensor/);
    });
  });

  describe("registerCaptureV2 + lifecycle", () => {
    beforeEach(() => {
      registerSensorV2(null, {
        sensorId: "s1",
        operatorId: "op1",
        modality: MODALITY.SCREEN,
      });
    });

    it("registers pending by default", () => {
      const c = registerCaptureV2(null, { captureId: "c1", sensorId: "s1" });
      expect(c.status).toBe("pending");
    });

    it("validates required fields", () => {
      expect(() => registerCaptureV2(null, {})).toThrow(/captureId/);
      expect(() => registerCaptureV2(null, { captureId: "c" })).toThrow(
        /sensorId/,
      );
    });

    it("rejects unknown sensor", () => {
      expect(() =>
        registerCaptureV2(null, { captureId: "c1", sensorId: "nope" }),
      ).toThrow(/Unknown sensor/);
    });

    it("rejects duplicate captureId", () => {
      registerCaptureV2(null, { captureId: "c1", sensorId: "s1" });
      expect(() =>
        registerCaptureV2(null, { captureId: "c1", sensorId: "s1" }),
      ).toThrow(/already exists/);
    });

    it("rejects terminal initial status", () => {
      expect(() =>
        registerCaptureV2(null, {
          captureId: "c1",
          sensorId: "s1",
          initialStatus: "ready",
        }),
      ).toThrow(/terminal/);
    });

    it("enforces per-sensor pending cap", () => {
      setMaxPendingCapturesPerSensorV2(2);
      registerCaptureV2(null, { captureId: "c1", sensorId: "s1" });
      registerCaptureV2(null, { captureId: "c2", sensorId: "s1" });
      expect(() =>
        registerCaptureV2(null, { captureId: "c3", sensorId: "s1" }),
      ).toThrow(/cap/);
    });

    it("pending → processing → ready", () => {
      registerCaptureV2(null, { captureId: "c1", sensorId: "s1" });
      const p = startProcessingCapture(null, "c1");
      expect(p.status).toBe("processing");
      expect(p.processingStartedAt).toBeGreaterThan(0);
      const r = markCaptureReady(null, "c1");
      expect(r.status).toBe("ready");
    });

    it("stamps processingStartedAt only once", () => {
      registerCaptureV2(null, { captureId: "c1", sensorId: "s1" });
      const p1 = startProcessingCapture(null, "c1");
      failCapture(null, "c1");
      setCaptureStatusV2(null, "c1", "pending");
      const p2 = startProcessingCapture(null, "c1");
      expect(p2.processingStartedAt).toBe(p1.processingStartedAt);
    });

    it("failed → pending (retry) → processing", () => {
      registerCaptureV2(null, { captureId: "c1", sensorId: "s1" });
      startProcessingCapture(null, "c1");
      failCapture(null, "c1");
      setCaptureStatusV2(null, "c1", "pending");
      startProcessingCapture(null, "c1");
      expect(getCaptureV2("c1").status).toBe("processing");
    });

    it("ready + discarded are terminal", () => {
      registerCaptureV2(null, { captureId: "c1", sensorId: "s1" });
      startProcessingCapture(null, "c1");
      markCaptureReady(null, "c1");
      expect(() => failCapture(null, "c1")).toThrow(/Invalid transition/);

      registerCaptureV2(null, { captureId: "c2", sensorId: "s1" });
      discardCapture(null, "c2");
      expect(() => startProcessingCapture(null, "c2")).toThrow(
        /Invalid transition/,
      );
    });

    it("rejects unknown capture", () => {
      expect(() => startProcessingCapture(null, "nope")).toThrow(
        /Unknown capture/,
      );
    });

    it("rejects invalid status", () => {
      registerCaptureV2(null, { captureId: "c1", sensorId: "s1" });
      expect(() => setCaptureStatusV2(null, "c1", "galaxy")).toThrow(
        /Invalid status/,
      );
    });

    it("merges metadata patch", () => {
      registerCaptureV2(null, { captureId: "c1", sensorId: "s1" });
      const r = setCaptureStatusV2(null, "c1", "processing", {
        metadata: { lane: "fast" },
      });
      expect(r.metadata.lane).toBe("fast");
    });
  });

  describe("counts", () => {
    beforeEach(() => {
      registerSensorV2(null, {
        sensorId: "s1",
        operatorId: "op1",
        modality: MODALITY.SCREEN,
      });
      registerSensorV2(null, {
        sensorId: "s2",
        operatorId: "op1",
        modality: MODALITY.SCREEN,
      });
      registerSensorV2(null, {
        sensorId: "s3",
        operatorId: "op2",
        modality: MODALITY.SCREEN,
      });
      activateSensor(null, "s1");
      activateSensor(null, "s3");
    });

    it("getActiveSensorCount counts only ACTIVE", () => {
      expect(getActiveSensorCount()).toBe(2);
      expect(getActiveSensorCount("op1")).toBe(1);
      expect(getActiveSensorCount("op2")).toBe(1);
      expect(getActiveSensorCount("opX")).toBe(0);
    });

    it("getPendingCaptureCount counts only PENDING", () => {
      registerCaptureV2(null, { captureId: "c1", sensorId: "s1" });
      registerCaptureV2(null, { captureId: "c2", sensorId: "s1" });
      registerCaptureV2(null, { captureId: "c3", sensorId: "s2" });
      startProcessingCapture(null, "c2");
      expect(getPendingCaptureCount()).toBe(2);
      expect(getPendingCaptureCount("s1")).toBe(1);
      expect(getPendingCaptureCount("s2")).toBe(1);
    });
  });

  describe("autoOfflineStaleSensors", () => {
    it("flips active + degraded → offline when heartbeat timeout", () => {
      registerSensorV2(null, {
        sensorId: "s1",
        operatorId: "op1",
        modality: MODALITY.SCREEN,
      });
      registerSensorV2(null, {
        sensorId: "s2",
        operatorId: "op1",
        modality: MODALITY.SCREEN,
      });
      registerSensorV2(null, {
        sensorId: "s3",
        operatorId: "op1",
        modality: MODALITY.SCREEN,
      });
      activateSensor(null, "s1");
      activateSensor(null, "s2");
      degradeSensor(null, "s2");
      // s3 left as onboarding (not flipped)
      const now = Date.now() + PCP_DEFAULT_SENSOR_IDLE_MS + 1;
      const r = autoOfflineStaleSensors(null, now);
      expect(r.count).toBe(2);
      expect(r.flipped.sort()).toEqual(["s1", "s2"]);
      expect(getSensorV2("s1").status).toBe("offline");
      expect(getSensorV2("s2").status).toBe("offline");
      expect(getSensorV2("s3").status).toBe("onboarding");
    });

    it("skips when within idle window", () => {
      registerSensorV2(null, {
        sensorId: "s1",
        operatorId: "op1",
        modality: MODALITY.SCREEN,
      });
      activateSensor(null, "s1");
      const r = autoOfflineStaleSensors(null);
      expect(r.count).toBe(0);
    });

    it("skips retired + onboarding + already offline", () => {
      registerSensorV2(null, {
        sensorId: "s1",
        operatorId: "op1",
        modality: MODALITY.SCREEN,
      });
      activateSensor(null, "s1");
      offlineSensor(null, "s1");
      const now = Date.now() + PCP_DEFAULT_SENSOR_IDLE_MS + 1;
      const r = autoOfflineStaleSensors(null, now);
      expect(r.count).toBe(0);
    });
  });

  describe("autoFailStuckProcessingCaptures", () => {
    beforeEach(() => {
      registerSensorV2(null, {
        sensorId: "s1",
        operatorId: "op1",
        modality: MODALITY.SCREEN,
      });
    });

    it("flips only PROCESSING → FAILED when stuck", () => {
      registerCaptureV2(null, { captureId: "c1", sensorId: "s1" });
      registerCaptureV2(null, { captureId: "c2", sensorId: "s1" });
      registerCaptureV2(null, { captureId: "c3", sensorId: "s1" });
      startProcessingCapture(null, "c1");
      startProcessingCapture(null, "c2");
      // c3 left pending
      const now = Date.now() + PCP_DEFAULT_CAPTURE_STUCK_MS + 1;
      const r = autoFailStuckProcessingCaptures(null, now);
      expect(r.count).toBe(2);
      expect(r.flipped.sort()).toEqual(["c1", "c2"]);
      expect(getCaptureV2("c1").status).toBe("failed");
      expect(getCaptureV2("c3").status).toBe("pending");
    });

    it("respects stamp-once anchor", () => {
      registerCaptureV2(null, { captureId: "c1", sensorId: "s1" });
      startProcessingCapture(null, "c1");
      const now = Date.now() + 100;
      const r = autoFailStuckProcessingCaptures(null, now);
      expect(r.count).toBe(0);
    });
  });

  describe("getPerceptionStatsV2", () => {
    it("zero-initializes all enum keys", () => {
      const s = getPerceptionStatsV2();
      expect(s.totalSensorsV2).toBe(0);
      expect(s.totalCapturesV2).toBe(0);
      for (const k of Object.values(SENSOR_MATURITY_V2))
        expect(s.sensorsByStatus[k]).toBe(0);
      for (const k of Object.values(CAPTURE_LIFECYCLE_V2))
        expect(s.capturesByStatus[k]).toBe(0);
      expect(s.maxActiveSensorsPerOperator).toBe(
        PCP_DEFAULT_MAX_ACTIVE_SENSORS_PER_OPERATOR,
      );
      expect(s.maxPendingCapturesPerSensor).toBe(
        PCP_DEFAULT_MAX_PENDING_CAPTURES_PER_SENSOR,
      );
      expect(s.sensorIdleMs).toBe(PCP_DEFAULT_SENSOR_IDLE_MS);
      expect(s.captureStuckMs).toBe(PCP_DEFAULT_CAPTURE_STUCK_MS);
    });

    it("reflects current state", () => {
      registerSensorV2(null, {
        sensorId: "s1",
        operatorId: "op1",
        modality: MODALITY.SCREEN,
      });
      registerSensorV2(null, {
        sensorId: "s2",
        operatorId: "op1",
        modality: MODALITY.VOICE,
      });
      activateSensor(null, "s1");
      registerCaptureV2(null, { captureId: "c1", sensorId: "s1" });
      startProcessingCapture(null, "c1");
      const s = getPerceptionStatsV2();
      expect(s.totalSensorsV2).toBe(2);
      expect(s.sensorsByStatus.active).toBe(1);
      expect(s.sensorsByStatus.onboarding).toBe(1);
      expect(s.totalCapturesV2).toBe(1);
      expect(s.capturesByStatus.processing).toBe(1);
    });
  });

  describe("_resetStateV2", () => {
    it("clears maps and restores config defaults", () => {
      setMaxActiveSensorsPerOperatorV2(1);
      setMaxPendingCapturesPerSensorV2(1);
      setSensorIdleMsV2(1000);
      setCaptureStuckMsV2(1000);
      registerSensorV2(null, {
        sensorId: "s1",
        operatorId: "op1",
        modality: MODALITY.SCREEN,
      });
      _resetStateV2();
      expect(getMaxActiveSensorsPerOperatorV2()).toBe(
        PCP_DEFAULT_MAX_ACTIVE_SENSORS_PER_OPERATOR,
      );
      expect(getSensorIdleMsV2()).toBe(PCP_DEFAULT_SENSOR_IDLE_MS);
      expect(getSensorV2("s1")).toBeNull();
    });
  });
});
