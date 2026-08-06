import { describe, expect, it, vi } from "vitest";
import {
  MCP_EXACT_REPLAY_DENIED_CODE,
  MCP_OUTCOME_UNKNOWN_CODE,
  MCP_RECOVERY_DENY_REGRESSION_CODE,
  MCP_RECOVERY_INVALID_CODE,
  classifyMcpRecoveryAdmission,
  createMcpRecoveryAdmissionController,
  createRecoveryGuardedMcpCallLedger,
  createRecoveryGuardedMcpClient,
  guardMcpLedgerForRecovery,
  markMcpLedgerOutcomeUnknown,
} from "../../src/lib/mcp-ledger-recovery-admission.js";
import {
  computeMcpExactReplayDigest,
  createMcpCallLedger,
  summarizeMcpPayload,
} from "../../src/lib/mcp-call-ledger.js";
import { deriveMcpExactReplayDenies } from "../../src/lib/mcp-call-ledger-store.js";
import { executeTool } from "../../src/runtime/agent-core.js";

function call(effect, { trusted = effect === "read", input = {} } = {}) {
  return {
    toolName: "publish",
    serverName: "repo",
    input,
    effectContract: { effect, trusted },
  };
}

function replayDeny(input = {}) {
  const summary = summarizeMcpPayload(input);
  return {
    ledgerId: "mcp-confirmed-applied",
    serverName: "repo",
    toolName: "publish",
    inputBytes: summary.bytes,
    replayDigest: computeMcpExactReplayDigest({
      serverName: "repo",
      toolName: "publish",
      inputDigest: summary.sha256,
      inputBytes: summary.bytes,
    }),
  };
}

describe("MCP ledger recovery admission", () => {
  it("blocks every MCP effect after an incident or verified-read failure", async () => {
    const begin = vi.fn();
    const incidentGuard = guardMcpLedgerForRecovery(
      { begin },
      { incidents: [{ code: "CORRUPT" }], unsettled: [], replayDenied: [] },
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
      {
        incidents: [],
        unsettled: [{ ledgerId: "old-write" }],
        replayDenied: [],
      },
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

  it("downgrades an untrusted read to unknown under unsafe recovery", async () => {
    const begin = vi.fn();
    const guarded = guardMcpLedgerForRecovery(
      { begin },
      {
        incidents: [],
        unsettled: [{ ledgerId: "old-write" }],
        replayDenied: [],
      },
    );

    await expect(
      guarded.begin(call("read", { trusted: false })),
    ).rejects.toMatchObject({
      blockMode: "unsafe",
      effect: "unknown",
    });
    expect(begin).not.toHaveBeenCalled();
  });

  it("delegates byte-identically when recovery is clean", () => {
    const ledger = { begin: vi.fn() };
    expect(
      guardMcpLedgerForRecovery(ledger, {
        incidents: [],
        unsettled: [],
        replayDenied: [],
      }),
    ).toBe(ledger);
    expect(classifyMcpRecoveryAdmission(null).blockMode).toBeNull();
  });

  it.each(["read", "unknown", "write", "destructive"])(
    "denies an exact confirmed-applied replay classified as %s",
    async (effect) => {
      const begin = vi.fn();
      const input = { repository: "owner/repo", release: 7 };
      const guarded = guardMcpLedgerForRecovery(
        { begin },
        {
          incidents: [],
          unsettled: [],
          replayDenied: [replayDeny(input)],
        },
      );

      await expect(
        guarded.begin({
          ...call(effect, { trusted: true, input }),
          resourceScopes: [`metadata-change-${effect}`],
          networkScopes: [`https://changed.example/${effect}`],
        }),
      ).rejects.toMatchObject({
        code: MCP_EXACT_REPLAY_DENIED_CODE,
        replayDenied: true,
        retryable: false,
        effect,
      });
      expect(begin).not.toHaveBeenCalled();
    },
  );

  it("allows a different canonical input while retaining an exact deny", async () => {
    const begin = vi.fn(async () => ({ ledgerId: "different-input" }));
    const guarded = guardMcpLedgerForRecovery(
      { begin },
      {
        incidents: [],
        unsettled: [],
        replayDenied: [replayDeny({ release: 1 })],
      },
    );

    await expect(
      guarded.begin(call("write", { input: { release: 2 } })),
    ).resolves.toEqual({ ledgerId: "different-input" });
    expect(begin).toHaveBeenCalledOnce();
  });

  it("matches both exact candidates for ambiguous historical tool identities", async () => {
    const input = { release: 9 };
    const summary = summarizeMcpPayload(input);
    const historical = {
      ledgerId: "historical-model-or-host-call",
      serverName: "repo",
      toolName: "mcp__repo__publish",
      inputDigest: summary.sha256,
      inputBytes: summary.bytes,
    };
    const candidates = deriveMcpExactReplayDenies(historical);
    expect(candidates.map((entry) => entry.toolName)).toEqual([
      "mcp__repo__publish",
      "publish",
    ]);
    const rawHostGuard = guardMcpLedgerForRecovery(
      { begin: vi.fn() },
      { incidents: [], unsettled: [], replayDenied: candidates },
    );

    await expect(
      rawHostGuard.begin({
        serverName: "repo",
        toolName: "publish",
        input,
        effectContract: { effect: "write" },
      }),
    ).rejects.toMatchObject({ code: MCP_EXACT_REPLAY_DENIED_CODE });

    const prefixedRawTool = "mcp__repo__publish";
    const prefixedGuard = guardMcpLedgerForRecovery(
      { begin: vi.fn() },
      { incidents: [], unsettled: [], replayDenied: candidates },
    );
    await expect(
      prefixedGuard.begin({
        serverName: "repo",
        toolName: prefixedRawTool,
        input,
        effectContract: { effect: "write" },
      }),
    ).rejects.toMatchObject({ code: MCP_EXACT_REPLAY_DENIED_CODE });
  });

  it("fails closed on malformed or truncated exact replay authority", async () => {
    const malformed = replayDeny({ release: 1 });
    delete malformed.inputBytes;
    malformed.inputDigest = `sha256:${"a".repeat(64)}`;
    const begin = vi.fn();
    const guarded = guardMcpLedgerForRecovery(
      { begin },
      { incidents: [], unsettled: [], replayDenied: [malformed] },
    );

    await expect(guarded.begin(call("read"))).rejects.toMatchObject({
      code: MCP_RECOVERY_INVALID_CODE,
      blockMode: "all",
    });
    expect(begin).not.toHaveBeenCalled();
  });

  it("fails closed on uppercase replay digests instead of accepting an inert deny", async () => {
    const uppercase = replayDeny({ release: 1 });
    uppercase.replayDigest = uppercase.replayDigest.toUpperCase();
    const begin = vi.fn();
    const guarded = guardMcpLedgerForRecovery(
      { begin },
      { incidents: [], unsettled: [], replayDenied: [uppercase] },
    );

    await expect(
      guarded.begin(call("read", { input: { release: 1 } })),
    ).rejects.toMatchObject({
      code: MCP_RECOVERY_INVALID_CODE,
      blockMode: "all",
    });
    expect(begin).not.toHaveBeenCalled();
  });

  it.each([
    ["primitive", "invalid"],
    ["array", []],
    [
      "promise",
      Promise.resolve({ incidents: [], unsettled: [], replayDenied: [] }),
    ],
    ["thenable", { then() {}, incidents: [], unsettled: [], replayDenied: [] }],
    ["missing fields", {}],
    ["missing replay denied", { incidents: [], unsettled: [] }],
    ["missing incidents", { unsettled: [] }],
    ["missing unsettled", { incidents: [] }],
    ["null incidents", { incidents: null, unsettled: [] }],
    ["object incidents", { incidents: {}, unsettled: [] }],
    ["null unsettled", { incidents: [], unsettled: null }],
    ["promise unsettled", { incidents: [], unsettled: Promise.resolve([]) }],
    [
      "invalid explicit block mode",
      {
        incidents: [],
        unsettled: [],
        replayDenied: [],
        blockMode: "unexpected",
      },
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
    const accessorMode = { incidents: [], unsettled: [], replayDenied: [] };
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
      { incidents: [], unsettled: [], replayDenied: [] },
      Object.freeze({
        incidents: Object.freeze([]),
        unsettled: Object.freeze([]),
        replayDenied: Object.freeze([]),
      }),
      Object.assign(Object.create(null), {
        incidents: [],
        unsettled: [],
        replayDenied: [],
      }),
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
      { incidents: [{ code: "CORRUPT" }], unsettled: [], replayDenied: [] },
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
      replayDenied: [],
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
    expect(controller.admission).toMatchObject({
      blockMode: "all",
      reasonCode: "CC_TEST_ALL",
    });
    await expect(guarded.begin(call("read"))).rejects.toMatchObject({
      blockMode: "all",
      effect: "read",
    });

    controller.replaceVerifiedRecovery({
      incidents: [],
      unsettled: [],
      replayDenied: [],
    });
    expect(guarded.recoveryAdmission.blockMode).toBeNull();
    await expect(guarded.begin(call("unknown"))).resolves.toMatchObject({
      ledgerId: "dynamic",
    });
    expect(ledger.begin).toHaveBeenCalledTimes(3);
  });

  it("rejects deny truncation or conflict while allowing monotonic additions", async () => {
    const controller = createMcpRecoveryAdmissionController({
      incidents: [],
      unsettled: [],
      replayDenied: [],
    });
    const begin = vi.fn(async () => ({ ledgerId: "dynamic" }));
    const guarded = guardMcpLedgerForRecovery({ begin }, controller);
    const input = { release: 3 };
    const existing = replayDeny(input);

    controller.replaceVerifiedRecovery({
      incidents: [],
      unsettled: [],
      replayDenied: [existing],
    });
    await expect(guarded.begin(call("read", { input }))).rejects.toMatchObject({
      code: MCP_EXACT_REPLAY_DENIED_CODE,
    });

    controller.replaceVerifiedRecovery({
      incidents: [],
      unsettled: [],
      replayDenied: [],
    });
    expect(controller.admission).toMatchObject({
      blockMode: "all",
      reasonCode: MCP_RECOVERY_DENY_REGRESSION_CODE,
    });
    await expect(
      guarded.begin(call("read", { input: { release: 999 } })),
    ).rejects.toMatchObject({
      code: MCP_RECOVERY_DENY_REGRESSION_CODE,
      blockMode: "all",
    });
    await expect(guarded.begin(call("read", { input }))).rejects.toMatchObject({
      code: MCP_EXACT_REPLAY_DENIED_CODE,
    });

    const conflicting = replayDeny({ release: 4 });
    conflicting.ledgerId = existing.ledgerId;
    controller.replaceVerifiedRecovery({
      incidents: [],
      unsettled: [],
      replayDenied: [conflicting],
    });
    expect(controller.admission.reasonCode).toBe(
      MCP_RECOVERY_DENY_REGRESSION_CODE,
    );

    const added = replayDeny({ release: 5 });
    added.ledgerId = "mcp-confirmed-applied-new";
    controller.replaceVerifiedRecovery({
      incidents: [],
      unsettled: [],
      replayDenied: [existing, added],
    });
    expect(controller.admission).toMatchObject({
      blockMode: null,
      replayDenied: 2,
    });
    await expect(
      guarded.begin(call("read", { input: { release: 5 } })),
    ).rejects.toMatchObject({ code: MCP_EXACT_REPLAY_DENIED_CODE });
    expect(begin).not.toHaveBeenCalled();
  });

  it("marks only a branded dynamic ledger outcome unknown without exposing its controller", async () => {
    const controller = createMcpRecoveryAdmissionController();
    const begin = vi.fn(async () => ({ ledgerId: "dynamic", settle: vi.fn() }));
    const rawLedger = { begin };
    const guarded = guardMcpLedgerForRecovery(rawLedger, controller);

    expect(markMcpLedgerOutcomeUnknown(rawLedger, "CC_TEST_UNKNOWN")).toBe(
      false,
    );
    expect(markMcpLedgerOutcomeUnknown(guarded, "CC_TEST_UNKNOWN")).toBe(true);
    expect(guarded.controller).toBeUndefined();
    expect(guarded.recoveryAdmission).toMatchObject({
      blockMode: "unsafe",
      reasonCode: "CC_TEST_UNKNOWN",
    });
    await expect(guarded.begin(call("write"))).rejects.toMatchObject({
      blockMode: "unsafe",
      effect: "write",
    });
    expect(begin).not.toHaveBeenCalled();
  });

  it("applies stricter recovery options to an authentic controller", async () => {
    const recoveryError = Object.assign(new Error("unverified transcript"), {
      code: "CC_TEST_RECOVERY_UNVERIFIED",
    });
    const controller = createMcpRecoveryAdmissionController();
    const begin = vi.fn();
    const guarded = guardMcpLedgerForRecovery({ begin }, controller, {
      recoveryError,
    });

    await expect(guarded.begin(call("read"))).rejects.toMatchObject({
      code: "CC_TEST_RECOVERY_UNVERIFIED",
      blockMode: "all",
    });
    expect(begin).not.toHaveBeenCalled();

    const requestedController = createMcpRecoveryAdmissionController();
    const requested = createRecoveryGuardedMcpCallLedger({
      controller: requestedController,
      blockMode: "unsafe",
    });
    await expect(requested.begin(call("write"))).rejects.toMatchObject({
      blockMode: "unsafe",
      effect: "write",
    });
    expect(requestedController.admission.blockMode).toBe("unsafe");
  });

  it("latches invalid verified replacements to all until an explicit valid replacement", () => {
    const controller = createMcpRecoveryAdmissionController();
    controller.replaceVerifiedRecovery(
      Promise.resolve({ incidents: [], unsettled: [], replayDenied: [] }),
    );
    expect(controller.admission).toMatchObject({
      blockMode: "all",
      reasonCode: MCP_RECOVERY_INVALID_CODE,
    });

    controller.latchUnsafe();
    expect(controller.admission.blockMode).toBe("all");
    controller.replaceVerifiedRecovery({
      incidents: [],
      unsettled: [],
      replayDenied: [],
    });
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

    controller.replaceVerifiedRecovery({
      incidents: [],
      unsettled: [],
      replayDenied: [],
    });
    await expect(
      guardedTicket.settleCall({ status: "completed" }),
    ).rejects.toBe(settlementError);
    expect(controller.admission.blockMode).toBe("unsafe");
  });

  it.each([
    [
      "throwing settlement accessor",
      () => {
        const ticket = { ledgerId: "accessor-ticket" };
        Object.defineProperty(ticket, "settle", {
          enumerable: true,
          get() {
            throw Object.assign(new Error("settle getter failed"), {
              code: "CC_TEST_SETTLE_GETTER",
            });
          },
        });
        return ticket;
      },
      "CC_TEST_SETTLE_GETTER",
    ],
    [
      "Proxy ticket",
      () => new Proxy({ ledgerId: "proxy-ticket", settle: vi.fn() }, {}),
      "CC_MCP_LEDGER_TICKET_INVALID",
    ],
    [
      "inherited non-callable settlement accessor",
      () => {
        const prototype = Object.defineProperty({}, "settle", {
          get() {
            return null;
          },
        });
        return Object.assign(Object.create(prototype), {
          ledgerId: "inherited-accessor-ticket",
        });
      },
      "CC_MCP_LEDGER_SETTLE_UNAVAILABLE",
    ],
  ])("latches unsafe before exposing a %s", async (_label, ticket, code) => {
    const controller = createMcpRecoveryAdmissionController();
    const guarded = guardMcpLedgerForRecovery(
      { begin: vi.fn(async () => ticket()) },
      controller,
    );

    await expect(guarded.begin(call("read"))).rejects.toMatchObject({ code });
    expect(controller.admission).toMatchObject({
      blockMode: "unsafe",
      reasonCode: code,
    });
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
      resolveEffect: () => ({ effect: "read", trusted: true }),
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

  it("latches an oversized auxiliary result before it can leave the ledger boundary", async () => {
    const canary = "AUXILIARY_MCP_RESULT_PRIVATE_CANARY";
    const rawLedger = createMcpCallLedger({
      toolResultConfig: { maxToolResultBytes: 64 },
      randomUUID: () => "aux-result-budget",
    });
    const controller = createMcpRecoveryAdmissionController();
    const client = createRecoveryGuardedMcpClient({
      client: {
        callTool: vi.fn(async () => ({ content: canary.repeat(32) })),
      },
      ledger: rawLedger,
      controller,
      resolveEffect: () => ({ effect: "write" }),
    });

    const error = await client
      .callTool("repo", "publish", {})
      .catch((cause) => cause);

    expect(error).toMatchObject({
      code: "CC_MCP_LEDGER_OUTCOME_UNKNOWN",
      phase: "settled",
      outcomeUnknown: true,
      retryable: false,
    });
    expect(error.message).not.toContain(canary);
    expect(rawLedger.list()[0]).toMatchObject({ status: "started" });
    expect(JSON.stringify(rawLedger.list())).not.toContain(canary);
    expect(controller.admission).toMatchObject({
      blockMode: "unsafe",
      reasonCode: "CC_MCP_TOOL_RESULT_TOO_LARGE",
    });
  });

  it("rejects wire-equivalent ambiguous inputs before an exact replay can execute", async () => {
    const deniedInput = { release: 7 };
    const callTool = vi.fn(async () => ({ content: [] }));
    const begin = vi.fn(async () => ({
      ledgerId: "must-not-start",
      settle: vi.fn(),
    }));
    const controller = createMcpRecoveryAdmissionController({
      incidents: [],
      unsettled: [],
      replayDenied: [replayDeny(deniedInput)],
    });
    const client = createRecoveryGuardedMcpClient({
      client: { callTool },
      ledger: { begin },
      controller,
      sessionId: "session-wire-replay",
    });
    const toJSON = vi.fn(() => ({ release: 7 }));
    const variants = [
      { release: 7, ignored: undefined },
      { release: 7, toJSON },
      new Proxy(
        { release: 7 },
        {
          get() {
            throw new Error("proxy must not be inspected");
          },
        },
      ),
      Object.assign(new Array(1), {}),
      { then: vi.fn() },
    ];
    expect(JSON.stringify(variants[0])).toBe(JSON.stringify(deniedInput));
    expect(JSON.stringify(variants[1])).toBe(JSON.stringify(deniedInput));

    for (const input of variants) {
      await expect(
        client.callTool("repo", "publish", input),
      ).rejects.toMatchObject({
        code: "CC_MCP_WIRE_INPUT_INVALID",
      });
    }
    expect(toJSON).toHaveBeenCalledTimes(1);
    expect(begin).not.toHaveBeenCalled();
    expect(callTool).not.toHaveBeenCalled();
  });

  it("uses one immutable input snapshot for host admission, ledger, and send", async () => {
    const settle = vi.fn(async () => ({}));
    const begin = vi.fn(async () => ({ ledgerId: "host-snapshot", settle }));
    const callTool = vi.fn(async () => ({ content: [] }));
    const resolveEffect = vi.fn(() => ({ effect: "read", trusted: true }));
    const client = createRecoveryGuardedMcpClient({
      client: { callTool },
      ledger: { begin },
      controller: createMcpRecoveryAdmissionController(),
      resolveEffect,
      sessionId: "session-wire-snapshot",
    });
    const original = { nested: { release: 7 } };

    const pending = client.callTool("repo", "status", original);
    original.nested.release = 8;
    await pending;

    const ledgerInput = begin.mock.calls[0][0].input;
    const resolverInput = resolveEffect.mock.calls[0][2];
    const sentInput = callTool.mock.calls[0][2];
    expect(ledgerInput).toBe(resolverInput);
    expect(sentInput).toBe(ledgerInput);
    expect(sentInput).toEqual({ nested: { release: 7 } });
    expect(Object.isFrozen(sentInput)).toBe(true);
    expect(Object.isFrozen(sentInput.nested)).toBe(true);
  });

  it("blocks unknown host calls under unsafe and every host call under all", async () => {
    const callTool = vi.fn(async () => ({ ok: true }));
    const settle = vi.fn(async () => ({}));
    const begin = vi.fn(async () => ({ ledgerId: "host-read", settle }));
    const controller = createMcpRecoveryAdmissionController({
      incidents: [],
      unsettled: [{ ledgerId: "prior" }],
      replayDenied: [],
    });
    const client = createRecoveryGuardedMcpClient({
      client: { callTool },
      ledger: { begin },
      controller,
      resolveEffect: (_server, toolName) =>
        toolName === "status" ? { effect: "read", trusted: true } : undefined,
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

  it("does not promote an untrusted read classification under unsafe recovery", async () => {
    const callTool = vi.fn(async () => ({ ok: true }));
    const begin = vi.fn();
    const controller = createMcpRecoveryAdmissionController({
      incidents: [],
      unsettled: [{ ledgerId: "prior" }],
      replayDenied: [],
    });
    const client = createRecoveryGuardedMcpClient({
      client: { callTool },
      ledger: { begin },
      controller,
      resolveEffect: () => ({ effect: "read", trusted: false }),
    });

    await expect(
      client.callTool("repo", "declared-read", {}),
    ).rejects.toMatchObject({
      blockMode: "unsafe",
      effect: "unknown",
    });
    expect(begin).not.toHaveBeenCalled();
    expect(callTool).not.toHaveBeenCalled();
  });

  it.each(["unknown", "write", "destructive"])(
    "keeps a rejected %s host call outcome unknown and unsettled",
    async (effect) => {
      const transportError = Object.assign(new Error("socket reset"), {
        code: "ECONNRESET",
      });
      const callTool = vi.fn().mockRejectedValue(transportError);
      const settle = vi.fn();
      const begin = vi.fn(async () => ({
        ledgerId: `transport-${effect}`,
        settle,
      }));
      const controller = createMcpRecoveryAdmissionController();
      const client = createRecoveryGuardedMcpClient({
        client: { callTool },
        ledger: { begin },
        controller,
        resolveEffect: () => ({ effect, trusted: true }),
      });

      await expect(
        client.callTool("repo", "publish", {}),
      ).rejects.toMatchObject({
        code: MCP_OUTCOME_UNKNOWN_CODE,
        ledgerId: `transport-${effect}`,
        effect,
        phase: "call",
        outcomeUnknown: true,
        retryable: false,
      });
      expect(settle).not.toHaveBeenCalled();
      expect(controller.admission).toMatchObject({
        blockMode: "unsafe",
        reasonCode: "ECONNRESET",
      });
      await expect(
        client.callTool("repo", "publish", {}),
      ).rejects.toMatchObject({
        blockMode: "unsafe",
        effect,
      });
      expect(begin).toHaveBeenCalledTimes(1);
      expect(callTool).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    [
      "throwing isError accessor",
      () => {
        const result = {};
        Object.defineProperty(result, "isError", {
          get() {
            throw Object.assign(new Error("protocol getter failed"), {
              code: "CC_TEST_RESULT_GETTER",
            });
          },
        });
        return result;
      },
      "CC_TEST_RESULT_GETTER",
    ],
    [
      "Proxy result",
      () => new Proxy({ isError: false }, {}),
      "CC_MCP_PROTOCOL_RESULT_INVALID",
    ],
  ])("latches outcome unknown for a %s", async (_label, result, reasonCode) => {
    const settle = vi.fn();
    const controller = createMcpRecoveryAdmissionController();
    const client = createRecoveryGuardedMcpClient({
      client: { callTool: vi.fn(async () => result()) },
      ledger: {
        begin: vi.fn(async () => ({ ledgerId: "result-ticket", settle })),
      },
      controller,
      resolveEffect: () => ({ effect: "read", trusted: true }),
    });

    await expect(client.callTool("repo", "status", {})).rejects.toMatchObject({
      code: MCP_OUTCOME_UNKNOWN_CODE,
      ledgerId: "result-ticket",
      phase: "result",
      outcomeUnknown: true,
    });
    expect(settle).not.toHaveBeenCalled();
    expect(controller.admission).toMatchObject({
      blockMode: "unsafe",
      reasonCode,
    });
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

  it("maps async client chaining back to the guarded client", async () => {
    const rawCallTool = vi.fn(async () => ({ ok: true }));
    const rawClient = {
      callTool: rawCallTool,
      async connect() {
        return this;
      },
    };
    const settle = vi.fn(async () => ({}));
    const begin = vi.fn(async () => ({ ledgerId: "async-chain", settle }));
    const controller = createMcpRecoveryAdmissionController();
    const client = createRecoveryGuardedMcpClient({
      client: rawClient,
      ledger: { begin },
      controller,
    });

    const connected = await client.connect();
    expect(connected).toBe(client);
    await expect(connected.callTool("repo", "status", {})).resolves.toEqual({
      ok: true,
    });
    expect(begin).toHaveBeenCalledTimes(1);
    expect(settle).toHaveBeenCalledTimes(1);
    expect(rawCallTool).toHaveBeenCalledTimes(1);
  });

  it("returns the same guard instead of double-accounting a wrapped client", async () => {
    const rawCallTool = vi.fn(async () => ({ ok: true }));
    const settle = vi.fn(async () => ({}));
    const begin = vi.fn(async () => ({ ledgerId: "single", settle }));
    const ledger = { begin };
    const controller = createMcpRecoveryAdmissionController();
    const first = createRecoveryGuardedMcpClient({
      client: { callTool: rawCallTool },
      ledger,
      controller,
    });
    const second = createRecoveryGuardedMcpClient({
      client: first,
      ledger,
      controller,
    });

    expect(second).toBe(first);
    await second.callTool("repo", "status", {});
    expect(begin).toHaveBeenCalledTimes(1);
    expect(settle).toHaveBeenCalledTimes(1);
    expect(rawCallTool).toHaveBeenCalledTimes(1);
  });

  it("guards a frozen client with a non-configurable callTool", async () => {
    const rawCallTool = vi.fn(async () => ({ ok: true }));
    const rawClient = Object.freeze({
      value: 9,
      callTool: rawCallTool,
      getValue() {
        return this.value;
      },
      chain() {
        return this;
      },
    });
    const settle = vi.fn(async () => ({}));
    const begin = vi.fn(async () => ({ ledgerId: "frozen", settle }));
    const client = createRecoveryGuardedMcpClient({
      client: rawClient,
      ledger: { begin },
      controller: createMcpRecoveryAdmissionController(),
    });

    expect(client.getValue()).toBe(9);
    expect(client.chain()).toBe(client);
    const callToolDescriptor = Object.getOwnPropertyDescriptor(
      client,
      "callTool",
    );
    expect(callToolDescriptor.value).toBe(client.callTool);
    await expect(client.callTool("repo", "status", {})).resolves.toEqual({
      ok: true,
    });
    expect(begin).toHaveBeenCalledTimes(1);
    expect(settle).toHaveBeenCalledTimes(1);
    expect(rawCallTool).toHaveBeenCalledTimes(1);
  });

  it("delegates common property reads, writes, setters, and reflection to the raw client", () => {
    const rawClient = {
      value: 1,
      callTool: vi.fn(),
      get current() {
        return this.value;
      },
      set current(value) {
        this.value = value;
      },
    };
    rawClient.self = rawClient;
    const originalCallTool = rawClient.callTool;
    const client = createRecoveryGuardedMcpClient({
      client: rawClient,
      ledger: { begin: vi.fn() },
      controller: createMcpRecoveryAdmissionController(),
    });

    expect(client.value).toBe(1);
    expect(client.self).toBe(client);
    client.value = 2;
    expect(rawClient.value).toBe(2);
    client.current = 3;
    expect(rawClient.value).toBe(3);
    client.added = "raw";
    expect(rawClient.added).toBe("raw");
    expect("value" in client).toBe(true);
    expect(Object.keys(client)).toContain("value");
    expect(Object.prototype.hasOwnProperty.call(client, "value")).toBe(true);
    expect(Object.getOwnPropertyDescriptor(client, "callTool").value).toBe(
      client.callTool,
    );
    expect(() => {
      client.callTool = vi.fn();
    }).toThrow(TypeError);
    expect(rawClient.callTool).toBe(originalCallTool);
    client.self = client;
    expect(rawClient.self).toBe(rawClient);
    delete client.added;
    expect(Object.hasOwn(rawClient, "added")).toBe(false);
  });

  it("keeps the recovery code diagnosable when agent-core blocks callTool", async () => {
    const callTool = vi.fn();
    const ledger = guardMcpLedgerForRecovery(
      { begin: vi.fn() },
      { incidents: [{ code: "CORRUPT" }], unsettled: [], replayDenied: [] },
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
        permissionConfirm: vi.fn(async () => true),
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
