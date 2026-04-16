/**
 * Desktop session-core IPC — thin wrappers around the singleton
 * MemoryStore / BetaFlags / ApprovalGate that mirror the CLI surface so the
 * renderer can drive exactly the same semantics as `chainlesschain memory`,
 * `chainlesschain session policy`, `chainlesschain config beta`.
 *
 * Channels (Managed Agents parity Phase H):
 *   session:policy:get        (sessionId)          → { sessionId, policy, default }
 *   session:policy:set        (sessionId, policy)  → { sessionId, policy }
 *   session:policy:clear      (sessionId)          → { cleared }
 *
 *   memory:store              (opts)               → record
 *   memory:recall             (opts)               → records[]
 *   memory:delete             (id)                 → { deleted }
 *
 *   beta:list                                       → [{ flag, enabled }]
 *   beta:enable               (flag)                → { flag, enabled: true }
 *   beta:disable              (flag)                → { flag, enabled: false }
 *
 * Deep Agents Deploy — Desktop bundle parity:
 *   bundle:load               ({bundlePath, sessionId?, userId?}) → { bundle, resolved, loadedAt }
 *   bundle:info                                     → cached bundle info | null
 *   bundle:unload                                   → { unloaded }
 *
 * Error shape: `{ ok: false, error: string }`. Success shape:
 * `{ ok: true, data: <result> }`. Renderer stores can rely on `ok` as the
 * discriminator without having to catch rejected promises.
 */

const {
  getMemoryStore,
  getBetaFlags,
  getApprovalGate,
  getSessionManager,
} = require("./session-core-singletons.js");

const {
  APPROVAL_POLICY,
  TraceStore,
  TRACE_TYPES,
  MemoryConsolidator,
  StreamRouter,
  loadBundle,
  resolveBundle,
} = require("@chainlesschain/session-core");

function buildTraceStoreFromEvents(sessionId, events) {
  const trace = new TraceStore();
  for (const ev of events || []) {
    if (!ev || !ev.type) {
      continue;
    }
    const ts = ev.timestamp || ev.ts || Date.now();
    const d = ev.data || ev.payload || {};
    switch (ev.type) {
      case "user_message":
        trace.record({
          sessionId,
          type: TRACE_TYPES.MESSAGE,
          ts,
          payload: { role: "user", content: d.content || "" },
        });
        break;
      case "assistant_message":
        trace.record({
          sessionId,
          type: TRACE_TYPES.MESSAGE,
          ts,
          payload: { role: "assistant", content: d.content || "" },
        });
        break;
      case "tool_call":
        trace.record({
          sessionId,
          type: TRACE_TYPES.TOOL_CALL,
          ts,
          payload: { tool: d.tool, args: d.args },
        });
        break;
      case "tool_result": {
        const raw = d.result;
        const ok = !(raw && typeof raw === "object" && raw.error);
        const summary =
          typeof raw === "string"
            ? raw
            : raw && typeof raw === "object"
              ? raw.summary || raw.message || null
              : null;
        trace.record({
          sessionId,
          type: TRACE_TYPES.TOOL_RESULT,
          ts,
          payload: { tool: d.tool, ok, summary, result: raw },
        });
        break;
      }
      case "error":
        trace.record({
          sessionId,
          type: TRACE_TYPES.ERROR,
          ts,
          payload: { error: d.error || d.message || "" },
        });
        break;
      default:
        break;
    }
  }
  return trace;
}

const VALID_POLICIES = new Set(Object.values(APPROVAL_POLICY));

function ok(data) {
  return { ok: true, data };
}

function err(message) {
  return { ok: false, error: message };
}

/**
 * Register all session-core IPC handlers on the provided ipcMain instance.
 * Accepting ipcMain as a parameter lets unit tests pass a mock without
 * loading Electron.
 */
function registerSessionCoreIpc(ipcMain) {
  if (!ipcMain || typeof ipcMain.handle !== "function") {
    throw new Error("registerSessionCoreIpc: ipcMain.handle required");
  }

  // ── session:policy ─────────────────────────────────────────────────
  ipcMain.handle("session:policy:get", async (_e, sessionId) => {
    if (!sessionId) {
      return err("sessionId required");
    }
    try {
      const gate = await getApprovalGate();
      return ok({
        sessionId,
        policy: gate.getSessionPolicy(sessionId),
        default: gate._default || null,
      });
    } catch (e) {
      return err(e.message);
    }
  });

  ipcMain.handle("session:policy:set", async (_e, sessionId, policy) => {
    if (!sessionId) {
      return err("sessionId required");
    }
    if (!VALID_POLICIES.has(policy)) {
      return err(`invalid policy "${policy}"`);
    }
    try {
      const gate = await getApprovalGate();
      gate.setSessionPolicy(sessionId, policy);
      return ok({ sessionId, policy });
    } catch (e) {
      return err(e.message);
    }
  });

  ipcMain.handle("session:policy:clear", async (_e, sessionId) => {
    if (!sessionId) {
      return err("sessionId required");
    }
    try {
      const gate = await getApprovalGate();
      return ok({ cleared: gate.clearSessionPolicy(sessionId) });
    } catch (e) {
      return err(e.message);
    }
  });

  // ── session lifecycle ──────────────────────────────────────────────
  ipcMain.handle("session:list", async (_e, filter) => {
    try {
      const mgr = getSessionManager();
      const handles = mgr.list(filter || {});
      return ok(
        handles.map((h) => ({
          sessionId: h.sessionId,
          agentId: h.agentId,
          status: h.status,
          createdAt: h.createdAt,
          lastTouchedAt: h.lastTouchedAt,
          metadata: h.metadata || null,
        })),
      );
    } catch (e) {
      return err(e.message);
    }
  });

  ipcMain.handle("session:show", async (_e, sessionId) => {
    if (!sessionId) {
      return err("sessionId required");
    }
    try {
      const mgr = getSessionManager();
      const h = mgr.get(sessionId);
      if (!h) {
        return err(`session not found: ${sessionId}`);
      }
      return ok({
        sessionId: h.sessionId,
        agentId: h.agentId,
        status: h.status,
        createdAt: h.createdAt,
        lastTouchedAt: h.lastTouchedAt,
        metadata: h.metadata || null,
        usage: mgr.usage(sessionId),
      });
    } catch (e) {
      return err(e.message);
    }
  });

  ipcMain.handle("session:create", async (_e, opts) => {
    if (!opts || typeof opts !== "object") {
      return err("opts required");
    }
    if (!opts.agentId) {
      return err("agentId required");
    }
    try {
      const mgr = getSessionManager();
      const h = mgr.create({
        agentId: opts.agentId,
        approvalPolicy: opts.approvalPolicy,
        metadata: opts.metadata,
        sessionId: opts.sessionId,
      });
      return ok({
        sessionId: h.sessionId,
        agentId: h.agentId,
        status: h.status,
      });
    } catch (e) {
      return err(e.message);
    }
  });

  // Recall memories to seed a new session's system prompt context.
  // Defaults: scope=agent, scopeId=agentId, limit=5 — mirrors CLI `agent --recall-limit`.
  ipcMain.handle("session:recall-on-start", async (_e, opts) => {
    if (!opts || typeof opts !== "object") {
      return err("opts required");
    }
    const { agentId, scope, scopeId, query, tags, limit } = opts;
    if (!agentId) {
      return err("agentId required");
    }
    try {
      const store = getMemoryStore();
      const resolvedScope = scope || "agent";
      const resolvedScopeId =
        scopeId || (resolvedScope === "agent" ? agentId : null);
      const recalled = store.recall({
        query: query || "",
        scope: resolvedScope,
        scopeId: resolvedScopeId,
        tags,
        limit: typeof limit === "number" ? limit : 5,
      });
      return ok({
        scope: resolvedScope,
        scopeId: resolvedScopeId,
        memories: recalled,
      });
    } catch (e) {
      return err(e.message);
    }
  });

  ipcMain.handle("session:park", async (_e, sessionId) => {
    if (!sessionId) {
      return err("sessionId required");
    }
    try {
      const mgr = getSessionManager();
      const parked = await mgr.park(sessionId);
      return ok({ parked });
    } catch (e) {
      return err(e.message);
    }
  });

  ipcMain.handle("session:resume", async (_e, sessionId) => {
    if (!sessionId) {
      return err("sessionId required");
    }
    try {
      const mgr = getSessionManager();
      const resumed = await mgr.resume(sessionId);
      return ok({ resumed });
    } catch (e) {
      return err(e.message);
    }
  });

  ipcMain.handle("session:close", async (_e, sessionId, opts) => {
    if (!sessionId) {
      return err("sessionId required");
    }
    try {
      const mgr = getSessionManager();
      const handle = mgr.get(sessionId);
      let consolidation = null;
      if (opts && opts.consolidate && Array.isArray(opts.events) && handle) {
        try {
          const store = getMemoryStore();
          const trace = buildTraceStoreFromEvents(sessionId, opts.events);
          const consolidator = new MemoryConsolidator({
            memoryStore: store,
            traceStore: trace,
            scope: opts.scope || "agent",
          });
          consolidation = await consolidator.consolidate(
            { sessionId, agentId: handle.agentId },
            { scope: opts.scope, scopeId: opts.scopeId },
          );
        } catch (ce) {
          consolidation = { error: ce.message };
        }
      }
      const closed = await mgr.close(sessionId);
      return ok({ closed, consolidation });
    } catch (e) {
      return err(e.message);
    }
  });

  // ── memory ─────────────────────────────────────────────────────────
  ipcMain.handle("memory:store", async (_e, entry) => {
    if (!entry || typeof entry !== "object") {
      return err("entry required");
    }
    try {
      const store = getMemoryStore();
      return ok(store.add(entry));
    } catch (e) {
      return err(e.message);
    }
  });

  ipcMain.handle("memory:recall", async (_e, query) => {
    try {
      const store = getMemoryStore();
      return ok(store.recall(query || {}));
    } catch (e) {
      return err(e.message);
    }
  });

  ipcMain.handle("memory:delete", async (_e, id) => {
    if (!id) {
      return err("id required");
    }
    try {
      const store = getMemoryStore();
      return ok({ deleted: store.remove(id) });
    } catch (e) {
      return err(e.message);
    }
  });

  ipcMain.handle("memory:consolidate", async (_e, opts) => {
    if (!opts || typeof opts !== "object") {
      return err("opts required");
    }
    const { sessionId, agentId, scope, scopeId, events } = opts;
    if (!sessionId) {
      return err("sessionId required");
    }
    if (!Array.isArray(events)) {
      return err("events array required");
    }
    try {
      const store = getMemoryStore();
      const trace = buildTraceStoreFromEvents(sessionId, events);
      const consolidator = new MemoryConsolidator({
        memoryStore: store,
        traceStore: trace,
        scope: scope || "agent",
      });
      const result = await consolidator.consolidate(
        { sessionId, agentId: agentId || sessionId },
        { scope, scopeId },
      );
      return ok(result);
    } catch (e) {
      return err(e.message);
    }
  });

  // ── agent stream (StreamRouter-normalized events) ──────────────────
  // Accepts { streamId, source } where source is string | {message} | {error}
  // | async-iterable-spec { tokens: string[] }. Pushes normalized StreamEvents
  // back to the caller's sender via channel "agent:stream:event" with
  // (streamId, event) args. Returns when the stream ends.
  const _activeStreams = new Map(); // streamId → AbortController
  ipcMain.handle("agent:stream:start", async (event, opts) => {
    if (!opts || typeof opts !== "object") {
      return err("opts required");
    }
    const { streamId, source } = opts;
    if (!streamId) {
      return err("streamId required");
    }
    if (_activeStreams.has(streamId)) {
      return err(`duplicate streamId ${streamId}`);
    }

    const sender = event?.sender;
    const send =
      sender && typeof sender.send === "function"
        ? (ev) => sender.send("agent:stream:event", streamId, ev)
        : null;
    const ac = new AbortController();
    _activeStreams.set(streamId, ac);

    const normalizedSource = (() => {
      if (
        source &&
        typeof source === "object" &&
        Array.isArray(source.tokens)
      ) {
        return (async function* () {
          for (const t of source.tokens) {
            if (ac.signal.aborted) {
              return;
            }
            yield { type: "token", text: String(t) };
          }
        })();
      }
      return source;
    })();

    try {
      const router = new StreamRouter();
      const events = [];
      for await (const ev of router.stream(normalizedSource)) {
        if (ac.signal.aborted) {
          break;
        }
        events.push(ev);
        if (send) {
          send(ev);
        }
      }
      return ok({ streamId, eventCount: events.length, events });
    } catch (e) {
      return err(e.message);
    } finally {
      _activeStreams.delete(streamId);
    }
  });

  ipcMain.handle("agent:stream:cancel", async (_e, streamId) => {
    if (!streamId) {
      return err("streamId required");
    }
    const ac = _activeStreams.get(streamId);
    if (!ac) {
      return ok({ cancelled: false });
    }
    ac.abort();
    _activeStreams.delete(streamId);
    return ok({ cancelled: true });
  });

  // ── session:usage — aggregate session-hour metrics ──────────────
  ipcMain.handle("session:usage", async (_e, opts) => {
    try {
      const mgr = getSessionManager();
      if (opts?.sessionId) {
        const u = mgr.usage(opts.sessionId);
        if (!u) {
          return err(`session not found: ${opts.sessionId}`);
        }
        return ok(u);
      }
      return ok({
        total: mgr.usageTotal(),
        byAgent: mgr.usageByAgent(),
      });
    } catch (e) {
      return err(e.message);
    }
  });

  // ── session:subscribe — lifecycle events broadcast to renderer ──
  const LIFECYCLE_EVENTS = [
    "created",
    "adopted",
    "touched",
    "idle",
    "parked",
    "resumed",
    "closed",
  ];

  ipcMain.handle("session:subscribe", async (ipcEvent, filter) => {
    const wc = ipcEvent?.sender;
    if (!wc || typeof wc.send !== "function") {
      return err("no sender");
    }
    try {
      const mgr = getSessionManager();
      const requested =
        Array.isArray(filter?.events) && filter.events.length
          ? filter.events.filter((e) => LIFECYCLE_EVENTS.includes(e))
          : LIFECYCLE_EVENTS;

      const listeners = [];
      for (const ev of requested) {
        const fn = (handle) => {
          try {
            wc.send("session:event", {
              type: `session.${ev}`,
              session: handle?.toJSON ? handle.toJSON() : handle,
            });
          } catch (_e) {
            /* webContents may be destroyed */
          }
        };
        mgr.on(ev, fn);
        listeners.push([ev, fn]);
      }

      const cleanup = () => {
        for (const [e, fn] of listeners) {
          mgr.off(e, fn);
        }
      };
      if (wc.once) {
        wc.once("destroyed", cleanup);
      }

      return ok({ subscribed: true, events: requested });
    } catch (e) {
      return err(e.message);
    }
  });

  // ── beta flags ─────────────────────────────────────────────────────
  ipcMain.handle("beta:list", async () => {
    try {
      const flags = await getBetaFlags();
      const { enabled, known } = flags.list();
      const enabledSet = new Set(enabled);
      const union = Array.from(new Set([...(known || []), ...enabled])).sort();
      return ok(union.map((flag) => ({ flag, enabled: enabledSet.has(flag) })));
    } catch (e) {
      return err(e.message);
    }
  });

  ipcMain.handle("beta:enable", async (_e, flag) => {
    if (!flag) {
      return err("flag required");
    }
    try {
      const flags = await getBetaFlags();
      await flags.enable(flag);
      return ok({ flag, enabled: true });
    } catch (e) {
      return err(e.message);
    }
  });

  ipcMain.handle("beta:disable", async (_e, flag) => {
    if (!flag) {
      return err("flag required");
    }
    try {
      const flags = await getBetaFlags();
      await flags.disable(flag);
      return ok({ flag, enabled: false });
    } catch (e) {
      return err(e.message);
    }
  });

  // ── bundle (Deep Agents Deploy — Desktop parity) ─────────────────
  // Caches the currently-loaded bundle so bundle:info can retrieve it
  // without re-reading disk. Only one bundle can be active at a time.
  let _loadedBundle = null; // { bundle, resolved, loadedAt }

  ipcMain.handle("bundle:load", async (_e, opts) => {
    if (!opts || typeof opts !== "object") {
      return err("opts required");
    }
    const { bundlePath, sessionId, userId } = opts;
    if (!bundlePath || typeof bundlePath !== "string") {
      return err("bundlePath required");
    }
    try {
      const bundle = loadBundle(bundlePath);
      const store = getMemoryStore();
      const resolved = resolveBundle(bundle, {
        memoryStore: store,
        seedOptions: { userId: userId || null },
      });

      // Apply approval policy to the session if both are provided
      if (
        sessionId &&
        resolved.approvalPolicy &&
        resolved.approvalPolicy.default
      ) {
        try {
          const gate = await getApprovalGate();
          gate.setSessionPolicy(sessionId, resolved.approvalPolicy.default);
        } catch (_apErr) {
          // non-fatal — approval policy application is best-effort
        }
      }

      _loadedBundle = {
        bundle: {
          path: bundle.path,
          manifest: bundle.manifest,
          hasAgentsMd: !!bundle.agentsMd,
          hasUserMd: !!bundle.userMd,
          hasMcpConfig: !!bundle.mcpConfig,
          hasApprovalPolicy: !!bundle.approvalPolicy,
          hasSandboxPolicy: !!bundle.sandboxPolicy,
          hasCapabilities: !!bundle.capabilities,
          hasSkillsDir: !!bundle.skillsDir,
          warnings: bundle.warnings,
        },
        resolved: {
          manifest: resolved.manifest,
          systemPrompt: resolved.systemPrompt,
          mcpConfig: resolved.mcpConfig,
          approvalPolicy: resolved.approvalPolicy,
          sandboxPolicy: resolved.sandboxPolicy,
          capabilities: resolved.capabilities,
          skillsDir: resolved.skillsDir,
          seedResult: resolved.seedResult,
          warnings: resolved.warnings,
        },
        loadedAt: Date.now(),
      };

      return ok(_loadedBundle);
    } catch (e) {
      return err(e.message);
    }
  });

  ipcMain.handle("bundle:info", async () => {
    if (!_loadedBundle) {
      return ok(null);
    }
    return ok(_loadedBundle);
  });

  ipcMain.handle("bundle:unload", async () => {
    const had = !!_loadedBundle;
    _loadedBundle = null;
    return ok({ unloaded: had });
  });

  return {
    channels: [
      "session:policy:get",
      "session:policy:set",
      "session:policy:clear",
      "session:list",
      "session:show",
      "session:create",
      "session:recall-on-start",
      "session:park",
      "session:resume",
      "session:close",
      "memory:store",
      "memory:recall",
      "memory:delete",
      "memory:consolidate",
      "agent:stream:start",
      "agent:stream:cancel",
      "session:usage",
      "session:subscribe",
      "beta:list",
      "beta:enable",
      "beta:disable",
      "bundle:load",
      "bundle:info",
      "bundle:unload",
    ],
  };
}

module.exports = { registerSessionCoreIpc };
