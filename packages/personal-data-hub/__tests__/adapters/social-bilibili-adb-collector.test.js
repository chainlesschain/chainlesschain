"use strict";

/**
 * Phase 1b — unit cover for the BilibiliAdbCollector orchestrator.
 *
 * Strategy: mock bridge + ApiClient + registry as plain objects so we
 * verify the orchestration logic (call order, error propagation,
 * partial-result tolerance, cleanup) without spawning real ADB or
 * hitting api.bilibili.com.
 *
 * What we cover:
 *  - collect() — bridge.invoke → 4 fetches → snapshot file written
 *  - collect() returns counts + diagnostic
 *  - collect() rejects malformed bridge payload
 *  - collect() propagates bridge.invoke errors
 *  - collect() tolerates any-of-4 endpoint failure (partial)
 *  - collect() tolerates ALL 4 endpoints empty (0-event snapshot)
 *  - collectAndSync() — pipes snapshot to registry + always cleans up
 *  - collectAndSync() cleanup happens even on syncAdapter throw
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const {
  collect,
  collectAndSync,
} = require("../../lib/adapters/social-bilibili-adb/collector");

let stagingDir;

beforeEach(() => {
  stagingDir = mkdtempSync(join(tmpdir(), "cc-collector-test-"));
});

afterEach(() => {
  try {
    rmSync(stagingDir, { recursive: true, force: true });
  } catch (_e) {
    // ignore
  }
});

function makeFakeBridge(invokeResult) {
  return {
    invoke: vi.fn(async () => {
      if (invokeResult instanceof Error) throw invokeResult;
      return invokeResult;
    }),
  };
}

function makeFakeApiClient({
  history = [],
  favourites = [],
  dynamics = [],
  follows = [],
  lastErrorCode = 0,
  lastErrorMessage = null,
} = {}) {
  return {
    fetchHistory: vi.fn(async () => history),
    fetchFavourites: vi.fn(async () => favourites),
    fetchDynamics: vi.fn(async () => dynamics),
    fetchFollows: vi.fn(async () => follows),
    lastErrorCode,
    lastErrorMessage,
  };
}

// ─── collect() ──────────────────────────────────────────────────────────

describe("collect — happy path", () => {
  it("invokes bridge, fetches 4 endpoints, writes snapshot, returns counts", async () => {
    const bridge = makeFakeBridge({
      cookie: "SESSDATA=x; DedeUserID=1234567890; ...",
      uid: 1234567890,
      diagnostic: { cookieCount: 5 },
    });
    const apiClient = makeFakeApiClient({
      history: [{ bvid: "BV1", title: "h", viewAt: 1 }],
      favourites: [{ bvid: "BVf", title: "f", savedAt: 2 }],
      dynamics: [{ rid: "r1", summary: "d", dynamicType: "av", publishedAt: 3 }],
      follows: [{ mid: 1, uname: "u", followedAt: 4 }],
    });
    const result = await collect(bridge, { apiClient, stagingDir });

    expect(bridge.invoke).toHaveBeenCalledWith("bilibili.cookies");
    expect(apiClient.fetchHistory).toHaveBeenCalled();
    expect(apiClient.fetchFavourites).toHaveBeenCalledWith(
      "SESSDATA=x; DedeUserID=1234567890; ...",
      1234567890,
      expect.any(Object),
    );
    expect(apiClient.fetchDynamics).toHaveBeenCalled();
    expect(apiClient.fetchFollows).toHaveBeenCalled();

    expect(result.uid).toBe(1234567890);
    expect(result.eventCounts).toEqual({
      history: 1,
      favourite: 1,
      dynamic: 1,
      follow: 1,
      total: 4,
    });
    expect(existsSync(result.snapshotPath)).toBe(true);
    const snap = JSON.parse(readFileSync(result.snapshotPath, "utf-8"));
    expect(snap.schemaVersion).toBe(1);
    expect(snap.events).toHaveLength(4);
    expect(result.cookieDiagnostic).toEqual({ cookieCount: 5 });
  });

  it("forwards lastErrorCode + lastErrorMessage from api client", async () => {
    const bridge = makeFakeBridge({ cookie: "x", uid: 1 });
    const apiClient = makeFakeApiClient({
      lastErrorCode: -412,
      lastErrorMessage: "anti-spider",
    });
    const result = await collect(bridge, { apiClient, stagingDir });
    expect(result.lastErrorCode).toBe(-412);
    expect(result.lastErrorMessage).toBe("anti-spider");
  });

  it("calls 4 endpoints in parallel (Promise.all)", async () => {
    const order = [];
    const apiClient = {
      fetchHistory: async () => {
        order.push("history-start");
        await new Promise((r) => setTimeout(r, 10));
        order.push("history-end");
        return [];
      },
      fetchFavourites: async () => {
        order.push("favourites-start");
        await new Promise((r) => setTimeout(r, 10));
        order.push("favourites-end");
        return [];
      },
      fetchDynamics: async () => {
        order.push("dynamics-start");
        await new Promise((r) => setTimeout(r, 10));
        order.push("dynamics-end");
        return [];
      },
      fetchFollows: async () => {
        order.push("follows-start");
        await new Promise((r) => setTimeout(r, 10));
        order.push("follows-end");
        return [];
      },
      lastErrorCode: 0,
      lastErrorMessage: null,
    };
    const bridge = makeFakeBridge({ cookie: "x", uid: 1 });
    await collect(bridge, { apiClient, stagingDir });
    // All 4 "start" events should fire before any "end" event (parallel)
    const firstEnd = order.findIndex((e) => e.endsWith("-end"));
    const startsBeforeFirstEnd = order.slice(0, firstEnd).filter((e) => e.endsWith("-start"));
    expect(startsBeforeFirstEnd).toHaveLength(4);
  });
});

describe("collect — failure modes", () => {
  it("propagates bridge.invoke error", async () => {
    const bridge = makeFakeBridge(new Error("BILIBILI_NO_ROOT: ..."));
    await expect(collect(bridge, { stagingDir })).rejects.toThrow(
      /BILIBILI_NO_ROOT/,
    );
  });

  it("throws TypeError when bridge missing invoke fn", async () => {
    await expect(collect(null, { stagingDir })).rejects.toThrow(TypeError);
    await expect(collect({}, { stagingDir })).rejects.toThrow(TypeError);
  });

  it("throws when bridge returns malformed payload", async () => {
    const bridge = makeFakeBridge({ cookie: null, uid: null });
    await expect(collect(bridge, { stagingDir })).rejects.toThrow(
      /malformed payload/,
    );
  });

  it("throws when uid is not positive", async () => {
    const bridge = makeFakeBridge({ cookie: "x", uid: 0 });
    await expect(collect(bridge, { stagingDir })).rejects.toThrow();
  });
});

describe("collect — partial result tolerance", () => {
  it("succeeds with 0 events when ALL 4 endpoints empty", async () => {
    const bridge = makeFakeBridge({ cookie: "x", uid: 1 });
    const apiClient = makeFakeApiClient(); // all empty
    const result = await collect(bridge, { apiClient, stagingDir });
    expect(result.eventCounts.total).toBe(0);
    expect(existsSync(result.snapshotPath)).toBe(true);
  });

  it("succeeds with partial event set when one endpoint fails (returns [])", async () => {
    const bridge = makeFakeBridge({ cookie: "x", uid: 1 });
    const apiClient = makeFakeApiClient({
      history: [{ bvid: "BV1", title: "h", viewAt: 1 }],
      favourites: [], // simulated failure
      dynamics: [],
      follows: [{ mid: 1, uname: "u", followedAt: 1 }],
    });
    const result = await collect(bridge, { apiClient, stagingDir });
    expect(result.eventCounts).toEqual({
      history: 1,
      favourite: 0,
      dynamic: 0,
      follow: 1,
      total: 2,
    });
  });
});

// ─── collectAndSync() ───────────────────────────────────────────────────

describe("collectAndSync — pipes to registry + cleans up", () => {
  it("calls registry.syncAdapter with snapshot path + returns merged report", async () => {
    const bridge = makeFakeBridge({ cookie: "x", uid: 42 });
    const apiClient = makeFakeApiClient({
      history: [{ bvid: "BV1", title: "h", viewAt: 1 }],
    });
    let syncedPath = null;
    const registry = {
      syncAdapter: vi.fn(async (name, opts) => {
        if (name !== "social-bilibili") throw new Error("wrong name");
        syncedPath = opts.inputPath;
        return {
          adapter: name,
          status: "ok",
          rawCount: 1,
          entityCounts: { events: 1, persons: 0, places: 0, items: 0, topics: 0 },
        };
      }),
    };

    const report = await collectAndSync(bridge, registry, {
      apiClient,
      stagingDir,
    });

    expect(registry.syncAdapter).toHaveBeenCalledWith("social-bilibili", {
      inputPath: expect.any(String),
    });
    expect(syncedPath).toBeTruthy();
    expect(report.status).toBe("ok");
    expect(report.rawCount).toBe(1);
    expect(report.bilibili.uid).toBe(42);
    expect(report.bilibili.eventCounts.history).toBe(1);
    // Cleanup happened: the snapshot file should be gone
    expect(existsSync(syncedPath)).toBe(false);
  });

  it("cleans up snapshot file even when syncAdapter throws", async () => {
    const bridge = makeFakeBridge({ cookie: "x", uid: 42 });
    const apiClient = makeFakeApiClient();
    let syncedPath = null;
    const registry = {
      syncAdapter: vi.fn(async (_name, opts) => {
        syncedPath = opts.inputPath;
        throw new Error("simulated registry failure");
      }),
    };
    await expect(
      collectAndSync(bridge, registry, { apiClient, stagingDir }),
    ).rejects.toThrow("simulated registry failure");
    expect(syncedPath).toBeTruthy();
    expect(existsSync(syncedPath)).toBe(false); // cleanup ran
  });

  it("throws TypeError when registry missing syncAdapter fn", async () => {
    const bridge = makeFakeBridge({ cookie: "x", uid: 1 });
    await expect(
      collectAndSync(bridge, null, { apiClient: makeFakeApiClient() }),
    ).rejects.toThrow(TypeError);
    await expect(
      collectAndSync(bridge, {}, { apiClient: makeFakeApiClient() }),
    ).rejects.toThrow(TypeError);
  });
});
