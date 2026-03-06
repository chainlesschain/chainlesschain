/**
 * Unit tests for webapp-testing skill handler (v1.2.0)
 * Browser engine is optional - tests degraded mode
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const handler = require("../builtin/webapp-testing/handler.js");

describe("webapp-testing handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("execute() - test action", () => {
    it("should test URL (degrades without browser)", async () => {
      const result = await handler.execute(
        { input: "test https://example.com" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.action).toBe("test");
      expect(result.results).toBeDefined();
    });
  });

  describe("execute() - accessibility action", () => {
    it("should return accessibility checks", async () => {
      const result = await handler.execute(
        { input: "accessibility https://example.com" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.action).toBe("accessibility");
      expect(result.checks).toBeDefined();
      expect(Array.isArray(result.checks)).toBe(true);
    });
  });

  describe("execute() - screenshot action", () => {
    it("should attempt screenshot", async () => {
      const result = await handler.execute(
        { input: "screenshot https://example.com" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.action).toBe("screenshot");
    });
  });

  describe("execute() - console action", () => {
    it("should capture console output", async () => {
      const result = await handler.execute(
        { input: "console https://example.com" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.action).toBe("console");
      expect(result.logs).toBeDefined();
    });
  });

  describe("execute() - inspect action", () => {
    it("should inspect page elements", async () => {
      const result = await handler.execute(
        { input: "inspect https://example.com" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.action).toBe("inspect");
      expect(result.elements).toBeDefined();
    });
  });

  describe("execute() - error handling", () => {
    it("should fail on empty input (no URL)", async () => {
      const result = await handler.execute({ input: "" }, {}, {});
      expect(result.success).toBe(false);
    });

    it("should fail on missing input", async () => {
      const result = await handler.execute({}, {}, {});
      expect(result.success).toBe(false);
    });

    it("should fail on scenario without steps", async () => {
      const result = await handler.execute(
        { input: "scenario https://example.com" },
        {},
        {},
      );
      expect(result.success).toBe(false);
    });
  });
});
