import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyTeamMergeReview,
  previewTeamMergeReview,
  rollbackTeamMergeReview,
  showTeamMergeReview,
} from "../../src/commands/team-merge-review.js";

const require = createRequire(import.meta.url);
const {
  parseMergeReview,
} = require("../../../vscode-extension/src/worktree-tasks.js");

const temporaryRoots = [];

function withGitEnvironment(values, callback) {
  const previous = new Map();
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, {
      present: Object.prototype.hasOwnProperty.call(process.env, key),
      value: process.env[key],
    });
    process.env[key] = value;
  }
  try {
    return callback();
  } finally {
    for (const [key, entry] of previous) {
      if (entry.present) process.env[key] = entry.value;
      else delete process.env[key];
    }
  }
}

function git(cwd, ...args) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !key.toUpperCase().startsWith("GIT_"),
    ),
  );
  return execFileSync("git", args, {
    cwd,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function write(repo, file, contents) {
  const target = path.join(repo, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents, "utf8");
}

function commit(repo, message) {
  git(repo, "add", "-A");
  git(repo, "commit", "-m", message);
  return git(repo, "rev-parse", "HEAD");
}

function createRepository() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-tmr-git-"));
  temporaryRoots.push(root);
  const repo = path.join(root, "repo");
  const stateDir = path.join(root, "state");
  fs.mkdirSync(repo, { recursive: true });
  git(repo, "init", "--initial-branch=main");
  git(repo, "config", "user.name", "Merge Review Test");
  git(repo, "config", "user.email", "merge-review@example.invalid");
  git(repo, "config", "core.autocrlf", "false");
  return { root, repo, stateDir };
}

function branchCommit(repo, branch, mutate) {
  git(repo, "switch", "-c", branch, "main");
  mutate();
  const oid = commit(repo, branch);
  git(repo, "switch", "main");
  return oid;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    const resolved = path.resolve(root);
    if (!resolved.startsWith(path.resolve(os.tmpdir()))) {
      throw new Error(`unsafe test cleanup target: ${resolved}`);
    }
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});

describe("team merge-review real Git transaction", { timeout: 60_000 }, () => {
  it("publishes a multi-branch file batch as one commit and rolls it back", () => {
    const { repo, stateDir } = createRepository();
    write(repo, "alpha.txt", "alpha base\n");
    write(repo, "beta.txt", "beta base\n");
    const baseOid = commit(repo, "base");
    branchCommit(repo, "agent/alpha", () => {
      write(repo, "alpha.txt", "alpha reviewed\n");
    });
    branchCommit(repo, "agent/beta", () => {
      write(repo, "beta.txt", "beta reviewed\n");
    });
    const executionMarker = path.join(path.dirname(repo), "git-hook-ran.txt");
    const hookPath = path.join(repo, ".git", "hooks", "post-merge");
    fs.writeFileSync(
      hookPath,
      `#!/bin/sh\nprintf invoked > '${executionMarker.replaceAll("\\", "/")}'\n`,
      "utf8",
    );
    fs.chmodSync(hookPath, 0o755);
    git(repo, "config", "core.fsmonitor", hookPath);
    git(repo, "config", "commit.gpgSign", "true");

    const { preview, applied } = withGitEnvironment(
      {
        GIT_CONFIG_COUNT: "1",
        GIT_CONFIG_KEY_0: "core.hooksPath",
        GIT_CONFIG_VALUE_0: path.join(repo, ".git", "hooks"),
        GIT_DIR: path.join(repo, ".git"),
        GIT_WORK_TREE: path.join(path.dirname(repo), "wrong-worktree"),
      },
      () => {
        const preview = previewTeamMergeReview({
          repoDir: repo,
          stateDir,
          branches: ["agent/alpha", "agent/beta"],
          createdAt: "2026-08-14T00:00:00.000Z",
        });
        expect(git(repo, "rev-parse", "main")).toBe(baseOid);
        const applied = applyTeamMergeReview({
          repoDir: repo,
          stateDir,
          id: preview.review.reviewId,
          revision: preview.review.revision,
          planDigest: preview.review.planDigest,
          fileIds: preview.review.files.map((file) => file.id),
          actor: "test-operator",
          reason: "accept two independent agent files",
        });
        return { preview, applied };
      },
    );
    expect(preview.review.files).toHaveLength(2);
    expect(
      parseMergeReview(JSON.stringify(preview), {
        expectedOperation: "preview",
      }).ok,
    ).toBe(true);

    expect(applied.review.state).toBe("published");
    expect(
      parseMergeReview(JSON.stringify(applied), {
        expectedOperation: "apply",
      }).ok,
    ).toBe(true);
    expect(fs.readFileSync(path.join(repo, "alpha.txt"), "utf8")).toBe(
      "alpha reviewed\n",
    );
    expect(fs.readFileSync(path.join(repo, "beta.txt"), "utf8")).toBe(
      "beta reviewed\n",
    );
    expect(git(repo, "rev-list", "--count", `${baseOid}..main`)).toBe("1");

    const rolledBack = rollbackTeamMergeReview({
      repoDir: repo,
      stateDir,
      id: applied.review.reviewId,
      revision: applied.review.revision,
      evidenceDigest: applied.review.evidenceDigest,
      confirm: applied.review.reviewId,
    });
    expect(rolledBack.review.state).toBe("rolled_back");
    expect(
      parseMergeReview(JSON.stringify(rolledBack), {
        expectedOperation: "rollback",
      }).ok,
    ).toBe(true);
    expect(git(repo, "rev-parse", "main^^")).toBe(baseOid);
    expect(git(repo, "rev-list", "--count", `${baseOid}..main`)).toBe("2");
    expect(git(repo, "diff", "--name-only", baseOid, "main")).toBe("");
    expect(fs.readFileSync(path.join(repo, "alpha.txt"), "utf8")).toBe(
      "alpha base\n",
    );
    expect(fs.readFileSync(path.join(repo, "beta.txt"), "utf8")).toBe(
      "beta base\n",
    );
    expect(fs.existsSync(executionMarker)).toBe(false);
  });

  it("applies one selected hunk and leaves an unselected hunk unchanged", () => {
    const { repo, stateDir } = createRepository();
    const baseLines = Array.from(
      { length: 30 },
      (_, index) => `line ${index + 1}`,
    );
    write(repo, "partial.txt", `${baseLines.join("\n")}\n`);
    commit(repo, "base");
    branchCommit(repo, "agent/partial", () => {
      const changed = [...baseLines];
      changed[1] = "line 2 reviewed";
      changed[27] = "line 28 reviewed";
      write(repo, "partial.txt", `${changed.join("\n")}\n`);
    });

    const preview = previewTeamMergeReview({
      repoDir: repo,
      stateDir,
      branches: ["agent/partial"],
      createdAt: "2026-08-14T00:00:01.000Z",
    });
    expect(preview.review.files[0].hunks).toHaveLength(2);
    const applied = applyTeamMergeReview({
      repoDir: repo,
      stateDir,
      id: preview.review.reviewId,
      revision: preview.review.revision,
      planDigest: preview.review.planDigest,
      hunkIds: [preview.review.files[0].hunks[0].id],
      actor: "test-operator",
      reason: "accept only the first reviewed hunk",
    });
    expect(applied.review.state).toBe("published");
    const result = fs.readFileSync(path.join(repo, "partial.txt"), "utf8");
    expect(result).toContain("line 2 reviewed");
    expect(result).toContain("line 28\n");
    expect(result).not.toContain("line 28 reviewed");
  });

  it("reports an explained conflict without advancing the base branch", () => {
    const { repo, stateDir } = createRepository();
    write(repo, "shared.txt", "shared base\n");
    const baseOid = commit(repo, "base");
    branchCommit(repo, "agent/left", () => {
      write(repo, "shared.txt", "left version\n");
    });
    branchCommit(repo, "agent/right", () => {
      write(repo, "shared.txt", "right version\n");
    });

    const preview = previewTeamMergeReview({
      repoDir: repo,
      stateDir,
      branches: ["agent/left", "agent/right"],
      createdAt: "2026-08-14T00:00:02.000Z",
    });
    const applied = applyTeamMergeReview({
      repoDir: repo,
      stateDir,
      id: preview.review.reviewId,
      revision: preview.review.revision,
      planDigest: preview.review.planDigest,
      fileIds: preview.review.files.map((file) => file.id),
      actor: "test-operator",
      reason: "exercise all-or-none conflict handling",
    });
    expect(applied.review.state).toBe("conflicted");
    expect(applied.review.conflicts).toEqual([
      expect.objectContaining({
        path: "shared.txt",
        type: expect.stringMatching(/conflict|rejected/u),
        explanation: expect.any(String),
        suggestion: expect.any(String),
      }),
    ]);
    expect(git(repo, "rev-parse", "main")).toBe(baseOid);
    expect(fs.readFileSync(path.join(repo, "shared.txt"), "utf8")).toBe(
      "shared base\n",
    );
    const persisted = showTeamMergeReview({
      repoDir: repo,
      stateDir,
      id: applied.review.reviewId,
    });
    expect(persisted.review.conflicts).toEqual(applied.review.conflicts);
  });

  it("keeps rename and mode metadata behind whole-file selection", () => {
    const { repo, stateDir } = createRepository();
    write(repo, "old-name.txt", "rename me\n");
    write(repo, "mode-and-content.txt", "mode base\n");
    commit(repo, "base");
    branchCommit(repo, "agent/file-metadata", () => {
      git(repo, "mv", "old-name.txt", "new-name.txt");
      write(repo, "mode-and-content.txt", "mode reviewed\n");
      // The shared commit helper stages again; keep worktree and index modes
      // aligned so Linux does not erase the executable bit during `git add -A`.
      fs.chmodSync(path.join(repo, "mode-and-content.txt"), 0o755);
      git(repo, "update-index", "--chmod=+x", "mode-and-content.txt");
    });

    const preview = previewTeamMergeReview({
      repoDir: repo,
      stateDir,
      branches: ["agent/file-metadata"],
      createdAt: "2026-08-14T00:00:03.000Z",
    });
    const renamed = preview.review.files.find(
      (file) => file.status === "renamed",
    );
    const modeChanged = preview.review.files.find(
      (file) => file.path === "mode-and-content.txt",
    );
    expect(renamed).toBeTruthy();
    expect(renamed.hunks).toEqual([]);
    expect(modeChanged).toBeTruthy();
    expect(modeChanged.hunks).toEqual([]);
  });

  it("rejects active repository filters before any selected patch is applied", () => {
    const { root, repo, stateDir } = createRepository();
    write(repo, "protected.txt", "filter base\n");
    commit(repo, "initial base");
    write(repo, ".gitattributes", "protected.txt filter=evil\n");
    const baseOid = commit(repo, "attribute base");
    branchCommit(repo, "agent/filter-target", () => {
      write(repo, "protected.txt", "filter reviewed\n");
    });
    const marker = path.join(root, "filter-ran.txt");
    git(
      repo,
      "config",
      "filter.evil.smudge",
      `sh -c "printf invoked > '${marker.replaceAll("\\", "/")}'"`,
    );

    const preview = previewTeamMergeReview({
      repoDir: repo,
      stateDir,
      branches: ["agent/filter-target"],
      createdAt: "2026-08-14T00:00:04.000Z",
    });
    expect(() =>
      applyTeamMergeReview({
        repoDir: repo,
        stateDir,
        id: preview.review.reviewId,
        revision: preview.review.revision,
        planDigest: preview.review.planDigest,
        fileIds: [preview.review.files[0].id],
        actor: "test-operator",
        reason: "filter execution must stay disabled",
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "TEAM_MERGE_REVIEW_GIT_DRIVER_UNSAFE",
      }),
    );
    expect(git(repo, "rev-parse", "main")).toBe(baseOid);
    expect(fs.existsSync(marker)).toBe(false);
  });
});
