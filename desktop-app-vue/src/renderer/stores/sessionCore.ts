/**
 * sessionCore Store — Managed Agents parity Phase H
 *
 * Wraps `window.electronAPI.sessionCore.*` IPC (21 channels backed by the shared
 * CLI file-backed singletons under `~/.chainlesschain/`). Handles the
 * uniform `{ok, data|error}` envelope and exposes reactive state for session
 * policy, session lifecycle, scoped memory, beta flags, and StreamRouter events.
 */

import { defineStore } from "pinia";
import { ref } from "vue";

export type ApprovalPolicy = "strict" | "trusted" | "autopilot";
export type MemoryScope = "session" | "user" | "agent" | "global";

export interface SessionSummary {
  sessionId: string;
  agentId: string;
  status: string;
  createdAt: number;
  lastTouchedAt: number;
  metadata: unknown;
}

export interface MemoryEntry {
  id: string;
  scope: MemoryScope;
  scopeId?: string;
  content: string;
  category?: string;
  tags?: string[];
  score?: number;
  metadata?: Record<string, unknown>;
}

export interface UsageSummary {
  total: {
    sessionCount: number;
    activeCount: number;
    runtimeMs: number;
    idleMs: number;
    sessionHours: number;
  };
  byAgent: Array<{
    agentId: string;
    sessionCount: number;
    activeCount: number;
    runtimeMs: number;
    idleMs: number;
    sessionHours: number;
  }>;
}

export interface BetaFlagEntry {
  flag: string;
  enabled: boolean;
}

export interface StreamEvent {
  type:
    | "start"
    | "token"
    | "tool_call"
    | "tool_result"
    | "message"
    | "error"
    | "end";
  ts?: number;
  text?: string;
  content?: string;
  error?: string;
  [k: string]: unknown;
}

type Envelope<T> = { ok: true; data: T } | { ok: false; error: string };

// Local typed API shape — avoids conflicting with the global ElectronAPI interface
interface SessionCoreAPI {
  policy: {
    get: (sessionId: string) => Promise<
      Envelope<{
        sessionId: string;
        policy: ApprovalPolicy;
        default: ApprovalPolicy | null;
      }>
    >;
    set: (
      sessionId: string,
      policy: ApprovalPolicy,
    ) => Promise<Envelope<{ sessionId: string; policy: ApprovalPolicy }>>;
    clear: (sessionId: string) => Promise<Envelope<{ cleared: boolean }>>;
  };
  session: {
    list: (filter?: {
      agentId?: string;
      status?: string;
    }) => Promise<Envelope<SessionSummary[]>>;
    show: (
      sessionId: string,
    ) => Promise<Envelope<SessionSummary & { usage: unknown }>>;
    create: (opts: {
      agentId: string;
      approvalPolicy?: ApprovalPolicy;
      metadata?: unknown;
      sessionId?: string;
    }) => Promise<
      Envelope<{ sessionId: string; agentId: string; status: string }>
    >;
    recallOnStart: (opts: {
      agentId: string;
      scope?: MemoryScope;
      scopeId?: string;
      query?: string;
      tags?: string[];
      limit?: number;
    }) => Promise<
      Envelope<{
        scope: MemoryScope;
        scopeId: string | null;
        memories: MemoryEntry[];
      }>
    >;
    park: (sessionId: string) => Promise<Envelope<{ parked: boolean }>>;
    resume: (sessionId: string) => Promise<Envelope<{ resumed: boolean }>>;
    close: (
      sessionId: string,
      opts?: {
        consolidate?: boolean;
        events?: unknown[];
        scope?: MemoryScope;
        scopeId?: string;
      },
    ) => Promise<Envelope<{ closed: boolean; consolidation: unknown }>>;
    usage: (opts?: { sessionId?: string }) => Promise<Envelope<UsageSummary>>;
    subscribe: (filter?: {
      events?: string[];
    }) => Promise<Envelope<{ subscribed: boolean; events: string[] }>>;
    onEvent: (
      handler: (event: { type: string; session: unknown }) => void,
    ) => () => void;
  };
  memory: {
    store: (entry: Omit<MemoryEntry, "id">) => Promise<Envelope<MemoryEntry>>;
    recall: (query: {
      query?: string;
      scope?: MemoryScope;
      scopeId?: string;
      tags?: string[];
      limit?: number;
    }) => Promise<Envelope<MemoryEntry[]>>;
    delete: (id: string) => Promise<Envelope<{ deleted: boolean }>>;
    consolidate: (opts: {
      sessionId: string;
      agentId?: string;
      scope?: MemoryScope;
      scopeId?: string;
      events: unknown[];
    }) => Promise<
      Envelope<{
        writtenCount: number;
        eventCount: number;
        written: MemoryEntry[];
      }>
    >;
  };
  agent: {
    streamStart: (opts: { streamId: string; source: unknown }) => Promise<
      Envelope<{
        streamId: string;
        eventCount: number;
        events: StreamEvent[];
      }>
    >;
    streamCancel: (
      streamId: string,
    ) => Promise<Envelope<{ cancelled: boolean }>>;
    onStreamEvent: (
      handler: (streamId: string, event: StreamEvent) => void,
    ) => () => void;
  };
  beta: {
    list: () => Promise<Envelope<BetaFlagEntry[]>>;
    enable: (
      flag: string,
    ) => Promise<Envelope<{ flag: string; enabled: true }>>;
    disable: (
      flag: string,
    ) => Promise<Envelope<{ flag: string; enabled: false }>>;
  };
}

function unwrap<T>(env: Envelope<T>): T {
  if (!env.ok) throw new Error((env as { ok: false; error: string }).error);
  return (env as { ok: true; data: T }).data;
}

function getSessionCoreAPI(): SessionCoreAPI {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (window as any).electronAPI?.sessionCore;
}

export const useSessionCoreStore = defineStore("sessionCore", () => {
  const api = () => getSessionCoreAPI();

  const sessions = ref<SessionSummary[]>([]);
  const memories = ref<MemoryEntry[]>([]);
  const betaFlags = ref<BetaFlagEntry[]>([]);
  const streams = ref<Map<string, StreamEvent[]>>(new Map());
  const usageSummary = ref<UsageSummary | null>(null);
  const lastError = ref<string | null>(null);

  let streamUnsubscribe: (() => void) | null = null;

  function ensureStreamListener() {
    if (streamUnsubscribe) return;
    streamUnsubscribe = api().agent.onStreamEvent((streamId, event) => {
      const buf = streams.value.get(streamId) || [];
      buf.push(event);
      streams.value.set(streamId, buf);
    });
  }

  async function call<T>(fn: () => Promise<Envelope<T>>): Promise<T | null> {
    try {
      return unwrap(await fn());
    } catch (e) {
      lastError.value = (e as Error).message;
      return null;
    }
  }

  // Policy
  const getPolicy = (sessionId: string) =>
    call(() => api().policy.get(sessionId));
  const setPolicy = (sessionId: string, policy: ApprovalPolicy) =>
    call(() => api().policy.set(sessionId, policy));
  const clearPolicy = (sessionId: string) =>
    call(() => api().policy.clear(sessionId));

  // Session lifecycle
  async function refreshSessions(filter?: {
    agentId?: string;
    status?: string;
  }) {
    const res = await call(() => api().session.list(filter));
    if (res) sessions.value = res;
    return res;
  }
  const showSession = (sessionId: string) =>
    call(() => api().session.show(sessionId));
  const createSession = (opts: {
    agentId: string;
    approvalPolicy?: ApprovalPolicy;
    metadata?: unknown;
    sessionId?: string;
  }) => call(() => api().session.create(opts));
  const recallOnStart = (opts: {
    agentId: string;
    scope?: MemoryScope;
    scopeId?: string;
    query?: string;
    tags?: string[];
    limit?: number;
  }) => call(() => api().session.recallOnStart(opts));
  const parkSession = (sessionId: string) =>
    call(() => api().session.park(sessionId));
  const resumeSession = (sessionId: string) =>
    call(() => api().session.resume(sessionId));
  const closeSession = (
    sessionId: string,
    opts?: {
      consolidate?: boolean;
      events?: unknown[];
      scope?: MemoryScope;
      scopeId?: string;
    },
  ) => call(() => api().session.close(sessionId, opts));

  // Memory
  const storeMemory = (entry: Omit<MemoryEntry, "id">) =>
    call(() => api().memory.store(entry));
  async function recallMemory(query: {
    query?: string;
    scope?: MemoryScope;
    scopeId?: string;
    tags?: string[];
    limit?: number;
  }) {
    const res = await call(() => api().memory.recall(query));
    if (res) memories.value = res;
    return res;
  }
  const deleteMemory = (id: string) => call(() => api().memory.delete(id));
  const consolidateMemory = (opts: {
    sessionId: string;
    agentId?: string;
    scope?: MemoryScope;
    scopeId?: string;
    events: unknown[];
  }) => call(() => api().memory.consolidate(opts));

  // Agent stream
  function startStream(streamId: string, source: unknown) {
    ensureStreamListener();
    streams.value.set(streamId, []);
    return call(() => api().agent.streamStart({ streamId, source }));
  }
  const cancelStream = (streamId: string) =>
    call(() => api().agent.streamCancel(streamId));
  function getStreamEvents(streamId: string) {
    return streams.value.get(streamId) || [];
  }

  // Usage
  async function refreshUsage(opts?: { sessionId?: string }) {
    const res = await call(() => api().session.usage(opts));
    if (res) usageSummary.value = res;
    return res;
  }

  // Beta flags
  async function refreshBetaFlags() {
    const res = await call(() => api().beta.list());
    if (res) betaFlags.value = res;
    return res;
  }
  const enableBeta = async (flag: string) => {
    const r = await call(() => api().beta.enable(flag));
    if (r) await refreshBetaFlags();
    return r;
  };
  const disableBeta = async (flag: string) => {
    const r = await call(() => api().beta.disable(flag));
    if (r) await refreshBetaFlags();
    return r;
  };

  function dispose() {
    streamUnsubscribe?.();
    streamUnsubscribe = null;
  }

  return {
    sessions,
    memories,
    betaFlags,
    streams,
    usageSummary,
    lastError,
    getPolicy,
    setPolicy,
    clearPolicy,
    refreshSessions,
    showSession,
    createSession,
    recallOnStart,
    parkSession,
    resumeSession,
    closeSession,
    storeMemory,
    recallMemory,
    deleteMemory,
    consolidateMemory,
    refreshUsage,
    startStream,
    cancelStream,
    getStreamEvents,
    refreshBetaFlags,
    enableBeta,
    disableBeta,
    dispose,
  };
});
