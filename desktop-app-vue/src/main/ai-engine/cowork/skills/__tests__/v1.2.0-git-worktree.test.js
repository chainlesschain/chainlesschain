/**
 * Unit tests for git-worktree-manager skill handler (v1.2.0)
 * Uses child_process.execSync - needs _deps injection
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const handler = require("../builtin/git-worktree-manager/handler.js");

describe("git-worktree-manager handler", () => {
  let mockExecSync;

  beforeEach(() => {
    vi.clearAllMocks();
    mockExecSync = vi.fn();
    if (handler._deps) {
      handler._deps.execSync = mockExecSync;
    }
  });

  describe("execute() - list action", () => {
    it("should list worktrees", async () => {
      if (handler._deps) {
        mockExecSync.mockReturnValue(
          "worktree /repo/main\nHEAD abc1234\nbranch refs/heads/main\n",
        );
      }
      const result = await handler.execute({ input: "list" }, {}, {});
      expect(result.success).toBe(true);
      expect(result.action).toBe("list");
    });

    it("should parse porcelain output", async () => {
      if (handler._deps) {
        mockExecSync.mockReturnValue(
          "worktree /repo/main\nHEAD abc1234\nbranch refs/heads/main\n\nworktree /repo/feat\nHEAD def5678\nbranch refs/heads/feat\n",
        );
        const result = await handler.execute({ input: "list" }, {}, {});
        expect(result.success).toBe(true);
        expect(result.worktrees.length).toBe(2);
      }
    });
  });

  describe("execute() - create action", () => {
    it("should create a worktree", async () => {
      if (handler._deps) {
        mockExecSync
          .mockReturnValueOnce("") // git rev-parse
          .mockReturnValueOnce(""); // git worktree add
        const result = await handler.execute(
          { input: "create feature/new-auth" },
          {},
          {},
        );
        expect(result.success).toBe(true);
        expect(result.action).toBe("create");
      }
    });
  });

  describe("execute() - remove action", () => {
    it("should remove a worktree", async () => {
      if (handler._deps) {
        mockExecSync.mockReturnValue("");
        const result = await handler.execute(
          { input: "remove feature/old-branch" },
          {},
          {},
        );
        expect(result.success).toBe(true);
        expect(result.action).toBe("remove");
      }
    });
  });

  describe("execute() - status action", () => {
    it("should return status of all worktrees", async () => {
      if (handler._deps) {
        mockExecSync
          .mockReturnValueOnce(
            "worktree /repo/main\nHEAD abc1234\nbranch refs/heads/main\n",
          )
          .mockReturnValueOnce(" M src/index.js");
        const result = await handler.execute({ input: "status" }, {}, {});
        expect(result.success).toBe(true);
        expect(result.action).toBe("status");
      }
    });
  });

  describe("execute() - prune action", () => {
    it("should prune stale worktrees", async () => {
      if (handler._deps) {
        mockExecSync.mockReturnValue("");
        const result = await handler.execute({ input: "prune" }, {}, {});
        expect(result.success).toBe(true);
        expect(result.action).toBe("prune");
      }
    });
  });

  describe("execute() - default behavior", () => {
    it("should default to list on empty input", async () => {
      if (handler._deps) {
        mockExecSync.mockReturnValue("");
      }
      const result = await handler.execute({ input: "" }, {}, {});
      expect(result.success).toBe(true);
      expect(result.action).toBe("list");
    });

    it("should default to list on missing input", async () => {
      if (handler._deps) {
        mockExecSync.mockReturnValue("");
      }
      const result = await handler.execute({}, {}, {});
      expect(result.success).toBe(true);
      expect(result.action).toBe("list");
    });

    it("should handle git command failure gracefully", async () => {
      if (handler._deps) {
        mockExecSync.mockImplementation(() => {
          throw new Error("fatal: not a git repository");
        });
        const result = await handler.execute({ input: "list" }, {}, {});
        expect(result.success).toBe(false);
      }
    });
  });
});
