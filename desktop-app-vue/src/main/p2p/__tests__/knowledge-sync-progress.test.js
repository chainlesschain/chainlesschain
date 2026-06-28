import { describe, it, expect, vi } from "vitest";

const KnowledgeSyncManager = require("../knowledge-sync-manager");

function makeManager(batchSize) {
  const messageManager = {
    sendMessage: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    off: vi.fn(),
  };
  const mgr = new KnowledgeSyncManager(null, messageManager, {
    batchSize,
    enableAutoSync: false, // 不启动 setInterval 自动同步定时器
  });
  return { mgr, messageManager };
}

describe("KnowledgeSyncManager.uploadLocalChanges progress", () => {
  it("never reports synced greater than total when the last batch is partial", async () => {
    const { mgr } = makeManager(50);
    const progressEvents = [];
    mgr.on("sync:progress", (e) => progressEvents.push({ ...e.progress }));

    // 125 项 / 批 50 → 批 [50, 50, 25]。旧代码末批 synced=3*50=150 > 125（120%）。
    const changes = Array.from({ length: 125 }, (_, i) => ({
      noteId: `n${i}`,
      type: "update",
    }));

    await mgr.uploadLocalChanges("peer-1", changes);

    const final = mgr.syncProgress.get("peer-1");
    expect(final.total).toBe(125);
    expect(final.synced).toBe(125); // 不是 150
    // 每一步都不超过 total，且为累计真实条数
    expect(progressEvents.map((p) => p.synced)).toEqual([50, 100, 125]);
    for (const p of progressEvents) {
      expect(p.synced).toBeLessThanOrEqual(p.total);
    }
  });

  it("reports exact progress when evenly divisible", async () => {
    const { mgr } = makeManager(50);
    const changes = Array.from({ length: 100 }, (_, i) => ({
      noteId: `n${i}`,
      type: "update",
    }));

    await mgr.uploadLocalChanges("peer-2", changes);

    expect(mgr.syncProgress.get("peer-2")).toEqual({ total: 100, synced: 100 });
  });

  it("handles a single partial batch (fewer items than batchSize)", async () => {
    const { mgr } = makeManager(50);
    const changes = Array.from({ length: 7 }, (_, i) => ({
      noteId: `n${i}`,
      type: "update",
    }));

    await mgr.uploadLocalChanges("peer-3", changes);

    expect(mgr.syncProgress.get("peer-3")).toEqual({ total: 7, synced: 7 });
  });
});
