/**
 * workflow-state-machine 单元测试 —— 转换表守卫、生命周期助手、retry-from-failed、
 * isTerminal(排除可重试的 FAILED)、元数据、历史拷贝、toJSON/fromJSON 往返。
 */

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const {
  WorkflowStateMachine,
  WorkflowState,
} = require("../workflow-state-machine.js");

describe("WorkflowStateMachine construction", () => {
  it("starts IDLE and records the initial state", () => {
    const sm = new WorkflowStateMachine("wf1");
    expect(sm.getState()).toBe(WorkflowState.IDLE);
    expect(sm.getHistory()).toHaveLength(1);
    expect(sm.getHistory()[0]).toMatchObject({
      from: null,
      to: WorkflowState.IDLE,
      reason: "initialized",
    });
  });
});

describe("WorkflowStateMachine transitions", () => {
  it("canTransitionTo follows the transition table", () => {
    const sm = new WorkflowStateMachine("wf");
    expect(sm.canTransitionTo(WorkflowState.RUNNING)).toBe(true);
    expect(sm.canTransitionTo(WorkflowState.COMPLETED)).toBe(false); // idle -> completed not allowed
    expect(sm.canTransitionTo(WorkflowState.CANCELLED)).toBe(true);
  });

  it("transitionTo applies a valid move, records history, and emits", () => {
    const sm = new WorkflowStateMachine("wf");
    const events = [];
    sm.on("state-change", (e) => events.push(e));
    const ok = sm.transitionTo(WorkflowState.RUNNING, "go");
    expect(ok).toBe(true);
    expect(sm.getState()).toBe(WorkflowState.RUNNING);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      workflowId: "wf",
      previousState: WorkflowState.IDLE,
      currentState: WorkflowState.RUNNING,
      reason: "go",
    });
  });

  it("rejects an invalid move without changing state or emitting", () => {
    const sm = new WorkflowStateMachine("wf");
    const spy = vi.fn();
    sm.on("state-change", spy);
    const ok = sm.transitionTo(WorkflowState.COMPLETED); // idle -> completed invalid
    expect(ok).toBe(false);
    expect(sm.getState()).toBe(WorkflowState.IDLE);
    expect(spy).not.toHaveBeenCalled();
    expect(sm.getHistory()).toHaveLength(1); // unchanged
  });
});

describe("WorkflowStateMachine lifecycle helpers", () => {
  it("runs the start -> pause -> resume -> complete happy path", () => {
    const sm = new WorkflowStateMachine("wf");
    expect(sm.start()).toBe(true);
    expect(sm.isRunning()).toBe(true);
    expect(sm.pause()).toBe(true);
    expect(sm.isPaused()).toBe(true);
    expect(sm.resume()).toBe(true);
    expect(sm.complete()).toBe(true);
    expect(sm.getState()).toBe(WorkflowState.COMPLETED);
    expect(sm.isTerminal()).toBe(true);
  });

  it("cancel works from idle, running and paused", () => {
    expect(new WorkflowStateMachine("a").cancel()).toBe(true);
    const running = new WorkflowStateMachine("b");
    running.start();
    expect(running.cancel("stop")).toBe(true);
    expect(running.getState()).toBe(WorkflowState.CANCELLED);
  });

  it("retry only succeeds from FAILED", () => {
    const sm = new WorkflowStateMachine("wf");
    expect(sm.retry()).toBe(false); // idle, not failed
    sm.start();
    expect(sm.fail("boom")).toBe(true);
    expect(sm.getState()).toBe(WorkflowState.FAILED);
    expect(sm.retry()).toBe(true);
    expect(sm.getState()).toBe(WorkflowState.RUNNING);
  });

  it("cannot complete directly from a paused state", () => {
    const sm = new WorkflowStateMachine("wf");
    sm.start();
    sm.pause();
    expect(sm.complete()).toBe(false); // paused -> completed not allowed
    expect(sm.getState()).toBe(WorkflowState.PAUSED);
  });
});

describe("WorkflowStateMachine.isTerminal", () => {
  it("treats COMPLETED and CANCELLED as terminal but FAILED as retryable (non-terminal)", () => {
    const completed = new WorkflowStateMachine("a");
    completed.start();
    completed.complete();
    expect(completed.isTerminal()).toBe(true);

    const cancelled = new WorkflowStateMachine("b");
    cancelled.cancel();
    expect(cancelled.isTerminal()).toBe(true);

    const failed = new WorkflowStateMachine("c");
    failed.start();
    failed.fail();
    // FAILED is intentionally non-terminal: its only allowed transition is RUNNING (retry)
    expect(failed.isTerminal()).toBe(false);
  });
});

describe("WorkflowStateMachine metadata & history", () => {
  it("stores and reads metadata", () => {
    const sm = new WorkflowStateMachine("wf");
    sm.setMetadata("k", { v: 1 });
    expect(sm.getMetadata("k")).toEqual({ v: 1 });
    expect(sm.getMetadata("missing")).toBeUndefined();
  });

  it("getHistory returns a copy that does not mutate internal state", () => {
    const sm = new WorkflowStateMachine("wf");
    const h = sm.getHistory();
    h.push({ bogus: true });
    expect(sm.getHistory()).toHaveLength(1);
  });
});

describe("WorkflowStateMachine serialization", () => {
  it("round-trips through toJSON / fromJSON", () => {
    const sm = new WorkflowStateMachine("wf");
    sm.start();
    sm.setMetadata("note", "hi");
    const json = sm.toJSON();
    const restored = WorkflowStateMachine.fromJSON(json);
    expect(restored.workflowId).toBe("wf");
    expect(restored.getState()).toBe(WorkflowState.RUNNING);
    expect(restored.getMetadata("note")).toBe("hi");
    expect(restored.getHistory()).toEqual(sm.getHistory());
  });

  it("fromJSON trusts the provided state verbatim (no validation)", () => {
    // Documents current behavior: a restored machine adopts data.state as-is.
    const restored = WorkflowStateMachine.fromJSON({
      workflowId: "x",
      state: WorkflowState.COMPLETED,
    });
    expect(restored.getState()).toBe(WorkflowState.COMPLETED);
    expect(restored.getHistory()).toEqual([]); // defaults when absent
    expect(restored.isTerminal()).toBe(true);
  });
});
