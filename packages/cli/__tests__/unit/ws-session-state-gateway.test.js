import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/lib/plan-mode.js", () => ({
  PlanModeManager: vi.fn(function () {
    return {
      state: "inactive",
      currentPlan: null,
      history: [],
      blockedToolLog: [],
      on: vi.fn(),
      off: vi.fn(),
      removeAllListeners: vi.fn(),
    };
  }),
  PlanState: { INACTIVE: "inactive" },
  ExecutionPlan: class ExecutionPlan {
    constructor(data = {}) {
      Object.assign(this, data);
    }
  },
}));

vi.mock("../../src/lib/cli-context-engineering.js", () => ({
  CLIContextEngineering: vi.fn(function () {
    return {};
  }),
}));

vi.mock("../../src/lib/permanent-memory.js", () => ({
  CLIPermanentMemory: vi.fn(function () {
    return { initialize: vi.fn() };
  }),
}));

vi.mock("../../src/lib/session-manager.js", () => ({
  createSession: vi.fn(),
  saveMessages: vi.fn(),
  getSession: vi.fn(),
  listSessions: vi.fn(() => []),
  updateSession: vi.fn(),
}));

vi.mock("../../src/runtime/agent-core.js", () => ({
  buildSystemPrompt: vi.fn(() => "system"),
}));

vi.mock("../../src/harness/worktree-isolator.js", () => ({
  createWorktree: vi.fn(),
  removeWorktree: vi.fn(),
}));

vi.mock("../../src/lib/git-integration.js", () => ({
  isGitRepo: vi.fn(() => false),
}));

import { WSSessionManager } from "../../src/gateways/ws/ws-session-gateway.js";
import {
  getSession as dbGetSession,
  saveMessages as dbSaveMessages,
} from "../../src/lib/session-manager.js";
import {
  appendWsSessionStateEvent,
  createWsSessionState,
  serializeWsSessionState,
} from "../../src/gateways/ws/ws-session-state.js";

function memoryCanonicalStore() {
  const events = new Map();
  return {
    events,
    appendEvent: vi.fn((sessionId, type, data) => {
      const rows = events.get(sessionId) || [];
      const event = { type, data };
      rows.push(event);
      events.set(sessionId, rows);
      return event;
    }),
    findLatestEvent: vi.fn((sessionId, type) =>
      (events.get(sessionId) || [])
        .filter((event) => event.type === type)
        .at(-1),
    ),
  };
}

describe("WSSessionManager recovery state integration", () => {
  const db = {};

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("serializes state events without changing legacy metadata fields", () => {
    const manager = new WSSessionManager({
      db,
      defaultProjectRoot: process.cwd(),
    });
    const { sessionId } = manager.createSession();

    manager.recordSessionStateEvent(sessionId, "todo.snapshot", {
      todo: {
        sessionId,
        revision: 8,
        todos: [{ id: "t-1", content: "Ship", status: "in_progress" }],
      },
    });
    manager.recordSessionStateEvent(sessionId, "run.started", {
      requestId: "turn-8",
    });

    const metadata = manager._serializeSessionMetadata(
      manager.getSession(sessionId),
    );
    const state = manager.getSessionStateSnapshot(sessionId);

    expect(metadata).toMatchObject({
      version: 1,
      sessionType: "agent",
      status: "active",
      planSnapshot: { state: "inactive" },
      sessionState: {
        schema: "chainlesschain.ws-session-state",
        version: 1,
      },
    });
    expect(state).toMatchObject({
      revision: 2,
      todo: { revision: 8 },
      run: { status: "running", requestId: "turn-8" },
    });
  });

  it("replays DB state and fail-closes a dead run and approval", () => {
    const journal = createWsSessionState({
      planSnapshot: {
        schema: "opaque-plan-vNext",
        executionLock: { itemId: "p-1" },
      },
    });
    appendWsSessionStateEvent(journal, "todo.snapshot", {
      todo: {
        sessionId: "resume-1",
        revision: 11,
        todos: [{ id: "t-1", content: "Resume", status: "in_progress" }],
      },
    });
    appendWsSessionStateEvent(journal, "run.started", {
      requestId: "turn-dead",
    });
    appendWsSessionStateEvent(journal, "approval.requested", {
      requestId: "approval-dead",
      binding: "binding-digest",
      tool: "run_command",
      risk: "high",
    });

    dbGetSession.mockReturnValue({
      id: "resume-1",
      provider: "ollama",
      model: "qwen2.5:7b",
      messages: [{ role: "system", content: "system" }],
      metadata: {
        sessionType: "agent",
        projectRoot: process.cwd(),
        baseProjectRoot: process.cwd(),
        sessionState: serializeWsSessionState(journal),
      },
      created_at: "2026-08-01T00:00:00.000Z",
    });

    const manager = new WSSessionManager({
      db,
      defaultProjectRoot: process.cwd(),
    });
    const session = manager.resumeSession("resume-1");
    const state = manager.getSessionStateSnapshot(session.id);

    expect(state.todo.revision).toBe(11);
    expect(state.run).toMatchObject({
      status: "interrupted",
      requestId: "turn-dead",
      reason: "process_restart",
    });
    expect(state.pendingApproval).toMatchObject({
      status: "interrupted",
      requestId: "approval-dead",
      binding: "binding-digest",
      reason: "process_restart",
    });
    expect(state.planSnapshot).toEqual({
      schema: "opaque-plan-vNext",
      executionLock: { itemId: "p-1" },
    });
    expect(dbSaveMessages).toHaveBeenCalledWith(
      db,
      "resume-1",
      session.messages,
      expect.objectContaining({
        sessionState: expect.objectContaining({
          schema: "chainlesschain.ws-session-state",
        }),
      }),
    );
  });

  it("migrates old metadata while leaving Plan ownership unchanged", () => {
    const legacyPlan = {
      state: "approved",
      currentPlan: { id: "legacy-plan", items: [] },
      futureField: { checkpoint: "cp-1" },
    };
    dbGetSession.mockReturnValue({
      id: "legacy-1",
      provider: "ollama",
      model: "qwen2.5:7b",
      messages: [],
      metadata: {
        projectRoot: process.cwd(),
        baseProjectRoot: process.cwd(),
        planSnapshot: legacyPlan,
      },
      created_at: "2026-08-01T00:00:00.000Z",
    });

    const manager = new WSSessionManager({
      db,
      defaultProjectRoot: process.cwd(),
    });
    const session = manager.resumeSession("legacy-1");

    expect(session.planManager.state).toBe("approved");
    expect(manager.getSessionStateSnapshot("legacy-1").planSnapshot).toEqual(
      legacyPlan,
    );
  });

  it("uses the canonical rollout state ahead of a stale DB metadata projection", () => {
    const canonicalSessionStore = memoryCanonicalStore();
    const writer = new WSSessionManager({
      db,
      defaultProjectRoot: process.cwd(),
      canonicalSessionStore,
    });
    const { sessionId } = writer.createSession({ sessionId: "canonical-1" });
    writer.markCanonicalSession(sessionId);
    writer.recordSessionStateEvent(sessionId, "run.started", {
      requestId: "turn-canonical",
    });

    dbGetSession.mockReturnValue({
      id: sessionId,
      provider: "ollama",
      model: "qwen2.5:7b",
      messages: [{ role: "system", content: "system" }],
      metadata: {
        sessionType: "agent",
        projectRoot: process.cwd(),
        baseProjectRoot: process.cwd(),
        canonicalJsonlSession: true,
        sessionState: serializeWsSessionState(createWsSessionState()),
      },
      created_at: "2026-08-01T00:00:00.000Z",
    });
    const reader = new WSSessionManager({
      db,
      defaultProjectRoot: process.cwd(),
      canonicalSessionStore,
    });
    const resumed = reader.resumeSession(sessionId);

    expect(reader.getSessionStateSnapshot(resumed.id).run).toMatchObject({
      status: "interrupted",
      requestId: "turn-canonical",
      reason: "process_restart",
    });
    expect(canonicalSessionStore.appendEvent).toHaveBeenLastCalledWith(
      sessionId,
      "ws_session_state",
      expect.objectContaining({
        journal: expect.objectContaining({
          events: expect.arrayContaining([
            expect.objectContaining({ type: "run.interrupted" }),
          ]),
        }),
      }),
    );
  });

  it("rehydrates canonical-only WS state without replacing it with an empty projection", () => {
    const canonicalSessionStore = memoryCanonicalStore();
    const writer = new WSSessionManager({
      db,
      defaultProjectRoot: process.cwd(),
      canonicalSessionStore,
    });
    const { sessionId } = writer.createSession({
      sessionId: "canonical-only-1",
    });
    writer.markCanonicalSession(sessionId);
    writer.recordSessionStateEvent(sessionId, "run.started", {
      requestId: "turn-canonical-only",
    });

    const reader = new WSSessionManager({
      db: null,
      defaultProjectRoot: process.cwd(),
      canonicalSessionStore,
    });
    const resumed = reader.resumeCanonicalSession(sessionId);

    expect(resumed.canonicalJsonlSession).toBe(true);
    expect(reader.getSessionStateSnapshot(sessionId).run).toMatchObject({
      status: "interrupted",
      requestId: "turn-canonical-only",
      reason: "process_restart",
    });
    expect(canonicalSessionStore.appendEvent).toHaveBeenLastCalledWith(
      sessionId,
      "ws_session_state",
      expect.objectContaining({
        journal: expect.objectContaining({
          events: expect.arrayContaining([
            expect.objectContaining({ type: "run.interrupted" }),
          ]),
        }),
      }),
    );
  });

  it("fails closed instead of replacing a corrupt canonical WS journal", () => {
    const canonicalSessionStore = memoryCanonicalStore();
    canonicalSessionStore.events.set("canonical-corrupt", [
      {
        type: "ws_session_state",
        data: {
          schema: "chainlesschain.ws-session-rollout/v1",
          journal: {
            schema: "wrong",
            version: 1,
            snapshot: {},
            events: [],
          },
        },
      },
    ]);
    const reader = new WSSessionManager({
      db: null,
      defaultProjectRoot: process.cwd(),
      canonicalSessionStore,
    });

    expect(() =>
      reader.resumeCanonicalSession("canonical-corrupt"),
    ).toThrowError(
      expect.objectContaining({ code: "CC_WS_CANONICAL_STATE_CORRUPT" }),
    );
    expect(canonicalSessionStore.appendEvent).not.toHaveBeenCalled();
  });
});
