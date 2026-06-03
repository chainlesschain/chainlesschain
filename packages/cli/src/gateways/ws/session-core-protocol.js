/**
 * Hosted Session API — Phase I of Managed Agents parity plan.
 *
 * Exposes session-core singletons (SessionManager, MemoryStore, BetaFlags,
 * ApprovalGate) and usage/consolidate helpers over the CLI WebSocket gateway
 * so IDE plugins / web panels / automation scripts can drive them remotely.
 *
 * Route keys use dot-case (`sessions.list`, `memory.recall`) for parity with
 * the service-envelope protocol. Each handler is an async function of
 * `(message)` that returns `{ ok: true, ... }` or `{ ok: false, error }` —
 * the dispatcher wraps the response into the legacy flat WS shape.
 */

function ok(data = {}) {
  return { ok: true, ...data };
}
function fail(code, message) {
  return { ok: false, error: { code, message } };
}

async function loadSingletons() {
  return import("../../lib/session-core-singletons.js");
}

async function sessionsList(message) {
  const { getSessionManager } = await loadSingletons();
  const mgr = getSessionManager();
  const live = mgr.list({
    agentId: message.agentId,
    status: message.status,
  });
  let parked = [];
  if (mgr._parkedStore) {
    const all = await mgr._parkedStore.list();
    parked = all
      .filter((s) => !message.agentId || s.agentId === message.agentId)
      .filter((s) => !message.status || s.status === message.status);
  }
  const seen = new Set(live.map((h) => h.sessionId));
  const merged = [
    ...live.map((h) => h.toJSON()),
    ...parked.filter((p) => !seen.has(p.sessionId)),
  ];
  return ok({ sessions: merged });
}

async function sessionsShow(message) {
  if (!message.sessionId) return fail("BAD_REQUEST", "sessionId required");
  const { getSessionManager } = await loadSingletons();
  const mgr = getSessionManager();
  const handle = mgr.get(message.sessionId);
  if (!handle) {
    if (mgr._parkedStore) {
      const all = await mgr._parkedStore.list();
      const parked = all.find((p) => p.sessionId === message.sessionId);
      if (parked) return ok({ session: parked, source: "parked" });
    }
    return fail("NOT_FOUND", `Session ${message.sessionId} not found`);
  }
  return ok({ session: handle.toJSON(), source: "live" });
}

async function sessionsPark(message) {
  if (!message.sessionId) return fail("BAD_REQUEST", "sessionId required");
  const { getSessionManager } = await loadSingletons();
  const mgr = getSessionManager();
  if (!mgr.has(message.sessionId)) {
    return fail("NOT_ACTIVE", `Session ${message.sessionId} is not active`);
  }
  try {
    mgr.markIdle(message.sessionId);
  } catch (_e) {
    /* already idle is fine */
  }
  const parked = await mgr.park(message.sessionId);
  return parked
    ? ok({ sessionId: message.sessionId, parked: true })
    : fail("PARK_FAILED", "Failed to park session");
}

async function sessionsUnpark(message) {
  if (!message.sessionId) return fail("BAD_REQUEST", "sessionId required");
  const { getSessionManager } = await loadSingletons();
  const mgr = getSessionManager();
  const resumed = await mgr.resume(message.sessionId);
  return resumed
    ? ok({ sessionId: message.sessionId, resumed: true })
    : fail("NOT_FOUND", `No parked session ${message.sessionId}`);
}

async function sessionsEnd(message) {
  if (!message.sessionId) return fail("BAD_REQUEST", "sessionId required");
  const { getSessionManager } = await loadSingletons();
  let consolidated = null;
  if (message.consolidate) {
    try {
      const { consolidateJsonlSession } =
        await import("../../lib/session-consolidator.js");
      consolidated = await consolidateJsonlSession(message.sessionId, {
        scope: message.scope || "session",
        scopeId: message.scopeId || null,
        agentId: message.agentId || null,
      });
    } catch (e) {
      return fail("CONSOLIDATE_FAILED", e.message);
    }
  }
  const mgr = getSessionManager();
  const closed = await mgr.close(message.sessionId);
  if (!closed && mgr._parkedStore) {
    await mgr._parkedStore.remove(message.sessionId);
  }
  return ok({
    sessionId: message.sessionId,
    closed: true,
    consolidated,
  });
}

async function sessionsPolicyGet(message) {
  if (!message.sessionId) return fail("BAD_REQUEST", "sessionId required");
  const { getApprovalGate } = await loadSingletons();
  const gate = await getApprovalGate();
  return ok({
    sessionId: message.sessionId,
    policy: gate.getSessionPolicy(message.sessionId),
  });
}

async function sessionsPolicySet(message) {
  if (!message.sessionId) return fail("BAD_REQUEST", "sessionId required");
  if (!message.policy) return fail("BAD_REQUEST", "policy required");
  const { getApprovalGate } = await loadSingletons();
  const gate = await getApprovalGate();
  try {
    gate.setSessionPolicy(message.sessionId, message.policy);
  } catch (e) {
    return fail("INVALID_POLICY", e.message);
  }
  await new Promise((r) => setImmediate(r));
  return ok({
    sessionId: message.sessionId,
    policy: gate.getSessionPolicy(message.sessionId),
  });
}

async function memoryStore(message) {
  if (!message.content) return fail("BAD_REQUEST", "content required");
  const { getMemoryStore } = await loadSingletons();
  const store = getMemoryStore();
  const entry = store.add({
    scope: message.scope || "global",
    scopeId: message.scopeId,
    agentId: message.agentId,
    category: message.category,
    content: message.content,
    tags: message.tags || [],
    metadata: message.metadata || {},
  });
  await new Promise((r) => setImmediate(r));
  return ok({ entry });
}

async function memoryRecall(message) {
  const { getMemoryStore } = await loadSingletons();
  const store = getMemoryStore();
  const results = store.recall({
    query: message.query || null,
    scope: message.scope,
    scopeId: message.scopeId,
    agentId: message.agentId,
    tags: message.tags,
    category: message.category,
    limit: message.limit,
  });
  return ok({ results });
}

async function memoryDelete(message) {
  if (!message.id) return fail("BAD_REQUEST", "id required");
  const { getMemoryStore } = await loadSingletons();
  const store = getMemoryStore();
  const entry = store.get(message.id);
  if (!entry) return fail("NOT_FOUND", `Memory ${message.id} not found`);
  store.remove(message.id);
  await new Promise((r) => setImmediate(r));
  return ok({ id: message.id, deleted: true });
}

async function memoryConsolidate(message) {
  if (!message.sessionId) return fail("BAD_REQUEST", "sessionId required");
  try {
    const { consolidateJsonlSession } =
      await import("../../lib/session-consolidator.js");
    const result = await consolidateJsonlSession(message.sessionId, {
      scope: message.scope || "session",
      scopeId: message.scopeId || null,
      agentId: message.agentId || null,
      dryRun: Boolean(message.dryRun),
    });
    return ok({ result });
  } catch (e) {
    return fail("CONSOLIDATE_FAILED", e.message);
  }
}

async function betaList() {
  const { getBetaFlags } = await loadSingletons();
  const flags = await getBetaFlags();
  return ok({ flags: flags.list() });
}

async function betaEnable(message) {
  if (!message.flag) return fail("BAD_REQUEST", "flag required");
  const { getBetaFlags } = await loadSingletons();
  const flags = await getBetaFlags();
  try {
    flags.enable(message.flag);
  } catch (e) {
    return fail("INVALID_FLAG", e.message);
  }
  await new Promise((r) => setImmediate(r));
  return ok({ flag: message.flag, enabled: true });
}

async function betaDisable(message) {
  if (!message.flag) return fail("BAD_REQUEST", "flag required");
  const { getBetaFlags } = await loadSingletons();
  const flags = await getBetaFlags();
  flags.disable(message.flag);
  await new Promise((r) => setImmediate(r));
  return ok({ flag: message.flag, enabled: false });
}

async function usageSession(message) {
  if (!message.sessionId) return fail("BAD_REQUEST", "sessionId required");
  const { sessionUsage } = await import("../../lib/session-usage.js");
  return ok({ usage: sessionUsage(message.sessionId) });
}

async function usageGlobal(message) {
  const { allSessionsUsage } = await import("../../lib/session-usage.js");
  return ok({
    usage: allSessionsUsage({ limit: message.limit || 1000 }),
  });
}

/**
 * Streaming handler — unlike the request/response handlers above, this takes
 * `(message, sender, signal)` where `sender({type, ...})` emits intermediate
 * events. Returns a final `{ok, ...}` object which the dispatcher wraps into
 * the terminal `stream.run.end` response.
 *
 * Events emitted via `sender`:
 *   { type: "stream.event", event: <StreamEvent> }
 *
 * On error: rejects — dispatcher sends terminal error envelope.
 */
async function streamRun(message, sender, signal, context) {
  if (!message.prompt) return fail("BAD_REQUEST", "prompt required");
  const provider = message.provider || "ollama";
  const { buildProviderSource } = await import("../../lib/provider-stream.js");
  const { createStreamRouter } = await loadSingletons();
  const router = createStreamRouter();
  const source = buildProviderSource(provider, {
    model: message.model,
    baseUrl: message.baseUrl,
    apiKey: message.apiKey,
    prompt: message.prompt,
    signal,
  });

  let envelopeHelper = null;
  if (context?.server?.envelopeBus && message.sessionId) {
    try {
      const { createRequire } = await import("node:module");
      const require_ = createRequire(import.meta.url);
      const { envelopeFromStreamEvent } = require_(
        "@chainlesschain/session-core",
      );
      envelopeHelper = (ev) => {
        try {
          const env = envelopeFromStreamEvent(ev, {
            sessionId: message.sessionId,
            runId: message.runId || message.id,
          });
          if (env) context.server.envelopeBus.publish(message.sessionId, env);
        } catch (_e) {
          /* best-effort */
        }
      };
    } catch (_e) {
      /* session-core unavailable — skip */
    }
  }

  let text = "";
  let errored = false;
  let errorMsg = null;
  for await (const ev of router.stream(source)) {
    if (signal?.aborted) break;
    sender({ type: "stream.event", event: ev });
    envelopeHelper?.(ev);
    if (ev.type === "token" && typeof ev.text === "string") text += ev.text;
    if (ev.type === "message" && typeof ev.text === "string") text = ev.text;
    if (ev.type === "error") {
      errored = true;
      errorMsg = ev.error?.message || ev.error || "stream error";
    }
  }
  if (errored) return fail("STREAM_ERROR", errorMsg);
  return ok({ text });
}

/**
 * Streaming handler — subscribes to SessionManager lifecycle events and
 * forwards them as `stream.event` envelopes until the client aborts.
 *
 * Events forwarded:
 *   { type: "stream.event", event: { type: "session.<lifecycle>", session } }
 *
 * Where `<lifecycle>` is one of:
 *   created | adopted | touched | idle | parked | resumed | closed
 *
 * Client sends `{type:"cancel", id}` to unsubscribe.
 */
async function sessionsSubscribe(message, sender, signal, _context) {
  const { getSessionManager } = await loadSingletons();
  const mgr = getSessionManager();

  const LIFECYCLE_EVENTS = [
    "created",
    "adopted",
    "touched",
    "idle",
    "parked",
    "resumed",
    "closed",
  ];
  const requested =
    Array.isArray(message.events) && message.events.length
      ? message.events.filter((e) => LIFECYCLE_EVENTS.includes(e))
      : LIFECYCLE_EVENTS;

  const listeners = [];
  const forward = (lifecycle) => (handle) => {
    try {
      sender({
        type: "stream.event",
        event: {
          type: `session.${lifecycle}`,
          session: handle?.toJSON ? handle.toJSON() : handle,
        },
      });
    } catch {
      /* sender may throw if WS closed — ignore */
    }
  };
  for (const ev of requested) {
    const fn = forward(ev);
    mgr.on(ev, fn);
    listeners.push([ev, fn]);
  }

  // Wait for abort — then detach listeners.
  await new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    signal?.addEventListener("abort", resolve, { once: true });
  });
  for (const [ev, fn] of listeners) mgr.off(ev, fn);
  return ok({ unsubscribed: true, events: requested });
}

export const SESSION_CORE_STREAMING_HANDLERS = {
  "stream.run": streamRun,
  "sessions.subscribe": sessionsSubscribe,
};

export const SESSION_CORE_HANDLERS = {
  "sessions.list": sessionsList,
  "sessions.show": sessionsShow,
  "sessions.park": sessionsPark,
  "sessions.unpark": sessionsUnpark,
  "sessions.end": sessionsEnd,
  "sessions.policy.get": sessionsPolicyGet,
  "sessions.policy.set": sessionsPolicySet,
  "memory.store": memoryStore,
  "memory.recall": memoryRecall,
  "memory.delete": memoryDelete,
  "memory.consolidate": memoryConsolidate,
  "beta.list": betaList,
  "beta.enable": betaEnable,
  "beta.disable": betaDisable,
  "usage.session": usageSession,
  "usage.global": usageGlobal,
};

/**
 * Attach session-core routes onto a dispatcher's routes object. Each route
 * invokes the handler and sends a flat WS response keyed by the inbound `id`.
 *
 *   routes["sessions.list"] = () => ...
 *
 * The dispatcher already handles auth + unknown-type fallback.
 */
export function attachSessionCoreRoutes(routes, server) {
  for (const [type, handler] of Object.entries(SESSION_CORE_HANDLERS)) {
    routes[type] = async (message, ws) => {
      try {
        const result = await handler(message);
        server._send(ws, {
          id: message.id,
          type: `${type}.response`,
          ...result,
        });
      } catch (err) {
        server._send(ws, {
          id: message.id,
          type: "error",
          code: "SESSION_CORE_ERROR",
          message: err?.message || String(err),
        });
      }
    };
  }
  return routes;
}
