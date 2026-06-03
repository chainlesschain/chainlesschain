import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const { ServiceContainer } = require("../service-container");

describe("ServiceContainer", () => {
  let container;

  beforeEach(() => {
    container = new ServiceContainer();
    vi.clearAllMocks();
  });

  describe("constructor", () => {
    it("should initialize with empty state", () => {
      expect(container._services.size).toBe(0);
      expect(container._instances.size).toBe(0);
      expect(container._initializing.size).toBe(0);
      expect(container._initialized).toBe(false);
    });
  });

  describe("register", () => {
    it("should register a service factory", () => {
      container.register("db", () => ({ query: vi.fn() }));
      expect(container.has("db")).toBe(true);
    });

    it("should store metadata (singleton, lazy, tags, dependencies)", () => {
      container.register("svc", () => "val", {
        singleton: true,
        lazy: false,
        tags: ["core"],
        dependencies: ["db"],
      });
      const def = container._services.get("svc");
      expect(def.singleton).toBe(true);
      expect(def.lazy).toBe(false);
      expect(def.tags).toEqual(["core"]);
      expect(def.dependencies).toEqual(["db"]);
    });

    it("should default singleton=true and lazy=true", () => {
      container.register("svc", () => "val");
      const def = container._services.get("svc");
      expect(def.singleton).toBe(true);
      expect(def.lazy).toBe(true);
    });

    it("should emit service:registered event", () => {
      const spy = vi.fn();
      container.on("service:registered", spy);
      container.register("svc", () => "val");
      expect(spy).toHaveBeenCalledWith({ name: "svc" });
    });

    it("should allow overwriting an existing service", async () => {
      container.register("dup", () => "a");
      container.register("dup", () => "b");
      const result = await container.resolve("dup");
      expect(result).toBe("b");
    });
  });

  describe("resolve", () => {
    it("should create and return an instance from factory", async () => {
      container.register("svc", () => ({ name: "test" }));
      const instance = await container.resolve("svc");
      expect(instance).toEqual({ name: "test" });
    });

    it("should cache singleton instances", async () => {
      let callCount = 0;
      container.register("svc", () => ({ id: ++callCount }));
      const a = await container.resolve("svc");
      const b = await container.resolve("svc");
      expect(a).toBe(b);
      expect(callCount).toBe(1);
    });

    it("should resolve dependencies before creating instance", async () => {
      container.register("db", () => ({ type: "db" }));
      container.register("repo", (deps) => ({ db: deps.db }), {
        dependencies: ["db"],
      });
      const repo = await container.resolve("repo");
      expect(repo.db).toEqual({ type: "db" });
    });

    it("should throw for unregistered service", async () => {
      await expect(container.resolve("missing")).rejects.toThrow(
        "Service 'missing' not registered",
      );
    });

    it("should detect circular dependencies", async () => {
      container.register("a", () => "a", { dependencies: ["b"] });
      container.register("b", () => "b", { dependencies: ["a"] });
      await expect(container.resolve("a")).rejects.toThrow(
        "Circular dependency",
      );
    });

    it("should emit service:resolved event", async () => {
      const spy = vi.fn();
      container.on("service:resolved", spy);
      container.register("svc", () => "val");
      await container.resolve("svc");
      expect(spy).toHaveBeenCalledWith({ name: "svc" });
    });

    it("should handle non-function factory (plain value)", async () => {
      container.register("config", { port: 3000 });
      const val = await container.resolve("config");
      expect(val).toEqual({ port: 3000 });
    });
  });

  describe("has / isResolved", () => {
    it("has should return false for unregistered service", () => {
      expect(container.has("nope")).toBe(false);
    });

    it("isResolved should return false before resolve", () => {
      container.register("svc", () => "val");
      expect(container.isResolved("svc")).toBe(false);
    });

    it("isResolved should return true after resolve", async () => {
      container.register("svc", () => "val");
      await container.resolve("svc");
      expect(container.isResolved("svc")).toBe(true);
    });
  });

  describe("getByTag", () => {
    it("should return service names matching the tag", () => {
      container.register("a", () => 1, { tags: ["core"] });
      container.register("b", () => 2, { tags: ["core", "db"] });
      container.register("c", () => 3, { tags: ["ui"] });
      expect(container.getByTag("core")).toEqual(["a", "b"]);
    });

    it("should return empty array when no match", () => {
      container.register("a", () => 1, { tags: ["x"] });
      expect(container.getByTag("y")).toEqual([]);
    });
  });

  describe("disposeAll", () => {
    it("should call dispose on instances that have it", async () => {
      const disposeSpy = vi.fn();
      container.register("svc", () => ({ dispose: disposeSpy }));
      await container.resolve("svc");
      await container.disposeAll();
      expect(disposeSpy).toHaveBeenCalled();
      expect(container._instances.size).toBe(0);
    });

    it("should call destroy if dispose is not available", async () => {
      const destroySpy = vi.fn();
      container.register("svc", () => ({ destroy: destroySpy }));
      await container.resolve("svc");
      await container.disposeAll();
      expect(destroySpy).toHaveBeenCalled();
    });

    it("should handle errors during dispose gracefully", async () => {
      container.register("svc", () => ({
        dispose: () => {
          throw new Error("dispose fail");
        },
      }));
      await container.resolve("svc");
      await expect(container.disposeAll()).resolves.not.toThrow();
    });

    it("should emit container:disposed event", async () => {
      const spy = vi.fn();
      container.on("container:disposed", spy);
      await container.disposeAll();
      expect(spy).toHaveBeenCalled();
    });
  });

  describe("getHealth", () => {
    it("should return health info for all registered services", async () => {
      container.register("a", () => 1, { tags: ["core"], dependencies: ["b"] });
      container.register("b", () => 2);
      await container.resolve("b");
      const health = container.getHealth();
      expect(health.a.registered).toBe(true);
      expect(health.a.resolved).toBe(false);
      expect(health.b.resolved).toBe(true);
    });
  });

  describe("getStats", () => {
    it("should return correct counts", async () => {
      container.register("a", () => 1);
      container.register("b", () => 2);
      await container.resolve("a");
      const stats = container.getStats();
      expect(stats.totalServices).toBe(2);
      expect(stats.resolvedServices).toBe(1);
      expect(stats.initializingServices).toBe(0);
    });
  });
});
