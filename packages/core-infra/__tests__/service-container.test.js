import { describe, it, expect, beforeEach } from "vitest";

const { ServiceContainer } = require("../lib/service-container.js");

describe("ServiceContainer", () => {
  let container;

  beforeEach(() => {
    container = new ServiceContainer();
  });

  describe("register and resolve", () => {
    it("registers and resolves a service", async () => {
      container.register("db", () => ({ query: () => "result" }));
      const db = await container.resolve("db");
      expect(db.query()).toBe("result");
    });

    it("returns singleton by default", async () => {
      container.register("svc", () => ({ id: Math.random() }));
      const a = await container.resolve("svc");
      const b = await container.resolve("svc");
      expect(a).toBe(b);
    });

    it("creates new instance when singleton=false", async () => {
      let counter = 0;
      container.register("svc", () => ({ id: ++counter }), {
        singleton: false,
      });
      const a = await container.resolve("svc");
      const b = await container.resolve("svc");
      // First call creates instance; second call creates new (since not cached)
      // Actually singleton:false means it won't be cached, so resolve creates new each time
      expect(a.id).toBe(1);
      expect(b.id).toBe(2);
    });

    it("throws for unregistered service", async () => {
      await expect(container.resolve("missing")).rejects.toThrow(
        "Service 'missing' not registered",
      );
    });

    it("detects circular dependencies", async () => {
      container.register("a", async (deps) => deps, {
        dependencies: ["b"],
      });
      container.register("b", async (deps) => deps, {
        dependencies: ["a"],
      });
      await expect(container.resolve("a")).rejects.toThrow(
        "Circular dependency",
      );
    });
  });

  describe("dependency injection", () => {
    it("resolves dependencies before creating service", async () => {
      container.register("config", () => ({ port: 3000 }));
      container.register(
        "server",
        (deps) => ({
          port: deps.config.port,
          start: () => "started",
        }),
        { dependencies: ["config"] },
      );

      const server = await container.resolve("server");
      expect(server.port).toBe(3000);
    });
  });

  describe("has and isResolved", () => {
    it("has returns true for registered services", () => {
      container.register("svc", () => ({}));
      expect(container.has("svc")).toBe(true);
      expect(container.has("missing")).toBe(false);
    });

    it("isResolved returns true after resolving", async () => {
      container.register("svc", () => ({}));
      expect(container.isResolved("svc")).toBe(false);
      await container.resolve("svc");
      expect(container.isResolved("svc")).toBe(true);
    });
  });

  describe("tags", () => {
    it("finds services by tag", () => {
      container.register("db", () => ({}), { tags: ["storage"] });
      container.register("cache", () => ({}), { tags: ["storage"] });
      container.register("api", () => ({}), { tags: ["network"] });

      const storageServices = container.getByTag("storage");
      expect(storageServices).toEqual(["db", "cache"]);
    });
  });

  describe("disposeAll", () => {
    it("calls dispose on all resolved services", async () => {
      let disposed = false;
      container.register("svc", () => ({
        dispose: () => {
          disposed = true;
        },
      }));
      await container.resolve("svc");
      await container.disposeAll();
      expect(disposed).toBe(true);
    });

    it("calls destroy if dispose not available", async () => {
      let destroyed = false;
      container.register("svc", () => ({
        destroy: () => {
          destroyed = true;
        },
      }));
      await container.resolve("svc");
      await container.disposeAll();
      expect(destroyed).toBe(true);
    });
  });

  describe("getStats", () => {
    it("returns correct counts", async () => {
      container.register("a", () => ({}));
      container.register("b", () => ({}));
      await container.resolve("a");

      const stats = container.getStats();
      expect(stats.totalServices).toBe(2);
      expect(stats.resolvedServices).toBe(1);
    });
  });

  describe("events", () => {
    it("emits service:registered event", () => {
      let emitted = false;
      container.on("service:registered", () => {
        emitted = true;
      });
      container.register("svc", () => ({}));
      expect(emitted).toBe(true);
    });

    it("emits service:resolved event", async () => {
      let emitted = false;
      container.on("service:resolved", () => {
        emitted = true;
      });
      container.register("svc", () => ({}));
      await container.resolve("svc");
      expect(emitted).toBe(true);
    });
  });
});
