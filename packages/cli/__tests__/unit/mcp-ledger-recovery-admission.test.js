import { describe, expect, it, vi } from "vitest";
import {
  classifyMcpRecoveryAdmission,
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

  it("fails closed on a malformed explicit block mode", () => {
    expect(
      classifyMcpRecoveryAdmission({ blockMode: "unexpected" }).blockMode,
    ).toBe("all");
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
