/**
 * Unit tests for github-manager skill handler (v1.2.0)
 * Uses _deps injection for https mocking
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";

vi.mock("../../../../utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const handler = require("../builtin/github-manager/handler.js");

function mockHttpsRequest(statusCode, body) {
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

describe("github-manager handler", () => {
  const originalEnv = process.env.GITHUB_TOKEN;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GITHUB_TOKEN = "ghp_test_token_123";
  });

  afterEach(() => {
    if (originalEnv) {
      process.env.GITHUB_TOKEN = originalEnv;
    } else {
      delete process.env.GITHUB_TOKEN;
    }
  });

  describe("execute() - no token", () => {
    it("should return error without token", async () => {
      delete process.env.GITHUB_TOKEN;
      delete process.env.GH_TOKEN;
      const result = await handler.execute(
        { input: "list-issues owner/repo" },
        {},
        {},
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("GITHUB_TOKEN");
    });
  });

  describe("execute() - list-issues", () => {
    it("should list issues", async () => {
      if (handler._deps) {
        handler._deps.https = {
          request: mockHttpsRequest(200, [
            {
              number: 1,
              title: "Bug",
              state: "open",
              user: { login: "user1" },
              labels: [],
              created_at: "2026-01-01",
              updated_at: "2026-01-02",
              comments: 3,
              html_url: "https://github.com/o/r/issues/1",
            },
          ]),
        };
      }
      const result = await handler.execute(
        { input: "list-issues owner/repo" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.action).toBe("list-issues");
      expect(result.results.length).toBeGreaterThanOrEqual(0);
    });

    it("should return error for invalid repo format", async () => {
      if (handler._deps) {
        handler._deps.https = { request: mockHttpsRequest(200, []) };
      }
      const result = await handler.execute(
        { input: "list-issues badrepo" },
        {},
        {},
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid repository format");
    });
  });

  describe("execute() - create-issue", () => {
    it("should create an issue", async () => {
      if (handler._deps) {
        handler._deps.https = {
          request: mockHttpsRequest(201, {
            number: 42,
            title: "New Bug",
            html_url: "https://github.com/o/r/issues/42",
            state: "open",
          }),
        };
      }
      const result = await handler.execute(
        { input: "create-issue owner/repo title:'New Bug' body:'Description'" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.action).toBe("create-issue");
    });

    it("should return error without title", async () => {
      const result = await handler.execute(
        { input: "create-issue owner/repo" },
        {},
        {},
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("Title required");
    });
  });

  describe("execute() - repo-info", () => {
    it("should get repo info", async () => {
      if (handler._deps) {
        handler._deps.https = {
          request: mockHttpsRequest(200, {
            full_name: "owner/repo",
            description: "A test repo",
            language: "JavaScript",
            stargazers_count: 100,
            forks_count: 20,
            subscribers_count: 10,
            open_issues_count: 5,
            default_branch: "main",
            private: false,
            archived: false,
            license: { spdx_id: "MIT" },
            topics: ["test"],
            created_at: "2025-01-01",
            updated_at: "2026-01-01",
            pushed_at: "2026-01-01",
            size: 1024,
            html_url: "https://github.com/owner/repo",
          }),
        };
      }
      const result = await handler.execute(
        { input: "repo-info owner/repo" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.action).toBe("repo-info");
      expect(result.result.stars).toBe(100);
    });
  });

  describe("execute() - list-prs", () => {
    it("should list pull requests", async () => {
      if (handler._deps) {
        handler._deps.https = {
          request: mockHttpsRequest(200, [
            {
              number: 10,
              title: "Fix bug",
              state: "open",
              user: { login: "dev1" },
              head: { ref: "fix-branch" },
              base: { ref: "main" },
              draft: false,
              mergeable: true,
              created_at: "2026-01-01",
              updated_at: "2026-01-02",
              html_url: "https://github.com/o/r/pull/10",
            },
          ]),
        };
      }
      const result = await handler.execute(
        { input: "list-prs owner/repo" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.action).toBe("list-prs");
    });
  });

  describe("execute() - list-workflows", () => {
    it("should list workflow runs", async () => {
      if (handler._deps) {
        handler._deps.https = {
          request: mockHttpsRequest(200, {
            workflow_runs: [
              {
                id: 1,
                name: "CI",
                status: "completed",
                conclusion: "success",
                head_branch: "main",
                event: "push",
                actor: { login: "bot" },
                created_at: "2026-01-01T00:00:00Z",
                updated_at: "2026-01-01T00:05:00Z",
                html_url: "https://github.com/o/r/actions/1",
              },
            ],
          }),
        };
      }
      const result = await handler.execute(
        { input: "list-workflows owner/repo" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.action).toBe("list-workflows");
      expect(result.summary).toBeDefined();
    });
  });

  describe("execute() - unknown action", () => {
    it("should return error for unknown action", async () => {
      const result = await handler.execute(
        { input: "foobar owner/repo" },
        {},
        {},
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("Unknown action");
    });
  });
});
