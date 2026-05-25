"use strict";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const {
  collect,
  collectAndSync,
} = require("../../lib/adapters/social-weibo-adb/collector");

let stagingDir;

beforeEach(() => {
  stagingDir = mkdtempSync(join(tmpdir(), "cc-weibo-test-"));
});

afterEach(() => {
  try {
    rmSync(stagingDir, { recursive: true, force: true });
  } catch (_e) {
    // ignore
  }
});

function makeFakeBridge({ cookieResult, throwOnInvoke } = {}) {
  return {
    invoke: vi.fn(async (_method) => {
      if (throwOnInvoke) throw throwOnInvoke;
      return cookieResult;
    }),
  };
}

function makeFakeApiClient({
  uid = 1234567890,
  posts = [],
  favourites = [],
  follows = [],
  lastErrorCode = 0,
  lastErrorMessage = null,
} = {}) {
  return {
    fetchUid: vi.fn(async () => uid),
    fetchPosts: vi.fn(async () => posts),
    fetchFavourites: vi.fn(async () => favourites),
    fetchFollows: vi.fn(async () => follows),
    lastErrorCode,
    lastErrorMessage,
  };
}

describe("collect — happy path", () => {
  it("invokes cookies, fetchUid, 3 endpoints, writes snapshot", async () => {
    const bridge = makeFakeBridge({
      cookieResult: {
        cookie: "SUB=abc",
        diagnostic: { cookieCount: 5, hasSub: true },
      },
    });
    const apiClient = makeFakeApiClient({
      uid: 1234567890,
      posts: [{ mid: "P1", text: "p", createdAt: 1 }],
      favourites: [{ mid: "F1", text: "f", favAt: 2 }],
      follows: [{ uid: 99, screenName: "x", followedAt: 0 }],
    });
    const result = await collect(bridge, { apiClient, stagingDir });

    expect(bridge.invoke).toHaveBeenCalledWith("weibo.cookies");
    expect(apiClient.fetchUid).toHaveBeenCalledWith("SUB=abc");
    expect(apiClient.fetchPosts).toHaveBeenCalledWith(
      "SUB=abc",
      1234567890,
      expect.any(Object),
    );
    expect(result.uid).toBe(1234567890);
    expect(result.eventCounts).toEqual({
      post: 1,
      favourite: 1,
      follow: 1,
      total: 3,
    });
    expect(existsSync(result.snapshotPath)).toBe(true);
    const snap = JSON.parse(readFileSync(result.snapshotPath, "utf-8"));
    expect(snap.schemaVersion).toBe(1);
    expect(snap.events).toHaveLength(3);
    expect(result.uidFetchFailed).toBe(false);
  });
});

describe("collect — uid fetch failure (cookie expired)", () => {
  it("returns empty-event snapshot + uidFetchFailed=true", async () => {
    const bridge = makeFakeBridge({
      cookieResult: { cookie: "SUB=expired", diagnostic: {} },
    });
    const apiClient = makeFakeApiClient({
      uid: null,
      lastErrorCode: -4,
      lastErrorMessage: "non-json (cookie expired?)",
    });
    const result = await collect(bridge, { apiClient, stagingDir });
    expect(result.uid).toBe(null);
    expect(result.uidFetchFailed).toBe(true);
    expect(result.eventCounts.total).toBe(0);
    expect(result.lastErrorCode).toBe(-4);
    // fetchPosts/Favourites/Follows must NOT be called when uid failed
    expect(apiClient.fetchPosts).not.toHaveBeenCalled();
    // Snapshot file still written so downstream caller doesn't crash on
    // missing inputPath
    expect(existsSync(result.snapshotPath)).toBe(true);
  });
});

describe("collect — failure modes", () => {
  it("propagates bridge.invoke errors", async () => {
    const bridge = makeFakeBridge({
      throwOnInvoke: new Error("WEIBO_NO_ROOT: phone isn't rooted"),
    });
    await expect(collect(bridge, { stagingDir })).rejects.toThrow(/WEIBO_NO_ROOT/);
  });

  it("throws TypeError when bridge missing invoke", async () => {
    await expect(collect(null, { stagingDir })).rejects.toThrow(TypeError);
    await expect(collect({}, { stagingDir })).rejects.toThrow(TypeError);
  });

  it("throws on malformed cookieResult", async () => {
    const bridge = makeFakeBridge({ cookieResult: { cookie: null } });
    await expect(collect(bridge, { stagingDir })).rejects.toThrow(/malformed payload/);
  });
});

describe("collect — partial result tolerance", () => {
  it("0 events when uid OK but all 3 endpoints empty", async () => {
    const bridge = makeFakeBridge({ cookieResult: { cookie: "SUB=a" } });
    const apiClient = makeFakeApiClient();
    const result = await collect(bridge, { apiClient, stagingDir });
    expect(result.eventCounts.total).toBe(0);
    expect(existsSync(result.snapshotPath)).toBe(true);
  });

  it("partial event set when one endpoint fails", async () => {
    const bridge = makeFakeBridge({ cookieResult: { cookie: "SUB=a" } });
    const apiClient = makeFakeApiClient({
      posts: [{ mid: "P", text: "x", createdAt: 1 }],
      favourites: [], // simulated failure
      follows: [{ uid: 1, screenName: "x" }],
    });
    const result = await collect(bridge, { apiClient, stagingDir });
    expect(result.eventCounts).toEqual({ post: 1, favourite: 0, follow: 1, total: 2 });
  });
});

describe("collectAndSync", () => {
  it("calls registry.syncAdapter + cleans up on success", async () => {
    const bridge = makeFakeBridge({ cookieResult: { cookie: "SUB=a" } });
    const apiClient = makeFakeApiClient({
      posts: [{ mid: "P", createdAt: 1 }],
    });
    let syncedPath = null;
    const registry = {
      syncAdapter: vi.fn(async (name, opts) => {
        if (name !== "social-weibo") throw new Error("wrong name");
        syncedPath = opts.inputPath;
        return { adapter: name, status: "ok", rawCount: 1 };
      }),
    };
    const report = await collectAndSync(bridge, registry, {
      apiClient,
      stagingDir,
    });
    expect(report.status).toBe("ok");
    expect(report.weibo.uid).toBe(1234567890);
    expect(report.weibo.eventCounts.post).toBe(1);
    expect(existsSync(syncedPath)).toBe(false);
  });

  it("cleanup even on syncAdapter throw", async () => {
    const bridge = makeFakeBridge({ cookieResult: { cookie: "SUB=a" } });
    const apiClient = makeFakeApiClient();
    let syncedPath = null;
    const registry = {
      syncAdapter: vi.fn(async (_n, opts) => {
        syncedPath = opts.inputPath;
        throw new Error("registry exploded");
      }),
    };
    await expect(
      collectAndSync(bridge, registry, { apiClient, stagingDir }),
    ).rejects.toThrow("registry exploded");
    expect(existsSync(syncedPath)).toBe(false);
  });

  it("rejects missing syncAdapter", async () => {
    const bridge = makeFakeBridge({ cookieResult: { cookie: "SUB=a" } });
    await expect(
      collectAndSync(bridge, null, { apiClient: makeFakeApiClient() }),
    ).rejects.toThrow(TypeError);
  });
});
