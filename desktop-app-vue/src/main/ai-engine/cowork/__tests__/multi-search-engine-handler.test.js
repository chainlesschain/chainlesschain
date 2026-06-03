/**
 * Multi Search Engine Handler Unit Tests
 *
 * Tests: engine definitions, URL generation, input parsing, filters
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const handler = require("../skills/builtin/multi-search-engine/handler.js");

describe("MultiSearchEngine Handler", () => {
  describe("init", () => {
    it("should initialize without error", async () => {
      await expect(
        handler.init({ name: "multi-search-engine" }),
      ).resolves.toBeUndefined();
    });
  });

  describe("engine definitions", () => {
    it("should have 17 engines", () => {
      expect(Object.keys(handler._ENGINES).length).toBe(17);
    });

    it("should have 7 Chinese engines", () => {
      const cn = Object.values(handler._ENGINES).filter(
        (e) => e.region === "cn",
      );
      expect(cn.length).toBe(7);
    });

    it("should have 10 international engines", () => {
      const intl = Object.values(handler._ENGINES).filter(
        (e) => e.region === "intl",
      );
      expect(intl.length).toBe(10);
    });

    it("should have 4 privacy engines", () => {
      const privacy = Object.values(handler._ENGINES).filter((e) => e.privacy);
      expect(privacy.length).toBe(4);
    });

    it("should have 5 default engines", () => {
      expect(handler._DEFAULT_ENGINES.length).toBe(5);
    });
  });

  describe("execute - basic search", () => {
    it("should generate search URLs for default engines", async () => {
      const result = await handler.execute(
        { input: "Vue3 best practices" },
        {},
      );

      expect(result.success).toBe(true);
      expect(result.result.query).toBe("Vue3 best practices");
      expect(result.result.results.length).toBe(5); // default engines
      for (const r of result.result.results) {
        expect(r.url).toContain("Vue3");
        expect(r.engine).toBeTruthy();
        expect(r.key).toBeTruthy();
      }
    });

    it("should return error without query", async () => {
      const result = await handler.execute({ input: "" }, {});
      expect(result.success).toBe(false);
    });
  });

  describe("execute - engine filters", () => {
    it("should search specific engines", async () => {
      const result = await handler.execute(
        { input: "--engine google,baidu test query" },
        {},
      );

      expect(result.success).toBe(true);
      expect(result.result.results.length).toBe(2);
      expect(result.result.results.map((r) => r.key)).toEqual(
        expect.arrayContaining(["google", "baidu"]),
      );
    });

    it("should search all engines with --all", async () => {
      const result = await handler.execute(
        { input: "--all machine learning" },
        {},
      );

      expect(result.success).toBe(true);
      expect(result.result.results.length).toBe(17);
    });

    it("should search Chinese engines only", async () => {
      const result = await handler.execute({ input: "--chinese AI" }, {});

      expect(result.success).toBe(true);
      for (const r of result.result.results) {
        expect(r.region).toBe("cn");
      }
    });

    it("should search international engines only", async () => {
      const result = await handler.execute({ input: "--international AI" }, {});

      expect(result.success).toBe(true);
      for (const r of result.result.results) {
        expect(r.region).toBe("intl");
      }
    });

    it("should search privacy engines only", async () => {
      const result = await handler.execute(
        { input: "--privacy secure messaging" },
        {},
      );

      expect(result.success).toBe(true);
      for (const r of result.result.results) {
        expect(r.privacy).toBe(true);
      }
    });
  });

  describe("execute - time filter", () => {
    it("should apply time filter to URLs", async () => {
      const result = await handler.execute(
        { input: "--engine google --time week test" },
        {},
      );

      expect(result.success).toBe(true);
      expect(result.result.options.time).toBe("week");
      expect(result.result.results[0].url).toContain("tbs=qdr:w");
    });
  });

  describe("execute - invalid engines", () => {
    it("should report invalid engine names", async () => {
      const result = await handler.execute(
        { input: "--engine fake,google test" },
        {},
      );

      expect(result.success).toBe(true);
      expect(result.result.invalidEngines).toContain("fake");
      expect(result.result.results.length).toBe(1); // only google
    });
  });

  describe("URL encoding", () => {
    it("should encode special characters in query", async () => {
      const result = await handler.execute(
        { input: "--engine baidu C++ programming" },
        {},
      );

      expect(result.success).toBe(true);
      expect(result.result.results[0].url).toContain("C%2B%2B");
    });
  });
});
