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
});
