import { afterEach, describe, expect, it, vi } from "vitest";
import {
  _deps,
  buildGitDiffArgs,
  getChangedFiles,
  getGitDiff,
  runCodeReview,
} from "../../src/lib/code-review.js";

const ORIGINAL_EXEC_FILE_SYNC = _deps.execFileSync;

afterEach(() => {
  _deps.execFileSync = ORIGINAL_EXEC_FILE_SYNC;
});

describe("code review Git Broker boundary", () => {
  it("keeps supported staged aliases while bounding revision options", () => {
    expect(buildGitDiffArgs()).toEqual(["diff", "--staged"]);
    expect(buildGitDiffArgs("--cached", { nameOnly: true })).toEqual([
      "diff",
      "--name-only",
      "--cached",
    ]);
    expect(buildGitDiffArgs("main; echo unsafe")).toEqual([
      "diff",
      "--end-of-options",
      "main; echo unsafe",
      "--",
    ]);
  });

  it("passes the review target as one argv value", () => {
    const target = "main...feature/review; shutdown";
    _deps.execFileSync = vi
      .fn()
      .mockReturnValueOnce("diff output")
      .mockReturnValueOnce("src/a.js\nsrc/b.js\n");

    expect(getGitDiff(target)).toBe("diff output");
    expect(getChangedFiles(target)).toEqual(["src/a.js", "src/b.js"]);
    expect(_deps.execFileSync).toHaveBeenNthCalledWith(
      1,
      "git",
      ["diff", "--end-of-options", target, "--"],
      expect.objectContaining({
        origin: "review:git-diff",
        policy: "allow",
        scope: "review",
        shell: false,
      }),
    );
    expect(_deps.execFileSync).toHaveBeenNthCalledWith(
      2,
      "git",
      ["diff", "--name-only", "--end-of-options", target, "--"],
      expect.objectContaining({ shell: false }),
    );
  });

  it("prepares a review from Broker-provided diff and file data", async () => {
    _deps.execFileSync = vi
      .fn()
      .mockReturnValueOnce("diff --git a/a.js b/a.js\n")
      .mockReturnValueOnce("a.js\n");

    await expect(runCodeReview({ target: "HEAD~1" })).resolves.toMatchObject({
      reviewed: true,
      files: ["a.js"],
    });
  });

  it("keeps best-effort empty results when Git is unavailable", () => {
    _deps.execFileSync = vi.fn(() => {
      throw Object.assign(new Error("git missing"), { code: "ENOENT" });
    });

    expect(getGitDiff()).toBe("");
    expect(getChangedFiles()).toEqual([]);
  });
});
