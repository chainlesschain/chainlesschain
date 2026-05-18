/**
 * Unit tests for find-skills skill handler (v1.2.0)
 * Note: skill-registry init() fails silently in test → getAllSkills returns []
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const handler = require("../builtin/find-skills/handler.js");

describe("find-skills handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("init()", () => {
    it("should initialize without error", async () => {
      // init tries to require skill-registry, fails silently in test
      await expect(handler.init({})).resolves.not.toThrow();
    });
  });

  describe("execute() - search mode", () => {
    it("should search skills by keyword", async () => {
      const result = await handler.execute({ input: "search code" }, {}, {});
      expect(result.success).toBe(true);
      expect(result.mode).toBe("search");
    });

    it("should return skills array for search", async () => {
      const result = await handler.execute({ input: "search review" }, {}, {});
      expect(result.success).toBe(true);
      expect(result.skills).toBeDefined();
      expect(Array.isArray(result.skills)).toBe(true);
    });

    it("should return empty results when no registry loaded", async () => {
      const result = await handler.execute(
        { input: "search anything" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.skills.length).toBe(0);
    });
  });

  describe("execute() - recommend mode", () => {
    it("should recommend skills for a task description", async () => {
      const result = await handler.execute(
        { input: "recommend I need to review my code for security issues" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.mode).toBe("recommend");
      expect(result.skills).toBeDefined();
    });
  });

  describe("execute() - category mode", () => {
    it("should list skills grouped by category", async () => {
      const result = await handler.execute({ input: "category all" }, {}, {});
      expect(result.success).toBe(true);
      expect(result.mode).toBe("category");
    });

    it("should filter by specific category", async () => {
      const result = await handler.execute(
        { input: "category development" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.mode).toBe("category");
    });
  });

  describe("execute() - info mode", () => {
    it("should return not-found for unknown skill", async () => {
      const result = await handler.execute(
        { input: "info nonexistent-skill" },
        {},
        {},
      );
      expect(result.success).toBe(false);
      expect(result.mode).toBe("info");
    });
  });

  describe("execute() - error handling", () => {
    it("should fail on empty input (no query)", async () => {
      const result = await handler.execute({ input: "" }, {}, {});
      expect(result.success).toBe(false);
    });

    it("should fail on missing input (no query)", async () => {
      const result = await handler.execute({}, {}, {});
      expect(result.success).toBe(false);
    });
  });
});
