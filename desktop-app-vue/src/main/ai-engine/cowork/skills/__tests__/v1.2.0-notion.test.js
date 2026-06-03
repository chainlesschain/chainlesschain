/**
 * Unit tests for notion skill handler (v1.2.0)
 * Uses _deps injection for https mocking
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";

vi.mock("../../../../utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const handler = require("../builtin/notion/handler.js");

function mockNotionRequest(statusCode, body) {
  return vi.fn((opts, cb) => {
    const res = new EventEmitter();
    res.statusCode = statusCode;
    process.nextTick(() => {
      res.emit("data", JSON.stringify(body));
      res.emit("end");
    });
    if (cb) {
      cb(res);
    }
    const req = new EventEmitter();
    req.end = vi.fn();
    req.write = vi.fn();
    req.setTimeout = vi.fn();
    return req;
  });
}

describe("notion handler", () => {
  const originalKey = process.env.NOTION_API_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NOTION_API_KEY = "ntn_test_key_123";
  });

  afterEach(() => {
    if (originalKey) {
      process.env.NOTION_API_KEY = originalKey;
    } else {
      delete process.env.NOTION_API_KEY;
    }
  });

  describe("execute() - no API key", () => {
    it("should return error without API key", async () => {
      delete process.env.NOTION_API_KEY;
      const result = await handler.execute({ input: "search test" }, {}, {});
      expect(result.success).toBe(false);
      expect(result.error).toContain("NOTION_API_KEY");
    });
  });

  describe("execute() - search", () => {
    it("should search pages", async () => {
      if (handler._deps) {
        handler._deps.https = {
          request: mockNotionRequest(200, {
            results: [
              {
                id: "page-1",
                object: "page",
                properties: { title: { title: [{ plain_text: "Test Page" }] } },
                url: "https://notion.so/test",
                last_edited_time: "2026-01-01",
              },
            ],
            has_more: false,
          }),
        };
      }
      const result = await handler.execute(
        { input: "search test query" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.action).toBe("search");
      expect(result.result.results.length).toBeGreaterThan(0);
    });

    it("should return error for empty query", async () => {
      const result = await handler.execute({ input: "search" }, {}, {});
      expect(result.success).toBe(false);
    });
  });

  describe("execute() - create-page", () => {
    it("should create a page", async () => {
      if (handler._deps) {
        // First call: search for default parent, Second call: create page
        let callCount = 0;
        handler._deps.https = {
          request: vi.fn((opts, cb) => {
            callCount++;
            const body =
              callCount === 1
                ? { results: [{ id: "parent-1" }], has_more: false }
                : {
                    id: "new-page-1",
                    url: "https://notion.so/new",
                    created_time: "2026-01-01",
                  };
            const res = new EventEmitter();
            res.statusCode = 200;
            process.nextTick(() => {
              res.emit("data", JSON.stringify(body));
              res.emit("end");
            });
            if (cb) {
              cb(res);
            }
            const req = new EventEmitter();
            req.end = vi.fn();
            req.write = vi.fn();
            req.setTimeout = vi.fn();
            return req;
          }),
        };
      }
      const result = await handler.execute(
        { input: "create-page 'My New Page'" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.action).toBe("create-page");
    });

    it("should return error without title", async () => {
      const result = await handler.execute({ input: "create-page" }, {}, {});
      expect(result.success).toBe(false);
    });
  });

  describe("execute() - get-page", () => {
    it("should get page details", async () => {
      if (handler._deps) {
        let callCount = 0;
        handler._deps.https = {
          request: vi.fn((opts, cb) => {
            callCount++;
            const body =
              callCount === 1
                ? {
                    id: "page-1",
                    properties: {
                      title: { title: [{ plain_text: "My Page" }] },
                    },
                    url: "https://notion.so/p",
                    created_time: "2026-01-01",
                    last_edited_time: "2026-01-02",
                  }
                : {
                    results: [
                      {
                        id: "block-1",
                        type: "paragraph",
                        paragraph: { rich_text: [{ plain_text: "Hello" }] },
                        has_children: false,
                      },
                    ],
                  };
            const res = new EventEmitter();
            res.statusCode = 200;
            process.nextTick(() => {
              res.emit("data", JSON.stringify(body));
              res.emit("end");
            });
            if (cb) {
              cb(res);
            }
            const req = new EventEmitter();
            req.end = vi.fn();
            req.write = vi.fn();
            req.setTimeout = vi.fn();
            return req;
          }),
        };
      }
      const result = await handler.execute(
        { input: "get-page page-1" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.action).toBe("get-page");
      expect(result.result.blocks.length).toBeGreaterThan(0);
    });

    it("should return error without page ID", async () => {
      const result = await handler.execute({ input: "get-page" }, {}, {});
      expect(result.success).toBe(false);
    });
  });

  describe("execute() - query-db", () => {
    it("should query a database", async () => {
      if (handler._deps) {
        handler._deps.https = {
          request: mockNotionRequest(200, {
            results: [
              {
                id: "row-1",
                properties: {
                  Name: { type: "title", title: [{ plain_text: "Item" }] },
                },
                url: "https://notion.so/r",
                last_edited_time: "2026-01-01",
              },
            ],
            has_more: false,
          }),
        };
      }
      const result = await handler.execute(
        { input: "query-db db-id-123" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.action).toBe("query-db");
      expect(result.result.rows.length).toBeGreaterThan(0);
    });

    it("should return error without database ID", async () => {
      const result = await handler.execute({ input: "query-db" }, {}, {});
      expect(result.success).toBe(false);
    });
  });

  describe("execute() - unknown action", () => {
    it("should return error for unknown action", async () => {
      const result = await handler.execute(
        { input: "delete-page abc" },
        {},
        {},
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("Unknown action");
    });
  });
});
