/**
 * Unit tests for deep-research skill handler (v1.2.0)
 * Pure logic handler - module-level activeResearch Map needs cleanup
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const handler = require("../builtin/deep-research/handler.js");

describe("deep-research handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("execute() - research action", () => {
    it("should create a research report for a valid query", async () => {
      const result = await handler.execute(
        { input: "How does WebAssembly improve browser performance?" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.action).toBe("research");
    });

    it("should return report with methodology phases", async () => {
      const result = await handler.execute(
        { input: "Impact of quantum computing on cryptography" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.report).toBeDefined();
      expect(result.report.methodology.phases).toBe(8);
    });

    it("should include researchId", async () => {
      const result = await handler.execute(
        { input: "Machine learning in healthcare" },
        {},
        {},
      );
      expect(result.researchId).toBeDefined();
      expect(typeof result.researchId).toBe("string");
    });

    it("should include subTopics in report", async () => {
      const result = await handler.execute(
        { input: "Explain the differences between REST and GraphQL APIs" },
        {},
        {},
      );
      expect(result.report.subTopics).toBeDefined();
      expect(Array.isArray(result.report.subTopics)).toBe(true);
      expect(result.report.subTopics.length).toBeGreaterThan(0);
    });

    it('should use default depth "standard" when not specified', async () => {
      const result = await handler.execute({ input: "Test query" }, {}, {});
      expect(result.success).toBe(true);
      expect(result.report.depth).toBe("standard");
    });

    it("should accept depth parameter", async () => {
      const result = await handler.execute(
        { input: "--depth deep Serverless architecture patterns" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.report.depth).toBe("deep");
    });

    it("should return status on empty input", async () => {
      const result = await handler.execute({ input: "" }, {}, {});
      expect(result.success).toBe(true);
      expect(result.action).toBe("status");
    });

    it("should return status on missing input", async () => {
      const result = await handler.execute({}, {}, {});
      expect(result.success).toBe(true);
      expect(result.action).toBe("status");
    });

    it("report should have bibliography", async () => {
      const result = await handler.execute(
        { input: "Explain microservices" },
        {},
        {},
      );
      expect(result.report.bibliography).toBeDefined();
      expect(Array.isArray(result.report.bibliography)).toBe(true);
    });
  });

  describe("execute() - status action", () => {
    it("should return status of active researches", async () => {
      await handler.execute({ input: "Topic A" }, {}, {});
      const result = await handler.execute({ input: "status" }, {}, {});
      expect(result.success).toBe(true);
      expect(result.action).toBe("status");
      expect(result.researches).toBeDefined();
    });
  });

  describe("subTopic generation", () => {
    it("should generate unique sub-topics", async () => {
      const result = await handler.execute(
        { input: "Kubernetes vs Docker Swarm for container orchestration" },
        {},
        {},
      );
      const subTopics = result.report.subTopics;
      if (subTopics && subTopics.length > 1) {
        const names = subTopics.map((s) => s.subTopic);
        const unique = new Set(names);
        expect(unique.size).toBe(names.length);
      }
    });
  });
});
