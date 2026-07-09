import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

const onMessageHandlers = new Set();
const sendRaw = vi.fn();

vi.mock("../../src/stores/ws.js", () => ({
  useWsStore: () => ({
    sendRaw,
    onMessage: (handler) => {
      onMessageHandlers.add(handler);
      return () => onMessageHandlers.delete(handler);
    },
    onRuntimeEvent: () => () => {},
  }),
}));

import { useBackgroundAgentsStore } from "../../src/stores/backgroundAgents.js";

function emit(msg) {
  onMessageHandlers.forEach((h) => h(msg));
}

describe("backgroundAgents store", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    sendRaw.mockReset();
    onMessageHandlers.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fetchSessions uses bg-list with the showAll flag", async () => {
    sendRaw.mockResolvedValueOnce({
      type: "bg-list",
      sessions: [{ id: "bg-1", status: "running", interactive: true }],
    });

    const store = useBackgroundAgentsStore();
    await store.fetchSessions();

    expect(sendRaw).toHaveBeenCalledWith({ type: "bg-list", all: true });
    expect(store.sessions).toHaveLength(1);
    expect(store.running).toHaveLength(1);
  });

  it("attach seeds hello/log and streams bg-log / bg-event pushes for that id", async () => {
    sendRaw.mockResolvedValueOnce({
      type: "bg-attach",
      bgId: "bg-1",
      hello: { type: "hello", phase: "turn", turn: 1 },
      log: "boot line\n",
    });

    const store = useBackgroundAgentsStore();
    await store.attach("bg-1");

    expect(sendRaw).toHaveBeenCalledWith({
      type: "bg-attach",
      bgId: "bg-1",
      lines: 200,
    });
    expect(store.attachedId).toBe("bg-1");
    expect(store.attachedHello.turn).toBe(1);
    expect(store.logText).toBe("boot line\n");

    emit({ type: "bg-log", bgId: "bg-1", chunk: "more output\n" });
    emit({ type: "bg-log", bgId: "bg-OTHER", chunk: "not ours\n" });
    emit({
      type: "bg-event",
      bgId: "bg-1",
      event: { type: "accepted", queued: 1 },
    });

    expect(store.logText).toBe("boot line\nmore output\n");
    expect(store.events).toEqual([{ type: "accepted", queued: 1 }]);
  });

  it("transport-closed marks the attachment closed and refreshes the list", async () => {
    sendRaw
      .mockResolvedValueOnce({
        type: "bg-attach",
        bgId: "bg-1",
        hello: {},
        log: "",
      })
      .mockResolvedValue({ type: "bg-list", sessions: [] });

    const store = useBackgroundAgentsStore();
    await store.attach("bg-1");
    emit({
      type: "bg-event",
      bgId: "bg-1",
      event: { type: "transport-closed" },
    });

    expect(store.transportClosed).toBe(true);
    await Promise.resolve();
    expect(sendRaw).toHaveBeenLastCalledWith({ type: "bg-list", all: true });
  });

  it("sendPrompt / stopTurn require an attachment and target it", async () => {
    const store = useBackgroundAgentsStore();
    expect(await store.sendPrompt("hi")).toBe(false);
    expect(sendRaw).not.toHaveBeenCalled();

    sendRaw.mockResolvedValue({
      type: "bg-attach",
      bgId: "bg-1",
      hello: {},
      log: "",
    });
    await store.attach("bg-1");
    sendRaw.mockClear();
    sendRaw.mockResolvedValue({});

    await store.sendPrompt("  do more  ");
    expect(sendRaw).toHaveBeenCalledWith({
      type: "bg-prompt",
      bgId: "bg-1",
      text: "do more",
    });

    await store.stopTurn();
    expect(sendRaw).toHaveBeenLastCalledWith({
      type: "bg-stop-turn",
      bgId: "bg-1",
    });
  });

  it("detach clears local state even when the relay is already gone", async () => {
    sendRaw.mockResolvedValueOnce({
      type: "bg-attach",
      bgId: "bg-1",
      hello: {},
      log: "x",
    });

    const store = useBackgroundAgentsStore();
    await store.attach("bg-1");
    sendRaw.mockRejectedValueOnce(new Error("gone"));

    await store.detach();
    expect(store.attachedId).toBeNull();
    expect(store.attachedHello).toBeNull();
  });

  it("stopSession kills the target and drops the attachment when it matches", async () => {
    sendRaw.mockResolvedValueOnce({
      type: "bg-attach",
      bgId: "bg-1",
      hello: {},
      log: "",
    });

    const store = useBackgroundAgentsStore();
    await store.attach("bg-1");
    sendRaw.mockClear();
    sendRaw
      .mockResolvedValueOnce({
        type: "bg-stop",
        session: { id: "bg-1", status: "stopped" },
      })
      .mockResolvedValueOnce({ type: "bg-list", sessions: [] });

    await store.stopSession("bg-1");
    expect(sendRaw).toHaveBeenNthCalledWith(1, {
      type: "bg-stop",
      bgId: "bg-1",
    });
    expect(store.attachedId).toBeNull();
    expect(sendRaw).toHaveBeenNthCalledWith(2, { type: "bg-list", all: true });
  });

  it("renameSession and resumeSession hit the bg protocol and refresh", async () => {
    const store = useBackgroundAgentsStore();
    sendRaw
      .mockResolvedValueOnce({
        type: "bg-rename",
        session: { id: "bg-1", title: "new" },
      })
      .mockResolvedValueOnce({ type: "bg-list", sessions: [] })
      .mockResolvedValueOnce({
        type: "bg-resume",
        session: { id: "bg-2", sessionId: "s", status: "running" },
      })
      .mockResolvedValueOnce({ type: "bg-list", sessions: [] });

    expect(await store.renameSession("bg-1", "  new  ")).toBe(true);
    expect(sendRaw).toHaveBeenNthCalledWith(1, {
      type: "bg-rename",
      bgId: "bg-1",
      title: "new",
    });

    const resumed = await store.resumeSession("bg-1", "go on");
    expect(sendRaw).toHaveBeenNthCalledWith(3, {
      type: "bg-resume",
      bgId: "bg-1",
      text: "go on",
    });
    expect(resumed).toEqual({ id: "bg-2", sessionId: "s", status: "running" });

    // empty input short-circuits without a request
    sendRaw.mockClear();
    expect(await store.renameSession("bg-1", "  ")).toBe(false);
    expect(await store.resumeSession("bg-1", "")).toBeNull();
    expect(sendRaw).not.toHaveBeenCalled();
  });

  it("startPolling refreshes on an interval; teardown stops everything", async () => {
    sendRaw.mockResolvedValue({ type: "bg-list", sessions: [] });

    const store = useBackgroundAgentsStore();
    store.startPolling(5000);
    expect(sendRaw).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5000);
    expect(sendRaw).toHaveBeenCalledTimes(2);

    await store.teardown();
    const calls = sendRaw.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10000);
    expect(sendRaw).toHaveBeenCalledTimes(calls);
  });
});
