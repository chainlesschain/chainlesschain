/**
 * Integration (P0-2, IDE/Bridge path): WSAgentHandler records an irreversible
 * tool as in-flight; on a bridge resume (handleSessionResume) the interrupted
 * op is surfaced to the IDE client AND injected as a system note, instead of
 * being silently replayed. Mirrors the headless path for the WS gateway.
 *
 * The side-effect ledger store's `_deps` are overridden with an in-memory events
 * array so both the recording (WSAgentHandler) and the reconcile (bridge resume)
 * read/write the same store without touching disk.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/runtime/agent-core.js", () => ({
  agentLoop: vi.fn(),
  formatToolArgs: vi.fn((tool, args) => `${tool}(${JSON.stringify(args)})`),
}));
vi.mock("../../src/lib/task-model-selector.js", () => ({
  detectTaskType: vi.fn(() => ({
    confidence: 0.1,
    taskType: "general",
    name: "general",
  })),
  selectModelForTask: vi.fn(() => null),
}));
vi.mock("../../src/lib/plan-mode.js", () => ({
  PlanState: {
    INACTIVE: "inactive",
    ANALYZING: "analyzing",
    APPROVED: "approved",
    REJECTED: "rejected",
  },
}));

import { WSAgentHandler } from "../../src/gateways/ws/ws-agent-handler.js";
import { handleSessionResume } from "../../src/gateways/ws/session-protocol.js";
import { agentLoop } from "../../src/runtime/agent-core.js";
import * as seStore from "../../src/lib/side-effect-ledger-store.js";

let events;
beforeEach(() => {
  vi.clearAllMocks();
  events = [];
  seStore._deps.appendEvent = (_sid, type, data) => events.push({ type, data });
  seStore._deps.readEvents = () => events.slice();
});

function makeSession() {
  return {
    id: "ws-crash-session",
    type: "agent",
    messages: [{ role: "system", content: "You are helpful." }],
    provider: "ollama",
    model: "qwen2.5:7b",
    apiKey: null,
    baseUrl: "http://localhost:11434",
    projectRoot: "/proj",
    enabledToolNames: ["git"],
    planManager: { isActive: () => false },
    contextEngine: { recordError: vi.fn() },
  };
}

function fakeLoop(events) {
  return (async function* () {
    for (const e of events) yield e;
  })();
}

describe("WS bridge side-effect resume", () => {
  it("records a mid-flight git push and surfaces it on bridge resume", async () => {
    const session = makeSession();
    const interaction = { emit: vi.fn(), rejectAllPending: vi.fn() };
    const handler = new WSAgentHandler({ session, interaction, db: null });

    // The turn issues a git push but dies before the tool-result.
    agentLoop.mockReturnValue(
      fakeLoop([
        {
          type: "tool-executing",
          tool: "git",
          args: { command: "push origin main" },
        },
        // No tool-result — the bridge worker "crashed" mid-push.
      ]),
    );
    await handler.handleMessage("push it", "req-1");

    // A started git-push snapshot is in the (injected) store.
    const snap = [...events]
      .reverse()
      .find((e) => e.type === "side_effect_ledger");
    expect(snap).toBeTruthy();
    expect(
      snap.data.ops.some((o) => o.kind === "git-push" && o.state === "started"),
    ).toBe(true);

    // ── Bridge resume must surface the interrupted op ───────────────────────
    const sent = [];
    const server = {
      sessionManager: { resumeSession: () => session },
      sessionHandlers: new Map([[session.id, handler]]), // skip ensureSessionHandler
      emit: vi.fn(),
      _send: (_ws, env) => sent.push(env),
    };
    await handleSessionResume(server, "req-2", {}, { sessionId: session.id });

    const wire = JSON.stringify(sent);
    expect(wire).toMatch(/Recovery notice/);
    expect(wire).toMatch(/git-push/);

    // The resumed model context also carries the recovery note.
    const sysNote = session.messages.find(
      (m) => m.role === "system" && /Recovery notice/.test(String(m.content)),
    );
    expect(sysNote).toBeTruthy();

    // The runtime SESSION_RESUME event also carries the structured descriptor.
    expect(JSON.stringify(server.emit.mock.calls)).toMatch(/git-push/);
  });

  it("adds no recovery when the tool committed cleanly", async () => {
    const session = makeSession();
    const interaction = { emit: vi.fn(), rejectAllPending: vi.fn() };
    const handler = new WSAgentHandler({ session, interaction, db: null });

    agentLoop.mockReturnValue(
      fakeLoop([
        {
          type: "tool-executing",
          tool: "git",
          args: { command: "push origin main" },
        },
        { type: "tool-result", tool: "git", result: { ok: true } },
      ]),
    );
    await handler.handleMessage("push it", "req-1");

    const sent = [];
    const server = {
      sessionManager: { resumeSession: () => session },
      sessionHandlers: new Map([[session.id, handler]]),
      emit: vi.fn(),
      _send: (_ws, env) => sent.push(env),
    };
    await handleSessionResume(server, "req-2", {}, { sessionId: session.id });

    expect(JSON.stringify(sent)).not.toMatch(/Recovery notice/);
    expect(
      session.messages.some(
        (m) => m.role === "system" && /Recovery notice/.test(String(m.content)),
      ),
    ).toBe(false);
  });

  it("binds an unreadable MCP recovery ledger to the resumed handler and blocks callTool", async () => {
    const session = makeSession();
    session.mcpClient = { callTool: vi.fn() };
    const interaction = { emit: vi.fn(), rejectAllPending: vi.fn() };
    const handler = new WSAgentHandler({ session, interaction, db: null });
    // Warm a clean controller first. Resume must refresh this exact live
    // handler before it can serve another turn.
    session.mcpLedgerRecovery = { unsettled: [], incidents: [] };
    session.mcpLedgerRecoveryRevision = 1;
    agentLoop.mockReturnValue(
      fakeLoop([{ type: "response-complete", content: "warm" }]),
    );
    await handler.handleMessage("warm runtime", "req-warm");
    const readError = Object.assign(new Error("unverified transcript"), {
      code: "SESSION_TRANSCRIPT_UNVERIFIED",
    });
    const server = {
      sessionManager: { resumeSession: () => session },
      sessionHandlers: new Map([[session.id, handler]]),
      resumeRecoveryDependencies: {
        loadSideEffectLedger: () => {
          throw new Error("no side-effect ledger");
        },
        loadMcpLedgerRecovery: () => {
          throw readError;
        },
      },
      emit: vi.fn(),
      _send: vi.fn(),
    };

    await handleSessionResume(
      server,
      "req-resume",
      {},
      {
        sessionId: session.id,
      },
    );
    expect(session.mcpLedgerRecovery.incidents).toEqual([
      { code: "SESSION_TRANSCRIPT_UNVERIFIED", ledgerId: null },
    ]);

    agentLoop.mockReturnValue(
      fakeLoop([{ type: "response-complete", content: "blocked" }]),
    );
    await handler.handleMessage("retry status", "req-turn");
    const loopOptions = agentLoop.mock.calls.at(-1)[1];
    await expect(
      loopOptions.mcpCallLedger.begin({
        sessionId: session.id,
        toolName: "mcp__repo__status",
        serverName: "repo",
        input: {},
        effectContract: { effect: "read" },
      }),
    ).rejects.toMatchObject({
      code: "CC_MCP_LEDGER_RECOVERY_BLOCKED",
      effect: "read",
      blockMode: "all",
    });
    await expect(
      loopOptions.mcpHostClient.callTool("repo", "status", {}),
    ).rejects.toMatchObject({
      code: "CC_MCP_LEDGER_RECOVERY_BLOCKED",
      blockMode: "all",
    });
    expect(session.mcpClient.callTool).not.toHaveBeenCalled();
  });

  it("binds a proxied MCP projection as ALL-blocking on the real handler path", async () => {
    const session = makeSession();
    session.mcpClient = { callTool: vi.fn() };
    const interaction = { emit: vi.fn(), rejectAllPending: vi.fn() };
    const handler = new WSAgentHandler({ session, interaction, db: null });
    let getterReads = 0;
    const recovery = new Proxy(
      {
        unsettled: [
          {
            ledgerId: "proxy-write",
            serverName: "repo",
            toolName: "publish",
            effectContract: { effect: "write" },
          },
        ],
        incidents: [],
      },
      {
        get(target, key, receiver) {
          getterReads += 1;
          return Reflect.get(target, key, receiver);
        },
      },
    );
    const server = {
      sessionManager: { resumeSession: () => session },
      sessionHandlers: new Map([[session.id, handler]]),
      resumeRecoveryDependencies: {
        loadSideEffectLedger: () => ({ ops: [] }),
        loadMcpLedgerRecovery: () => recovery,
      },
      emit: vi.fn(),
      _send: vi.fn(),
    };

    await handleSessionResume(
      server,
      "req-proxy",
      {},
      { sessionId: session.id },
    );
    expect(getterReads).toBe(0);
    expect(session.mcpLedgerRecovery).toMatchObject({
      blockMode: "all",
      incidents: [{ code: "CC_MCP_LEDGER_RECOVERY_INVALID", ledgerId: null }],
    });

    agentLoop.mockReturnValue(
      fakeLoop([{ type: "response-complete", content: "blocked" }]),
    );
    await handler.handleMessage("retry proxy", "req-proxy-turn");
    const loopOptions = agentLoop.mock.calls.at(-1)[1];
    await expect(
      loopOptions.mcpCallLedger.begin({
        sessionId: session.id,
        serverName: "repo",
        toolName: "status",
        input: {},
        effectContract: { effect: "read" },
      }),
    ).rejects.toMatchObject({ blockMode: "all" });
    await expect(
      loopOptions.mcpHostClient.callTool("repo", "status", {}),
    ).rejects.toMatchObject({ blockMode: "all" });
    expect(session.mcpClient.callTool).not.toHaveBeenCalled();
  });

  it("preserves an unsafe settlement latch when the raw MCP client changes", async () => {
    const session = makeSession();
    const firstClient = { callTool: vi.fn(async () => ({ ok: true })) };
    const secondClient = { callTool: vi.fn(async () => ({ ok: true })) };
    session.mcpClient = firstClient;
    session.mcpLedgerRecovery = { unsettled: [], incidents: [] };
    session.mcpLedgerRecoveryRevision = 1;
    const interaction = { emit: vi.fn(), rejectAllPending: vi.fn() };
    const handler = new WSAgentHandler({ session, interaction, db: null });
    const initialRuntime = handler.refreshMcpRecoveryRuntime();
    initialRuntime.controller.latchUnsafe("CC_MCP_LEDGER_SETTLE_FAILED");

    session.mcpClient = secondClient;
    agentLoop.mockReturnValue(
      fakeLoop([{ type: "response-complete", content: "blocked" }]),
    );
    await handler.handleMessage("publish again", "req-client-change");
    const loopOptions = agentLoop.mock.calls.at(-1)[1];

    expect(loopOptions.mcpCallLedger.recoveryAdmission).toMatchObject({
      blockMode: "unsafe",
      reasonCode: "CC_MCP_LEDGER_SETTLE_FAILED",
    });
    await expect(
      loopOptions.mcpCallLedger.begin({
        sessionId: session.id,
        serverName: "repo",
        toolName: "publish",
        input: {},
        effectContract: { effect: "write" },
      }),
    ).rejects.toMatchObject({ blockMode: "unsafe" });
    await expect(
      loopOptions.mcpHostClient.callTool("repo", "publish", {}),
    ).rejects.toMatchObject({ blockMode: "unsafe" });
    expect(firstClient.callTool).not.toHaveBeenCalled();
    expect(secondClient.callTool).not.toHaveBeenCalled();
  });

  it("returns a diagnosable ALL-blocking resume when handler refresh fails", async () => {
    const session = makeSession();
    session.mcpClient = {}; // truthy, but cannot build a guarded callTool client
    const interaction = { emit: vi.fn(), rejectAllPending: vi.fn() };
    const handler = new WSAgentHandler({ session, interaction, db: null });
    const sent = [];
    const server = {
      sessionManager: { resumeSession: () => session },
      sessionHandlers: new Map([[session.id, handler]]),
      resumeRecoveryDependencies: {
        loadSideEffectLedger: () => ({ ops: [] }),
        loadMcpLedgerRecovery: () => ({ unsettled: [], incidents: [] }),
      },
      emit: vi.fn(),
      _send: (_ws, envelope) => sent.push(envelope),
    };

    await expect(
      handleSessionResume(
        server,
        "req-refresh-fail",
        {},
        {
          sessionId: session.id,
        },
      ),
    ).resolves.toBeUndefined();

    expect(session.mcpLedgerRecovery).toMatchObject({
      blockMode: "all",
      incidents: [{ code: "CC_MCP_RECOVERY_REFRESH_FAILED", ledgerId: null }],
    });
    expect(JSON.stringify(sent)).toContain("CC_MCP_RECOVERY_REFRESH_FAILED");
    expect(JSON.stringify(sent)).toContain("session.resumed");
  });

  it("fails closed before a dangerous tool when the ledger write is unavailable", async () => {
    const session = makeSession();
    const interaction = { emit: vi.fn(), rejectAllPending: vi.fn() };
    const handler = new WSAgentHandler({ session, interaction, db: null });
    let effectExecuted = false;
    agentLoop.mockReturnValue(
      (async function* () {
        yield {
          type: "tool-executing",
          tool: "git",
          args: { command: "push origin main" },
        };
        effectExecuted = true;
        yield { type: "tool-result", tool: "git", result: { ok: true } };
      })(),
    );
    seStore._deps.appendEvent = () => {
      throw new Error("ledger lock unavailable");
    };

    await handler.handleMessage("push it", "req-1");

    expect(effectExecuted).toBe(false);
    expect(interaction.emit).toHaveBeenCalledWith(
      "error",
      expect.objectContaining({
        requestId: "req-1",
        code: "AGENT_ERROR",
        message: expect.stringMatching(/ledger lock unavailable/),
      }),
    );
  });

  it("persists a bound Diff Review audit on a committed file write", async () => {
    const session = makeSession();
    const interaction = { emit: vi.fn(), rejectAllPending: vi.fn() };
    const handler = new WSAgentHandler({ session, interaction, db: null });
    const audit = {
      schema: "cc-diff-review/v1",
      sessionId: session.id,
      turnId: "run-1:t2",
      toolUseId: "call-7",
      outcome: "accepted",
    };
    agentLoop.mockReturnValue(
      fakeLoop([
        {
          type: "tool-executing",
          tool: "write_file",
          args: { path: "a.js", content: "x" },
        },
        {
          type: "tool-result",
          tool: "write_file",
          result: { ok: true, _diffReviewAudit: audit },
        },
      ]),
    );
    await handler.handleMessage("edit it", "req-1");

    const snapshot = [...events]
      .reverse()
      .find((event) => event.type === "side_effect_ledger");
    expect(snapshot.data.ops[0]).toMatchObject({
      state: "committed",
      meta: { diffReview: audit },
    });
  });

  it("links an accepted re-proposal to the preceding Request Changes review", async () => {
    const session = makeSession();
    const interaction = { emit: vi.fn(), rejectAllPending: vi.fn() };
    const handler = new WSAgentHandler({ session, interaction, db: null });
    const requested = {
      schema: "cc-diff-review/v1",
      reviewId: "drev_request",
      sessionId: session.id,
      turnId: "run-1:t1",
      toolUseId: "call-1",
      path: "/proj/a.js",
      operation: "modify",
      outcome: "changes-requested",
      written: false,
    };
    const accepted = {
      ...requested,
      reviewId: "drev_accept",
      turnId: "run-1:t2",
      toolUseId: "call-2",
      outcome: "accepted",
      written: true,
    };
    agentLoop.mockReturnValue(
      fakeLoop([
        {
          type: "tool-executing",
          tool: "write_file",
          args: { path: "a.js", content: "first" },
        },
        {
          type: "tool-result",
          tool: "write_file",
          result: {
            error: "changes requested",
            _diffReviewAudit: requested,
          },
        },
        {
          type: "tool-executing",
          tool: "write_file",
          args: { path: "a.js", content: "revised" },
        },
        {
          type: "tool-result",
          tool: "write_file",
          result: { ok: true, _diffReviewAudit: accepted },
        },
        { type: "response-complete", content: "done" },
      ]),
    );
    await handler.handleMessage("edit it", "req-1");

    const snapshot = [...events]
      .reverse()
      .find((event) => event.type === "side_effect_ledger");
    expect(snapshot.data.ops[0].meta.diffReview.followUp).toMatchObject({
      status: "accepted",
      reviewId: "drev_accept",
      turnId: "run-1:t2",
      toolUseId: "call-2",
      written: true,
    });
    expect(snapshot.data.ops[1].meta.diffReview).toMatchObject({
      reviewId: "drev_accept",
      outcome: "accepted",
    });
  });
});
