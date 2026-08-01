import { describe, expect, it, vi } from "vitest";
import {
  createMcpHostRecoveryRuntime,
  resolveHostMcpEffect,
} from "../../src/lib/mcp-host-recovery-runtime.js";
import { createMcpRecoveryAdmissionController } from "../../src/lib/mcp-ledger-recovery-admission.js";

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
  it("never grants read authority from server names or declarations", () => {
    const mcp = bundle({ callTool: vi.fn() });
    expect(resolveHostMcpEffect(mcp, "ide", "getSelection")).toMatchObject({
      effectContract: { effect: "unknown", trusted: false },
    });
    expect(resolveHostMcpEffect(mcp, "ide", "openDiff")).toMatchObject({
      effectContract: { effect: "unknown", trusted: false },
    });
    expect(resolveHostMcpEffect(mcp, "publisher", "publish")).toMatchObject({
      effectContract: { effect: "destructive", trusted: false },
    });
  });

  it("blocks every auxiliary call while recovery is unsafe without a capability", async () => {
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
    ).rejects.toMatchObject({
      code: "CC_MCP_LEDGER_RECOVERY_BLOCKED",
      effect: "unknown",
      blockMode: "unsafe",
    });
    await expect(
      runtime.client.callTool("ide", "openDiff", {}),
    ).rejects.toMatchObject({
      code: "CC_MCP_LEDGER_RECOVERY_BLOCKED",
      effect: "unknown",
      blockMode: "unsafe",
    });
    expect(callTool).not.toHaveBeenCalled();
    expect(append).not.toHaveBeenCalled();
  });

  it("blocks an explicit user server spoofing an IDE observation tool", async () => {
    const callTool = vi.fn(async () => ({ content: [] }));
    const append = vi.fn(async () => true);
    const mcp = bundle({ callTool });
    mcp.externalToolDescriptors.mcp__ide__getSelection = {
      source: "project:user-server",
      effectContract: { declaredEffect: "destructive" },
    };
    const runtime = createMcpHostRecoveryRuntime({
      bundle: mcp,
      sessionId: "session-spoof",
      sink: append,
      recovery: {
        incidents: [],
        unsettled: [{ ledgerId: "prior-unknown" }],
      },
    });

    await expect(
      runtime.client.callTool("ide", "getSelection", {}),
    ).rejects.toMatchObject({
      code: "CC_MCP_LEDGER_RECOVERY_BLOCKED",
      effect: "destructive",
      blockMode: "unsafe",
    });
    expect(callTool).not.toHaveBeenCalled();
    expect(append).not.toHaveBeenCalled();
  });

  it("monotonically tightens a supplied controller with new recovery evidence", async () => {
    const rawClient = { callTool: vi.fn(async () => ({ content: [] })) };
    const mcp = bundle(rawClient);
    const controller = createMcpRecoveryAdmissionController({
      incidents: [],
      unsettled: [],
    });

    const unsafeRuntime = createMcpHostRecoveryRuntime({
      bundle: mcp,
      sessionId: "session-controller",
      sink: vi.fn(async () => true),
      controller,
      recovery: {
        incidents: [],
        unsettled: [{ ledgerId: "prior-unknown" }],
      },
    });
    expect(unsafeRuntime.controller).toBe(controller);
    expect(controller.admission.blockMode).toBe("unsafe");
    await expect(
      unsafeRuntime.client.callTool("publisher", "publish", {}),
    ).rejects.toMatchObject({
      code: "CC_MCP_LEDGER_RECOVERY_BLOCKED",
      blockMode: "unsafe",
    });
    expect(rawClient.callTool).not.toHaveBeenCalled();

    createMcpHostRecoveryRuntime({
      bundle: mcp,
      sessionId: "session-controller",
      sink: vi.fn(async () => true),
      controller,
      recovery: { incidents: [], unsettled: [] },
    });
    expect(controller.admission.blockMode).toBe("unsafe");

    createMcpHostRecoveryRuntime({
      bundle: mcp,
      sessionId: "session-controller",
      sink: vi.fn(async () => true),
      controller,
      recovery: { incidents: [], unsettled: [] },
      recoveryError: Object.assign(new Error("verified read failed"), {
        code: "CC_TEST_RECOVERY_READ_FAILED",
      }),
    });
    expect(controller.admission).toMatchObject({
      blockMode: "all",
      reasonCode: "CC_TEST_RECOVERY_READ_FAILED",
    });
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

  it("treats a raw transport failure as outcome unknown", async () => {
    const transportError = Object.assign(new Error("socket reset"), {
      code: "ECONNRESET",
    });
    const callTool = vi.fn().mockRejectedValue(transportError);
    const append = vi.fn(async () => true);
    const runtime = createMcpHostRecoveryRuntime({
      bundle: bundle({ callTool }),
      sessionId: "session-transport",
      sink: append,
      recovery: { incidents: [], unsettled: [] },
    });

    await expect(
      runtime.client.callTool("publisher", "publish", {}),
    ).rejects.toMatchObject({
      code: "CC_MCP_LEDGER_OUTCOME_UNKNOWN",
      effect: "destructive",
      phase: "call",
      outcomeUnknown: true,
      retryable: false,
      cause: transportError,
    });
    expect(callTool).toHaveBeenCalledTimes(1);
    expect(append).toHaveBeenCalledTimes(1);
    expect(append).toHaveBeenCalledWith(
      expect.objectContaining({ status: "started" }),
      expect.objectContaining({ phase: "started" }),
    );
    expect(runtime.controller.admission).toMatchObject({
      blockMode: "unsafe",
      reasonCode: "ECONNRESET",
    });
  });

  it("supports a frozen client without violating Proxy invariants", async () => {
    const callTool = vi.fn(async () => ({ content: [] }));
    const rawClient = Object.freeze({ callTool });
    const append = vi.fn(async () => true);
    const runtime = createMcpHostRecoveryRuntime({
      bundle: bundle(rawClient),
      sessionId: "session-frozen",
      sink: append,
      recovery: { incidents: [], unsettled: [] },
    });

    await expect(
      runtime.client.callTool("ide", "getSelection", {}),
    ).resolves.toEqual({ content: [] });
    expect(callTool).toHaveBeenCalledTimes(1);
    expect(append).toHaveBeenCalledTimes(2);
  });
});
