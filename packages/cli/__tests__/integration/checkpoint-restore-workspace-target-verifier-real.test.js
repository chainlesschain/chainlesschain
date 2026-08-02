import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createCheckpoint as createGitCheckpoint,
  statusAgainst as gitStatusAgainst,
} from "../../src/lib/checkpoint-store.js";
import {
  computeCheckpointIdentity,
  createCheckpoint as createCopyCheckpoint,
  diffCheckpoint as diffCopyCheckpoint,
} from "../../src/lib/file-checkpoint.js";
import { computeCheckpointRestoreDigest } from "../../src/lib/checkpoint-restore-orchestrator.js";
import {
  CHECKPOINT_RESTORE_WORKSPACE_TARGET_ERROR_CODES,
  CheckpointRestoreWorkspaceTargetVerifier,
} from "../../src/lib/checkpoint-restore-workspace-target-verifier.js";

function git(repo, ...args) {
  const result = spawnSync("git", args, {
    cwd: repo,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || `git ${args.join(" ")} failed`);
  }
  return String(result.stdout || "").trim();
}

function expectedAuthority({
  operationId,
  restoreKind,
  checkpointNamespace,
  status,
}) {
  const binding = status.workspaceBinding;
  return {
    operationId,
    restoreKind,
    checkpointNamespace,
    checkpointId: status.id,
    checkpointIdentity: status.checkpointIdentity,
    workspaceScopeIdentity: binding.scopeIdentity,
    workspaceTargetPoststateIdentity: binding.targetPoststateIdentity,
    poststateDigest: computeCheckpointRestoreDigest(
      "cc-checkpoint-restore-poststate-v1",
      {
        engine: restoreKind,
        scopeIdentity: binding.scopeIdentity,
        stateIdentity: binding.targetPoststateIdentity,
      },
    ),
  };
}

function request(operationId, workspaceRoot, expected) {
  return {
    operationId,
    workspaceRoot,
    workspaceLease: { assertOwned: vi.fn() },
    expected,
  };
}

describe.sequential(
  "CheckpointRestoreWorkspaceTargetVerifier real engines",
  () => {
    let testRoot;
    let previousHome;

    beforeEach(() => {
      testRoot = mkdtempSync(join(tmpdir(), "cc-restore-target-real-"));
      previousHome = process.env.CHAINLESSCHAIN_HOME;
      process.env.CHAINLESSCHAIN_HOME = join(testRoot, "private-home");
    });

    afterEach(() => {
      if (previousHome === undefined) delete process.env.CHAINLESSCHAIN_HOME;
      else process.env.CHAINLESSCHAIN_HOME = previousHome;
      rmSync(testRoot, { recursive: true, force: true });
    });

    it("verifies and then rejects drift through the real Git status planner", () => {
      const workspaceRoot = join(testRoot, "git-workspace");
      const session = "workspace-target-real";
      const operationId = "restore_target_real_git";
      git(testRoot, "init", "-q", workspaceRoot);
      git(workspaceRoot, "config", "user.email", "test@chainlesschain.local");
      git(workspaceRoot, "config", "user.name", "ChainlessChain Test");
      git(workspaceRoot, "config", "core.autocrlf", "false");
      writeFileSync(join(workspaceRoot, "target.txt"), "checkpoint\n", "utf8");
      git(workspaceRoot, "add", "-A");
      git(workspaceRoot, "commit", "-q", "-m", "checkpoint target");

      const checkpoint = createGitCheckpoint(workspaceRoot, {
        session,
        label: "real-verifier",
      });
      const status = gitStatusAgainst(workspaceRoot, checkpoint.id, {
        session,
        expectedIdentity: `git:${checkpoint.commit}`,
      });
      const expected = expectedAuthority({
        operationId,
        restoreKind: "git",
        checkpointNamespace: session,
        status: { ...status, id: checkpoint.id },
      });
      const verifier = new CheckpointRestoreWorkspaceTargetVerifier();
      const input = request(operationId, workspaceRoot, expected);

      expect(verifier.verify(input)).toMatchObject({
        verified: true,
        exact: true,
        restoreKind: "git",
        checkpointNamespace: session,
        checkpointIdentity: `git:${checkpoint.commit}`,
      });
      expect(input.workspaceLease.assertOwned).toHaveBeenCalledTimes(3);

      writeFileSync(join(workspaceRoot, "target.txt"), "drifted\n", "utf8");
      expect(() => verifier.verify(input)).toThrow(
        expect.objectContaining({
          code: CHECKPOINT_RESTORE_WORKSPACE_TARGET_ERROR_CODES.CONFLICT,
        }),
      );
    }, 60_000);

    it("verifies and then rejects drift through the real copy diff planner", () => {
      const workspaceRoot = join(testRoot, "copy-workspace");
      const operationId = "restore_target_real_copy";
      mkdirSync(workspaceRoot, { recursive: true });
      writeFileSync(join(workspaceRoot, "target.txt"), "checkpoint\n", "utf8");

      const checkpoint = createCopyCheckpoint(["target.txt"], {
        cwd: workspaceRoot,
        label: "real-verifier",
      });
      const checkpointIdentity = computeCheckpointIdentity(checkpoint);
      const status = diffCopyCheckpoint(checkpoint.id, {
        cwd: workspaceRoot,
        expectedIdentity: checkpointIdentity,
      });
      const expected = expectedAuthority({
        operationId,
        restoreKind: "copy",
        checkpointNamespace: null,
        status: {
          ...status,
          id: checkpoint.id,
          checkpointIdentity,
        },
      });
      const verifier = new CheckpointRestoreWorkspaceTargetVerifier();
      const input = request(operationId, workspaceRoot, expected);

      expect(verifier.verify(input)).toMatchObject({
        verified: true,
        exact: true,
        restoreKind: "copy",
        checkpointNamespace: null,
        checkpointIdentity,
      });
      expect(readFileSync(join(workspaceRoot, "target.txt"), "utf8")).toBe(
        "checkpoint\n",
      );

      writeFileSync(join(workspaceRoot, "target.txt"), "drifted\n", "utf8");
      expect(() => verifier.verify(input)).toThrow(
        expect.objectContaining({
          code: CHECKPOINT_RESTORE_WORKSPACE_TARGET_ERROR_CODES.CONFLICT,
        }),
      );
    }, 60_000);
  },
);
