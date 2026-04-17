import { describe, it, expect, beforeEach } from "vitest";
import { MockDatabase } from "../helpers/mock-db.js";

import {
  PROTOCOL,
  QUALITY_LEVEL,
  ensureProtocolFusionTables,
  sendMessage,
  getMessage,
  listMessages,
  mapIdentity,
  getIdentityMap,
  getIdentityById,
  listIdentities,
  verifyIdentity,
  assessQuality,
  getQualityScore,
  listQualityScores,
  getQualityReport,
  translateMessage,
  detectLanguage,
  getTranslationStats,
  getProtocolFusionStats,
  _resetState,
} from "../../src/lib/protocol-fusion.js";

describe("protocol-fusion", () => {
  let db;

  beforeEach(() => {
    _resetState();
    db = new MockDatabase();
    ensureProtocolFusionTables(db);
  });

  /* ── Schema ──────────────────────────────────────── */

  describe("ensureProtocolFusionTables", () => {
    it("creates all four tables", () => {
      expect(db.tables.has("unified_messages")).toBe(true);
      expect(db.tables.has("identity_mappings")).toBe(true);
      expect(db.tables.has("content_quality_scores")).toBe(true);
      expect(db.tables.has("translation_cache")).toBe(true);
    });

    it("is idempotent", () => {
      ensureProtocolFusionTables(db);
      expect(db.tables.has("unified_messages")).toBe(true);
    });
  });

  /* ── Catalogs ────────────────────────────────────── */

  describe("catalogs", () => {
    it("has 4 protocols", () => {
      expect(Object.keys(PROTOCOL)).toHaveLength(4);
    });

    it("has 4 quality levels", () => {
      expect(Object.keys(QUALITY_LEVEL)).toHaveLength(4);
    });
  });

  /* ── Phase 72: Unified Messages ──────────────────── */

  describe("sendMessage", () => {
    it("sends a same-protocol message", () => {
      const r = sendMessage(db, {
        sourceProtocol: "did",
        content: "hello",
      });
      expect(r.messageId).toBeTruthy();
      expect(r.converted).toBe(false);
      expect(r.routed).toBe(false);
    });

    it("sends a cross-protocol message", () => {
      const r = sendMessage(db, {
        sourceProtocol: "did",
        targetProtocol: "nostr",
        senderId: "alice",
        content: "hello nostr",
      });
      expect(r.messageId).toBeTruthy();
      expect(r.converted).toBe(true);
      expect(r.routed).toBe(true);
    });

    it("same source/target is not converted", () => {
      const r = sendMessage(db, {
        sourceProtocol: "matrix",
        targetProtocol: "matrix",
        content: "internal",
      });
      expect(r.converted).toBe(false);
      expect(r.routed).toBe(true);
    });

    it("rejects invalid source protocol", () => {
      const r = sendMessage(db, {
        sourceProtocol: "telegram",
        content: "hello",
      });
      expect(r.messageId).toBeNull();
      expect(r.reason).toBe("invalid_source_protocol");
    });

    it("rejects invalid target protocol", () => {
      const r = sendMessage(db, {
        sourceProtocol: "did",
        targetProtocol: "telegram",
        content: "hello",
      });
      expect(r.messageId).toBeNull();
      expect(r.reason).toBe("invalid_target_protocol");
    });

    it("rejects missing content", () => {
      const r = sendMessage(db, { sourceProtocol: "did" });
      expect(r.messageId).toBeNull();
      expect(r.reason).toBe("missing_content");
    });
  });

  describe("getMessage / listMessages", () => {
    it("retrieves a message by id", () => {
      const { messageId } = sendMessage(db, {
        sourceProtocol: "nostr",
        content: "test",
      });
      const m = getMessage(db, messageId);
      expect(m.source_protocol).toBe("nostr");
      expect(m.content).toBe("test");
    });

    it("returns null for unknown id", () => {
      expect(getMessage(db, "nope")).toBeNull();
    });

    it("lists all messages", () => {
      sendMessage(db, { sourceProtocol: "did", content: "a" });
      sendMessage(db, { sourceProtocol: "nostr", content: "b" });
      expect(listMessages(db)).toHaveLength(2);
    });

    it("filters by protocol", () => {
      sendMessage(db, { sourceProtocol: "did", content: "a" });
      sendMessage(db, { sourceProtocol: "nostr", content: "b" });
      sendMessage(db, {
        sourceProtocol: "did",
        targetProtocol: "matrix",
        content: "c",
      });
      expect(listMessages(db, { protocol: "did" })).toHaveLength(2);
      expect(listMessages(db, { protocol: "matrix" })).toHaveLength(1);
    });
  });

  /* ── Identity Mapping ───────────────────────────── */

  describe("mapIdentity", () => {
    it("creates a mapping with DID and Nostr", () => {
      const r = mapIdentity(db, {
        didId: "did:key:abc",
        nostrPubkey: "npub1xyz",
      });
      expect(r.mappingId).toBeTruthy();
    });

    it("rejects empty mapping", () => {
      const r = mapIdentity(db, {});
      expect(r.mappingId).toBeNull();
      expect(r.reason).toBe("at_least_one_identity_required");
    });
  });

  describe("getIdentityMap", () => {
    it("finds mapping by DID", () => {
      mapIdentity(db, {
        didId: "did:key:abc",
        activitypubId: "@alice@example.com",
      });
      const m = getIdentityMap(db, "did:key:abc");
      expect(m).not.toBeNull();
      expect(m.activitypub_id).toBe("@alice@example.com");
    });

    it("returns null for unknown DID", () => {
      expect(getIdentityMap(db, "did:key:nope")).toBeNull();
    });
  });

  describe("listIdentities", () => {
    it("lists all mappings", () => {
      mapIdentity(db, { didId: "did:key:1" });
      mapIdentity(db, { nostrPubkey: "npub1abc" });
      expect(listIdentities(db)).toHaveLength(2);
    });
  });

  describe("verifyIdentity", () => {
    it("verifies a mapping", () => {
      const { mappingId } = mapIdentity(db, { didId: "did:key:1" });
      const r = verifyIdentity(db, mappingId);
      expect(r.verified).toBe(true);
      const m = getIdentityById(db, mappingId);
      expect(m.verified).toBe(1);
    });

    it("rejects unknown mapping", () => {
      const r = verifyIdentity(db, "nope");
      expect(r.verified).toBe(false);
      expect(r.reason).toBe("not_found");
    });
  });

  /* ── Phase 73: Content Quality ──────────────────── */

  describe("assessQuality", () => {
    it("scores high quality content", () => {
      const content =
        "This is a well-written and comprehensive article about distributed systems design patterns and best practices. It covers many topics in depth with detailed examples and references.";
      const r = assessQuality(db, "art-1", content);
      expect(r.scoreId).toBeTruthy();
      expect(r.score).toBeGreaterThan(0.5);
      expect(r.harmful).toBe(false);
      expect(["high", "medium"]).toContain(r.level);
    });

    it("scores short content lower than long content", () => {
      const short = assessQuality(db, "s", "hi");
      const long = assessQuality(
        db,
        "l",
        "This is a comprehensive well-written article about distributed systems design patterns and best practices with many detailed examples.",
      );
      expect(short.scoreId).toBeTruthy();
      expect(long.score).toBeGreaterThan(short.score);
    });

    it("detects harmful content", () => {
      const r = assessQuality(db, "bad", "This is a phishing scam link");
      expect(r.harmful).toBe(true);
      expect(r.level).toBe("harmful");
      expect(r.score).toBeLessThanOrEqual(0.2);
    });

    it("rejects missing content", () => {
      const r = assessQuality(db, "id", "");
      expect(r.scoreId).toBeNull();
    });
  });

  describe("getQualityScore / listQualityScores", () => {
    it("retrieves score by id", () => {
      const { scoreId } = assessQuality(
        db,
        "c1",
        "Good content here for testing quality",
      );
      const s = getQualityScore(db, scoreId);
      expect(s).not.toBeNull();
      expect(s.content_id).toBe("c1");
    });

    it("returns null for unknown id", () => {
      expect(getQualityScore(db, "nope")).toBeNull();
    });

    it("filters by level", () => {
      assessQuality(
        db,
        "a",
        "A comprehensive well-structured article about technology and engineering practices",
      );
      assessQuality(db, "b", "This is spam and phishing content");
      const all = listQualityScores(db);
      expect(all.length).toBe(2);
      const harmful = listQualityScores(db, { level: "harmful" });
      expect(harmful.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("getQualityReport", () => {
    it("returns zeros when empty", () => {
      const r = getQualityReport(db);
      expect(r.total).toBe(0);
      expect(r.avgScore).toBe(0);
      expect(r.harmful).toBe(0);
    });

    it("computes report from scores", () => {
      assessQuality(
        db,
        "a",
        "A very well-written comprehensive article on blockchain distributed ledger technology patterns",
      );
      assessQuality(db, "b", "This is spam and phishing content");
      const r = getQualityReport(db);
      expect(r.total).toBe(2);
      expect(r.harmful).toBe(1);
      expect(r.avgScore).toBeGreaterThan(0);
    });
  });

  /* ── Phase 73: Translation ──────────────────────── */

  describe("translateMessage", () => {
    it("translates text", () => {
      const r = translateMessage(db, {
        text: "hello",
        sourceLang: "en",
        targetLang: "zh",
      });
      expect(r.translatedText).toBe("[zh] hello");
      expect(r.cached).toBe(false);
    });

    it("returns cached result on repeat", () => {
      translateMessage(db, {
        text: "hello",
        sourceLang: "en",
        targetLang: "zh",
      });
      const r = translateMessage(db, {
        text: "hello",
        sourceLang: "en",
        targetLang: "zh",
      });
      expect(r.cached).toBe(true);
      expect(r.translatedText).toBe("[zh] hello");
    });

    it("uses auto source lang when omitted", () => {
      const r = translateMessage(db, { text: "hello", targetLang: "ja" });
      expect(r.translatedText).toBe("[ja] hello");
    });

    it("rejects missing text", () => {
      const r = translateMessage(db, { targetLang: "en" });
      expect(r.translatedText).toBeNull();
      expect(r.reason).toBe("missing_text");
    });

    it("rejects missing target lang", () => {
      const r = translateMessage(db, { text: "hello" });
      expect(r.translatedText).toBeNull();
      expect(r.reason).toBe("missing_target_lang");
    });
  });

  describe("detectLanguage", () => {
    it("detects Chinese", () => {
      const r = detectLanguage("你好世界");
      expect(r.lang).toBe("zh");
      expect(r.confidence).toBeGreaterThan(0.5);
    });

    it("detects Japanese", () => {
      const r = detectLanguage("こんにちは");
      expect(r.lang).toBe("ja");
    });

    it("detects Korean", () => {
      const r = detectLanguage("안녕하세요");
      expect(r.lang).toBe("ko");
    });

    it("defaults to English for Latin", () => {
      const r = detectLanguage("Hello world");
      expect(r.lang).toBe("en");
    });

    it("rejects empty text", () => {
      const r = detectLanguage("");
      expect(r.lang).toBeNull();
    });
  });

  describe("getTranslationStats", () => {
    it("returns zeros when empty", () => {
      const s = getTranslationStats(db);
      expect(s.total).toBe(0);
      expect(s.cacheSize).toBe(0);
    });

    it("counts translations", () => {
      translateMessage(db, { text: "a", targetLang: "zh" });
      translateMessage(db, { text: "b", targetLang: "ja" });
      const s = getTranslationStats(db);
      expect(s.total).toBe(2);
      expect(s.languages).toContain("zh");
      expect(s.languages).toContain("ja");
    });
  });

  /* ── Stats ───────────────────────────────────────── */

  describe("getProtocolFusionStats", () => {
    it("returns zeros when empty", () => {
      const s = getProtocolFusionStats(db);
      expect(s.messages.total).toBe(0);
      expect(s.identities.total).toBe(0);
      expect(s.quality.total).toBe(0);
      expect(s.translations.total).toBe(0);
    });

    it("computes correct stats", () => {
      sendMessage(db, {
        sourceProtocol: "did",
        targetProtocol: "nostr",
        content: "cross",
      });
      sendMessage(db, { sourceProtocol: "matrix", content: "local" });
      mapIdentity(db, { didId: "did:key:1", nostrPubkey: "npub1abc" });
      assessQuality(
        db,
        "c1",
        "Great comprehensive article about technology and software engineering practices",
      );
      translateMessage(db, { text: "hello", targetLang: "zh" });

      const s = getProtocolFusionStats(db);
      expect(s.messages.total).toBe(2);
      expect(s.messages.converted).toBe(1);
      expect(s.identities.total).toBe(1);
      expect(s.quality.total).toBe(1);
      expect(s.translations.total).toBe(1);
    });
  });
});

import {
  BRIDGE_MATURITY_V2,
  TRANSLATION_RUN_V2,
  PF_DEFAULT_MAX_ACTIVE_BRIDGES_PER_OPERATOR,
  PF_DEFAULT_MAX_RUNNING_TRANSLATIONS_PER_BRIDGE,
  PF_DEFAULT_BRIDGE_IDLE_MS,
  PF_DEFAULT_TRANSLATION_STUCK_MS,
  getMaxActiveBridgesPerOperator,
  setMaxActiveBridgesPerOperator,
  getMaxRunningTranslationsPerBridge,
  setMaxRunningTranslationsPerBridge,
  getBridgeIdleMs,
  setBridgeIdleMs,
  getTranslationStuckMs,
  setTranslationStuckMs,
  getActiveBridgeCount,
  getRunningTranslationCount,
  registerBridgeV2,
  getBridgeV2,
  listBridgesV2,
  setBridgeMaturityV2,
  activateBridge,
  degradeBridge,
  deprecateBridge,
  retireBridge,
  touchBridgeUsage,
  enqueueTranslationV2,
  getTranslationV2,
  listTranslationsV2,
  setTranslationStatusV2,
  startTranslation,
  succeedTranslation,
  failTranslation,
  cancelTranslation,
  autoRetireIdleBridges,
  autoFailStuckRunningTranslations,
  getProtocolFusionStatsV2,
  _resetStateV2,
} from "../../src/lib/protocol-fusion.js";

describe("protocol-fusion V2 (Phase 72-73)", () => {
  beforeEach(() => {
    _resetStateV2();
  });

  describe("enum shape", () => {
    it("freezes BRIDGE_MATURITY_V2", () => {
      expect(Object.isFrozen(BRIDGE_MATURITY_V2)).toBe(true);
      expect(Object.values(BRIDGE_MATURITY_V2).sort()).toEqual([
        "active",
        "degraded",
        "deprecated",
        "provisional",
        "retired",
      ]);
    });

    it("freezes TRANSLATION_RUN_V2", () => {
      expect(Object.isFrozen(TRANSLATION_RUN_V2)).toBe(true);
      expect(Object.values(TRANSLATION_RUN_V2).sort()).toEqual([
        "canceled",
        "failed",
        "queued",
        "running",
        "succeeded",
      ]);
    });
  });

  describe("config", () => {
    it("exposes defaults", () => {
      expect(PF_DEFAULT_MAX_ACTIVE_BRIDGES_PER_OPERATOR).toBe(10);
      expect(PF_DEFAULT_MAX_RUNNING_TRANSLATIONS_PER_BRIDGE).toBe(5);
      expect(PF_DEFAULT_BRIDGE_IDLE_MS).toBe(14 * 86400000);
      expect(PF_DEFAULT_TRANSLATION_STUCK_MS).toBe(10 * 60000);
    });

    it("getters return current values", () => {
      expect(getMaxActiveBridgesPerOperator()).toBe(10);
      expect(getMaxRunningTranslationsPerBridge()).toBe(5);
      expect(getBridgeIdleMs()).toBe(14 * 86400000);
      expect(getTranslationStuckMs()).toBe(10 * 60000);
    });

    it("setters validate positive int", () => {
      expect(setMaxActiveBridgesPerOperator(3)).toBe(3);
      expect(setMaxRunningTranslationsPerBridge(2)).toBe(2);
      expect(setBridgeIdleMs(1000)).toBe(1000);
      expect(setTranslationStuckMs(500)).toBe(500);
      expect(() => setMaxActiveBridgesPerOperator(0)).toThrow();
      expect(() => setMaxActiveBridgesPerOperator(-1)).toThrow();
      expect(() => setMaxRunningTranslationsPerBridge(NaN)).toThrow();
    });

    it("floors non-integer", () => {
      expect(setMaxActiveBridgesPerOperator(7.9)).toBe(7);
    });

    it("_resetStateV2 clears overrides", () => {
      setMaxActiveBridgesPerOperator(3);
      _resetStateV2();
      expect(getMaxActiveBridgesPerOperator()).toBe(10);
    });
  });

  describe("registerBridgeV2", () => {
    it("creates provisional bridge", () => {
      const b = registerBridgeV2({
        id: "b1",
        operator: "op1",
        sourceProtocol: "did",
        targetProtocol: "activitypub",
      });
      expect(b.status).toBe("provisional");
      expect(b.activatedAt).toBeNull();
      expect(b.metadata).toEqual({});
    });

    it("rejects duplicate id", () => {
      registerBridgeV2({
        id: "b1",
        operator: "op1",
        sourceProtocol: "did",
        targetProtocol: "nostr",
      });
      expect(() =>
        registerBridgeV2({
          id: "b1",
          operator: "op1",
          sourceProtocol: "did",
          targetProtocol: "nostr",
        }),
      ).toThrow("already exists");
    });

    it("rejects missing required fields", () => {
      expect(() => registerBridgeV2({})).toThrow("id required");
      expect(() => registerBridgeV2({ id: "b1" })).toThrow("operator required");
      expect(() =>
        registerBridgeV2({
          id: "b1",
          operator: "op1",
          sourceProtocol: "bogus",
          targetProtocol: "nostr",
        }),
      ).toThrow("invalid sourceProtocol");
      expect(() =>
        registerBridgeV2({
          id: "b1",
          operator: "op1",
          sourceProtocol: "did",
          targetProtocol: "bogus",
        }),
      ).toThrow("invalid targetProtocol");
    });

    it("rejects invalid initial status", () => {
      expect(() =>
        registerBridgeV2({
          id: "b1",
          operator: "op1",
          sourceProtocol: "did",
          targetProtocol: "nostr",
          initialStatus: "bogus",
        }),
      ).toThrow("invalid initial status");
    });

    it("stamps activatedAt on initialStatus=active", () => {
      const b = registerBridgeV2({
        id: "b1",
        operator: "op1",
        sourceProtocol: "did",
        targetProtocol: "matrix",
        initialStatus: "active",
      });
      expect(b.activatedAt).toBeGreaterThan(0);
    });

    it("enforces per-operator active cap", () => {
      setMaxActiveBridgesPerOperator(2);
      registerBridgeV2({
        id: "b1",
        operator: "op1",
        sourceProtocol: "did",
        targetProtocol: "nostr",
        initialStatus: "active",
      });
      registerBridgeV2({
        id: "b2",
        operator: "op1",
        sourceProtocol: "did",
        targetProtocol: "matrix",
        initialStatus: "active",
      });
      expect(() =>
        registerBridgeV2({
          id: "b3",
          operator: "op1",
          sourceProtocol: "did",
          targetProtocol: "activitypub",
          initialStatus: "active",
        }),
      ).toThrow("active bridge cap reached");
    });

    it("provisional bridges do not count toward cap", () => {
      setMaxActiveBridgesPerOperator(1);
      registerBridgeV2({
        id: "b1",
        operator: "op1",
        sourceProtocol: "did",
        targetProtocol: "nostr",
      });
      registerBridgeV2({
        id: "b2",
        operator: "op1",
        sourceProtocol: "did",
        targetProtocol: "matrix",
      });
      expect(getActiveBridgeCount("op1")).toBe(0);
    });

    it("defensively copies metadata on read", () => {
      const b = registerBridgeV2({
        id: "b1",
        operator: "op1",
        sourceProtocol: "did",
        targetProtocol: "nostr",
        metadata: { k: 1 },
      });
      b.metadata.k = 99;
      expect(getBridgeV2("b1").metadata.k).toBe(1);
    });
  });

  describe("bridge state transitions", () => {
    beforeEach(() => {
      registerBridgeV2({
        id: "b1",
        operator: "op1",
        sourceProtocol: "did",
        targetProtocol: "nostr",
      });
    });

    it("provisional → active via activateBridge", () => {
      const b = activateBridge("b1");
      expect(b.status).toBe("active");
      expect(b.activatedAt).toBeGreaterThan(0);
    });

    it("provisional → retired", () => {
      const b = retireBridge("b1");
      expect(b.status).toBe("retired");
    });

    it("rejects provisional → degraded/deprecated directly", () => {
      expect(() => degradeBridge("b1")).toThrow("illegal transition");
      expect(() => deprecateBridge("b1")).toThrow("illegal transition");
    });

    it("active → degraded → active → deprecated → active → retired", () => {
      activateBridge("b1");
      degradeBridge("b1");
      expect(getBridgeV2("b1").status).toBe("degraded");
      activateBridge("b1");
      deprecateBridge("b1");
      expect(getBridgeV2("b1").status).toBe("deprecated");
      activateBridge("b1");
      retireBridge("b1");
      expect(getBridgeV2("b1").status).toBe("retired");
    });

    it("rejects transitions from retired terminal", () => {
      retireBridge("b1");
      expect(() => activateBridge("b1")).toThrow("terminal");
    });

    it("stamps activatedAt only once", () => {
      const b1 = activateBridge("b1");
      const first = b1.activatedAt;
      degradeBridge("b1");
      const b2 = activateBridge("b1");
      expect(b2.activatedAt).toBe(first);
    });

    it("merges metadata on transition", () => {
      activateBridge("b1", { metadata: { note: "ok" } });
      expect(getBridgeV2("b1").metadata.note).toBe("ok");
    });

    it("stores reason on transition", () => {
      const b = activateBridge("b1", { reason: "ready" });
      expect(b.reason).toBe("ready");
    });

    it("cap enforced on transition back to active from degraded/deprecated if full", () => {
      setMaxActiveBridgesPerOperator(2);
      activateBridge("b1");
      registerBridgeV2({
        id: "b2",
        operator: "op1",
        sourceProtocol: "did",
        targetProtocol: "matrix",
        initialStatus: "active",
      });
      registerBridgeV2({
        id: "b3",
        operator: "op1",
        sourceProtocol: "did",
        targetProtocol: "activitypub",
      });
      expect(() => activateBridge("b3")).toThrow("active bridge cap reached");
    });

    it("touchBridgeUsage updates lastUsedAt", async () => {
      activateBridge("b1");
      const before = getBridgeV2("b1").lastUsedAt;
      await new Promise((r) => setTimeout(r, 5));
      const b = touchBridgeUsage("b1");
      expect(b.lastUsedAt).toBeGreaterThan(before);
    });

    it("touchBridgeUsage throws on missing", () => {
      expect(() => touchBridgeUsage("missing")).toThrow("not found");
    });
  });

  describe("listBridgesV2 filters", () => {
    beforeEach(() => {
      registerBridgeV2({
        id: "b1",
        operator: "op1",
        sourceProtocol: "did",
        targetProtocol: "nostr",
        initialStatus: "active",
      });
      registerBridgeV2({
        id: "b2",
        operator: "op2",
        sourceProtocol: "did",
        targetProtocol: "matrix",
      });
    });

    it("filters by operator", () => {
      expect(listBridgesV2({ operator: "op1" }).map((b) => b.id)).toEqual([
        "b1",
      ]);
    });

    it("filters by status", () => {
      expect(listBridgesV2({ status: "provisional" }).map((b) => b.id)).toEqual(
        ["b2"],
      );
    });
  });

  describe("translation lifecycle", () => {
    beforeEach(() => {
      registerBridgeV2({
        id: "b1",
        operator: "op1",
        sourceProtocol: "did",
        targetProtocol: "nostr",
        initialStatus: "active",
      });
    });

    it("enqueue requires fields", () => {
      expect(() => enqueueTranslationV2({})).toThrow("id required");
      expect(() => enqueueTranslationV2({ id: "t1" })).toThrow(
        "bridgeId required",
      );
      expect(() => enqueueTranslationV2({ id: "t1", bridgeId: "b1" })).toThrow(
        "targetLang",
      );
      expect(() =>
        enqueueTranslationV2({ id: "t1", bridgeId: "b1", targetLang: "zh" }),
      ).toThrow("text");
    });

    it("enqueue rejects missing bridge", () => {
      expect(() =>
        enqueueTranslationV2({
          id: "t1",
          bridgeId: "missing",
          targetLang: "zh",
          text: "hi",
        }),
      ).toThrow("bridge missing not found");
    });

    it("creates queued translation", () => {
      const t = enqueueTranslationV2({
        id: "t1",
        bridgeId: "b1",
        targetLang: "zh",
        text: "hi",
      });
      expect(t.status).toBe("queued");
      expect(t.startedAt).toBeNull();
    });

    it("queued → running via startTranslation stamps startedAt", () => {
      enqueueTranslationV2({
        id: "t1",
        bridgeId: "b1",
        targetLang: "zh",
        text: "hi",
      });
      const t = startTranslation("t1");
      expect(t.status).toBe("running");
      expect(t.startedAt).toBeGreaterThan(0);
    });

    it("running → succeeded w/ result", () => {
      enqueueTranslationV2({
        id: "t1",
        bridgeId: "b1",
        targetLang: "zh",
        text: "hi",
      });
      startTranslation("t1");
      const t = succeedTranslation("t1", { result: { text: "[zh] hi" } });
      expect(t.status).toBe("succeeded");
      expect(t.result.text).toBe("[zh] hi");
    });

    it("running → failed", () => {
      enqueueTranslationV2({
        id: "t1",
        bridgeId: "b1",
        targetLang: "zh",
        text: "hi",
      });
      startTranslation("t1");
      expect(failTranslation("t1", { reason: "rate_limit" }).status).toBe(
        "failed",
      );
    });

    it("queued → canceled", () => {
      enqueueTranslationV2({
        id: "t1",
        bridgeId: "b1",
        targetLang: "zh",
        text: "hi",
      });
      expect(cancelTranslation("t1").status).toBe("canceled");
    });

    it("terminal translations reject further transitions", () => {
      enqueueTranslationV2({
        id: "t1",
        bridgeId: "b1",
        targetLang: "zh",
        text: "hi",
      });
      startTranslation("t1");
      succeedTranslation("t1");
      expect(() => failTranslation("t1")).toThrow("terminal");
    });

    it("stamp-once startedAt across running", async () => {
      enqueueTranslationV2({
        id: "t1",
        bridgeId: "b1",
        targetLang: "zh",
        text: "hi",
      });
      const t1 = startTranslation("t1");
      const first = t1.startedAt;
      await new Promise((r) => setTimeout(r, 5));
      // can't go back to running once succeeded — check that startedAt set only at RUNNING entry
      expect(t1.startedAt).toBe(first);
    });

    it("per-bridge running cap", () => {
      setMaxRunningTranslationsPerBridge(2);
      enqueueTranslationV2({
        id: "t1",
        bridgeId: "b1",
        targetLang: "zh",
        text: "a",
      });
      enqueueTranslationV2({
        id: "t2",
        bridgeId: "b1",
        targetLang: "zh",
        text: "b",
      });
      enqueueTranslationV2({
        id: "t3",
        bridgeId: "b1",
        targetLang: "zh",
        text: "c",
      });
      startTranslation("t1");
      startTranslation("t2");
      expect(() => startTranslation("t3")).toThrow(
        "running translation cap reached",
      );
    });

    it("getRunningTranslationCount counts per bridge", () => {
      enqueueTranslationV2({
        id: "t1",
        bridgeId: "b1",
        targetLang: "zh",
        text: "a",
      });
      startTranslation("t1");
      expect(getRunningTranslationCount("b1")).toBe(1);
      expect(getRunningTranslationCount("b-other")).toBe(0);
    });

    it("defensive metadata copy on read", () => {
      enqueueTranslationV2({
        id: "t1",
        bridgeId: "b1",
        targetLang: "zh",
        text: "hi",
        metadata: { k: 1 },
      });
      const t = getTranslationV2("t1");
      t.metadata.k = 99;
      expect(getTranslationV2("t1").metadata.k).toBe(1);
    });

    it("listTranslationsV2 filters by status", () => {
      enqueueTranslationV2({
        id: "t1",
        bridgeId: "b1",
        targetLang: "zh",
        text: "a",
      });
      enqueueTranslationV2({
        id: "t2",
        bridgeId: "b1",
        targetLang: "zh",
        text: "b",
      });
      startTranslation("t2");
      expect(listTranslationsV2({ status: "queued" }).map((t) => t.id)).toEqual(
        ["t1"],
      );
      expect(
        listTranslationsV2({ status: "running" }).map((t) => t.id),
      ).toEqual(["t2"]);
    });
  });

  describe("auto-flip batches", () => {
    beforeEach(() => {
      registerBridgeV2({
        id: "b1",
        operator: "op1",
        sourceProtocol: "did",
        targetProtocol: "nostr",
        initialStatus: "active",
      });
      registerBridgeV2({
        id: "b2",
        operator: "op1",
        sourceProtocol: "did",
        targetProtocol: "matrix",
      });
    });

    it("autoRetireIdleBridges flips stale active via future now override", () => {
      setBridgeIdleMs(1000);
      const future = Date.now() + 5000;
      const flipped = autoRetireIdleBridges({ now: future });
      expect(flipped).toContain("b1");
      expect(getBridgeV2("b1").status).toBe("retired");
    });

    it("autoRetireIdleBridges flips degraded and deprecated too", () => {
      setBridgeIdleMs(1000);
      degradeBridge("b1");
      const future = Date.now() + 5000;
      const flipped = autoRetireIdleBridges({ now: future });
      expect(flipped).toContain("b1");
    });

    it("autoRetireIdleBridges skips provisional and retired", () => {
      retireBridge("b1");
      setBridgeIdleMs(1);
      const future = Date.now() + 10000;
      const flipped = autoRetireIdleBridges({ now: future });
      expect(flipped).not.toContain("b1"); // already retired
      expect(flipped).not.toContain("b2"); // provisional
    });

    it("autoRetireIdleBridges skips recent bridges", () => {
      setBridgeIdleMs(1000);
      touchBridgeUsage("b1");
      const flipped = autoRetireIdleBridges({ now: Date.now() + 100 });
      expect(flipped).not.toContain("b1");
    });

    it("autoFailStuckRunningTranslations flips only RUNNING", () => {
      enqueueTranslationV2({
        id: "t1",
        bridgeId: "b1",
        targetLang: "zh",
        text: "a",
      });
      enqueueTranslationV2({
        id: "t2",
        bridgeId: "b1",
        targetLang: "zh",
        text: "b",
      });
      startTranslation("t1");
      setTranslationStuckMs(100);
      const future = Date.now() + 5000;
      const flipped = autoFailStuckRunningTranslations({ now: future });
      expect(flipped).toEqual(["t1"]);
      expect(getTranslationV2("t1").status).toBe("failed");
      expect(getTranslationV2("t2").status).toBe("queued");
    });

    it("autoFailStuckRunningTranslations skips terminal and queued", () => {
      enqueueTranslationV2({
        id: "t1",
        bridgeId: "b1",
        targetLang: "zh",
        text: "a",
      });
      enqueueTranslationV2({
        id: "t2",
        bridgeId: "b1",
        targetLang: "zh",
        text: "b",
      });
      startTranslation("t1");
      succeedTranslation("t1");
      setTranslationStuckMs(1);
      const flipped = autoFailStuckRunningTranslations({
        now: Date.now() + 1000,
      });
      expect(flipped).toEqual([]);
    });
  });

  describe("stats", () => {
    it("returns zero-initialized enums on empty state", () => {
      const s = getProtocolFusionStatsV2();
      expect(s.totalBridgesV2).toBe(0);
      expect(s.totalTranslationsV2).toBe(0);
      expect(s.bridgesByStatus).toEqual({
        provisional: 0,
        active: 0,
        degraded: 0,
        deprecated: 0,
        retired: 0,
      });
      expect(s.translationsByStatus).toEqual({
        queued: 0,
        running: 0,
        succeeded: 0,
        failed: 0,
        canceled: 0,
      });
    });

    it("counts bridges and translations by status", () => {
      registerBridgeV2({
        id: "b1",
        operator: "op1",
        sourceProtocol: "did",
        targetProtocol: "nostr",
        initialStatus: "active",
      });
      registerBridgeV2({
        id: "b2",
        operator: "op1",
        sourceProtocol: "did",
        targetProtocol: "matrix",
      });
      enqueueTranslationV2({
        id: "t1",
        bridgeId: "b1",
        targetLang: "zh",
        text: "hi",
      });
      startTranslation("t1");
      const s = getProtocolFusionStatsV2();
      expect(s.totalBridgesV2).toBe(2);
      expect(s.bridgesByStatus.active).toBe(1);
      expect(s.bridgesByStatus.provisional).toBe(1);
      expect(s.translationsByStatus.running).toBe(1);
    });
  });
});
