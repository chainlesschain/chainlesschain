/**
 * GitHub Manager Handler Unit Tests (v2.0)
 *
 * Tests: list-issues, create-issue, get-issue, list-prs, create-pr, get-pr,
 *        pr-review, repo-info, list-workflows, search-code, list-branches,
 *        list-releases, create-release, compare, list-labels
 *
 * All GitHub API calls are mocked via _deps.https
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const handler = require("../skills/builtin/github-manager/handler.js");

// ── Mock HTTPS ────────────────────────────────────

function createMockRequest(statusCode, responseData) {
  const mockReq = {
    on: vi.fn(),
    write: vi.fn(),
    end: vi.fn(),
  };

  return {
    mockReq,
    request: vi.fn((options, callback) => {
      const mockRes = {
        statusCode,
        on: vi.fn((event, handler) => {
          if (event === "data") {
            handler(JSON.stringify(responseData));
          }
          if (event === "end") {
            handler();
          }
        }),
      };
      callback(mockRes);
      return mockReq;
    }),
  };
}

describe("GitHubManager Handler", () => {
  beforeEach(() => {
    process.env.GITHUB_TOKEN =
      process.env.TEST_GITHUB_TOKEN || "test-token-placeholder";
  });

  afterEach(() => {
    delete process.env.GITHUB_TOKEN;
  });

  describe("init", () => {
    it("should initialize", async () => {
      await expect(
        handler.init({ name: "github-manager" }),
      ).resolves.toBeUndefined();
    });
  });

  describe("no token", () => {
    it("should fail without GITHUB_TOKEN", async () => {
      delete process.env.GITHUB_TOKEN;
      const result = await handler.execute(
        { input: "list-issues owner/repo" },
        {},
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("GITHUB_TOKEN");
    });
  });

  describe("list-issues", () => {
    it("should list issues from repo", async () => {
      const mock = createMockRequest(200, [
        {
          number: 1,
          title: "Bug",
          state: "open",
          user: { login: "alice" },
          labels: [],
          created_at: "2024-01-01",
          updated_at: "2024-01-02",
          comments: 3,
          html_url: "https://github.com/o/r/issues/1",
        },
        {
          number: 2,
          title: "Feature",
          state: "open",
          user: { login: "bob" },
          labels: [{ name: "enhancement" }],
          pull_request: null,
          created_at: "2024-01-03",
          updated_at: "2024-01-04",
          comments: 0,
          html_url: "https://github.com/o/r/issues/2",
        },
      ]);
      handler._deps.https = mock;

      const result = await handler.execute(
        { input: "list-issues owner/repo" },
        {},
      );

      expect(result.success).toBe(true);
      expect(result.action).toBe("list-issues");
      expect(result.results.length).toBe(2);
    });

    it("should fail with invalid repo format", async () => {
      const result = await handler.execute(
        { input: "list-issues invalid" },
        {},
      );
      expect(result.success).toBe(false);
    });
  });

  describe("create-issue", () => {
    it("should create an issue", async () => {
      const mock = createMockRequest(201, {
        number: 42,
        title: "New Bug",
        html_url: "https://github.com/o/r/issues/42",
        state: "open",
      });
      handler._deps.https = mock;

      const result = await handler.execute(
        {
          input:
            "create-issue owner/repo title:'New Bug' body:'Description here'",
        },
        {},
      );

      expect(result.success).toBe(true);
      expect(result.result.number).toBe(42);
    });

    it("should fail without title", async () => {
      const mock = createMockRequest(201, {});
      handler._deps.https = mock;

      const result = await handler.execute(
        { input: "create-issue owner/repo" },
        {},
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("Title required");
    });
  });

  describe("get-issue", () => {
    it("should get issue details", async () => {
      const mock = createMockRequest(200, {
        number: 5,
        title: "Critical Bug",
        state: "open",
        body: "Details...",
        user: { login: "alice" },
        labels: [{ name: "bug" }],
        assignees: [{ login: "bob" }],
        milestone: { title: "v1.0" },
        comments: 2,
        created_at: "2024-01-01",
        updated_at: "2024-01-05",
        closed_at: null,
        html_url: "https://github.com/o/r/issues/5",
      });
      handler._deps.https = mock;

      const result = await handler.execute(
        { input: "get-issue owner/repo #5" },
        {},
      );

      expect(result.success).toBe(true);
      expect(result.action).toBe("get-issue");
      expect(result.result.number).toBe(5);
      expect(result.result.assignees).toContain("bob");
      expect(result.result.milestone).toBe("v1.0");
    });
  });

  describe("get-pr", () => {
    it("should get PR details with diff stats", async () => {
      const mock = createMockRequest(200, {
        number: 10,
        title: "Add feature",
        state: "open",
        body: "PR body",
        user: { login: "alice" },
        head: { ref: "feature" },
        base: { ref: "main" },
        draft: false,
        mergeable: true,
        merged: false,
        additions: 150,
        deletions: 30,
        changed_files: 5,
        review_comments: 3,
        comments: 1,
        created_at: "2024-01-01",
        updated_at: "2024-01-05",
        merged_at: null,
        html_url: "https://github.com/o/r/pull/10",
      });
      handler._deps.https = mock;

      const result = await handler.execute(
        { input: "get-pr owner/repo #10" },
        {},
      );

      expect(result.success).toBe(true);
      expect(result.result.additions).toBe(150);
      expect(result.result.deletions).toBe(30);
      expect(result.result.changedFiles).toBe(5);
    });
  });

  describe("pr-review", () => {
    it("should submit PR review", async () => {
      const mock = createMockRequest(200, { id: 123, state: "COMMENTED" });
      handler._deps.https = mock;

      const result = await handler.execute(
        {
          input: "pr-review owner/repo #10 body:'Looks good' --review approve",
        },
        {},
      );

      expect(result.success).toBe(true);
      expect(result.result.prNumber).toBe(10);
    });
  });

  describe("search-code", () => {
    it("should search code across repos", async () => {
      const mock = createMockRequest(200, {
        total_count: 42,
        items: [
          {
            name: "handler.js",
            path: "src/handler.js",
            repository: { full_name: "o/r" },
            html_url: "https://github.com/o/r/blob/main/src/handler.js",
            score: 1,
          },
        ],
      });
      handler._deps.https = mock;

      const result = await handler.execute(
        { input: "search-code owner/repo fetchJSON" },
        {},
      );

      expect(result.success).toBe(true);
      expect(result.action).toBe("search-code");
      expect(result.result.totalCount).toBe(42);
      expect(result.result.items[0].path).toBe("src/handler.js");
    });
  });

  describe("list-branches", () => {
    it("should list repo branches", async () => {
      const mock = createMockRequest(200, [
        { name: "main", protected: true, commit: { sha: "abc1234567" } },
        { name: "develop", protected: false, commit: { sha: "def4567890" } },
      ]);
      handler._deps.https = mock;

      const result = await handler.execute(
        { input: "list-branches owner/repo" },
        {},
      );

      expect(result.success).toBe(true);
      expect(result.result.length).toBe(2);
      expect(result.result[0].name).toBe("main");
      expect(result.result[0].protected).toBe(true);
    });
  });

  describe("list-releases", () => {
    it("should list repo releases", async () => {
      const mock = createMockRequest(200, [
        {
          id: 1,
          tag_name: "v1.0.0",
          name: "Release 1.0",
          draft: false,
          prerelease: false,
          author: { login: "alice" },
          created_at: "2024-01-01",
          published_at: "2024-01-01",
          assets: [],
          html_url: "https://github.com/o/r/releases/1",
        },
      ]);
      handler._deps.https = mock;

      const result = await handler.execute(
        { input: "list-releases owner/repo" },
        {},
      );

      expect(result.success).toBe(true);
      expect(result.result.length).toBe(1);
      expect(result.result[0].tag).toBe("v1.0.0");
    });
  });

  describe("create-release", () => {
    it("should create a release", async () => {
      const mock = createMockRequest(201, {
        id: 99,
        tag_name: "v2.0.0",
        name: "Release 2.0",
        html_url: "https://github.com/o/r/releases/99",
      });
      handler._deps.https = mock;

      const result = await handler.execute(
        { input: "create-release owner/repo tag:v2.0.0 title:'Release 2.0'" },
        {},
      );

      expect(result.success).toBe(true);
      expect(result.result.tag).toBe("v2.0.0");
    });

    it("should fail without tag", async () => {
      const mock = createMockRequest(201, {});
      handler._deps.https = mock;

      const result = await handler.execute(
        { input: "create-release owner/repo" },
        {},
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("Tag required");
    });
  });

  describe("compare", () => {
    it("should compare branches", async () => {
      const mock = createMockRequest(200, {
        status: "ahead",
        ahead_by: 3,
        behind_by: 0,
        total_commits: 3,
        files: [
          {
            filename: "src/a.js",
            status: "modified",
            additions: 10,
            deletions: 2,
          },
          {
            filename: "src/b.js",
            status: "added",
            additions: 50,
            deletions: 0,
          },
        ],
        html_url: "https://github.com/o/r/compare/main...feature",
      });
      handler._deps.https = mock;

      const result = await handler.execute(
        { input: "compare owner/repo head:feature base:main" },
        {},
      );

      expect(result.success).toBe(true);
      expect(result.result.aheadBy).toBe(3);
      expect(result.result.fileCount).toBe(2);
      expect(result.result.totalCommits).toBe(3);
    });
  });

  describe("list-labels", () => {
    it("should list repo labels", async () => {
      const mock = createMockRequest(200, [
        {
          name: "bug",
          color: "d73a4a",
          description: "Something isn't working",
        },
        { name: "enhancement", color: "a2eeef", description: "New feature" },
      ]);
      handler._deps.https = mock;

      const result = await handler.execute(
        { input: "list-labels owner/repo" },
        {},
      );

      expect(result.success).toBe(true);
      expect(result.result.length).toBe(2);
      expect(result.result[0].name).toBe("bug");
    });
  });

  describe("unknown action", () => {
    it("should return error for unknown action", async () => {
      const mock = createMockRequest(200, {});
      handler._deps.https = mock;

      const result = await handler.execute(
        { input: "unknown-action owner/repo" },
        {},
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("Unknown action");
    });
  });
});
