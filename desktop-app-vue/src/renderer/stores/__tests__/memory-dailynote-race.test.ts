/**
 * useMemoryStore — loadDailyNote stale-response race guard
 *
 * Regression: loadDailyNote awaited memory:read-daily-note then set
 * currentDailyNote/selectedDate unconditionally. Rapidly switching dates let a
 * slower response overwrite a newer date's note (and a stale failure nulled the
 * wrong date). A monotonic token now discards superseded results.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useMemoryStore } from "../memory";

const mockInvoke = vi.fn();

describe("loadDailyNote stale-response race", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mockInvoke.mockReset();
    (window as any).electronAPI = { invoke: mockInvoke };
  });

  it("discards an older date load that resolves after a newer one", async () => {
    const store = useMemoryStore();
    const resolvers: Record<string, () => void> = {};
    mockInvoke.mockImplementation(
      (_channel: string, { date }: { date: string }) =>
        new Promise((resolve) => {
          resolvers[date] = () =>
            resolve({ success: true, content: `note ${date}` });
        }),
    );

    const pOld = store.loadDailyNote("2024-01-15");
    const pNew = store.loadDailyNote("2024-01-16"); // newer token

    resolvers["2024-01-16"]();
    await pNew;
    expect(store.currentDailyNote).toBe("note 2024-01-16");
    expect(store.selectedDate).toBe("2024-01-16");

    resolvers["2024-01-15"]();
    await pOld;
    // Stale older response discarded.
    expect(store.currentDailyNote).toBe("note 2024-01-16");
    expect(store.selectedDate).toBe("2024-01-16");
  });

  it("a stale failure does not null the newer date's note", async () => {
    const store = useMemoryStore();
    let resolveNew: () => void = () => {};
    let rejectOld: () => void = () => {};
    mockInvoke.mockImplementation(
      (_channel: string, { date }: { date: string }) =>
        new Promise((resolve, reject) => {
          if (date === "2024-01-15")
            rejectOld = () => reject(new Error("late fail"));
          else
            resolveNew = () =>
              resolve({ success: true, content: `note ${date}` });
        }),
    );

    const pOld = store.loadDailyNote("2024-01-15");
    const pNew = store.loadDailyNote("2024-01-16");

    resolveNew();
    await pNew;
    expect(store.currentDailyNote).toBe("note 2024-01-16");

    rejectOld();
    await pOld;
    expect(store.currentDailyNote).toBe("note 2024-01-16"); // not nulled
  });

  it("still applies a normal single load", async () => {
    const store = useMemoryStore();
    mockInvoke.mockResolvedValue({ success: true, content: "solo" });

    await store.loadDailyNote("2024-02-01");

    expect(store.currentDailyNote).toBe("solo");
    expect(store.selectedDate).toBe("2024-02-01");
    expect(store.loading.dailyNotes).toBe(false);
  });
});
