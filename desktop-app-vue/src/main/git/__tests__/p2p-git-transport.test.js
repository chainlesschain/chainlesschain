/**
 * P2P Git Transport Unit Tests
 * Covers BandwidthTracker, FrameCodec, P2PGitTransport
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const {
  P2PGitTransport,
  BandwidthTracker,
  FrameCodec,
  FRAME_TYPE_REQUEST,
  FRAME_TYPE_RESPONSE,
  FRAME_TYPE_DATA,
  FRAME_TYPE_END,
  FRAME_TYPE_ERROR,
} = require("../p2p-git-transport.js");

// ─── BandwidthTracker ────────────────────────────────────────────────────────

describe("BandwidthTracker", () => {
  let tracker;

  beforeEach(() => {
    tracker = new BandwidthTracker(5);
  });

  it("starts with default 64KB chunk size and 0 bandwidth", () => {
    expect(tracker.getAverageBandwidth()).toBe(0);
    expect(tracker.getOptimalChunkSize()).toBe(64 * 1024);
  });

  it("recordSample: ignores zero-duration samples", () => {
    tracker.recordSample(100000, 0);
    expect(tracker.samples.length).toBe(0);
  });

  it("recordSample: accumulates samples and computes average bandwidth", () => {
    tracker.recordSample(100000, 100); // 1MB/s
    tracker.recordSample(200000, 100); // 2MB/s
    const avg = tracker.getAverageBandwidth();
    expect(avg).toBeCloseTo(1500000, -3); // ~1.5MB/s
  });

  it("evicts oldest sample when window is full", () => {
    for (let i = 0; i < 6; i++) {
      tracker.recordSample(i * 1000, 100);
    }
    expect(tracker.samples.length).toBe(5);
  });

  it("adjusts chunk size toward target bandwidth goal", () => {
    // Feed very high bandwidth to push chunk size up
    for (let i = 0; i < 10; i++) {
      tracker.recordSample(10 * 1024 * 1024, 10); // 1GB/s
    }
    // Chunk size should be larger than default
    expect(tracker.getOptimalChunkSize()).toBeGreaterThan(64 * 1024);
  });

  it("clamps chunk size to MIN/MAX bounds", () => {
    // Very slow bandwidth — should stay at MIN
    for (let i = 0; i < 10; i++) {
      tracker.recordSample(100, 10000);
    }
    expect(tracker.getOptimalChunkSize()).toBeGreaterThanOrEqual(16 * 1024);
    expect(tracker.getOptimalChunkSize()).toBeLessThanOrEqual(256 * 1024);
  });

  it("getStats returns all fields", () => {
    tracker.recordSample(1000, 10);
    const stats = tracker.getStats();
    expect(stats).toHaveProperty("averageBandwidth");
    expect(stats).toHaveProperty("currentChunkSize");
    expect(stats).toHaveProperty("sampleCount");
    expect(stats.sampleCount).toBe(1);
  });
});

// ─── FrameCodec ──────────────────────────────────────────────────────────────

describe("FrameCodec", () => {
  it("encodes and decodes a single frame round-trip", () => {
    const payload = Buffer.from("hello world");
    const encoded = FrameCodec.encode(FRAME_TYPE_REQUEST, payload);

    const { frames, remaining } = FrameCodec.decode(encoded);
    expect(frames.length).toBe(1);
    expect(frames[0].type).toBe(FRAME_TYPE_REQUEST);
    expect(frames[0].payload.toString()).toBe("hello world");
    expect(remaining.length).toBe(0);
  });

  it("handles empty payload", () => {
    const encoded = FrameCodec.encode(FRAME_TYPE_END, Buffer.alloc(0));
    const { frames } = FrameCodec.decode(encoded);
    expect(frames.length).toBe(1);
    expect(frames[0].type).toBe(FRAME_TYPE_END);
    expect(frames[0].payload.length).toBe(0);
  });

  it("decodes multiple frames concatenated", () => {
    const frame1 = FrameCodec.encode(FRAME_TYPE_REQUEST, Buffer.from("req"));
    const frame2 = FrameCodec.encode(FRAME_TYPE_RESPONSE, Buffer.from("res"));
    const combined = Buffer.concat([frame1, frame2]);

    const { frames, remaining } = FrameCodec.decode(combined);
    expect(frames.length).toBe(2);
    expect(frames[0].payload.toString()).toBe("req");
    expect(frames[1].payload.toString()).toBe("res");
    expect(remaining.length).toBe(0);
  });

  it("returns partial buffer as remaining when frame is incomplete", () => {
    const payload = Buffer.from("partial");
    const encoded = FrameCodec.encode(FRAME_TYPE_DATA, payload);
    const truncated = encoded.slice(0, encoded.length - 2); // cut 2 bytes

    const { frames, remaining } = FrameCodec.decode(truncated);
    expect(frames.length).toBe(0);
    expect(remaining.length).toBe(truncated.length);
  });

  it("handles Uint8Array payload", () => {
    const payload = new Uint8Array([1, 2, 3, 4]);
    const encoded = FrameCodec.encode(FRAME_TYPE_DATA, payload);
    const { frames } = FrameCodec.decode(encoded);
    expect(frames[0].payload).toEqual(Buffer.from([1, 2, 3, 4]));
  });

  it("supports all frame type constants", () => {
    for (const type of [
      FRAME_TYPE_REQUEST,
      FRAME_TYPE_RESPONSE,
      FRAME_TYPE_DATA,
      FRAME_TYPE_END,
      FRAME_TYPE_ERROR,
    ]) {
      const buf = FrameCodec.encode(type, Buffer.from("x"));
      const { frames } = FrameCodec.decode(buf);
      expect(frames[0].type).toBe(type);
    }
  });
});

// ─── P2PGitTransport ─────────────────────────────────────────────────────────

describe("P2PGitTransport", () => {
  let transport;
  let mockWebrtcManager;

  beforeEach(() => {
    mockWebrtcManager = {
      sendMessage: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
    };
    transport = new P2PGitTransport({
      webrtcManager: mockWebrtcManager,
      peerId: "peer-123",
      timeout: 5000,
    });
  });

  it("initializes with correct defaults", () => {
    expect(transport.peerId).toBe("peer-123");
    expect(transport.timeout).toBe(5000);
    expect(transport.webrtcManager).toBe(mockWebrtcManager);
  });

  it("toHttpPlugin returns object with request function", () => {
    const plugin = transport.toHttpPlugin();
    expect(plugin).toHaveProperty("request");
    expect(typeof plugin.request).toBe("function");
  });

  it("getBandwidthStats returns stats object", () => {
    const stats = transport.getBandwidthStats();
    expect(stats).toHaveProperty("averageBandwidth");
    expect(stats).toHaveProperty("currentChunkSize");
    expect(stats).toHaveProperty("sampleCount");
  });

  it("setServerHandler registers a handler", () => {
    const handler = vi.fn();
    transport.setServerHandler(handler);
    expect(transport._serverHandler).toBe(handler);
  });

  it("works without webrtcManager (null safety)", () => {
    const t = new P2PGitTransport({});
    expect(t.peerId).toBeNull();
    expect(t.webrtcManager).toBeNull();
  });
});
