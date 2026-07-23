import { afterEach, describe, expect, it, vi } from "vitest";
import {
  _deps,
  getCurrentBranch,
  getRemoteUrl,
  parseGitHubRepo,
  preparePullRequest,
} from "../../src/lib/pr-create.js";

const ORIGINAL_EXEC_FILE_SYNC = _deps.execFileSync;

afterEach(() => {
  _deps.execFileSync = ORIGINAL_EXEC_FILE_SYNC;
});

describe("PR creation Git Broker boundary", () => {
  it("queries branch and remote through fixed Git argv", () => {
    _deps.execFileSync = vi
      .fn()
      .mockReturnValueOnce("feature/test\n")
      .mockReturnValueOnce("git@github.com:owner/repo.git\n")
      .mockReturnValueOnce("https://github.com/owner/repo.git\n");

    expect(getCurrentBranch()).toBe("feature/test");
    expect(getRemoteUrl()).toBe("git@github.com:owner/repo.git");
    expect(parseGitHubRepo()).toEqual({ owner: "owner", repo: "repo" });
    expect(_deps.execFileSync).toHaveBeenNthCalledWith(
      1,
      "git",
      ["rev-parse", "--abbrev-ref", "HEAD"],
      expect.objectContaining({
        origin: "pr:git",
        policy: "allow",
        scope: "pr",
        shell: false,
      }),
    );
  });

  it("keeps base and branch refs in one log-range argument", async () => {
    const branch = "feature/review; echo unsafe";
    const base = "main; shutdown";
    _deps.execFileSync = vi.fn((_command, args) => {
      if (args[0] === "rev-parse") return `${branch}\n`;
      if (args[0] === "remote") {
        return "https://github.com/chainlesschain/chainlesschain.git\n";
      }
      if (args[0] === "status") return " M src/file.js\n";
      if (args[0] === "log") return "abc123 fix: safe\n";
      throw new Error(`unexpected git args: ${args.join(" ")}`);
    });

    const result = await preparePullRequest({ base, skipStash: true });

    expect(result).toMatchObject({
      branch,
      base,
      hasUncommittedChanges: true,
      commitLog: "abc123 fix: safe\n",
    });
    expect(result.prUrl).toContain(encodeURIComponent(base));
    expect(result.prUrl).toContain(encodeURIComponent(branch));
    expect(_deps.execFileSync).toHaveBeenCalledWith(
      "git",
      ["log", "--oneline", "--end-of-options", `${base}...${branch}`, "--"],
      expect.objectContaining({ origin: "pr:git", shell: false }),
    );
  });

  it("keeps existing best-effort fallbacks when Git is unavailable", () => {
    _deps.execFileSync = vi.fn(() => {
      throw Object.assign(new Error("git missing"), { code: "ENOENT" });
    });

    expect(getCurrentBranch()).toBe("main");
    expect(getRemoteUrl()).toBeNull();
    expect(parseGitHubRepo()).toBeNull();
  });
});
