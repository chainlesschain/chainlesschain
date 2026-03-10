/**
 * Unit tests for self-improving-agent skill handler (v1.2.0)
 * Uses _deps injection for fs/path mocking
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const handler = require("../builtin/self-improving-agent/handler.js");

describe("self-improving-agent handler", () => {
  let mockFs;

  beforeEach(() => {
    vi.clearAllMocks();
    if (handler._resetState) {
      handler._resetState();
    }

    mockFs = {
      existsSync: vi.fn().mockReturnValue(false),
      mkdirSync: vi.fn(),
      readFileSync: vi.fn().mockReturnValue("{}"),
      writeFileSync: vi.fn(),
    };
    if (handler._deps) {
      handler._deps.fs = mockFs;
      handler._deps.path = { join: (...args) => args.join("/") };
    }
  });

  describe("execute() - record-error", () => {
    it("should record an error with description", async () => {
      const result = await handler.execute(
        { input: 'record-error "TypeError: cannot read null"' },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.action).toBe("record-error");
      expect(result.entry).toBeDefined();
      expect(result.entry.category).toBe("type-error");
    });

    it("should record an error with fix", async () => {
      const result = await handler.execute(
        { input: 'record-error "null pointer" fix: "add null check"' },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.entry.fix).toBe("add null check");
    });

    it("should return error for empty description", async () => {
      const result = await handler.execute({ input: "record-error" }, {}, {});
      expect(result.success).toBe(false);
    });

    it("should categorize network errors", async () => {
      const result = await handler.execute(
        { input: "record-error network timeout ECONNREFUSED" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.entry.category).toBe("network-error");
    });
  });

  describe("execute() - analyze-patterns", () => {
    it("should return empty patterns when no errors recorded", async () => {
      const result = await handler.execute(
        { input: "analyze-patterns" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.patterns).toEqual([]);
    });

    it("should find patterns after recording multiple errors", async () => {
      await handler.execute(
        { input: "record-error TypeError null reference" },
        {},
        {},
      );
      await handler.execute(
        { input: "record-error TypeError undefined property" },
        {},
        {},
      );
      await handler.execute(
        { input: "record-error TypeError cannot read" },
        {},
        {},
      );

      const result = await handler.execute(
        { input: "analyze-patterns" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.summary.totalErrors).toBe(3);
    });
  });

  describe("execute() - suggest-improvements", () => {
    it("should return empty suggestions when no errors", async () => {
      const result = await handler.execute(
        { input: "suggest-improvements" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.suggestions).toEqual([]);
    });

    it("should generate suggestions from recorded errors", async () => {
      await handler.execute({ input: "record-error TypeError null" }, {}, {});
      await handler.execute(
        { input: "record-error TypeError undefined" },
        {},
        {},
      );

      const result = await handler.execute(
        { input: "suggest-improvements" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.suggestions.length).toBeGreaterThan(0);
    });
  });

  describe("execute() - show-history", () => {
    it("should show empty history", async () => {
      const result = await handler.execute({ input: "show-history" }, {}, {});
      expect(result.success).toBe(true);
      expect(result.entries).toEqual([]);
    });

    it("should show recorded entries", async () => {
      await handler.execute({ input: "record-error test error one" }, {}, {});
      await handler.execute({ input: "record-error test error two" }, {}, {});

      const result = await handler.execute({ input: "show-history" }, {}, {});
      expect(result.success).toBe(true);
      expect(result.entries.length).toBe(2);
    });
  });

  describe("execute() - clear-history", () => {
    it("should clear all history", async () => {
      await handler.execute({ input: "record-error some error" }, {}, {});
      const clearResult = await handler.execute(
        { input: "clear-history" },
        {},
        {},
      );
      expect(clearResult.success).toBe(true);

      const showResult = await handler.execute(
        { input: "show-history" },
        {},
        {},
      );
      expect(showResult.entries).toEqual([]);
    });
  });
});
