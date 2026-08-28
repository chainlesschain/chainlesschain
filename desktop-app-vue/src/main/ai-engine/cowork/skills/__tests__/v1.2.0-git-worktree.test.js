/**
 * Unit tests for git-worktree-manager skill handler (v1.2.0)
 * Uses a branded process authority backed by a fake host adapter.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestProcessContext } from "./helpers/bundled-skill-process.js";

vi.mock("../../../../utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const handler = require("../builtin/git-worktree-manager/handler.js");

describe("git-worktree-manager handler", () => {
  let mockExecSync;
  let context;

  beforeEach(() => {
    vi.clearAllMocks();
    mockExecSync = vi.fn();
    context = {
      cwd: process.cwd(),
      ...createTestProcessContext("git-worktree-manager", mockExecSync),
    };
  });

  describe("execute() - list action", () => {
    it("should list worktrees", async () => {
      mockExecSync.mockReturnValue(
        "worktree /repo/main\nHEAD abc1234\nbranch refs/heads/main\n",
      );
      const result = await handler.execute({ input: "list" }, context, {});
      expect(result.success).toBe(true);
      expect(result.action).toBe("list");
    });

    it("should parse porcelain output", async () => {
      mockExecSync.mockReturnValue(
        "worktree /repo/main\nHEAD abc1234\nbranch refs/heads/main\n\nworktree /repo/feat\nHEAD def5678\nbranch refs/heads/feat\n",
      );
      const result = await handler.execute({ input: "list" }, context, {});
      expect(result.success).toBe(true);
      expect(result.worktrees.length).toBe(2);
    });
  });

  describe("execute() - create action", () => {
    it("should create a worktree", async () => {
      mockExecSync
        .mockReturnValueOnce("") // git rev-parse
        .mockReturnValueOnce(""); // git worktree add
      const result = await handler.execute(
        { input: "create feature/new-auth" },
        context,
        {},
      );
      expect(result.success).toBe(true);
      expect(result.action).toBe("create");
    });
  });

  describe("execute() - remove action", () => {
    it("should remove a worktree", async () => {
      mockExecSync.mockReturnValue("");
      const result = await handler.execute(
        { input: "remove feature/old-branch" },
        context,
        {},
      );
      expect(result.success).toBe(true);
      expect(result.action).toBe("remove");
    });
  });

  describe("execute() - status action", () => {
    it("should return status of all worktrees", async () => {
      mockExecSync
        .mockReturnValueOnce(
          "worktree /repo/main\nHEAD abc1234\nbranch refs/heads/main\n",
        )
        .mockReturnValueOnce(" M src/index.js");
      const result = await handler.execute({ input: "status" }, context, {});
      expect(result.success).toBe(true);
      expect(result.action).toBe("status");
    });
  });

  describe("execute() - prune action", () => {
    it("should prune stale worktrees", async () => {
      mockExecSync.mockReturnValue("");
      const result = await handler.execute({ input: "prune" }, context, {});
      expect(result.success).toBe(true);
      expect(result.action).toBe("prune");
    });
  });

  describe("execute() - default behavior", () => {
    it("should default to list on empty input", async () => {
      mockExecSync.mockReturnValue("");
      const result = await handler.execute({ input: "" }, context, {});
      expect(result.success).toBe(true);
      expect(result.action).toBe("list");
    });

    it("should default to list on missing input", async () => {
      mockExecSync.mockReturnValue("");
      const result = await handler.execute({}, context, {});
      expect(result.success).toBe(true);
      expect(result.action).toBe("list");
    });

    it("should handle git command failure gracefully", async () => {
      mockExecSync.mockImplementation(() => {
        throw new Error("fatal: not a git repository");
      });
      const result = await handler.execute({ input: "list" }, context, {});
      expect(result.success).toBe(false);
    });
  });
});
