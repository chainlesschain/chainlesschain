/**
 * AIChatHistoryAdapter — Phase 10 旗舰差异化 adapter.
 *
 * Fans out to 8 vendor sub-adapters (DeepSeek / Kimi / 通义 / 智谱 / 混元 /
 * 千帆 / 扣子 / Dreamina) and re-emits their conversation + message stream as
 * RawConversation / RawMessage envelopes. The AdapterRegistry will then call
 * `normalize()` per envelope to fold them into the LocalVault.
 *
 * Phase 10.1 (this file): skeleton — adapter contract satisfied, schema-map
 * fully implemented, vendor specs registered but their listConversations /
 * listMessages throw VENDOR_NOT_WIRED. This is enough to:
 *   1. register the adapter with AdapterRegistry without it failing assertAdapter
 *   2. exercise normalize() with synthetic Raw* inputs in tests
 *   3. exercise the per-vendor enable/disable flow in the hub UI
 *   4. surface a precise "this vendor isn't wired yet" error to the user
 *
 * Phase 10.2+ replaces each vendor's listConversations / listMessages /
 * validateCookie with real HTTP wiring against the documented endpoints in
 * docs/design/Adapter_AIChat_History.md §6.
 */

"use strict";

const fs = require("node:fs");

const { EVENT_SUBTYPES } = require("../../constants");
const {
  SnapshotFileError,
  readBoundedSnapshot,
} = require("../../snapshot-file");

const {
  SUPPORTED_VENDORS,
  assertVendorSpec,
  NotImplementedYetError,
} = require("./vendor-spec");
const { CookieAuthSession } = require("./cookie-auth");
const {
  HttpClient,
  CookieExpiredError,
  RateLimitedError,
} = require("./http-client");
const {
  ADAPTER_NAME,
  ADAPTER_VERSION,
  buildMessageEvent,
  buildVendorPerson,
  buildConversationTopic,
  buildGeneratedImageItems,
} = require("./schema-map");

const { SPEC: deepseekSpec } = require("./vendors/deepseek");
const { SPEC: kimiSpec } = require("./vendors/kimi");
const { SPEC: tongyiSpec } = require("./vendors/tongyi");
const { SPEC: zhipuSpec } = require("./vendors/zhipu");
const { SPEC: hunyuanSpec } = require("./vendors/hunyuan");
const { SPEC: qianfanSpec } = require("./vendors/qianfan");
const { SPEC: cozeSpec } = require("./vendors/coze");
const { SPEC: dreaminaSpec } = require("./vendors/dreamina");
const { SPEC: doubaoSpec } = require("./vendors/doubao");

const DEFAULT_VENDOR_SPECS = Object.freeze({
  deepseek: deepseekSpec,
  kimi: kimiSpec,
  tongyi: tongyiSpec,
  zhipu: zhipuSpec,
  hunyuan: hunyuanSpec,
  qianfan: qianfanSpec,
  coze: cozeSpec,
  dreamina: dreaminaSpec,
  doubao: doubaoSpec,
});

const MAX_COOKIE_SNAPSHOT_BYTES = 1024 * 1024;
const WATERMARK_PREFIX = "aichat-v1:";
const WATERMARK_VERSION = 1;
const MAX_WATERMARK_BYTES = 64 * 1024;
const DEFAULT_SCAN_PAGE_BUDGET = 20;
const CURSOR_REPLAY_OVERLAP_MS = 1;
const NEEDS_LOGIN_REASON = "INVALID_COOKIE";
const PAGINATION_INCOMPLETE_CODES = new Set([
  "AI_CHAT_PAGINATION_STALLED",
  "AI_CHAT_PAGINATION_LIMIT",
]);

class AIChatHistoryAdapter {
  /**
   * @param {object} [opts]
   * @param {Record<string, CookieAuthSession>} [opts.sessions]
   *        Per-vendor cookie session, keyed by vendor name. Vendors without
   *        a session are skipped during sync (the hub flags them in the UI
   *        as "needs login").
   * @param {Record<string, object>} [opts.vendorSpecs]
   *        Override one or more vendor specs (used by tests to inject fixtures).
   * @param {function} [opts.fetch]
   *        Fetch override forwarded to per-vendor HttpClient. Defaults to
   *        global fetch (Node 22+). Tests inject a stub.
   * @param {function} [opts.sleep]
   *        Sleep override (test seam) for HttpClient rate-limit + backoff.
   * @param {function} [opts.now]
   *        Clock override (test seam) for HttpClient rate-limit.
   * @param {object} [opts.logger]
   */
  constructor(opts = {}) {
    this.name = ADAPTER_NAME;
    this.version = ADAPTER_VERSION;
    this.capabilities = [
      "sync:cookie-multi-vendor",
      "sync:persisted-cookie-accounts",
      "sync:cookie-snapshot",
      "parse:ai-conversations",
      "ingest:cross-vendor",
    ];
    this.extractMode = "web-api";
    this.rateLimits = { perMinute: 60 }; // aggregate across vendors; per-vendor caps in spec
    // Each vendor owns an opaque sub-cursor inside one versioned registry
    // watermark. Commit it only when every targeted vendor reaches its
    // source boundary.
    this.watermarkStrategy = "explicit";
    this.watermarkRequiresCompleteScan = true;
    this.initialPageBudget = DEFAULT_SCAN_PAGE_BUDGET;
    this.dataDisclosure = {
      fields: [
        "ai-chat:vendor,conversationId,messageId,role,text,modelName",
        "ai-chat:attachments(url,filename,mimeType,size)",
        "ai-chat:generatedImages(url,prompt,model,params)",
        "ai-chat:toolCalls",
      ],
      sensitivity: "high",
      legalGate: false,
      notice:
        "AI 对话史含您输入的所有问题与上传的附件。所有数据在本机加密存储；分析时本地 LLM 可读取；不向任何厂商回传。",
    };

    this._logger = opts.logger || {
      info: () => {},
      warn: () => {},
      error: () => {},
    };

    // Vendor specs are registered upfront so that listVendors() / health
    // checks work even before any cookie is configured.
    const specs = { ...DEFAULT_VENDOR_SPECS, ...(opts.vendorSpecs || {}) };
    for (const [vendor, spec] of Object.entries(specs)) {
      const check = assertVendorSpec(spec);
      if (!check.ok) {
        throw new Error(
          `AIChatHistoryAdapter: vendor "${vendor}" spec invalid: ${check.errors.join("; ")}`,
        );
      }
    }
    this._vendorSpecs = specs;
    this._sessions = { ...(opts.sessions || {}) };
    this._fetch = opts.fetch;
    this._sleep = opts.sleep;
    this._now = opts.now;
    this._httpClients = new Map(); // vendor → HttpClient, lazy
  }

  fileCheckpointMode(opts = {}) {
    // inputPath contains cookie/session material for the continuing web API
    // source; it is not an exported conversation snapshot.
    return typeof opts.inputPath === "string" && opts.inputPath.trim()
      ? "shared"
      : "preserve";
  }

  _getHttpClient(vendor) {
    let client = this._httpClients.get(vendor);
    if (!client) {
      const spec = this._vendorSpecs[vendor];
      client = new HttpClient({
        vendor,
        rateLimits: spec.rateLimits,
        fetch: this._fetch,
        sleep: this._sleep,
        now: this._now,
        logger: this._logger,
      });
      this._httpClients.set(vendor, client);
    }
    return client;
  }

  // -------------------------------------------------------------------------
  // PersonalDataAdapter contract
  // -------------------------------------------------------------------------

  /**
   * Authentication is delegated per-vendor: the hub UI captures cookies via
   * the Electron WebView and registers them with `setSession(vendor, session)`.
   * `authenticate(ctx)` does a quick survey and reports needs-login until at
   * least one vendor session (or an explicit snapshot input) is available.
   */
  async authenticate(ctx = {}) {
    const vendorsReady = [];
    const vendorsNeedingLogin = [];
    for (const vendor of Object.keys(this._vendorSpecs)) {
      if (this._sessions[vendor]) {
        vendorsReady.push(vendor);
      } else {
        vendorsNeedingLogin.push(vendor);
      }
    }
    if (hasSnapshotInput(ctx)) {
      return {
        ok: true,
        mode: "snapshot-file",
        vendorsReady,
        vendorsNeedingLogin,
      };
    }
    if (vendorsReady.length === 0) {
      return {
        ok: false,
        reason: NEEDS_LOGIN_REASON,
        message:
          "No AI chat vendor session is configured; sign in to at least one vendor.",
        vendorsReady,
        vendorsNeedingLogin,
      };
    }
    return { ok: true, vendorsReady, vendorsNeedingLogin };
  }

  async healthCheck(ctx = {}) {
    if (hasSnapshotInput(ctx)) {
      return { ok: true, mode: "snapshot-file", perVendor: {} };
    }
    // The adapter is ready only when at least one configured vendor session
    // passes its source-specific validation.
    const perVendor = {};
    let configuredCount = 0;
    let readyCount = 0;
    for (const [vendor, spec] of Object.entries(this._vendorSpecs)) {
      const sess = this._sessions[vendor];
      if (!sess) {
        perVendor[vendor] = { ok: false, reason: "no-session" };
        continue;
      }
      configuredCount += 1;
      try {
        const httpClient = this._getHttpClient(vendor);
        const result = await spec.validateCookie({
          session: sess,
          vendor,
          httpClient,
        });
        perVendor[vendor] =
          result && typeof result === "object"
            ? result
            : { ok: false, reason: "INVALID_COOKIE" };
        if (perVendor[vendor].ok === true) readyCount += 1;
      } catch (err) {
        perVendor[vendor] = { ok: false, reason: err.code || err.message };
      }
    }
    if (configuredCount === 0) {
      return {
        ok: false,
        reason: NEEDS_LOGIN_REASON,
        message:
          "No AI chat vendor session is configured; sign in to at least one vendor.",
        perVendor,
      };
    }
    if (readyCount === 0) {
      return {
        ok: false,
        reason: NEEDS_LOGIN_REASON,
        message:
          "All configured AI chat vendor sessions failed validation; sign in again.",
        perVendor,
      };
    }
    return { ok: true, perVendor };
  }

  /**
   * Stream conversation + message envelopes across all configured vendors.
   *
   * Yields AdapterRegistry-compliant envelopes:
   *   { originalId, capturedAt, payload: { kind, vendor, conversation|message } }
   *
   * The inner `payload.kind` distinguishes:
   *   - "conversation"           → emit Topic + vendor Person (no Event yet)
   *   - "message"                → emit Event + items + vendor Person
   *   - "vendor-not-wired"       → no-op normalize (extension sentinel trace)
   *   - "vendor-cookie-expired"  → no-op normalize (401/403 trace)
   *   - "vendor-rate-limited"    → no-op normalize (429 trace after retries)
   *   - "vendor-pagination-incomplete" → no-op normalize (retryable trace)
   *
   * The registry calls `normalize(raw)` per yielded envelope. One yield per
   * conversation/message keeps registry batches small so a slow vendor
   * doesn't block faster ones at the registry boundary.
   *
   * @param {object} [opts]
   * @param {string[]} [opts.vendors]   restrict to a subset
   * @param {object} [opts.watermarks]  per-vendor cursor / since IDs
   * @param {string} [opts.sinceWatermark] versioned aggregate cursor
   * @param {function} [opts.updateWatermark] publish a complete candidate
   * @param {function} [opts.markWatermarkComplete] confirm source boundary
   */
  async *sync(opts = {}) {
    // Android's in-app collector cannot write the desktop/CLI
    // `aichat-accounts.json`; it stages `{vendor,cookie,fetchedAt}` and calls
    // `sync-adapter ai-chat-history --input <file>`. Restore that ephemeral
    // session before selecting vendors so the same command performs the real
    // remote conversation/message fetch instead of silently yielding zero.
    const snapshotVendor = await this._restoreSnapshotSession(opts);
    const targetVendors = snapshotVendor
      ? [snapshotVendor]
      : Array.isArray(opts.vendors)
        ? [...new Set(opts.vendors.filter((v) => this._vendorSpecs[v]))]
        : Object.keys(this._sessions).filter((v) => this._vendorSpecs[v]);
    const checkpoint = parseAggregateWatermark(opts.sinceWatermark);
    const nextCursor = {
      v: WATERMARK_VERSION,
      vendors: copyKnownVendorCursors(checkpoint.vendors, this._vendorSpecs),
    };
    const eventLimit = resolveEventLimit(opts);
    const scanStartedAt = Date.now();
    let yieldedCount = 0;
    let scanComplete = targetVendors.length > 0;

    vendorLoop: for (const vendor of targetVendors) {
      const sess = this._sessions[vendor];
      if (!sess) {
        this._logger.info(`[ai-chat] skipping vendor=${vendor}: no session`);
        scanComplete = false;
        continue;
      }
      const spec = this._vendorSpecs[vendor];
      const httpClient = this._getHttpClient(vendor);
      const ctx = { session: sess, vendor, httpClient };
      const vendorWatermark = resolveVendorWatermark(
        vendor,
        opts.watermarks,
        checkpoint.vendors,
      );
      const normalizedVendorWatermark =
        normalizeVendorWatermark(vendorWatermark);
      if (normalizedVendorWatermark) {
        nextCursor.vendors[vendor] = normalizedVendorWatermark;
      }
      const vendorSince = collectionVendorWatermark(normalizedVendorWatermark);
      let maxUpdatedAt =
        normalizedVendorWatermark &&
        Number.isFinite(Number(normalizedVendorWatermark.lastUpdatedAt))
          ? Number(normalizedVendorWatermark.lastUpdatedAt)
          : 0;

      try {
        for await (const conv of spec.listConversations(ctx, {
          since: vendorSince,
          maxPages: opts.maxPages,
        })) {
          if (yieldedCount >= eventLimit) {
            scanComplete = false;
            break vendorLoop;
          }
          const conversationUpdatedAt =
            Number(conv.updatedAt) || Number(conv.createdAt) || 0;
          if (conversationUpdatedAt > 0) {
            maxUpdatedAt = Math.max(
              maxUpdatedAt,
              Math.min(conversationUpdatedAt, scanStartedAt),
            );
          }
          yield {
            originalId: `${vendor}:conv:${conv.originalId}`,
            capturedAt:
              Number(conv.updatedAt) || Number(conv.createdAt) || Date.now(),
            payload: { kind: "conversation", vendor, conversation: conv },
          };
          yieldedCount += 1;

          for await (const msg of spec.listMessages(ctx, conv.originalId, {
            maxPages: opts.maxPages,
          })) {
            if (yieldedCount >= eventLimit) {
              scanComplete = false;
              break vendorLoop;
            }
            yield {
              originalId: `${vendor}:msg:${msg.originalId}`,
              capturedAt: Number(msg.createdAt) || Date.now(),
              payload: { kind: "message", vendor, message: msg },
            };
            yieldedCount += 1;
          }
        }
        if (maxUpdatedAt > 0) {
          nextCursor.vendors[vendor] = {
            ...(normalizedVendorWatermark || {}),
            lastUpdatedAt: maxUpdatedAt,
          };
        }
      } catch (err) {
        scanComplete = false;
        const traceCapturedAt = Date.now();
        if (err instanceof NotImplementedYetError) {
          this._logger.warn(
            `[ai-chat] vendor=${vendor} not wired (Phase 10.2+ work): ${err.message}`,
          );
          if (yieldedCount >= eventLimit) break vendorLoop;
          yield {
            originalId: `${vendor}:trace:not-wired:${traceCapturedAt}`,
            capturedAt: traceCapturedAt,
            payload: { kind: "vendor-not-wired", vendor, error: err.code },
          };
          yieldedCount += 1;
          continue;
        }
        if (err instanceof CookieExpiredError) {
          this._logger.warn(
            `[ai-chat] vendor=${vendor} cookie expired: ${err.message}`,
          );
          if (yieldedCount >= eventLimit) break vendorLoop;
          yield {
            originalId: `${vendor}:trace:cookie-expired:${traceCapturedAt}`,
            capturedAt: traceCapturedAt,
            payload: { kind: "vendor-cookie-expired", vendor, error: err.code },
          };
          yieldedCount += 1;
          continue;
        }
        if (err instanceof RateLimitedError) {
          this._logger.warn(
            `[ai-chat] vendor=${vendor} rate limited: ${err.message}`,
          );
          if (yieldedCount >= eventLimit) break vendorLoop;
          yield {
            originalId: `${vendor}:trace:rate-limited:${traceCapturedAt}`,
            capturedAt: traceCapturedAt,
            payload: {
              kind: "vendor-rate-limited",
              vendor,
              error: err.code,
              retryAfterMs: err.retryAfterMs,
            },
          };
          yieldedCount += 1;
          continue;
        }
        if (err && PAGINATION_INCOMPLETE_CODES.has(err.code)) {
          this._logger.warn(
            `[ai-chat] vendor=${vendor} pagination incomplete: ${err.message}`,
          );
          if (yieldedCount >= eventLimit) break vendorLoop;
          yield {
            originalId: `${vendor}:trace:pagination-incomplete:${traceCapturedAt}`,
            capturedAt: traceCapturedAt,
            payload: {
              kind: "vendor-pagination-incomplete",
              vendor,
              error: err.code,
            },
          };
          yieldedCount += 1;
          continue;
        }
        throw err;
      }
    }

    if (scanComplete) {
      if (typeof opts.updateWatermark === "function") {
        opts.updateWatermark(serializeAggregateWatermark(nextCursor));
      }
      if (typeof opts.markWatermarkComplete === "function") {
        opts.markWatermarkComplete();
      }
    }
  }

  async _restoreSnapshotSession(opts = {}) {
    const inputPath = opts.inputPath || opts.snapshotPath || null;
    if (!inputPath) return null;
    if (typeof inputPath !== "string") {
      throw createSnapshotError(
        "AI_CHAT_SNAPSHOT_PATH_INVALID",
        "ai-chat-history: inputPath must be a string",
      );
    }

    const raw = readCookieSnapshot(inputPath);

    let snapshot;
    try {
      snapshot = JSON.parse(raw);
    } catch {
      throw createSnapshotError(
        "AI_CHAT_SNAPSHOT_JSON_INVALID",
        "ai-chat-history: cookie snapshot is not valid JSON",
      );
    }
    if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
      throw createSnapshotError(
        "AI_CHAT_SNAPSHOT_SHAPE_INVALID",
        "ai-chat-history: cookie snapshot must be an object",
      );
    }

    const vendor = snapshot.vendor;
    if (typeof vendor !== "string" || !this._vendorSpecs[vendor]) {
      throw createSnapshotError(
        "AI_CHAT_SNAPSHOT_VENDOR_INVALID",
        "ai-chat-history: cookie snapshot vendor is missing or unsupported",
      );
    }
    try {
      this.setSessionFromCookies(vendor, snapshot.cookies || snapshot.cookie, {
        capturedAt: snapshot.fetchedAt || snapshot.capturedAt,
      });
    } catch {
      throw createSnapshotError(
        "AI_CHAT_SNAPSHOT_COOKIE_INVALID",
        "ai-chat-history: cookie snapshot has no usable cookies",
      );
    }
    return vendor;
  }

  /**
   * Convert one raw event into a NormalizedBatch.
   *
   * For "conversation" raws we emit only the conversation Topic + vendor
   * Person (events are emitted lazily as their messages arrive). This lets
   * the vault link Event.topics[] to a Topic that already exists.
   */
  normalize(raw) {
    if (!raw || typeof raw !== "object") {
      return { events: [], persons: [], places: [], items: [], topics: [] };
    }
    // Registry-compliant envelopes wrap kind inside payload. Adapter-internal
    // tests (Phase 10.1) sometimes pass the inner shape directly — accept
    // both for forward compat.
    const inner =
      raw.payload && typeof raw.payload === "object" ? raw.payload : raw;
    const kind = inner.kind;

    if (
      kind === "vendor-not-wired" ||
      kind === "vendor-cookie-expired" ||
      kind === "vendor-rate-limited" ||
      kind === "vendor-pagination-incomplete"
    ) {
      // Nothing to write; the warning was already logged by sync().
      return { events: [], persons: [], places: [], items: [], topics: [] };
    }

    if (kind === "conversation") {
      const conv = inner.conversation;
      const spec = this._vendorSpecs[conv.vendor];
      const displayName = spec ? spec.displayName : conv.vendor;
      return {
        events: [],
        persons: [buildVendorPerson(conv.vendor, displayName)],
        places: [],
        items: [],
        topics: [buildConversationTopic(conv)],
      };
    }

    if (kind === "message") {
      const msg = inner.message;
      const spec = this._vendorSpecs[msg.vendor];
      const displayName = spec ? spec.displayName : msg.vendor;
      return {
        events: [buildMessageEvent(msg)],
        persons: [buildVendorPerson(msg.vendor, displayName)],
        places: [],
        items: buildGeneratedImageItems(msg),
        topics: [], // Topic was already emitted with the conversation event
      };
    }

    return { events: [], persons: [], places: [], items: [], topics: [] };
  }

  // -------------------------------------------------------------------------
  // Hub UI hooks (not part of PersonalDataAdapter contract)
  // -------------------------------------------------------------------------

  /**
   * Register a cookie session captured from the WebView for a given vendor.
   */
  setSession(vendor, session) {
    if (!this._vendorSpecs[vendor]) {
      throw new Error(`AIChatHistoryAdapter: unknown vendor "${vendor}"`);
    }
    if (!(session instanceof CookieAuthSession)) {
      throw new Error(
        "AIChatHistoryAdapter: session must be a CookieAuthSession",
      );
    }
    this._sessions[vendor] = session;
  }

  /**
   * Restore one vendor session from the persisted `aichat-accounts.json`
   * cookie shapes. The wizard stores a name/value object while Electron may
   * provide a Cookie[]; accepting both keeps boot restoration independent of
   * the shell that originally captured the login.
   */
  setSessionFromCookies(vendor, cookies, opts = {}) {
    const entries = normalizeCookieEntries(cookies);
    if (entries.length === 0) {
      throw new Error(
        `AIChatHistoryAdapter: no usable cookies for vendor "${vendor}"`,
      );
    }
    const capturedAt = normalizeCapturedAt(opts.capturedAt);
    const session = new CookieAuthSession({
      vendor,
      cookies: entries,
      capturedAt,
    });
    this.setSession(vendor, session);
    return session;
  }

  /**
   * Restore every valid persisted account without letting one corrupt row
   * prevent the remaining vendors from collecting. Returns a scrubbed report
   * (vendor + reason only; never cookie values) for boot diagnostics/tests.
   */
  restoreSessions(entries = []) {
    const restored = [];
    const skipped = [];
    for (const entry of Array.isArray(entries) ? entries : []) {
      const vendor = entry && entry.vendor;
      try {
        this.setSessionFromCookies(vendor, entry.cookies, {
          capturedAt: entry.registeredAt || entry.capturedAt,
        });
        restored.push(vendor);
      } catch (err) {
        skipped.push({
          vendor: typeof vendor === "string" && vendor ? vendor : "(missing)",
          reason:
            err && err.message ? err.message : "invalid persisted session",
        });
      }
    }
    return { restored, skipped };
  }

  clearSession(vendor) {
    delete this._sessions[vendor];
  }

  listVendors() {
    return Object.values(this._vendorSpecs).map((spec) => ({
      name: spec.name,
      displayName: spec.displayName,
      androidPackage: spec.androidPackage,
      loginUrl: spec.loginUrl,
      hasSession: Boolean(this._sessions[spec.name]),
    }));
  }
}

function hasSnapshotInput(opts) {
  if (!opts || typeof opts !== "object") return false;
  const inputPath = opts.inputPath || opts.snapshotPath;
  return typeof inputPath === "string" && inputPath.length > 0;
}

function parseAggregateWatermark(value) {
  const empty = { v: WATERMARK_VERSION, vendors: {} };
  if (value == null || value === "") return empty;

  // Before this adapter declared an explicit cursor, Registry used its
  // default count watermark. Treat that numeric checkpoint as a one-time
  // migration to a full scan.
  if (
    typeof value === "number" ||
    typeof value === "bigint" ||
    (typeof value === "string" &&
      value.trim() !== "" &&
      Number.isFinite(Number(value)))
  ) {
    return empty;
  }
  if (typeof value !== "string") {
    throw createCursorError("AI chat watermark must be a string");
  }
  if (Buffer.byteLength(value, "utf8") > MAX_WATERMARK_BYTES) {
    throw createCursorError("AI chat watermark exceeds the maximum size");
  }
  if (!value.startsWith(WATERMARK_PREFIX)) {
    throw createCursorError("AI chat watermark has an unsupported format");
  }

  let parsed;
  try {
    parsed = JSON.parse(value.slice(WATERMARK_PREFIX.length));
  } catch {
    throw createCursorError("AI chat watermark JSON is invalid");
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    parsed.v !== WATERMARK_VERSION ||
    !parsed.vendors ||
    typeof parsed.vendors !== "object" ||
    Array.isArray(parsed.vendors)
  ) {
    throw createCursorError("AI chat watermark shape is invalid");
  }
  return { v: WATERMARK_VERSION, vendors: parsed.vendors };
}

function serializeAggregateWatermark(cursor) {
  const vendors = {};
  for (const vendor of Object.keys(cursor.vendors || {}).sort()) {
    const normalized = normalizeVendorWatermark(cursor.vendors[vendor]);
    if (normalized) vendors[vendor] = normalized;
  }
  const serialized =
    WATERMARK_PREFIX +
    JSON.stringify({
      v: WATERMARK_VERSION,
      vendors,
    });
  if (Buffer.byteLength(serialized, "utf8") > MAX_WATERMARK_BYTES) {
    throw createCursorError("AI chat watermark exceeds the maximum size");
  }
  return serialized;
}

function copyKnownVendorCursors(vendors, vendorSpecs) {
  const copy = {};
  for (const vendor of Object.keys(vendorSpecs)) {
    const normalized = normalizeVendorWatermark(vendors && vendors[vendor]);
    if (normalized) copy[vendor] = normalized;
  }
  return copy;
}

function resolveVendorWatermark(vendor, legacyWatermarks, cursorVendors) {
  if (
    legacyWatermarks &&
    typeof legacyWatermarks === "object" &&
    Object.prototype.hasOwnProperty.call(legacyWatermarks, vendor)
  ) {
    return legacyWatermarks[vendor];
  }
  return cursorVendors && cursorVendors[vendor];
}

function normalizeVendorWatermark(value) {
  if (value == null) return null;
  const rawTimestamp =
    typeof value === "object" && !Array.isArray(value)
      ? value.lastUpdatedAt
      : value;
  if (rawTimestamp == null || rawTimestamp === "") return {};
  const timestamp = Number(rawTimestamp);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return {};
  // A future cursor can suppress every legitimate row. Treat it as an empty
  // vendor cursor so the next successful run repairs it with observed data.
  if (timestamp > Date.now()) return {};
  return { lastUpdatedAt: timestamp };
}

function collectionVendorWatermark(value) {
  if (!value || !Number.isFinite(Number(value.lastUpdatedAt))) return null;
  return {
    lastUpdatedAt: Math.max(
      0,
      Number(value.lastUpdatedAt) - CURSOR_REPLAY_OVERLAP_MS,
    ),
  };
}

function resolveEventLimit(opts) {
  const limits = [opts.limit, opts.maxEvents].filter(
    (value) => Number.isSafeInteger(value) && value > 0,
  );
  return limits.length > 0 ? Math.min(...limits) : Number.POSITIVE_INFINITY;
}

function createCursorError(message) {
  const error = new Error(`ai-chat-history: ${message}`);
  error.code = "AI_CHAT_WATERMARK_INVALID";
  return error;
}

function normalizeCookieEntries(input) {
  if (Array.isArray(input)) {
    return input
      .filter(
        (cookie) =>
          cookie &&
          typeof cookie.name === "string" &&
          cookie.name.length > 0 &&
          typeof cookie.value === "string" &&
          cookie.value.length > 0,
      )
      .map((cookie) => ({ ...cookie }));
  }
  if (typeof input === "string") {
    return input
      .split(/;\s*/u)
      .map((pair) => {
        const separator = pair.indexOf("=");
        if (separator <= 0) return null;
        return {
          name: pair.slice(0, separator).trim(),
          value: pair.slice(separator + 1).trim(),
        };
      })
      .filter((cookie) => cookie && cookie.name && cookie.value);
  }
  if (input && typeof input === "object") {
    return Object.entries(input)
      .filter(
        ([name, value]) =>
          typeof name === "string" &&
          name.length > 0 &&
          typeof value === "string" &&
          value.length > 0,
      )
      .map(([name, value]) => ({ name, value }));
  }
  return [];
}

function readCookieSnapshot(inputPath) {
  try {
    return readBoundedSnapshot(fs, inputPath, {
      maxBytes: MAX_COOKIE_SNAPSHOT_BYTES,
    });
  } catch (error) {
    if (error instanceof SnapshotFileError) {
      if (error.code === "SNAPSHOT_NOT_REGULAR_FILE") {
        throw createSnapshotError(
          "AI_CHAT_SNAPSHOT_NOT_FILE",
          "ai-chat-history: inputPath must point to a file",
        );
      }
      if (error.code === "SNAPSHOT_TOO_LARGE") {
        throw createSnapshotError(
          "AI_CHAT_SNAPSHOT_TOO_LARGE",
          `ai-chat-history: cookie snapshot exceeds ${MAX_COOKIE_SNAPSHOT_BYTES} bytes`,
        );
      }
      if (error.code === "SNAPSHOT_SYMBOLIC_LINK") {
        throw createSnapshotError(
          "AI_CHAT_SNAPSHOT_SYMBOLIC_LINK",
          "ai-chat-history: cookie snapshot must not be a symbolic link",
        );
      }
      if (error.code === "SNAPSHOT_CHANGED") {
        throw createSnapshotError(
          "AI_CHAT_SNAPSHOT_CHANGED",
          "ai-chat-history: cookie snapshot changed while it was being read",
        );
      }
    }
    throw createSnapshotError(
      "AI_CHAT_SNAPSHOT_READ_FAILED",
      `ai-chat-history: cannot read cookie snapshot (${error && error.code ? error.code : "unknown"})`,
    );
  }
}

function normalizeCapturedAt(value) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }
  if (typeof value === "string" && value) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return Date.now();
}

function createSnapshotError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

module.exports = {
  AIChatHistoryAdapter,
  SUPPORTED_VENDORS,
  DEFAULT_VENDOR_SPECS,
  // re-export for convenience
  ADAPTER_NAME,
  ADAPTER_VERSION,
  EVENT_SUBTYPE_AI_MESSAGE: EVENT_SUBTYPES.AI_MESSAGE,
  EVENT_SUBTYPE_AI_IMAGE_GENERATION: EVENT_SUBTYPES.AI_IMAGE_GENERATION,
};
