import { describe, expect, it, vi } from "vitest";
import { verifyNpmReusedPackageTree } from "../../scripts/verify-npm-reused-package-tree.mjs";

const ANCHOR_COMMIT = "0123456789abcdef0123456789abcdef01234567";
const CURRENT_COMMIT = "89abcdef0123456789abcdef0123456789abcdef";
const TREE = "ab".repeat(20);

function evidence(overrides = {}) {
  return {
    anchorMode: "trusted-reuse",
    commit: ANCHOR_COMMIT,
    ref: "refs/tags/v-npm-1-2-2",
    ...overrides,
  };
}

function gitWithTrees(anchorTree = TREE, currentTree = TREE) {
  return vi.fn((args) => {
    if (args[0] === "fetch") return "";
    if (args[2] === "FETCH_HEAD^{commit}") return ANCHOR_COMMIT;
    if (args[2] === `${ANCHOR_COMMIT}:packages/agent-sdk`) {
      return anchorTree;
    }
    if (args[2] === `${CURRENT_COMMIT}:packages/agent-sdk`) {
      return currentTree;
    }
    throw new Error(`unexpected git invocation: ${args.join(" ")}`);
  });
}

describe("reused npm package source tree", () => {
  it("binds the signed tag to its commit and an unchanged current package tree", () => {
    const git = gitWithTrees();
    const result = verifyNpmReusedPackageTree(
      evidence(),
      CURRENT_COMMIT,
      "packages/agent-sdk",
      git,
    );

    expect(result.reuse).toEqual({
      packagePath: "packages/agent-sdk",
      anchorCommit: ANCHOR_COMMIT,
      anchorRef: "refs/tags/v-npm-1-2-2",
      anchorTree: TREE,
      currentCommit: CURRENT_COMMIT,
      currentTree: TREE,
    });
    expect(git).toHaveBeenCalledWith([
      "fetch",
      "--force",
      "--no-tags",
      "--depth=1",
      "origin",
      "refs/tags/v-npm-1-2-2",
    ]);
  });

  it("rejects a signed commit that does not own the signed tag", () => {
    const git = gitWithTrees();
    git
      .mockImplementationOnce(() => "")
      .mockImplementationOnce(() => "f".repeat(40));
    expect(() =>
      verifyNpmReusedPackageTree(
        evidence(),
        CURRENT_COMMIT,
        "packages/agent-sdk",
        git,
      ),
    ).toThrow(/does not match/);
  });

  it("rejects package source changes without a version bump", () => {
    const git = gitWithTrees(TREE, "cd".repeat(20));
    expect(() =>
      verifyNpmReusedPackageTree(
        evidence(),
        CURRENT_COMMIT,
        "packages/agent-sdk",
        git,
      ),
    ).toThrow(/bump the package version/);
  });

  it("rejects anchors outside immutable npm release tags", () => {
    expect(() =>
      verifyNpmReusedPackageTree(
        evidence({ ref: "refs/heads/main" }),
        CURRENT_COMMIT,
        "packages/agent-sdk",
        gitWithTrees(),
      ),
    ).toThrow(/immutable v-npm tag/);
  });
});
