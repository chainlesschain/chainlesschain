/**
 * family-guard store 测试 — src/renderer/stores/family-guard.ts
 *
 * FAMILY-26 家长端只读 telemetry 镜像 store。getters 纯计算；actions 走
 * window.electronAPI.familyGuard（mock 注入）。
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { useFamilyGuardStore } from "../family-guard";

const api = {
  listChildren: vi.fn(),
  listChildEvents: vi.fn(),
  appUsageSummary: vi.fn(),
};

beforeEach(() => {
  setActivePinia(createPinia());
  api.listChildren.mockReset().mockResolvedValue({ success: true, data: [] });
  api.listChildEvents
    .mockReset()
    .mockResolvedValue({ success: true, data: [] });
  api.appUsageSummary
    .mockReset()
    .mockResolvedValue({ success: true, data: { totalMs: 0, apps: [] } });
  (window as any).electronAPI = { familyGuard: api };
});

describe("family-guard — getters", () => {
  it("hasChildren reflects the children list", () => {
    const s = useFamilyGuardStore();
    expect(s.hasChildren).toBe(false);
    s.children = [{ childDid: "c1", eventCount: 1, lastEventMs: 1 }];
    expect(s.hasChildren).toBe(true);
  });

  it("totalMinutes rounds totalMs to minutes", () => {
    const s = useFamilyGuardStore();
    s.summary = { totalMs: 125000, apps: [] };
    expect(s.totalMinutes).toBe(2);
  });
});

describe("family-guard — fetchChildren", () => {
  it("loads children and auto-selects the first (loading toggled)", async () => {
    api.listChildren.mockResolvedValue({
      success: true,
      data: [{ childDid: "c1", eventCount: 3, lastEventMs: 100 }],
    });
    const s = useFamilyGuardStore();
    await s.fetchChildren();
    expect(s.children).toHaveLength(1);
    expect(s.selectedChildDid).toBe("c1");
    expect(api.listChildEvents).toHaveBeenCalled();
    expect(api.appUsageSummary).toHaveBeenCalled();
    expect(s.loading).toBe(false);
  });

  it("does not re-select when a child is already selected", async () => {
    api.listChildren.mockResolvedValue({
      success: true,
      data: [{ childDid: "c1", eventCount: 1, lastEventMs: 1 }],
    });
    const s = useFamilyGuardStore();
    s.selectedChildDid = "existing";
    await s.fetchChildren();
    expect(s.selectedChildDid).toBe("existing");
  });

  it("records a handler error", async () => {
    api.listChildren.mockResolvedValue({ success: false, error: "denied" });
    const s = useFamilyGuardStore();
    await s.fetchChildren();
    expect(s.error).toBe("denied");
  });

  it("records a thrown error", async () => {
    api.listChildren.mockRejectedValue(new Error("ipc down"));
    const s = useFamilyGuardStore();
    await s.fetchChildren();
    expect(s.error).toBe("ipc down");
    expect(s.loading).toBe(false);
  });
});

describe("family-guard — selectChild / fetchEvents / fetchSummary", () => {
  it("selectChild sets the did and loads events + summary", async () => {
    api.listChildEvents.mockResolvedValue({
      success: true,
      data: [{ resourceId: "e1" }],
    });
    api.appUsageSummary.mockResolvedValue({
      success: true,
      data: {
        totalMs: 60000,
        apps: [{ package: "p", totalMs: 60000, count: 1 }],
      },
    });
    const s = useFamilyGuardStore();
    await s.selectChild("c9", 0);
    expect(s.selectedChildDid).toBe("c9");
    expect(s.events).toEqual([{ resourceId: "e1" }]);
    expect(s.summary.totalMs).toBe(60000);
  });

  it("fetchEvents is a no-op without a selected child", async () => {
    const s = useFamilyGuardStore();
    await s.fetchEvents();
    expect(api.listChildEvents).not.toHaveBeenCalled();
    expect(s.events).toEqual([]);
  });

  it("fetchSummary is a no-op without a selected child", async () => {
    const s = useFamilyGuardStore();
    await s.fetchSummary();
    expect(api.appUsageSummary).not.toHaveBeenCalled();
  });
});
