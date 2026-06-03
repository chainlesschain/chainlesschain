import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const { EventBus } = require("../event-bus");

describe("EventBus", () => {
  let bus;

  beforeEach(() => {
    bus = new EventBus();
    vi.clearAllMocks();
  });

  describe("constructor", () => {
    it("should initialize with empty channels and zero stats", () => {
      expect(bus._channels.size).toBe(0);
      expect(bus._stats).toEqual({ published: 0, delivered: 0, errors: 0 });
      expect(bus._history).toEqual([]);
    });

    it("should set max listeners to 100", () => {
      expect(bus.getMaxListeners()).toBe(100);
    });
  });

  describe("subscribe", () => {
    it("should return a subscription ID", () => {
      const id = bus.subscribe("test", vi.fn());
      expect(typeof id).toBe("string");
      expect(id).toContain("test-");
    });

    it("should store the handler in the channel", () => {
      bus.subscribe("ch", vi.fn());
      expect(bus._channels.get("ch")).toHaveLength(1);
    });

    it("should allow multiple subscribers to same channel", () => {
      bus.subscribe("ch", vi.fn());
      bus.subscribe("ch", vi.fn());
      expect(bus._channels.get("ch")).toHaveLength(2);
    });

    it("should store module name from options", () => {
      bus.subscribe("ch", vi.fn(), { module: "ai-engine" });
      const sub = bus._channels.get("ch")[0];
      expect(sub.module).toBe("ai-engine");
    });
  });

  describe("unsubscribe", () => {
    it("should remove subscription by ID", () => {
      const id = bus.subscribe("ch", vi.fn());
      const result = bus.unsubscribe(id);
      expect(result).toBe(true);
      expect(bus._channels.has("ch")).toBe(false);
    });

    it("should return false for unknown subscription ID", () => {
      expect(bus.unsubscribe("fake-id")).toBe(false);
    });

    it("should keep other subscriptions on the same channel", () => {
      const id1 = bus.subscribe("ch", vi.fn());
      bus.subscribe("ch", vi.fn());
      bus.unsubscribe(id1);
      expect(bus._channels.get("ch")).toHaveLength(1);
    });
  });

  describe("publish", () => {
    it("should call subscriber handlers with data", async () => {
      const handler = vi.fn();
      bus.subscribe("ch", handler);
      await bus.publish("ch", { msg: "hello" });
      expect(handler).toHaveBeenCalledWith(
        { msg: "hello" },
        expect.objectContaining({ channel: "ch", data: { msg: "hello" } }),
      );
    });

    it("should return the number of delivered messages", async () => {
      bus.subscribe("ch", vi.fn());
      bus.subscribe("ch", vi.fn());
      const delivered = await bus.publish("ch", "data");
      expect(delivered).toBe(2);
    });

    it("should return 0 when no subscribers", async () => {
      const delivered = await bus.publish("empty", "data");
      expect(delivered).toBe(0);
    });

    it("should increment published and delivered stats", async () => {
      bus.subscribe("ch", vi.fn());
      await bus.publish("ch", "data");
      expect(bus._stats.published).toBe(1);
      expect(bus._stats.delivered).toBe(1);
    });

    it("should add event to history", async () => {
      await bus.publish("ch", "data", { source: "test-mod" });
      expect(bus._history).toHaveLength(1);
      expect(bus._history[0].source).toBe("test-mod");
    });

    it("should limit history to _historyLimit", async () => {
      bus._historyLimit = 3;
      for (let i = 0; i < 5; i++) {
        await bus.publish("ch", i);
      }
      expect(bus._history).toHaveLength(3);
    });

    it("should handle errors in handlers gracefully", async () => {
      bus.subscribe("ch", () => {
        throw new Error("handler boom");
      });
      const handler2 = vi.fn();
      bus.subscribe("ch", handler2);
      const delivered = await bus.publish("ch", "data");
      expect(delivered).toBe(1);
      expect(bus._stats.errors).toBe(1);
      expect(handler2).toHaveBeenCalled();
    });
  });

  describe("publish with once option", () => {
    it("should remove subscription after first delivery", async () => {
      const handler = vi.fn();
      bus.subscribe("ch", handler, { once: true });
      await bus.publish("ch", "first");
      await bus.publish("ch", "second");
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe("publish with filter option", () => {
    it("should skip handler when filter returns false", async () => {
      const handler = vi.fn();
      bus.subscribe("ch", handler, { filter: (data) => data.type === "A" });
      await bus.publish("ch", { type: "B" });
      expect(handler).not.toHaveBeenCalled();
    });

    it("should call handler when filter returns true", async () => {
      const handler = vi.fn();
      bus.subscribe("ch", handler, { filter: (data) => data.type === "A" });
      await bus.publish("ch", { type: "A" });
      expect(handler).toHaveBeenCalled();
    });
  });

  describe("getChannels", () => {
    it("should return channel info with subscriber counts", () => {
      bus.subscribe("ch1", vi.fn(), { module: "mod-a" });
      bus.subscribe("ch1", vi.fn(), { module: "mod-b" });
      bus.subscribe("ch2", vi.fn(), { module: "mod-a" });
      const channels = bus.getChannels();
      expect(channels.ch1.subscribers).toBe(2);
      expect(channels.ch1.modules).toEqual(
        expect.arrayContaining(["mod-a", "mod-b"]),
      );
      expect(channels.ch2.subscribers).toBe(1);
    });
  });

  describe("getStats", () => {
    it("should include total subscriber count and channel count", () => {
      bus.subscribe("a", vi.fn());
      bus.subscribe("a", vi.fn());
      bus.subscribe("b", vi.fn());
      const stats = bus.getStats();
      expect(stats.channels).toBe(2);
      expect(stats.totalSubscribers).toBe(3);
    });

    it("should include recent events", async () => {
      await bus.publish("x", "d1");
      await bus.publish("y", "d2");
      const stats = bus.getStats();
      expect(stats.recentEvents).toHaveLength(2);
      expect(stats.recentEvents[0].channel).toBe("x");
    });
  });

  describe("clear", () => {
    it("should reset all state", async () => {
      bus.subscribe("ch", vi.fn());
      await bus.publish("ch", "data");
      bus.clear();
      expect(bus._channels.size).toBe(0);
      expect(bus._history).toEqual([]);
      expect(bus._stats.published).toBe(0);
    });
  });
});
