/**
 * ModalityFusion 单元测试 — v3.2
 *
 * 覆盖：initialize、fuseInput（验证/文本输入/事件）、
 *       getSession、getSupportedModalities、getArtifacts、
 *       getStats、getConfig/configure、常量
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── Mock logger ─────────────────────────────────────────────────────────────
vi.mock("../../../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// ─── Imports ─────────────────────────────────────────────────────────────────
const {
  ModalityFusion,
  MODALITIES,
  SESSION_STATUS,
} = require("../modality-fusion");

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createMockDatabase() {
  const prepResult = {
    all: vi.fn().mockReturnValue([]),
    get: vi.fn().mockReturnValue(null),
    run: vi.fn(),
  };
  return {
    exec: vi.fn(),
    run: vi.fn(),
    prepare: vi.fn().mockReturnValue(prepResult),
    saveToFile: vi.fn(),
    _prep: prepResult,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("ModalityFusion", () => {
  let mf;
  let db;

  beforeEach(() => {
    mf = new ModalityFusion();
    db = createMockDatabase();
    vi.clearAllMocks();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // initialize
  // ─────────────────────────────────────────────────────────────────────────
  describe("initialize()", () => {
    it("should set initialized=true after first call", async () => {
      expect(mf.initialized).toBe(false);
      await mf.initialize(db);
      expect(mf.initialized).toBe(true);
    });

    it("should assign db on the instance", async () => {
      await mf.initialize(db);
      expect(mf.db).toBe(db);
    });

    it("should be idempotent on double initialize", async () => {
      await mf.initialize(db);
      const db2 = createMockDatabase();
      await mf.initialize(db2);
      // db should still be the first one (early-return guard)
      expect(mf.db).toBe(db);
    });

    it("should work without deps (no documentParser)", async () => {
      await expect(mf.initialize(db)).resolves.not.toThrow();
      expect(mf.documentParser).toBeNull();
    });

    it("should accept optional documentParser dep", async () => {
      const mockParser = { initialized: true, parse: vi.fn() };
      await mf.initialize(db, { documentParser: mockParser });
      expect(mf.documentParser).toBe(mockParser);
    });

    it("should NOT call db.prepare() during initialize", async () => {
      await mf.initialize(db);
      expect(db.prepare).not.toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // fuseInput — validation
  // ─────────────────────────────────────────────────────────────────────────
  describe("fuseInput() - validation", () => {
    it("should throw if not initialized", async () => {
      await expect(
        mf.fuseInput({ modalities: [{ type: "text", data: "hello" }] }),
      ).rejects.toThrow("ModalityFusion not initialized");
    });

    it("should throw if no modalities provided (empty array)", async () => {
      await mf.initialize(db);
      await expect(mf.fuseInput({ modalities: [] })).rejects.toThrow(
        "At least one modality input is required",
      );
    });

    it("should throw if modalities key is absent", async () => {
      await mf.initialize(db);
      await expect(mf.fuseInput({})).rejects.toThrow(
        "At least one modality input is required",
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // fuseInput — text modality
  // ─────────────────────────────────────────────────────────────────────────
  describe("fuseInput() - text modality", () => {
    beforeEach(async () => {
      await mf.initialize(db);
    });

    it("should return sessionId and fusedContext", async () => {
      const result = await mf.fuseInput({
        modalities: [
          { type: "text", data: "some text content", label: "user input" },
        ],
      });

      expect(result).toHaveProperty("sessionId");
      expect(result).toHaveProperty("fusedContext");
    });

    it("should return sessionId as a non-empty string", async () => {
      const result = await mf.fuseInput({
        modalities: [{ type: "text", data: "hello world" }],
      });

      expect(typeof result.sessionId).toBe("string");
      expect(result.sessionId.length).toBeGreaterThan(0);
    });

    it("should return fusedContext as a string", async () => {
      const result = await mf.fuseInput({
        modalities: [
          { type: "text", data: "some text content", label: "user input" },
        ],
      });

      expect(typeof result.fusedContext).toBe("string");
    });

    it("should include inputCount in result", async () => {
      const result = await mf.fuseInput({
        modalities: [{ type: "text", data: "hello" }],
      });

      expect(result.inputCount).toBe(1);
    });

    it("should include modalities array in result", async () => {
      const result = await mf.fuseInput({
        modalities: [{ type: "text", data: "hello" }],
      });

      expect(Array.isArray(result.modalities)).toBe(true);
      expect(result.modalities).toContain("text");
    });

    it("should include the text data in fusedContext", async () => {
      const result = await mf.fuseInput({
        modalities: [{ type: "text", data: "unique-text-content-xyz" }],
      });

      expect(result.fusedContext).toContain("unique-text-content-xyz");
    });

    it("should handle multiple text inputs in a single call", async () => {
      const result = await mf.fuseInput({
        modalities: [
          { type: "text", data: "first input", label: "label-a" },
          { type: "text", data: "second input", label: "label-b" },
        ],
      });

      expect(result.inputCount).toBe(2);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // fuseInput — event emission
  // ─────────────────────────────────────────────────────────────────────────
  describe("fuseInput() - events", () => {
    beforeEach(async () => {
      await mf.initialize(db);
    });

    it('should emit "fusion:completed" event after successful fusion', async () => {
      const handler = vi.fn();
      mf.on("fusion:completed", handler);

      await mf.fuseInput({
        modalities: [{ type: "text", data: "event test" }],
      });

      expect(handler).toHaveBeenCalledOnce();
    });

    it('should include sessionId and inputCount in "fusion:completed" payload', async () => {
      let payload;
      mf.on("fusion:completed", (p) => {
        payload = p;
      });

      await mf.fuseInput({
        modalities: [{ type: "text", data: "payload test" }],
      });

      expect(payload).toHaveProperty("sessionId");
      expect(payload).toHaveProperty("inputCount", 1);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // getSession
  // ─────────────────────────────────────────────────────────────────────────
  describe("getSession()", () => {
    beforeEach(async () => {
      await mf.initialize(db);
    });

    it("should return the session object after fuseInput", async () => {
      const { sessionId } = await mf.fuseInput({
        modalities: [{ type: "text", data: "session test" }],
      });

      const session = mf.getSession(sessionId);

      expect(session).not.toBeNull();
      expect(session.id).toBe(sessionId);
    });

    it("should return null for an unknown sessionId", () => {
      // Mock DB returns null for unknown sessions
      db._prep.get.mockReturnValue(null);

      const session = mf.getSession("nonexistent-session-id");
      expect(session).toBeNull();
    });

    it("should have status ACTIVE on the returned session", async () => {
      const { sessionId } = await mf.fuseInput({
        modalities: [{ type: "text", data: "status check" }],
      });

      const session = mf.getSession(sessionId);
      expect(session.status).toBe(SESSION_STATUS.ACTIVE);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // getSupportedModalities
  // ─────────────────────────────────────────────────────────────────────────
  describe("getSupportedModalities()", () => {
    beforeEach(async () => {
      await mf.initialize(db);
    });

    it("should return an array", () => {
      const result = mf.getSupportedModalities();
      expect(Array.isArray(result)).toBe(true);
    });

    it('should include an entry where type is "text" with available=true', () => {
      const result = mf.getSupportedModalities();
      const textEntry = result.find((m) => m.type === "text");

      expect(textEntry).toBeDefined();
      expect(textEntry.available).toBe(true);
    });

    it("should return 5 modalities (text, image, audio, document, screen)", () => {
      const result = mf.getSupportedModalities();
      expect(result).toHaveLength(5);
    });

    it("each entry should have type, available, and description fields", () => {
      const result = mf.getSupportedModalities();
      for (const entry of result) {
        expect(entry).toHaveProperty("type");
        expect(entry).toHaveProperty("available");
        expect(entry).toHaveProperty("description");
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // getArtifacts
  // ─────────────────────────────────────────────────────────────────────────
  describe("getArtifacts()", () => {
    beforeEach(async () => {
      await mf.initialize(db);
    });

    it("should return an array (empty with mock DB)", () => {
      db._prep.all.mockReturnValue([]);
      const artifacts = mf.getArtifacts("any-session-id");
      expect(Array.isArray(artifacts)).toBe(true);
    });

    it("should return empty array when DB returns no rows", () => {
      db._prep.all.mockReturnValue([]);
      const artifacts = mf.getArtifacts("some-session");
      expect(artifacts).toHaveLength(0);
    });

    it("should return empty array when db is null", async () => {
      const mfNoDb = new ModalityFusion();
      await mfNoDb.initialize(null);
      const artifacts = mfNoDb.getArtifacts("any-session");
      expect(artifacts).toEqual([]);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // getStats
  // ─────────────────────────────────────────────────────────────────────────
  describe("getStats()", () => {
    beforeEach(async () => {
      await mf.initialize(db);
    });

    it("should return stats object with required fields", () => {
      const stats = mf.getStats();
      expect(stats).toHaveProperty("totalSessions");
      expect(stats).toHaveProperty("activeSessions");
      expect(stats).toHaveProperty("modalityDistribution");
    });

    it("should start with zero totalSessions", () => {
      const stats = mf.getStats();
      expect(stats.totalSessions).toBe(0);
    });

    it("should have activeSessions > 0 after fuseInput", async () => {
      await mf.fuseInput({
        modalities: [{ type: "text", data: "stats test" }],
      });

      const stats = mf.getStats();
      expect(stats.activeSessions).toBeGreaterThan(0);
    });

    it("should track text in modalityDistribution after fuseInput", async () => {
      await mf.fuseInput({
        modalities: [{ type: "text", data: "distribution test" }],
      });

      const stats = mf.getStats();
      expect(stats.modalityDistribution.text).toBeGreaterThanOrEqual(1);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // getConfig / configure
  // ─────────────────────────────────────────────────────────────────────────
  describe("getConfig() / configure()", () => {
    beforeEach(async () => {
      await mf.initialize(db);
    });

    it("should return config object with known default keys", () => {
      const config = mf.getConfig();
      expect(config).toHaveProperty("maxInputsPerSession");
      expect(config).toHaveProperty("contextWindowTokens");
    });

    it("should apply updates via configure()", () => {
      mf.configure({ contextWindowTokens: 8000 });
      const config = mf.getConfig();
      expect(config.contextWindowTokens).toBe(8000);
    });

    it("configure() should return updated config object", () => {
      const returned = mf.configure({ maxImageSizeMB: 20 });
      expect(returned.maxImageSizeMB).toBe(20);
    });

    it("configure() should not overwrite unrelated fields", () => {
      const before = mf.getConfig();
      mf.configure({ maxImageSizeMB: 20 });
      const after = mf.getConfig();
      expect(after.maxInputsPerSession).toBe(before.maxInputsPerSession);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Constants
  // ─────────────────────────────────────────────────────────────────────────
  describe("MODALITIES constant", () => {
    it("should have TEXT value of 'text'", () => {
      expect(MODALITIES.TEXT).toBe("text");
    });

    it("should have IMAGE value of 'image'", () => {
      expect(MODALITIES.IMAGE).toBe("image");
    });

    it("should have AUDIO value of 'audio'", () => {
      expect(MODALITIES.AUDIO).toBe("audio");
    });

    it("should have DOCUMENT value of 'document'", () => {
      expect(MODALITIES.DOCUMENT).toBe("document");
    });

    it("should have SCREEN value of 'screen'", () => {
      expect(MODALITIES.SCREEN).toBe("screen");
    });
  });

  describe("SESSION_STATUS constant", () => {
    it("should have ACTIVE value of 'active'", () => {
      expect(SESSION_STATUS.ACTIVE).toBe("active");
    });

    it("should have PROCESSING value of 'processing'", () => {
      expect(SESSION_STATUS.PROCESSING).toBe("processing");
    });

    it("should have COMPLETED value of 'completed'", () => {
      expect(SESSION_STATUS.COMPLETED).toBe("completed");
    });

    it("should have ARCHIVED value of 'archived'", () => {
      expect(SESSION_STATUS.ARCHIVED).toBe("archived");
    });
  });
});
