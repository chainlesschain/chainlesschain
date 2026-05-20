/**
 * Personal Data Hub — mobile P2P routing dispatcher (Phase 14.1.1 follow-up).
 *
 * Bridges Android's typed RemoteCommandClient.invoke("personal-data-hub.X", ...)
 * (over P2P DC / signaling relay) to the desktop hub singleton, mirroring the
 * dispatch surface of src/main/ipc/personal-data-hub-ipc.js but bypassing
 * Electron IPC (Android isn't a renderer process).
 *
 * Action names are kebab-case (matches both the IPC channels and the WS
 * protocol in packages/cli/src/gateways/ws/personal-data-hub-protocol.js).
 * Response shapes are wrapped to match Android's expected envelope per
 * PersonalDataHubCommands.kt models (e.g. raw `hub.registry.list()` array
 * → `{adapters: [...]}` matching `AdaptersResponse`).
 *
 * Stream methods (`sync-adapter-stream`, `sync-all-stream`) throw a
 * "not yet wired" error here — Phase 14.3 wires HubSyncEventDispatcher to
 * push progress events to the paired mobile peer.
 *
 * Used by index.js routeMobileCommand's `case "personal-data-hub":`.
 *
 * @module personal-data-hub/route-mobile
 */

"use strict";

const hubWiring = require("./wiring.js");

/**
 * action (kebab-case, no `personal-data-hub.` prefix) → async (hub, params) => result.
 * Each fn returns the value Android expects (already wrapped to match its
 * Codable models in PersonalDataHubCommands.kt).
 */
const DISPATCH = {
  ask: async (hub, p) => {
    if (!hub.engine) {
      throw new Error(
        "Analysis engine unavailable — LLM manager not initialized",
      );
    }
    return await hub.engine.ask(p.question, p.options || {});
  },

  stats: async (hub) => ({
    vault: hub.vault.stats(),
    adapters: hub.registry.list(),
    hubDir: hub.hubDir,
    llm: hub.llm ? { name: hub.llm.name, isLocal: hub.llm.isLocal } : null,
  }),

  health: async (hub) => ({
    vault: { ok: !!hub.vault.db, schemaVersion: hub.vault.schemaVersion() },
    llm: hub.llm
      ? { ok: true, isLocal: hub.llm.isLocal, name: hub.llm.name }
      : { ok: false, reason: "LLM manager unavailable" },
    kgSink: { ok: !!hub.kgSink },
    ragSink: { ok: !!hub.ragSink },
  }),

  // Android expects AdaptersResponse(adapters: [...])
  "list-adapters": async (hub) => ({ adapters: hub.registry.list() }),

  "sync-adapter": async (hub, p) =>
    await hub.registry.syncAdapter(p.name, p.options || {}),

  // Android expects SyncReportList(reports: [...])
  "sync-all": async (hub, p) => {
    const reports = await hub.registry.syncAll(p.options || {});
    return { reports: Array.isArray(reports) ? reports : [reports] };
  },

  "register-mock": async (hub, p) => {
    const a = hub.registerMockAdapter({
      name: p.name || "mock",
      count: typeof p.count === "number" ? p.count : 20,
      seed: typeof p.seed === "number" ? p.seed : 1,
    });
    return { name: a.name, version: a.version };
  },

  unregister: async (hub, p) => ({
    ok: hub.registry.unregister(p.name),
    removed: p.name,
  }),

  // Android expects EventsResponse(events: [...])
  "query-events": async (hub, p) => ({
    events: hub.vault.queryEvents({
      subtype: p.subtype,
      since: p.since,
      until: p.until,
      actor: p.actor,
      adapter: p.adapter,
      limit: p.limit,
    }),
  }),

  // Android expects AuditRowsResponse(rows: [...])
  "recent-audit": async (hub, p) => ({
    rows: hub.vault.queryAudit({
      since: p.since,
      action: p.action,
      limit: p.limit,
    }),
  }),

  "event-detail": async (hub, p) => hub.eventDetail(p.eventId),

  "test-email-auth": async (hub, p) =>
    await hub.testEmailAuth({ account: p.account }),

  "register-email": async (hub, p) =>
    await hub.registerEmailAdapter({ account: p.account, opts: p.opts || {} }),

  "unregister-email": async (hub, p) =>
    await hub.unregisterEmailAdapter(p.email),

  // Android expects EmailAccountsResponse(accounts: [...])
  "list-email-accounts": async (hub) => ({
    accounts: hub.listEmailAccounts(),
  }),

  "register-alipay": async (hub, p) =>
    await hub.registerAlipayAdapter({ account: p.account, opts: p.opts || {} }),

  "unregister-alipay": async (hub, p) =>
    await hub.unregisterAlipayAdapter(p.email),

  // Android expects AlipayAccountsResponse(accounts: [...])
  "list-alipay-accounts": async (hub) => ({
    accounts: hub.listAlipayAccounts(),
  }),

  "import-alipay-bill": async (hub, p) =>
    await hub.importAlipayBill({
      zipPath: p.zipPath,
      csvPath: p.csvPath,
      zipPassword: p.zipPassword,
    }),

  // Phase 14.3 — stream methods set hub.registry.onSyncEvent to forward
  // progress events to the paired mobile peer via ctx.sendEventToPeer,
  // then run sync in background (returns streamId immediately so caller
  // doesn't block on the multi-second sync). Final `done` or `error`
  // event terminates the stream and triggers VM lastReport update on
  // Android via HubSyncEventDispatcher.
  //
  // Concurrent-call limitation: hub.registry.onSyncEvent is a single
  // slot, so overlapping streams chain via local `original` capture.
  // If two adapters sync simultaneously the restore order may leak —
  // matches the existing IPC handler pattern in personal-data-hub-ipc.js.
  "sync-adapter-stream": async (hub, p, ctx) =>
    runSyncStream(hub, ctx, () => hub.registry.syncAdapter(p.name, p.options || {}), {
      adapter: p.name,
      streamIdPrefix: "pdh-sa",
    }),

  "sync-all-stream": async (hub, p, ctx) =>
    runSyncStream(hub, ctx, () => hub.registry.syncAll(p.options || {}), {
      adapter: "*",
      streamIdPrefix: "pdh-saa",
    }),
};

/**
 * Shared streaming helper for sync-adapter-stream / sync-all-stream.
 * Installs an onSyncEvent forwarder, returns streamId immediately, runs
 * the sync in background, emits final done/error event then restores.
 *
 * @param {Object} hub      desktop hub singleton
 * @param {Object} ctx      mobile entry-point ctx with sendEventToPeer
 * @param {Function} runFn  () => Promise<SyncReport | SyncReport[]>
 * @param {Object} meta     { adapter, streamIdPrefix }
 * @returns {{streamId: string, name?: string}}
 */
function runSyncStream(hub, ctx, runFn, meta) {
  if (!ctx || typeof ctx.sendEventToPeer !== "function") {
    throw new Error(
      "sync-stream methods require ctx.sendEventToPeer (mobile entry point only)",
    );
  }
  const streamId = `${meta.streamIdPrefix}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;

  const original = hub.registry.onSyncEvent;
  hub.registry.onSyncEvent = (msg) => {
    try {
      ctx.sendEventToPeer("personal-data-hub.sync.progress", msg);
    } catch (_e) {
      // fire-and-forget — peer may have disconnected mid-stream
    }
    if (typeof original === "function") {
      try {
        original(msg);
      } catch (_e) {
        // best-effort chain
      }
    }
  };

  // Run sync in background — caller gets streamId before sync finishes.
  // Use queueMicrotask so the return runs before the async body proceeds.
  Promise.resolve().then(async () => {
    try {
      const report = await runFn();
      try {
        ctx.sendEventToPeer("personal-data-hub.sync.progress", {
          kind: "done",
          adapter: meta.adapter,
          report,
        });
      } catch (_e) {}
    } catch (err) {
      try {
        ctx.sendEventToPeer("personal-data-hub.sync.progress", {
          kind: "error",
          adapter: meta.adapter,
          message: err && err.message ? err.message : String(err),
        });
      } catch (_e) {}
    } finally {
      hub.registry.onSyncEvent = original;
    }
  });

  return { streamId, name: meta.adapter === "*" ? undefined : meta.adapter };
}

/**
 * Dispatch a kebab-case PDH action invoked from a paired mobile peer.
 *
 * Errors propagate (caller wraps into the transport-level error envelope).
 * Approval gate + whitelist already ran upstream in CommandRouter — by the
 * time we get here, the call is policy-approved.
 *
 * @param {string} action  kebab-case method without the `personal-data-hub.` namespace
 * @param {Object} params  message body (already JSON-parsed) from the mobile peer
 * @param {Object} [_ctx]  call context (peerId / did) — reserved for future per-peer auth
 * @returns {Promise<any>} value matching the Android Codable model
 */
async function dispatchPersonalDataHubMethod(action, params = {}, ctx = {}) {
  const fn = DISPATCH[action];
  if (typeof fn !== "function") {
    throw new Error(`Unknown personal-data-hub action: ${action}`);
  }
  const hub = await hubWiring.getHub();
  return await fn(hub, params || {}, ctx || {});
}

module.exports = {
  dispatchPersonalDataHubMethod,
  // Exposed for tests — allows mocking hubWiring without touching the singleton.
  _DISPATCH: DISPATCH,
};
