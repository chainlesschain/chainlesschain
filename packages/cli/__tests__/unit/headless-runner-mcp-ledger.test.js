import { describe, expect, it, vi } from "vitest";
import { runAgentHeadless } from "../../src/runtime/headless-runner.js";
import { MCP_CALL_LEDGER_EVENT } from "../../src/lib/mcp-call-ledger-store.js";

function fakeGate() {
  return {
    setSessionPolicy: () => {},
    setConfirmer: () => {},
    decide: async () => ({ decision: "allow", via: "test", policy: "test" }),
  };
}

function ledgerRecord(status = "started") {
  return {
    schemaVersion: 1,
    ledgerId: "mcp-old-1",
    sessionId: "sid",
    turnId: "turn-old",
    toolName: "mcp__repo__publish",
    serverName: "repo",
    status,
    effectContract: { effect: "write" },
  };
}

function ledgerEvent(record, phase = "started") {
  return {
    type: MCP_CALL_LEDGER_EVENT,
    data: { schemaVersion: 1, phase, record },
  };
}

function harness(events) {
  const captured = {};
  const appendEvent = vi.fn(() => true);
  const deps = {
    bootstrap: async () => ({ db: null }),
    getApprovalGate: async () => fakeGate(),
    writeOut: () => {},
    writeErr: vi.fn(),
    agentLoop: async function* (messages, options) {
      captured.messages = messages;
      captured.options = options;
      yield { type: "response-complete", content: "ok" };
      yield { type: "run-ended", reason: "complete" };
    },
    sessionExists: () => true,
    verifySession: () => ({ status: "valid" }),
    rebuildMessages: () => [
      { role: "user", content: "before" },
      { role: "assistant", content: "answer" },
    ],
    readEvents: () => events,
    startSession: () => {},
    appendUserMessage: () => {},
    appendAssistantMessage: () => {},
    appendTokenUsage: () => {},
    appendCompactEvent: () => {},
    appendEvent,
    getLastSessionId: () => "sid",
  };
  return { captured, appendEvent, deps };
}

const systemText = (messages) =>
  messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n");

describe("headless MCP ledger persistence and recovery", () => {
  it("injects a fail-closed notice for a started-only call and wires the same session sink", async () => {
    const setup = harness([ledgerEvent(ledgerRecord())]);

    await runAgentHeadless(
      { prompt: "continue", resume: "sid", outputFormat: "json" },
      setup.deps,
    );

    expect(systemText(setup.captured.messages)).toContain(
      "Do NOT automatically retry",
    );
    expect(systemText(setup.captured.messages)).toContain(
      "repo/mcp__repo__publish",
    );
    expect(setup.captured.options.mcpLedgerSink).toBeTypeOf("function");

    const next = { ...ledgerRecord(), ledgerId: "mcp-new-1" };
    await setup.captured.options.mcpLedgerSink(next, { phase: "started" });
    expect(setup.appendEvent).toHaveBeenCalledWith(
      "sid",
      MCP_CALL_LEDGER_EVENT,
      expect.objectContaining({ phase: "started", record: next }),
    );
  });

  it("does not inject an MCP notice after a proven settlement", async () => {
    const started = ledgerRecord();
    const completed = { ...started, status: "completed" };
    const setup = harness([
      ledgerEvent(started),
      ledgerEvent(completed, "settled"),
    ]);

    await runAgentHeadless(
      { prompt: "continue", resume: "sid", outputFormat: "json" },
      setup.deps,
    );

    expect(systemText(setup.captured.messages)).not.toContain(
      "MCP recovery notice",
    );
  });
});
