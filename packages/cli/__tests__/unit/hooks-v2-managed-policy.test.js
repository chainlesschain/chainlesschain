import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import path from "node:path";
import { HooksV2Runtime } from "../../src/lib/hooks-v2-runtime.js";

describe("Hooks v2 managed execution policy", () => {
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
