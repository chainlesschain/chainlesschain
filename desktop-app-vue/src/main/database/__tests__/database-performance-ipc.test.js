/**
 * database-performance-ipc — registration + graceful-degradation tests.
 *
 * Regression guard: `registerDatabasePerformanceIPC` was exported but never
 * called from any IPC phase, so the entire `db-performance:*` channel set was
 * "No handler registered" at runtime and the V6 DatabasePerformancePanel was
 * dead. It is now wired in ipc/phases/phase-2-core.js. These tests pin the
 * channel set and prove every handler returns a structured reply (never an
 * unhandled throw) even when the optimizer's db is null.
 *
 * The registrar requires("electron") for ipcMain — which vi.mock cannot
 * intercept from a CJS source — so we inject a mock ipcMain through the DI
 * seam (deps.ipcMain), the same pattern analytics-ipc uses.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const {
  registerDatabasePerformanceIPC,
} = require("../database-performance-ipc.js");

/** Records `handle(channel, fn)` calls into a shared registry. */
function createMockIpcMain() {
  const handlers = {};
  return {
    handlers,
    handle: vi.fn((channel, fn) => {
      handlers[channel] = fn;
    }),
    removeHandler: vi.fn((channel) => {
      delete handlers[channel];
    }),
  };
}

const EXPECTED_CHANNELS = [
  "db-performance:get-stats",
  "db-performance:reset-stats",
  "db-performance:get-slow-queries",
  "db-performance:get-index-suggestions",
  "db-performance:apply-index-suggestion",
  "db-performance:apply-all-index-suggestions",
  "db-performance:analyze-table",
  "db-performance:optimize",
  "db-performance:clear-cache",
  "db-performance:invalidate-cache",
];

/** Minimal optimizer stub matching the surface the handlers call. */
function makeOptimizer(overrides = {}) {
  return {
    getStats: () => ({ totalQueries: 0 }),
    resetStats: () => {},
    getSlowQueries: () => [],
    getIndexSuggestions: () => [],
    applyIndexSuggestion: () => ({ applied: true }),
    applyAllIndexSuggestions: () => [],
    analyzeTable: () => ({}),
    optimize: async () => ({ ok: true }),
    queryCache: { clear: () => {}, invalidate: () => {} },
    ...overrides,
  };
}

let ipc;

describe("registerDatabasePerformanceIPC", () => {
  beforeEach(() => {
    ipc = createMockIpcMain();
  });

  it("registers exactly the 10 db-performance channels the store depends on", () => {
    registerDatabasePerformanceIPC(makeOptimizer(), { ipcMain: ipc });
    expect(Object.keys(ipc.handlers).sort()).toEqual(
      [...EXPECTED_CHANNELS].sort(),
    );
  });

  it("registers nothing when no optimizer is provided (guard)", () => {
    registerDatabasePerformanceIPC(null, { ipcMain: ipc });
    expect(ipc.handle).not.toHaveBeenCalled();
  });

  it("get-stats returns the optimizer's stats in a {success,data} envelope", async () => {
    registerDatabasePerformanceIPC(makeOptimizer(), { ipcMain: ipc });
    const reply = await ipc.handlers["db-performance:get-stats"]();
    expect(reply).toEqual({ success: true, data: { totalQueries: 0 } });
  });

  it("get-slow-queries forwards the limit arg", async () => {
    let seen = null;
    registerDatabasePerformanceIPC(
      makeOptimizer({
        getSlowQueries: (limit) => {
          seen = limit;
          return [];
        },
      }),
      { ipcMain: ipc },
    );
    await ipc.handlers["db-performance:get-slow-queries"]({}, 5);
    expect(seen).toBe(5);
  });

  it("a throwing optimizer method yields {success:false,error} — never an unhandled throw", async () => {
    registerDatabasePerformanceIPC(
      makeOptimizer({
        getIndexSuggestions: () => {
          throw new Error("db is null");
        },
      }),
      { ipcMain: ipc },
    );
    const reply = await ipc.handlers["db-performance:get-index-suggestions"]();
    expect(reply.success).toBe(false);
    expect(reply.error).toContain("db is null");
  });

  it("apply-index-suggestion passes the suggestion through to the optimizer", async () => {
    let seen = null;
    registerDatabasePerformanceIPC(
      makeOptimizer({
        applyIndexSuggestion: (s) => {
          seen = s;
          return { applied: true };
        },
      }),
      { ipcMain: ipc },
    );
    const suggestion = { table: "notes", column: "tag" };
    const reply = await ipc.handlers["db-performance:apply-index-suggestion"](
      {},
      suggestion,
    );
    expect(seen).toEqual(suggestion);
    expect(reply.success).toBe(true);
  });
});
