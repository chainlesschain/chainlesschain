"use strict";

import { afterEach, describe, expect, it } from "vitest";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { AdapterRegistry } = require("../../lib/registry");
const { generateKeyHex } = require("../../lib/key-providers");
const { LocalVault } = require("../../lib/vault");
const { WinRecentAdapter } = require("../../lib/adapters/win-recent");
const {
  WIN_RECENT_RESET_CURSOR,
  parseWinRecentCursor,
} = require("../../lib/adapters/win-recent/adapter");

let tmpDir;
let vault;

function createVault() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pdh-win-recent-watermark-"));
  vault = new LocalVault({
    path: path.join(tmpDir, "vault.db"),
    key: generateKeyHex(),
    skipAudit: true,
  });
  vault.open();
}

function createRecentDir(name, count) {
  const dir = path.join(tmpDir, name);
  fs.mkdirSync(dir, { recursive: true });
  for (let index = 1; index <= count; index += 1) {
    const file = path.join(dir, `${String.fromCharCode(96 + index)}.lnk`);
    fs.writeFileSync(file, "lnk");
    const mtimeMs = 1_700_000_000_000 + index * 1000;
    fs.utimesSync(file, mtimeMs / 1000, mtimeMs / 1000);
  }
  return dir;
}

afterEach(() => {
  if (vault) {
    try {
      vault.close();
    } catch {
      // Best-effort cleanup.
    }
    vault = null;
  }
  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

describe("WinRecentAdapter registry watermark integration", () => {
  it("persists bounded continuations and resets after an exact-limit empty boundary", async () => {
    createVault();
    const recentDir = createRecentDir("Recent", 4);
    const adapter = new WinRecentAdapter({ recentDir });
    const registry = new AdapterRegistry({ vault, batchSize: 10 });
    registry.register(adapter);

    const first = await registry.syncAdapter(adapter.name, { limit: 2 });
    expect(first).toMatchObject({
      status: "ok",
      rawCount: 2,
      checkpointCommitted: true,
      watermarkDeferred: false,
    });
    expect(parseWinRecentCursor(first.watermark)).toMatchObject({
      after: { path: "b.lnk" },
      upper: { path: "d.lnk" },
    });

    const second = await registry.syncAdapter(adapter.name, { limit: 2 });
    expect(second).toMatchObject({
      status: "ok",
      rawCount: 2,
      checkpointCommitted: true,
    });
    expect(parseWinRecentCursor(second.watermark)).toMatchObject({
      after: { path: "d.lnk" },
      upper: { path: "d.lnk" },
    });

    // Registry stops immediately after the exact fourth yield, so the next
    // empty invocation is what safely reaches the natural cycle boundary.
    const boundary = await registry.syncAdapter(adapter.name, { limit: 2 });
    expect(boundary).toMatchObject({
      status: "ok",
      rawCount: 0,
      checkpointCommitted: true,
      watermark: WIN_RECENT_RESET_CURSOR,
    });
    expect(vault.stats().rawEvents).toBe(4);
    expect(vault.stats().events).toBe(4);

    const replay = await registry.syncAdapter(adapter.name, { limit: 2 });
    expect(replay.rawCount).toBe(2);
    expect(vault.stats().rawEvents).toBe(4);
    expect(vault.stats().events).toBe(4);
  });

  it("isolates directory scopes and leaves the ambiguous legacy empty scope untouched", async () => {
    createVault();
    const recentA = createRecentDir("RecentA", 1);
    const recentB = createRecentDir("RecentB", 1);
    const adapter = new WinRecentAdapter();
    adapter._deps.defaultDir = () => null;
    const scopeA = adapter.resolveDefaultScope({ recentDir: recentA });
    const scopeB = adapter.resolveDefaultScope({ recentDir: recentB });
    vault.setWatermark(adapter.name, "", {
      watermark: "77",
      lastSyncedAt: Date.now(),
      lastStatus: "ok",
      lastError: null,
    });
    vault.setWatermark(adapter.name, scopeA, {
      watermark: "12",
      lastSyncedAt: Date.now(),
      lastStatus: "ok",
      lastError: null,
    });
    const registry = new AdapterRegistry({ vault });
    registry.register(adapter);

    const firstA = await registry.syncAdapter(adapter.name, {
      recentDir: recentA,
      limit: 1,
    });
    const firstB = await registry.syncAdapter(adapter.name, {
      recentDir: recentB,
      limit: 1,
    });

    expect(scopeA).not.toBe(scopeB);
    expect(firstA.scope).toBe(scopeA);
    expect(firstB.scope).toBe(scopeB);
    expect(firstA.rawCount).toBe(1);
    expect(firstB.rawCount).toBe(1);
    expect(parseWinRecentCursor(firstA.watermark)).toMatchObject({
      after: { path: "a.lnk" },
    });
    expect(vault.getWatermark(adapter.name, "").watermark).toBe("77");
  });

  it("preserves the durable cursor when a strict reader failure aborts the attempt", async () => {
    createVault();
    const recentDir = createRecentDir("Recent", 1);
    const adapter = new WinRecentAdapter({ recentDir });
    const scope = adapter.resolveDefaultScope();
    vault.setWatermark(adapter.name, scope, {
      watermark: WIN_RECENT_RESET_CURSOR,
      lastSyncedAt: Date.now(),
      lastStatus: "ok",
      lastError: null,
    });
    adapter._deps.fs = {
      existsSync: fs.existsSync,
      realpathSync: fs.realpathSync,
      readdirSync: fs.readdirSync,
      statSync() {
        const error = new Error("access denied");
        error.code = "EACCES";
        throw error;
      },
    };
    const registry = new AdapterRegistry({ vault });
    registry.register(adapter);

    const report = await registry.syncAdapter(adapter.name);

    expect(report).toMatchObject({
      status: "error",
      rawCount: 0,
      checkpointCommitted: false,
      watermark: WIN_RECENT_RESET_CURSOR,
    });
    expect(vault.getWatermark(adapter.name, scope).watermark).toBe(
      WIN_RECENT_RESET_CURSOR,
    );
  });
});
