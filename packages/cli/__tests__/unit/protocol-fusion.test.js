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
