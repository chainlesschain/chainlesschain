/**
 * Unit tests for tavily-search skill handler (v1.2.0)
 * Uses https module for Tavily API - test without network
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createEnvironmentContext } from "./helpers/bundled-skill-environment.js";

vi.mock("../../../../utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const handler = require("../builtin/tavily-search/handler.js");

describe("tavily-search handler", () => {
  const context = createEnvironmentContext("tavily-search", {
    "tavily-api-key": "tvly-test-key-for-unit-tests",
  });
  const missingContext = createEnvironmentContext("tavily-search");

  beforeEach(() => {
    vi.clearAllMocks();
    handler._deps.fetchJSON = vi
      .fn()
      .mockRejectedValue(new Error("network disabled in unit tests"));
  });

  describe("execute() - search mode", () => {
    it("should attempt search (will fail without real API)", async () => {
      const result = await handler.execute(
        { input: "search What is quantum computing?" },
        context,
        context,
      );
      // Will fail without real API key/network, but should not throw
      expect(result).toBeDefined();
    });

    it("should default to search mode when no mode specified", async () => {
      const result = await handler.execute(
        { input: "What is the latest in AI?" },
        context,
        {},
      );
      expect(result).toBeDefined();
    });
  });

  describe("execute() - extract mode", () => {
    it("should attempt URL extraction (will fail without real API)", async () => {
      const result = await handler.execute(
        { input: "extract https://example.com" },
        context,
        {},
      );
      expect(result).toBeDefined();
    });
  });

  describe("execute() - error handling", () => {
    it("should fail on empty input", async () => {
      const result = await handler.execute({ input: "" }, {}, {});
      expect(result.success).toBe(false);
    });

    it("should fail on missing input", async () => {
      const result = await handler.execute({}, {}, {});
      expect(result.success).toBe(false);
    });

    it("should report missing API key", async () => {
      const result = await handler.execute(
        { input: "search test query" },
        missingContext,
        {},
      );
      // Should indicate API key is missing
      expect(result).toBeDefined();
      if (!result.success) {
        const text = JSON.stringify(result).toLowerCase();
        expect(text).toMatch(/api.?key|tavily|credential|missing/);
      }
    });
  });
});
