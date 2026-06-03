import { describe, it, expect, beforeEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

// Mock the WS composable so the store is tested in isolation (no real socket).
const mock = {
  children: [{ childDid: "kid", eventCount: 2, lastEventMs: 300 }],
  events: [{ resourceId: "1", package: "com.game", durationMs: 1000 }],
  summary: {
    totalMs: 90000,
    apps: [{ package: "com.game", totalMs: 90000, count: 2 }],
  },
};

vi.mock("../../src/composables/useFamilyGuard.js", () => ({
  useFamilyGuard: () => ({
    listChildren: vi.fn(async () => mock.children),
    listChildEvents: vi.fn(async () => mock.events),
    appUsageSummary: vi.fn(async () => mock.summary),
  }),
}));

import { useFamilyGuardStore } from "../../src/stores/familyGuard.js";

describe("familyGuard store", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it("fetchChildren loads children and auto-selects first child with its detail", async () => {
    const store = useFamilyGuardStore();
    await store.fetchChildren();

    expect(store.hasChildren).toBe(true);
    expect(store.selectedChildDid).toBe("kid");
    // auto-select loaded events + summary
    expect(store.events).toHaveLength(1);
    expect(store.summary.totalMs).toBe(90000);
    expect(store.totalMinutes).toBe(2); // 90000ms → 1.5min → round 2
  });

  it("selectChild loads that child's events + summary", async () => {
    const store = useFamilyGuardStore();
    await store.selectChild("kid");
    expect(store.selectedChildDid).toBe("kid");
    expect(store.summary.apps[0].package).toBe("com.game");
  });

  it("surfaces composable errors into error state", async () => {
    const store = useFamilyGuardStore();
    // Make listChildren throw on next call by remocking
    const mod = await import("../../src/composables/useFamilyGuard.js");
    vi.spyOn(mod, "useFamilyGuard").mockReturnValueOnce({
      listChildren: vi.fn(async () => {
        throw new Error("WS not connected");
      }),
      listChildEvents: vi.fn(),
      appUsageSummary: vi.fn(),
    });
    await store.fetchChildren();
    expect(store.error).toBe("WS not connected");
    expect(store.loading).toBe(false);
  });
});
