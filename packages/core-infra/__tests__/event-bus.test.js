import { describe, it, expect, beforeEach } from "vitest";

const { EventBus } = require("../lib/event-bus.js");

describe("EventBus", () => {
  let bus;

  beforeEach(() => {
    bus = new EventBus();
  });

  describe("subscribe and publish", () => {
    it("delivers messages to subscribers", async () => {
      let received = null;
      bus.subscribe("test", (data) => {
        received = data;
      });
      await bus.publish("test", { msg: "hello" });
      expect(received).toEqual({ msg: "hello" });
    });

    it("returns number of delivered messages", async () => {
      bus.subscribe("ch", () => {});
      bus.subscribe("ch", () => {});
      const count = await bus.publish("ch", {});
      expect(count).toBe(2);
    });

    it("returns 0 for no subscribers", async () => {
      const count = await bus.publish("empty", {});
      expect(count).toBe(0);
    });
  });

  describe("unsubscribe", () => {
    it("removes subscriber", async () => {
      let count = 0;
      const id = bus.subscribe("ch", () => {
        count++;
      });
      await bus.publish("ch", {});
      expect(count).toBe(1);

      bus.unsubscribe(id);
      await bus.publish("ch", {});
      expect(count).toBe(1); // Not incremented
    });

    it("returns false for unknown ID", () => {
      expect(bus.unsubscribe("unknown-id")).toBe(false);
    });
  });

  describe("once subscriptions", () => {
    it("fires handler only once", async () => {
      let count = 0;
      bus.subscribe(
        "ch",
        () => {
          count++;
        },
        { once: true },
      );
      await bus.publish("ch", {});
      await bus.publish("ch", {});
      expect(count).toBe(1);
    });
  });

  describe("filter", () => {
    it("only delivers to handlers matching filter", async () => {
      let received = [];
      bus.subscribe(
        "ch",
        (data) => {
          received.push(data);
        },
        { filter: (data) => data.type === "important" },
      );
      await bus.publish("ch", { type: "normal" });
      await bus.publish("ch", { type: "important" });
      expect(received).toHaveLength(1);
      expect(received[0].type).toBe("important");
    });
  });

  describe("stats", () => {
    it("tracks publish and delivery counts", async () => {
      bus.subscribe("ch", () => {});
      await bus.publish("ch", {});
      await bus.publish("ch", {});

      const stats = bus.getStats();
      expect(stats.published).toBe(2);
      expect(stats.delivered).toBe(2);
      expect(stats.errors).toBe(0);
    });

    it("tracks errors", async () => {
      bus.subscribe("ch", () => {
        throw new Error("fail");
      });
      await bus.publish("ch", {});

      const stats = bus.getStats();
      expect(stats.errors).toBe(1);
    });
  });

  describe("channels", () => {
    it("lists active channels", () => {
      bus.subscribe("a", () => {}, { module: "mod1" });
      bus.subscribe("b", () => {}, { module: "mod2" });
      bus.subscribe("b", () => {}, { module: "mod3" });

      const channels = bus.getChannels();
      expect(channels.a.subscribers).toBe(1);
      expect(channels.b.subscribers).toBe(2);
    });
  });

  describe("clear", () => {
    it("removes all subscriptions and resets stats", async () => {
      bus.subscribe("ch", () => {});
      await bus.publish("ch", {});
      bus.clear();

      const stats = bus.getStats();
      expect(stats.published).toBe(0);
      expect(stats.channels).toBe(0);
    });
  });

  describe("history", () => {
    it("keeps recent events in history", async () => {
      await bus.publish("ch1", { a: 1 });
      await bus.publish("ch2", { b: 2 });

      const stats = bus.getStats();
      expect(stats.recentEvents).toHaveLength(2);
      expect(stats.recentEvents[0].channel).toBe("ch1");
    });
  });
});
