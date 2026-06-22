/**
 * message-aggregator 单元测试 —— 按事件分组的批量 IPC 推送：定时 flush、
 * 满批立即 flush、窗口销毁/缺失清空、flushNow/destroy、统计、全局单例。
 *
 * 用 fake timers 驱动 batchInterval；用假 window 捕获 webContents.send。
 */

vi.mock("../logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const {
  MessageAggregator,
  getMessageAggregator,
  destroyGlobalAggregator,
} = require("../message-aggregator.js");

const makeWindow = () => {
  const sent = [];
  return {
    sent,
    destroyed: false,
    isDestroyed() {
      return this.destroyed;
    },
    webContents: {
      send: (channel, data) => sent.push({ channel, data }),
    },
  };
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  destroyGlobalAggregator();
});

describe("MessageAggregator batching", () => {
  it("groups by event type and flushes after batchInterval", () => {
    const win = makeWindow();
    const agg = new MessageAggregator({ window: win, batchInterval: 100 });
    agg.push("progress", { a: 1 });
    agg.push("progress", { a: 2 });
    agg.push("done", { ok: true });
    expect(win.sent).toHaveLength(0); // not flushed yet

    vi.advanceTimersByTime(100);
    expect(win.sent).toEqual([
      { channel: "batch:progress", data: [{ a: 1 }, { a: 2 }] },
      { channel: "batch:done", data: [{ ok: true }] },
    ]);
  });

  it("flushes immediately when the queue reaches maxBatchSize", () => {
    const win = makeWindow();
    const agg = new MessageAggregator({
      window: win,
      batchInterval: 1000,
      maxBatchSize: 2,
    });
    agg.push("e", 1);
    expect(win.sent).toHaveLength(0);
    agg.push("e", 2); // hits maxBatchSize -> immediate flush, no timer wait
    expect(win.sent).toEqual([{ channel: "batch:e", data: [1, 2] }]);
    expect(agg.getStats().queueSize).toBe(0);
    expect(agg.getStats().isActive).toBe(false);
  });

  it("empty flush is a no-op (no send, no batch counted)", () => {
    const win = makeWindow();
    const agg = new MessageAggregator({ window: win });
    agg.flush();
    expect(win.sent).toHaveLength(0);
    expect(agg.getStats().totalBatches).toBe(0);
  });

  it("a send error is caught and the queue still clears", () => {
    const win = makeWindow();
    win.webContents.send = () => {
      throw new Error("renderer gone");
    };
    const agg = new MessageAggregator({ window: win });
    agg.push("e", 1);
    expect(() => agg.flushNow()).not.toThrow();
    expect(agg.getStats().queueSize).toBe(0);
    expect(agg.getStats().totalBatches).toBe(1);
  });
});

describe("MessageAggregator window lifecycle", () => {
  it("drops the queue without sending when the window is destroyed", () => {
    const win = makeWindow();
    win.destroyed = true;
    const agg = new MessageAggregator({ window: win });
    agg.push("e", 1);
    agg.flushNow();
    expect(win.sent).toHaveLength(0);
    expect(agg.getStats().queueSize).toBe(0);
  });

  it("drops the queue when no window is set", () => {
    const agg = new MessageAggregator({});
    agg.push("e", 1);
    agg.flushNow();
    expect(agg.getStats().queueSize).toBe(0);
  });

  it("setWindow allows deferred wiring", () => {
    const agg = new MessageAggregator({});
    const win = makeWindow();
    agg.setWindow(win);
    agg.push("e", 1);
    agg.flushNow();
    expect(win.sent).toEqual([{ channel: "batch:e", data: [1] }]);
  });
});

describe("MessageAggregator stats", () => {
  it("tracks totals and computes a running average batch size", () => {
    const win = makeWindow();
    const agg = new MessageAggregator({ window: win, maxBatchSize: 10 });
    agg.push("e", 1);
    agg.push("e", 2);
    agg.flushNow(); // batch 1: 2 messages
    agg.push("e", 3);
    agg.flushNow(); // batch 2: 1 message
    const stats = agg.getStats();
    expect(stats.totalMessages).toBe(3);
    expect(stats.totalBatches).toBe(2);
    expect(stats.avgBatchSize).toBe(1.5);
  });

  it("resetStats zeroes counters", () => {
    const win = makeWindow();
    const agg = new MessageAggregator({ window: win });
    agg.push("e", 1);
    agg.flushNow();
    agg.resetStats();
    expect(agg.getStats()).toMatchObject({
      totalMessages: 0,
      totalBatches: 0,
      avgBatchSize: 0,
    });
  });
});

describe("MessageAggregator.destroy", () => {
  it("flushes remaining messages, clears the timer, and drops the window", () => {
    const win = makeWindow();
    const agg = new MessageAggregator({ window: win });
    agg.push("e", 1); // arms timer
    agg.destroy();
    expect(win.sent).toEqual([{ channel: "batch:e", data: [1] }]);
    expect(agg.window).toBeNull();
    expect(agg.getStats().isActive).toBe(false);
  });
});

describe("global aggregator singleton", () => {
  it("returns the same instance and wires a deferred window", () => {
    const a = getMessageAggregator();
    const b = getMessageAggregator();
    expect(a).toBe(b);
    const win = makeWindow();
    getMessageAggregator(win); // wires window since none was set
    expect(a.window).toBe(win);
  });

  it("destroyGlobalAggregator clears the singleton", () => {
    const a = getMessageAggregator();
    destroyGlobalAggregator();
    const b = getMessageAggregator();
    expect(b).not.toBe(a);
  });
});
