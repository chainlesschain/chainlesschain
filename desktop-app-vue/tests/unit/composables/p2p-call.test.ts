/**
 * useP2PCall 测试 — src/renderer/composables/useP2PCall.ts
 *
 * IPC-orchestrated call composable. invokeIPC is bound at module load, so
 * window.electronAPI is set before a dynamic import. State refs are per
 * useP2PCall() instance.
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";

vi.mock("@/utils/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock("ant-design-vue", () => ({
  message: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));

const invoke = vi.fn();
let useP2PCall: any;

beforeAll(async () => {
  (window as any).electronAPI = { invoke, on: vi.fn(), off: vi.fn() };
  ({ useP2PCall } = await import("@/composables/useP2PCall"));
});

beforeEach(() => {
  invoke.mockReset();
});

describe("useP2PCall — start call", () => {
  it("startAudioCall sends the right IPC and sets activeCall", async () => {
    invoke.mockResolvedValue({ success: true, callId: "call1" });
    const c = useP2PCall();
    const id = await c.startAudioCall("peer1", { hd: true });
    expect(id).toBe("call1");
    expect(invoke).toHaveBeenCalledWith("p2p-enhanced:start-call", {
      peerId: "peer1",
      type: "audio",
      options: { hd: true },
    });
    expect(c.activeCall.value).toMatchObject({
      callId: "call1",
      peerId: "peer1",
      type: "audio",
      isInitiator: true,
    });
  });

  it("startVideoCall sets type video", async () => {
    invoke.mockResolvedValue({ success: true, callId: "v1" });
    const c = useP2PCall();
    await c.startVideoCall("peer2");
    expect(c.activeCall.value).toMatchObject({ type: "video", callId: "v1" });
  });

  it("returns null on a failed start", async () => {
    invoke.mockResolvedValue({ success: false, error: "busy" });
    const c = useP2PCall();
    expect(await c.startAudioCall("peer1")).toBeNull();
    expect(c.activeCall.value).toBeNull();
  });

  it("startScreenShare threads the sourceId into options", async () => {
    invoke.mockResolvedValue({ success: true, callId: "s1" });
    const c = useP2PCall();
    await c.startScreenShare("peer1", "screen:0", { fps: 30 });
    expect(invoke).toHaveBeenCalledWith("p2p-enhanced:start-call", {
      peerId: "peer1",
      type: "screen",
      options: { fps: 30, sourceId: "screen:0" },
    });
  });
});

describe("useP2PCall — end call", () => {
  it("endCall clears the matching activeCall and returns true", async () => {
    invoke.mockResolvedValueOnce({ success: true, callId: "c1" }); // start
    invoke.mockResolvedValueOnce({ success: true }); // end
    const c = useP2PCall();
    await c.startAudioCall("p");
    expect(c.activeCall.value?.callId).toBe("c1");
    expect(await c.endCall("c1")).toBe(true);
    expect(c.activeCall.value).toBeNull();
  });

  it("endCall returns false on failure", async () => {
    invoke.mockResolvedValue({ success: false, error: "no such call" });
    const c = useP2PCall();
    expect(await c.endCall("zzz")).toBe(false);
  });
});

describe("useP2PCall — queries", () => {
  it("getActiveCalls stores + returns the list, [] on failure", async () => {
    invoke.mockResolvedValue({
      success: true,
      calls: [{ callId: "a" }, { callId: "b" }],
    });
    const c = useP2PCall();
    expect(await c.getActiveCalls()).toHaveLength(2);
    expect(c.activeCalls.value).toHaveLength(2);
    invoke.mockResolvedValue({ success: false });
    expect(await c.getActiveCalls()).toEqual([]);
  });

  it("getCallStats stores the voiceVideoManager stats", async () => {
    invoke.mockResolvedValue({
      success: true,
      stats: { voiceVideoManager: { active: 3 } },
    });
    const c = useP2PCall();
    const stats = await c.getCallStats();
    expect(stats).toEqual({ active: 3 });
    expect(c.callStats.value).toEqual({ active: 3 });
  });
});
