/**
 * incremental-sync 测试 — src/renderer/utils/incremental-sync.ts
 *
 * syncNow() talks to a real backend, so tests stay on the offline-safe surface:
 * change tracking (entity-keyed dedup), the offline skip + no-changes fast
 * paths (neither does network I/O), stats/clear, and the singleton factory.
 * Instances use enableAutoSync:false so trackChange never schedules a debounce.
 */

import { describe, it, expect, afterEach, vi } from "vitest";

vi.mock("@/utils/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import IncrementalSyncManager, {
  getIncrementalSyncManager,
  trackChange as trackChangeHelper,
} from "@/utils/incremental-sync";

let created: IncrementalSyncManager[] = [];
function make(): IncrementalSyncManager {
  // enabled:true → online/offline listeners attach; enableAutoSync:false → no
  // interval timer and trackChange won't fire a debounced sync (no network).
  const m = new IncrementalSyncManager({
    enabled: true,
    enableAutoSync: false,
    enableRealtime: false,
  });
  created.push(m);
  return m;
}
afterEach(() => {
  created.forEach((m) => m.destroy());
  created = [];
});

describe("incremental-sync — trackChange", () => {
  it("tracks pending changes keyed by entity (last write wins)", () => {
    const m = make();
    m.trackChange("file:1", "update", { v: 1 });
    m.trackChange("file:1", "update", { v: 2 }); // same entity → still one
    m.trackChange("file:2", "create", {});
    expect(m.getStats().pendingChanges).toBe(2);
  });
});

describe("incremental-sync — syncNow guarded paths (no network)", () => {
  it("skips when offline and not forced (totalSyncs untouched)", async () => {
    const m = make();
    window.dispatchEvent(new Event("offline")); // handler flips isOnline
    await m.syncNow();
    expect(m.getStats().isOnline).toBe(false);
    expect(m.getStats().totalSyncs).toBe(0);
  });

  it("counts the attempt but does no upload when there are no changes", async () => {
    const m = make(); // online (jsdom navigator.onLine === true)
    await m.syncNow();
    expect(m.getStats().totalSyncs).toBe(1);
    expect(m.getStats().successfulSyncs).toBe(0); // returned before sending
  });
});

describe("incremental-sync — stats + clear", () => {
  it("getStats exposes pending/queue/online; clear drops pending changes", () => {
    const m = make();
    m.trackChange("x", "create", {});
    expect(m.getStats()).toMatchObject({
      pendingChanges: 1,
      queuedSyncs: 0,
      isSyncing: false,
      dataSavedMB: 0,
    });
    m.clear();
    expect(m.getStats().pendingChanges).toBe(0);
  });
});

describe("incremental-sync — singleton factory", () => {
  it("getIncrementalSyncManager memoizes and the trackChange helper routes to it", () => {
    const s1 = getIncrementalSyncManager({
      enabled: false,
      enableAutoSync: false,
    });
    const s2 = getIncrementalSyncManager();
    expect(s2).toBe(s1);
    trackChangeHelper("e", "create", {});
    expect(s1.getStats().pendingChanges).toBe(1);
    s1.destroy();
  });
});
