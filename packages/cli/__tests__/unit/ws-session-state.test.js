import { describe, expect, it } from "vitest";
import {
  WS_SESSION_STATE_SCHEMA,
  appendWsSessionStateEvent,
  createWsSessionState,
  getWsSessionStateSnapshot,
  hydrateWsSessionState,
  recoverWsSessionState,
  serializeWsSessionState,
  syncWsSessionTodo,
} from "../../src/gateways/ws/ws-session-state.js";

describe("WebSocket session state journal", () => {
  it("replays TODO revision, approval, run, and opaque Plan state", () => {
    const journal = createWsSessionState({
      planSnapshot: {
        schema: "future.plan.snapshot",
        revision: 7,
        executionLock: { itemId: "plan-item-1" },
      },
    });

    expect(
      syncWsSessionTodo(
        journal,
        {
          schema: "chainlesschain.todo-snapshot",
          version: 1,
          sessionId: "sess-1",
          revision: 4,
          todos: [
            { id: "todo-1", content: "Verify replay", status: "in_progress" },
          ],
        },
        { at: "2026-08-01T00:00:00.000Z" },
      ),
    ).toBe(true);
    appendWsSessionStateEvent(
      journal,
      "run.started",
      { requestId: "turn-9" },
      { at: "2026-08-01T00:00:01.000Z" },
    );
    appendWsSessionStateEvent(
      journal,
      "approval.requested",
      {
        requestId: "approval-2",
        binding: "sha256-binding",
        tool: "run_command",
        risk: "high",
        rule: "confirm",
      },
      { at: "2026-08-01T00:00:02.000Z" },
    );

    const restored = hydrateWsSessionState(serializeWsSessionState(journal));
    const state = getWsSessionStateSnapshot(restored);

    expect(state).toMatchObject({
      schema: WS_SESSION_STATE_SCHEMA,
      revision: 3,
      todo: {
        revision: 4,
        todos: [
          { id: "todo-1", content: "Verify replay", status: "in_progress" },
        ],
      },
      run: { status: "running", requestId: "turn-9" },
      pendingApproval: {
        requestId: "approval-2",
        status: "pending",
        binding: "sha256-binding",
        tool: "run_command",
      },
      planSnapshot: {
        schema: "future.plan.snapshot",
        revision: 7,
        executionLock: { itemId: "plan-item-1" },
      },
    });
  });

  it("recovers a dead run and approval as interrupted without re-authorizing", () => {
    const journal = createWsSessionState();
    appendWsSessionStateEvent(journal, "run.started", {
      requestId: "turn-dead",
    });
    appendWsSessionStateEvent(journal, "approval.requested", {
      requestId: "approval-dead",
      binding: "bound-call",
      tool: "write_file",
    });

    const recovery = recoverWsSessionState(journal, {
      at: "2026-08-01T00:05:00.000Z",
      reason: "process_restart",
    });
    const state = getWsSessionStateSnapshot(journal);

    expect(recovery).toEqual({
      changed: true,
      runInterrupted: true,
      approvalInterrupted: true,
    });
    expect(state.run).toMatchObject({
      status: "interrupted",
      requestId: "turn-dead",
      reason: "process_restart",
    });
    expect(state.pendingApproval).toMatchObject({
      status: "interrupted",
      requestId: "approval-dead",
      binding: "bound-call",
      reason: "process_restart",
    });

    appendWsSessionStateEvent(journal, "run.settled", {
      requestId: "turn-dead",
    });
    expect(getWsSessionStateSnapshot(journal).run.status).toBe("interrupted");
  });

  it("stops replay at a revision gap and compacts without losing state", () => {
    const gapped = hydrateWsSessionState({
      schema: WS_SESSION_STATE_SCHEMA,
      version: 1,
      snapshot: {
        revision: 2,
        todo: null,
        pendingApproval: null,
        run: { status: "idle" },
      },
      events: [
        {
          revision: 4,
          type: "run.started",
          at: "2026-08-01T00:00:00.000Z",
          payload: { requestId: "must-not-run" },
        },
      ],
    });
    expect(getWsSessionStateSnapshot(gapped)).toMatchObject({
      revision: 2,
      run: { status: "idle" },
    });

    const compacted = createWsSessionState({ maxEvents: 2 });
    appendWsSessionStateEvent(compacted, "run.started", { requestId: "a" });
    appendWsSessionStateEvent(compacted, "run.settled", { requestId: "a" });
    appendWsSessionStateEvent(compacted, "run.started", { requestId: "b" });
    const persisted = serializeWsSessionState(compacted);

    expect(persisted.snapshot.revision).toBe(1);
    expect(persisted.events).toHaveLength(2);
    expect(
      getWsSessionStateSnapshot(hydrateWsSessionState(persisted)),
    ).toMatchObject({
      revision: 3,
      run: { status: "running", requestId: "b" },
    });
  });

  it("migrates a legacy Plan snapshot as opaque data", () => {
    const legacyPlan = {
      state: "approved",
      futureFields: { owner: "agent-a", checkpoint: "cp-7" },
    };
    const journal = hydrateWsSessionState(null, {
      planSnapshot: legacyPlan,
    });

    expect(getWsSessionStateSnapshot(journal).planSnapshot).toEqual(legacyPlan);
    expect(serializeWsSessionState(journal).snapshot.planSnapshot).toEqual(
      legacyPlan,
    );
  });
});
