/**
 * useMessageEnvelope — fetch + present the B4-merkle / B4-cross Merkle
 * inclusion proof + landmark for a single channel message.
 *
 * Backed by `channel:get-message-envelope` IPC (community-ipc.js):
 *   1. local lookup in own batches/ + cached remote-envelopes/
 *   2. lazy peer-pull from connected libp2p peers when miss
 *
 * Returns reactive `{state, fetch}`. `state.value` shapes:
 *   - { phase: 'idle' }                  — never called yet
 *   - { phase: 'loading' }               — IPC in flight
 *   - { phase: 'found', result }         — envelope + landmark + metadata
 *   - { phase: 'not-found', reason }     — lookup completed, nothing here
 *   - { phase: 'error', message }        — IPC threw / preload missing
 *
 * Caller is responsible for re-invoking fetch() when message id changes;
 * this composable doesn't watch — keeps coupling minimal so it can be
 * dropped into both Vue 3 SFCs and tests easily.
 */

import { ref, type Ref } from "vue";

export interface EnvelopeFound {
  phase: "found";
  result: {
    found: true;
    origin: "local" | "remote";
    envelope: object;
    landmark: object | null;
    treeHeadId: string;
    namespace?: string;
    batchId?: string;
    leafIndex?: number;
    staging?: boolean;
  };
}

export interface EnvelopeIdle {
  phase: "idle";
}
export interface EnvelopeLoading {
  phase: "loading";
}
export interface EnvelopeNotFound {
  phase: "not-found";
  reason?: string;
}
export interface EnvelopeError {
  phase: "error";
  message: string;
}

export type EnvelopeState =
  | EnvelopeIdle
  | EnvelopeLoading
  | EnvelopeFound
  | EnvelopeNotFound
  | EnvelopeError;

interface ElectronAPILike {
  invoke?: (channel: string, ...args: unknown[]) => Promise<unknown>;
}

function electronApi(): ElectronAPILike | null {
  // window.electronAPI is the standard surface; preload shim exposes invoke()
  const w = (
    globalThis as unknown as { window?: { electronAPI?: ElectronAPILike } }
  ).window;
  if (w && w.electronAPI) return w.electronAPI;
  // Some renderer paths put electronAPI on globalThis directly (test setups)
  const g = globalThis as unknown as { electronAPI?: ElectronAPILike };
  return g.electronAPI || null;
}

export function useMessageEnvelope(): {
  state: Ref<EnvelopeState>;
  fetch: (communityId: string, messageId: string) => Promise<void>;
  reset: () => void;
} {
  const state = ref<EnvelopeState>({ phase: "idle" });

  async function fetch(communityId: string, messageId: string): Promise<void> {
    if (!communityId || !messageId) {
      state.value = {
        phase: "error",
        message: "communityId 和 messageId 不能为空",
      };
      return;
    }
    state.value = { phase: "loading" };
    const api = electronApi();
    if (!api || typeof api.invoke !== "function") {
      state.value = {
        phase: "error",
        message: "electronAPI.invoke 不可用 (preload 未加载？)",
      };
      return;
    }
    try {
      const raw = await api.invoke(
        "channel:get-message-envelope",
        communityId,
        messageId,
      );
      const r = (raw || {}) as {
        found?: boolean;
        reason?: string;
        envelope?: object;
        landmark?: object | null;
        treeHeadId?: string;
        namespace?: string;
        batchId?: string;
        leafIndex?: number;
        staging?: boolean;
        origin?: "local" | "remote";
      };
      if (!r.found) {
        state.value = { phase: "not-found", reason: r.reason };
        return;
      }
      state.value = {
        phase: "found",
        result: {
          found: true,
          origin: r.origin || "local",
          envelope: r.envelope || {},
          landmark: r.landmark ?? null,
          treeHeadId: r.treeHeadId || "",
          namespace: r.namespace,
          batchId: r.batchId,
          leafIndex: r.leafIndex,
          staging: r.staging,
        },
      };
    } catch (err) {
      state.value = {
        phase: "error",
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  function reset() {
    state.value = { phase: "idle" };
  }

  return { state, fetch, reset };
}
