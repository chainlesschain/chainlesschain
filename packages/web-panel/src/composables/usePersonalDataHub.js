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
 * the ws-store's global onMessage bus, fires onEvent for each
 * intermediate `<topic>.event` payload, and resolves on `<topic>.end`.
 *
 * Returns the final report (the unwrapped SyncReport).
 *
 * Wire-up notes (read before changing):
 *
 *   - ws-store exposes ONLY `sendRaw` and `onMessage(handler)` — there is
 *     no low-level `_send`. An earlier revision checked for `ws._send`
 *     and fell back to `sendRaw` alone when absent; that was ALWAYS the
 *     case, so the fallback ran every time and resolved the call with
 *     the FIRST id-matching server reply — typically a `<topic>.event`
 *     progress envelope, not the final `.end`. UI then rendered
 *     "同步 undefined: undefined" + all-zero stats because the event
 *     envelope has no .adapter / .status / .entityCounts fields.
 *     See PersonalDataHub.vue:268-272 / syncSummary() for the consumer.
 *
 *   - `onMessage(handler)` takes ONE argument; the previous code passed
 *     two (id + fn), which silently registered the id string as the
 *     handler and dropped the actual listener.
 *
 *   - `sendRaw({ id, ... })` honors a caller-supplied id (ws.js:347) and
 *     registers a one-shot pending entry on it. The first id-matching
 *     reply resolves the one-shot — for streaming topics that's the
 *     first `.event`. We DISCARD sendRaw's returned promise and rely on
 *     the global onMessage bus, which continues to receive every
 *     subsequent message tagged with the same id.
 */
function _sendStream(ws, type, payload, onEvent, timeoutMs) {
  // Degraded ws-store (e.g. test harness without onMessage): plain
  // sendRaw + unwrap. Caller loses progress events but still gets the
  // final result, since `.end` carries the same `{ result }` shape that
  // `.response` does.
  if (typeof ws.onMessage !== "function" || typeof ws.sendRaw !== "function") {
    return ws.sendRaw({ type, ...payload }, timeoutMs).then(_unwrap);
  }
  return new Promise((resolve, reject) => {
    const id =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const eventType = `${type}.event`;
    const endType = `${type}.end`;

    let settled = false;
    let dispose = () => {};
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { dispose(); } catch (_e) {}
      fn(value);
    };

    const timer = setTimeout(() => {
      finish(reject, new Error(`stream timeout (${timeoutMs}ms): ${type}`));
    }, timeoutMs);

    const unsubscribe = ws.onMessage((msg) => {
      if (settled || !msg) return;
      // ws-store v1.0 envelope uses requestId; legacy uses id. Match both
      // so the same composable works against both shells (cc serve and
      // desktop web-shell embed the same CLI ws-server, but future
      // protocol revisions may flip envelope shape).
      if (msg.id !== id && msg.requestId !== id) return;
      if (msg.type === eventType) {
        if (typeof onEvent === "function") {
          try { onEvent(msg.event || msg); } catch (_e) {}
        }
        return;
      }
      if (msg.type === endType) {
        finish(resolve, _unwrap(msg));
        return;
      }
      if (msg.type === "error") {
        finish(reject, new Error(msg.message || "stream error"));
      }
    });
    dispose = typeof unsubscribe === "function" ? unsubscribe : () => {};

    // Fire the request. sendRaw also resolves on the first id-matching
    // reply (the first `.event`); we ignore its promise to avoid an
    // unhandled-rejection if the server returns an error frame — that
    // path is already covered by the onMessage handler above.
    Promise.resolve(ws.sendRaw({ id, type, ...payload }, timeoutMs)).catch(() => {});
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

    /**
     * Phase 16 — Vault Browser full-text + faceted search.
     * Args: { q, adapter, category, subtype, since, until, cursor, limit }
     * Returns: { rows: Event[], nextCursor, mode: 'fts5'|'like', shortQuery }
     *   - nextCursor: { occurredAt, id } | null — pass back as `cursor` to page
     *   - shortQuery: true when q was non-empty but below FTS5 trigram min (3)
     */
    async searchEvents(filters = {}) {
      return await send("personal-data-hub.search-events", filters, 15000);
    },

    /**
     * Phase 16 — counts grouped by category / adapter / subtype, honoring
     * the same q + since/until filters as searchEvents. Powers sidebar
     * badges + adapter chip counts. Args: { q, since, until }.
     * Returns: { byCategory, byAdapter, bySubtype, total, mode, shortQuery }
     */
    async facetCounts(filters = {}) {
      return await send("personal-data-hub.facet-counts", filters, 10000);
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

    // ─── Phase 11 — internal analysis skills ──────────────────────────

    /** List the 5 internal analysis skill names. */
    async skillsList() {
      return await send("personal-data-hub.skills-list", {}, 5000);
    },

    /**
     * Run a named analysis skill (analysis.spending / .relations /
     * .footprint / .interests / .timeline). Returns
     * `{ skill, summary, breakdown?, citations, llm_commentary? }`.
     */
    async runSkill(name, options = {}) {
      return await send(
        "personal-data-hub.run-skill",
        { name, options },
        120_000,
      );
    },

    // ─── Phase 10.3 — AIChat WebView 鉴权向导 ─────────────────────────
    //
    // 4 wizard topics mirror the 4 IPC channels in desktop. cc ui shells
    // run the wizard in `fallbackMode: "paste"` — the user logs in via an
    // external browser, copies cookies, and pastes the `name=value;…`
    // string into Step 2. Desktop Electron uses BrowserView (handled by
    // the Electron main process, not exposed via this composable).
    //
    // Return shapes match `wizard-controller.js` exactly:
    //   openAichatLogin → { ok, fallbackMode, loginUrl, helpText?, ... }
    //   probeAichatCookies → { ok, cookies, foundRequired, missingRequired, ... }
    //   registerAichatVendor → { ok, accountId?, validation?, reason? }
    //   rotateAichatLogin → same shape as openAichatLogin (paste mode)

    /**
     * Step 1 — open the login flow for one of the 9 国产 AI vendors.
     * `opts.reuseSession=false` clears the partition's cookie jar first
     * (desktop Electron only; cc ui ignores this).
     */
    async openAichatLogin(vendor, opts = {}) {
      return await send(
        "personal-data-hub.aichat-open-login",
        { vendor, opts },
        10_000,
      );
    },

    /**
     * Step 2 — probe captured cookies.
     *   - cc ui paste flow: pass `cookieHeader` ("k=v; k=v" string)
     *   - desktop BrowserView flow: omit `cookieHeader`, main process
     *     reads from the partition itself
     */
    async probeAichatCookies(vendor, cookieHeader) {
      return await send(
        "personal-data-hub.aichat-probe-cookies",
        { vendor, cookieHeader },
        10_000,
      );
    },

    /**
     * Step 3 — register the vendor with the supplied cookies. Calls
     * vendor SPEC `validateCookie` upstream then persists to
     * aichat-accounts.json. Returns the typed reason on failure
     * (REQUIRED_COOKIES_MISSING / VALIDATE_COOKIE_FAILED / ADAPTER_THREW).
     */
    async registerAichatVendor(vendor, cookies, opts = {}) {
      return await send(
        "personal-data-hub.aichat-register-vendor",
        { vendor, cookies, opts },
        30_000,
      );
    },

    /**
     * Re-login flow — clears the desktop partition and returns fresh
     * Step 1 metadata. On cc ui this just re-emits the paste help text.
     */
    async rotateAichatLogin(vendor) {
      return await send(
        "personal-data-hub.aichat-rotate-login",
        { vendor },
        10_000,
      );
    },

    /**
     * List registered AIChat vendors with scrubbed cookies + lastHealth.
     * Used by the wizard Step 1 vendor picker to show "已接入" tag and
     * the red-dot affordance when `entry.lastHealth.ok === false`.
     *
     * Returns: [{ vendor, displayName, registeredAt, userId, lastSyncAt,
     *   lastHealth: { ok, reason?, at? }, cookieSpecVersion, cookieNames }]
     */
    async listAichatAccounts() {
      return await send(
        "personal-data-hub.list-aichat-accounts",
        {},
        5_000,
      );
    },

    /**
     * Drop a registered AIChat vendor: deletes the row from
     * aichat-accounts.json and (desktop only) clears the partition cookies.
     * Vault events stay queryable.
     */
    async unregisterAichat(vendor) {
      return await send(
        "personal-data-hub.unregister-aichat",
        { vendor },
        5_000,
      );
    },

    /**
     * Manually trigger one HealthChecker pass — used by the wizard "立即检查"
     * affordance and by debugging. Returns
     * `{ checked, ok, failed, mismatch, skipped? }`.
     */
    async aichatHealthCheckOnce() {
      return await send(
        "personal-data-hub.aichat-health-check-once",
        {},
        30_000,
      );
    },

    // ─── Phase 12.6.10 — WeChat env-probe + register / list / unregister ──

    /**
     * Probe the attached Android device (adb / root / frida / WeChat
     * version). Returns the raw probe shape so the wizard checklist UI
     * can render each capability independently.
     */
    async probeWechatEnv() {
      return await send("personal-data-hub.wechat-env-probe", {}, 15_000);
    },

    /**
     * Register a WeChat adapter via bootstrap (12.6.7 → 12.6.8). Caller
     * passes account.uin + dbPath/wechatDataPath produced by an upstream
     * `adb pull`. Server selects md5 / frida provider automatically per
     * env-probe; `keyProviderOverride` forces the choice if needed.
     */
    async registerWechat({ account, dbPath, wechatDataPath, fridaOpts, keyProviderOverride } = {}) {
      return await send(
        "personal-data-hub.register-wechat",
        { account, dbPath, wechatDataPath, fridaOpts, keyProviderOverride },
        45_000,
      );
    },

    async listWechatAccounts() {
      return await send("personal-data-hub.list-wechat-accounts", {}, 5_000);
    },

    async unregisterWechat(uin) {
      return await send("personal-data-hub.unregister-wechat", { uin }, 5_000);
    },

    /**
     * Phase 1c — Bilibili C 路径 one-shot sync.
     *
     * Pulls the Android Bilibili App's WebView cookies via ADB, fetches
     * history/favourite/dynamic/follow, and ingests as a snapshot via the
     * existing social-bilibili adapter. Returns the standard wiring shape
     * `{ok, report?, reason?, message?}`. UI maps reason to a banner —
     * see PersonalDataHub.vue:bilibiliAdbSync handler.
     *
     * Long timeout (120s) because the API client makes up to ~3 + 1 +
     * fav-folders sequential HTTP calls to api.bilibili.com (each can
     * sit at 15s if anti-spider rate-limits us), and adb base64-stream
     * of the Cookies sqlite is ~1-2s on most rooted phones.
     *
     * 9 reason codes (handler maps each to its own banner):
     *  - BRIDGE_UNAVAILABLE / MODULE_LOAD_FAILED
     *  - BILIBILI_NO_ROOT
     *  - BILIBILI_NOT_INSTALLED_OR_NEVER_LOGGED_IN
     *  - BILIBILI_COOKIES_INCOMPLETE / BILIBILI_COOKIES_TRUNCATED /
     *    BILIBILI_NOT_SQLITE / BILIBILI_INVALID_UID
     *  - SYNC_FAILED  (catch-all for HTTP / vault errors)
     */
    async bilibiliAdbSync(opts = {}) {
      return await send(
        "personal-data-hub.bilibili-adb-sync",
        {
          limits: opts.limits,
          stagingDir: opts.stagingDir,
          displayName: opts.displayName,
        },
        120_000,
      );
    },

    /**
     * Phase 1e — Bilibili C 路径 dry-run env probe.
     *
     * Probes the cookies path only (no api.bilibili.com calls, no vault
     * writes). Returns same 9 typed reasons as bilibiliAdbSync but with
     * `uid` + `cookieDiagnostic: {cookieCount, hadEncrypted}` on success.
     *
     * 15s timeout — only does `adb shell ls` + `id -u` + `base64 ...` +
     * a quick sqlite parse, no HTTP.
     */
    async bilibiliAdbDoctor() {
      return await send("personal-data-hub.bilibili-adb-doctor", {}, 15_000);
    },

    /**
     * Phase 3a — Weibo C 路径 one-shot sync.
     *
     * Pulls m.weibo.cn cookies from the user's Android Weibo App via
     * ADB, fetches UID via /api/config + 3 endpoints (posts/favourites/
     * follows), ingests via social-weibo adapter snapshot mode. 10 typed
     * reason codes for UI banner mapping.
     *
     * 60s timeout — Weibo HTTP is faster than Bilibili (no WBI handshake)
     * but 3 endpoints sequential + cookie pull base64 stream sums up.
     */
    async weiboAdbSync(opts = {}) {
      return await send(
        "personal-data-hub.weibo-adb-sync",
        {
          limits: opts.limits,
          stagingDir: opts.stagingDir,
          displayName: opts.displayName,
        },
        60_000,
      );
    },

    /**
     * Phase 3c — Xhs C 路径 one-shot sync.
     *
     * Pulls xiaohongshu.com cookies via ADB, fetches userId via /user/me
     * (no X-S) + 3 endpoints (notes/liked/follows, X-S signed best-effort).
     * ~60% GET hit rate; UI handles partial via lastErrorCode propagation.
     *
     * 60s timeout — similar to Weibo (3 endpoints + cookie pull).
     */
    async xhsAdbSync(opts = {}) {
      return await send(
        "personal-data-hub.xhs-adb-sync",
        {
          limits: opts.limits,
          stagingDir: opts.stagingDir,
          displayName: opts.displayName,
        },
        60_000,
      );
    },

    /**
     * Phase 6c — Toutiao C 路径 one-shot sync.
     *
     * Pulls www.toutiao.com cookies via ADB, fetches passport profile +
     * 3 _signature endpoints (feed/collection/search). Desktop context
     * gets ~100% hit via ToutiaoSignBridge (Electron WebContentsView
     * running acrawler.js). Web/CLI context: 3 signed endpoints short-
     * circuit with no HTTP traffic — banner explains "run from desktop".
     *
     * 90s timeout — passport (no _sig) + 3 signed endpoints + warmUp
     * (~3-5s) + shutdown.
     */
    async toutiaoAdbSync(opts = {}) {
      return await send(
        "personal-data-hub.toutiao-adb-sync",
        {
          limits: opts.limits,
          stagingDir: opts.stagingDir,
          displayName: opts.displayName,
        },
        90_000,
      );
    },

    /**
     * Phase 6d — Kuaishou C 路径 one-shot sync.
     *
     * Pulls www.kuaishou.com cookies via ADB, parses profile from cookie's
     * kuaishou.web.cp.api_ph payload (no HTTP), then fetches 3 signed
     * GraphQL endpoints (watch/collect/search). Desktop: ~100% via
     * KuaishouSignBridge running NS_sig3 SDK. Web/CLI: signed endpoints
     * short-circuit (no HTTP traffic) — banner explains "run from desktop".
     *
     * 120s timeout — NS_sig3 init heavier than acrawler.js (~5-8s warmUp)
     * + 3 signed GraphQL POST endpoints + shutdown.
     */
    async kuaishouAdbSync(opts = {}) {
      return await send(
        "personal-data-hub.kuaishou-adb-sync",
        {
          limits: opts.limits,
          stagingDir: opts.stagingDir,
          displayName: opts.displayName,
        },
        120_000,
      );
    },

    /**
     * Phase 6e — Bridge dry-run doctor.
     *
     * Spins up Xhs / Toutiao / Kuaishou sign bridges with empty cookie,
     * probes for candidate signing globals, times each phase. Lets users
     * detect SDK rotation BEFORE starting a real sync. Desktop-only.
     *
     * 60s timeout — 3 bridges × (warmUp ~3-5s + probe ~1s) sequential.
     */
    async bridgeDoctor() {
      return await send("personal-data-hub.bridge-doctor", {}, 60_000);
    },

    /**
     * Phase 2a — Douyin C 路径 one-shot sync.
     *
     * Pulls <uid>_im.db cohort from the user's Android Douyin App via
     * ADB, parses msg + SIMPLE_USER (abrignoni DFIR), ingests via
     * social-douyin adapter snapshot mode. 9 typed reason codes for
     * the UI to map to banners.
     *
     * 60s timeout — db extraction is faster than Bilibili's 4-endpoint
     * fetch (no api.bilibili.com latency); the cap is mostly for base64
     * streaming of a large IM db (~5-50MB raw).
     */
    async douyinAdbSync(opts = {}) {
      return await send(
        "personal-data-hub.douyin-adb-sync",
        {
          uid: opts.uid,
          limits: opts.limits,
          stagingDir: opts.stagingDir,
          displayName: opts.displayName,
        },
        60_000,
      );
    },
  };
}
