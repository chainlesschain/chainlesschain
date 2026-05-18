import { describe, it, expect, vi } from "vitest";
import {
  SharedTaskList,
  TASK_STATUS,
  ConcurrencyError,
  generateTaskId,
} from "../lib/shared-task-list.js";

describe("SharedTaskList — add", () => {
  it("requires title", () => {
    const list = new SharedTaskList();
    expect(() => list.add({})).toThrow(/title required/);
  });

  it("returns task with defaults", () => {
    const list = new SharedTaskList();
    const t = list.add({ title: "Do thing" });
    expect(t.title).toBe("Do thing");
    expect(t.status).toBe(TASK_STATUS.PENDING);
    expect(t.rev).toBe(1);
    expect(t.id).toMatch(/^task_/);
    expect(t.history).toHaveLength(1);
    expect(t.history[0].action).toBe("created");
  });

  it("emits added event", () => {
    const list = new SharedTaskList();
    const spy = vi.fn();
    list.on("added", spy);
    list.add({ title: "x" });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("captures createdBy", () => {
    const list = new SharedTaskList();
    const t = list.add({ title: "x", createdBy: "agent-1" });
    expect(t.createdBy).toBe("agent-1");
    expect(t.history[0].actor).toBe("agent-1");
  });
});

describe("SharedTaskList — update (optimistic lock)", () => {
  it("updates with matching rev", () => {
    const list = new SharedTaskList();
    const t = list.add({ title: "x" });
    const updated = list.update(t.id, {
      rev: 1,
      patch: { description: "new desc" },
      actor: "a1",
    });
    expect(updated.description).toBe("new desc");
    expect(updated.rev).toBe(2);
  });

  it("throws ConcurrencyError on rev mismatch", () => {
    const list = new SharedTaskList();
    const t = list.add({ title: "x" });
    expect(() =>
      list.update(t.id, { rev: 999, patch: { title: "y" } })
    ).toThrow(ConcurrencyError);
  });

  it("throws on missing rev", () => {
    const list = new SharedTaskList();
    const t = list.add({ title: "x" });
    expect(() => list.update(t.id, { patch: {} })).toThrow(/rev required/);
  });

  it("throws on unknown taskId", () => {
    const list = new SharedTaskList();
    expect(() => list.update("ghost", { rev: 1 })).toThrow(/not found/);
  });

  it("rejects invalid status", () => {
    const list = new SharedTaskList();
    const t = list.add({ title: "x" });
    expect(() =>
      list.update(t.id, { rev: 1, patch: { status: "yolo" } })
    ).toThrow(/invalid status/);
  });

  it("ignores non-whitelisted fields", () => {
    const list = new SharedTaskList();
    const t = list.add({ title: "x" });
    const updated = list.update(t.id, {
      rev: 1,
      patch: { id: "hacked", rev: 999, createdAt: 0 },
    });
    expect(updated.id).toBe(t.id);
    expect(updated.rev).toBe(2);
  });

  it("appends history entry", () => {
    const list = new SharedTaskList();
    const t = list.add({ title: "x" });
    list.update(t.id, { rev: 1, patch: { description: "d" }, actor: "bob" });
    const stored = list.get(t.id);
    expect(stored.history).toHaveLength(2);
    expect(stored.history[1].actor).toBe("bob");
    expect(stored.history[1].changes).toContain("description");
  });

  it("emits updated and completed events", () => {
    const list = new SharedTaskList();
    const t = list.add({ title: "x" });
    const updated = vi.fn();
    const completed = vi.fn();
    list.on("updated", updated);
    list.on("completed", completed);
    list.update(t.id, { rev: 1, patch: { status: TASK_STATUS.COMPLETED } });
    expect(updated).toHaveBeenCalledTimes(1);
    expect(completed).toHaveBeenCalledTimes(1);
  });
});

describe("SharedTaskList — claim", () => {
  it("sets assignee and moves to in_progress", () => {
    const list = new SharedTaskList();
    const t = list.add({ title: "x" });
    const claimed = list.claim(t.id, { agentId: "a1" });
    expect(claimed.assignee).toBe("a1");
    expect(claimed.status).toBe(TASK_STATUS.IN_PROGRESS);
  });

  it("returns null for terminal task", () => {
    const list = new SharedTaskList();
    const t = list.add({ title: "x" });
    list.complete(t.id);
    expect(list.claim(t.id, { agentId: "a1" })).toBeNull();
  });

  it("allows multiple claims (overwrites assignee)", () => {
    const list = new SharedTaskList();
    const t = list.add({ title: "x" });
    list.claim(t.id, { agentId: "a1" });
    const c2 = list.claim(t.id, { agentId: "a2" });
    expect(c2.assignee).toBe("a2");
  });
});

describe("SharedTaskList — complete / remove", () => {
  it("complete sets status", () => {
    const list = new SharedTaskList();
    const t = list.add({ title: "x" });
    const done = list.complete(t.id, { note: "finished" });
    expect(done.status).toBe(TASK_STATUS.COMPLETED);
    expect(done.metadata.completionNote).toBe("finished");
  });

  it("remove deletes and emits", () => {
    const list = new SharedTaskList();
    const t = list.add({ title: "x" });
    const spy = vi.fn();
    list.on("removed", spy);
    expect(list.remove(t.id, { actor: "a1" })).toBe(true);
    expect(list.get(t.id)).toBeNull();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0].removedBy).toBe("a1");
  });

  it("remove unknown returns false", () => {
    const list = new SharedTaskList();
    expect(list.remove("ghost")).toBe(false);
  });
});

describe("SharedTaskList — list / stats", () => {
  it("filters by status", () => {
    const list = new SharedTaskList();
    const t1 = list.add({ title: "a" });
    list.add({ title: "b" });
    list.complete(t1.id);
    expect(list.list({ status: TASK_STATUS.COMPLETED })).toHaveLength(1);
    expect(list.list({ status: TASK_STATUS.PENDING })).toHaveLength(1);
  });

  it("filters by assignee", () => {
    const list = new SharedTaskList();
    const t = list.add({ title: "a" });
    list.add({ title: "b" });
    list.claim(t.id, { agentId: "alice" });
    expect(list.list({ assignee: "alice" })).toHaveLength(1);
    expect(list.list({ assignee: null })).toHaveLength(1);
  });

  it("filters by priority", () => {
    const list = new SharedTaskList();
    list.add({ title: "a", priority: "high" });
    list.add({ title: "b", priority: "normal" });
    expect(list.list({ priority: "high" })).toHaveLength(1);
  });

  it("stats counts by status", () => {
    const list = new SharedTaskList();
    const t1 = list.add({ title: "a" });
    list.add({ title: "b" });
    list.complete(t1.id);
    const s = list.stats();
    expect(s.total).toBe(2);
    expect(s.pending).toBe(1);
    expect(s.completed).toBe(1);
  });
});

describe("SharedTaskList — snapshot/restore", () => {
  it("round-trips", () => {
    const list = new SharedTaskList({ groupId: "g1" });
    list.add({ title: "a" });
    list.add({ title: "b" });
    const snap = list.snapshot();
    const restored = SharedTaskList.restore(snap);
    expect(restored.size()).toBe(2);
    expect(restored.groupId).toBe("g1");
  });

  it("snapshot is a deep copy", () => {
    const list = new SharedTaskList();
    const t = list.add({ title: "a" });
    const snap = list.snapshot();
    list.update(t.id, { rev: 1, patch: { title: "changed" } });
    expect(snap.tasks[0].title).toBe("a"); // snapshot unchanged
  });
});

describe("ConcurrencyError", () => {
  it("has taskId + expectedRev + actualRev", () => {
    const err = new ConcurrencyError("t1", 1, 2);
    expect(err.taskId).toBe("t1");
    expect(err.expectedRev).toBe(1);
    expect(err.actualRev).toBe(2);
    expect(err.name).toBe("ConcurrencyError");
  });
});

describe("generateTaskId", () => {
  it("produces unique ids", () => {
    const ids = new Set();
    for (let i = 0; i < 100; i++) ids.add(generateTaskId());
    expect(ids.size).toBe(100);
  });
});
