/**
 * Unit tests for free-model-manager skill handler (v1.2.0)
 * Uses _deps injection for http/https mocking
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "events";

vi.mock("../../../../utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const handler = require("../builtin/free-model-manager/handler.js");

function createMockTransport(statusCode, body) {
  return {
    request: vi.fn((opts, cb) => {
      const res = new EventEmitter();
      res.statusCode = statusCode;
      process.nextTick(() => {
        res.emit(
          "data",
          typeof body === "string" ? body : JSON.stringify(body),
        );
        res.emit("end");
      });
      if (cb) {
        cb(res);
      }
      const req = new EventEmitter();
      req.end = vi.fn();
      req.write = vi.fn();
      req.destroy = vi.fn();
      req.setTimeout = vi.fn();
      return req;
    }),
    get: vi.fn((url, opts, cb) => {
      if (typeof opts === "function") {
        cb = opts;
        opts = {};
      }
      const res = new EventEmitter();
      res.statusCode = statusCode;
      process.nextTick(() => {
        res.emit(
          "data",
          typeof body === "string" ? body : JSON.stringify(body),
        );
        res.emit("end");
      });
      if (cb) {
        cb(res);
      }
      const req = new EventEmitter();
      req.on = vi.fn().mockReturnThis();
      return req;
    }),
  };
}

describe("free-model-manager handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    if (handler._deps) {
      const mock = createMockTransport(200, { models: [] });
      handler._deps.http = mock;
      handler._deps.https = mock;
    }
  });

  describe("execute() - list-local", () => {
    it("should list local Ollama models", async () => {
      if (handler._deps) {
        handler._deps.http = createMockTransport(200, {
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
      }
      const result = await handler.execute({ input: "list-local" }, {}, {});
      expect(result.success).toBe(true);
      expect(result.action).toBe("list-local");
      expect(result.result.models.length).toBeGreaterThan(0);
      expect(result.result.models[0].name).toBe("llama3:8b");
    });

    it("should handle Ollama connection failure", async () => {
      if (handler._deps) {
        handler._deps.http = {
          request: vi.fn((opts, cb) => {
            const req = new EventEmitter();
            req.end = vi.fn();
            req.write = vi.fn();
            req.destroy = vi.fn();
            req.setTimeout = vi.fn();
            process.nextTick(() =>
              req.emit("error", new Error("ECONNREFUSED")),
            );
            return req;
          }),
        };
      }
      const result = await handler.execute({ input: "list-local" }, {}, {});
      expect(result.success).toBe(false);
      expect(result.error).toContain("Cannot connect to Ollama");
    });
  });

  describe("execute() - search", () => {
    it("should search catalog models", async () => {
      const result = await handler.execute({ input: "search code" }, {}, {});
      expect(result.success).toBe(true);
      expect(result.action).toBe("search");
      expect(result.result.results.length).toBeGreaterThan(0);
      // Should find code-related models in catalog
      const codeModels = result.result.results.filter(
        (m) => m.category === "code",
      );
      expect(codeModels.length).toBeGreaterThan(0);
    });

    it("should return error for empty query", async () => {
      const result = await handler.execute({ input: "search" }, {}, {});
      expect(result.success).toBe(false);
    });

    it("should search by model name", async () => {
      const result = await handler.execute({ input: "search llama" }, {}, {});
      expect(result.success).toBe(true);
      expect(result.result.results.some((m) => m.name.includes("llama"))).toBe(
        true,
      );
    });
  });

  describe("execute() - pull", () => {
    it("should pull a model", async () => {
      if (handler._deps) {
        handler._deps.http = createMockTransport(200, { status: "success" });
      }
      const result = await handler.execute({ input: "pull llama3:8b" }, {}, {});
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
      if (handler._deps) {
        handler._deps.http = createMockTransport(200, {
          modelfile: "FROM llama3",
          parameters: "num_ctx 4096",
          template: "{{ .Prompt }}",
          details: { family: "llama", parameter_size: "8B" },
          license: "MIT",
        });
      }
      const result = await handler.execute({ input: "info llama3:8b" }, {}, {});
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
      if (handler._deps) {
        handler._deps.http = createMockTransport(200, { status: "success" });
      }
      const result = await handler.execute(
        { input: "remove llama3:8b" },
        {},
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

  describe("execute() - unknown action", () => {
    it("should return error for unknown action", async () => {
      const result = await handler.execute({ input: "update llama3" }, {}, {});
      expect(result.success).toBe(false);
      expect(result.error).toContain("Unknown action");
    });
  });
});
