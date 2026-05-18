import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Unit tests for runtime/bootstrap.js
 *
 * Tests the 7-stage headless initialization, context management, and shutdown.
 * Mocks the core packages to avoid needing real dependencies.
 */
describe("bootstrap", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("exports bootstrap, getContext, and shutdown functions", async () => {
    const mod = await import("../../src/runtime/bootstrap.js");
    expect(typeof mod.bootstrap).toBe("function");
    expect(typeof mod.getContext).toBe("function");
    expect(typeof mod.shutdown).toBe("function");
  });

  it("getContext returns null before bootstrap", async () => {
    const { getContext } = await import("../../src/runtime/bootstrap.js");
    expect(getContext()).toBeNull();
  });

  it("bootstrap initializes context with env stage", async () => {
    // Mock core-env
    vi.doMock("@chainlesschain/core-env", () => ({
      getRuntimeInfo: () => ({ runtime: "cli", electron: false }),
      getUserDataPath: () => "/tmp/cc-test",
      getConfigDir: () => "/tmp/cc-test/config",
      getDataDir: () => "/tmp/cc-test/data",
      getLogsDir: () => "/tmp/cc-test/logs",
      ensureDir: vi.fn(),
    }));

    // Mock core-config to skip
    vi.doMock("@chainlesschain/core-config", () => {
      throw new Error("not available");
    });

    // Mock core-db to skip
    vi.doMock("@chainlesschain/core-db", () => {
      throw new Error("not available");
    });

    // Mock core-infra to skip
    vi.doMock("@chainlesschain/core-infra", () => {
      throw new Error("not available");
    });

    const { bootstrap, getContext, shutdown } =
      await import("../../src/runtime/bootstrap.js");

    const ctx = await bootstrap({ verbose: false });
    expect(ctx.env).toBeDefined();
    expect(ctx.env.runtime).toEqual({ runtime: "cli", electron: false });
    expect(ctx.env.userDataPath).toBe("/tmp/cc-test");
    expect(ctx.initialized).toBe(true);

    // getContext should return same object
    expect(getContext()).toBe(ctx);

    // Shutdown should clear context
    await shutdown();
    expect(getContext()).toBeNull();
  });

  it("bootstrap returns cached context on second call", async () => {
    vi.doMock("@chainlesschain/core-env", () => ({
      getRuntimeInfo: () => ({ runtime: "cli" }),
      getUserDataPath: () => "/tmp/cc-test2",
      getConfigDir: () => "/tmp/cc-test2/config",
      getDataDir: () => "/tmp/cc-test2/data",
      getLogsDir: () => "/tmp/cc-test2/logs",
      ensureDir: vi.fn(),
    }));
    vi.doMock("@chainlesschain/core-config", () => {
      throw new Error("skip");
    });
    vi.doMock("@chainlesschain/core-db", () => {
      throw new Error("skip");
    });
    vi.doMock("@chainlesschain/core-infra", () => {
      throw new Error("skip");
    });

    const { bootstrap, shutdown } =
      await import("../../src/runtime/bootstrap.js");

    const ctx1 = await bootstrap();
    const ctx2 = await bootstrap();
    expect(ctx1).toBe(ctx2);

    await shutdown();
  });

  it("bootstrap skips db when skipDb option is true", async () => {
    const mockDbInit = vi.fn();
    vi.doMock("@chainlesschain/core-env", () => ({
      getRuntimeInfo: () => ({}),
      getUserDataPath: () => "/tmp/cc-test3",
      getConfigDir: () => "/tmp/cc-test3/config",
      getDataDir: () => "/tmp/cc-test3/data",
      getLogsDir: () => "/tmp/cc-test3/logs",
      ensureDir: vi.fn(),
    }));
    vi.doMock("@chainlesschain/core-config", () => {
      throw new Error("skip");
    });
    vi.doMock("@chainlesschain/core-db", () => ({
      getDatabaseManager: () => ({ initialize: mockDbInit }),
    }));
    vi.doMock("@chainlesschain/core-infra", () => {
      throw new Error("skip");
    });

    const { bootstrap, shutdown } =
      await import("../../src/runtime/bootstrap.js");

    const ctx = await bootstrap({ skipDb: true });
    expect(ctx.db).toBeNull();
    expect(mockDbInit).not.toHaveBeenCalled();

    await shutdown();
  });

  it("shutdown is safe to call multiple times", async () => {
    vi.doMock("@chainlesschain/core-env", () => ({
      getRuntimeInfo: () => ({}),
      getUserDataPath: () => "/tmp/cc-test4",
      getConfigDir: () => "/tmp/cc-test4/config",
      getDataDir: () => "/tmp/cc-test4/data",
      getLogsDir: () => "/tmp/cc-test4/logs",
      ensureDir: vi.fn(),
    }));
    vi.doMock("@chainlesschain/core-config", () => {
      throw new Error("skip");
    });
    vi.doMock("@chainlesschain/core-db", () => {
      throw new Error("skip");
    });
    vi.doMock("@chainlesschain/core-infra", () => {
      throw new Error("skip");
    });

    const { bootstrap, shutdown } =
      await import("../../src/runtime/bootstrap.js");

    await bootstrap();
    await shutdown();
    // Should not throw on second call
    await shutdown();
  });
});
