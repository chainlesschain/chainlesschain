import { describe, expect, it, vi } from "vitest";
import {
  MCP_RECOVERY_INVALID_CODE,
  classifyMcpRecoveryAdmission,
  createRecoveryGuardedMcpCallLedger,
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
