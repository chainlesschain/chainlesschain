import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _backgroundTaskCommandDeps,
  executeBackgroundTaskCommand,
} from "../../src/harness/background-task-command-runner.js";

const originalDeps = { ..._backgroundTaskCommandDeps };

describe("background task command runner", () => {
  let workspace;
  let cwd;

  beforeEach(() => {
    workspace = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), "cc-background-command-")),
    );
    cwd = path.join(workspace, "nested");
    fs.mkdirSync(cwd);
    cwd = fs.realpathSync.native(cwd);
  });

  afterEach(() => {
    Object.assign(_backgroundTaskCommandDeps, originalDeps);
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  it("keeps an unpinned legacy command on the Broker shell path", async () => {
    const execSync = vi.fn(() => "legacy-ok");
    const execFile = vi.fn();
    const issueContract = vi.fn();
    Object.assign(_backgroundTaskCommandDeps, {
      execSync,
      execFile,
      issueLinuxWorkspaceSandboxExecutionContract: issueContract,
    });

    expect(
      await executeBackgroundTaskCommand({
        command: "echo legacy",
        cwd,
        type: "shell",
      }),
    ).toBe("legacy-ok");
    expect(execSync).toHaveBeenCalledWith(
      "echo legacy",
      expect.objectContaining({
        cwd,
        origin: "background-task:command:shell",
        shell: true,
      }),
    );
    expect(execFile).not.toHaveBeenCalled();
    expect(issueContract).not.toHaveBeenCalled();
  });

  it("uses explicit shell argv and a one-shot contract for a pinned Linux task", async () => {
    const contract = Object.freeze({ kind: "strict-workspace-command" });
    const issueContract = vi.fn(() => contract);
    const execFile = vi.fn((_file, _args, _options, callback) => {
      callback(null, "sandbox-ok", "");
      return new EventTarget();
    });
    Object.assign(_backgroundTaskCommandDeps, {
      platform: "linux",
      execFile,
      issueLinuxWorkspaceSandboxExecutionContract: issueContract,
    });

    expect(
      await executeBackgroundTaskCommand({
        command: "printf sandbox-ok",
        cwd,
        type: "shell",
        workspaceCwd: workspace,
        requiredBoundaries: JSON.stringify(["network", "filesystem"]),
      }),
    ).toBe("sandbox-ok");

    expect(issueContract).toHaveBeenCalledWith(
      "/bin/sh",
      ["-c", "printf sandbox-ok"],
      expect.objectContaining({
        cwd,
        shell: false,
        sandboxPolicy: {
          requiredBoundaries: ["filesystem", "network"],
        },
      }),
      workspace,
      { sync: false },
    );
    const [, , options] = execFile.mock.calls[0];
    expect(execFile).toHaveBeenCalledWith(
      "/bin/sh",
      ["-c", "printf sandbox-ok"],
      expect.objectContaining({
        cwd,
        shell: false,
        sandboxExecutionContract: contract,
      }),
      expect.any(Function),
    );
    expect(Object.isFrozen(options.sandboxPolicy)).toBe(true);
    expect(Object.isFrozen(options.sandboxPolicy.requiredBoundaries)).toBe(
      true,
    );
  });

  it("fails closed before execution when Linux contract issuance fails", () => {
    const execFile = vi.fn();
    Object.assign(_backgroundTaskCommandDeps, {
      platform: "linux",
      execFile,
      issueLinuxWorkspaceSandboxExecutionContract: vi.fn(() => null),
    });

    expect(() =>
      executeBackgroundTaskCommand({
        command: "echo denied",
        cwd,
        type: "shell",
        workspaceCwd: workspace,
        requiredBoundaries: ["filesystem"],
      }),
    ).toThrow(
      expect.objectContaining({
        code: "ERR_PROCESS_SANDBOX_BOUNDARY_UNSATISFIED",
        sandboxReason: "background_linux_execution_contract_unavailable",
        sandboxFailClosed: true,
      }),
    );
    expect(execFile).not.toHaveBeenCalled();
  });

  it("fails closed before execution when no platform backend is available", () => {
    const execFile = vi.fn();
    const issueContract = vi.fn();
    Object.assign(_backgroundTaskCommandDeps, {
      platform: "win32",
      execFile,
      issueLinuxWorkspaceSandboxExecutionContract: issueContract,
    });

    expect(() =>
      executeBackgroundTaskCommand({
        command: "echo denied",
        cwd,
        type: "shell",
        workspaceCwd: workspace,
        requiredBoundaries: ["filesystem"],
      }),
    ).toThrow(
      expect.objectContaining({
        code: "ERR_PROCESS_SANDBOX_BOUNDARY_UNSATISFIED",
        sandboxReason: "background_platform_backend_unavailable",
        sandboxFailClosed: true,
        sandboxCandidateBackend: null,
      }),
    );
    expect(issueContract).not.toHaveBeenCalled();
    expect(execFile).not.toHaveBeenCalled();
  });

  it("rejects a forged cwd outside the pinned workspace", () => {
    const outside = fs.mkdtempSync(
      path.join(os.tmpdir(), "cc-background-outside-"),
    );
    try {
      _backgroundTaskCommandDeps.platform = "linux";
      expect(() =>
        executeBackgroundTaskCommand({
          command: "echo denied",
          cwd: outside,
          type: "shell",
          workspaceCwd: workspace,
          requiredBoundaries: ["filesystem"],
        }),
      ).toThrow(
        expect.objectContaining({
          code: "ERR_BACKGROUND_TASK_SANDBOX_BINDING_INVALID",
          sandboxReason: "background_sandbox_binding_invalid",
        }),
      );
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it("rejects malformed or unsupported boundary envelopes", () => {
    for (const requiredBoundaries of [
      "{bad-json",
      [],
      ["filesystem", "process"],
    ]) {
      expect(() =>
        executeBackgroundTaskCommand({
          command: "echo denied",
          cwd,
          type: "shell",
          workspaceCwd: workspace,
          requiredBoundaries,
        }),
      ).toThrow(
        expect.objectContaining({
          code: "ERR_BACKGROUND_TASK_SANDBOX_ENVELOPE_INVALID",
          sandboxFailClosed: true,
        }),
      );
    }
  });
});
