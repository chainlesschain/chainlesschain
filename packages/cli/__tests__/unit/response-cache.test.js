import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MockDatabase } from "../helpers/mock-db.js";
import {
  getCachedResponse,
  setCachedResponse,
  clearCache,
  clearExpired,
  getCacheStats,
} from "../../src/lib/response-cache.js";

describe("response-cache", () => {
  let db;

  beforeEach(() => {
    db = new MockDatabase();
  });

  afterEach(() => {
    db.close();
  });

  // ── Cache miss ──

  describe("cache miss", () => {
    it("returns hit: false for empty cache", () => {
      const result = getCachedResponse(db, "ollama", "qwen2:7b", [
        { role: "user", content: "hello" },
      ]);
      expect(result.hit).toBe(false);
    });

    it("returns hit: false for different messages", () => {
      setCachedResponse(
        db,
        "ollama",
        "qwen2:7b",
        [{ role: "user", content: "hello" }],
        "Hi!",
      );

      const result = getCachedResponse(db, "ollama", "qwen2:7b", [
        { role: "user", content: "goodbye" },
      ]);
      expect(result.hit).toBe(false);
    });

    it("returns hit: false for different provider", () => {
      const messages = [{ role: "user", content: "hello" }];
      setCachedResponse(db, "ollama", "qwen2:7b", messages, "Hi!");

      const result = getCachedResponse(db, "openai", "qwen2:7b", messages);
      expect(result.hit).toBe(false);
    });

    it("returns hit: false for different model", () => {
      const messages = [{ role: "user", content: "hello" }];
      setCachedResponse(db, "ollama", "qwen2:7b", messages, "Hi!");

      const result = getCachedResponse(db, "ollama", "llama3", messages);
      expect(result.hit).toBe(false);
    });
  });

  // ── Cache operations ──

  describe("cache operations", () => {
    it("stores a cached response to database", () => {
      const messages = [{ role: "user", content: "What is 2+2?" }];
      setCachedResponse(db, "ollama", "qwen2:7b", messages, "4", {
        responseTokens: 1,
      });

      const rows = db.data.get("llm_cache") || [];
      expect(rows.length).toBe(1);
      expect(rows[0].provider).toBe("ollama");
      expect(rows[0].model).toBe("qwen2:7b");
      expect(rows[0].response_content).toBe("4");
      expect(rows[0].response_tokens).toBe(1);
    });

    it("stores multiple entries with different keys", () => {
      setCachedResponse(
        db,
        "ollama",
        "qwen2:7b",
        [{ role: "user", content: "a" }],
        "A",
      );
      setCachedResponse(
        db,
        "openai",
        "gpt-4o",
        [{ role: "user", content: "b" }],
        "B",
      );

      const rows = db.data.get("llm_cache") || [];
      expect(rows.length).toBe(2);
    });

    it("replaces entry with same cache key (OR REPLACE)", () => {
      const messages = [{ role: "user", content: "What is 2+2?" }];
      setCachedResponse(db, "ollama", "qwen2:7b", messages, "4");
      setCachedResponse(db, "ollama", "qwen2:7b", messages, "four");

      const rows = db.data.get("llm_cache") || [];
      expect(rows.length).toBe(1);
      expect(rows[0].response_content).toBe("four");
    });

    it("clears all cache", () => {
      setCachedResponse(
        db,
        "ollama",
        "m",
        [{ role: "user", content: "a" }],
        "x",
      );
      setCachedResponse(
        db,
        "ollama",
        "m",
        [{ role: "user", content: "b" }],
        "y",
      );

      clearCache(db);
      const rows = db.data.get("llm_cache") || [];
      expect(rows.length).toBe(0);
    });

    it("sets expires_at field in the future", () => {
      setCachedResponse(
        db,
        "ollama",
        "m",
        [{ role: "user", content: "q" }],
        "a",
      );
      const rows = db.data.get("llm_cache") || [];
      expect(rows[0].expires_at).toBeDefined();
      expect(new Date(rows[0].expires_at).getTime()).toBeGreaterThan(
        Date.now(),
      );
    });

    it("sets cache_key as sha256 hash", () => {
      setCachedResponse(
        db,
        "ollama",
        "m",
        [{ role: "user", content: "q" }],
        "a",
      );
      const rows = db.data.get("llm_cache") || [];
      expect(rows[0].cache_key).toBeDefined();
      expect(rows[0].cache_key.length).toBe(64); // SHA-256 hex length
    });

    it("sets request_hash as md5 hash", () => {
      setCachedResponse(
        db,
        "ollama",
        "m",
        [{ role: "user", content: "q" }],
        "a",
      );
      const rows = db.data.get("llm_cache") || [];
      expect(rows[0].request_hash).toBeDefined();
      expect(rows[0].request_hash.length).toBe(32); // MD5 hex length
    });

    it("defaults responseTokens to 0", () => {
      setCachedResponse(
        db,
        "ollama",
        "m",
        [{ role: "user", content: "q" }],
        "a",
      );
      const rows = db.data.get("llm_cache") || [];
      expect(rows[0].response_tokens).toBe(0);
    });
  });

  // ── clearExpired ──

  describe("clearExpired", () => {
    it("returns 0 when no entries", () => {
      const removed = clearExpired(db);
      expect(removed).toBe(0);
    });

    it("returns 0 when no expired entries", () => {
      setCachedResponse(
        db,
        "ollama",
        "m",
        [{ role: "user", content: "a" }],
        "x",
      );
      const removed = clearExpired(db);
      // Entries just created shouldn't be expired yet
      expect(removed).toBe(0);
    });
  });

  // ── getCacheStats ──

  describe("getCacheStats", () => {
    it("returns zeroes for empty cache", () => {
      const stats = getCacheStats(db);
      expect(stats.total_entries).toBe(0);
      expect(stats.total_hits).toBe(0);
      expect(stats.total_tokens_saved).toBe(0);
      expect(stats.expired_entries).toBe(0);
    });

    it("counts entries correctly", () => {
      setCachedResponse(
        db,
        "ollama",
        "m",
        [{ role: "user", content: "a" }],
        "x",
        { responseTokens: 10 },
      );
      setCachedResponse(
        db,
        "ollama",
        "m",
        [{ role: "user", content: "b" }],
        "y",
        { responseTokens: 20 },
      );

      const stats = getCacheStats(db);
      expect(stats.total_entries).toBe(2);
    });

    it("handles null safety on aggregate results", () => {
      // Even with empty table, should not crash
      const stats = getCacheStats(db);
      expect(stats).toBeDefined();
      expect(typeof stats.total_entries).toBe("number");
      expect(typeof stats.total_hits).toBe("number");
      expect(typeof stats.total_tokens_saved).toBe("number");
    });
  });

  // ── Table creation ──

  describe("table creation", () => {
    it("creates table on first getCachedResponse", () => {
      expect(db.tables.has("llm_cache")).toBe(false);
      getCachedResponse(db, "ollama", "m", []);
      expect(db.tables.has("llm_cache")).toBe(true);
    });

    it("creates table on first setCachedResponse", () => {
      expect(db.tables.has("llm_cache")).toBe(false);
      setCachedResponse(db, "ollama", "m", [], "x");
      expect(db.tables.has("llm_cache")).toBe(true);
    });

    it("creates table on first clearCache", () => {
      expect(db.tables.has("llm_cache")).toBe(false);
      clearCache(db);
      expect(db.tables.has("llm_cache")).toBe(true);
    });
  });
});
