/**
 * useTimeMachineStore — Pinia store unit tests
 *
 * Covers:
 *  - Initial state shape
 *  - Pure getters: unreadMemoriesCount / memoriesByType / currentDateParts /
 *    hasTimelinePosts
 *  - IPC actions (window.electron.ipcRenderer.invoke mocked): loadTimeline +
 *    loadMemories (Array.isArray guard), markMemoryRead (local is_read flip),
 *    generateAnnualReport (unshift), loadActivityStats (stats || null)
 *  - getIpcRenderer() null-guard: loadTimeline no-ops cleanly without electron
 *  - Pure action: setCurrentDate
 *
 * NB: store reads window.electron.ipcRenderer lazily via getIpcRenderer(), so we
 * stub window.electron per-test rather than vi.mock.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

import { useTimeMachineStore } from "../timeMachine";
import type { Memory, TimelinePost } from "../timeMachine";

const mockInvoke = vi.fn();

function memory(
  id: string,
  memory_type: Memory["memory_type"],
  is_read: number,
): Memory {
  return {
    id,
    memory_type,
    title: `M ${id}`,
    description: null,
    cover_image: null,
    related_posts: [],
    target_date: null,
    generated_at: 1700000000000,
    is_read,
  };
}

function post(id: string): TimelinePost {
  return {
    id,
    source_type: "post",
    source_id: `s-${id}`,
    snapshot_date: "2026-01-01",
    content_preview: null,
    media_urls: [],
    created_at: 1700000000000,
  };
}

describe("useTimeMachineStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mockInvoke.mockReset().mockResolvedValue([]);
    (window as any).electron = { ipcRenderer: { invoke: mockInvoke } };
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete (window as any).electron;
  });

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------

  describe("Initial state", () => {
    it("starts empty with an ISO currentDate", () => {
      const store = useTimeMachineStore();
      expect(store.timelinePosts).toEqual([]);
      expect(store.memories).toEqual([]);
      expect(store.sentimentTrend).toEqual([]);
      expect(store.activityStats).toBeNull();
      expect(store.loading).toBe(false);
      expect(store.currentDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  // -------------------------------------------------------------------------
  // Getters
  // -------------------------------------------------------------------------

  describe("getters", () => {
    it("unreadMemoriesCount counts is_read === 0", () => {
      const store = useTimeMachineStore();
      store.memories = [
        memory("a", "milestone", 0),
        memory("b", "milestone", 1),
        memory("c", "throwback", 0),
      ];
      expect(store.unreadMemoriesCount).toBe(2);
    });

    it("memoriesByType groups by memory_type", () => {
      const store = useTimeMachineStore();
      store.memories = [
        memory("a", "milestone", 0),
        memory("b", "throwback", 0),
        memory("c", "milestone", 1),
      ];
      const grouped = store.memoriesByType;
      expect(grouped.milestone.map((m) => m.id)).toEqual(["a", "c"]);
      expect(grouped.throwback.map((m) => m.id)).toEqual(["b"]);
      expect(grouped.annual_report).toBeUndefined();
    });

    it("currentDateParts parses the ISO date", () => {
      const store = useTimeMachineStore();
      store.currentDate = "2026-03-07";
      expect(store.currentDateParts).toEqual({ year: 2026, month: 3, day: 7 });
    });

    it("hasTimelinePosts reflects the list", () => {
      const store = useTimeMachineStore();
      expect(store.hasTimelinePosts).toBe(false);
      store.timelinePosts = [post("p1")];
      expect(store.hasTimelinePosts).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // IPC actions
  // -------------------------------------------------------------------------

  describe("IPC actions", () => {
    it("loadTimeline stores an array result", async () => {
      const store = useTimeMachineStore();
      mockInvoke.mockResolvedValue([post("p1"), post("p2")]);
      await store.loadTimeline(2026, 1, 1);
      expect(mockInvoke).toHaveBeenCalledWith("time-machine:get-timeline", {
        year: 2026,
        month: 1,
        day: 1,
      });
      expect(store.timelinePosts.map((p) => p.id)).toEqual(["p1", "p2"]);
      expect(store.loading).toBe(false);
    });

    it("loadMemories coerces a non-array result to []", async () => {
      const store = useTimeMachineStore();
      mockInvoke.mockResolvedValue(null);
      await store.loadMemories();
      expect(store.memories).toEqual([]);
      mockInvoke.mockResolvedValue([memory("a", "milestone", 0)]);
      await store.loadMemories(5);
      expect(mockInvoke).toHaveBeenLastCalledWith(
        "time-machine:get-memories",
        5,
      );
      expect(store.memories).toHaveLength(1);
    });

    it("markMemoryRead flips the local is_read flag", async () => {
      const store = useTimeMachineStore();
      store.memories = [memory("a", "milestone", 0)];
      await store.markMemoryRead("a");
      expect(mockInvoke).toHaveBeenCalledWith("time-machine:mark-read", "a");
      expect(store.memories[0].is_read).toBe(1);
    });

    it("generateAnnualReport prepends the returned memory", async () => {
      const store = useTimeMachineStore();
      store.memories = [memory("old", "milestone", 1)];
      const report = memory("rpt", "annual_report", 0);
      mockInvoke.mockResolvedValue(report);
      const result = await store.generateAnnualReport(2025);
      expect(mockInvoke).toHaveBeenCalledWith(
        "memory:generate-annual-report",
        2025,
      );
      expect(result?.id).toBe("rpt");
      expect(store.memories.map((m) => m.id)).toEqual(["rpt", "old"]);
    });

    it("loadActivityStats falls back to null on an empty result", async () => {
      const store = useTimeMachineStore();
      mockInvoke.mockResolvedValue(undefined);
      await store.loadActivityStats("week");
      expect(mockInvoke).toHaveBeenCalledWith("stats:get-activity", "week");
      expect(store.activityStats).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // null-guard + pure action
  // -------------------------------------------------------------------------

  describe("guards + pure actions", () => {
    it("loadTimeline no-ops cleanly when electron is absent", async () => {
      delete (window as any).electron;
      const store = useTimeMachineStore();
      await store.loadTimeline(2026, 1, 1);
      expect(store.timelinePosts).toEqual([]);
      expect(store.loading).toBe(false);
    });

    it("setCurrentDate updates the browsing date", () => {
      const store = useTimeMachineStore();
      store.setCurrentDate("2025-12-31");
      expect(store.currentDate).toBe("2025-12-31");
    });
  });
});
