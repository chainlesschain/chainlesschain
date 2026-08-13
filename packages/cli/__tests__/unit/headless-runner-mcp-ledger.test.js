import { describe, expect, it, vi } from "vitest";
import { runAgentHeadless } from "../../src/runtime/headless-runner.js";
import { executeTool } from "../../src/runtime/agent-core.js";
import { MCP_CALL_LEDGER_EVENT } from "../../src/lib/mcp-call-ledger-store.js";

const HEAD_0 = "0".repeat(64);
const HEAD_1 = "1".repeat(64);
const HEAD_2 = "2".repeat(64);

function sessionStartEvent() {
  return {
    type: "session_start",
    prevHash: null,
    hash: HEAD_0,
    data: { title: "test" },
  };
}

function fakeGate() {
  return {
    setSessionPolicy: () => {},
    setConfirmer: () => {},
    decide: async () => ({ decision: "allow", via: "test", policy: "test" }),
  };
}

function ledgerRecord(status = "started") {
  const settled = status !== "started";
  return {
    schemaVersion: 1,
    ledgerId: "mcp-old-1",
    sessionId: "sid",
    turnId: "turn-old",
    toolName: "mcp__repo__publish",
    serverName: "repo",
    inputDigest: `sha256:${"a".repeat(64)}`,
    inputBytes: 2,
    status,
    effectContract: { effect: "write" },
    resourceScopes: [],
    networkScopes: [],
    prewritePolicy: "fail-closed",
    prewritePersistence: settled ? "persisted" : "pending",
    startedAt: "2026-08-01T00:00:00.000Z",
    settledAt: settled ? "2026-08-01T00:00:01.000Z" : null,
    outputSummary: null,
    outputDigest: null,
    errorSummary: null,
    ...(settled ? { settlementPersistence: "pending" } : {}),
  };
}

function ledgerEvent(record, phase = "started") {
  return {
    type: MCP_CALL_LEDGER_EVENT,
    prevHash: phase === "started" ? HEAD_0 : HEAD_1,
    hash: phase === "started" ? HEAD_1 : HEAD_2,
    data: { schemaVersion: 1, phase, record },
  };
}

function harness(events) {
  const sessionEvents = events.some((event) => event.type === "session_start")
    ? events
    : [sessionStartEvent(), ...events];
  const captured = {};
  const appendAuthorityEvent = vi.fn(() => true);
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
    readEvents: () => sessionEvents,
    readVerifiedEvents: () => sessionEvents,
    startSession: () => {},
    appendUserMessage: () => {},
    appendAssistantMessage: () => {},
    appendTokenUsage: () => {},
    appendCompactEvent: () => {},
    appendEvent: () => true,
    appendAuthorityEvent,
    getLastSessionId: () => "sid",
  };
  return { captured, appendAuthorityEvent, deps };
}

const systemText = (messages) =>
  messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n");

describe("headless MCP ledger persistence and recovery", () => {
  it("injects a recovery notice and blocks unsafe replay before the same session sink", async () => {
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
    const ledger = setup.captured.options.mcpCallLedger;
    expect(ledger.begin).toBeTypeOf("function");
    await expect(
      ledger.begin({
        sessionId: "sid",
        turnId: "new-write",
        toolName: "mcp__repo__publish",
        serverName: "repo",
        input: { release: 1 },
        effectContract: { effect: "write" },
      }),
    ).rejects.toMatchObject({
      code: "CC_MCP_LEDGER_RECOVERY_BLOCKED",
      blockMode: "unsafe",
    });
    expect(setup.appendAuthorityEvent).not.toHaveBeenCalledWith(
      "sid",
      MCP_CALL_LEDGER_EVENT,
      expect.anything(),
    );

    await ledger.begin({
      sessionId: "sid",
      turnId: "new-read",
      toolName: "mcp__repo__status",
      serverName: "repo",
      input: {},
      effectContract: { effect: "read", trusted: true },
    });
    expect(setup.appendAuthorityEvent).toHaveBeenCalledWith(
      "sid",
      MCP_CALL_LEDGER_EVENT,
      expect.objectContaining({
        phase: "started",
        record: expect.objectContaining({
          toolName: "mcp__repo__status",
          effectContract: expect.objectContaining({
            schemaVersion: 1,
            effect: "read",
            readOnly: true,
          }),
        }),
      }),
    );
  }, 15_000);

  it("does not inject an MCP notice after a proven settlement", async () => {
    const started = ledgerRecord();
    const completed = ledgerRecord("completed");
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

  it("fails recovery closed when the verified transcript reader rejects", async () => {
    const setup = harness([]);
    const callTool = vi.fn(async () => ({ content: [] }));
    setup.deps.resolveAgentMcp = vi.fn(async () => ({
      mcpClient: { callTool, disconnectAll: vi.fn(async () => {}) },
      connected: [],
      extraToolDefinitions: [],
      externalToolExecutors: {},
      externalToolDescriptors: {},
    }));
    setup.deps.readVerifiedEvents = () => {
      const error = new Error("anchored transcript mismatch");
      error.code = "SESSION_TRANSCRIPT_UNVERIFIED";
      throw error;
    };

    const result = await runAgentHeadless(
      { prompt: "continue", resume: "sid", outputFormat: "json" },
      setup.deps,
    );

    expect(result).toMatchObject({
      exitCode: 1,
      isError: true,
    });
    expect(result.result).toContain("CC_SESSION_HOST_SNAPSHOT_UNVERIFIED");
    expect(setup.captured.messages).toBeUndefined();
    expect(setup.deps.resolveAgentMcp).not.toHaveBeenCalled();
    expect(callTool).not.toHaveBeenCalled();
    expect(setup.appendAuthorityEvent).not.toHaveBeenCalled();
  });

  it("does not treat an injected ordinary append as an authority sink", async () => {
    const setup = harness([
      {
        type: "session_start",
        prevHash: null,
        hash: HEAD_1,
        data: { title: "test" },
      },
    ]);
    delete setup.deps.appendAuthorityEvent;

    await runAgentHeadless(
      { prompt: "continue", resume: "sid", outputFormat: "json" },
      setup.deps,
    );

    await expect(
      setup.captured.options.mcpCallLedger.begin({
        sessionId: "sid",
        toolName: "mcp__repo__publish",
        serverName: "repo",
        input: {},
        effectContract: { effect: "write" },
      }),
    ).rejects.toMatchObject({ code: "CC_MCP_LEDGER_PREWRITE_FAILED" });
  });

  it("keeps non-persistent runs on the guarded ledger after outcome unknown", async () => {
    const setup = harness([]);
    const callTool = vi
      .fn()
      .mockRejectedValueOnce(new Error("transport outcome unknown"))
      .mockResolvedValue({ content: [] });
    const toolName = "mcp__repo__publish";
    setup.deps.resolveAgentMcp = async () => ({
      mcpClient: { callTool, disconnectAll: vi.fn(async () => {}) },
      connected: ["repo"],
      extraToolDefinitions: [],
      externalToolExecutors: {
        [toolName]: {
          kind: "mcp",
          serverName: "repo",
          toolName: "publish",
        },
      },
      externalToolDescriptors: {
        [toolName]: {
          name: toolName,
          kind: "mcp",
          category: "mcp",
          source: "mcp:repo",
          effectContract: { declaredEffect: "write" },
        },
      },
    });

    await runAgentHeadless(
      {
        prompt: "publish",
        outputFormat: "json",
        persistSession: false,
      },
      setup.deps,
    );

    expect(
      setup.captured.options.mcpCallLedger?.recoveryAdmission,
    ).toBeDefined();
    setup.captured.options.permissionConfirm = vi.fn(async () => true);
    const first = await executeTool(
      toolName,
      { release: 1 },
      setup.captured.options,
    );
    expect(first).toMatchObject({
      code: "CC_MCP_LEDGER_OUTCOME_UNKNOWN",
      outcomeUnknown: true,
      retryable: false,
    });

    const retry = await executeTool(
      toolName,
      { release: 2 },
      setup.captured.options,
    );
    expect(retry).toMatchObject({
      policy: {
        code: "CC_MCP_TRANSPORT_OUTCOME_UNKNOWN",
        blockMode: "unsafe",
      },
    });
    expect(callTool).toHaveBeenCalledOnce();
  });
});
