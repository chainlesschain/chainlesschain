/**
 * Unit tests for api-gateway skill handler (v1.2.0)
 * Uses _deps injection for fs/https/http mocking
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "events";

vi.mock("../../../../utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const handler = require("../builtin/api-gateway/handler.js");

function createMockTransport(statusCode, body, headers = {}) {
  return {
    request: vi.fn((opts, cb) => {
      const res = new EventEmitter();
      res.statusCode = statusCode;
      res.headers = headers;
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
      req.setTimeout = vi.fn((ms, cb) => {});
      return req;
    }),
  };
}

describe("api-gateway handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    if (handler._resetState) {
      handler._resetState();
    }

    if (handler._deps) {
      const mockTransport = createMockTransport(200, { message: "ok" });
      handler._deps.https = mockTransport;
      handler._deps.http = mockTransport;
      handler._deps.fs = {
        existsSync: vi.fn().mockReturnValue(false),
        mkdirSync: vi.fn(),
        readFileSync: vi.fn().mockReturnValue("{}"),
        writeFileSync: vi.fn(),
      };
    }
  });

  describe("execute() - call action", () => {
    it("should make an API call", async () => {
      const result = await handler.execute(
        { input: "call GET https://api.example.com/v1/status" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.action).toBe("call");
      expect(result.result.statusCode).toBe(200);
      expect(result.result.duration).toBeDefined();
    });

    it("should return error without URL", async () => {
      const result = await handler.execute({ input: "call GET" }, {}, {});
      expect(result.success).toBe(false);
      expect(result.error).toContain("URL");
    });

    it("should return error for invalid URL", async () => {
      const result = await handler.execute(
        { input: "call GET not-a-url" },
        {},
        {},
      );
      expect(result.success).toBe(false);
    });

    it("should call registered API by name", async () => {
      // Register first — parseInput maps: name=parts[1], url=parts[2]
      await handler.execute(
        { input: "register myapi https://api.example.com/data" },
        {},
        {},
      );
      const result = await handler.execute({ input: "call GET myapi" }, {}, {});
      expect(result.success).toBe(true);
      expect(result.result.statusCode).toBe(200);
    });
  });

  describe("execute() - register action", () => {
    it("should register an API", async () => {
      // parseInput: name=parts[1], method=parts[1].toUpperCase(), url=parts[2]
      const result = await handler.execute(
        { input: "register testapi https://api.example.com/test" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.action).toBe("register");
      expect(result.result.name).toBe("testapi");
    });

    it("should return error without valid URL", async () => {
      const result = await handler.execute(
        { input: "register testapi not-url" },
        {},
        {},
      );
      expect(result.success).toBe(false);
    });

    it("should return error without name", async () => {
      const result = await handler.execute(
        { input: "register GET https://example.com" },
        {},
        {},
      );
      expect(result.success).toBe(false);
    });
  });

  describe("execute() - list action", () => {
    it("should list registered APIs", async () => {
      const result = await handler.execute({ input: "list" }, {}, {});
      expect(result.success).toBe(true);
      expect(result.action).toBe("list");
      expect(result.result.apis).toBeDefined();
    });

    it("should list registered APIs after registration", async () => {
      await handler.execute(
        { input: "register api1 https://example.com/1" },
        {},
        {},
      );
      await handler.execute(
        { input: "register api2 https://example.com/2" },
        {},
        {},
      );
      const result = await handler.execute({ input: "list" }, {}, {});
      expect(result.success).toBe(true);
      expect(result.result.total).toBe(2);
    });
  });

  describe("execute() - chain action", () => {
    it("should return error without steps", async () => {
      const result = await handler.execute({ input: "chain" }, {}, {});
      expect(result.success).toBe(false);
      expect(result.error).toContain("chain steps");
    });

    it("should return error for unregistered step", async () => {
      const result = await handler.execute(
        { input: "chain unknown-api -> another-api" },
        {},
        {},
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("not a registered API");
    });
  });

  describe("execute() - unknown action", () => {
    it("should return error for unknown action", async () => {
      const result = await handler.execute({ input: "delete myapi" }, {}, {});
      expect(result.success).toBe(false);
      expect(result.error).toContain("Unknown action");
    });
  });
});
