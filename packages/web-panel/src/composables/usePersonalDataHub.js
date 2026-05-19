/**
 * usePersonalDataHub — web-panel composable wrapping the 10
 * `personal-data-hub.*` WS topics defined in
 * packages/cli/src/gateways/ws/personal-data-hub-protocol.js.
 *
 * Same surface works in BOTH shells:
 *   - desktop V6:  packed web-panel running inside Electron, talks to the
 *     desktop's in-process WS server (same topic names)
 *   - cc ui:       browser web-panel talks to `cc serve` WS server
 *
 * Dispatcher response shape: { id, type: "<topic>.response", result }
 * We unwrap .result here so callers get plain values.
 */

import { useWsStore } from "../stores/ws.js";

function _unwrap(reply) {
  if (!reply) return reply;
  if (reply.error) throw new Error(reply.error);
  // Server sends { type: "personal-data-hub.X.response", result }
  return reply.result !== undefined ? reply.result : reply;
}

/**
 * Phase 5.7 — streaming send. Pushes a request with a custom id, hooks
 * the ws-store's incoming-message stream, fires onEvent for each
 * intermediate `<topic>.event` payload, and resolves on `<topic>.end`.
 *
 * Returns the final report. If the ws-store doesn't expose `onMessage`,
 * falls back to a non-streaming `sendRaw` (still works — caller just
 * doesn't see progress events).
 */
function _sendStream(ws, type, payload, onEvent, timeoutMs) {
  if (typeof ws.onMessage !== "function" || typeof ws._send !== "function") {
    // Fallback: no streaming hook — call non-streaming version
    return ws.sendRaw({ type, ...payload }, timeoutMs).then(_unwrap);
  }
  return new Promise((resolve, reject) => {
    const id =
      (typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const eventType = `${type}.event`;
    const endType = `${type}.end`;
    let timer = setTimeout(() => {
      ws.offMessage && ws.offMessage(id);
      reject(new Error(`stream timeout (${timeoutMs}ms): ${type}`));
    }, timeoutMs);

    const dispose = ws.onMessage(id, (msg) => {
      if (!msg || msg.id !== id) return;
      if (msg.type === eventType && typeof onEvent === "function") {
        try {
          onEvent(msg.event || msg);
        } catch (_e) {}
        return;
      }
      if (msg.type === endType) {
        clearTimeout(timer);
        if (typeof dispose === "function") dispose();
        else if (ws.offMessage) ws.offMessage(id);
        resolve(_unwrap(msg));
        return;
      }
      if (msg.type === "error") {
        clearTimeout(timer);
        if (typeof dispose === "function") dispose();
        else if (ws.offMessage) ws.offMessage(id);
        reject(new Error(msg.message || "stream error"));
      }
    });

    ws._send({ id, type, ...payload });
  });
}

export function usePersonalDataHub() {
  const ws = useWsStore();
  const send = (type, payload = {}, timeoutMs = 30000) =>
    ws.sendRaw({ type, ...payload }, timeoutMs).then(_unwrap);

  return {
    /** Quick health probe — returns { vault, llm, kgSink, ragSink }. */
    async health() {
      return await send("personal-data-hub.health", {}, 8000);
    },

    /** Vault stats + adapter list + LLM identity. */
    async stats() {
      return await send("personal-data-hub.stats", {}, 8000);
    },

    /** [{ name, version, capabilities, sensitivity, legalGate }, ...] */
    async listAdapters() {
      return await send("personal-data-hub.list-adapters", {}, 5000);
    },

    /** Run one adapter end-to-end. Returns SyncReport. */
    async syncAdapter(name, options = {}) {
      return await send(
        "personal-data-hub.sync-adapter",
        { name, options },
        120_000,
      );
    },

    /** Run every registered adapter sequentially. */
    async syncAll(options = {}) {
      return await send(
        "personal-data-hub.sync-all",
        { options },
        600_000,
      );
    },

    /** Register the bundled MockAdapter (dev / demo only). */
    async registerMock({ name = "mock", count = 20, seed = 1 } = {}) {
      return await send("personal-data-hub.register-mock", {
        name,
        count,
        seed,
      });
    },

    /** Remove an adapter from the registry (entries stay in vault). */
    async unregister(name) {
      return await send("personal-data-hub.unregister", { name });
    },

    /**
     * Natural-language ask. Returns:
     *   { answer, citations, hallucinatedCitations, facts, parsed,
     *     usage, model, durationMs, warning }
     *
     * If the active LLM provider is non-local (volcengine / anthropic / etc.)
     * and `options.acceptNonLocal` is not true, the engine throws — that's
     * the privacy invariant firing correctly.
     */
    async ask(question, options = {}) {
      return await send(
        "personal-data-hub.ask",
        { question, options },
        180_000,
      );
    },

    /**
     * Query events directly. Args: { subtype, since, until, actor, adapter, limit }
     * Returns array of Event entities (with `extra`, `participants`, etc. intact).
     */
    async queryEvents(filters = {}) {
      return await send(
        "personal-data-hub.query-events",
        filters,
        10000,
      );
    },

    /** Recent audit rows. Args: { since, action, limit } */
    async recentAudit(filters = {}) {
      return await send("personal-data-hub.recent-audit", filters, 10000);
    },

    // ─── Phase 5.6 — email config + event detail ───────────────────────

    /**
     * Probe IMAP credentials WITHOUT registering. Returns the adapter's
     * authenticate() result. Use this in the email-config wizard before
     * committing the account.
     *
     * @param {{provider, email, authCode, host?, port?, secure?}} account
     */
    async testEmailAuth(account) {
      return await send("personal-data-hub.test-email-auth", { account }, 30_000);
    },

    /**
     * Register a new EmailAdapter + persist the config. `opts` is passed
     * through to the EmailAdapter constructor (pdfPasswordHints, folders,
     * etc.).
     */
    async registerEmail(account, opts = {}) {
      return await send(
        "personal-data-hub.register-email",
        { account, opts },
        15_000,
      );
    },

    /** Remove an email account by address. Vault data stays. */
    async unregisterEmail(email) {
      return await send(
        "personal-data-hub.unregister-email",
        { email },
        5000,
      );
    },

    /** List persisted email accounts (authCode is NOT returned). */
    async listEmailAccounts() {
      return await send("personal-data-hub.list-email-accounts", {}, 5000);
    },

    /**
     * Get full detail for a single event: row + classification +
     * extraction + per-attachment pdfExtraction summary. Used by
     * "click a citation in ask result" → drill-down panel.
     */
    async eventDetail(eventId) {
      return await send(
        "personal-data-hub.event-detail",
        { eventId },
        5000,
      );
    },

    /**
     * Phase 5.7: streaming variant of syncAdapter. Each intermediate
     * progress event fires `onEvent({phase, current, total, ...})`;
     * final report resolves the returned promise.
     *
     *   const reports = await hub.syncAdapterStream("email-imap", {}, (evt) => {
     *     console.log(evt.phase, evt.current, "/", evt.total);
     *   });
     *
     * If the ws-store doesn't support push subscriptions this falls back
     * to the non-streaming `syncAdapter` (no progress events fire, but
     * the call still returns the final report).
     */
    async syncAdapterStream(name, options = {}, onEvent) {
      return await _sendStream(
        ws,
        "personal-data-hub.sync-adapter-stream",
        { name, options },
        onEvent,
        600_000,
      );
    },

    async syncAllStream(options = {}, onEvent) {
      return await _sendStream(
        ws,
        "personal-data-hub.sync-all-stream",
        { options },
        onEvent,
        900_000,
      );
    },

    // ─── Phase 6 — Alipay bill import ─────────────────────────────────

    /**
     * Register an AlipayBillAdapter + persist the config.
     *   account: { email, zipPassword? }
     *   opts:    { zipPassword? }  (legacy — prefer account.zipPassword)
     */
    async registerAlipay(account, opts = {}) {
      return await send(
        "personal-data-hub.register-alipay",
        { account, opts },
        15_000,
      );
    },

    async unregisterAlipay(email) {
      return await send(
        "personal-data-hub.unregister-alipay",
        { email },
        5000,
      );
    },

    async listAlipayAccounts() {
      return await send("personal-data-hub.list-alipay-accounts", {}, 5000);
    },

    /**
     * Import a single Alipay export file. Returns SyncReport
     * { events, persons, items, rawCount, invalidCount, durationMs }.
     */
    async importAlipayBill({ zipPath, csvPath, zipPassword } = {}) {
      return await send(
        "personal-data-hub.import-alipay-bill",
        { zipPath, csvPath, zipPassword },
        300_000,
      );
    },

    // ─── Phase 8 — EntityResolver UI surface ──────────────────────────

    /** List pending review-queue pairs (user-decision needed). */
    async reviewQueueList(limit = 50) {
      return await send("personal-data-hub.review-queue-list", { limit }, 5000);
    },

    /** User decision: "same" / "different" / "skip" on a review row. */
    async reviewDecision(reviewId, decision) {
      return await send(
        "personal-data-hub.review-decision",
        { reviewId, decision },
        5000,
      );
    },

    /** Manually mark two Person ids as the same person. */
    async manualMerge(aId, bId) {
      return await send("personal-data-hub.manual-merge", { aId, bId }, 5000);
    },

    /** Manually remove a Person from its merge group. */
    async manualUnmerge(personId) {
      return await send("personal-data-hub.manual-unmerge", { personId }, 5000);
    },

    /** Drain N pending pairs through embedding+LLM stages. */
    async resolverDrain(limit = 50) {
      return await send("personal-data-hub.resolver-drain", { limit }, 180_000);
    },

    /** Counts of resolve_queue + merge_groups + review_queue. */
    async resolverStats() {
      return await send("personal-data-hub.resolver-stats", {}, 5000);
    },
  };
}
