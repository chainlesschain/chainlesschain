import { describe, expect, it, vi } from "vitest";
import { McpCallStatus } from "../../src/lib/mcp-call-ledger.js";
import {
  MCP_CALL_LEDGER_EVENT,
  createSessionMcpLedgerSink,
  formatMcpLedgerRecoveryNotice,
  reduceMcpLedgerEvents,
} from "../../src/lib/mcp-call-ledger-store.js";

function record(overrides = {}) {
  return {
    schemaVersion: 1,
    ledgerId: "mcp-ledger-1",
    sessionId: "session-1",
    turnId: "turn-1",
    toolName: "mcp__repo__publish",
    serverName: "repo",
    status: McpCallStatus.STARTED,
    effectContract: { effect: "write" },
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
      expect.objectContaining({ phase: "started", record: started }),
    );
    expect(appendEvent).toHaveBeenNthCalledWith(
      2,
      "session-1",
      MCP_CALL_LEDGER_EVENT,
      expect.objectContaining({ phase: "settled", record: settled }),
    );
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
