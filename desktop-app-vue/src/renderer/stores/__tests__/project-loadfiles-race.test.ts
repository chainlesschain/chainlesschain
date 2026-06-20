/**
 * useProjectStore — loadProjectFiles stale-response race guard
 *
 * Regression: loadProjectFiles awaited project.getFiles then wrote
 * this.projectFiles unconditionally. Two concurrent loads (fast project switch)
 * could let the slower/older response overwrite the newer project's files,
 * leaving currentProject and projectFiles out of sync. A monotonic token now
 * discards superseded responses.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

const mockProjectAPI = { getFiles: vi.fn() };

describe("loadProjectFiles stale-response race", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mockProjectAPI.getFiles.mockReset();
    (window as any).electronAPI = { project: mockProjectAPI };
  });

  it("discards an older response that resolves after a newer load", async () => {
    const { useProjectStore } = await import("../project");
    const store = useProjectStore();

    const resolvers: Record<string, (v: unknown) => void> = {};
    mockProjectAPI.getFiles.mockImplementation(
      (id: string) =>
        new Promise((resolve) => {
          resolvers[id] = resolve;
        }),
    );

    const pA = store.loadProjectFiles("A");
    const pB = store.loadProjectFiles("B"); // newer claims the token

    // Newer (B) resolves first.
    resolvers["B"]([{ id: "B1" }]);
    await pB;
    expect(store.projectFiles.map((f: any) => f.id)).toEqual(["B1"]);

    // Older (A) resolves later — must be discarded, not overwrite B.
    resolvers["A"]([{ id: "A1" }]);
    await pA;
    expect(store.projectFiles.map((f: any) => f.id)).toEqual(["B1"]);
  });

  it("does not clear the newer project's files on a stale failure", async () => {
    const { useProjectStore } = await import("../project");
    const store = useProjectStore();

    let rejectA: (e: unknown) => void = () => {};
    let resolveB: (v: unknown) => void = () => {};
    mockProjectAPI.getFiles.mockImplementation(
      (id: string) =>
        new Promise((resolve, reject) => {
          if (id === "A") rejectA = reject;
          else resolveB = resolve;
        }),
    );

    const pA = store.loadProjectFiles("A");
    const pB = store.loadProjectFiles("B"); // newer

    resolveB([{ id: "B1" }]);
    await pB;
    expect(store.projectFiles.map((f: any) => f.id)).toEqual(["B1"]);

    rejectA(new Error("A failed late"));
    await pA;
    // Stale failure must not wipe B's files.
    expect(store.projectFiles.map((f: any) => f.id)).toEqual(["B1"]);
  });

  it("still applies a normal single load", async () => {
    const { useProjectStore } = await import("../project");
    const store = useProjectStore();
    mockProjectAPI.getFiles.mockResolvedValue([{ id: "f1" }, { id: "f2" }]);

    const result = await store.loadProjectFiles("proj-1");

    expect(result).toHaveLength(2);
    expect(store.projectFiles).toHaveLength(2);
  });
});
