import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const { LazyPhaseLoader } = require("../lazy-phase-loader");

describe("LazyPhaseLoader", () => {
  let loader;

  beforeEach(() => {
    loader = new LazyPhaseLoader();
    vi.clearAllMocks();
  });

  describe("constructor", () => {
    it("should initialize with empty state", () => {
      expect(loader._phases.size).toBe(0);
      expect(loader._loaded.size).toBe(0);
      expect(loader._loading.size).toBe(0);
    });

    it("should initialize with empty deps", () => {
      expect(loader._deps).toEqual({});
    });
  });

  describe("setDependencies", () => {
    it("should store dependencies", () => {
      const deps = { db: "mockDB", app: "mockApp" };
      loader.setDependencies(deps);
      expect(loader._deps).toBe(deps);
    });
  });

  describe("registerPhase", () => {
    it("should register a phase with its loader", () => {
      const fn = vi.fn();
      loader.registerPhase("ai.cowork", fn);
      expect(loader._phases.has("ai.cowork")).toBe(true);
    });

    it("should store the loader function and registration time", () => {
      const fn = vi.fn();
      loader.registerPhase("core.config", fn);
      const phase = loader._phases.get("core.config");
      expect(phase.loader).toBe(fn);
      expect(typeof phase.registered).toBe("number");
    });

    it("should overwrite phase if registered again", () => {
      const fn1 = vi.fn();
      const fn2 = vi.fn();
      loader.registerPhase("core.db", fn1);
      loader.registerPhase("core.db", fn2);
      expect(loader._phases.get("core.db").loader).toBe(fn2);
    });
  });

  describe("loadPhase", () => {
    it("should call the loader function with deps", async () => {
      const fn = vi.fn().mockResolvedValue(undefined);
      const deps = { db: "testDB" };
      loader.setDependencies(deps);
      loader.registerPhase("ai.plan", fn);
      await loader.loadPhase("ai.plan");
      expect(fn).toHaveBeenCalledWith(deps);
    });

    it("should return true on successful load", async () => {
      loader.registerPhase("core.x", vi.fn().mockResolvedValue(undefined));
      const result = await loader.loadPhase("core.x");
      expect(result).toBe(true);
    });

    it("should mark phase as loaded", async () => {
      loader.registerPhase("core.x", vi.fn().mockResolvedValue(undefined));
      await loader.loadPhase("core.x");
      expect(loader.isLoaded("core.x")).toBe(true);
    });

    it("should return true immediately if already loaded", async () => {
      const fn = vi.fn().mockResolvedValue(undefined);
      loader.registerPhase("core.x", fn);
      await loader.loadPhase("core.x");
      const result = await loader.loadPhase("core.x");
      expect(result).toBe(true);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("should return false for unknown phase", async () => {
      const result = await loader.loadPhase("nonexistent");
      expect(result).toBe(false);
    });

    it("should return false and emit error event on loader failure", async () => {
      const fn = vi.fn().mockRejectedValue(new Error("load fail"));
      loader.registerPhase("broken", fn);
      const errorSpy = vi.fn();
      loader.on("phase:error", errorSpy);
      const result = await loader.loadPhase("broken");
      expect(result).toBe(false);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.objectContaining({ phaseId: "broken", error: "load fail" }),
      );
    });

    it("should emit phase:loaded event on success", async () => {
      loader.registerPhase("core.ok", vi.fn().mockResolvedValue(undefined));
      const spy = vi.fn();
      loader.on("phase:loaded", spy);
      await loader.loadPhase("core.ok");
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({ phaseId: "core.ok" }),
      );
    });

    it("should deduplicate concurrent loads of the same phase", async () => {
      let resolveLoader;
      const fn = vi.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveLoader = resolve;
          }),
      );
      loader.registerPhase("slow", fn);
      const p1 = loader.loadPhase("slow");
      const p2 = loader.loadPhase("slow");
      resolveLoader();
      const [r1, r2] = await Promise.all([p1, p2]);
      expect(r1).toBe(true);
      expect(r2).toBe(true);
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });

  describe("isLoaded", () => {
    it("should return false for unregistered phase", () => {
      expect(loader.isLoaded("nope")).toBe(false);
    });

    it("should return false for registered but not loaded phase", () => {
      loader.registerPhase("pending", vi.fn());
      expect(loader.isLoaded("pending")).toBe(false);
    });
  });

  describe("getStats", () => {
    it("should return empty stats initially", () => {
      const stats = loader.getStats();
      expect(stats.totalPhases).toBe(0);
      expect(stats.loadedPhases).toBe(0);
      expect(stats.loadingPhases).toBe(0);
      expect(stats.phases).toEqual([]);
    });

    it("should reflect registered and loaded phases", async () => {
      loader.registerPhase("a", vi.fn().mockResolvedValue(undefined));
      loader.registerPhase("b", vi.fn().mockResolvedValue(undefined));
      await loader.loadPhase("a");
      const stats = loader.getStats();
      expect(stats.totalPhases).toBe(2);
      expect(stats.loadedPhases).toBe(1);
      expect(stats.phases).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "a", loaded: true }),
          expect.objectContaining({ id: "b", loaded: false }),
        ]),
      );
    });
  });

  describe("preloadDomain", () => {
    it("should load all phases matching domain prefix", async () => {
      const fn1 = vi.fn().mockResolvedValue(undefined);
      const fn2 = vi.fn().mockResolvedValue(undefined);
      const fn3 = vi.fn().mockResolvedValue(undefined);
      loader.registerPhase("ai.cowork", fn1);
      loader.registerPhase("ai.plan", fn2);
      loader.registerPhase("core.config", fn3);
      const results = await loader.preloadDomain("ai");
      expect(results).toHaveLength(2);
      expect(results.every((r) => r.success)).toBe(true);
      expect(fn3).not.toHaveBeenCalled();
    });

    it("should return empty array when no phases match", async () => {
      loader.registerPhase("core.x", vi.fn());
      const results = await loader.preloadDomain("ai");
      expect(results).toEqual([]);
    });

    it("should report failure for individual phases", async () => {
      loader.registerPhase(
        "db.migrate",
        vi.fn().mockRejectedValue(new Error("fail")),
      );
      loader.registerPhase("db.seed", vi.fn().mockResolvedValue(undefined));
      const results = await loader.preloadDomain("db");
      const failResult = results.find((r) => r.phaseId === "db.migrate");
      const okResult = results.find((r) => r.phaseId === "db.seed");
      expect(failResult.success).toBe(false);
      expect(okResult.success).toBe(true);
    });
  });
});
