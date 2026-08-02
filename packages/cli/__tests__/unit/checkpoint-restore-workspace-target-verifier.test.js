import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { computeCheckpointRestoreDigest } from "../../src/lib/checkpoint-restore-orchestrator.js";
import {
  CHECKPOINT_RESTORE_WORKSPACE_TARGET_ERROR_CODES,
  CHECKPOINT_RESTORE_WORKSPACE_TARGET_VERIFICATION_SCHEMA,
  CHECKPOINT_RESTORE_WORKSPACE_TARGET_VERIFICATION_VERSION,
  CheckpointRestoreWorkspaceTargetVerifier,
} from "../../src/lib/checkpoint-restore-workspace-target-verifier.js";

const OPERATION_ID = "restore_target_verify_1";
const WORKSPACE_ROOT = path.resolve("fixture-workspace-target");

function digest(value) {
  return `sha256:${Number(value).toString(16).padStart(64, "0")}`;
}

function expected(kind) {
  const scopeIdentity = digest(11);
  const workspaceTargetPoststateIdentity =
    kind === "git" ? `git-tree:${"2".repeat(40)}` : digest(12);
  return {
    operationId: OPERATION_ID,
    restoreKind: kind,
    checkpointNamespace: kind === "git" ? "session-1" : null,
    checkpointId: "checkpoint-1",
    checkpointIdentity: kind === "git" ? `git:${"3".repeat(40)}` : digest(13),
    workspaceScopeIdentity: scopeIdentity,
    workspaceTargetPoststateIdentity,
    poststateDigest: computeCheckpointRestoreDigest(
      "cc-checkpoint-restore-poststate-v1",
      {
        engine: kind,
        scopeIdentity,
        stateIdentity: workspaceTargetPoststateIdentity,
      },
    ),
  };
}

function status(authority, overrides = {}) {
  return {
    checkpointIdentity: authority.checkpointIdentity,
    modified: [],
    added: [],
    deleted: [],
    workspaceBinding: {
      schema: "cc-checkpoint-workspace-binding/v1",
      version: 1,
      engine: authority.restoreKind,
      workspaceRoot: WORKSPACE_ROOT,
      scopeIdentity: authority.workspaceScopeIdentity,
      prestateIdentity:
        authority.restoreKind === "git"
          ? `git-tree:${"2".repeat(40)}`
          : digest(14),
      writePlanIdentity: digest(15),
      targetPoststateIdentity: authority.workspaceTargetPoststateIdentity,
    },
    ...overrides,
  };
}

function request(authority) {
  return {
    operationId: OPERATION_ID,
    workspaceRoot: WORKSPACE_ROOT,
    workspaceLease: { assertOwned: vi.fn() },
    expected: authority,
  };
}

describe("CheckpointRestoreWorkspaceTargetVerifier", () => {
  it("verifies an exact Git target with the immutable checkpoint namespace", () => {
    const authority = expected("git");
    const gitStatusAgainst = vi.fn(() => status(authority));
    const copyDiffCheckpoint = vi.fn();
    const verifier = new CheckpointRestoreWorkspaceTargetVerifier({
      gitStatusAgainst,
      copyDiffCheckpoint,
    });
    const input = request(authority);

    const result = verifier.verify(input);

    expect(gitStatusAgainst).toHaveBeenCalledWith(
      WORKSPACE_ROOT,
      "checkpoint-1",
      {
        session: "session-1",
        expectedIdentity: authority.checkpointIdentity,
      },
    );
    expect(copyDiffCheckpoint).not.toHaveBeenCalled();
    expect(input.workspaceLease.assertOwned).toHaveBeenCalledTimes(3);
    expect(result).toEqual({
      schema: CHECKPOINT_RESTORE_WORKSPACE_TARGET_VERIFICATION_SCHEMA,
      version: CHECKPOINT_RESTORE_WORKSPACE_TARGET_VERIFICATION_VERSION,
      verified: true,
      exact: true,
      ...authority,
    });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("verifies an exact copy target through the canonical diff planner", () => {
    const authority = expected("copy");
    const gitStatusAgainst = vi.fn();
    const copyDiffCheckpoint = vi.fn(() => status(authority));
    const verifier = new CheckpointRestoreWorkspaceTargetVerifier({
      gitStatusAgainst,
      copyDiffCheckpoint,
    });
    const input = request(authority);

    const result = verifier.verify(input);

    expect(copyDiffCheckpoint).toHaveBeenCalledWith("checkpoint-1", {
      cwd: WORKSPACE_ROOT,
      expectedIdentity: authority.checkpointIdentity,
    });
    expect(gitStatusAgainst).not.toHaveBeenCalled();
    expect(result.restoreKind).toBe("copy");
    expect(result.checkpointNamespace).toBeNull();
  });

  it.each([
    ["non-empty Git diff", (authority) => status(authority, { added: ["x"] })],
    [
      "scope drift",
      (authority) => ({
        ...status(authority),
        workspaceBinding: {
          ...status(authority).workspaceBinding,
          scopeIdentity: digest(99),
        },
      }),
    ],
    [
      "target drift",
      (authority) => ({
        ...status(authority),
        workspaceBinding: {
          ...status(authority).workspaceBinding,
          targetPoststateIdentity: `git-tree:${"9".repeat(40)}`,
        },
      }),
    ],
    [
      "Git prestate drift despite an empty diff",
      (authority) => ({
        ...status(authority),
        workspaceBinding: {
          ...status(authority).workspaceBinding,
          prestateIdentity: `git-tree:${"8".repeat(40)}`,
        },
      }),
    ],
  ])("fails closed for %s", (_label, projectStatus) => {
    const authority = expected("git");
    const input = request(authority);
    const verifier = new CheckpointRestoreWorkspaceTargetVerifier({
      gitStatusAgainst: () => projectStatus(authority),
      copyDiffCheckpoint: vi.fn(),
    });

    expect(() => verifier.verify(input)).toThrow(
      expect.objectContaining({
        code: CHECKPOINT_RESTORE_WORKSPACE_TARGET_ERROR_CODES.CONFLICT,
      }),
    );
    expect(input.workspaceLease.assertOwned).toHaveBeenCalled();
  });

  it("accepts a symlink-style workspace alias only after canonical resolution", () => {
    const authority = expected("git");
    const aliasRoot = path.resolve("fixture-workspace-target-alias");
    const verifier = new CheckpointRestoreWorkspaceTargetVerifier({
      gitStatusAgainst: () => status(authority),
      copyDiffCheckpoint: vi.fn(),
      canonicalPath: (value) =>
        path.resolve(value) === aliasRoot
          ? WORKSPACE_ROOT
          : path.resolve(value),
    });
    const input = { ...request(authority), workspaceRoot: aliasRoot };

    expect(verifier.verify(input)).toMatchObject({
      verified: true,
      exact: true,
      operationId: OPERATION_ID,
    });
  });

  it("wraps engine read uncertainty as a target conflict", () => {
    const authority = expected("copy");
    const privateError = new Error("private checkpoint path");
    const verifier = new CheckpointRestoreWorkspaceTargetVerifier({
      gitStatusAgainst: vi.fn(),
      copyDiffCheckpoint: () => {
        throw privateError;
      },
    });

    expect(() => verifier.verify(request(authority))).toThrow(
      expect.objectContaining({
        code: CHECKPOINT_RESTORE_WORKSPACE_TARGET_ERROR_CODES.CONFLICT,
        cause: privateError,
      }),
    );
  });

  it("rejects incomplete authority without consulting either engine", () => {
    const gitStatusAgainst = vi.fn();
    const copyDiffCheckpoint = vi.fn();
    const verifier = new CheckpointRestoreWorkspaceTargetVerifier({
      gitStatusAgainst,
      copyDiffCheckpoint,
    });
    const input = request({ ...expected("git"), checkpointNamespace: null });

    expect(() => verifier.verify(input)).toThrow(
      expect.objectContaining({
        code: CHECKPOINT_RESTORE_WORKSPACE_TARGET_ERROR_CODES.INVALID_ARGUMENT,
      }),
    );
    expect(gitStatusAgainst).not.toHaveBeenCalled();
    expect(copyDiffCheckpoint).not.toHaveBeenCalled();
  });
});
