import { describe, expect, it, vi } from "vitest";
import {
  createMcpCallLedger,
  McpCallStatus,
} from "../../src/lib/mcp-call-ledger.js";
import {
  MCP_CALL_LEDGER_EVENT,
  createSessionMcpLedgerSink,
  formatMcpLedgerRecoveryNotice,
  loadMcpLedgerRecovery,
  reduceMcpLedgerEvents,
} from "../../src/lib/mcp-call-ledger-store.js";

function record(overrides = {}) {
  const status = overrides.status || McpCallStatus.STARTED;
  return {
    schemaVersion: 1,
    ledgerId: "mcp-ledger-1",
    sessionId: "session-1",
    turnId: "turn-1",
    toolName: "mcp__repo__publish",
    serverName: "repo",
    inputDigest: `sha256:${"a".repeat(64)}`,
    inputBytes: 2,
    effectContract: { effect: "write" },
    resourceScopes: [],
    networkScopes: [],
    prewritePolicy: "fail-closed",
    prewritePersistence:
      status === McpCallStatus.STARTED ? "pending" : "persisted",
    status,
    startedAt: "2026-08-01T00:00:00.000Z",
    settledAt:
      status === McpCallStatus.STARTED ? null : "2026-08-01T00:00:01.000Z",
    outputSummary: null,
    outputDigest: null,
    errorSummary: null,
    settlementPersistence:
      status === McpCallStatus.STARTED ? undefined : "pending",
    ...overrides,
  };
}

function event(value, phase = "started") {
  return {
    type: MCP_CALL_LEDGER_EVENT,
    data: { schemaVersion: 1, phase, record: value },
  };
}

describe("MCP call ledger session store", () => {
  it("appends content-free started and settled records to the canonical session", async () => {
    const appendEvent = vi.fn(() => true);
    const sink = createSessionMcpLedgerSink("session-1", { appendEvent });
    const started = record();
    const settled = record({
      status: McpCallStatus.COMPLETED,
      settledAt: "2026-08-01T00:00:01.000Z",
    });

    await sink(started, { phase: "started" });
    await sink(settled, { phase: "settled" });

    expect(appendEvent).toHaveBeenNthCalledWith(
      1,
      "session-1",
      MCP_CALL_LEDGER_EVENT,
      expect.objectContaining({
        phase: "started",
        record: expect.objectContaining({
          ledgerId: started.ledgerId,
          effectContract: expect.objectContaining({
            schemaVersion: 1,
            effect: "write",
            sideEffecting: true,
          }),
        }),
      }),
    );
    expect(appendEvent).toHaveBeenNthCalledWith(
      2,
      "session-1",
      MCP_CALL_LEDGER_EVENT,
      expect.objectContaining({
        phase: "settled",
        record: expect.objectContaining({
          ledgerId: settled.ledgerId,
          status: McpCallStatus.COMPLETED,
        }),
      }),
    );
  });

  it.each([
    ["unknown top-level", { rawInput: "top-level-secret" }],
    [
      "unknown effect-contract",
      { effectContract: { effect: "write", rawToken: "nested-secret" } },
    ],
  ])("rejects %s fields without invoking append", async (_label, extra) => {
    const appendEvent = vi.fn(() => true);
    const sink = createSessionMcpLedgerSink("session-1", { appendEvent });

    await expect(
      sink(record(extra), { phase: "started" }),
    ).rejects.toMatchObject({ code: "CC_MCP_LEDGER_RECORD_INVALID" });
    expect(appendEvent).not.toHaveBeenCalled();
  });

  it("does not append an orphan terminal after a read prewrite fails open", async () => {
    const appendEvent = vi.fn(async () => {
      throw new Error("authority store unavailable");
    });
    const sink = createSessionMcpLedgerSink("session-1", { appendEvent });
    const ledger = createMcpCallLedger({
      sink,
      randomUUID: () => "read-no-start",
    });

    const call = await ledger.begin({
      sessionId: "session-1",
      toolName: "lookup",
      serverName: "catalog",
      input: { query: "private-query" },
      effectContract: { effect: "read", trusted: true },
    });
    await expect(
      call.settle({ output: { found: true } }),
    ).resolves.toMatchObject({
      status: McpCallStatus.COMPLETED,
      prewritePersistence: "failed-open",
      settlementPersistence: "skipped-no-prewrite",
    });
    expect(appendEvent).toHaveBeenCalledTimes(1);
  });

  it("leaves a started-only call unsettled for fail-closed recovery", () => {
    const recovery = reduceMcpLedgerEvents([event(record())]);

    expect(recovery.unsettled).toHaveLength(1);
    expect(formatMcpLedgerRecoveryNotice(recovery)).toContain(
      "Do NOT automatically retry",
    );
    expect(formatMcpLedgerRecoveryNotice(recovery)).not.toContain("input");
  });

  it("settles a call only after its matching durable start", () => {
    const recovery = reduceMcpLedgerEvents([
      event(record()),
      event(record({ status: McpCallStatus.COMPLETED }), "settled"),
    ]);

    expect(recovery.unsettled).toEqual([]);
    expect(recovery.records[0].status).toBe(McpCallStatus.COMPLETED);
    expect(recovery.incidents).toEqual([]);
  });

  it("rejects phase/status mismatches before persistence and during replay", async () => {
    const appendEvent = vi.fn(() => true);
    const sink = createSessionMcpLedgerSink("session-1", { appendEvent });
    const completed = record({ status: McpCallStatus.COMPLETED });

    await expect(sink(completed, { phase: "started" })).rejects.toMatchObject({
      code: "CC_MCP_LEDGER_PHASE_STATUS_MISMATCH",
      ledgerId: "mcp-ledger-1",
    });
    expect(appendEvent).not.toHaveBeenCalled();

    const recovery = reduceMcpLedgerEvents([event(completed, "started")]);
    expect(recovery.records).toEqual([]);
    expect(recovery.incidents).toEqual([
      expect.objectContaining({ code: "CC_MCP_LEDGER_EVENT_CORRUPT" }),
    ]);
  });

  it("rejects a forged terminal that lacks settlement state", () => {
    const started = record();
    const recovery = reduceMcpLedgerEvents([
      event(started),
      event({ ...started, status: McpCallStatus.COMPLETED }, "settled"),
    ]);

    expect(recovery.unsettled).toHaveLength(1);
    expect(recovery.incidents).toEqual([
      expect.objectContaining({ code: "CC_MCP_LEDGER_EVENT_CORRUPT" }),
    ]);
  });

  it("rejects a forged terminal that retains pending prewrite state", () => {
    const started = record();
    const recovery = reduceMcpLedgerEvents([
      event(started),
      event(
        {
          ...started,
          status: McpCallStatus.COMPLETED,
          settledAt: "2026-08-01T00:00:01.000Z",
          settlementPersistence: "pending",
        },
        "settled",
      ),
    ]);

    expect(recovery.unsettled).toHaveLength(1);
    expect(recovery.incidents).toEqual([
      expect.objectContaining({ code: "CC_MCP_LEDGER_EVENT_CORRUPT" }),
    ]);
  });

  it("reports corrupt, missing-start, and terminal-rewrite events", () => {
    const recovery = reduceMcpLedgerEvents([
      { type: MCP_CALL_LEDGER_EVENT, data: { nope: true } },
      event(
        record({ ledgerId: "missing", status: McpCallStatus.COMPLETED }),
        "settled",
      ),
      event(record()),
      event(record({ status: McpCallStatus.COMPLETED }), "settled"),
      event(record({ status: McpCallStatus.FAILED }), "settled"),
    ]);

    expect(recovery.incidents.map((incident) => incident.code)).toEqual([
      "CC_MCP_LEDGER_EVENT_CORRUPT",
      "CC_MCP_LEDGER_START_MISSING",
      "CC_MCP_LEDGER_TERMINAL_REWRITTEN",
    ]);
  });

  it("keeps the original call unsettled after duplicate starts or identity drift", () => {
    const started = record({
      inputDigest: `sha256:${"b".repeat(64)}`,
      resourceScopes: ["repo:one"],
    });
    const recovery = reduceMcpLedgerEvents([
      event(started),
      event(started),
      event(
        {
          ...started,
          status: McpCallStatus.COMPLETED,
          inputDigest: `sha256:${"c".repeat(64)}`,
          prewritePersistence: "persisted",
          settledAt: "2026-08-01T00:00:01.000Z",
          settlementPersistence: "pending",
        },
        "settled",
      ),
    ]);

    expect(recovery.unsettled).toHaveLength(1);
    expect(recovery.incidents.map((incident) => incident.code)).toEqual([
      "CC_MCP_LEDGER_DUPLICATE_START",
      "CC_MCP_LEDGER_RECORD_MISMATCH",
    ]);
  });

  it("fails recovery closed when verified transcript reading fails", () => {
    expect(() =>
      loadMcpLedgerRecovery("session-1", {
        readVerifiedEvents: () => {
          const error = new Error("hash chain broken");
          error.code = "SESSION_TRANSCRIPT_UNVERIFIED";
          throw error;
        },
      }),
    ).toThrow(
      expect.objectContaining({ code: "CC_MCP_LEDGER_EVENT_READ_FAILED" }),
    );
  });

  it("fails closed when the canonical event append is unavailable", async () => {
    const sink = createSessionMcpLedgerSink("session-1", {
      appendEvent: () => false,
    });

    await expect(sink(record(), { phase: "started" })).rejects.toMatchObject({
      code: "CC_MCP_LEDGER_EVENT_PERSIST_FAILED",
      sessionId: "session-1",
      ledgerId: "mcp-ledger-1",
    });
  });

  it("refuses to persist a record into a different session transcript", async () => {
    const appendEvent = vi.fn(() => true);
    const sink = createSessionMcpLedgerSink("session-1", { appendEvent });

    await expect(
      sink(record({ sessionId: "session-2" }), { phase: "started" }),
    ).rejects.toMatchObject({ code: "CC_MCP_LEDGER_SESSION_MISMATCH" });
    expect(appendEvent).not.toHaveBeenCalled();
  });

  it("fails closed when an asynchronous canonical append rejects", async () => {
    const sink = createSessionMcpLedgerSink("session-1", {
      appendEvent: async () => {
        throw new Error("disk unavailable");
      },
    });

    await expect(sink(record(), { phase: "started" })).rejects.toMatchObject({
      code: "CC_MCP_LEDGER_EVENT_PERSIST_FAILED",
      sessionId: "session-1",
      ledgerId: "mcp-ledger-1",
    });
  });
});
