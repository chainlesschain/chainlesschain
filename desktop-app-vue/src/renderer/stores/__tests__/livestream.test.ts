/**
 * useLivestreamStore — Pinia store unit tests
 *
 * Covers:
 *  - Initial state shape
 *  - Pure getters: isInStream / isCurrentStreamLive / activeViewerCount /
 *    danmakuCount / publicActiveStreams / myLiveStreams / myScheduledStreams
 *  - Pure actions: addDanmaku (dedup + 100-cap) / clearDanmakuQueue /
 *    updateViewerCount / resetState
 *
 * ipcRenderer is built at MODULE LOAD via createRetryableIPC imported from
 * "../utils/ipc" (= renderer/utils/ipc); from stores/__tests__/ that's
 * "../../utils/ipc". vi.hoisted avoids the TDZ. (See memory
 * vitest-vimock-path-relative-to-testfile.)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

const { mockInvoke } = vi.hoisted(() => ({ mockInvoke: vi.fn() }));

vi.mock("../../utils/ipc", () => ({
  createRetryableIPC: () => ({ invoke: mockInvoke }),
}));

import { useLivestreamStore } from "../livestream";
import type { Livestream, DanmakuMessage } from "../livestream";

function stream(id: string, overrides: Partial<Livestream> = {}): Livestream {
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
    ...overrides,
  };
}

function danmaku(id: string): DanmakuMessage {
  return {
    id,
    stream_id: "s1",
    sender_did: "did:me",
    content: `msg ${id}`,
    message_type: "scroll" as any,
    color: "#fff",
    font_size: 14,
    position: 0,
    is_moderated: 0,
    created_at: 1700000000000,
  };
}

describe("useLivestreamStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mockInvoke.mockReset().mockResolvedValue([]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------

  describe("Initial state", () => {
    it("starts with no stream and empty queues", () => {
      const store = useLivestreamStore();
      expect(store.activeStreams).toEqual([]);
      expect(store.currentStream).toBeNull();
      expect(store.viewers).toEqual([]);
      expect(store.danmakuQueue).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // Getters
  // -------------------------------------------------------------------------

  describe("getters", () => {
    it("isInStream + isCurrentStreamLive reflect currentStream", () => {
      const store = useLivestreamStore();
      expect(store.isInStream).toBe(false);
      expect(store.isCurrentStreamLive).toBe(false);
      store.currentStream = stream("s1", { status: "scheduled" });
      expect(store.isInStream).toBe(true);
      expect(store.isCurrentStreamLive).toBe(false);
      store.currentStream = stream("s1", { status: "live" });
      expect(store.isCurrentStreamLive).toBe(true);
    });

    it("activeViewerCount counts viewers with status 'watching'", () => {
      const store = useLivestreamStore();
      store.viewers = [
        { did: "a", status: "watching" } as any,
        { did: "b", status: "left" } as any,
        { did: "c", status: "watching" } as any,
      ];
      expect(store.activeViewerCount).toBe(2);
    });

    it("danmakuCount mirrors danmakuQueue length", () => {
      const store = useLivestreamStore();
      store.danmakuQueue = [danmaku("1"), danmaku("2")];
      expect(store.danmakuCount).toBe(2);
    });

    it("publicActiveStreams filters access_type === 'public'", () => {
      const store = useLivestreamStore();
      store.activeStreams = [
        stream("a", { access_type: "public" }),
        stream("b", { access_type: "friends" }),
        stream("c", { access_type: "public" }),
      ];
      expect(store.publicActiveStreams.map((s) => s.id)).toEqual(["a", "c"]);
    });

    it("myLiveStreams + myScheduledStreams split myStreams by status", () => {
      const store = useLivestreamStore();
      store.myStreams = [
        stream("a", { status: "live" }),
        stream("b", { status: "scheduled" }),
        stream("c", { status: "ended" }),
        stream("d", { status: "live" }),
      ];
      expect(store.myLiveStreams.map((s) => s.id)).toEqual(["a", "d"]);
      expect(store.myScheduledStreams.map((s) => s.id)).toEqual(["b"]);
    });
  });

  // -------------------------------------------------------------------------
  // addDanmaku
  // -------------------------------------------------------------------------

  describe("addDanmaku", () => {
    it("appends a new message", () => {
      const store = useLivestreamStore();
      store.addDanmaku(danmaku("1"));
      store.addDanmaku(danmaku("2"));
      expect(store.danmakuQueue.map((d) => d.id)).toEqual(["1", "2"]);
    });

    it("ignores duplicates by id", () => {
      const store = useLivestreamStore();
      store.addDanmaku(danmaku("1"));
      store.addDanmaku(danmaku("1"));
      expect(store.danmakuQueue).toHaveLength(1);
    });

    it("trims the queue to the last 100 messages", () => {
      const store = useLivestreamStore();
      for (let i = 0; i < 105; i++) {
        store.addDanmaku(danmaku(`d${i}`));
      }
      expect(store.danmakuQueue).toHaveLength(100);
      expect(store.danmakuQueue[0].id).toBe("d5"); // d0..d4 trimmed
      expect(store.danmakuQueue[99].id).toBe("d104");
    });

    it("clearDanmakuQueue empties the queue", () => {
      const store = useLivestreamStore();
      store.addDanmaku(danmaku("1"));
      store.clearDanmakuQueue();
      expect(store.danmakuQueue).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // updateViewerCount / resetState
  // -------------------------------------------------------------------------

  describe("updateViewerCount", () => {
    it("updates currentStream + matching activeStream viewer_count", () => {
      const store = useLivestreamStore();
      store.currentStream = stream("s1", { viewer_count: 0 });
      store.activeStreams = [
        stream("s1", { viewer_count: 0 }),
        stream("s2", { viewer_count: 0 }),
      ];
      store.updateViewerCount("s1", 42);
      expect(store.currentStream?.viewer_count).toBe(42);
      expect(store.activeStreams.find((s) => s.id === "s1")?.viewer_count).toBe(
        42,
      );
      expect(store.activeStreams.find((s) => s.id === "s2")?.viewer_count).toBe(
        0,
      );
    });

    it("is a no-op for a stream that is neither current nor active", () => {
      const store = useLivestreamStore();
      store.currentStream = stream("s1", { viewer_count: 5 });
      store.updateViewerCount("other", 99);
      expect(store.currentStream?.viewer_count).toBe(5);
    });
  });

  describe("resetState", () => {
    it("clears streams, viewers and danmaku", () => {
      const store = useLivestreamStore();
      store.activeStreams = [stream("a")];
      store.currentStream = stream("a");
      store.viewers = [{ did: "v" } as any];
      store.addDanmaku(danmaku("1"));
      store.resetState();
      expect(store.activeStreams).toEqual([]);
      expect(store.currentStream).toBeNull();
      expect(store.viewers).toEqual([]);
      expect(store.danmakuQueue).toEqual([]);
    });
  });
});
