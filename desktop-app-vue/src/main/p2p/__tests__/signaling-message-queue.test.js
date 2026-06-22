/**
 * signaling-message-queue 单元测试 —— 入队/满批丢最旧、出队清空、peek 不改、
 * 按 id 删除、TTL 过期清理、统计/计数、clearQueue/clearAll。不调用 initialize()。
 */

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const SignalingMessageQueue = require("../signaling-message-queue.js");

let q;
beforeEach(() => {
  q = new SignalingMessageQueue();
});

describe("SignalingMessageQueue enqueue/dequeue", () => {
  it("enqueues and reports the queue size + messageId", () => {
    const r = q.enqueue("p1", { type: "offer" });
    expect(r.success).toBe(true);
    expect(r.messageId).toMatch(/^msg_/);
    expect(r.queueSize).toBe(1);
    expect(q.getStats().totalEnqueued).toBe(1);
  });

  it("drops the oldest message when the per-peer cap is exceeded", () => {
    q.setMaxQueueSize(2);
    q.enqueue("p1", { n: 1 });
    q.enqueue("p1", { n: 2 });
    q.enqueue("p1", { n: 3 }); // cap reached -> drop n:1
    const pending = q.peek("p1").map((e) => e.message.n);
    expect(pending).toEqual([2, 3]);
    expect(q.getStats().totalDropped).toBe(1);
  });

  it("dequeues all messages and clears the queue", () => {
    q.enqueue("p1", { n: 1 });
    q.enqueue("p1", { n: 2 });
    const out = q.dequeue("p1");
    expect(out.map((e) => e.message.n)).toEqual([1, 2]);
    expect(q.getQueueSize("p1")).toBe(0);
    expect(q.dequeue("p1")).toEqual([]); // already drained
    expect(q.getStats().totalDequeued).toBe(2);
  });

  it("dequeue of an unknown peer returns an empty array", () => {
    expect(q.dequeue("nobody")).toEqual([]);
  });
});

describe("SignalingMessageQueue peek/remove/clear", () => {
  it("peek returns a copy that does not mutate the queue", () => {
    q.enqueue("p1", { n: 1 });
    const peeked = q.peek("p1");
    peeked.push({ bogus: true });
    expect(q.getQueueSize("p1")).toBe(1);
  });

  it("removeMessage deletes by id and drops the empty queue", () => {
    const { messageId } = q.enqueue("p1", { n: 1 });
    expect(q.removeMessage("p1", "missing")).toBe(false);
    expect(q.removeMessage("p1", messageId)).toBe(true);
    expect(q.getPeersWithMessages()).not.toContain("p1"); // empty queue removed
  });

  it("clearQueue returns the count and removes the queue", () => {
    q.enqueue("p1", {});
    q.enqueue("p1", {});
    expect(q.clearQueue("p1")).toBe(2);
    expect(q.getQueueSize("p1")).toBe(0);
  });

  it("clearAll empties every queue", () => {
    q.enqueue("p1", {});
    q.enqueue("p2", {});
    q.clearAll();
    expect(q.getTotalMessageCount()).toBe(0);
    expect(q.getPeersWithMessages()).toEqual([]);
  });
});

describe("SignalingMessageQueue.cleanupExpired", () => {
  it("removes messages older than the TTL and drops emptied queues", () => {
    q.setMessageTTL(1000);
    q.enqueue("p1", { n: 1 });
    q.enqueue("p1", { n: 2 });
    q.enqueue("p2", { n: 3 });
    // age the first p1 message past the TTL, leave the rest fresh
    const internal = q.queues.get("p1");
    internal[0].storedAt = Date.now() - 5000;
    const res = q.cleanupExpired();
    expect(res.expiredCount).toBe(1);
    expect(q.peek("p1").map((e) => e.message.n)).toEqual([2]);
    expect(q.getStats().totalExpired).toBe(1);
  });

  it("deletes a queue whose messages all expired", () => {
    q.setMessageTTL(1000);
    q.enqueue("p1", { n: 1 });
    q.queues.get("p1")[0].storedAt = Date.now() - 5000;
    q.cleanupExpired();
    expect(q.getPeersWithMessages()).not.toContain("p1");
  });
});

describe("SignalingMessageQueue stats / ids", () => {
  it("aggregates counts and surfaces config in getStats", () => {
    q.setMaxQueueSize(50);
    q.enqueue("p1", {});
    q.enqueue("p2", {});
    const s = q.getStats();
    expect(s.currentQueues).toBe(2);
    expect(s.totalMessages).toBe(2);
    expect(s.maxQueueSize).toBe(50);
  });

  it("generates unique message ids", () => {
    const ids = new Set([
      q.generateMessageId(),
      q.generateMessageId(),
      q.generateMessageId(),
    ]);
    expect(ids.size).toBe(3);
  });
});
