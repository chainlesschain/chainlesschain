import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { executeTool } from "../../src/runtime/agent-core.js";
import { createMcpConflictScheduler } from "../../src/lib/mcp-conflict-scheduler.js";

const TOOL = "mcp__repo__inspect";

function options(cwd, scheduler, mcpClient, effectContract, hostPolicy = null) {
  return {
    cwd,
    mcpClient,
    mcpConflictScheduler: scheduler,
    permissionConfirm: vi.fn(async () => true),
    externalToolDescriptors: {
      [TOOL]: {
        name: TOOL,
        kind: "mcp",
        source: "managed:mcp:repo",
        effectContract,
      },
    },
    externalToolExecutors: {
      [TOOL]: { kind: "mcp", serverName: "repo", toolName: "inspect" },
    },
    ...(hostPolicy
      ? {
          hostManagedToolPolicy: {
            tools: { [TOOL]: hostPolicy },
          },
        }
      : {}),
  };
}

describe("agent-core MCP conflict scheduler integration", () => {
  let cwd;

  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), "cc-mcp-scheduler-"));
  });

  afterEach(() => {
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  it("serializes unknown/untrusted effects before they reach the MCP client", async () => {
    const scheduler = createMcpConflictScheduler();
    let active = 0;
    let maxActive = 0;
    const callTool = vi.fn(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 25));
      active -= 1;
      return { ok: true };
    });
    const shared = options(
      cwd,
      scheduler,
      { callTool },
      {
        declaredEffect: "read",
        authorizedEffect: null,
        sourceTrusted: false,
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
    );

    await Promise.all([
      executeTool(TOOL, { path: "a.txt" }, shared),
      executeTool(TOOL, { path: "b.txt" }, shared),
    ]);

    expect(callTool).toHaveBeenCalledTimes(2);
    expect(maxActive).toBe(1);
    expect(scheduler.snapshot()).toMatchObject({ active: 0, queued: 0 });
  });

  it("permits host-authorized closed-world reads on different scopes", async () => {
    const scheduler = createMcpConflictScheduler();
    let active = 0;
    let maxActive = 0;
    const callTool = vi.fn(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 25));
      active -= 1;
      return { ok: true };
    });
    const shared = options(
      cwd,
      scheduler,
      { callTool },
      {
        declaredEffect: "read",
        authorizedEffect: "read",
        sourceTrusted: true,
        provenance: "managed:mcp-policy",
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      {
        authorizedEffect: "read",
        sourceTrusted: true,
        effectContract: {
          authorizedEffect: "read",
          trusted: true,
          provenance: "managed:mcp-policy",
        },
      },
    );

    await Promise.all([
      executeTool(TOOL, { path: "a.txt" }, shared),
      executeTool(TOOL, { path: "b.txt" }, shared),
    ]);

    expect(maxActive).toBe(2);
    expect(scheduler.snapshot()).toMatchObject({ active: 0, queued: 0 });
  });

  it("does not trust a descriptor that forges host authorization", async () => {
    const scheduler = createMcpConflictScheduler();
    let active = 0;
    let maxActive = 0;
    const callTool = vi.fn(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 25));
      active -= 1;
      return { ok: true };
    });
    const shared = options(
      cwd,
      scheduler,
      { callTool },
      {
        declaredEffect: "read",
        authorizedEffect: "read",
        sourceTrusted: true,
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
    );

    await Promise.all([
      executeTool(TOOL, { path: "a.txt" }, shared),
      executeTool(TOOL, { path: "b.txt" }, shared),
    ]);

    expect(maxActive).toBe(1);
  });

  it("serializes a declared write even when stale host policy authorizes read", async () => {
    const scheduler = createMcpConflictScheduler();
    let active = 0;
    let maxActive = 0;
    const callTool = vi.fn(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 25));
      active -= 1;
      return { ok: true };
    });
    const shared = options(
      cwd,
      scheduler,
      { callTool },
      {
        declaredEffect: "write",
        annotations: { readOnlyHint: false, openWorldHint: false },
      },
      {
        authorizedEffect: "read",
        sourceTrusted: true,
        effectContract: {
          authorizedEffect: "read",
          trusted: true,
          provenance: "stale:host-policy",
        },
      },
    );

    await Promise.all([
      executeTool(TOOL, { path: "a.txt" }, shared),
      executeTool(TOOL, { path: "b.txt" }, shared),
    ]);

    expect(callTool).toHaveBeenCalledTimes(2);
    expect(maxActive).toBe(1);
  });

  it("shares a safe scheduler for direct callers using the same MCP client", async () => {
    let active = 0;
    let maxActive = 0;
    const mcpClient = {
      callTool: vi.fn(async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 25));
        active -= 1;
        return { ok: true };
      }),
    };
    const first = options(cwd, null, mcpClient, {
      declaredEffect: "unknown",
    });
    const second = options(cwd, null, mcpClient, {
      declaredEffect: "unknown",
    });

    await Promise.all([
      executeTool(TOOL, { path: "a.txt" }, first),
      executeTool(TOOL, { path: "b.txt" }, second),
    ]);

    expect(maxActive).toBe(1);
  });
});
