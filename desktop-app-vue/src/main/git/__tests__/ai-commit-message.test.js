const AICommitMessageGenerator = require("../ai-commit-message");

describe("AICommitMessageGenerator process boundary", () => {
  it("uses literal git argv for staged and working diffs", () => {
    const execFileSync = vi
      .fn()
      .mockReturnValueOnce("")
      .mockReturnValueOnce("diff --git a/a.js b/a.js");
    const generator = new AICommitMessageGenerator(null, { execFileSync });

    expect(generator.getGitDiff("C:/workspace")).toContain("diff --git");
    expect(execFileSync).toHaveBeenNthCalledWith(
      1,
      "git",
      ["diff", "--cached"],
      expect.objectContaining({
        cwd: "C:/workspace",
        origin: "desktop:ai-commit-message",
      }),
    );
    expect(execFileSync).toHaveBeenNthCalledWith(
      2,
      "git",
      ["diff"],
      expect.objectContaining({
        cwd: "C:/workspace",
        origin: "desktop:ai-commit-message",
      }),
    );
  });

  it("uses literal git argv for change statistics", () => {
    const execFileSync = vi.fn(() => "1 file changed");
    const generator = new AICommitMessageGenerator(null, { execFileSync });

    expect(generator.getChangeStats("C:/workspace")).toBe("1 file changed");
    expect(execFileSync).toHaveBeenCalledWith(
      "git",
      ["diff", "--stat"],
      expect.objectContaining({
        cwd: "C:/workspace",
        origin: "desktop:ai-commit-message",
      }),
    );
  });
});
