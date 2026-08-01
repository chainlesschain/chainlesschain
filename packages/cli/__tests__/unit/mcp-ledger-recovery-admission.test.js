import { describe, expect, it, vi } from "vitest";
import {
  MCP_OUTCOME_UNKNOWN_CODE,
  MCP_RECOVERY_INVALID_CODE,
  classifyMcpRecoveryAdmission,
  createMcpRecoveryAdmissionController,
  createRecoveryGuardedMcpCallLedger,
  createRecoveryGuardedMcpClient,
  guardMcpLedgerForRecovery,
} from "../../src/lib/mcp-ledger-recovery-admission.js";
import { executeTool } from "../../src/runtime/agent-core.js";

function call(effect) {
  return {
    toolName: "mcp__repo__publish",
    serverName: "repo",
    effectContract: { effect },
  };
}

describe("MCP ledger recovery admission", () => {
  it("blocks every MCP effect after an incident or verified-read failure", async () => {
    const begin = vi.fn();
    const incidentGuard = guardMcpLedgerForRecovery(
      { begin },
      { incidents: [{ code: "CORRUPT" }], unsettled: [] },
    );
    await expect(incidentGuard.begin(call("read"))).rejects.toMatchObject({
      code: "CC_MCP_LEDGER_RECOVERY_BLOCKED",
      effect: "read",
      blockMode: "all",
    });

    const readFailureGuard = guardMcpLedgerForRecovery({ begin }, null, {
      recoveryError: new Error("unverified"),
    });
    await expect(readFailureGuard.begin(call("write"))).rejects.toMatchObject({
      code: "CC_MCP_LEDGER_RECOVERY_BLOCKED",
      blockMode: "all",
    });
    expect(begin).not.toHaveBeenCalled();
  });

  it("allows reads but blocks unsafe effects while calls are unsettled", async () => {
    const begin = vi.fn(async () => ({ ledgerId: "new-read" }));
    const guarded = guardMcpLedgerForRecovery(
      { begin },
      { incidents: [], unsettled: [{ ledgerId: "old-write" }] },
    );

    await expect(guarded.begin(call("read"))).resolves.toEqual({
      ledgerId: "new-read",
    });
    await expect(guarded.begin(call("destructive"))).rejects.toMatchObject({
      code: "CC_MCP_LEDGER_RECOVERY_BLOCKED",
      effect: "destructive",
      blockMode: "unsafe",
    });
    expect(begin).toHaveBeenCalledTimes(1);
  });

  it("delegates byte-identically when recovery is clean", () => {
    const ledger = { begin: vi.fn() };
    expect(
      guardMcpLedgerForRecovery(ledger, { incidents: [], unsettled: [] }),
    ).toBe(ledger);
    expect(classifyMcpRecoveryAdmission(null).blockMode).toBeNull();
  });

  it.each([
    ["primitive", "invalid"],
    ["array", []],
    ["promise", Promise.resolve({ incidents: [], unsettled: [] })],
    ["thenable", { then() {}, incidents: [], unsettled: [] }],
    ["missing fields", {}],
    ["missing incidents", { unsettled: [] }],
    ["missing unsettled", { incidents: [] }],
    ["null incidents", { incidents: null, unsettled: [] }],
    ["object incidents", { incidents: {}, unsettled: [] }],
    ["null unsettled", { incidents: [], unsettled: null }],
    ["promise unsettled", { incidents: [], unsettled: Promise.resolve([]) }],
    [
      "invalid explicit block mode",
      { incidents: [], unsettled: [], blockMode: "unexpected" },
    ],
  ])("fails closed on a malformed %s recovery", (_label, recovery) => {
    expect(classifyMcpRecoveryAdmission(recovery)).toMatchObject({
      blockMode: "all",
      reasonCode: MCP_RECOVERY_INVALID_CODE,
    });
  });

  it("fails closed when recovery property access throws", () => {
    const recovery = Object.defineProperty({}, "incidents", {
      get() {
        throw new Error("untrusted projection");
      },
    });

    expect(classifyMcpRecoveryAdmission(recovery)).toMatchObject({
      blockMode: "all",
      reasonCode: MCP_RECOVERY_INVALID_CODE,
    });
  });

  it("rejects accessors without invoking a time-varying projection", () => {
    let reads = 0;
    const recovery = { unsettled: [] };
    Object.defineProperty(recovery, "incidents", {
      get() {
        reads += 1;
        return reads === 1 ? [{ code: "CORRUPT" }] : [];
      },
    });

    expect(classifyMcpRecoveryAdmission(recovery)).toMatchObject({
      blockMode: "all",
      reasonCode: MCP_RECOVERY_INVALID_CODE,
    });
    expect(reads).toBe(0);
  });

  it.each([
    [
      "recovery object",
      new Proxy(
        { incidents: [{ code: "CORRUPT" }], unsettled: [] },
        {
          get(target, key, receiver) {
            if (key === "incidents") return [];
            return Reflect.get(target, key, receiver);
          },
        },
      ),
    ],
    [
      "incidents array",
      {
        incidents: new Proxy([{ code: "CORRUPT" }], {}),
        unsettled: [],
      },
    ],
    [
      "unsettled array",
      {
        incidents: [],
        unsettled: new Proxy([{ ledgerId: "pending" }], {}),
      },
    ],
  ])("fails closed on a proxied %s", (_label, recovery) => {
    expect(classifyMcpRecoveryAdmission(recovery)).toMatchObject({
      blockMode: "all",
      reasonCode: MCP_RECOVERY_INVALID_CODE,
    });
  });

  it("rejects inherited projection fields and accessor block modes", () => {
    const inherited = Object.create({ incidents: [], unsettled: [] });
    const accessorMode = { incidents: [], unsettled: [] };
    Object.defineProperty(accessorMode, "blockMode", {
      get() {
        return "unsafe";
      },
    });

    for (const recovery of [inherited, accessorMode]) {
      expect(classifyMcpRecoveryAdmission(recovery)).toMatchObject({
        blockMode: "all",
        reasonCode: MCP_RECOVERY_INVALID_CODE,
      });
    }
  });

  it("accepts ordinary mutable, frozen, and null-prototype projections", () => {
    const projections = [
      { incidents: [], unsettled: [] },
      Object.freeze({
        incidents: Object.freeze([]),
        unsettled: Object.freeze([]),
      }),
      Object.assign(Object.create(null), { incidents: [], unsettled: [] }),
    ];

    for (const recovery of projections) {
      expect(classifyMcpRecoveryAdmission(recovery)).toMatchObject({
        blockMode: null,
        incidents: 0,
        unsettled: 0,
        reasonCode: null,
      });
    }
  });

  it("uses the stable invalid-recovery code unless the caller overrides it", async () => {
    const begin = vi.fn();
    const malformed = { incidents: [], unsettled: null };
    const guarded = guardMcpLedgerForRecovery({ begin }, malformed);
    await expect(guarded.begin(call("read"))).rejects.toMatchObject({
      code: MCP_RECOVERY_INVALID_CODE,
      blockMode: "all",
    });

    const customGuard = guardMcpLedgerForRecovery({ begin }, malformed, {
      code: "CC_COWORK_MCP_RECOVERY_BLOCKED",
    });
    await expect(customGuard.begin(call("read"))).rejects.toMatchObject({
      code: "CC_COWORK_MCP_RECOVERY_BLOCKED",
      blockMode: "all",
    });
    expect(begin).not.toHaveBeenCalled();
  });

  it("keeps an explicit factory block mode structurally valid", () => {
    const guarded = createRecoveryGuardedMcpCallLedger({ blockMode: "all" });
    expect(guarded.recoveryAdmission).toMatchObject({
      blockMode: "all",
      incidents: 0,
      unsettled: 0,
      reasonCode: null,
    });
  });

  it("does not launder a proxied recovery through a factory block-mode override", async () => {
    const recovery = new Proxy(
      { incidents: [{ code: "CORRUPT" }], unsettled: [] },
      {
        get(target, key, receiver) {
          if (key === "incidents") return [];
          return Reflect.get(target, key, receiver);
        },
      },
    );
    const guarded = createRecoveryGuardedMcpCallLedger({
      recovery,
      blockMode: "unsafe",
    });

    await expect(guarded.begin(call("read"))).rejects.toMatchObject({
      code: MCP_RECOVERY_INVALID_CODE,
      blockMode: "all",
    });
  });

  it("reads controller admission dynamically and keeps runtime latches monotonic", async () => {
    const controller = createMcpRecoveryAdmissionController({
      incidents: [],
      unsettled: [],
    });
    const ledger = {
      begin: vi.fn(async () => ({ ledgerId: "dynamic", settle: vi.fn() })),
    };
    const guarded = guardMcpLedgerForRecovery(ledger, controller);

    await expect(guarded.begin(call("unknown"))).resolves.toMatchObject({
      ledgerId: "dynamic",
    });
    controller.latchUnsafe("CC_TEST_UNSAFE");
    await expect(guarded.begin(call("unknown"))).rejects.toMatchObject({
      blockMode: "unsafe",
      effect: "unknown",
    });
    await expect(guarded.begin(call("read"))).resolves.toMatchObject({
      ledgerId: "dynamic",
    });

    controller.latchAll("CC_TEST_ALL");
    controller.latchUnsafe("CC_TEST_CANNOT_DOWNGRADE");
    expect(controller.admission.blockMode).toBe("all");
    await expect(guarded.begin(call("read"))).rejects.toMatchObject({
      blockMode: "all",
      effect: "read",
    });

    controller.replaceVerifiedRecovery({ incidents: [], unsettled: [] });
    expect(guarded.recoveryAdmission.blockMode).toBeNull();
    await expect(guarded.begin(call("unknown"))).resolves.toMatchObject({
      ledgerId: "dynamic",
    });
    expect(ledger.begin).toHaveBeenCalledTimes(3);
  });

  it("latches invalid verified replacements to all until an explicit valid replacement", () => {
    const controller = createMcpRecoveryAdmissionController();
    controller.replaceVerifiedRecovery(
      Promise.resolve({ incidents: [], unsettled: [] }),
    );
    expect(controller.admission).toMatchObject({
      blockMode: "all",
      reasonCode: MCP_RECOVERY_INVALID_CODE,
    });

    controller.latchUnsafe();
    expect(controller.admission.blockMode).toBe("all");
    controller.replaceVerifiedRecovery({ incidents: [], unsettled: [] });
    expect(controller.admission).toMatchObject({
      blockMode: null,
      reasonCode: null,
    });
  });

  it("latches unsafe when ticket settlement methods cannot persist", async () => {
    const settlementError = Object.assign(new Error("disk unavailable"), {
      code: "CC_MCP_LEDGER_SETTLE_FAILED",
    });
    const controller = createMcpRecoveryAdmissionController();
    const ticket = {
      ledgerId: "settle-ticket",
      settle: vi.fn().mockRejectedValue(settlementError),
      settleCall: vi.fn().mockRejectedValue(settlementError),
    };
    const guarded = guardMcpLedgerForRecovery(
      { begin: vi.fn(async () => ticket) },
      controller,
    );
    const guardedTicket = await guarded.begin(call("read"));

    await expect(guardedTicket.settle({ status: "completed" })).rejects.toBe(
      settlementError,
    );
    expect(controller.admission).toMatchObject({
      blockMode: "unsafe",
      reasonCode: "CC_MCP_LEDGER_SETTLE_FAILED",
    });

    controller.replaceVerifiedRecovery({ incidents: [], unsettled: [] });
    await expect(
      guardedTicket.settleCall({ status: "completed" }),
    ).rejects.toBe(settlementError);
    expect(controller.admission.blockMode).toBe("unsafe");
  });

  it("records raw host success, protocol errors, and thrown errors exactly once", async () => {
    const success = { content: [{ type: "text", text: "ok" }] };
    const protocolError = { isError: true, content: [] };
    const transportError = new Error("transport closed");
    const callTool = vi
      .fn()
      .mockResolvedValueOnce(success)
      .mockResolvedValueOnce(protocolError)
      .mockRejectedValueOnce(transportError);
    const settle = vi.fn().mockResolvedValue({});
    let sequence = 0;
    const begin = vi.fn(async () => ({
      ledgerId: `host-${++sequence}`,
      settle,
    }));
    const controller = createMcpRecoveryAdmissionController();
    const client = createRecoveryGuardedMcpClient({
      client: { callTool },
      ledger: { begin },
      controller,
      resolveEffect: () => "read",
      sessionId: "session-host",
    });

    await expect(client.callTool("repo", "status", { n: 1 })).resolves.toBe(
      success,
    );
    await expect(client.callTool("repo", "status", { n: 2 })).resolves.toBe(
      protocolError,
    );
    await expect(client.callTool("repo", "status", { n: 3 })).rejects.toBe(
      transportError,
    );

    expect(begin).toHaveBeenCalledTimes(3);
    expect(callTool).toHaveBeenCalledTimes(3);
    expect(settle).toHaveBeenCalledTimes(3);
    expect(begin.mock.invocationCallOrder[0]).toBeLessThan(
      callTool.mock.invocationCallOrder[0],
    );
    expect(begin).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        sessionId: "session-host",
        serverName: "repo",
        toolName: "status",
        input: { n: 1 },
        effectContract: expect.objectContaining({ effect: "read" }),
      }),
    );
    expect(settle).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ status: "completed", output: success }),
    );
    expect(settle).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        status: "failed",
        output: protocolError,
        error: expect.objectContaining({ code: "CC_MCP_PROTOCOL_TOOL_ERROR" }),
      }),
    );
    expect(settle).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ status: "failed", error: transportError }),
    );
  });

  it("blocks unknown host calls under unsafe and every host call under all", async () => {
    const callTool = vi.fn(async () => ({ ok: true }));
    const settle = vi.fn(async () => ({}));
    const begin = vi.fn(async () => ({ ledgerId: "host-read", settle }));
    const controller = createMcpRecoveryAdmissionController({
      incidents: [],
      unsettled: [{ ledgerId: "prior" }],
    });
    const client = createRecoveryGuardedMcpClient({
      client: { callTool },
      ledger: { begin },
      controller,
      resolveEffect: (_server, toolName) =>
        toolName === "status" ? "read" : undefined,
    });

    await expect(client.callTool("repo", "status", {})).resolves.toEqual({
      ok: true,
    });
    await expect(client.callTool("repo", "publish", {})).rejects.toMatchObject({
      blockMode: "unsafe",
      effect: "unknown",
    });
    controller.latchAll();
    await expect(client.callTool("repo", "status", {})).rejects.toMatchObject({
      blockMode: "all",
      effect: "read",
    });
    expect(begin).toHaveBeenCalledTimes(1);
    expect(callTool).toHaveBeenCalledTimes(1);
    expect(settle).toHaveBeenCalledTimes(1);
  });

  it("throws a stable outcome-unknown error and latches unsafe on settle failure", async () => {
    const settlementError = Object.assign(new Error("append failed"), {
      code: "CC_MCP_LEDGER_SETTLE_FAILED",
    });
    const controller = createMcpRecoveryAdmissionController();
    const callTool = vi.fn(async () => ({ ok: true }));
    const begin = vi.fn(async () => ({
      ledgerId: "host-unknown",
      settle: vi.fn().mockRejectedValue(settlementError),
    }));
    const client = createRecoveryGuardedMcpClient({
      client: { callTool },
      ledger: { begin },
      controller,
    });

    await expect(client.callTool("repo", "publish", {})).rejects.toMatchObject({
      code: MCP_OUTCOME_UNKNOWN_CODE,
      ledgerId: "host-unknown",
      effect: "unknown",
      phase: "settled",
      outcomeUnknown: true,
      retryable: false,
    });
    expect(controller.admission).toMatchObject({
      blockMode: "unsafe",
      reasonCode: "CC_MCP_LEDGER_SETTLE_FAILED",
    });
    await expect(client.callTool("repo", "publish", {})).rejects.toMatchObject({
      blockMode: "unsafe",
      effect: "unknown",
    });
    expect(callTool).toHaveBeenCalledTimes(1);
    expect(begin).toHaveBeenCalledTimes(1);
  });

  it("preserves this binding and event-style chaining for unwrapped client methods", () => {
    const listener = vi.fn();
    const rawClient = {
      value: 7,
      listeners: [],
      callTool: vi.fn(),
      getValue() {
        return this.value;
      },
      on(callback) {
        this.listeners.push(callback);
        return this;
      },
      emit(value) {
        for (const callback of this.listeners) callback(value);
        return this;
      },
    };
    const controller = createMcpRecoveryAdmissionController();
    const client = createRecoveryGuardedMcpClient({
      client: rawClient,
      ledger: { begin: vi.fn() },
      controller,
    });

    expect(client.getValue()).toBe(7);
    expect(client.getValue).toBe(client.getValue);
    expect(client.on(listener)).toBe(client);
    expect(client.emit("event")).toBe(client);
    expect(listener).toHaveBeenCalledWith("event");
  });

  it("keeps the recovery code diagnosable when agent-core blocks callTool", async () => {
    const callTool = vi.fn();
    const ledger = guardMcpLedgerForRecovery(
      { begin: vi.fn() },
      { incidents: [{ code: "CORRUPT" }], unsettled: [] },
    );
    const toolName = "mcp__repo__status";

    const result = await executeTool(
      toolName,
      {},
      {
        cwd: process.cwd(),
        sessionId: "session-recovery",
        turnId: "turn-recovery",
        mcpClient: { callTool },
        mcpCallLedger: ledger,
        externalToolDescriptors: {
          [toolName]: {
            name: toolName,
            kind: "mcp",
            category: "mcp",
            source: "mcp:repo",
            effectContract: {
              declaredEffect: "read",
              authorizedEffect: "read",
              sourceTrusted: true,
            },
          },
        },
        externalToolExecutors: {
          [toolName]: {
            kind: "mcp",
            serverName: "repo",
            toolName: "status",
          },
        },
      },
    );

    expect(result.policy).toMatchObject({
      decision: "blocked",
      via: "mcp-ledger-prewrite",
      code: "CC_MCP_LEDGER_RECOVERY_BLOCKED",
      effect: "unknown",
      blockMode: "all",
    });
    expect(callTool).not.toHaveBeenCalled();
  });
});
