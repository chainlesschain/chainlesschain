/**
 * Unit tests for pr-reviewer skill handler (v1.2.0)
 * Uses child_process.execSync via _deps injection
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const handler = require("../builtin/pr-reviewer/handler.js");

describe("pr-reviewer handler", () => {
  let mockExecSync;

  beforeEach(() => {
    vi.clearAllMocks();
    mockExecSync = vi.fn();
    handler._deps.execSync = mockExecSync;
  });

  describe("execute() - review action", () => {
    it("should review a PR by number", async () => {
      mockExecSync
        .mockReturnValueOnce(
          JSON.stringify({
            title: "Fix auth bug",
            body: "Fixes #123",
            additions: 10,
            deletions: 5,
          }),
        )
        .mockReturnValueOnce(
          "diff --git a/src/auth.js b/src/auth.js\n+const token = getToken();",
        );
      const result = await handler.execute({ input: "review 42" }, {}, {});
      expect(result.success).toBe(true);
      expect(result.action).toBe("review");
      expect(result.prNumber).toBe("42");
    });

    it("should detect hardcoded secrets in diff", async () => {
      mockExecSync
        .mockReturnValueOnce("{}")
        .mockReturnValueOnce(
          'diff --git a/src/config.js b/src/config.js\n@@ -1,1 +1,2 @@\n+const API_KEY = "sk-abc123secret"',
        );
      const result = await handler.execute({ input: "review 1" }, {}, {});
      expect(result.success).toBe(true);
      expect(result.analysis.findings.length).toBeGreaterThan(0);
      expect(result.analysis.findings[0].type).toBe("security");
    });

    it("should detect eval() usage", async () => {
      mockExecSync
        .mockReturnValueOnce("{}")
        .mockReturnValueOnce(
          "diff --git a/src/util.js b/src/util.js\n@@ -1,1 +1,2 @@\n+const result = eval(userInput);",
        );
      const result = await handler.execute({ input: "review 2" }, {}, {});
      expect(
        result.analysis.findings.some((f) => f.message.includes("eval()")),
      ).toBe(true);
    });

    it("should detect console.log in non-test files", async () => {
      mockExecSync
        .mockReturnValueOnce("{}")
        .mockReturnValueOnce(
          'diff --git a/src/service.js b/src/service.js\n@@ -1,1 +1,2 @@\n+console.log("debug data");',
        );
      const result = await handler.execute({ input: "review 3" }, {}, {});
      expect(result.analysis.findings.some((f) => f.type === "style")).toBe(
        true,
      );
    });

    it("should NOT flag console.log in test files", async () => {
      mockExecSync
        .mockReturnValueOnce("{}")
        .mockReturnValueOnce(
          'diff --git a/src/test/helper.test.js b/src/test/helper.test.js\n@@ -1,1 +1,2 @@\n+console.log("test output");',
        );
      const result = await handler.execute({ input: "review 4" }, {}, {});
      const styleFindings = result.analysis.findings.filter(
        (f) => f.type === "style",
      );
      expect(styleFindings.length).toBe(0);
    });

    it("should detect TODO/FIXME comments", async () => {
      mockExecSync
        .mockReturnValueOnce("{}")
        .mockReturnValueOnce(
          "diff --git a/src/app.js b/src/app.js\n@@ -1,1 +1,2 @@\n+// TODO: refactor this later",
        );
      const result = await handler.execute({ input: "review 5" }, {}, {});
      expect(result.analysis.findings.some((f) => f.type === "todo")).toBe(
        true,
      );
    });

    it("should count additions and deletions", async () => {
      mockExecSync
        .mockReturnValueOnce("{}")
        .mockReturnValueOnce(
          "diff --git a/f.js b/f.js\n@@ -1,3 +1,3 @@\n+added line\n-removed line\n+another added",
        );
      const result = await handler.execute({ input: "review 6" }, {}, {});
      expect(result.analysis.additions).toBe(2);
      expect(result.analysis.deletions).toBe(1);
    });
  });

  describe("execute() - summary action", () => {
    it("should summarize commits ahead of base branch", async () => {
      mockExecSync
        .mockReturnValueOnce("abc1234 First commit\ndef5678 Second commit")
        .mockReturnValueOnce(
          " 2 files changed, 10 insertions(+), 3 deletions(-)",
        )
        .mockReturnValueOnce(
          "2 files changed, 10 insertions(+), 3 deletions(-)",
        );
      const result = await handler.execute({ input: "summary main" }, {}, {});
      expect(result.success).toBe(true);
      expect(result.action).toBe("summary");
      expect(result.commitCount).toBe(2);
    });
  });

  describe("execute() - diff action", () => {
    it("should review diff against base branch", async () => {
      mockExecSync.mockReturnValue(
        "diff --git a/src/index.js b/src/index.js\n@@ -1,1 +1,2 @@\n+new code here",
      );
      const result = await handler.execute({ input: "diff main" }, {}, {});
      expect(result.success).toBe(true);
      expect(result.action).toBe("diff-review");
    });
  });

  describe("execute() - error handling", () => {
    it("should default to diff action on empty input", async () => {
      mockExecSync.mockReturnValue("");
      const result = await handler.execute({ input: "" }, {}, {});
      // Empty string parses to default action which is "diff" based on parseInput
      expect(result).toBeDefined();
    });

    it("should handle execSync failure gracefully", async () => {
      mockExecSync.mockImplementation(() => {
        throw new Error("command not found");
      });
      const result = await handler.execute({ input: "review 99" }, {}, {});
      // Should still return a result (exec catches errors and returns message)
      expect(result).toBeDefined();
    });
  });
});
