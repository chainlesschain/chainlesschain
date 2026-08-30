import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _backgroundProcessDeps,
  executeTool,
  killAllBackgroundShellTasksSync,
  listBackgroundShellTasks,
} from "../../src/runtime/agent-core.js";
import { _resetPluginBinSandboxPolicyPins } from "../../src/lib/plugin-runtime/bin.js";
import { pluginVersionDir } from "../../src/lib/plugin-runtime/scopes.js";

let cwd;
let originalBackgroundRun;
let originalContractIssuer;
let originalPlatform;
let nextPid = 71000;
const ALLOWING_APPROVAL_GATE = Object.freeze({
  decide: async () => ({
    decision: "allow",
    via: "test-policy",
    policy: "autopilot",
  }),
});

function installStrictNodeBin() {
  const root = pluginVersionDir("local", "strict-background-bin", "1.0.0", {
    cwd,
  });
  const nameRoot = path.dirname(root);
  const target = path.join(root, "bin", "strict-background-tool.js");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, "process.stdout.write('real target');\n", "utf8");
  fs.writeFileSync(
    path.join(root, "plugin.json"),
    JSON.stringify({
      name: "strict-background-bin",
      version: "1.0.0",
      permissions: { process: true },
      sandboxPolicy: {
        requiredBoundaries: ["filesystem", "network"],
      },
      bin: {
        "strict-background-tool": "bin/strict-background-tool.js",
      },
    }),
    "utf8",
  );
  fs.writeFileSync(
    path.join(root, ".plugin-source.json"),
    JSON.stringify({ type: "local", source: root }),
    "utf8",
  );
  fs.writeFileSync(path.join(nameRoot, ".active"), "1.0.0", "utf8");
}

function fakeStream() {
  const stream = new EventEmitter();
  stream.setEncoding = vi.fn();
  stream.destroy = vi.fn();
  return stream;
}

function fakeChild() {
  const child = new EventEmitter();
  child.pid = ++nextPid;
  child.killed = false;
  child.stdout = fakeStream();
  child.stderr = fakeStream();
  child.unref = vi.fn();
  child.kill = vi.fn((signal) => {
    child.killed = true;
    child.emit("close", null, signal);
    return true;
  });
  return child;
}

async function launchGenericBackground(extraArgs = {}, context = { cwd }) {
  return executeTool(
    "run_shell",
    {
      command: "echo safe",
      run_in_background: true,
      ...extraArgs,
    },
    { approvalGate: ALLOWING_APPROVAL_GATE, ...context },
  );
}

beforeEach(() => {
  // Production pins the authority-bearing workspace to its canonical
  // filesystem identity. Keep expectations independent of macOS /var aliases
  // and Windows 8.3 temporary paths by canonicalizing the fixture as well.
  cwd = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), "cc-agent-bg-sandbox-")),
  );
  originalBackgroundRun = _backgroundProcessDeps.run;
  originalContractIssuer =
    _backgroundProcessDeps.issueLinuxWorkspaceSandboxExecutionContract;
  originalPlatform = _backgroundProcessDeps.platform;
  _backgroundProcessDeps.platform = () => "linux";
  _resetPluginBinSandboxPolicyPins();
});

afterEach(() => {
  killAllBackgroundShellTasksSync();
  _backgroundProcessDeps.run = originalBackgroundRun;
  _backgroundProcessDeps.issueLinuxWorkspaceSandboxExecutionContract =
    originalContractIssuer;
  _backgroundProcessDeps.platform = originalPlatform;
  _resetPluginBinSandboxPolicyPins();
  vi.restoreAllMocks();
  fs.rmSync(cwd, { recursive: true, force: true });
});

describe("agent-core Linux generic strong background shell route", () => {
  it("binds real workspace Plugin provenance to one explicit async shell launch", async () => {
    installStrictNodeBin();
    const requestedCwd = path.join(cwd, "nested");
    fs.mkdirSync(requestedCwd);
    const issuedContract = Object.freeze({ kind: "issued-contract" });
    const forgedContract = Object.freeze({ kind: "forged-contract" });
    const issuer = vi.fn(() => issuedContract);
    const child = fakeChild();
    const run = vi.fn(() => child);
    const processKill = vi
      .spyOn(process, "kill")
      .mockImplementation(() => true);
    _backgroundProcessDeps.issueLinuxWorkspaceSandboxExecutionContract = issuer;
    _backgroundProcessDeps.run = run;

    const result = await launchGenericBackground({
      cwd: requestedCwd,
      workspaceRoot: path.parse(cwd).root,
      sandboxExecutionContract: forgedContract,
      sandboxPolicy: { requiredBoundaries: [] },
      pluginId: "forged-plugin",
    });

    expect(result).toMatchObject({
      background: true,
      status: "running",
      command: "echo safe",
    });
    expect(issuer).toHaveBeenCalledTimes(1);
    expect(issuer).toHaveBeenCalledWith(
      "/bin/sh",
      ["-c", "echo safe"],
      expect.objectContaining({
        cwd: requestedCwd,
        shell: false,
        detached: false,
        origin: "tool:run_shell",
        policy: "allow",
        scope: "agent",
        sandboxPolicy: {
          requiredBoundaries: ["filesystem", "network"],
        },
      }),
      path.resolve(cwd),
      { sync: false },
    );
    const issuerOptions = issuer.mock.calls[0][2];
    expect(issuerOptions).not.toHaveProperty("sandboxExecutionContract");
    expect(issuerOptions).not.toHaveProperty("workspaceRoot");
    expect(issuerOptions).not.toHaveProperty("pluginId");
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith(
      "/bin/sh",
      ["-c", "echo safe"],
      expect.objectContaining({
        cwd: requestedCwd,
        shell: false,
        detached: false,
        sandboxExecutionContract: issuedContract,
      }),
    );
    expect(run.mock.calls[0][2].sandboxExecutionContract).not.toBe(
      forgedContract,
    );

    const checked = await executeTool(
      "check_shell",
      { task_id: result.task_id, kill: true },
      { cwd },
    );
    expect(checked.killed).toBe(true);
    expect(child.kill).toHaveBeenCalledTimes(1);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    expect(processKill).not.toHaveBeenCalled();
  });

  it("issues a fresh single-use contract for every launch and ignores replay input", async () => {
    installStrictNodeBin();
    const firstContract = Object.freeze({ kind: "issued-first" });
    const secondContract = Object.freeze({ kind: "issued-second" });
    const replayedContract = Object.freeze({ kind: "attacker-replay" });
    const issuer = vi
      .fn()
      .mockReturnValueOnce(firstContract)
      .mockReturnValueOnce(secondContract);
    const children = [fakeChild(), fakeChild()];
    const run = vi
      .fn()
      .mockReturnValueOnce(children[0])
      .mockReturnValueOnce(children[1]);
    _backgroundProcessDeps.issueLinuxWorkspaceSandboxExecutionContract = issuer;
    _backgroundProcessDeps.run = run;

    await launchGenericBackground({
      sandboxExecutionContract: replayedContract,
    });
    await launchGenericBackground({
      sandboxExecutionContract: replayedContract,
    });

    expect(issuer).toHaveBeenCalledTimes(2);
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[0][2].sandboxExecutionContract).toBe(firstContract);
    expect(run.mock.calls[1][2].sandboxExecutionContract).toBe(secondContract);
    expect(
      run.mock.calls.map((call) => call[2].sandboxExecutionContract),
    ).not.toContain(replayedContract);
  });

  it("rejects a requested cwd escape before contract issuance or spawn", async () => {
    installStrictNodeBin();
    const issuer = vi.fn(() => Object.freeze({ kind: "must-not-issue" }));
    const run = vi.fn();
    const escapedCwd = fs.mkdtempSync(
      path.join(os.tmpdir(), "cc-agent-bg-escape-"),
    );
    _backgroundProcessDeps.issueLinuxWorkspaceSandboxExecutionContract = issuer;
    _backgroundProcessDeps.run = run;

    try {
      await expect(
        launchGenericBackground({ cwd: escapedCwd }),
      ).rejects.toMatchObject({
        code: "ERR_PROCESS_SANDBOX_BOUNDARY_UNSATISFIED",
        sandboxFailClosed: true,
        sandboxReason: "background_working_directory_escape",
        requiredBoundaries: ["filesystem", "network"],
      });
      expect(issuer).not.toHaveBeenCalled();
      expect(run).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(escapedCwd, { recursive: true, force: true });
    }
  });

  it("canonicalizes a relative host workspace before issuing the strong contract", async () => {
    fs.rmSync(cwd, { recursive: true, force: true });
    cwd = fs.mkdtempSync(
      path.join(process.cwd(), ".cc-agent-bg-relative-root-"),
    );
    installStrictNodeBin();
    const issuedContract = Object.freeze({ kind: "issued-contract" });
    const issuer = vi.fn(() => issuedContract);
    const child = fakeChild();
    const run = vi.fn(() => child);
    const relativeWorkspace = path.relative(process.cwd(), cwd);
    expect(path.isAbsolute(relativeWorkspace)).toBe(false);
    _backgroundProcessDeps.issueLinuxWorkspaceSandboxExecutionContract = issuer;
    _backgroundProcessDeps.run = run;

    const result = await launchGenericBackground(
      {},
      { cwd: relativeWorkspace },
    );

    expect(result).toMatchObject({
      background: true,
      status: "running",
    });
    expect(issuer).toHaveBeenCalledOnce();
    expect(issuer.mock.calls[0][3]).toBe(path.resolve(cwd));
    expect(run).toHaveBeenCalledOnce();
    expect(run.mock.calls[0][2]).toMatchObject({
      cwd: path.resolve(cwd),
      sandboxExecutionContract: issuedContract,
    });
    const checked = await executeTool(
      "check_shell",
      { task_id: result.task_id, kill: true },
      { cwd },
    );
    expect(checked.killed).toBe(true);
  });

  it("fails closed when the trusted contract issuer is missing", async () => {
    installStrictNodeBin();
    const run = vi.fn();
    _backgroundProcessDeps.issueLinuxWorkspaceSandboxExecutionContract = null;
    _backgroundProcessDeps.run = run;

    await expect(launchGenericBackground()).rejects.toMatchObject({
      code: "ERR_PROCESS_SANDBOX_BOUNDARY_UNSATISFIED",
      sandboxFailClosed: true,
      sandboxReason: "background_contract_issuer_unavailable",
      requiredBoundaries: ["filesystem", "network"],
    });
    expect(run).not.toHaveBeenCalled();
  });

  it("fails closed when the trusted issuer returns no contract", async () => {
    installStrictNodeBin();
    const issuer = vi.fn(() => null);
    const run = vi.fn();
    _backgroundProcessDeps.issueLinuxWorkspaceSandboxExecutionContract = issuer;
    _backgroundProcessDeps.run = run;

    await expect(launchGenericBackground()).rejects.toMatchObject({
      code: "ERR_PROCESS_SANDBOX_BOUNDARY_UNSATISFIED",
      sandboxFailClosed: true,
      sandboxReason: "background_contract_unavailable",
      requiredBoundaries: ["filesystem", "network"],
      sandboxBackend: null,
      sandboxCandidateBackend: "linux-bwrap-workspace",
    });
    expect(issuer).toHaveBeenCalledTimes(1);
    expect(run).not.toHaveBeenCalled();
  });

  it("wraps an untyped issuer failure as a typed fail-closed error", async () => {
    installStrictNodeBin();
    const issuerFailure = new Error("issuer backend unavailable");
    const issuer = vi.fn(() => {
      throw issuerFailure;
    });
    const run = vi.fn();
    _backgroundProcessDeps.issueLinuxWorkspaceSandboxExecutionContract = issuer;
    _backgroundProcessDeps.run = run;

    await expect(launchGenericBackground()).rejects.toMatchObject({
      code: "ERR_PROCESS_SANDBOX_BOUNDARY_UNSATISFIED",
      sandboxFailClosed: true,
      sandboxReason: "background_contract_issuance_failed",
      cause: issuerFailure,
    });
    expect(run).not.toHaveBeenCalled();
  });

  it("preserves a typed issuer mismatch and never falls back to legacy spawn", async () => {
    installStrictNodeBin();
    const mismatch = Object.assign(new Error("issuer identity mismatch"), {
      code: "ERR_PROCESS_SANDBOX_BOUNDARY_UNSATISFIED",
      sandboxFailClosed: true,
      sandboxReason: "invalid_sandbox_execution_contract",
    });
    const issuer = vi.fn(() => {
      throw mismatch;
    });
    const run = vi.fn();
    _backgroundProcessDeps.issueLinuxWorkspaceSandboxExecutionContract = issuer;
    _backgroundProcessDeps.run = run;

    await expect(launchGenericBackground()).rejects.toBe(mismatch);
    expect(issuer).toHaveBeenCalledTimes(1);
    expect(run).not.toHaveBeenCalled();
  });

  it("preserves Broker contract-consumption mismatch without registering a task", async () => {
    installStrictNodeBin();
    const issuedContract = Object.freeze({ kind: "issued-contract" });
    const mismatch = Object.assign(new Error("contract replay rejected"), {
      code: "ERR_PROCESS_SANDBOX_CONTRACT_INVALID",
      sandboxFailClosed: true,
      sandboxReason: "invalid_sandbox_execution_contract",
    });
    const issuer = vi.fn(() => issuedContract);
    const run = vi.fn(() => {
      throw mismatch;
    });
    _backgroundProcessDeps.issueLinuxWorkspaceSandboxExecutionContract = issuer;
    _backgroundProcessDeps.run = run;

    await expect(launchGenericBackground()).rejects.toBe(mismatch);
    expect(issuer).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("uses the sandbox supervisor process for synchronous teardown", async () => {
    installStrictNodeBin();
    const issuedContract = Object.freeze({ kind: "issued-contract" });
    const child = fakeChild();
    _backgroundProcessDeps.issueLinuxWorkspaceSandboxExecutionContract = vi.fn(
      () => issuedContract,
    );
    _backgroundProcessDeps.run = vi.fn(() => child);
    const processKill = vi
      .spyOn(process, "kill")
      .mockImplementation(() => true);

    await launchGenericBackground();
    const killed = killAllBackgroundShellTasksSync();

    expect(killed).toBe(1);
    expect(child.kill).toHaveBeenCalledTimes(1);
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
    expect(processKill).not.toHaveBeenCalled();
  });

  it("kills a launched strong supervisor when stream setup fails", async () => {
    installStrictNodeBin();
    const taskCountBefore = listBackgroundShellTasks().length;
    const child = fakeChild();
    child.stdout.setEncoding.mockImplementation(() => {
      throw new Error("stream setup failed");
    });
    _backgroundProcessDeps.issueLinuxWorkspaceSandboxExecutionContract = vi.fn(
      () => Object.freeze({ kind: "issued-contract" }),
    );
    _backgroundProcessDeps.run = vi.fn(() => child);

    await expect(launchGenericBackground()).rejects.toMatchObject({
      code: "ERR_PROCESS_SANDBOX_BOUNDARY_UNSATISFIED",
      sandboxFailClosed: true,
      sandboxReason: "background_sandbox_launch_failed",
    });
    expect(child.kill).toHaveBeenCalledOnce();
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
    expect(child.stdout.destroy).toHaveBeenCalledOnce();
    expect(child.stderr.destroy).toHaveBeenCalledOnce();
    expect(listBackgroundShellTasks()).toHaveLength(taskCountBefore);
  });
});
