import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { ScreenRecorder } = require("../screen-recorder.js");

describe("ScreenRecorder capture-cache bounding", () => {
  let rec;

  beforeEach(() => {
    rec = new ScreenRecorder();
  });

  it("_evictOldCaptures caps capture results and never evicts an active session", () => {
    // Active recording session (carries a frames array) — must be preserved.
    rec.captures.set("rec-1", {
      id: "rec-1",
      frames: [],
      startTime: Date.now(),
    });
    // 250 capture results, each holding image data.
    for (let i = 0; i < 250; i++) {
      rec.captures.set(`cap-${i}`, {
        captureId: `cap-${i}`,
        mode: "screenshot",
        imageData: "base64...",
      });
    }

    rec._evictOldCaptures();

    expect(rec.captures.size).toBeLessThanOrEqual(200);
    expect(rec.captures.has("rec-1")).toBe(true); // session kept
    expect(rec.captures.has("cap-249")).toBe(true); // newest capture kept
    expect(rec.captures.has("cap-0")).toBe(false); // oldest capture evicted
  });

  it("does nothing while under the cap", () => {
    for (let i = 0; i < 10; i++) {
      rec.captures.set(`cap-${i}`, { captureId: `cap-${i}`, mode: "screenshot" });
    }
    rec._evictOldCaptures();
    expect(rec.captures.size).toBe(10);
  });

  it("stopRecording removes the finished session from captures", () => {
    const timer = setInterval(() => {}, 1_000_000);
    rec.captures.set("rec-x", {
      id: "rec-x",
      frames: [{}, {}],
      startTime: Date.now() - 1000,
      _timer: timer,
    });
    rec.recording = true;

    const result = rec.stopRecording("rec-x");

    expect(result.frameCount).toBe(2);
    expect(rec.captures.has("rec-x")).toBe(false); // session no longer leaks
    expect(rec.recording).toBe(false);
  });

  it("stopRecording returns null for an unknown session", () => {
    expect(rec.stopRecording("nope")).toBeNull();
  });
});
