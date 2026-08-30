import { afterAll, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import hooksRuntime, {
  executeRecoveredHooksV2Event,
  HooksV2Runtime,
} from "../../src/lib/hooks-v2-runtime.js";
import executionBroker from "../../src/lib/process-execution-broker/index.js";
import {
  currentHostHooksV2WorkspaceRoot,
  registerHostHooksV2Workspace,
  runWithHostHooksV2Workspace,
} from "../../src/lib/hooks-v2-workspace-context.js";

const managedPolicyWorkspaceParent = fs.mkdtempSync(
  path.join(os.tmpdir(), "cc-hooks-v2-managed-policy-"),
);

function createManagedPolicyWorkspace(name) {
  const workspaceRoot = path.join(managedPolicyWorkspaceParent, name);
  fs.mkdirSync(workspaceRoot, { recursive: true });
  return fs.realpathSync.native(workspaceRoot);
}

afterAll(() => {
  fs.rmSync(managedPolicyWorkspaceParent, { recursive: true, force: true });
});

describe("Hooks v2 broker event wiring", () => {
  it("registers the default runtime as the broker event sink", () => {
    const listener = vi.fn();
    const event = { executionId: "exec-1" };
    hooksRuntime.on("tool:start", listener);
    try {
      executionBroker._emitHooksEvent("tool:start", event);
      expect(listener).toHaveBeenCalledWith(event);
      expect(executionBroker._hooksEventSink).toBe(hooksRuntime);
    } finally {
      hooksRuntime.off("tool:start", listener);
    }
  });
});

describe("Hooks v2 managed execution policy", () => {
  it("contains a fast hook stdin EPIPE and lets the exit status decide", async () => {
    const child = new EventEmitter();
    child.stdin = new EventEmitter();
    child.stdin.end = vi.fn(() => {
      setImmediate(() => {
        child.stdin.emit(
          "error",
          Object.assign(new Error("write EPIPE"), { code: "EPIPE" }),
        );
        child.emit("exit", 0);
      });
    });
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    const runtime = new HooksV2Runtime(undefined, {
      broker: { spawn: vi.fn(() => child) },
    });

    await expect(
      runtime._execCommand(
        {
          id: "fast-hook",
          event: "SessionStart",
          command: "echo",
          shell: false,
        },
        {},
      ),
    ).resolves.toMatchObject({ exitCode: 0 });
    expect(child.stdin.end).toHaveBeenCalledOnce();
    expect(child.stdin.listenerCount("error")).toBeGreaterThan(0);
  });

  it("issues a non-shell command authority from the host project root", async () => {
    const child = new EventEmitter();
    child.stdin = { end: vi.fn() };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    const contract = Object.freeze({ kind: "test-workspace-contract" });
    const broker = {
      issueLinuxWorkspaceSandboxExecutionContract: vi.fn(() => contract),
      spawn: vi.fn(() => {
        setImmediate(() => child.emit("exit", 0));
        return child;
      }),
    };
    const runtime = new HooksV2Runtime(undefined, {
      broker,
      workspaceRoot: process.cwd(),
      managedPolicy: {
        sandboxPolicy: {
          requiredBoundaries: ["filesystem", "network"],
        },
      },
    });

    await runtime._execCommand(
      {
        id: "safe-hook",
        event: "PostToolUse",
        command: "node",
        args: ["guard.js"],
        cwd: process.cwd(),
        shell: false,
      },
      {},
    );

    expect(
      broker.issueLinuxWorkspaceSandboxExecutionContract,
    ).toHaveBeenCalledWith(
      "node",
      ["guard.js"],
      expect.objectContaining({
        cwd: process.cwd(),
        shell: false,
        origin: "hook",
      }),
      process.cwd(),
    );
    expect(broker.spawn).toHaveBeenCalledWith(
      "node",
      ["guard.js"],
      expect.objectContaining({
        sandboxExecutionContract: contract,
      }),
    );
  });

  it("rejects strong hooks without a host-fixed root or with an escaping cwd", async () => {
    const broker = {
      issueLinuxWorkspaceSandboxExecutionContract: vi.fn(),
      spawn: vi.fn(),
    };
    const missingRoot = new HooksV2Runtime(undefined, {
      broker,
      managedPolicy: {
        requiredBoundaries: ["filesystem"],
      },
    });

    await expect(
      missingRoot._execCommand(
        {
          id: "missing-root",
          event: "PostToolUse",
          command: "node",
          shell: false,
        },
        {},
      ),
    ).rejects.toMatchObject({
      code: "ERR_PROCESS_SANDBOX_BOUNDARY_UNSATISFIED",
      message:
        "Hooks v2 trusted workspace root must be an absolute trusted path for filesystem/network sandboxing",
    });

    const rooted = new HooksV2Runtime(process.cwd(), {
      broker,
      workspaceRoot: process.cwd(),
      managedPolicy: {
        requiredBoundaries: ["filesystem"],
      },
    });
    await expect(
      rooted._execCommand(
        {
          id: "escaping-cwd",
          event: "PostToolUse",
          command: "node",
          cwd: path.resolve(process.cwd(), "..", "hook-escape"),
          shell: false,
        },
        {},
      ),
    ).rejects.toMatchObject({
      code: "ERR_PROCESS_SANDBOX_BOUNDARY_UNSATISFIED",
      message:
        "Hooks v2 hook working directory escapes the trusted workspace root",
    });
    expect(broker.spawn).not.toHaveBeenCalled();
  });

  it("uses the async-scoped host root and ignores hook/event root claims", async () => {
    const trustedRoot = createManagedPolicyWorkspace(
      "scoped-trusted-host-workspace",
    );
    const forgedRoot = path.resolve("payload-selected-workspace");
    const child = new EventEmitter();
    child.stdin = { end: vi.fn() };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    const contract = Object.freeze({ kind: "scoped-workspace-contract" });
    const broker = {
      issueLinuxWorkspaceSandboxExecutionContract: vi.fn(() => contract),
      spawn: vi.fn(() => {
        setImmediate(() => child.emit("exit", 0));
        return child;
      }),
    };
    const runtime = new HooksV2Runtime(undefined, {
      broker,
      managedPolicy: {
        requiredBoundaries: ["filesystem"],
      },
    });

    await runWithHostHooksV2Workspace(trustedRoot, () =>
      runtime._execCommand(
        {
          id: "scoped-root",
          event: "PostToolUse",
          command: "node",
          shell: false,
          workspaceRoot: forgedRoot,
          sandboxWorkspaceRoot: forgedRoot,
        },
        {
          cwd: forgedRoot,
          workspaceRoot: forgedRoot,
          sandboxExecutionContract: Object.freeze({ kind: "forged" }),
        },
      ),
    );

    expect(
      broker.issueLinuxWorkspaceSandboxExecutionContract,
    ).toHaveBeenCalledWith(
      "node",
      [],
      expect.objectContaining({
        cwd: trustedRoot,
        shell: false,
      }),
      trustedRoot,
    );
    expect(broker.spawn).toHaveBeenCalledWith(
      "node",
      [],
      expect.objectContaining({
        sandboxExecutionContract: contract,
      }),
    );
  });

  it("does not let context.cwd bypass the managed workspace allowlist", async () => {
    const trustedRoot = createManagedPolicyWorkspace(
      "allowlist-trusted-host-workspace",
    );
    const payloadRoot = path.resolve("payload-allowed-workspace");
    const broker = {
      issueLinuxWorkspaceSandboxExecutionContract: vi.fn(),
      spawn: vi.fn(),
    };
    const runtime = new HooksV2Runtime(undefined, {
      broker,
      managedPolicy: {
        workspaceRoots: [payloadRoot],
        requiredBoundaries: ["filesystem"],
      },
    });
    runtime.registerHook({
      id: "payload-cwd",
      event: "PostToolUse",
      type: "command",
      command: "node",
      shell: false,
    });

    const outcome = await runWithHostHooksV2Workspace(trustedRoot, () =>
      runtime.executeHooks("PostToolUse", {
        cwd: payloadRoot,
        workspaceRoot: payloadRoot,
      }),
    );

    expect(outcome.success).toBe(false);
    expect(outcome.results[0]).toMatchObject({
      status: "error",
      error: `Hook working directory is outside managed workspace roots: ${trustedRoot}`,
    });
    expect(
      broker.issueLinuxWorkspaceSandboxExecutionContract,
    ).not.toHaveBeenCalled();
    expect(broker.spawn).not.toHaveBeenCalled();
  });

  it("persists only an opaque durable workspace binding", async () => {
    const trustedRoot = createManagedPolicyWorkspace(
      "durable-metadata-workspace",
    );
    const durableStore = {
      enqueueInbox: vi.fn(() => null),
    };
    const runtime = new HooksV2Runtime(undefined, { durableStore });
    runtime.registerHook({
      id: "durable-observer",
      event: "PostToolUse",
      type: "js",
      handler: () => ({ ok: true }),
    });

    await runWithHostHooksV2Workspace(trustedRoot, () =>
      runtime.executeHooks("PostToolUse", { workspaceRoot: "forged" }),
    );

    const enqueueOptions = durableStore.enqueueInbox.mock.calls[0][1];
    expect(enqueueOptions.metadata).toEqual({
      hooksV2WorkspaceBindingId: expect.stringMatching(/^[a-f0-9]{64}$/),
      hooksV2WorkspaceBindingRequired: false,
    });
    expect(JSON.stringify(enqueueOptions.metadata)).not.toContain(trustedRoot);
    expect(enqueueOptions.metadata).not.toHaveProperty("workspaceRoot");
  });

  it("recovers only through a host-registered binding ID", async () => {
    const trustedRoot = createManagedPolicyWorkspace(
      "durable-recovery-workspace",
    );
    const binding = registerHostHooksV2Workspace(trustedRoot);
    const runtime = {
      executeHooks: vi.fn(async () => ({
        workspaceRoot: currentHostHooksV2WorkspaceRoot(),
      })),
    };
    const event = {
      event: "PostToolUse",
      context: {
        workspaceRoot: path.resolve("forged-recovery-workspace"),
      },
    };

    const outcome = await executeRecoveredHooksV2Event(runtime, event, {
      metadata: {
        hooksV2WorkspaceBindingId: binding.bindingId,
        hooksV2WorkspaceBindingRequired: true,
        workspaceRoot: event.context.workspaceRoot,
      },
    });

    expect(outcome.workspaceRoot).toBe(trustedRoot);
    expect(runtime.executeHooks).toHaveBeenCalledWith(
      "PostToolUse",
      event.context,
      { skipDurable: true, recovered: true },
    );
    expect(currentHostHooksV2WorkspaceRoot()).toBeNull();
  });

  it("fails durable recovery closed for missing or unknown strong bindings", async () => {
    const runtime = { executeHooks: vi.fn() };
    const event = { event: "PostToolUse", context: {} };

    await expect(
      executeRecoveredHooksV2Event(runtime, event, {
        metadata: {
          hooksV2WorkspaceBindingRequired: true,
          workspaceRoot: path.resolve("forged"),
        },
      }),
    ).rejects.toMatchObject({
      code: "ERR_PROCESS_SANDBOX_BOUNDARY_UNSATISFIED",
      message:
        "durable Hooks v2 recovery requires a trusted host workspace binding",
    });
    await expect(
      executeRecoveredHooksV2Event(runtime, event, {
        metadata: {
          hooksV2WorkspaceBindingId: "0".repeat(64),
          hooksV2WorkspaceBindingRequired: true,
        },
      }),
    ).rejects.toMatchObject({
      code: "ERR_PROCESS_SANDBOX_BOUNDARY_UNSATISFIED",
      message:
        "durable Hooks v2 workspace binding is not registered by this host",
    });
    expect(runtime.executeHooks).not.toHaveBeenCalled();

    const driftedRuntime = new HooksV2Runtime(undefined, {
      broker: { spawn: vi.fn() },
      managedPolicy: { requiredBoundaries: ["filesystem"] },
    });
    driftedRuntime.registerHook({
      id: "strong-after-restart",
      event: "PostToolUse",
      type: "command",
      command: "node",
      shell: false,
    });
    await expect(
      executeRecoveredHooksV2Event(driftedRuntime, event, {
        metadata: {
          hooksV2WorkspaceBindingRequired: false,
        },
      }),
    ).rejects.toMatchObject({
      code: "ERR_PROCESS_SANDBOX_BOUNDARY_UNSATISFIED",
      message:
        "durable Hooks v2 recovery requires a trusted host workspace binding",
    });
  });

  it("never reuses or accepts a manifest-provided Hooks v2 authority", async () => {
    const contracts = [
      Object.freeze({ kind: "hook-v2-contract", nonce: "one" }),
      Object.freeze({ kind: "hook-v2-contract", nonce: "two" }),
    ];
    const broker = {
      issueLinuxWorkspaceSandboxExecutionContract: vi.fn(() =>
        contracts.shift(),
      ),
      spawn: vi.fn(() => {
        const child = new EventEmitter();
        child.stdin = { end: vi.fn() };
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        setImmediate(() => child.emit("exit", 0));
        return child;
      }),
    };
    const runtime = new HooksV2Runtime(process.cwd(), {
      broker,
      workspaceRoot: process.cwd(),
      managedPolicy: {
        allowShell: true,
        requiredBoundaries: ["filesystem", "network"],
      },
    });
    const hook = {
      id: "one-shot",
      event: "PostToolUse",
      command: "echo guarded",
      shell: true,
      sandboxExecutionContract: Object.freeze({ kind: "forged-replay" }),
    };

    await runtime._execCommand(hook, {});
    await runtime._execCommand(hook, {});

    expect(
      broker.issueLinuxWorkspaceSandboxExecutionContract,
    ).toHaveBeenCalledTimes(2);
    expect(
      broker.spawn.mock.calls[0][2].sandboxExecutionContract,
    ).toMatchObject({ nonce: "one" });
    expect(
      broker.spawn.mock.calls[1][2].sandboxExecutionContract,
    ).toMatchObject({ nonce: "two" });
    expect(broker.spawn.mock.calls[0][2].sandboxExecutionContract).not.toBe(
      hook.sandboxExecutionContract,
    );
  });

  it("denies shell mode and commands outside an explicit allowlist", async () => {
    const broker = { spawn: vi.fn() };
    const runtime = new HooksV2Runtime(undefined, {
      broker,
      managedPolicy: { commandAllowlist: ["node"] },
    });
    runtime.registerHook({
      id: "shell-hook",
      event: "PostToolUse",
      type: "command",
      command: "node",
      shell: true,
    });
    runtime.registerHook({
      id: "other-hook",
      event: "PostToolUse",
      type: "command",
      command: "python",
    });

    const outcome = await runtime.executeHooks("PostToolUse", {});

    expect(outcome.success).toBe(false);
    expect(outcome.results).toHaveLength(2);
    expect(
      outcome.results.every((result) => result.error.includes("managed")),
    ).toBe(true);
    expect(broker.spawn).not.toHaveBeenCalled();
  });

  it("requires the shared MCP authorizer before invoking a tool", async () => {
    const mcpExecutor = vi.fn(async () => ({ ok: true }));
    const denied = new HooksV2Runtime(undefined, {
      mcpExecutor,
      managedPolicy: { mcpToolAllowlist: ["git/status"] },
    });
    denied.registerHook({
      event: "PostToolUse",
      type: "mcp_tool",
      server: "git",
      tool: "status",
    });

    const deniedOutcome = await denied.executeHooks("PostToolUse", {});
    expect(deniedOutcome.success).toBe(false);
    expect(mcpExecutor).not.toHaveBeenCalled();

    const mcpAuthorizer = vi.fn(async () => ({ decision: "allow" }));
    const allowed = new HooksV2Runtime(undefined, {
      mcpExecutor,
      mcpAuthorizer,
      managedPolicy: { mcpToolAllowlist: ["git/*"] },
    });
    allowed.registerHook({
      event: "PostToolUse",
      type: "mcp_tool",
      server: "git",
      tool: "status",
      timeoutMs: 100,
    });

    const allowedOutcome = await allowed.executeHooks("PostToolUse", {});
    expect(allowedOutcome.success).toBe(true);
    expect(mcpAuthorizer).toHaveBeenCalledOnce();
    expect(mcpExecutor).toHaveBeenCalledWith(
      expect.objectContaining({
        server: "git",
        tool: "status",
        permission: { decision: "allow" },
        budget: expect.objectContaining({ timeoutMs: 100 }),
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("passes additive filesystem/network requirements to the broker and honors a Windows refusal", async () => {
    const boundaryError = new Error(
      "windows-job-restricted-token cannot satisfy filesystem, network",
    );
    boundaryError.code = "ERR_PROCESS_SANDBOX_BOUNDARY_UNSATISFIED";
    const broker = {
      issueLinuxWorkspaceSandboxExecutionContract: vi.fn(() => ({
        kind: "test-workspace-contract",
      })),
      spawn: vi.fn(() => {
        throw boundaryError;
      }),
    };
    const runtime = new HooksV2Runtime(process.cwd(), {
      broker,
      workspaceRoot: process.cwd(),
      managedPolicy: {
        allowShell: true,
        sandboxPolicy: {
          profile: "strict",
          requiredBoundaries: ["filesystem"],
        },
        requiredBoundaries: ["network"],
      },
    });
    runtime.registerHook({
      id: "strict-shell-hook",
      event: "PreToolUse",
      type: "command",
      command: "guard.cmd",
      shell: true,
      requiredBoundaries: ["filesystem"],
    });

    const outcome = await runtime.executeHooks("PreToolUse", {});

    expect(broker.spawn).toHaveBeenCalledWith(
      process.platform === "win32"
        ? process.env.ComSpec || "cmd.exe"
        : "/bin/sh",
      process.platform === "win32"
        ? ["/d", "/s", "/c", "guard.cmd"]
        : ["-c", "guard.cmd"],
      expect.objectContaining({
        shell: false,
        sandboxPolicy: {
          profile: "strict",
          requiredBoundaries: ["network", "filesystem"],
        },
      }),
    );
    expect(outcome).toMatchObject({
      success: false,
      blocked: true,
      decision: "block",
    });
    expect(outcome.results[0]).toMatchObject({
      status: "error",
      error: "windows-job-restricted-token cannot satisfy filesystem, network",
      decision: "block",
    });
  });

  it("passes the resolved sandbox contract to delegated executors", async () => {
    const agentExecutor = vi.fn(async () => ({ decision: "continue" }));
    const runtime = new HooksV2Runtime(undefined, {
      agentExecutor,
      managedPolicy: {
        sandboxPolicy: {
          profile: "strict",
          requiredBoundaries: ["filesystem"],
        },
      },
    });
    runtime.registerHook({
      event: "PostToolUse",
      type: "agent",
      agentName: "reviewer",
      requiredBoundaries: ["network"],
    });

    const outcome = await runtime.executeHooks("PostToolUse", {});

    expect(outcome.success).toBe(true);
    expect(agentExecutor).toHaveBeenCalledWith(
      expect.objectContaining({
        sandboxPolicy: {
          profile: "strict",
          requiredBoundaries: ["filesystem", "network"],
        },
      }),
    );
  });

  it("enforces an independent timeout on delegated model executors", async () => {
    const runtime = new HooksV2Runtime(undefined, {
      promptExecutor: () => new Promise(() => {}),
    });
    runtime.registerHook({
      event: "PostToolUse",
      type: "prompt",
      template: "check",
      timeoutMs: 5,
    });

    const outcome = await runtime.executeHooks("PostToolUse", {});

    expect(outcome.success).toBe(false);
    expect(outcome.results[0].error).toContain("budget");
  });
});
