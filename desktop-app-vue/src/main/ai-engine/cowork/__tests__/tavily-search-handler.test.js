/**
 * Tavily Search Handler Unit Tests (v2.0)
 *
 * Tests: search, qna, extract, crawl, map, research, domain filtering, parsing
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const handler = require("../skills/builtin/tavily-search/handler.js");

describe("TavilySearch Handler", () => {
  const MOCK_API_KEY = "tvly-test-key-12345";

  beforeEach(() => {
    process.env.TAVILY_API_KEY = MOCK_API_KEY;
    handler._deps.fetchJSON = vi.fn();
  });

  afterEach(() => {
    delete process.env.TAVILY_API_KEY;
    handler._deps.fetchJSON = null;
  });

  describe("init", () => {
    it("should initialize", async () => {
      await expect(
        handler.init({ name: "tavily-search" }),
      ).resolves.toBeUndefined();
    });
  });

  describe("no API key", () => {
    it("should fail without API key", async () => {
      delete process.env.TAVILY_API_KEY;
      const result = await handler.execute({ input: "test query" }, {});
      expect(result.success).toBe(false);
      expect(result.error).toContain("TAVILY_API_KEY");
    });
  });

  describe("no query", () => {
    it("should show usage when no input", async () => {
      const result = await handler.execute({ input: "" }, {});
      expect(result.success).toBe(false);
      expect(result.error).toContain("Usage");
    });
  });

  describe("search mode", () => {
    it("should perform basic search", async () => {
      handler._deps.fetchJSON.mockResolvedValue({
        answer: "Vue3 is great",
        results: [
          {
            title: "Vue3 Guide",
            url: "https://vuejs.org",
            content: "Vue 3 guide",
            score: 0.95,
          },
        ],
      });

      const result = await handler.execute(
        { input: "Vue3 best practices" },
        {},
      );

      expect(result.success).toBe(true);
      expect(result.mode).toBe("search");
      expect(result.answer).toBe("Vue3 is great");
      expect(result.results.length).toBe(1);
      expect(result.results[0].title).toBe("Vue3 Guide");
    });

    it("should pass domain filters", async () => {
      handler._deps.fetchJSON.mockResolvedValue({ answer: null, results: [] });

      await handler.execute(
        { input: "--include vuejs.org,github.com --exclude reddit.com test" },
        {},
      );

      const callArgs = handler._deps.fetchJSON.mock.calls[0];
      const payload = JSON.parse(callArgs[1]);
      expect(payload.include_domains).toEqual(["vuejs.org", "github.com"]);
      expect(payload.exclude_domains).toEqual(["reddit.com"]);
    });

    it("should pass depth and max flags", async () => {
      handler._deps.fetchJSON.mockResolvedValue({ answer: null, results: [] });

      await handler.execute(
        { input: "--depth advanced --max 10 AI agents" },
        {},
      );

      const payload = JSON.parse(handler._deps.fetchJSON.mock.calls[0][1]);
      expect(payload.search_depth).toBe("advanced");
      expect(payload.max_results).toBe(10);
    });
  });

  describe("qna mode", () => {
    it("should return QNA answer with sources", async () => {
      handler._deps.fetchJSON.mockResolvedValue({
        answer: "TypeScript adds static typing to JavaScript.",
        results: [
          {
            title: "TS Docs",
            url: "https://typescriptlang.org",
            content: "...",
            score: 0.9,
          },
        ],
      });

      const result = await handler.execute(
        { input: "qna What is TypeScript?" },
        {},
      );

      expect(result.success).toBe(true);
      expect(result.mode).toBe("qna");
      expect(result.answer).toContain("TypeScript");
      expect(result.sources.length).toBe(1);
      expect(result.message).toContain("Sources");
    });
  });

  describe("extract mode", () => {
    it("should extract content from URL", async () => {
      handler._deps.fetchJSON.mockResolvedValue({
        results: [
          { url: "https://example.com", raw_content: "Page content here" },
        ],
      });

      const result = await handler.execute(
        { input: "extract https://example.com" },
        {},
      );

      expect(result.success).toBe(true);
      expect(result.mode).toBe("extract");
      expect(result.results[0].raw_content).toBe("Page content here");
    });

    it("should extract from multiple URLs", async () => {
      handler._deps.fetchJSON.mockResolvedValue({
        results: [
          { url: "https://a.com", raw_content: "A" },
          { url: "https://b.com", raw_content: "B" },
        ],
      });

      const result = await handler.execute(
        { input: "extract https://a.com,https://b.com" },
        {},
      );

      expect(result.success).toBe(true);
      expect(result.resultCount).toBe(2);
    });
  });

  describe("crawl mode", () => {
    it("should crawl website pages", async () => {
      handler._deps.fetchJSON.mockResolvedValue({
        results: [
          {
            url: "https://docs.example.com/intro",
            title: "Intro",
            raw_content: "...",
          },
          {
            url: "https://docs.example.com/api",
            title: "API",
            raw_content: "...",
          },
        ],
      });

      const result = await handler.execute(
        { input: "crawl https://docs.example.com" },
        {},
      );

      expect(result.success).toBe(true);
      expect(result.mode).toBe("crawl");
      expect(result.pageCount).toBe(2);
      expect(result.pages[0].url).toContain("docs.example.com");
    });
  });

  describe("map mode", () => {
    it("should return site URL map", async () => {
      handler._deps.fetchJSON.mockResolvedValue({
        urls: [
          "https://example.com/a",
          "https://example.com/b",
          "https://example.com/c",
        ],
      });

      const result = await handler.execute(
        { input: "map https://example.com" },
        {},
      );

      expect(result.success).toBe(true);
      expect(result.mode).toBe("map");
      expect(result.urlCount).toBe(3);
    });
  });

  describe("research mode", () => {
    it("should perform multi-phase research", async () => {
      // First call: broad search
      handler._deps.fetchJSON
        .mockResolvedValueOnce({
          answer: "AI agents are autonomous systems.",
          results: [
            {
              title: "AI Agents",
              url: "https://example.com/ai",
              content: "AI content",
              score: 0.9,
            },
          ],
        })
        // Second call: extract
        .mockResolvedValueOnce({
          results: [
            {
              url: "https://example.com/ai",
              raw_content: "Detailed content...",
            },
          ],
        });

      const result = await handler.execute(
        { input: "research AI agent architectures" },
        {},
      );

      expect(result.success).toBe(true);
      expect(result.mode).toBe("research");
      expect(result.result.sources.length).toBe(1);
      expect(result.result.extractedContent.length).toBe(1);
      expect(result.result.citations.length).toBe(1);
      expect(result.message).toContain("Research");
    });
  });

  describe("error handling", () => {
    it("should handle fetch errors", async () => {
      handler._deps.fetchJSON.mockRejectedValue(new Error("Network error"));

      const result = await handler.execute({ input: "test query" }, {});

      expect(result.success).toBe(false);
      expect(result.error).toBe("Network error");
    });
  });
});
