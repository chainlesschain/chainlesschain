/**
 * useSessionCoreStore — Pinia wrapper around electronAPI.sessionCore.* IPC
 *
 * Managed Agents parity Phase H.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

import { useSessionCoreStore } from "../sessionCore";

function buildMockApi() {
  return {
    policy: {
      get: vi.fn(),
      set: vi.fn(),
      clear: vi.fn(),
    },
    session: {
      list: vi.fn(),
      show: vi.fn(),
      create: vi.fn(),
      park: vi.fn(),
      resume: vi.fn(),
      close: vi.fn(),
      recallOnStart: vi.fn(),
      usage: vi.fn(),
      subscribe: vi.fn(),
      onEvent: vi.fn(() => () => {}),
    },
    memory: {
      store: vi.fn(),
      recall: vi.fn(),
      delete: vi.fn(),
      consolidate: vi.fn(),
    },
    agent: {
      streamStart: vi.fn(),
      streamCancel: vi.fn(),
      onStreamEvent: vi.fn(() => () => {}),
    },
    beta: {
      list: vi.fn(),
      enable: vi.fn(),
      disable: vi.fn(),
    },
  };
}

describe("useSessionCoreStore", () => {
  let api: ReturnType<typeof buildMockApi>;

  beforeEach(() => {
    setActivePinia(createPinia());
    api = buildMockApi();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).electronAPI = { sessionCore: api };
  });

  it("refreshSessions stores data from ok envelope", async () => {
    api.session.list.mockResolvedValue({
      ok: true,
      data: [
        {
          sessionId: "s1",
          agentId: "a1",
          status: "running",
          createdAt: 1,
          lastTouchedAt: 2,
          metadata: null,
        },
      ],
    });
    const store = useSessionCoreStore();
    const res = await store.refreshSessions();
    expect(res).toHaveLength(1);
    expect(store.sessions).toHaveLength(1);
  });

  it("captures error on ok:false envelope", async () => {
    api.session.list.mockResolvedValue({ ok: false, error: "boom" });
    const store = useSessionCoreStore();
    const res = await store.refreshSessions();
    expect(res).toBeNull();
    expect(store.lastError).toBe("boom");
  });

  it("setPolicy forwards args", async () => {
    api.policy.set.mockResolvedValue({
      ok: true,
      data: { sessionId: "s1", policy: "trusted" },
    });
    const store = useSessionCoreStore();
    await store.setPolicy("s1", "trusted");
    expect(api.policy.set).toHaveBeenCalledWith("s1", "trusted");
  });

  it("createSession / park / resume / close round-trip", async () => {
    api.session.create.mockResolvedValue({
      ok: true,
      data: { sessionId: "sX", agentId: "a", status: "running" },
    });
    api.session.park.mockResolvedValue({ ok: true, data: { parked: true } });
    api.session.resume.mockResolvedValue({
      ok: true,
      data: { resumed: true },
    });
    api.session.close.mockResolvedValue({ ok: true, data: { closed: true } });
    const store = useSessionCoreStore();
    const created = await store.createSession({ agentId: "a" });
    expect((created as { sessionId: string })?.sessionId).toBe("sX");
    expect(
      ((await store.parkSession("sX")) as { parked: boolean })?.parked,
    ).toBe(true);
    expect(
      ((await store.resumeSession("sX")) as { resumed: boolean })?.resumed,
    ).toBe(true);
    expect(
      ((await store.closeSession("sX")) as { closed: boolean })?.closed,
    ).toBe(true);
  });

  it("recallMemory populates memories", async () => {
    api.memory.recall.mockResolvedValue({
      ok: true,
      data: [{ id: "m1", scope: "global", content: "hi" }],
    });
    const store = useSessionCoreStore();
    await store.recallMemory({ query: "hi" });
    expect(store.memories).toHaveLength(1);
  });

  it("refreshBetaFlags + enableBeta refetches", async () => {
    api.beta.list
      .mockResolvedValueOnce({
        ok: true,
        data: [{ flag: "f-2026-01-01", enabled: false }],
      })
      .mockResolvedValueOnce({
        ok: true,
        data: [{ flag: "f-2026-01-01", enabled: true }],
      });
    api.beta.enable.mockResolvedValue({
      ok: true,
      data: { flag: "f-2026-01-01", enabled: true },
    });
    const store = useSessionCoreStore();
    await store.refreshBetaFlags();
    expect(store.betaFlags[0].enabled).toBe(false);
    await store.enableBeta("f-2026-01-01");
    expect(store.betaFlags[0].enabled).toBe(true);
  });

  it("startStream registers listener and buffers events per streamId", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let captured: ((id: string, ev: any) => void) | null = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (api.agent.onStreamEvent as any).mockImplementation(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (fn: (id: string, ev: any) => void) => {
        captured = fn;
        return () => {};
      },
    );
    api.agent.streamStart.mockResolvedValue({
      ok: true,
      data: { streamId: "x", eventCount: 0, events: [] },
    });

    const store = useSessionCoreStore();
    await store.startStream("x", "hello");
    captured!("x", { type: "token", text: "he" });
    captured!("x", { type: "token", text: "llo" });
    captured!("x", { type: "end" });

    const buf = store.getStreamEvents("x");
    expect(buf).toHaveLength(3);
    expect(buf[2].type).toBe("end");
  });
});
