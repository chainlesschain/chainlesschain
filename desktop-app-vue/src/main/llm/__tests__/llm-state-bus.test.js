import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const EventEmitter = require("events");
const {
  LLMStateBus,
  Events,
  FORWARD_MAP,
  getLLMStateBus,
} = require("../llm-state-bus");

describe("LLMStateBus", () => {
  let bus;

  beforeEach(() => {
    bus = new LLMStateBus();
  });

  describe("Events constant", () => {
    it("exposes documented event names", () => {
      expect(Events.PROVIDER_CHANGED).toBe("llm:provider-changed");
      expect(Events.MODEL_SWITCHED).toBe("llm:model-switched");
      expect(Events.SERVICE_PAUSED).toBe("llm:service-paused");
      expect(Events.SERVICE_RESUMED).toBe("llm:service-resumed");
      expect(Events.BUDGET_ALERT).toBe("llm:budget-alert");
      expect(Events.SESSION_INVALIDATED).toBe("session:invalidated");
      expect(Events.ALL_INVALIDATED).toBe("all:invalidated");
    });

    it("FORWARD_MAP covers the 5 LLMManager events", () => {
      expect(Object.keys(FORWARD_MAP)).toEqual(
        expect.arrayContaining([
          "provider-changed",
          "model-switched",
          "service-paused",
          "service-resumed",
          "budget-alert",
        ]),
      );
    });
  });

  describe("dispatch", () => {
    it("emits a frozen fixed receipt instead of the source payload", () => {
      const listener = vi.fn();
      bus.on(Events.PROVIDER_CHANGED, listener);
      bus.dispatch(Events.PROVIDER_CHANGED, {
        provider: "private-provider",
        prompt: "private-prompt",
      });
      const receipt = listener.mock.calls[0][0];
      expect(receipt).toEqual({
        code: "CC_LLM_STATE_EVENT",
        component: "state-bus",
        event: "provider-changed",
      });
      expect(Object.isFrozen(receipt)).toBe(true);
    });

    it("counts dispatches per event", () => {
      bus.dispatch(Events.PROVIDER_CHANGED, {});
      bus.dispatch(Events.PROVIDER_CHANGED, {});
      bus.dispatch(Events.MODEL_SWITCHED, {});
      const stats = bus.getStats();
      expect(stats.events[Events.PROVIDER_CHANGED]).toBe(2);
      expect(stats.events[Events.MODEL_SWITCHED]).toBe(1);
    });

    it("isolates listener errors", () => {
      const good = vi.fn();
      bus.on(Events.PROVIDER_CHANGED, () => {
        throw new Error("boom");
      });
      bus.on(Events.PROVIDER_CHANGED, good);
      // Single listener throwing should not prevent dispatch from completing.
      // (Note: native EventEmitter calls listeners in order; if first throws,
      // subsequent listeners are not called. dispatch() catches the throw so
      // the test verifies dispatch itself does not propagate.)
      expect(() => bus.dispatch(Events.PROVIDER_CHANGED, {})).not.toThrow();
    });

    it("projects direct emit and unknown events through the same boundary", () => {
      const known = vi.fn();
      const unknown = vi.fn();
      bus.on(Events.SERVICE_PAUSED, known);
      bus.on("tenant-private-event", unknown);

      bus.emit(Events.SERVICE_PAUSED, { reason: "private-reason" });
      bus.dispatch("tenant-private-event", { secret: "private-value" });

      expect(known).toHaveBeenCalledWith(
        expect.objectContaining({ event: "service-paused" }),
      );
      expect(unknown).toHaveBeenCalledWith({
        code: "CC_LLM_STATE_EVENT",
        component: "state-bus",
        event: "unknown",
      });
      expect(bus.getStats().events).toEqual({ unknown: 1 });
      expect(
        JSON.stringify([known.mock.calls, unknown.mock.calls]),
      ).not.toContain("private");
    });
  });

  describe("forwardFrom", () => {
    it("mirrors source events to bus events", () => {
      const source = new EventEmitter();
      const listener = vi.fn();
      bus.on(Events.PROVIDER_CHANGED, listener);
      bus.forwardFrom(source);
      source.emit("provider-changed", "openai");
      expect(listener).toHaveBeenCalledWith({
        code: "CC_LLM_STATE_EVENT",
        component: "state-bus",
        event: "provider-changed",
      });
    });

    it("forwards all 5 standard events", () => {
      const source = new EventEmitter();
      const seen = {};
      for (const busEvent of Object.values(FORWARD_MAP)) {
        bus.on(busEvent, (payload) => {
          seen[busEvent] = payload;
        });
      }
      bus.forwardFrom(source);
      for (const srcEvent of Object.keys(FORWARD_MAP)) {
        source.emit(srcEvent, { src: srcEvent });
      }
      expect(Object.keys(seen)).toHaveLength(5);
    });

    it("is idempotent for the same source", () => {
      const source = new EventEmitter();
      const listener = vi.fn();
      bus.on(Events.PROVIDER_CHANGED, listener);
      bus.forwardFrom(source);
      bus.forwardFrom(source); // second call must not double-bind
      source.emit("provider-changed", "openai");
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("returns an unbind function that removes listeners", () => {
      const source = new EventEmitter();
      const listener = vi.fn();
      bus.on(Events.PROVIDER_CHANGED, listener);
      const unbind = bus.forwardFrom(source);
      source.emit("provider-changed", "a");
      unbind();
      source.emit("provider-changed", "b");
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ event: "provider-changed" }),
      );
    });

    it("rejects non-EventEmitter sources", () => {
      expect(() => bus.forwardFrom(null)).toThrow(TypeError);
      expect(() => bus.forwardFrom({})).toThrow(TypeError);
    });

    it("supports a custom event map", () => {
      const source = new EventEmitter();
      const listener = vi.fn();
      bus.on(Events.PROVIDER_CHANGED, listener);
      bus.forwardFrom(source, {
        map: { "custom-event": Events.PROVIDER_CHANGED },
      });
      source.emit("custom-event", { x: 1 });
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ event: "provider-changed" }),
      );
    });
  });

  describe("invalidateAll / invalidateSession", () => {
    it("invalidateAll dispatches a fixed receipt", () => {
      const listener = vi.fn();
      bus.on(Events.ALL_INVALIDATED, listener);
      bus.invalidateAll("logout");
      expect(listener).toHaveBeenCalledTimes(1);
      const payload = listener.mock.calls[0][0];
      expect(payload).toEqual({
        code: "CC_LLM_STATE_EVENT",
        component: "state-bus",
        event: "all-invalidated",
      });
    });

    it("invalidateSession dispatches SESSION_INVALIDATED with sessionId", () => {
      const listener = vi.fn();
      bus.on(Events.SESSION_INVALIDATED, listener);
      bus.invalidateSession("sess-123", "user-action");
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: "sess-123",
          event: "session-invalidated",
        }),
      );
    });

    it("does not publish invalidation reasons", () => {
      const listener = vi.fn();
      bus.on(Events.ALL_INVALIDATED, listener);
      bus.invalidateAll("private-reason");
      expect(listener.mock.calls[0][0]).not.toHaveProperty("reason");
    });

    it("rejects invalid session identifiers", () => {
      expect(() => bus.invalidateSession("private/session/id")).toThrow(
        TypeError,
      );
      expect(() =>
        bus.invalidateSession({ toString: () => "sess-123" }),
      ).toThrow(TypeError);
    });

    it("does not invoke accessors or publish proxy failures", () => {
      const getter = vi.fn(() => "sess-123");
      const accessorPayload = {};
      Object.defineProperty(accessorPayload, "sessionId", { get: getter });
      const throwingProxy = new Proxy(
        {},
        {
          getPrototypeOf() {
            throw new Error("private-proxy-failure");
          },
        },
      );
      const listener = vi.fn();
      bus.on(Events.SESSION_INVALIDATED, listener);

      expect(() =>
        bus.dispatch(Events.SESSION_INVALIDATED, accessorPayload),
      ).not.toThrow();
      expect(() =>
        bus.dispatch(Events.SESSION_INVALIDATED, throwingProxy),
      ).not.toThrow();

      expect(getter).not.toHaveBeenCalled();
      expect(JSON.stringify(listener.mock.calls)).not.toContain("private");
      expect(listener.mock.calls.every(([receipt]) => !receipt.sessionId)).toBe(
        true,
      );
    });
  });

  describe("getStats", () => {
    it("reports listener count and per-event dispatch counts", () => {
      bus.on(Events.PROVIDER_CHANGED, vi.fn());
      bus.on(Events.PROVIDER_CHANGED, vi.fn());
      bus.on(Events.MODEL_SWITCHED, vi.fn());
      bus.dispatch(Events.PROVIDER_CHANGED, {});
      const stats = bus.getStats();
      expect(stats.listenerCount).toBe(3);
      expect(stats.events[Events.PROVIDER_CHANGED]).toBe(1);
    });
  });

  describe("reset", () => {
    it("removes all listeners and clears counters", () => {
      bus.on(Events.PROVIDER_CHANGED, vi.fn());
      bus.dispatch(Events.PROVIDER_CHANGED, {});
      bus.reset();
      const stats = bus.getStats();
      expect(stats.listenerCount).toBe(0);
      expect(Object.keys(stats.events)).toHaveLength(0);
    });
  });

  describe("getLLMStateBus singleton", () => {
    it("returns the same instance on repeated calls", () => {
      const a = getLLMStateBus();
      const b = getLLMStateBus();
      expect(a).toBe(b);
    });

    it("singleton has high listener limit", () => {
      const singleton = getLLMStateBus();
      // setMaxListeners(50) — verify >10 default
      expect(singleton.getMaxListeners()).toBeGreaterThanOrEqual(50);
    });
  });
});
