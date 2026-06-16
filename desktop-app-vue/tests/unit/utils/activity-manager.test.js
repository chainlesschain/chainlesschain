/**
 * activityManager 测试 — src/renderer/utils/activityManager.ts
 *
 * Self-contained activity log + recent-files singleton (logger + vue +
 * localStorage). Tested through useActivities(); state is cleared per test.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/utils/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { useActivities, ActivityType } from "@/utils/activityManager";

let a;
beforeEach(() => {
  a = useActivities();
  a.clear();
  a.clearRecentFiles();
});

describe("activityManager — record", () => {
  it("records an activity (id returned, most-recent first)", () => {
    const id = a.record({ type: ActivityType.SEARCH, title: "q1" });
    expect(typeof id).toBe("string");
    expect(a.activities.value[0]).toMatchObject({
      id,
      type: "search",
      title: "q1",
    });
  });

  it("adds file activities to recent files but not non-file ones", () => {
    a.record({ type: ActivityType.FILE_OPEN, title: "a.ts", path: "/a.ts" });
    expect(a.getRecentFiles().some((f) => f.path === "/a.ts")).toBe(true);
    a.record({ type: ActivityType.SEARCH, title: "q" });
    expect(a.getRecentFiles()).toHaveLength(1);
  });

  it("dedupes recent files by path (re-open moves to front)", () => {
    a.record({ type: ActivityType.FILE_OPEN, title: "a", path: "/a.ts" });
    a.record({ type: ActivityType.FILE_EDIT, title: "b", path: "/b.ts" });
    a.record({ type: ActivityType.FILE_EDIT, title: "a2", path: "/a.ts" });
    const recent = a.getRecentFiles();
    expect(recent.filter((f) => f.path === "/a.ts")).toHaveLength(1);
    expect(recent[0].path).toBe("/a.ts");
  });
});

describe("activityManager — getActivities filters", () => {
  beforeEach(() => {
    a.record({ type: ActivityType.FILE_OPEN, title: "f", path: "/p" });
    a.record({ type: ActivityType.SEARCH, title: "s" });
    a.record({ type: ActivityType.SEARCH, title: "s2" });
  });

  it("filters by type", () => {
    expect(a.getActivities({ type: ActivityType.SEARCH })).toHaveLength(2);
  });

  it("filters by path", () => {
    const r = a.getActivities({ path: "/p" });
    expect(r).toHaveLength(1);
    expect(r[0].type).toBe("file_open");
  });

  it("applies a limit", () => {
    expect(a.getActivities({ limit: 1 })).toHaveLength(1);
  });

  it("filters by startTime (future cutoff → none)", () => {
    expect(a.getActivities({ startTime: Date.now() + 100000 })).toEqual([]);
  });
});

describe("activityManager — statistics + recents", () => {
  it("getStatistics('all') totals + per-type counts", () => {
    a.record({ type: ActivityType.FILE_OPEN, title: "a", path: "/a" });
    a.record({ type: ActivityType.FILE_OPEN, title: "b", path: "/b" });
    a.record({ type: ActivityType.SEARCH, title: "q" });
    const stats = a.getStatistics("all");
    expect(stats.total).toBe(3);
    expect(stats.typeStats.file_open).toBe(2);
    expect(stats.typeStats.search).toBe(1);
  });

  it("getStatistics('today') includes hour buckets", () => {
    a.record({ type: ActivityType.SEARCH, title: "q" });
    const stats = a.getStatistics("today");
    expect(stats.total).toBe(1);
    expect(Object.values(stats.hourStats).reduce((x, y) => x + y, 0)).toBe(1);
  });

  it("getTodayActivities includes freshly recorded activities", () => {
    a.record({ type: ActivityType.SEARCH, title: "now" });
    expect(a.getTodayActivities().length).toBeGreaterThan(0);
  });

  it("removeFromRecentFiles + clearRecentFiles", () => {
    a.record({ type: ActivityType.FILE_OPEN, title: "a", path: "/a" });
    a.record({ type: ActivityType.FILE_OPEN, title: "b", path: "/b" });
    a.removeFromRecentFiles("/a");
    expect(a.getRecentFiles().some((f) => f.path === "/a")).toBe(false);
    a.clearRecentFiles();
    expect(a.getRecentFiles()).toEqual([]);
  });

  it("clear empties the activity log", () => {
    a.record({ type: ActivityType.SEARCH, title: "q" });
    a.clear();
    expect(a.activities.value).toEqual([]);
  });
});

describe("activityManager — listeners", () => {
  it("notifies listeners on record and stops after removeListener", () => {
    const listener = vi.fn();
    a.addListener(listener);
    a.record({ type: ActivityType.SEARCH, title: "q" });
    expect(listener).toHaveBeenCalledWith(
      "record",
      expect.objectContaining({ type: "search" }),
    );
    listener.mockClear();
    a.removeListener(listener);
    a.record({ type: ActivityType.SEARCH, title: "q2" });
    expect(listener).not.toHaveBeenCalled();
  });
});
