"use strict";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const {
  collect,
  collectAndSync,
} = require("../../lib/adapters/social-xiaohongshu-adb/collector");

let stagingDir;

beforeEach(() => {
  stagingDir = mkdtempSync(join(tmpdir(), "cc-xhs-test-"));
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
  me = { userId: "5e8c8f7e1234abcdef", nickname: "Alice" },
  notes = [],
  liked = [],
  follows = [],
  lastErrorCode = 0,
  lastErrorMessage = null,
} = {}) {
  return {
    fetchMe: vi.fn(async () => me),
    fetchNotes: vi.fn(async () => notes),
    fetchLiked: vi.fn(async () => liked),
    fetchFollows: vi.fn(async () => follows),
    lastErrorCode,
    lastErrorMessage,
  };
}

describe("collect — happy path", () => {
  it("invokes cookies, fetchMe, 3 endpoints, writes snapshot", async () => {
    const bridge = makeFakeBridge({
      cookieResult: {
        cookie: "a1=fp; web_session=tok",
        a1: "fp",
        diagnostic: { cookieCount: 5 },
      },
    });
    const apiClient = makeFakeApiClient({
      notes: [{ noteId: "N1", title: "note", createdAt: 1716383021000 }],
      liked: [{ noteId: "L1", title: "liked" }],
      follows: [{ userId: "U1", nickname: "Friend" }],
    });
    const result = await collect(bridge, { apiClient, stagingDir });

    expect(bridge.invoke).toHaveBeenCalledWith("xhs.cookies");
    expect(apiClient.fetchMe).toHaveBeenCalledWith("a1=fp; web_session=tok");
    expect(apiClient.fetchNotes).toHaveBeenCalledWith(
      "a1=fp; web_session=tok",
      "fp",
      "5e8c8f7e1234abcdef",
      expect.any(Object),
    );
    expect(result.userId).toBe("5e8c8f7e1234abcdef");
    expect(result.nickname).toBe("Alice");
    expect(result.eventCounts).toEqual({
      note: 1,
      liked: 1,
      follow: 1,
      total: 3,
    });
    expect(existsSync(result.snapshotPath)).toBe(true);
    const snap = JSON.parse(readFileSync(result.snapshotPath, "utf-8"));
    expect(snap.schemaVersion).toBe(1);
    expect(snap.events).toHaveLength(3);
    expect(result.meFetchFailed).toBe(false);
  });
});

describe("collect — meFetchFailed (cookie expired)", () => {
  it("returns empty-event snapshot + meFetchFailed=true", async () => {
    const bridge = makeFakeBridge({
      cookieResult: { cookie: "a1=fp; web_session=expired", a1: "fp" },
    });
    const apiClient = makeFakeApiClient({
      me: null,
      lastErrorCode: -7,
      lastErrorMessage: "/user/me user_id blank",
    });
    const result = await collect(bridge, { apiClient, stagingDir });
    expect(result.userId).toBe(null);
    expect(result.meFetchFailed).toBe(true);
    expect(result.eventCounts.total).toBe(0);
    expect(apiClient.fetchNotes).not.toHaveBeenCalled();
    expect(existsSync(result.snapshotPath)).toBe(true);
  });
});

describe("collect — failure modes", () => {
  it("propagates bridge.invoke errors", async () => {
    const bridge = makeFakeBridge({
      throwOnInvoke: new Error("XHS_NO_ROOT: phone isn't rooted"),
    });
    await expect(collect(bridge, { stagingDir })).rejects.toThrow(/XHS_NO_ROOT/);
  });

  it("throws TypeError when bridge missing invoke", async () => {
    await expect(collect(null, { stagingDir })).rejects.toThrow(TypeError);
    await expect(collect({}, { stagingDir })).rejects.toThrow(TypeError);
  });

  it("throws on malformed cookieResult (missing a1)", async () => {
    const bridge = makeFakeBridge({
      cookieResult: { cookie: "web_session=s", a1: null },
    });
    await expect(collect(bridge, { stagingDir })).rejects.toThrow(/malformed payload/);
  });
});

describe("collect — partial result (X-S signing best-effort)", () => {
  it("0 events when X-S sign rejected on all 3 endpoints", async () => {
    const bridge = makeFakeBridge({
      cookieResult: { cookie: "a1=fp; web_session=tok", a1: "fp" },
    });
    const apiClient = makeFakeApiClient({
      // me OK (no X-S) but all 3 X-S endpoints return [] (461 rejection)
      lastErrorCode: 461,
      lastErrorMessage: "X-S validation failed",
    });
    const result = await collect(bridge, { apiClient, stagingDir });
    expect(result.eventCounts.total).toBe(0);
    expect(result.lastErrorCode).toBe(461);
    expect(result.meFetchFailed).toBe(false);
  });

  it("partial event set when one endpoint X-S signed OK", async () => {
    const bridge = makeFakeBridge({
      cookieResult: { cookie: "a1=fp; web_session=tok", a1: "fp" },
    });
    const apiClient = makeFakeApiClient({
      notes: [{ noteId: "N1", title: "x" }],
      liked: [], // 461
      follows: [], // 461
    });
    const result = await collect(bridge, { apiClient, stagingDir });
    expect(result.eventCounts).toEqual({ note: 1, liked: 0, follow: 0, total: 1 });
  });
});

describe("collectAndSync", () => {
  it("calls registry.syncAdapter + cleans up on success", async () => {
    const bridge = makeFakeBridge({
      cookieResult: { cookie: "a1=fp; web_session=tok", a1: "fp" },
    });
    const apiClient = makeFakeApiClient({
      notes: [{ noteId: "N1" }],
    });
    let syncedPath = null;
    const registry = {
      syncAdapter: vi.fn(async (name, opts) => {
        if (name !== "social-xiaohongshu") throw new Error("wrong name");
        syncedPath = opts.inputPath;
        return { adapter: name, status: "ok", rawCount: 1 };
      }),
    };
    const report = await collectAndSync(bridge, registry, {
      apiClient,
      stagingDir,
    });
    expect(report.status).toBe("ok");
    expect(report.xhs.userId).toBe("5e8c8f7e1234abcdef");
    expect(report.xhs.eventCounts.note).toBe(1);
    expect(existsSync(syncedPath)).toBe(false);
  });

  it("cleanup even on syncAdapter throw", async () => {
    const bridge = makeFakeBridge({
      cookieResult: { cookie: "a1=fp; web_session=tok", a1: "fp" },
    });
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
});
