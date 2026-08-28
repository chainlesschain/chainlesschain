/**
 * Unit tests for free-model-manager Skill handler (v1.2.0).
 * Uses branded fixed-public and loopback-only service brokers.
 */
import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const handler = require("../builtin/free-model-manager/handler.js");
const {
  createBundledSkillFixedNetworkBroker,
} = require("../bundled-skill-egress-broker.js");
const {
  createBundledSkillLocalServiceBroker,
} = require("../bundled-skill-local-service-broker.js");

function createMockTransport(statusCode, body, error = null) {
  return {
    request: vi.fn((_options, callback) => {
      const req = new EventEmitter();
      req.end = vi.fn();
      req.destroy = vi.fn();
      req.setTimeout = vi.fn();
      if (error) {
        process.nextTick(() => req.emit("error", error));
        return req;
      }
      const res = new EventEmitter();
      res.statusCode = statusCode;
      res.statusMessage = statusCode === 200 ? "OK" : "Error";
      res.headers = { "content-type": "application/json" };
      res.destroy = vi.fn();
      callback(res);
      process.nextTick(() => {
        res.emit(
          "data",
          typeof body === "string" ? body : JSON.stringify(body),
        );
        res.emit("end");
      });
      return req;
    }),
  };
}

function createLocalContext(body, error = null) {
  const http = createMockTransport(200, body, error);
  return {
    http,
    context: {
      localServiceBroker: createBundledSkillLocalServiceBroker(
        {
          skillId: "free-model-manager",
          serviceId: "ollama",
          baseUrl: "http://localhost:11434/",
          authorityId: "test:ollama",
        },
        { http, auditSink: vi.fn() },
      ),
    },
  };
}

function createPublicContext(body) {
  const https = createMockTransport(200, body);
  return {
    https,
    context: {
      networkBroker: createBundledSkillFixedNetworkBroker(
        "free-model-manager",
        { https, auditSink: vi.fn() },
      ),
    },
  };
}

describe("free-model-manager handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("execute() - list-local", () => {
    it("should list local Ollama models", async () => {
      const { context } = createLocalContext({
        models: [
          {
            name: "llama3:8b",
            size: 4700000000,
            modified_at: "2026-01-01",
            digest: "abc123def456",
            details: {
              family: "llama",
              parameter_size: "8B",
              quantization_level: "Q4_0",
            },
          },
        ],
      });
      const result = await handler.execute(
        { input: "list-local" },
        context,
        {},
      );
      expect(result.success).toBe(true);
      expect(result.action).toBe("list-local");
      expect(result.result.models[0].name).toBe("llama3:8b");
    });

    it("should handle Ollama connection failure", async () => {
      const { context } = createLocalContext(null, new Error("ECONNREFUSED"));
      const result = await handler.execute(
        { input: "list-local" },
        context,
        {},
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("Cannot connect to Ollama");
    });

    it("should reject an unbranded local broker", async () => {
      const request = vi.fn();
      const result = await handler.execute(
        { input: "list-local" },
        { localServiceBroker: { request } },
        {},
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("Cannot connect to Ollama");
      expect(request).not.toHaveBeenCalled();
    });
  });

  describe("execute() - search", () => {
    it("should search catalog models", async () => {
      const result = await handler.execute({ input: "search code" }, {}, {});
      expect(result.success).toBe(true);
      expect(result.action).toBe("search");
      expect(
        result.result.results.some((model) => model.category === "code"),
      ).toBe(true);
    });

    it("should return error for empty query", async () => {
      const result = await handler.execute({ input: "search" }, {}, {});
      expect(result.success).toBe(false);
    });

    it("should search Hugging Face through the fixed public broker", async () => {
      const { context, https } = createPublicContext([
        { modelId: "org/model", likes: 4, downloads: 10 },
      ]);
      const result = await handler.execute(
        { input: "search code --source huggingface" },
        context,
        {},
      );
      expect(result.success).toBe(true);
      expect(
        result.result.results.some(
          (model) =>
            model.source === "huggingface" && model.name === "org/model",
        ),
      ).toBe(true);
      expect(https.request).toHaveBeenCalledWith(
        expect.objectContaining({ hostname: "huggingface.co", port: 443 }),
        expect.any(Function),
      );
    });
  });

  describe("execute() - pull", () => {
    it("should pull a model", async () => {
      const { context } = createLocalContext({ status: "success" });
      const result = await handler.execute(
        { input: "pull llama3:8b" },
        context,
        {},
      );
      expect(result.success).toBe(true);
      expect(result.action).toBe("pull");
      expect(result.result.model).toBe("llama3:8b");
    });

    it("should return error without model name", async () => {
      const result = await handler.execute({ input: "pull" }, {}, {});
      expect(result.success).toBe(false);
    });
  });

  describe("execute() - info", () => {
    it("should get model info from Ollama", async () => {
      const { context } = createLocalContext({
        modelfile: "FROM llama3",
        parameters: "num_ctx 4096",
        template: "{{ .Prompt }}",
        details: { family: "llama", parameter_size: "8B" },
        license: "MIT",
      });
      const result = await handler.execute(
        { input: "info llama3:8b" },
        context,
        {},
      );
      expect(result.success).toBe(true);
      expect(result.action).toBe("info");
      expect(result.result.source).toBe("ollama-local");
    });

    it("should return error without model name", async () => {
      const result = await handler.execute({ input: "info" }, {}, {});
      expect(result.success).toBe(false);
    });
  });

  describe("execute() - remove", () => {
    it("should remove a model", async () => {
      const { context } = createLocalContext({ status: "success" });
      const result = await handler.execute(
        { input: "remove llama3:8b" },
        context,
        {},
      );
      expect(result.success).toBe(true);
      expect(result.action).toBe("remove");
      expect(result.result.removed).toBe(true);
    });

    it("should return error without model name", async () => {
      const result = await handler.execute({ input: "remove" }, {}, {});
      expect(result.success).toBe(false);
    });
  });

  it("should return error for unknown action", async () => {
    const result = await handler.execute({ input: "update llama3" }, {}, {});
    expect(result.success).toBe(false);
    expect(result.error).toContain("Unknown action");
  });
});
