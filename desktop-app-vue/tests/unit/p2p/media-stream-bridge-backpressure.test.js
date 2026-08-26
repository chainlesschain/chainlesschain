import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  ipcMain: { on: vi.fn() },
}));

const MediaStreamBridge = require("../../../src/main/p2p/media-stream-bridge.js");

describe("MediaStreamBridge backpressure", () => {
  it("bounds pending renderer stream requests", async () => {
    const bridge = new MediaStreamBridge({ maxPendingRequests: 1 });
    const first = bridge.requestMediaStream("audio", {}, { timeout: 60_000 });

    await expect(
      bridge.requestMediaStream("video", {}, { timeout: 60_000 }),
    ).rejects.toMatchObject({ code: "OVERLOADED", retryAfterMs: 100 });

    bridge.cleanup();
    await expect(first).rejects.toThrow("MediaStreamBridge");
    expect(bridge.pendingRequests.size).toBe(0);
  });

  it("rejects a ready stream when the active stream cap is reached", async () => {
    const bridge = new MediaStreamBridge({ maxActiveStreams: 1 });
    const stopListener = vi.fn();
    bridge.on("stop-media-stream", stopListener);

    const first = bridge.requestMediaStream("audio");
    const firstRequestId = [...bridge.pendingRequests.keys()][0];
    bridge.handleStreamReady({
      requestId: firstRequestId,
      streamId: "stream-1",
      tracks: [],
      type: "audio",
    });
    await expect(first).resolves.toMatchObject({ streamId: "stream-1" });

    const second = bridge.requestMediaStream("video");
    const secondRequestId = [...bridge.pendingRequests.keys()][0];
    bridge.handleStreamReady({
      requestId: secondRequestId,
      streamId: "stream-2",
      tracks: [],
      type: "video",
    });

    await expect(second).rejects.toThrow("上限");
    expect(bridge.streams.size).toBe(1);
    expect(stopListener).toHaveBeenCalledWith({ streamId: "stream-2" });
    bridge.cleanup();
  });
});
