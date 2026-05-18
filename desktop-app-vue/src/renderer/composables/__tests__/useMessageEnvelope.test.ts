/**
 * useMessageEnvelope composable tests — covers the 5 phases (idle → loading
 * → found / not-found / error) the IPC wrapper produces, plus behavior
 * when electronAPI is missing (preload not loaded in pure-browser pages).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { useMessageEnvelope } from "../useMessageEnvelope";

function installElectronApi(invoke?: ReturnType<typeof vi.fn>) {
  const g = globalThis as unknown as { window?: Record<string, unknown> };
  const existing: Record<string, unknown> = g.window || {};
  g.window = {
    ...existing,
    electronAPI: invoke ? { invoke } : undefined,
  };
}

describe("useMessageEnvelope", () => {
  beforeEach(() => {
    installElectronApi();
  });

  it("starts in 'idle' phase", () => {
    const { state } = useMessageEnvelope();
    expect(state.value.phase).toBe("idle");
  });

  it("rejects empty communityId / messageId with 'error' phase", async () => {
    const { state, fetch } = useMessageEnvelope();
    await fetch("", "msg-1");
    expect(state.value.phase).toBe("error");
    if (state.value.phase === "error") {
      expect(state.value.message).toMatch(/不能为空/);
    }
    await fetch("comm-1", "");
    expect(state.value.phase).toBe("error");
  });

  it("returns 'error' when electronAPI.invoke is missing (preload unloaded)", async () => {
    installElectronApi(); // no invoke
    const { state, fetch } = useMessageEnvelope();
    await fetch("comm-1", "msg-1");
    expect(state.value.phase).toBe("error");
    if (state.value.phase === "error") {
      expect(state.value.message).toMatch(/electronAPI/);
    }
  });

  it("returns 'found' with normalized result when IPC says found", async () => {
    const invoke = vi.fn().mockResolvedValue({
      found: true,
      origin: "local",
      envelope: { schema: "envelope/v1", leaf: { message_id: "msg-X" } },
      landmark: { snapshots: [{ tree_head_id: "sha256:abc" }] },
      treeHeadId: "sha256:abc",
      namespace: "mtc/v1/channel/comm-X/000001",
      batchId: "000001",
      leafIndex: 5,
    });
    installElectronApi(invoke);
    const { state, fetch } = useMessageEnvelope();
    await fetch("comm-X", "msg-X");
    expect(invoke).toHaveBeenCalledWith(
      "channel:get-message-envelope",
      "comm-X",
      "msg-X",
    );
    expect(state.value.phase).toBe("found");
    if (state.value.phase === "found") {
      expect(state.value.result.origin).toBe("local");
      expect(state.value.result.treeHeadId).toBe("sha256:abc");
      expect(state.value.result.batchId).toBe("000001");
      expect(state.value.result.leafIndex).toBe(5);
    }
  });

  it("defaults origin to 'local' when missing on payload", async () => {
    const invoke = vi.fn().mockResolvedValue({
      found: true,
      envelope: {},
      treeHeadId: "sha256:default",
    });
    installElectronApi(invoke);
    const { state, fetch } = useMessageEnvelope();
    await fetch("c1", "m1");
    expect(state.value.phase).toBe("found");
    if (state.value.phase === "found") {
      expect(state.value.result.origin).toBe("local");
    }
  });

  it("returns 'not-found' with reason when IPC reports not found", async () => {
    const invoke = vi.fn().mockResolvedValue({
      found: false,
      reason: "envelope not found locally or among peers",
    });
    installElectronApi(invoke);
    const { state, fetch } = useMessageEnvelope();
    await fetch("comm-Y", "msg-Y");
    expect(state.value.phase).toBe("not-found");
    if (state.value.phase === "not-found") {
      expect(state.value.reason).toMatch(/not found/);
    }
  });

  it("returns 'error' when IPC throws", async () => {
    const invoke = vi.fn().mockRejectedValue(new Error("IPC down"));
    installElectronApi(invoke);
    const { state, fetch } = useMessageEnvelope();
    await fetch("comm-Z", "msg-Z");
    expect(state.value.phase).toBe("error");
    if (state.value.phase === "error") {
      expect(state.value.message).toBe("IPC down");
    }
  });

  it("treats null/undefined IPC response as not-found", async () => {
    const invoke = vi.fn().mockResolvedValue(null);
    installElectronApi(invoke);
    const { state, fetch } = useMessageEnvelope();
    await fetch("c1", "m1");
    expect(state.value.phase).toBe("not-found");
  });

  it("transitions through 'loading' before settling", async () => {
    let resolveFn: (v: unknown) => void = () => undefined;
    const invoke = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveFn = resolve;
        }),
    );
    installElectronApi(invoke);
    const { state, fetch } = useMessageEnvelope();
    const p = fetch("c1", "m1");
    // Microtask flush so fetch sets state to 'loading' before awaiting invoke
    await new Promise((r) => setImmediate(r));
    expect(state.value.phase).toBe("loading");
    resolveFn({ found: false, reason: "no" });
    await p;
    expect(state.value.phase).toBe("not-found");
  });

  it("reset() returns to 'idle'", async () => {
    const invoke = vi.fn().mockResolvedValue({ found: false });
    installElectronApi(invoke);
    const { state, fetch, reset } = useMessageEnvelope();
    await fetch("c1", "m1");
    expect(state.value.phase).toBe("not-found");
    reset();
    expect(state.value.phase).toBe("idle");
  });
});
