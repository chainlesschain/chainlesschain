import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sandboxMocks = vi.hoisted(() => ({
  execute: vi.fn(),
  createProxy: vi.fn(),
}));

vi.mock("../../src/lib/agent-sandbox.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    executeSandboxedShell: (...args) => sandboxMocks.execute(...args),
  };
});

vi.mock("../../src/lib/sandbox-egress-proxy.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    createEgressProxy: (...args) => sandboxMocks.createProxy(...args),
  };
});

import {
  _backgroundProcessDeps,
  executeTool,
  killAllBackgroundShellTasksSync,
  listBackgroundShellTasks,
} from "../../src/runtime/agent-core.js";
import { executionBroker } from "../../src/lib/process-execution-broker/index.js";
import { _resetPluginBinSandboxPolicyPins } from "../../src/lib/plugin-runtime/bin.js";
import { pluginVersionDir } from "../../src/lib/plugin-runtime/scopes.js";

// Plugin identity/contract re-attestation performs real filesystem hashing.
// Keep the per-test bound explicit so parallel CI load cannot trip Vitest's
// generic 5-second default while genuine deadlocks still fail deterministically.
vi.setConfig({ testTimeout: 15_000 });

const AUTHORIZATION = Object.freeze({
  kind: "chainlesschain.remote-approval-lease-authorization/v1",
});

let cwd;
let originalBackgroundRun;
let originalContractIssuer;
let originalBackgroundPlatform;
let nextPid = 88000;

function fakeStream() {
  return Object.assign(new EventEmitter(), {
    setEncoding: vi.fn(),
    destroy: vi.fn(),
  });
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

function installNodeBin({ strict = true } = {}) {
  const root = pluginVersionDir("local", "remote-auth-bin", "1.0.0", {
    cwd,
  });
  const target = path.join(root, "bin", "remote-auth-tool.js");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(
    target,
    "process.stdout.write('must be brokered');\n",
    "utf8",
  );
  const manifest = {
    name: "remote-auth-bin",
    version: "1.0.0",
    permissions: { process: true },
    bin: { "remote-auth-tool": "bin/remote-auth-tool.js" },
  };
  if (strict) {
    manifest.sandboxPolicy = {
      requiredBoundaries: ["filesystem", "network"],
    };
  }
  fs.writeFileSync(
    path.join(root, "plugin.json"),
    JSON.stringify(manifest),
    "utf8",
  );
  return target;
}

function installStrictNodeBin() {
  return installNodeBin();
}

function installLegacyNodeBin() {
  return installNodeBin({ strict: false });
}

function durableGate(events, { consumeError = null, onConsume = null } = {}) {
  return {
    decide: vi.fn(async () => ({
      decision: "allow",
      via: "remote",
      policy: "strict",
      authorization: AUTHORIZATION,
    })),
    consumeAuthorization: vi.fn(async () => {
      events.push("consume");
      await onConsume?.();
      if (consumeError) throw consumeError;
      return true;
    }),
  };
}

function expectExactAuthorizationTuple(gate, args) {
  expect(gate.decide).toHaveBeenCalledOnce();
  expect(gate.consumeAuthorization).toHaveBeenCalledOnce();
  const decisionContext = gate.decide.mock.calls[0][0];
  expect(decisionContext).toMatchObject({
    sessionId: "agent-session",
    tool: "run_shell",
    args: expect.objectContaining(args),
    cwd,
    targetEnv: null,
  });
  expect(Object.isFrozen(decisionContext.args)).toBe(true);
  expect(Object.isFrozen(decisionContext.args.execution)).toBe(true);
  expect(decisionContext.args.execution).toMatchObject({
    version: "chainlesschain.shell-execution-descriptor/v1",
    workspace: cwd,
  });
  const consumeContext = gate.consumeAuthorization.mock.calls[0][1];
  expect(consumeContext).toEqual({
    tool: "run_shell",
    action: `${decisionContext.riskLevel}-risk`,
    args: decisionContext.args,
    workspace: cwd,
    session: "agent-session",
    targetEnv: null,
    policyVersion: decisionContext.policyVersion,
  });
  expect(consumeContext.args).toBe(decisionContext.args);
}

async function executeAuthorized(args, gate, extraContext = {}) {
  return executeTool("run_shell", args, {
    cwd,
    sessionId: "agent-session",
    approvalGate: gate,
    ...extraContext,
  });
}

beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), "cc-remote-shell-auth-"));
  originalBackgroundRun = _backgroundProcessDeps.run;
  originalContractIssuer =
    _backgroundProcessDeps.issueLinuxWorkspaceSandboxExecutionContract;
  originalBackgroundPlatform = _backgroundProcessDeps.platform;
  sandboxMocks.execute.mockReset();
  sandboxMocks.createProxy.mockReset();
  _resetPluginBinSandboxPolicyPins();
});

afterEach(() => {
  delete process.env.CC_TOCTOU_DESCRIPTOR_TEST;
  killAllBackgroundShellTasksSync();
  _backgroundProcessDeps.run = originalBackgroundRun;
  _backgroundProcessDeps.issueLinuxWorkspaceSandboxExecutionContract =
    originalContractIssuer;
  _backgroundProcessDeps.platform = originalBackgroundPlatform;
  _resetPluginBinSandboxPolicyPins();
  vi.restoreAllMocks();
  fs.rmSync(cwd, { recursive: true, force: true });
});

describe("run_shell durable remote authorization dispatch fence", () => {
  it("snapshots caller args before a live permission provider can await", async () => {
    const events = [];
    const gate = durableGate(events);
    const authority = {
      rules: { allow: [], ask: [], deny: [] },
      sources: {},
      scoped: { rules: [] },
    };
    let resolveInitialAuthority;
    const initialAuthority = new Promise((resolve) => {
      resolveInitialAuthority = resolve;
    });
    const observed = [];
    let providerCalls = 0;
    const permissionRulesProvider = vi.fn(({ args }) => {
      providerCalls += 1;
      observed.push(args.command);
      return providerCalls === 1
        ? initialAuthority
        : Promise.resolve(authority);
    });
    const dispatch = vi
      .spyOn(executionBroker, "execSync")
      .mockImplementation((command) => {
        events.push("dispatch");
        return command;
      });
    const args = { command: "echo authority-original", timeout: 4321 };

    const pending = executeAuthorized(args, gate, {
      permissionRulesProvider,
    });
    await vi.waitFor(() => expect(permissionRulesProvider).toHaveBeenCalled());
    args.command = "echo MUTATED-BEFORE-AUTHORITY";
    args.timeout = 1;
    resolveInitialAuthority(authority);

    await expect(pending).resolves.toMatchObject({
      stdout: "echo authority-original",
    });
    expect(dispatch).toHaveBeenCalledWith(
      "echo authority-original",
      expect.objectContaining({ timeout: 4321 }),
    );
    expect(observed.length).toBeGreaterThanOrEqual(3);
    expect(new Set(observed)).toEqual(new Set(["echo authority-original"]));
  });

  it("pins a relative cwd before approval even if process.cwd changes", async () => {
    const entryProcessCwd = process.cwd();
    const relative = "approved-workspace";
    const approvedCwd = path.join(cwd, relative);
    const changedCwd = fs.mkdtempSync(path.join(os.tmpdir(), "cc-cwd-drift-"));
    fs.mkdirSync(approvedCwd, { recursive: true });
    let resolveDecision;
    const gate = {
      decide: vi.fn(
        () =>
          new Promise((resolve) => {
            resolveDecision = resolve;
          }),
      ),
      consumeAuthorization: vi.fn(async () => true),
    };
    const dispatch = vi
      .spyOn(executionBroker, "execSync")
      .mockReturnValue("cwd-ok");

    try {
      const pending = executeAuthorized(
        { command: "echo cwd", cwd: relative },
        gate,
      );
      await vi.waitFor(() => expect(gate.decide).toHaveBeenCalledOnce());
      process.chdir(changedCwd);
      resolveDecision({
        decision: "allow",
        via: "remote",
        policy: "strict",
        authorization: AUTHORIZATION,
      });
      await expect(pending).resolves.toMatchObject({ stdout: "cwd-ok" });
      expect(dispatch).toHaveBeenCalledWith(
        "echo cwd",
        expect.objectContaining({ cwd: fs.realpathSync.native(approvedCwd) }),
      );
    } finally {
      process.chdir(entryProcessCwd);
      fs.rmSync(changedCwd, { recursive: true, force: true });
    }
  });

  it("blocks when live permission authority is revoked during consume", async () => {
    const events = [];
    let revoked = false;
    const permissionRulesProvider = vi.fn(async () => ({
      rules: {
        allow: [],
        ask: [],
        deny: revoked ? ["run_shell"] : [],
      },
      sources: revoked ? { "deny:run_shell": "managed" } : {},
      scoped: { rules: [] },
    }));
    const gate = durableGate(events, {
      onConsume: async () => {
        revoked = true;
      },
    });
    const dispatch = vi.spyOn(executionBroker, "execSync");

    await expect(
      executeAuthorized({ command: "echo revoked" }, gate, {
        permissionRulesProvider,
      }),
    ).resolves.toMatchObject({
      policy: { code: "CC_SHELL_POLICY_AUTHORITY_CHANGED" },
    });
    expect(events).toEqual(["consume"]);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("blocks authority drift that occurs while a settings ask is pending", async () => {
    let revoked = false;
    let resolvePermissionConfirm;
    const permissionRulesProvider = vi.fn(async () => ({
      rules: {
        allow: [],
        ask: revoked ? [] : ["run_shell"],
        deny: revoked ? ["run_shell"] : [],
      },
      sources: revoked
        ? { "deny:run_shell": "managed" }
        : { "ask:run_shell": "project" },
      scoped: { rules: [] },
    }));
    const permissionConfirm = vi.fn(
      () =>
        new Promise((resolve) => {
          resolvePermissionConfirm = resolve;
        }),
    );
    const dispatch = vi.spyOn(executionBroker, "execSync");

    const pending = executeAuthorized(
      { command: "echo settings-window" },
      durableGate([]),
      { permissionRulesProvider, permissionConfirm },
    );
    await vi.waitFor(() => expect(permissionConfirm).toHaveBeenCalledOnce());
    revoked = true;
    resolvePermissionConfirm(true);

    await expect(pending).rejects.toMatchObject({
      code: "CC_SHELL_POLICY_AUTHORITY_CHANGED",
    });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("blocks when host policy is revoked during consume", async () => {
    const events = [];
    const hostManagedToolPolicy = {
      tools: {
        run_shell: {
          allowed: true,
          decision: "allow",
          requiresConfirmation: false,
        },
      },
    };
    const gate = durableGate(events, {
      onConsume: async () => {
        hostManagedToolPolicy.tools.run_shell.allowed = false;
        hostManagedToolPolicy.tools.run_shell.decision = "deny";
      },
    });
    const dispatch = vi.spyOn(executionBroker, "execSync");

    await expect(
      executeAuthorized({ command: "echo host-policy" }, gate, {
        hostManagedToolPolicy,
      }),
    ).resolves.toMatchObject({
      policy: { code: "CC_SHELL_POLICY_AUTHORITY_CHANGED" },
    });
    expect(events).toEqual(["consume"]);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("dispatches the approved immutable snapshot when caller args and env mutate while waiting", async () => {
    const events = [];
    let resolveDecision;
    const gate = {
      decide: vi.fn(
        () =>
          new Promise((resolve) => {
            resolveDecision = resolve;
          }),
      ),
      consumeAuthorization: vi.fn(async () => {
        events.push("consume");
        return true;
      }),
    };
    const args = {
      command: "echo immutable-original",
      cwd,
      shell: undefined,
      run_in_background: false,
      timeout: 3456,
    };
    process.env.CC_TOCTOU_DESCRIPTOR_TEST = "before-approval";
    const dispatch = vi
      .spyOn(executionBroker, "execSync")
      .mockImplementation(() => {
        events.push("dispatch");
        return "snapshot-ok";
      });

    const pending = executeAuthorized(args, gate);
    await vi.waitFor(() => expect(gate.decide).toHaveBeenCalledOnce());
    const approvedDescriptor = gate.decide.mock.calls[0][0].args;
    args.command = "echo MUTATED";
    args.cwd = path.dirname(cwd);
    args.shell = "pwsh";
    args.run_in_background = true;
    args.timeout = 1;
    process.env.CC_TOCTOU_DESCRIPTOR_TEST = "after-approval";
    resolveDecision({
      decision: "allow",
      via: "remote",
      policy: "strict",
      authorization: AUTHORIZATION,
    });

    const result = await pending;
    expect(result.stdout).toBe("snapshot-ok");
    expect(events).toEqual(["consume", "dispatch"]);
    expect(dispatch).toHaveBeenCalledWith(
      "echo immutable-original",
      expect.objectContaining({
        cwd,
        timeout: 3456,
        env: expect.objectContaining({
          CC_TOCTOU_DESCRIPTOR_TEST: "before-approval",
        }),
      }),
    );
    expect(approvedDescriptor).toMatchObject({
      command: "echo immutable-original",
      cwd,
      run_in_background: false,
      timeout: 3456,
      execution: { mode: "foreground" },
    });
    expect(Object.isFrozen(approvedDescriptor)).toBe(true);
    delete process.env.CC_TOCTOU_DESCRIPTOR_TEST;
  });

  it("consumes the exact tuple immediately before the default foreground exec", async () => {
    const events = [];
    const gate = durableGate(events);
    const args = { command: "echo remote-default", timeout: 1234 };
    const dispatch = vi
      .spyOn(executionBroker, "execSync")
      .mockImplementation(() => {
        events.push("dispatch");
        return "ok";
      });

    const result = await executeAuthorized(args, gate);

    expect(result.stdout).toBe("ok");
    expect(events).toEqual(["consume", "dispatch"]);
    expect(dispatch).toHaveBeenCalledWith(
      args.command,
      expect.objectContaining({ cwd, timeout: args.timeout }),
    );
    expectExactAuthorizationTuple(gate, args);
  });

  it("consumes before the explicit PowerShell argv foreground spawn", async () => {
    const events = [];
    const gate = durableGate(events);
    const args = {
      command: "Write-Output remote-pwsh",
      shell: "pwsh",
      timeout: 2345,
    };
    const dispatch = vi
      .spyOn(executionBroker, "spawnSync")
      .mockImplementation(() => {
        events.push("dispatch");
        return { status: 0, stdout: "pwsh-ok", stderr: "" };
      });

    const result = await executeAuthorized(args, gate);

    expect(result.stdout).toBe("pwsh-ok");
    expect(events).toEqual(["consume", "dispatch"]);
    expect(dispatch).toHaveBeenCalledWith(
      "pwsh",
      ["-NoProfile", "-Command", args.command],
      expect.objectContaining({ cwd, windowsHide: true }),
    );
    expectExactAuthorizationTuple(gate, args);
  });

  it("consumes before the ordinary background spawn", async () => {
    const events = [];
    const gate = durableGate(events);
    const args = { command: "echo remote-background", run_in_background: true };
    const dispatch = vi
      .spyOn(executionBroker, "spawn")
      .mockImplementation(() => {
        events.push("dispatch");
        return fakeChild();
      });

    const result = await executeAuthorized(args, gate);

    expect(result).toMatchObject({ background: true, status: "running" });
    expect(events).toEqual(["consume", "dispatch"]);
    expect(dispatch).toHaveBeenCalledWith(
      args.command,
      [],
      expect.objectContaining({ cwd, shell: true }),
    );
    expectExactAuthorizationTuple(gate, args);
  });

  it("consumes before the strict Plugin foreground spawn", async () => {
    installStrictNodeBin();
    const events = [];
    const gate = durableGate(events);
    const args = { command: "remote-auth-tool --safe" };
    const dispatch = vi
      .spyOn(executionBroker, "spawnSync")
      .mockImplementation(() => {
        events.push("dispatch");
        return { status: 0, stdout: "plugin-ok", stderr: "" };
      });

    const result = await executeAuthorized(args, gate);

    expect(result).toMatchObject({
      stdout: "plugin-ok",
      plugin_bin: { name: "remote-auth-tool" },
    });
    expect(events).toEqual(["consume", "dispatch"]);
    expect(dispatch).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining([expect.stringMatching(/remote-auth-tool\.js$/)]),
      expect.objectContaining({ shell: false }),
    );
    expectExactAuthorizationTuple(gate, args);
  }, 15_000);

  it("denies a strict Plugin changed while the lease consume is in flight", async () => {
    const target = installStrictNodeBin();
    const events = [];
    const gate = durableGate(events, {
      onConsume: async () => {
        fs.writeFileSync(target, "process.stdout.write('changed');\n", "utf8");
      },
    });
    const dispatch = vi.spyOn(executionBroker, "spawnSync");

    await expect(
      executeAuthorized({ command: "remote-auth-tool --safe" }, gate),
    ).resolves.toMatchObject({
      error: expect.stringMatching(/changed|identity|attest/i),
    });

    expect(events).toEqual(["consume"]);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("denies a strict Plugin whose manifest authority changes during consume", async () => {
    const target = installStrictNodeBin();
    const manifestPath = path.join(
      path.dirname(path.dirname(target)),
      "plugin.json",
    );
    const events = [];
    const gate = durableGate(events, {
      onConsume: async () => {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
        manifest.sandboxPolicy.requiredBoundaries = ["filesystem"];
        fs.writeFileSync(manifestPath, JSON.stringify(manifest), "utf8");
      },
    });
    const dispatch = vi.spyOn(executionBroker, "spawnSync");

    await expect(
      executeAuthorized({ command: "remote-auth-tool --safe" }, gate),
    ).resolves.toMatchObject({
      policy: {
        code: expect.stringMatching(
          /^ERR_(?:PLUGIN_BIN_LAUNCH_AUTHORITY_CHANGED|PROCESS_SANDBOX_BOUNDARY_UNSATISFIED)$/,
        ),
      },
    });
    expect(events).toEqual(["consume"]);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("consumes before the strict Plugin background spawn", async () => {
    installStrictNodeBin();
    _backgroundProcessDeps.platform = () => "linux";
    const events = [];
    const gate = durableGate(events);
    const args = {
      command: "remote-auth-tool --safe",
      run_in_background: true,
    };
    const dispatch = vi
      .spyOn(executionBroker, "spawn")
      .mockImplementation(() => {
        events.push("dispatch");
        return fakeChild();
      });

    const result = await executeAuthorized(args, gate);

    expect(result).toMatchObject({
      background: true,
      status: "running",
      plugin_bin: { name: "remote-auth-tool" },
    });
    expect(events).toEqual(["consume", "dispatch"]);
    expect(dispatch).toHaveBeenCalledOnce();
    expectExactAuthorizationTuple(gate, args);
  });

  it("consumes before the Linux generic strong background supervisor", async () => {
    installStrictNodeBin();
    _backgroundProcessDeps.platform = () => "linux";
    _backgroundProcessDeps.issueLinuxWorkspaceSandboxExecutionContract = vi.fn(
      () => Object.freeze({ kind: "test-linux-background-contract" }),
    );
    const events = [];
    const gate = durableGate(events);
    const args = { command: "echo generic-strong", run_in_background: true };
    const dispatch = vi.fn(() => {
      events.push("dispatch");
      return fakeChild();
    });
    _backgroundProcessDeps.run = dispatch;

    const result = await executeAuthorized(args, gate);

    expect(result).toMatchObject({ background: true, status: "running" });
    expect(events).toEqual(["consume", "dispatch"]);
    expect(dispatch).toHaveBeenCalledWith(
      "/bin/sh",
      ["-c", args.command],
      expect.objectContaining({
        shell: false,
        sandboxExecutionContract: {
          kind: "test-linux-background-contract",
        },
      }),
    );
    expectExactAuthorizationTuple(gate, args);
  });

  it("uses the approved sandbox snapshot and starts its proxy only after consume", async () => {
    const events = [];
    const sandbox = {
      network: true,
      filesystem: { denyRead: [], denyWrite: [] },
      policy: { allowedDomains: ["example.com"], deniedDomains: [] },
    };
    const expectedSandbox = structuredClone(sandbox);
    const gate = durableGate(events, {
      onConsume: async () => {
        sandbox.network = false;
        sandbox.policy.allowedDomains[0] = "changed.example";
      },
    });
    const close = vi.fn(async () => {
      events.push("proxy-close");
    });
    sandboxMocks.createProxy.mockReturnValue({
      listen: vi.fn(async () => {
        events.push("proxy-listen");
        return { port: 42424 };
      }),
      close,
    });
    sandboxMocks.execute.mockImplementation(() => {
      events.push("dispatch");
      return { exitCode: 0, stdout: "sandbox-ok", stderr: "" };
    });
    const args = { command: "echo remote-sandbox" };

    const result = await executeAuthorized(args, gate, { sandbox });

    expect(result.stdout).toBe("sandbox-ok");
    expect(events).toEqual([
      "consume",
      "proxy-listen",
      "dispatch",
      "proxy-close",
    ]);
    expect(sandboxMocks.execute).toHaveBeenCalledWith(
      args.command,
      expectedSandbox,
      expect.objectContaining({ cwd, egressProxy: { port: 42424 } }),
    );
    expect(Object.isFrozen(sandboxMocks.execute.mock.calls[0][1])).toBe(true);
    expect(sandboxMocks.createProxy).toHaveBeenCalledWith(
      expect.objectContaining({ allowedDomains: ["example.com"] }),
      expect.any(Object),
    );
    expect(close).toHaveBeenCalledOnce();
    expectExactAuthorizationTuple(gate, args);
  });

  it("closes a started sandbox proxy when authority changes before dispatch", async () => {
    const events = [];
    let revoked = false;
    const permissionRulesProvider = vi.fn(async () => ({
      rules: {
        allow: [],
        ask: [],
        deny: revoked ? ["run_shell"] : [],
      },
      sources: revoked ? { "deny:run_shell": "managed" } : {},
      scoped: { rules: [] },
    }));
    const close = vi.fn(async () => {
      events.push("proxy-close");
    });
    sandboxMocks.createProxy.mockReturnValue({
      listen: vi.fn(async () => {
        events.push("proxy-listen");
        revoked = true;
        return { port: 42426 };
      }),
      close,
    });
    const gate = durableGate(events);
    const sandbox = {
      network: true,
      filesystem: { denyRead: [], denyWrite: [] },
      policy: { allowedDomains: ["example.com"], deniedDomains: [] },
    };

    await expect(
      executeAuthorized({ command: "echo sandbox-revoked" }, gate, {
        sandbox,
        permissionRulesProvider,
      }),
    ).rejects.toMatchObject({ code: "CC_SHELL_POLICY_AUTHORITY_CHANGED" });
    expect(events).toEqual(["consume", "proxy-listen", "proxy-close"]);
    expect(sandboxMocks.execute).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
  });

  it("denies when the effective tool ceiling is revoked during consume", async () => {
    const events = [];
    const effectiveAllowedToolNames = ["run_shell"];
    const gate = durableGate(events, {
      onConsume: async () => {
        effectiveAllowedToolNames.splice(0);
      },
    });
    const dispatch = vi.spyOn(executionBroker, "execSync");

    const result = await executeAuthorized(
      { command: "echo capability-revoked" },
      gate,
      { effectiveAllowedToolNames },
    );

    expect(result).toMatchObject({
      policy: { code: "CC_SHELL_POLICY_AUTHORITY_CHANGED" },
    });
    expect(events).toEqual(["consume"]);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("denies when selected tool admission is revoked during consume", async () => {
    const events = [];
    const toolAdmission = {
      enforce: true,
      policyAllowed: true,
      budgetOk: true,
    };
    const gate = durableGate(events, {
      onConsume: async () => {
        toolAdmission.budgetOk = false;
      },
    });
    const dispatch = vi.spyOn(executionBroker, "execSync");

    const result = await executeAuthorized(
      { command: "echo admission-revoked" },
      gate,
      { toolAdmission },
    );

    expect(result).toMatchObject({
      policy: { code: "CC_SHELL_POLICY_AUTHORITY_CHANGED" },
    });
    expect(events).toEqual(["consume"]);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("denies when the live plan authority object is replaced during consume", async () => {
    const events = [];
    const admittedPlanManager = {
      executionLock: null,
      isActive: vi.fn(() => false),
      isToolAllowed: vi.fn(() => true),
    };
    const revokedPlanManager = {
      executionLock: null,
      isActive: vi.fn(() => true),
      isToolAllowed: vi.fn(() => false),
    };
    const context = {
      cwd,
      sessionId: "agent-session",
      planManager: admittedPlanManager,
    };
    const gate = durableGate(events, {
      onConsume: async () => {
        context.planManager = revokedPlanManager;
      },
    });
    context.approvalGate = gate;
    const dispatch = vi.spyOn(executionBroker, "execSync");

    const result = await executeTool(
      "run_shell",
      { command: "echo plan-revoked" },
      context,
    );

    expect(result).toMatchObject({
      policy: { code: "CC_SHELL_POLICY_AUTHORITY_CHANGED" },
    });
    expect(events).toEqual(["consume"]);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("revalidates a legacy Plugin after the sandbox proxy starts", async () => {
    const target = installLegacyNodeBin();
    const events = [];
    const gate = durableGate(events);
    const close = vi.fn(async () => {
      events.push("proxy-close");
    });
    sandboxMocks.createProxy.mockReturnValue({
      listen: vi.fn(async () => {
        events.push("proxy-listen");
        fs.writeFileSync(target, "process.stdout.write('changed');\n", "utf8");
        return { port: 42427 };
      }),
      close,
    });
    const dispatch = vi.spyOn(sandboxMocks, "execute");
    const sandbox = {
      network: true,
      filesystem: { denyRead: [], denyWrite: [] },
      policy: { allowedDomains: ["example.com"], deniedDomains: [] },
    };

    await expect(
      executeAuthorized({ command: "remote-auth-tool --safe" }, gate, {
        sandbox,
      }),
    ).rejects.toMatchObject({
      code: "ERR_PLUGIN_BIN_LAUNCH_AUTHORITY_CHANGED",
    });
    expect(events).toEqual(["consume", "proxy-listen", "proxy-close"]);
    expect(dispatch).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
  });

  it("never calls Broker or the sandbox executor when consume is unknown", async () => {
    const events = [];
    const gate = durableGate(events, {
      consumeError: new Error("coordinator outcome unknown"),
    });
    const execSync = vi.spyOn(executionBroker, "execSync");
    const spawnSync = vi.spyOn(executionBroker, "spawnSync");
    const spawn = vi.spyOn(executionBroker, "spawn");
    const close = vi.fn(async () => {
      events.push("proxy-close");
    });
    sandboxMocks.createProxy.mockReturnValue({
      listen: vi.fn(async () => {
        events.push("proxy-listen");
        return { port: 42425 };
      }),
      close,
    });
    const args = { command: "echo must-not-dispatch" };
    const sandbox = {
      network: true,
      filesystem: { denyRead: [], denyWrite: [] },
      policy: { allowedDomains: ["example.com"], deniedDomains: [] },
    };

    await expect(executeAuthorized(args, gate, { sandbox })).rejects.toThrow(
      /coordinator outcome unknown/,
    );
    expect(events).toEqual(["consume"]);
    expect(execSync).not.toHaveBeenCalled();
    expect(spawnSync).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
    expect(sandboxMocks.execute).not.toHaveBeenCalled();
    expect(sandboxMocks.createProxy).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });

  it("burns the local authorization before a failed consume and never retries it into a background spawn", async () => {
    const events = [];
    const gate = durableGate(events, {
      consumeError: new Error("revoked before consume"),
    });
    const dispatch = vi.spyOn(executionBroker, "spawn");
    const args = { command: "echo revoked", run_in_background: true };

    const tasksBefore = listBackgroundShellTasks().length;
    await expect(executeAuthorized(args, gate)).rejects.toThrow(
      /revoked before consume/,
    );
    expect(events).toEqual(["consume"]);
    expect(gate.consumeAuthorization).toHaveBeenCalledOnce();
    expect(dispatch).not.toHaveBeenCalled();
    expect(listBackgroundShellTasks()).toHaveLength(tasksBefore);
  });
});
