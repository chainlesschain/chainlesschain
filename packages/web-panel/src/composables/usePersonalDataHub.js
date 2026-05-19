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
  };
}
