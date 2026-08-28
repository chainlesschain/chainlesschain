/**
 * Unit tests for google-workspace skill handler (v1.2.0)
 * Uses _deps injection for https mocking
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "events";
import { createEnvironmentContext } from "./helpers/bundled-skill-environment.js";

vi.mock("../../../../utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const handler = require("../builtin/google-workspace/handler.js");

function mockGoogleRequest(statusCode, body) {
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
    return req;
  });
}

describe("google-workspace handler", () => {
  const apiKeyContext = createEnvironmentContext("google-workspace", {
    "google-api-key": "test-api-key-123",
  });
  const oauthContext = createEnvironmentContext("google-workspace", {
    "google-client-id": "id",
    "google-client-secret": "secret",
    "google-refresh-token": "refresh",
    "google-access-token": "test-token",
  });
  const missingContext = createEnvironmentContext("google-workspace");

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("execute() - no credentials", () => {
    it("should return error without credentials", async () => {
      const result = await handler.execute(
        { input: "calendar-list" },
        missingContext,
        {},
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("SecretStore");
    });
  });

  describe("execute() - calendar-list", () => {
    it("should list calendar events", async () => {
      if (handler._deps) {
        handler._deps.https = {
          request: mockGoogleRequest(200, {
            items: [
              {
                id: "ev1",
                summary: "Meeting",
                start: { dateTime: "2026-03-06T10:00:00Z" },
                end: { dateTime: "2026-03-06T11:00:00Z" },
                location: "Room A",
                status: "confirmed",
              },
            ],
          }),
        };
      }
      const result = await handler.execute(
        { input: "calendar-list" },
        apiKeyContext,
        {},
      );
      expect(result.success).toBe(true);
      expect(result.action).toBe("calendar-list");
      expect(result.results.length).toBeGreaterThan(0);
    });
  });

  describe("execute() - gmail-search", () => {
    it("should search gmail", async () => {
      if (handler._deps) {
        let callCount = 0;
        handler._deps.https = {
          request: vi.fn((opts, cb) => {
            callCount++;
            const body =
              callCount === 1
                ? { messages: [{ id: "msg1" }] }
                : {
                    payload: {
                      headers: [
                        { name: "Subject", value: "Test Email" },
                        { name: "From", value: "test@test.com" },
                        { name: "Date", value: "2026-01-01" },
                      ],
                    },
                    snippet: "Preview text",
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
            return req;
          }),
        };
      }
      const result = await handler.execute(
        { input: "gmail-search test query" },
        apiKeyContext,
        apiKeyContext,
      );
      expect(result.success).toBe(true);
      expect(result.action).toBe("gmail-search");
    });
  });

  describe("execute() - gmail-send", () => {
    it("should return error without OAuth for sending", async () => {
      if (handler._deps) {
        handler._deps.https = { request: mockGoogleRequest(200, {}) };
      }
      // API key mode cannot send email
      const result = await handler.execute(
        { input: "gmail-send to:test@test.com subject:Hello body:World" },
        apiKeyContext,
        {},
      );
      expect(result.success).toBe(false);
    });

    it("should return error without recipient", async () => {
      if (handler._deps) {
        handler._deps.https = {
          request: mockGoogleRequest(200, { access_token: "tok" }),
        };
      }
      const result = await handler.execute(
        { input: "gmail-send subject:Hello" },
        oauthContext,
        {},
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("Recipient required");
    });
  });

  describe("execute() - drive-list", () => {
    it("should list drive files", async () => {
      if (handler._deps) {
        handler._deps.https = {
          request: mockGoogleRequest(200, {
            files: [
              {
                id: "f1",
                name: "doc.pdf",
                mimeType: "application/pdf",
                size: "1024",
                modifiedTime: "2026-01-01",
              },
            ],
          }),
        };
      }
      const result = await handler.execute(
        { input: "drive-list" },
        apiKeyContext,
        {},
      );
      expect(result.success).toBe(true);
      expect(result.action).toBe("drive-list");
    });
  });

  describe("execute() - calendar-create", () => {
    it("should return error without OAuth for creating events", async () => {
      // API key mode
      const result = await handler.execute(
        { input: "calendar-create 'Team Meeting' 2026-03-07T10:00" },
        apiKeyContext,
        apiKeyContext,
      );
      expect(result.success).toBe(false);
    });
  });

  describe("execute() - unknown action", () => {
    it("should return error for unknown action", async () => {
      const result = await handler.execute(
        { input: "sheets-read data" },
        apiKeyContext,
        {},
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("Unknown action");
    });
  });
});
