/**
 * usePersonalDataHub — streaming sync (`syncAdapterStream` /
 * `syncAllStream`) must resolve to the `<topic>.end` payload, not to
 * the first `<topic>.event` envelope.
 *
 * Regression context (2026-05-23): the previous `_sendStream` checked
 * for `ws._send`, which the web-panel ws-store never exposed, so the
 * fallback path ran every time. That fallback used `sendRaw` alone,
 * which resolves on the FIRST id-matching reply — typically the first
 * `.event` progress message — and PersonalDataHub.vue then rendered
 *
 *   同步 undefined: undefined
 *   events=0 persons=0 | raw=0 invalid=0 | KG triples=0 RAG docs=0 | 0ms
 *
 * because the event envelope has no .adapter / .status / .entityCounts.
 * These tests pin the corrected behavior.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Per-test handler capture so each call to onMessage installs a fresh
// listener. The mock ws-store hands every call to this slot.
let listener = null;
const sendRaw = vi.fn();
const onMessage = vi.fn((handler) => {
  listener = handler;
  return () => {
    if (listener === handler) listener = null;
  };
});

vi.mock("../../src/stores/ws.js", () => ({
  useWsStore: () => ({
    sendRaw: (...args) => sendRaw(...args),
    onMessage: (...args) => onMessage(...args),
  }),
}));

import { usePersonalDataHub } from "../../src/composables/usePersonalDataHub.js";

/** Push a synthetic server frame into the active onMessage listener. */
function push(msg) {
  if (!listener) throw new Error("no onMessage listener installed");
  listener(msg);
}

/** Grab the id sendRaw was called with (the composable generates it). */
function lastSendRawId() {
  expect(sendRaw).toHaveBeenCalled();
  const [envelope] = sendRaw.mock.calls[sendRaw.mock.calls.length - 1];
  expect(envelope.id).toBeTruthy();
  return envelope.id;
}

describe("usePersonalDataHub — streaming resolves on .end, not first .event", () => {
  beforeEach(() => {
    listener = null;
    sendRaw.mockReset();
    onMessage.mockClear();
    // sendRaw is fire-and-forget for streaming; default to a never-
    // settling promise so its return value can't interfere.
    sendRaw.mockReturnValue(new Promise(() => {}));
  });

  it("syncAdapterStream resolves to the .end report — not the first .event", async () => {
    const hub = usePersonalDataHub();
    const events = [];
    const promise = hub.syncAdapterStream("social-toutiao", {}, (evt) =>
      events.push(evt),
    );
    // Give the sync IIFE a tick to install the onMessage handler.
    await Promise.resolve();

    const id = lastSendRawId();
    const topic = "personal-data-hub.sync-adapter-stream";

    // Server pushes progress events first — these MUST NOT resolve the
    // promise. They go through onEvent.
    push({ id, type: `${topic}.event`, event: { kind: "sync.start", adapter: "social-toutiao" } });
    push({ id, type: `${topic}.event`, event: { kind: "adapter-progress", phase: "fetching" } });

    // Then the .end frame with the real SyncReport carried in `result`.
    const report = {
      adapter: "social-toutiao",
      status: "ok",
      rawCount: 0,
      entityCounts: { events: 0, persons: 0, places: 0, items: 0, topics: 0 },
      invalidCount: 0,
      kgTripleCount: 0,
      ragDocCount: 0,
      durationMs: 73,
      error: null,
      watermark: "0",
    };
    push({ id, type: `${topic}.end`, result: report });

    await expect(promise).resolves.toEqual(report);
    // Caller saw both intermediate events.
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ kind: "sync.start" });
    expect(events[1]).toMatchObject({ kind: "adapter-progress", phase: "fetching" });
  });

  it("ignores .event frames tagged with a different id", async () => {
    const hub = usePersonalDataHub();
    const events = [];
    const promise = hub.syncAdapterStream("social-bilibili", {}, (evt) =>
      events.push(evt),
    );
    await Promise.resolve();

    const id = lastSendRawId();
    const topic = "personal-data-hub.sync-adapter-stream";

    // Foreign id — should be dropped silently.
    push({ id: "OTHER", type: `${topic}.event`, event: { kind: "other" } });
    push({ id: "OTHER", type: `${topic}.end`, result: { adapter: "wrong" } });

    const report = { adapter: "social-bilibili", status: "ok", durationMs: 12 };
    push({ id, type: `${topic}.end`, result: report });

    await expect(promise).resolves.toEqual(report);
    expect(events).toEqual([]);
  });

  it("rejects on `error` frame with the server message", async () => {
    const hub = usePersonalDataHub();
    const promise = hub.syncAdapterStream("social-douyin");
    await Promise.resolve();

    const id = lastSendRawId();
    push({ id, type: "error", message: "boom" });

    await expect(promise).rejects.toThrow("boom");
  });

  it("syncAllStream resolves to the .end reports array", async () => {
    const hub = usePersonalDataHub();
    const events = [];
    const promise = hub.syncAllStream({}, (evt) => events.push(evt));
    await Promise.resolve();

    const id = lastSendRawId();
    const topic = "personal-data-hub.sync-all-stream";

    push({ id, type: `${topic}.event`, event: { kind: "sync.start", adapter: "a" } });
    const reports = [
      { adapter: "a", status: "ok", durationMs: 1 },
      { adapter: "b", status: "ok", durationMs: 2 },
    ];
    push({ id, type: `${topic}.end`, result: reports });

    await expect(promise).resolves.toEqual(reports);
    expect(events).toHaveLength(1);
  });
});
