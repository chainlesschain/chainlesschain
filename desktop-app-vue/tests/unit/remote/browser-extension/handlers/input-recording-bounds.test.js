import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_INPUT_RECORDING_LIMITS,
  DEFAULT_INPUT_REPLAY_LIMITS,
  HARD_INPUT_RECORDING_LIMITS,
  HARD_INPUT_REPLAY_LIMITS,
  clearInputRecording,
  getInputRecording,
  normalizeInputRecordingOptions,
  normalizeInputReplayOptions,
  replayInputs,
  startInputRecording,
  stopInputRecording,
} from "../../../../../src/main/remote/browser-extension/handlers/input.js";

function createEventTarget() {
  const listeners = new Map();
  return {
    addEventListener: vi.fn((type, handler) => {
      if (!listeners.has(type)) {
        listeners.set(type, new Set());
      }
      listeners.get(type).add(handler);
    }),
    removeEventListener: vi.fn((type, handler) => {
      listeners.get(type)?.delete(handler);
    }),
    dispatch(type, event = {}) {
      for (const handler of listeners.get(type) || []) {
        handler({ type, ...event });
      }
    },
    listenerCount(type) {
      return listeners.get(type)?.size || 0;
    },
  };
}

function installPageMock() {
  const pageWindow = createEventTarget();
  const pageDocument = createEventTarget();
  const executeScript = vi.fn(async ({ func, args = [] }) => [
    { result: await func(...args) },
  ]);

  vi.stubGlobal("window", pageWindow);
  vi.stubGlobal("document", pageDocument);
  vi.stubGlobal("chrome", { scripting: { executeScript } });
  return { pageWindow, pageDocument, executeScript };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("input recording bounds", () => {
  it("normalizes event types and clamps caller limits", () => {
    expect(normalizeInputRecordingOptions(null)).toMatchObject(
      DEFAULT_INPUT_RECORDING_LIMITS,
    );
    expect(
      normalizeInputRecordingOptions({
        eventTypes: ["click", "unknown", "click", "input"],
        maxEvents: Number.MAX_SAFE_INTEGER,
        maxTextChars: Number.MAX_SAFE_INTEGER,
      }),
    ).toEqual({
      eventTypes: ["click", "input"],
      ...HARD_INPUT_RECORDING_LIMITS,
    });
    expect(
      normalizeInputRecordingOptions({ maxEvents: Symbol("invalid") }),
    ).toMatchObject(DEFAULT_INPUT_RECORDING_LIMITS);

    expect(normalizeInputReplayOptions(null)).toMatchObject({
      speed: 1,
      ...DEFAULT_INPUT_REPLAY_LIMITS,
    });
    expect(
      normalizeInputReplayOptions({
        speed: 1000,
        maxEvents: Number.MAX_SAFE_INTEGER,
        maxDurationMs: Number.MAX_SAFE_INTEGER,
        maxStepDelayMs: Number.MAX_SAFE_INTEGER,
      }),
    ).toEqual({ speed: 100, ...HARD_INPUT_REPLAY_LIMITS });
    expect(
      normalizeInputReplayOptions({ speed: Symbol("invalid") }).speed,
    ).toBe(1);
  });

  it("caps recorded events and truncates retained text fields", async () => {
    const { pageDocument } = installPageMock();
    const started = await startInputRecording(1, {
      eventTypes: ["click", "unknown"],
      maxEvents: 2,
      maxTextChars: 4,
    });
    expect(started).toMatchObject({
      success: true,
      limits: { maxEvents: 2, maxTextChars: 4, eventTypes: 1 },
    });

    const target = {
      tagName: "BUTTON",
      id: "button-id",
      className: "primary control",
      value: "sensitive-value",
      checked: true,
    };
    pageDocument.dispatch("click", { target, key: "long-key" });
    pageDocument.dispatch("click", { target });
    pageDocument.dispatch("click", { target });

    const recording = await getInputRecording(1);
    expect(recording).toMatchObject({
      droppedEvents: 1,
      totalEvents: 3,
      overflowed: true,
    });
    expect(recording.events).toHaveLength(2);
    expect(recording.events[0]).toMatchObject({
      target: { id: "butt", className: "prim", selector: "#butt" },
      data: { key: "long", value: "sens", checked: true },
    });

    await expect(stopInputRecording(1)).resolves.toMatchObject({
      success: true,
      eventCount: 2,
      droppedEvents: 1,
      overflowed: true,
    });
    expect(pageDocument.listenerCount("click")).toBe(0);
  });

  it("replaces old page listeners and clear removes the current listener", async () => {
    const { pageDocument, pageWindow } = installPageMock();
    await startInputRecording(2, { eventTypes: ["input"] });
    expect(pageDocument.listenerCount("input")).toBe(1);

    await startInputRecording(2, { eventTypes: ["input"] });
    expect(pageDocument.listenerCount("input")).toBe(1);
    pageDocument.dispatch("input", {
      target: { tagName: "INPUT", value: "value" },
    });
    expect(pageWindow.__chainlessInputRecording.events).toHaveLength(1);

    await expect(clearInputRecording(2)).resolves.toEqual({ success: true });
    expect(pageDocument.listenerCount("input")).toBe(0);
    expect(pageWindow.__chainlessInputRecording).toBeNull();
  });

  it("rejects an oversized replay before sending it into the page", async () => {
    const { executeScript } = installPageMock();
    const recording = {
      events: new Array(DEFAULT_INPUT_REPLAY_LIMITS.maxEvents + 1).fill({}),
    };

    await expect(replayInputs(3, recording)).resolves.toMatchObject({
      code: "INPUT_REPLAY_LIMIT_EXCEEDED",
      limit: { maxEvents: DEFAULT_INPUT_REPLAY_LIMITS.maxEvents },
      received: { events: DEFAULT_INPUT_REPLAY_LIMITS.maxEvents + 1 },
    });
    expect(executeScript).not.toHaveBeenCalled();
  });
});
