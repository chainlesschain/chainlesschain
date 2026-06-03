import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  ServiceContainer,
  createServiceContainer,
} from "../../src/lib/service-container.js";

describe("service-container", () => {
  let container;

  beforeEach(() => {
    container = new ServiceContainer();
  });

  // ─── register ────────────────────────────────────────

  describe("register", () => {
    it("registers a service", () => {
      container.register("db", () => ({ query: vi.fn() }));
      expect(container.has("db")).toBe(true);
    });

    it("throws on missing name", () => {
      expect(() => container.register("", () => ({}))).toThrow();
    });

    it("throws on non-function factory", () => {
      expect(() => container.register("db", "not-a-fn")).toThrow();
    });

    it("accepts options", () => {
      container.register("svc", () => ({}), {
        singleton: false,
        lazy: false,
        dependencies: ["db"],
        tags: ["core"],
      });
      expect(container.has("svc")).toBe(true);
    });
  });

  // ─── resolve ─────────────────────────────────────────

  describe("resolve", () => {
    it("resolves a registered service", async () => {
      container.register("logger", () => ({ log: vi.fn() }));
      const instance = await container.resolve("logger");
      expect(instance).toHaveProperty("log");
    });

    it("throws for unregistered service", async () => {
      await expect(container.resolve("missing")).rejects.toThrow(
        'Service "missing" is not registered',
      );
    });

    it("supports async factories", async () => {
      container.register("async-svc", async () => {
        return { ready: true };
      });
      const instance = await container.resolve("async-svc");
      expect(instance.ready).toBe(true);
    });

    it("passes container to factory for dependency injection", async () => {
      container.register("config", () => ({ port: 3000 }));
      container.register("server", async (c) => {
        const cfg = await c.resolve("config");
        return { port: cfg.port, running: true };
      });
      const server = await container.resolve("server");
      expect(server.port).toBe(3000);
      expect(server.running).toBe(true);
    });
  });

  // ─── singleton behavior ──────────────────────────────

  describe("singleton", () => {
    it("returns same instance for singleton", async () => {
      let calls = 0;
      container.register("counter", () => ({ id: ++calls }), {
        singleton: true,
      });
      const a = await container.resolve("counter");
      const b = await container.resolve("counter");
      expect(a).toBe(b);
      expect(calls).toBe(1);
    });

    it("returns new instance for transient", async () => {
      let calls = 0;
      container.register("counter", () => ({ id: ++calls }), {
        singleton: false,
      });
      const a = await container.resolve("counter");
      const b = await container.resolve("counter");
      expect(a).not.toBe(b);
      expect(calls).toBe(2);
    });

    it("defaults to singleton", async () => {
      let calls = 0;
      container.register("svc", () => ({ id: ++calls }));
      await container.resolve("svc");
      await container.resolve("svc");
      expect(calls).toBe(1);
    });
  });

  // ─── circular dependency ─────────────────────────────

  describe("circular dependency detection", () => {
    it("detects direct circular dependency", async () => {
      container.register("a", async (c) => c.resolve("a"));
      await expect(container.resolve("a")).rejects.toThrow(
        "Circular dependency",
      );
    });

    it("detects indirect circular dependency", async () => {
      container.register("x", async (c) => c.resolve("y"));
      container.register("y", async (c) => c.resolve("x"));
      await expect(container.resolve("x")).rejects.toThrow(
        "Circular dependency",
      );
    });
  });

  // ─── has / isResolved ────────────────────────────────

  describe("has / isResolved", () => {
    it("has returns false for unregistered", () => {
      expect(container.has("nope")).toBe(false);
    });

    it("isResolved returns false before resolve", () => {
      container.register("svc", () => ({}));
      expect(container.isResolved("svc")).toBe(false);
    });

    it("isResolved returns true after resolve", async () => {
      container.register("svc", () => ({}));
      await container.resolve("svc");
      expect(container.isResolved("svc")).toBe(true);
    });
  });

  // ─── getByTag ────────────────────────────────────────

  describe("getByTag", () => {
    it("finds services by tag", () => {
      container.register("db", () => ({}), { tags: ["core", "storage"] });
      container.register("cache", () => ({}), { tags: ["core"] });
      container.register("ui", () => ({}), { tags: ["frontend"] });

      expect(container.getByTag("core")).toEqual(["db", "cache"]);
      expect(container.getByTag("storage")).toEqual(["db"]);
      expect(container.getByTag("frontend")).toEqual(["ui"]);
    });

    it("returns empty array for unknown tag", () => {
      expect(container.getByTag("xyz")).toEqual([]);
    });
  });

  // ─── disposeAll ──────────────────────────────────────

  describe("disposeAll", () => {
    it("calls dispose() on instances", async () => {
      const disposeFn = vi.fn();
      container.register("svc", () => ({ dispose: disposeFn }));
      await container.resolve("svc");
      await container.disposeAll();
      expect(disposeFn).toHaveBeenCalledOnce();
    });

    it("calls destroy() when no dispose()", async () => {
      const destroyFn = vi.fn();
      container.register("svc", () => ({ destroy: destroyFn }));
      await container.resolve("svc");
      await container.disposeAll();
      expect(destroyFn).toHaveBeenCalledOnce();
    });

    it("clears instances after disposal", async () => {
      container.register("svc", () => ({}));
      await container.resolve("svc");
      expect(container.isResolved("svc")).toBe(true);
      await container.disposeAll();
      expect(container.isResolved("svc")).toBe(false);
    });

    it("does not throw on disposal errors", async () => {
      container.register("bad", () => ({
        dispose: () => {
          throw new Error("boom");
        },
      }));
      await container.resolve("bad");
      await expect(container.disposeAll()).resolves.not.toThrow();
    });
  });

  // ─── getHealth ───────────────────────────────────────

  describe("getHealth", () => {
    it("returns health info for all services", async () => {
      container.register("db", () => ({}), {
        tags: ["core"],
        dependencies: [],
      });
      container.register("cache", () => ({}), {
        tags: ["core"],
        dependencies: ["db"],
      });
      await container.resolve("db");

      const health = container.getHealth();
      expect(health.db.registered).toBe(true);
      expect(health.db.resolved).toBe(true);
      expect(health.cache.registered).toBe(true);
      expect(health.cache.resolved).toBe(false);
      expect(health.cache.dependencies).toEqual(["db"]);
    });
  });

  // ─── getStats ────────────────────────────────────────

  describe("getStats", () => {
    it("returns correct counts", async () => {
      container.register("a", () => ({}));
      container.register("b", () => ({}));
      await container.resolve("a");

      const stats = container.getStats();
      expect(stats.totalServices).toBe(2);
      expect(stats.resolvedServices).toBe(1);
      expect(stats.initializingServices).toBe(0);
    });
  });

  // ─── createServiceContainer factory ──────────────────

  describe("createServiceContainer", () => {
    it("returns a ServiceContainer instance", () => {
      const c = createServiceContainer();
      expect(c).toBeInstanceOf(ServiceContainer);
    });

    it("creates independent containers", () => {
      const c1 = createServiceContainer();
      const c2 = createServiceContainer();
      c1.register("only-in-c1", () => ({}));
      expect(c1.has("only-in-c1")).toBe(true);
      expect(c2.has("only-in-c1")).toBe(false);
    });
  });
});
