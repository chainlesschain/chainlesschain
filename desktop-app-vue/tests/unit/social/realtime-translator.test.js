import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../../src/main/utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("uuid", () => ({ v4: vi.fn(() => "test-uuid-001") }));

let mockRunStmt, mockAllStmt, mockDb;
let RealtimeTranslator, getRealtimeTranslator;

beforeEach(async () => {
  mockRunStmt = { run: vi.fn() };
  mockAllStmt = { all: vi.fn(() => []) };
  mockDb = {
    exec: vi.fn(),
    prepare: vi.fn((sql) => {
      if (sql.includes("INSERT") || sql.includes("UPDATE")) {
        return mockRunStmt;
      }
      if (sql.includes("SELECT")) {
        return mockAllStmt;
      }
      return { run: vi.fn(), get: vi.fn(() => null), all: vi.fn(() => []) };
    }),
  };
  const mod = await import("../../../src/main/social/realtime-translator.js");
  RealtimeTranslator = mod.RealtimeTranslator;
  getRealtimeTranslator = mod.getRealtimeTranslator;
});

describe("RealtimeTranslator", () => {
  let translator;
  beforeEach(() => {
    translator = new RealtimeTranslator({ db: mockDb });
  });

  describe("constructor", () => {
    it("should initialize with defaults", () => {
      expect(translator._cache).toBeInstanceOf(Map);
      expect(translator._stats.totalTranslations).toBe(0);
      expect(translator._stats.cacheHits).toBe(0);
    });
  });

  describe("translateMessage()", () => {
    it("should throw if text is missing", async () => {
      await expect(translator.translateMessage({})).rejects.toThrow(
        "Text is required",
      );
    });

    it("should throw if targetLang is missing", async () => {
      await expect(
        translator.translateMessage({ text: "hello" }),
      ).rejects.toThrow("Target language is required");
    });

    it("should translate message", async () => {
      const result = await translator.translateMessage({
        text: "hello",
        targetLang: "zh",
      });
      expect(result.translated_text).toBe("[zh] hello");
      expect(result.target_lang).toBe("zh");
      expect(result.model_used).toBe("local-llm");
    });

    it("should use cache on second call", async () => {
      await translator.translateMessage({ text: "hello", targetLang: "zh" });
      const result2 = await translator.translateMessage({
        text: "hello",
        targetLang: "zh",
      });
      expect(translator._stats.cacheHits).toBe(1);
      expect(result2.translated_text).toBe("[zh] hello");
    });

    it("should persist to DB", async () => {
      await translator.translateMessage({ text: "hello", targetLang: "fr" });
      expect(mockRunStmt.run).toHaveBeenCalled();
    });
  });

  describe("detectLanguage()", () => {
    it("should throw if text is missing", async () => {
      await expect(translator.detectLanguage()).rejects.toThrow(
        "Text is required",
      );
    });

    it("should detect English", async () => {
      const result = await translator.detectLanguage("hello world");
      expect(result.detectedLanguage).toBe("en");
      expect(result.confidence).toBe(0.95);
    });

    it("should detect Chinese", async () => {
      const result = await translator.detectLanguage(
        "\u4f60\u597d\u4e16\u754c",
      );
      expect(result.detectedLanguage).toBe("zh");
    });
  });

  describe("getTranslationStats()", () => {
    it("should return stats", async () => {
      const stats = await translator.getTranslationStats();
      expect(stats.totalTranslations).toBe(0);
      expect(stats.cacheHits).toBe(0);
      expect(stats.cacheSize).toBe(0);
    });

    it("should reflect translations", async () => {
      await translator.translateMessage({ text: "hello", targetLang: "zh" });
      const stats = await translator.getTranslationStats();
      expect(stats.totalTranslations).toBe(1);
      expect(stats.cacheSize).toBe(1);
    });
  });

  describe("close()", () => {
    it("should clear cache", async () => {
      await translator.translateMessage({ text: "hello", targetLang: "zh" });
      await translator.close();
      expect(translator._cache.size).toBe(0);
    });
  });

  describe("getSingleton", () => {
    it("should return instance", () => {
      const instance = getRealtimeTranslator();
      expect(instance).toBeInstanceOf(RealtimeTranslator);
    });
  });
});
