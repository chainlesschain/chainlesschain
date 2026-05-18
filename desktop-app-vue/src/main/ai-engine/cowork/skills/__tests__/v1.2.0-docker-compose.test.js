/**
 * Unit tests for docker-compose-generator skill handler (v1.2.0)
 * Uses fs for validate action only - test generation logic without fs
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const handler = require("../builtin/docker-compose-generator/handler.js");

describe("docker-compose-generator handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("execute() - generate action", () => {
    it("should generate docker-compose config", async () => {
      const result = await handler.execute(
        { input: "generate Node.js app with PostgreSQL and Redis" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.action).toBe("generate");
      expect(result.services).toBeDefined();
    });

    it("should detect PostgreSQL service from description", async () => {
      const result = await handler.execute(
        { input: "generate App with PostgreSQL database" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.services).toContain("postgresql");
    });

    it("should detect Redis service from description", async () => {
      const result = await handler.execute(
        { input: "generate App with Redis cache" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.services).toContain("redis");
    });

    it("should detect MongoDB service", async () => {
      const result = await handler.execute(
        { input: "generate Python app with MongoDB" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.services).toContain("mongodb");
    });

    it("should detect Elasticsearch service", async () => {
      const result = await handler.execute(
        { input: "generate App with Elasticsearch" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.services).toContain("elasticsearch");
    });

    it("should detect Node.js app service", async () => {
      const result = await handler.execute(
        { input: "generate Node.js web application with Redis" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.services).toContain("app");
    });

    it("should detect Python app service", async () => {
      const result = await handler.execute(
        { input: "generate Python FastAPI application with PostgreSQL" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.services).toContain("app");
    });

    it("should generate valid YAML-like output", async () => {
      const result = await handler.execute(
        { input: "generate Web app with PostgreSQL" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.yaml).toContain("services");
    });
  });

  describe("execute() - template action", () => {
    it("should list available templates", async () => {
      const result = await handler.execute({ input: "template" }, {}, {});
      expect(result.success).toBe(true);
      expect(result.action).toBe("template");
      expect(result.templates).toBeDefined();
      expect(typeof result.templates).toBe("object");
    });

    it("should have 5 template presets", async () => {
      const result = await handler.execute({ input: "template" }, {}, {});
      expect(Object.keys(result.templates).length).toBe(5);
    });

    it("should generate from template name", async () => {
      const result = await handler.execute(
        { input: "template fullstack" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.action).toBe("generate");
    });
  });

  describe("execute() - add-service action", () => {
    it("should add a known service", async () => {
      const result = await handler.execute(
        { input: "add-service redis" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.action).toBe("add-service");
    });

    it("should fail on unknown service", async () => {
      const result = await handler.execute(
        { input: "add-service nonexistent" },
        {},
        {},
      );
      expect(result.success).toBe(false);
    });
  });

  describe("execute() - default behavior", () => {
    it("should default to generate on empty input", async () => {
      const result = await handler.execute({ input: "" }, {}, {});
      expect(result.success).toBe(true);
      expect(result.action).toBe("generate");
    });

    it("should default to generate on missing input", async () => {
      const result = await handler.execute({}, {}, {});
      expect(result.success).toBe(true);
      expect(result.action).toBe("generate");
    });
  });
});
