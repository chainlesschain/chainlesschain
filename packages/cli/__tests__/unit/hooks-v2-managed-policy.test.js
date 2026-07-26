import { describe, expect, it, vi } from "vitest";
import { HooksV2Runtime } from "../../src/lib/hooks-v2-runtime.js";

describe("Hooks v2 managed execution policy", () => {
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
    expect(outcome.results.every((result) =>
      result.error.includes("managed"),
    )).toBe(true);
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
