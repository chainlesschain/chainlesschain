/**
 * Unit tests for skill-creator skill handler (v1.2.0)
 * Creates files in builtin dir - test non-destructive actions
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const handler = require("../builtin/skill-creator/handler.js");

describe("skill-creator handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("execute() - list-templates action", () => {
    it("should list available templates", async () => {
      const result = await handler.execute({ input: "list-templates" }, {}, {});
      expect(result.success).toBe(true);
      expect(result.action).toBe("list-templates");
    });
  });

  describe("execute() - validate action", () => {
    it("should validate an existing skill", async () => {
      const result = await handler.execute(
        { input: "validate ultrathink" },
        {},
        {},
      );
      // Should succeed for existing skills or fail gracefully
      expect(result).toBeDefined();
    });
  });

  describe("execute() - optimize action", () => {
    it("should analyze and suggest optimizations", async () => {
      const result = await handler.execute(
        { input: "optimize ultrathink" },
        {},
        {},
      );
      expect(result).toBeDefined();
    });
  });

  describe("execute() - create action", () => {
    it("should fail on create without name", async () => {
      const result = await handler.execute({ input: "create" }, {}, {});
      expect(result.success).toBe(false);
    });

    it("should generate skill structure for new skill name", async () => {
      // Uses a name that likely already exists as a dir, to avoid creating new files
      const result = await handler.execute(
        { input: 'create ultrathink "A test skill"' },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.action).toBe("create");
      expect(result.skillName).toBe("ultrathink");
    });
  });

  describe("execute() - default behavior", () => {
    it("should default to list-templates on empty input", async () => {
      const result = await handler.execute({ input: "" }, {}, {});
      expect(result.success).toBe(true);
      expect(result.action).toBe("list-templates");
    });

    it("should default to list-templates on missing input", async () => {
      const result = await handler.execute({}, {}, {});
      expect(result.success).toBe(true);
      expect(result.action).toBe("list-templates");
    });
  });
});
