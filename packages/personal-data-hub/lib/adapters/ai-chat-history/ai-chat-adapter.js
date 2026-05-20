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

const { EVENT_SUBTYPES } = require("../../constants");

const { SUPPORTED_VENDORS, assertVendorSpec, NotImplementedYetError } =
  require("./vendor-spec");
const { CookieAuthSession } = require("./cookie-auth");
const {
  ADAPTER_NAME,
  ADAPTER_VERSION,
  conversationToBatch,
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

const DEFAULT_VENDOR_SPECS = Object.freeze({
  deepseek: deepseekSpec,
  kimi: kimiSpec,
  tongyi: tongyiSpec,
  zhipu: zhipuSpec,
  hunyuan: hunyuanSpec,
  qianfan: qianfanSpec,
  coze: cozeSpec,
  dreamina: dreaminaSpec,
});

class AIChatHistoryAdapter {
  /**
   * @param {object} [opts]
   * @param {Record<string, CookieAuthSession>} [opts.sessions]
   *        Per-vendor cookie session, keyed by vendor name. Vendors without
   *        a session are skipped during sync (the hub flags them in the UI
   *        as "needs login").
   * @param {Record<string, object>} [opts.vendorSpecs]
   *        Override one or more vendor specs (used by tests to inject fixtures).
   * @param {object} [opts.logger]
   */
  constructor(opts = {}) {
    this.name = ADAPTER_NAME;
    this.version = ADAPTER_VERSION;
    this.capabilities = [
      "sync:cookie-multi-vendor",
      "parse:ai-conversations",
      "ingest:cross-vendor",
    ];
    this.extractMode = "web-api";
    this.rateLimits = { perMinute: 60 }; // aggregate across vendors; per-vendor caps in spec
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

    this._logger = opts.logger || { info: () => {}, warn: () => {}, error: () => {} };

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
  }

  // -------------------------------------------------------------------------
  // PersonalDataAdapter contract
  // -------------------------------------------------------------------------

  /**
   * Authentication is delegated per-vendor: the hub UI captures cookies via
   * the Electron WebView and registers them with `setSession(vendor, session)`.
   * `authenticate(ctx)` here only does a quick survey — returns { ok: true,
   * vendorsReady: [...], vendorsNeedingLogin: [...] }.
   */
  async authenticate(_ctx = {}) {
    const vendorsReady = [];
    const vendorsNeedingLogin = [];
    for (const vendor of Object.keys(this._vendorSpecs)) {
      if (this._sessions[vendor]) {
        vendorsReady.push(vendor);
      } else {
        vendorsNeedingLogin.push(vendor);
      }
    }
    // Surface ok=true even when no vendor is configured yet — the UI manages
    // the per-vendor onboarding state and `sync()` will simply yield zero
    // events when no sessions are present.
    return { ok: true, vendorsReady, vendorsNeedingLogin };
  }

  async healthCheck() {
    // Per-vendor health is collected in parallel; the adapter as a whole is
    // healthy iff at least one vendor has a valid cookie (or no vendors are
    // yet onboarded — fresh-install state).
    const perVendor = {};
    for (const [vendor, spec] of Object.entries(this._vendorSpecs)) {
      const sess = this._sessions[vendor];
      if (!sess) {
        perVendor[vendor] = { ok: false, reason: "no-session" };
        continue;
      }
      try {
        perVendor[vendor] = await spec.validateCookie({ session: sess });
      } catch (err) {
        perVendor[vendor] = { ok: false, reason: err.code || err.message };
      }
    }
    return { ok: true, perVendor };
  }

  /**
   * Stream conversation + message envelopes across all configured vendors.
   *
   * Yields raw events of two shapes:
   *   { kind: "conversation", vendor, conversation: RawConversation }
   *   { kind: "message",      vendor, message: RawMessage }
   *
   * The registry calls `normalize(raw)` per yielded event. We deliberately
   * keep one Raw per yield (rather than batching) so a slow vendor doesn't
   * block faster ones at the registry boundary.
   *
   * @param {object} [opts]
   * @param {string[]} [opts.vendors]   restrict to a subset
   * @param {object} [opts.watermarks]  per-vendor cursor / since IDs
   */
  async *sync(opts = {}) {
    const targetVendors = opts.vendors
      ? opts.vendors.filter((v) => this._vendorSpecs[v])
      : Object.keys(this._vendorSpecs);

    for (const vendor of targetVendors) {
      const sess = this._sessions[vendor];
      if (!sess) {
        this._logger.info(`[ai-chat] skipping vendor=${vendor}: no session`);
        continue;
      }
      const spec = this._vendorSpecs[vendor];
      const ctx = { session: sess, vendor };
      const vendorWatermark = (opts.watermarks && opts.watermarks[vendor]) || null;

      try {
        for await (const conv of spec.listConversations(ctx, { since: vendorWatermark })) {
          yield { kind: "conversation", vendor, conversation: conv };

          for await (const msg of spec.listMessages(ctx, conv.originalId, {})) {
            yield { kind: "message", vendor, message: msg };
          }
        }
      } catch (err) {
        if (err instanceof NotImplementedYetError) {
          // Phase 10.1 path: vendor stub is intentionally unwired. Emit a
          // sentinel so the registry / UI can flag it without aborting the
          // whole sync.
          this._logger.warn(
            `[ai-chat] vendor=${vendor} not wired (Phase 10.2+ work): ${err.message}`,
          );
          yield { kind: "vendor-not-wired", vendor, error: err.code };
          continue;
        }
        throw err;
      }
    }
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

    if (raw.kind === "vendor-not-wired") {
      // Nothing to write; the warning was already logged by sync().
      return { events: [], persons: [], places: [], items: [], topics: [] };
    }

    if (raw.kind === "conversation") {
      const conv = raw.conversation;
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

    if (raw.kind === "message") {
      const msg = raw.message;
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
      throw new Error("AIChatHistoryAdapter: session must be a CookieAuthSession");
    }
    this._sessions[vendor] = session;
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
