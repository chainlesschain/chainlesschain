/**
 * Unit tests for brainstorming skill handler (v1.2.0)
 * Tests all 5 brainstorming modes: ideate, mindmap, swot, sixhats, scamper
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const handler = require("../builtin/brainstorming/handler.js");

describe("brainstorming handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("init()", () => {
    it("should initialize without errors", async () => {
      await expect(
        handler.init({ name: "brainstorming" }),
      ).resolves.not.toThrow();
    });

    it("should handle missing skill param", async () => {
      await expect(handler.init(undefined)).resolves.not.toThrow();
    });
  });

  describe("execute() - ideate mode", () => {
    it("should generate ideation output for a topic", async () => {
      const result = await handler.execute(
        { input: "ideate How to improve CI/CD" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.output).toContain("Brainstorming");
      expect(result.output).toContain("Quick Wins");
      expect(result.output).toContain("Strategic");
      expect(result.result.method).toBe("ideate");
    });

    it("should default to ideate when no mode specified", async () => {
      const result = await handler.execute(
        { input: "How to improve onboarding" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.result.method).toBe("ideate");
      expect(result.output).toContain("How to improve onboarding");
    });

    it("should use params.input when available", async () => {
      const result = await handler.execute(
        { params: { input: "ideate Testing strategies" } },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.result.topic).toBe("Testing strategies");
    });
  });

  describe("execute() - mindmap mode", () => {
    it("should generate mind map structure", async () => {
      const result = await handler.execute(
        { input: "mindmap Microservice architecture" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.output).toContain("Mind Map");
      expect(result.output).toContain("Aspect 1");
      expect(result.result.method).toBe("mindmap");
      expect(result.result.branches).toBeDefined();
    });
  });

  describe("execute() - swot mode", () => {
    it("should generate SWOT analysis", async () => {
      const result = await handler.execute(
        { input: "swot Migrating to cloud" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.output).toContain("Strengths");
      expect(result.output).toContain("Weaknesses");
      expect(result.output).toContain("Opportunities");
      expect(result.output).toContain("Threats");
      expect(result.output).toContain("Strategy Matrix");
      expect(result.result.method).toBe("swot");
    });
  });

  describe("execute() - sixhats mode", () => {
    it("should generate six thinking hats", async () => {
      const result = await handler.execute(
        { input: "sixhats Should we adopt TypeScript?" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.output).toContain("White Hat");
      expect(result.output).toContain("Red Hat");
      expect(result.output).toContain("Black Hat");
      expect(result.output).toContain("Yellow Hat");
      expect(result.output).toContain("Green Hat");
      expect(result.output).toContain("Blue Hat");
      expect(result.result.method).toBe("sixhats");
      expect(result.result.hats).toHaveLength(6);
    });
  });

  describe("execute() - scamper mode", () => {
    it("should generate SCAMPER analysis", async () => {
      const result = await handler.execute(
        { input: "scamper Improve our deployment process" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.output).toContain("Substitute");
      expect(result.output).toContain("Combine");
      expect(result.output).toContain("Adapt");
      expect(result.output).toContain("Modify");
      expect(result.output).toContain("Eliminate");
      expect(result.output).toContain("Reverse");
      expect(result.result.method).toBe("scamper");
      expect(result.result.steps).toHaveLength(7);
    });
  });

  describe("execute() - error handling", () => {
    it("should fail when no topic provided", async () => {
      const result = await handler.execute({ input: "" }, {}, {});
      expect(result.success).toBe(false);
      expect(result.error).toContain("No topic");
    });

    it("should fail on empty input object", async () => {
      const result = await handler.execute({}, {}, {});
      expect(result.success).toBe(false);
    });

    it("should fail when mode is given but no topic", async () => {
      const result = await handler.execute({ input: "swot" }, {}, {});
      expect(result.success).toBe(false);
    });

    it("should include message on success", async () => {
      const result = await handler.execute(
        { input: "ideate Better testing" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.message).toContain("ideate");
      expect(result.message).toContain("Better testing");
    });
  });
});
