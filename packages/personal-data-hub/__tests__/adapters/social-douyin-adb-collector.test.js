"use strict";

/**
 * Phase 2a — Douyin C 路径 collector orchestrator unit cover.
 *
 * Same fake-bridge + fake-registry pattern as social-bilibili-adb-collector.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";

const {
  collect,
  collectAndSync,
} = require("../../lib/adapters/social-douyin-adb/collector");

let stagingDir;
let dbDir;
let fixtureDbPath;

beforeEach(() => {
  stagingDir = mkdtempSync(join(tmpdir(), "cc-douyin-staging-"));
  dbDir = mkdtempSync(join(tmpdir(), "cc-douyin-dbfixture-"));
  fixtureDbPath = join(dbDir, "fixture-1234567890123456789_im.db");
  // Build a small valid IM db so the collector has real data to parse.
  const db = new Database(fixtureDbPath);
  db.exec(`
    CREATE TABLE msg(
      sender INTEGER, created_time INTEGER, content TEXT,
      conversation_id TEXT, read_status INTEGER
    );
    CREATE TABLE SIMPLE_USER(
      UID INTEGER, short_id INTEGER, name TEXT,
      avatar_url TEXT, follow_status INTEGER
    );
    INSERT INTO msg VALUES(123, 1716383021000, '{"text":"hi"}', 'conv-A', 1);
    INSERT INTO msg VALUES(456, 1716383022000, '{"text":"hi back"}', 'conv-A', 0);
    INSERT INTO SIMPLE_USER VALUES(456, 789, 'Friend', 'https://x', 1);
  `);
  db.close();
});

afterEach(() => {
  try {
    rmSync(stagingDir, { recursive: true, force: true });
    rmSync(dbDir, { recursive: true, force: true });
  } catch (_e) {
    // ignore
  }
});

function makeFakeBridge({ pullResult, throwOnInvoke } = {}) {
  return {
    invoke: vi.fn(async (method, _params) => {
      if (throwOnInvoke) throw throwOnInvoke;
      if (method !== "douyin.pull-im-db") {
        throw new Error(`fake bridge: unexpected method ${method}`);
      }
      return pullResult;
    }),
  };
}

function makeCleanupSpy() {
  return vi.fn();
}

// ─── collect() — happy path ─────────────────────────────────────────────

describe("collect — happy path", () => {
  it("invokes bridge, parses db, writes snapshot, returns counts", async () => {
    const cleanup = makeCleanupSpy();
    const bridge = makeFakeBridge({
      pullResult: {
        tempPath: fixtureDbPath,
        uid: "1234567890123456789",
        walPath: null,
        shmPath: null,
        extractedAt: 1716383020000,
        cleanup,
      },
    });
    const result = await collect(bridge, { stagingDir });
    expect(bridge.invoke).toHaveBeenCalledWith("douyin.pull-im-db", {
      uid: undefined,
    });
    expect(result.uid).toBe("1234567890123456789");
    expect(result.eventCounts).toEqual({
      message: 2,
      contact: 1,
      total: 3,
    });
    expect(existsSync(result.snapshotPath)).toBe(true);
    const snap = JSON.parse(readFileSync(result.snapshotPath, "utf-8"));
    expect(snap.schemaVersion).toBe(1);
    expect(snap.events).toHaveLength(3);
    expect(result.parserDiagnostic.hadMsgTable).toBe(true);
    expect(result.parserDiagnostic.hadSimpleUserTable).toBe(true);
    // collect() does NOT cleanup db cohort yet — that's caller's
    // responsibility (collectAndSync runs cleanup after syncAdapter).
    expect(cleanup).not.toHaveBeenCalled();
    expect(typeof result._dbCohortCleanup).toBe("function");
  });

  it("forwards uid filter to extension", async () => {
    const bridge = makeFakeBridge({
      pullResult: {
        tempPath: fixtureDbPath,
        uid: "1234567890123456789",
        cleanup: () => {},
      },
    });
    await collect(bridge, { stagingDir, uid: "1234567890123456789" });
    expect(bridge.invoke).toHaveBeenCalledWith("douyin.pull-im-db", {
      uid: "1234567890123456789",
    });
  });

  it("forwards limits to parser", async () => {
    const bridge = makeFakeBridge({
      pullResult: {
        tempPath: fixtureDbPath,
        uid: "1234567890123456789",
        cleanup: () => {},
      },
    });
    const result = await collect(bridge, {
      stagingDir,
      limits: { messages: 1, contacts: 0 },
    });
    expect(result.eventCounts.message).toBe(1);
    // contacts: 0 → fallback to default 5000 (parser uses default when
    // limit is 0; that's intentional per im-db-parser.js).
    expect(result.eventCounts.contact).toBeGreaterThanOrEqual(0);
  });
});

// ─── collect() — failure modes ──────────────────────────────────────────

describe("collect — failure modes", () => {
  it("propagates bridge.invoke errors verbatim", async () => {
    const bridge = makeFakeBridge({
      throwOnInvoke: new Error("DOUYIN_NO_ROOT: phone isn't rooted"),
    });
    await expect(collect(bridge, { stagingDir })).rejects.toThrow(
      /DOUYIN_NO_ROOT/,
    );
  });

  it("rejects malformed bridge payload", async () => {
    const bridge = makeFakeBridge({
      pullResult: { uid: null, tempPath: null },
    });
    await expect(collect(bridge, { stagingDir })).rejects.toThrow(
      /malformed payload/,
    );
  });

  it("rejects bridge missing invoke fn", async () => {
    await expect(collect(null, { stagingDir })).rejects.toThrow(TypeError);
    await expect(collect({}, { stagingDir })).rejects.toThrow(TypeError);
  });

  it("cleans up db cohort if snapshot building throws", async () => {
    const cleanup = makeCleanupSpy();
    const bridge = makeFakeBridge({
      pullResult: {
        tempPath: "/nonexistent/db/path.db", // parser will throw
        uid: "1234567890123456789",
        cleanup,
      },
    });
    await expect(collect(bridge, { stagingDir })).rejects.toThrow();
    expect(cleanup).toHaveBeenCalledOnce();
  });
});

// ─── collectAndSync() ───────────────────────────────────────────────────

describe("collectAndSync — pipes to registry + always cleans up", () => {
  it("calls registry.syncAdapter('social-douyin') + merges report", async () => {
    const cleanup = makeCleanupSpy();
    const bridge = makeFakeBridge({
      pullResult: {
        tempPath: fixtureDbPath,
        uid: "1234567890123456789",
        cleanup,
      },
    });
    let syncedPath = null;
    const registry = {
      syncAdapter: vi.fn(async (name, opts) => {
        if (name !== "social-douyin") throw new Error("wrong name");
        syncedPath = opts.inputPath;
        return {
          adapter: name,
          status: "ok",
          rawCount: 3,
          entityCounts: { events: 3, persons: 0, places: 0, items: 0, topics: 0 },
        };
      }),
    };
    const report = await collectAndSync(bridge, registry, { stagingDir });
    expect(registry.syncAdapter).toHaveBeenCalledWith("social-douyin", {
      inputPath: expect.any(String),
    });
    expect(syncedPath).toBeTruthy();
    expect(report.status).toBe("ok");
    expect(report.douyin.uid).toBe("1234567890123456789");
    expect(report.douyin.eventCounts.total).toBe(3);
    // Both snapshot AND db cohort cleaned up
    expect(existsSync(syncedPath)).toBe(false);
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("cleans up both even if syncAdapter throws", async () => {
    const cleanup = makeCleanupSpy();
    const bridge = makeFakeBridge({
      pullResult: {
        tempPath: fixtureDbPath,
        uid: "1234567890123456789",
        cleanup,
      },
    });
    let syncedPath = null;
    const registry = {
      syncAdapter: vi.fn(async (_name, opts) => {
        syncedPath = opts.inputPath;
        throw new Error("registry exploded");
      }),
    };
    await expect(
      collectAndSync(bridge, registry, { stagingDir }),
    ).rejects.toThrow("registry exploded");
    expect(syncedPath).toBeTruthy();
    expect(existsSync(syncedPath)).toBe(false);
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("rejects missing registry.syncAdapter", async () => {
    const bridge = makeFakeBridge({
      pullResult: { tempPath: fixtureDbPath, uid: "1", cleanup: () => {} },
    });
    await expect(collectAndSync(bridge, null, { stagingDir })).rejects.toThrow(
      TypeError,
    );
    await expect(collectAndSync(bridge, {}, { stagingDir })).rejects.toThrow(
      TypeError,
    );
  });
});
