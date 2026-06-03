/**
 * useIPFSStorageStore — Pinia store unit tests
 *
 * Covers:
 *  - Initial state shape
 *  - Pure getters: isNodeRunning / currentMode / connectedPeers / pinnedCount /
 *    encryptedItems / usagePercent / formattedTotalSize / formattedQuota
 *  - formatBytes (multi-unit, rounding, 0 B edge)
 *  - clearError / reset
 *  - IPC action (mocked window.electronAPI.invoke): startNode success/error
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

import { useIPFSStorageStore } from "../ipfs-storage";
import type { IPFSContent } from "../ipfs-storage";

function makeContent(overrides: Partial<IPFSContent> = {}): IPFSContent {
  return {
    id: "c1",
    cid: "Qm...",
    size: 1024,
    pinned: true,
    encrypted: false,
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("useIPFSStorageStore", () => {
  const mockInvoke = vi.fn();

  beforeEach(() => {
    setActivePinia(createPinia());
    mockInvoke.mockReset().mockResolvedValue({ success: true });
    (window as any).electronAPI = { invoke: mockInvoke };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------

  describe("Initial state", () => {
    it("starts with a stopped node and empty pins", () => {
      const store = useIPFSStorageStore();
      expect(store.nodeStatus.running).toBe(false);
      expect(store.pinnedContent).toEqual([]);
      expect(store.pinnedTotal).toBe(0);
      expect(store.storageStats).toBeNull();
      expect(store.error).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // formatBytes
  // -------------------------------------------------------------------------

  describe("formatBytes", () => {
    it("formats across units with the documented rounding rules", () => {
      const store = useIPFSStorageStore();
      expect(store.formatBytes(0)).toBe("0 B");
      expect(store.formatBytes(512)).toBe("512 B"); // i===0 → no decimals
      expect(store.formatBytes(1024)).toBe("1.0 KB");
      expect(store.formatBytes(1536)).toBe("1.5 KB");
      expect(store.formatBytes(1024 * 1024)).toBe("1.0 MB");
      expect(store.formatBytes(1024 * 1024 * 1024)).toBe("1.0 GB");
      expect(store.formatBytes(5.5 * 1024 * 1024 * 1024 * 1024)).toBe("5.5 TB");
    });
  });

  // -------------------------------------------------------------------------
  // Getters
  // -------------------------------------------------------------------------

  describe("getters", () => {
    it("node status getters mirror nodeStatus", () => {
      const store = useIPFSStorageStore();
      store.nodeStatus = {
        running: true,
        mode: "remote",
        peerId: "p",
        peerCount: 7,
      } as any;
      expect(store.isNodeRunning).toBe(true);
      expect(store.currentMode).toBe("remote");
      expect(store.connectedPeers).toBe(7);
    });

    it("pinnedCount mirrors pinnedTotal", () => {
      const store = useIPFSStorageStore();
      store.pinnedTotal = 42;
      expect(store.pinnedCount).toBe(42);
    });

    it("encryptedItems filters encrypted pinned content", () => {
      const store = useIPFSStorageStore();
      store.pinnedContent = [
        makeContent({ id: "a", encrypted: true }),
        makeContent({ id: "b", encrypted: false }),
        makeContent({ id: "c", encrypted: true }),
      ];
      expect(store.encryptedItems.map((c) => c.id)).toEqual(["a", "c"]);
    });

    it("usagePercent + formatted getters read storageStats (with safe defaults)", () => {
      const store = useIPFSStorageStore();
      // no stats → defaults
      expect(store.usagePercent).toBe(0);
      expect(store.formattedTotalSize).toBe("0 B");
      expect(store.formattedQuota).toBe("0 B");
      store.storageStats = {
        totalPinned: 3,
        totalSize: 2 * 1024 * 1024,
        peerCount: 1,
        quotaBytes: 1024 * 1024 * 1024,
        usagePercent: 12,
        mode: "embedded",
        nodeRunning: true,
        peerId: null,
      };
      expect(store.usagePercent).toBe(12);
      expect(store.formattedTotalSize).toBe("2.0 MB");
      expect(store.formattedQuota).toBe("1.0 GB");
    });
  });

  // -------------------------------------------------------------------------
  // Utility actions
  // -------------------------------------------------------------------------

  describe("clearError / reset", () => {
    it("clearError nulls the error", () => {
      const store = useIPFSStorageStore();
      store.error = "boom";
      store.clearError();
      expect(store.error).toBeNull();
    });

    it("reset restores defaults", () => {
      const store = useIPFSStorageStore();
      store.pinnedTotal = 5;
      store.error = "x";
      store.uploadProgress = 50;
      store.reset();
      expect(store.pinnedTotal).toBe(0);
      expect(store.error).toBeNull();
      expect(store.uploadProgress).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // IPC action
  // -------------------------------------------------------------------------

  describe("startNode", () => {
    it("updates nodeStatus from result.data on success", async () => {
      const store = useIPFSStorageStore();
      const data = {
        running: true,
        mode: "embedded",
        peerId: "p1",
        peerCount: 3,
      };
      mockInvoke.mockResolvedValueOnce({ success: true, data });
      const result = await store.startNode();
      expect(mockInvoke).toHaveBeenCalledWith("ipfs:start-node");
      expect(result.success).toBe(true);
      expect(store.nodeStatus).toEqual(data);
      expect(store.loading).toBe(false);
    });

    it("sets error and rethrows when IPC throws", async () => {
      const store = useIPFSStorageStore();
      mockInvoke.mockRejectedValueOnce(new Error("nope"));
      await expect(store.startNode()).rejects.toThrow("nope");
      expect(store.error).toBe("nope");
      expect(store.loading).toBe(false);
    });
  });
});
