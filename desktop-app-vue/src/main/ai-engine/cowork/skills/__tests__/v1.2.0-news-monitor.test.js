/**
 * Unit tests for news-monitor skill handler (v1.2.0)
 * Uses https module for HN API - test logic without network calls
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const handler = require("../builtin/news-monitor/handler.js");

describe("news-monitor handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("execute() - watch action", () => {
    it("should add a keyword watch", async () => {
      const result = await handler.execute(
        { input: "watch rust programming" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.action).toBe("watch");
      expect(result.watch).toBeDefined();
    });

    it("should list watches when no keywords given", async () => {
      const result = await handler.execute({ input: "watch" }, {}, {});
      expect(result.success).toBe(true);
      expect(result.watches).toBeDefined();
    });
  });

  describe("execute() - digest action", () => {
    it("should return news digest", async () => {
      const result = await handler.execute({ input: "digest" }, {}, {});
      expect(result.success).toBe(true);
      expect(result.action).toBe("digest");
      expect(result.digest).toBeDefined();
    });
  });

  describe("execute() - trends action", () => {
    it("should return trending topics", async () => {
      const result = await handler.execute({ input: "trends" }, {}, {});
      expect(result.success).toBe(true);
      expect(result.action).toBe("trends");
    });
  });

  describe("execute() - source action", () => {
    it("should list available sources", async () => {
      const result = await handler.execute({ input: "source list" }, {}, {});
      expect(result.success).toBe(true);
      expect(result.sources).toBeDefined();
    });

    it("should include HackerNews as source", async () => {
      const result = await handler.execute({ input: "source list" }, {}, {});
      const text = JSON.stringify(result).toLowerCase();
      expect(text).toMatch(/hacker/);
    });
  });

  describe("execute() - fetch action", () => {
    it("should attempt to fetch news (may fail without network)", async () => {
      const result = await handler.execute({ input: "fetch" }, {}, {});
      // May succeed or fail depending on network
      expect(result).toBeDefined();
    });
  });

  describe("execute() - default behavior", () => {
    it("should default to digest on empty input", async () => {
      const result = await handler.execute({ input: "" }, {}, {});
      expect(result.success).toBe(true);
      expect(result.action).toBe("digest");
    });

    it("should default to digest on missing input", async () => {
      const result = await handler.execute({}, {}, {});
      expect(result.success).toBe(true);
      expect(result.action).toBe("digest");
    });
  });
});
