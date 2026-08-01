import { describe, expect, it, vi } from "vitest";
import {
  createMcpHostRecoveryRuntime,
  resolveHostMcpEffect,
} from "../../src/lib/mcp-host-recovery-runtime.js";

function bundle(client) {
  return {
    mcpClient: client,
    externalToolExecutors: {
      mcp__ide__getSelection: {
        kind: "mcp",
        serverName: "ide",
        toolName: "getSelection",
      },
      mcp__ide__openDiff: {
        kind: "mcp",
        serverName: "ide",
        toolName: "openDiff",
      },
      mcp__publisher__publish: {
        kind: "mcp",
        serverName: "publisher",
        toolName: "publish",
      },
    },
    externalToolDescriptors: {
      mcp__ide__getSelection: {
        source: "ide",
        effectContract: { declaredEffect: "read" },
      },
      mcp__ide__openDiff: {
        source: "ide",
        effectContract: { declaredEffect: "unknown" },
      },
      mcp__publisher__publish: {
        source: "publisher",
        effectContract: { declaredEffect: "destructive" },
      },
    },
  };
}

describe("host-owned MCP recovery runtime", () => {
  it("authorizes only the fixed IDE observation allowlist as read", () => {
    const mcp = bundle({ callTool: vi.fn() });
    expect(resolveHostMcpEffect(mcp, "ide", "getSelection")).toMatchObject({
      effectContract: { effect: "read", trusted: true },
    });
    expect(resolveHostMcpEffect(mcp, "ide", "openDiff")).toMatchObject({
      effectContract: { effect: "unknown", trusted: false },
    });
    expect(resolveHostMcpEffect(mcp, "publisher", "publish")).toMatchObject({
      effectContract: { effect: "destructive", trusted: false },
    });
  });

  it("allows IDE reads but blocks openDiff while recovery is unsafe", async () => {
    const callTool = vi.fn(async () => ({ content: [] }));
    const append = vi.fn(async () => true);
    const mcp = bundle({ callTool });
    const runtime = createMcpHostRecoveryRuntime({
      bundle: mcp,
      sessionId: "session-1",
      sink: append,
      recovery: {
        incidents: [],
        unsettled: [{ ledgerId: "outcome-unknown" }],
      },
    });

    await expect(
      runtime.client.callTool("ide", "getSelection", {}),
    ).resolves.toEqual({ content: [] });
    await expect(
      runtime.client.callTool("ide", "openDiff", {}),
    ).rejects.toMatchObject({
      code: "CC_MCP_LEDGER_RECOVERY_BLOCKED",
      effect: "unknown",
      blockMode: "unsafe",
    });
    expect(callTool).toHaveBeenCalledTimes(1);
    expect(append).toHaveBeenCalledTimes(2);
  });

  it("shares dynamic settlement-failure admission with agent-core ledger", async () => {
    let appendCount = 0;
    const mcp = bundle({ callTool: vi.fn(async () => ({ content: [] })) });
    const runtime = createMcpHostRecoveryRuntime({
      bundle: mcp,
      sessionId: "session-1",
      sink: vi.fn(async () => {
        appendCount += 1;
        if (appendCount === 2) throw new Error("settlement unavailable");
        return true;
      }),
      recovery: { incidents: [], unsettled: [] },
    });

    await expect(
      runtime.client.callTool("ide", "getSelection", {}),
    ).rejects.toMatchObject({
      code: "CC_MCP_LEDGER_OUTCOME_UNKNOWN",
      retryable: false,
    });
    await expect(
      runtime.ledger.begin({
        sessionId: "session-1",
        serverName: "publisher",
        toolName: "publish",
        input: {},
        effectContract: { effect: "write" },
      }),
    ).rejects.toMatchObject({ blockMode: "unsafe" });
  });
});
