/**
 * useLivestreamStore — loadDanmakuHistory stale-response guard
 *
 * Regression: loadDanmakuHistory awaits danmaku:get-history then writes
 * this.danmakuQueue unconditionally. danmakuQueue always belongs to the
 * CURRENT stream (leave/join reset it), so if the user switches streams during
 * the await, the old stream's history corrupts the new stream's queue. The fix
 * drops the response when currentStream is no longer the requested stream.
 *
 * Mock pattern mirrors livestream.test.ts: ipcRenderer is built at module load
 * from "../../utils/ipc" → mocked to a hoisted mockInvoke.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

const { mockInvoke } = vi.hoisted(() => ({ mockInvoke: vi.fn() }));

vi.mock("../../utils/ipc", () => ({
  createRetryableIPC: () => ({ invoke: mockInvoke }),
}));

import { useLivestreamStore } from "../livestream";
import type { Livestream } from "../livestream";

function stream(id: string): Livestream {
  return {
    id,
    title: `Stream ${id}`,
    description: "",
    streamer_did: "did:me",
    status: "live",
    access_type: "public",
    access_code: null,
    viewer_count: 0,
    max_viewers: 100,
    started_at: null,
    ended_at: null,
    created_at: 1700000000000,
    updated_at: 1700000000000,
  } as Livestream;
}

describe("loadDanmakuHistory stale-response guard", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mockInvoke.mockReset();
  });

  it("discards history when the user switched streams during the await", async () => {
    const store = useLivestreamStore();
    store.currentStream = stream("A");
    store.danmakuQueue = [];

    let resolveHistory: (v: unknown) => void = () => {};
    mockInvoke.mockImplementation(
      () => new Promise((resolve) => (resolveHistory = resolve)),
    );

    const p = store.loadDanmakuHistory("A", 50, 0);

    // User switches to stream B before A's history returns (mirrors leave/join).
    store.currentStream = stream("B");
    store.danmakuQueue = [];

    resolveHistory([{ id: "a1" }, { id: "a2" }]);
    await p;

    // B's queue must NOT have received A's history.
    expect(store.danmakuQueue).toHaveLength(0);
  });

  it("applies history when still on the same stream", async () => {
    const store = useLivestreamStore();
    store.currentStream = stream("A");
    store.danmakuQueue = [];

    mockInvoke.mockResolvedValue([{ id: "a1" }, { id: "a2" }]);

    await store.loadDanmakuHistory("A", 50, 0);

    expect(store.danmakuQueue).toHaveLength(2);
  });

  it("prepend path also guards against a stream switch", async () => {
    const store = useLivestreamStore();
    store.currentStream = stream("A");
    store.danmakuQueue = [{ id: "live1" } as never];

    let resolveHistory: (v: unknown) => void = () => {};
    mockInvoke.mockImplementation(
      () => new Promise((resolve) => (resolveHistory = resolve)),
    );

    const p = store.loadDanmakuHistory("A", 50, 50); // offset > 0 → prepend path

    store.currentStream = stream("B");
    store.danmakuQueue = [{ id: "b-live" } as never];

    resolveHistory([{ id: "a-old" }]);
    await p;

    // B's queue is untouched by A's older messages.
    expect(store.danmakuQueue.map((d) => d.id)).toEqual(["b-live"]);
  });
});
