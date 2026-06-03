/**
 * Unit tests for ultrathink skill handler (v1.2.0)
 * Pure logic handler - no external dependencies
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const handler = require("../builtin/ultrathink/handler.js");

describe("ultrathink handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("execute()", () => {
    it('should return action "analyze" on valid input', async () => {
      const result = await handler.execute(
        { input: "analyze How does garbage collection work in V8?" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.action).toBe("analyze");
    });

    it("should default to analyze mode when no mode specified", async () => {
      const result = await handler.execute(
        { input: "How does garbage collection work?" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.action).toBe("analyze");
      expect(result.thinking).toBeDefined();
      expect(result.thinking.steps.length).toBe(7);
    });

    it("should use analyze mode explicitly", async () => {
      const result = await handler.execute(
        { input: "analyze Why is this algorithm O(n log n)?" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.action).toBe("analyze");
      expect(result.thinking.steps.length).toBe(7);
    });

    it("should use decompose mode", async () => {
      const result = await handler.execute(
        { input: "decompose Build a real-time chat system" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.action).toBe("decompose");
      expect(result.thinking.steps.length).toBe(7);
    });

    it("should use evaluate mode", async () => {
      const result = await handler.execute(
        { input: "evaluate Should we use microservices or monolith?" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.action).toBe("evaluate");
      expect(result.thinking.steps.length).toBe(7);
    });

    it("should include systemPrompt in result", async () => {
      const result = await handler.execute(
        { input: "analyze Test problem" },
        {},
        {},
      );
      expect(result.systemPrompt).toBeDefined();
      expect(typeof result.systemPrompt).toBe("string");
      expect(result.systemPrompt.length).toBeGreaterThan(50);
    });

    it("should include problem in result", async () => {
      const result = await handler.execute(
        { input: "analyze My specific problem here" },
        {},
        {},
      );
      expect(result.problem).toBe("My specific problem here");
    });

    it("should default to analyze on empty input", async () => {
      const result = await handler.execute({ input: "" }, {}, {});
      expect(result.success).toBe(true);
      expect(result.action).toBe("analyze");
    });

    it("should default to analyze on no input", async () => {
      const result = await handler.execute({}, {}, {});
      expect(result.success).toBe(true);
      expect(result.action).toBe("analyze");
    });

    it("should handle task.args fallback", async () => {
      const result = await handler.execute(
        { args: "decompose Design a caching layer" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.action).toBe("decompose");
    });

    it("analyze thinking steps should have correct structure", async () => {
      const result = await handler.execute({ input: "analyze Test" }, {}, {});
      const steps = result.thinking.steps;
      expect(steps[0].step).toBe(1);
      expect(steps[0].name).toBeDefined();
      expect(steps[0].prompt).toBeDefined();
      for (const s of steps) {
        expect(typeof s.name).toBe("string");
        expect(s.name.length).toBeGreaterThan(0);
      }
    });

    it("decompose thinking steps should reference components", async () => {
      const result = await handler.execute(
        { input: "decompose Build an auth system" },
        {},
        {},
      );
      expect(result.thinking.phase).toBe("decomposition");
      const stepNames = result.thinking.steps.map((s) => s.name).join(" ");
      expect(stepNames).toContain("Component");
    });

    it("evaluate thinking steps should reference trade-offs", async () => {
      const result = await handler.execute(
        { input: "evaluate SQL vs NoSQL" },
        {},
        {},
      );
      expect(result.thinking.phase).toBe("evaluation");
      const stepNames = result.thinking.steps.map((s) => s.name).join(" ");
      expect(stepNames).toContain("Trade-off");
    });

    it("systemPrompt should contain the problem text", async () => {
      const result = await handler.execute(
        { input: "analyze Unique problem XYZ123" },
        {},
        {},
      );
      expect(result.systemPrompt).toContain("Unique problem XYZ123");
    });
  });
});
