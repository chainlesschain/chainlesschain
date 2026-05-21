/**
 * Personal Data Hub — desktop-app-vue wiring (Phase 3.5b)
 *
 * Lazy singleton that initializes:
 *   - LocalVault (SQLCipher) at <userData>/.chainlesschain/hub/vault.db
 *     with FileKeyProvider master key at <userData>/.chainlesschain/hub/keys/
 *   - CcLLMAdapter wrapping the existing LLMManager singleton from
 *     ./llm/llm-manager.js (Ollama / Volcengine / Anthropic / Gemini / ...)
 *   - AdapterRegistry — KG / RAG sinks are wired dynamically from the
 *     ESM cli package (knowledge-graph.js + bm25-search.js) when the
 *     first sync happens; LLM-only path works without them.
 *   - AnalysisEngine bound to the vault + LLM
 *
 * Lifecycle:
 *   getHub() → idempotent init; first call opens vault + runs migrations.
 *   close()  → flushes vault + closes file handles for clean shutdown.
 *
 * The file-based key provider is a Phase 3.5b stopgap. Phase 4 will add
 * a DPAPI / Mac Keychain / Linux libsecret-backed KeyProvider for actual
 * production-grade key protection (architecture doc §7.1).
 *
 * Why no eager init at app startup: cold-starting the hub adds 100-200ms
 * to first-window paint. Lazy on first IPC keeps boot snappy; users that
 * never call hub features pay zero overhead.
 */

"use strict";

const path = require("node:path");
const fs = require("node:fs");
const { app } = require("electron");
const { logger } = require("../utils/logger.js");

const {
  LocalVault,
  AdapterRegistry,
  AnalysisEngine,
  MockAdapter,
  CcLLMAdapter,
  CcKgSink,
  CcRagSink,
  FileKeyProvider,
  generateKeyHex,
  EmailAdapter,
  AlipayBillAdapter,
  SystemDataAndroidAdapter,
  ingestSystemDataAndroidSnapshot,
  EntityResolver,
  EntityResolverEmbeddingStage,
  EntityResolverLLMStage,
  EntityResolverWorker,
  runAnalysisSkill,
  ANALYSIS_SKILL_NAMES,
} = require("@chainlesschain/personal-data-hub");
const {
  createAIChatHealthChecker,
} = require("@chainlesschain/personal-data-hub/adapters/ai-chat-history/health-checker");
const {
  getAIChatWizard,
  createAccountsStore: createAIChatAccountsStore,
  createVendorAdapterBridge: createAIChatVendorAdapterBridge,
} = require("./aichat-wizard-factory.js");
const {
  bootstrapWechatAdapter,
  probeWeChatEnv,
} = require("@chainlesschain/personal-data-hub/adapters/wechat");
const {
  loadWechatAccounts,
  saveWechatAccounts,
  scrubForList: scrubWechatRow,
} = require("./wechat-accounts-store.js");

// Resolve user data dir lazily — `app` may not be ready at module-load time.
function resolveHubDir() {
  try {
    return path.join(app.getPath("userData"), ".chainlesschain", "hub");
  } catch (_e) {
    // Fallback for tests / non-Electron contexts
    return path.join(process.cwd(), ".chainlesschain", "hub");
  }
}

// ─── ESM bridge lazy loaders ─────────────────────────────────────────────
// knowledge-graph.js and bm25-search.js live in packages/cli (ESM); desktop
// main is CJS. Dynamic import() works from CJS — we just await once and
// cache the module surface for the rest of the process lifetime.

let _kgModule = null;
async function loadKgModule() {
  if (_kgModule) {
    return _kgModule;
  }
  try {
    _kgModule = await import("@chainlesschain/cli/src/lib/knowledge-graph.js");
    logger.info("[PersonalDataHub] KG module loaded from cli");
  } catch (err) {
    logger.warn(
      "[PersonalDataHub] KG module unavailable — sink will be disabled:",
      err && err.message,
    );
    _kgModule = null;
  }
  return _kgModule;
}

let _bm25Module = null;
async function loadBm25Module() {
  if (_bm25Module) {
    return _bm25Module;
  }
  try {
    _bm25Module = await import("@chainlesschain/cli/src/lib/bm25-search.js");
    logger.info("[PersonalDataHub] BM25 module loaded from cli");
  } catch (err) {
    logger.warn(
      "[PersonalDataHub] BM25 module unavailable — sink will be disabled:",
      err && err.message,
    );
    _bm25Module = null;
  }
  return _bm25Module;
}

// ─── Hub singleton ───────────────────────────────────────────────────────

let _hub = null;
let _initPromise = null;

async function initHub() {
  const hubDir = resolveHubDir();
  fs.mkdirSync(hubDir, { recursive: true });
  fs.mkdirSync(path.join(hubDir, "keys"), { recursive: true });

  // Master key — generated once, persisted under hubDir/keys/vault.key (0600).
  // Phase 4 swap: DPAPI / Keychain wrap.
  const keyProvider = new FileKeyProvider(path.join(hubDir, "keys"));
  const KEY_NAME = "vault:default";
  let key = await keyProvider.get(KEY_NAME);
  if (!key) {
    key = generateKeyHex();
    await keyProvider.set(KEY_NAME, key);
    logger.info("[PersonalDataHub] Generated new vault master key");
  }

  const vault = new LocalVault({
    path: path.join(hubDir, "vault.db"),
    key,
  });
  vault.open();
  logger.info(
    "[PersonalDataHub] Vault opened at",
    path.join(hubDir, "vault.db"),
    "(schema v" + vault.schemaVersion() + ")",
  );

  // LLM via CcLLMAdapter wrapping cc llm-manager singleton.
  let llm = null;
  try {
    const { getLLMManager, LLMProviders } = require("../llm/llm-manager.js");
    const mgr = getLLMManager();
    llm = new CcLLMAdapter({
      chat: (messages, opts) => mgr.chat(messages, opts),
      getActiveProvider: () => mgr.provider,
      // model name lives on the active client; fall back to provider string
      getActiveModel: () => (mgr.client && mgr.client.model) || mgr.provider,
      name: undefined,
      // The cc LLMProviders enum uses uppercase keys (OLLAMA, VOLCENGINE, ...).
      // The active provider field stores the lowercase value, so the default
      // lowercase whitelist in CcLLMAdapter already matches.
    });
    logger.info(
      "[PersonalDataHub] LLM wired:",
      llm.name,
      "(local=" + llm.isLocal + ")",
    );
    // Silence unused-var lint
    void LLMProviders;
  } catch (err) {
    logger.warn(
      "[PersonalDataHub] LLM manager unavailable — analysis will be disabled:",
      err && err.message,
    );
  }

  // KG sink — lazy-loaded from cli (ESM). Best-effort.
  let kgSink = null;
  const kgMod = await loadKgModule();
  if (
    kgMod &&
    typeof kgMod.addEntity === "function" &&
    typeof kgMod.addRelation === "function"
  ) {
    kgSink = new CcKgSink({
      addEntity: kgMod.addEntity,
      addRelation: kgMod.addRelation,
      db: null, // cli KG keeps in-memory state + optional db; null skips persistence
      logger: (...args) => logger.debug("[CcKgSink]", ...args),
    });
  }

  // RAG sink — lazy BM25 (a singleton per-hub).
  let ragSink = null;
  const bm25Mod = await loadBm25Module();
  if (bm25Mod && typeof bm25Mod.BM25Search === "function") {
    const bm25 = new bm25Mod.BM25Search({ language: "auto" });
    ragSink = new CcRagSink({
      bm25,
      logger: (...args) => logger.debug("[CcRagSink]", ...args),
    });
    // Stash on hub instance so future Q&A can query the BM25 corpus for
    // RAG retrieval before LLM call.
    _hubExtras.bm25 = bm25;
  }

  // Phase 8 — EntityResolver with 3-stage pipeline.
  // Stages are lazy: embedding/llm only fire when adapter ingest produces
  // "uncertain" pairs or when the user manually drains the queue.
  const entityResolver = new EntityResolver({ vault });
  // Wire embedding + LLM stages with the existing LLM + Ollama URL.
  try {
    if (llm) {
      const llmStage = new EntityResolverLLMStage({
        llm,
        acceptNonLocal: false,
      });
      entityResolver._llmStage = llmStage.asStageFn();
    }
    const embeddingStage = new EntityResolverEmbeddingStage({
      ollamaUrl: process.env.CC_HUB_OLLAMA_URL || "http://localhost:11434",
      model: process.env.CC_HUB_OLLAMA_EMBED_MODEL || "nomic-embed-text",
      vault,
    });
    entityResolver._embeddingStage = embeddingStage.asStageFn();
    logger.info(
      "[PersonalDataHub] EntityResolver wired: rule + embedding + llm stages",
    );
  } catch (err) {
    logger.warn(
      "[PersonalDataHub] EntityResolver embedding/llm stages unavailable — rule-only:",
      err && err.message,
    );
  }

  // Registry with whatever sinks are available.
  const registry = new AdapterRegistry({
    vault,
    kgSink: kgSink ? kgSink.write.bind(kgSink) : null,
    ragSink: ragSink ? ragSink.write.bind(ragSink) : null,
    entityResolver, // Phase 8.6 — sync-time rule resolution on every ingest
    onSyncEvent: (msg) =>
      logger.debug("[PersonalDataHub sync]", msg.kind, msg.adapter || ""),
  });

  // Analysis engine — only if LLM is available.
  let engine = null;
  if (llm) {
    engine = new AnalysisEngine({
      vault,
      llm,
      // ragRetriever wires BM25.search → vault.getEvent so the engine sees
      // semantically-relevant events outside the strict time-window filter.
      ragRetriever: _hubExtras.bm25
        ? async (question) => {
            try {
              const hits = _hubExtras.bm25.search(question, { topK: 10 });
              return Array.isArray(hits)
                ? hits
                    .map((h) => ({
                      id: h.id || (h.doc && h.doc.id),
                      text: "",
                      metadata: {},
                    }))
                    .filter((d) => d.id)
                : [];
            } catch (e) {
              return [];
            }
          }
        : null,
    });
    logger.info("[PersonalDataHub] AnalysisEngine ready");
  }

  // Phase 5.6: load + auto-register persisted email accounts.
  // File lives at <hubDir>/email-accounts.json. Threat model: same dir
  // holds the vault master key, so the configs are no MORE sensitive
  // than what's already there. Phase 4 will DPAPI/Keychain-wrap both.
  const emailAccountsPath = path.join(hubDir, "email-accounts.json");
  const emailAccounts = loadEmailAccounts(emailAccountsPath);
  for (const cfg of emailAccounts) {
    try {
      const adapter = new EmailAdapter({
        account: cfg.account,
        ...(cfg.opts || {}),
      });
      registry.register(adapter);
      logger.info(
        "[PersonalDataHub] auto-registered email account",
        cfg.account.email,
        "(name=" + adapter.name + ")",
      );
    } catch (err) {
      logger.warn(
        "[PersonalDataHub] failed to auto-register email account",
        cfg.account && cfg.account.email,
        err && err.message,
      );
    }
  }

  // Plan A — register SystemDataAndroidAdapter on every desktop boot. Adapter
  // is dual-mode (snapshot inputPath OR bridge.invoke); desktop always uses
  // snapshot mode driven by Path C ingest from the paired phone. Safe to
  // register even on a desktop-only deployment — adapter is a no-op until
  // syncAdapter() is called with inputPath.
  try {
    const sda = new SystemDataAndroidAdapter();
    if (!registry.has(sda.name)) {
      registry.register(sda);
    }
  } catch (err) {
    logger.warn(
      "[PersonalDataHub] failed to register system-data-android adapter",
      err && err.message,
    );
  }

  // Phase 6: same file-based persistence for Alipay accounts.
  const alipayAccountsPath = path.join(hubDir, "alipay-accounts.json");
  const alipayAccounts = loadAlipayAccounts(alipayAccountsPath);
  for (const cfg of alipayAccounts) {
    try {
      const adapter = new AlipayBillAdapter({
        account: cfg.account,
        ...(cfg.opts || {}),
      });
      if (!registry.has(adapter.name)) {
        registry.register(adapter);
      }
    } catch (err) {
      logger.warn(
        "[PersonalDataHub] failed to auto-register Alipay account",
        cfg.account && cfg.account.email,
        err && err.message,
      );
    }
  }

  // Phase 10.3.5 — AIChat HealthChecker. Periodically re-validates persisted
  // AIChat cookies against the vendor SPEC so the wizard UI can render the
  // red-dot / "Cookie 过期，请重新登录" affordance without each open requiring
  // a synchronous validate trip. Lazy: the underlying accountsStore reads
  // aichat-accounts.json on each pass — no file work if the user never
  // registered any vendor.
  const aichatAccountsStore = createAIChatAccountsStore({ hubDir });
  const aichatVendorAdapter = createAIChatVendorAdapterBridge();
  const aichatHealthChecker = createAIChatHealthChecker({
    accountsStore: aichatAccountsStore,
    vendorAdapter: aichatVendorAdapter,
  });
  try {
    aichatHealthChecker.start();
  } catch (err) {
    logger.warn(
      "[PersonalDataHub] AIChat HealthChecker start failed:",
      err && err.message,
    );
  }

  // Expose the wizard controller (singleton-cached per hubDir by the
  // factory) so the IPC layer can delegate without re-wiring deps per call.
  const aichatWizard = getAIChatWizard({ hubDir });

  // Phase 12.6.8 — WeChat accounts persistence (mirror Alipay shape).
  // No auto-register on boot: WeChat adapters bind to a `dbPath` that
  // may be a stale temp dir from a previous adb pull; re-instantiate
  // lazily inside registerWechatAdapter so the user sees env-probe
  // results fresh each register call.
  const wechatAccountsPath = path.join(hubDir, "wechat-accounts.json");

  return {
    vault,
    registry,
    engine,
    llm,
    kgSink,
    ragSink,
    hubDir,
    keyProvider,
    emailAccountsPath,
    alipayAccountsPath,
    wechatAccountsPath,
    entityResolver,
    aichatAccountsStore,
    aichatWizard,
    aichatHealthChecker,
    analysisSkillNames: ANALYSIS_SKILL_NAMES,

    /**
     * Phase 10.3.5 — list registered AIChat vendors (scrubbed, no cookie
     * values) for the wizard UI Step 1 to show "已接入" / red-dot. Cookie
     * names are kept (so the UI can hint "cookie 字段已变 / 请刷新"); raw
     * values stay locked in aichat-accounts.json.
     */
    async listAIChatAccounts() {
      const entries = await aichatAccountsStore.list();
      return (entries || []).map((e) => ({
        vendor: e.vendor,
        displayName: e.displayName || e.vendor,
        registeredAt: e.registeredAt || null,
        userId: e.userId || null,
        lastSyncAt: e.lastSyncAt || null,
        lastHealth: e.lastHealth || null,
        cookieSpecVersion: e.cookieSpecVersion || null,
        cookieNames: Object.keys(e.cookies || {}),
      }));
    },

    /**
     * Phase 10.3.5 — drop an AIChat vendor: removes the row from
     * aichat-accounts.json AND (best-effort) clears the partition cookies
     * so the next wizard run starts fresh. Vault events stay queryable.
     */
    async unregisterAIChatVendor(vendor) {
      if (!vendor || typeof vendor !== "string") {
        return { ok: false, reason: "VENDOR_REQUIRED" };
      }
      const before = await aichatAccountsStore.get(vendor);
      if (!before) {
        return { ok: false, reason: "NOT_REGISTERED", vendor };
      }
      await aichatAccountsStore.delete(vendor);
      // Best-effort cookie clear via the wizard's rotate path. We swallow
      // any error — the JSON row removal is the authoritative state.
      try {
        await aichatWizard.rotateLoginPartition({ vendor });
      } catch (err) {
        logger.warn(
          "[PersonalDataHub] AIChat partition clear failed for",
          vendor,
          err && err.message,
        );
      }
      return { ok: true, vendor };
    },

    /**
     * Phase 10.3.5 — manually trigger one health-check pass (used by the
     * wizard's "立即检查" affordance / debugging). Returns the same
     * `{ checked, ok, failed, mismatch }` shape as the timer-driven path.
     */
    async runAIChatHealthCheckOnce() {
      return await aichatHealthChecker.runOnce();
    },

    /** Phase 11 — run a named internal analysis skill */
    async runSkill(name, options = {}) {
      return await runAnalysisSkill({ vault, llm }, name, options);
    },
    // Convenience: register the mock adapter for smoke / dev. Won't be
    // pre-registered by default (lazy on first call).
    registerMockAdapter(opts = {}) {
      if (registry.has("mock")) {
        return registry.get("mock");
      }
      const adapter = new MockAdapter(opts);
      registry.register(adapter);
      return adapter;
    },

    /**
     * Phase 5.6: probe IMAP credentials WITHOUT registering. Returns the
     * adapter's authenticate() result `{ ok, reason?, error? }` so the
     * UI can validate before persisting. The adapter is GC'd after.
     */
    async testEmailAuth({ account }) {
      if (!account || typeof account !== "object") {
        throw new Error("account required");
      }
      const adapter = new EmailAdapter({ account });
      return await adapter.authenticate();
    },

    /**
     * Phase 5.6: register an EmailAdapter + persist its config so it auto-
     * registers on next hub init. `account` shape per EmailAdapter; `opts`
     * passes through (pdfPasswordHints, folders, etc.). Returns the
     * registered adapter's summary.
     */
    async registerEmailAdapter({ account, opts = {} } = {}) {
      if (!account || typeof account !== "object") {
        throw new Error("account required");
      }
      const adapter = new EmailAdapter({ account, ...opts });
      if (registry.has(adapter.name)) {
        throw new Error(
          `adapter name "${adapter.name}" already registered — pick a distinct provider/email`,
        );
      }
      registry.register(adapter);
      const accounts = loadEmailAccounts(emailAccountsPath);
      // De-dupe by adapter name (which encodes email)
      const next = accounts.filter((c) => c.account.email !== account.email);
      next.push({ account, opts, registeredAt: Date.now() });
      saveEmailAccounts(emailAccountsPath, next);
      return {
        name: adapter.name,
        version: adapter.version,
        capabilities: adapter.capabilities,
        sensitivity: adapter.dataDisclosure.sensitivity,
      };
    },

    /**
     * Phase 5.6: unregister an email adapter + remove its persisted config.
     * Vault data is preserved (events stay queryable / askable).
     */
    async unregisterEmailAdapter(emailAddress) {
      const accounts = loadEmailAccounts(emailAccountsPath);
      const target = accounts.find((c) => c.account.email === emailAddress);
      const next = accounts.filter((c) => c.account.email !== emailAddress);
      saveEmailAccounts(emailAccountsPath, next);
      // The adapter is registered under `email-imap` for all; if multiple
      // email accounts existed they would collide. v0 supports a single
      // email at a time (the latest registered wins via duplicate-name
      // guard). Unregister by name.
      if (target) {
        registry.unregister("email-imap");
      }
      return { ok: true, removed: !!target };
    },

    /** Phase 5.6: list persisted email accounts (without authCode). */
    listEmailAccounts() {
      return loadEmailAccounts(emailAccountsPath).map((c) => ({
        email: c.account.email,
        provider: c.account.provider,
        folders: c.account.folders || null,
        registeredAt: c.registeredAt || null,
        pdfPasswordHints:
          c.opts && c.opts.pdfPasswordHints
            ? Object.keys(c.opts.pdfPasswordHints)
            : [],
      }));
    },

    /**
     * Phase 5.6: full event detail — event row + classification + extraction
     * + per-attachment pdfExtraction summary if present. Used by the UI
     * "click a citation" deep-link.
     */
    eventDetail(eventId) {
      const ev = vault.getEvent ? vault.getEvent(eventId) : null;
      if (!ev) {
        return null;
      }
      return {
        event: ev,
        // The classification/extraction/pdfExtraction were stamped onto
        // extra during normalize(); surface them at top of the detail
        // panel so the UI doesn't have to spelunk.
        classification:
          ev.extra && ev.extra.classification ? ev.extra.classification : null,
        extraction:
          ev.extra && ev.extra.fields
            ? {
                template: ev.extra.extractionTemplate,
                confidence: ev.extra.extractionConfidence,
                fields: ev.extra.fields,
                warnings: ev.extra.extractionWarnings || [],
                pdfExtraction: ev.extra.pdfExtraction || null,
              }
            : null,
      };
    },

    // ─── Phase 6 — Alipay bill import ──────────────────────────────────

    /**
     * Register an AlipayBillAdapter and persist the account config.
     * Per-account name is "alipay-bill" (single instance in v0; if a
     * user has multiple Alipay accounts we discriminate by email at
     * import time, not registry name).
     */
    async registerAlipayAdapter({ account, opts = {} } = {}) {
      if (!account || typeof account !== "object") {
        throw new Error("account required");
      }
      const adapter = new AlipayBillAdapter({ account, ...opts });
      if (registry.has(adapter.name)) {
        // Idempotent re-register — update the underlying adapter
        registry.unregister(adapter.name);
      }
      registry.register(adapter);
      const accounts = loadAlipayAccounts(alipayAccountsPath);
      const next = accounts.filter((c) => c.account.email !== account.email);
      next.push({ account, opts, registeredAt: Date.now() });
      saveAlipayAccounts(alipayAccountsPath, next);
      return {
        name: adapter.name,
        version: adapter.version,
        capabilities: adapter.capabilities,
        sensitivity: adapter.dataDisclosure.sensitivity,
      };
    },

    async unregisterAlipayAdapter(email) {
      const accounts = loadAlipayAccounts(alipayAccountsPath);
      const target = accounts.find((c) => c.account.email === email);
      const next = accounts.filter((c) => c.account.email !== email);
      saveAlipayAccounts(alipayAccountsPath, next);
      if (target) {
        registry.unregister("alipay-bill");
      }
      return { ok: true, removed: !!target };
    },

    listAlipayAccounts() {
      return loadAlipayAccounts(alipayAccountsPath).map((c) => ({
        email: c.account.email,
        hasZipPassword: !!(
          c.account.zipPassword ||
          (c.opts && c.opts.zipPassword)
        ),
        registeredAt: c.registeredAt || null,
      }));
    },

    /**
     * Import a single Alipay ZIP / CSV file. Returns the registry's
     * SyncReport (events ingested, KG triples, RAG docs, durationMs).
     * Caller picks the file via OS file picker; the path is what
     * lands here.
     */
    async importAlipayBill({ zipPath, csvPath, zipPassword } = {}) {
      const adapter = registry.get("alipay-bill");
      if (!adapter) {
        throw new Error(
          "No Alipay adapter registered — call registerAlipayAdapter first",
        );
      }
      return await registry.syncAdapter("alipay-bill", {
        zipPath,
        csvPath,
        zipPassword,
      });
    },

    // ─── Phase 12.6.8 — WeChat env-probe + register ──────────────────────
    //
    // env-probe is read-only and exposed unrestricted so the UI can show
    // "your device is missing root" before the user even tries to
    // register. register-wechat / unregister-wechat are wired through
    // ApprovalUI by the mobile-bridge whitelist (privileged channels);
    // local IPC callers (the PDH Vue page) reach them directly here.

    /**
     * Phase 12.6.8 — env-probe wrapper. Returns the raw probe shape so
     * the UI checklist can render every capability (device / root /
     * frida / wechat) independently. `opts.exec` is an injection seam
     * for tests; production omits it (env-probe spawns adb itself).
     */
    async probeWechatEnv(opts = {}) {
      return await probeWeChatEnv({ exec: opts.exec });
    },

    /**
     * Phase 12.6.8 — register a WeChat adapter via bootstrap + persist
     * `wechat-accounts.json`. Idempotent: re-registering the same uin
     * replaces the prior row + unregisters the old adapter instance.
     *
     * Returns the bootstrap shape (`{ ok, reason?, message?, probe, ... }`)
     * augmented with `{ chosenKeyProvider, registeredAt }` on success.
     */
    async registerWechatAdapter(opts = {}) {
      if (!opts || !opts.account || !opts.account.uin) {
        return {
          ok: false,
          reason: "UIN_REQUIRED",
          message: "opts.account.uin required",
        };
      }
      let r;
      try {
        r = await bootstrapWechatAdapter({
          account: opts.account,
          dbPath: opts.dbPath || null,
          wechatDataPath: opts.wechatDataPath || null,
          fridaOpts: opts.fridaOpts || null,
          keyProviderOverride: opts.keyProviderOverride || null,
          exec: opts.exec,
          _probe: opts._probe,
        });
      } catch (err) {
        return {
          ok: false,
          reason: "BOOTSTRAP_THREW",
          message: err && err.message ? err.message : String(err),
        };
      }
      if (!r.ok) {
        return r;
      }

      // Register adapter into registry — idempotent unregister-then-register
      if (registry.has(r.adapter.name)) {
        registry.unregister(r.adapter.name);
      }
      registry.register(r.adapter);

      // Persist (scrubbed) account row
      const accounts = loadWechatAccounts(wechatAccountsPath);
      const next = accounts.filter(
        (c) => !(c.account && c.account.uin === opts.account.uin),
      );
      next.push({
        account: { uin: opts.account.uin },
        dbPath: opts.dbPath || null,
        wechatDataPath: opts.wechatDataPath || null,
        chosenKeyProvider:
          r.keyProvider && r.keyProvider.name ? r.keyProvider.name : null,
        registeredAt: Date.now(),
        lastSyncAt: null,
      });
      saveWechatAccounts(wechatAccountsPath, next);

      return {
        ok: true,
        name: r.adapter.name,
        version: r.adapter.version,
        capabilities: r.adapter.capabilities,
        sensitivity: r.adapter.dataDisclosure.sensitivity,
        chosenKeyProvider: r.keyProvider && r.keyProvider.name,
        probe: r.probe,
        registeredAt: next[next.length - 1].registeredAt,
      };
    },

    async unregisterWechatAdapter(uin) {
      if (!uin || typeof uin !== "string") {
        return { ok: false, reason: "UIN_REQUIRED" };
      }
      const accounts = loadWechatAccounts(wechatAccountsPath);
      const target = accounts.find((c) => c.account && c.account.uin === uin);
      const next = accounts.filter(
        (c) => !(c.account && c.account.uin === uin),
      );
      saveWechatAccounts(wechatAccountsPath, next);
      if (target && registry.has("wechat")) {
        registry.unregister("wechat");
      }
      return { ok: true, removed: !!target, uin };
    },

    /**
     * Phase 12.6.8 — list registered WeChat accounts (scrubbed). Never
     * includes raw key bytes or dbPath contents — just the configured
     * paths and the chosenKeyProvider so the UI can show a row per uin.
     */
    listWechatAccounts() {
      return loadWechatAccounts(wechatAccountsPath).map(scrubWechatRow);
    },
  };
}

const _hubExtras = { bm25: null };

/**
 * Phase 5.6: load persisted email-account configs from disk.
 * File-based JSON; missing / malformed → empty list. Auth codes are
 * stored in plaintext alongside the vault master key — same threat
 * model. Phase 4 will DPAPI/Keychain-wrap both.
 */
function loadEmailAccounts(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return [];
    }
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    logger.warn(
      "[PersonalDataHub] failed to load email-accounts.json — starting empty:",
      err && err.message,
    );
    return [];
  }
}

function saveEmailAccounts(filePath, accounts) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(accounts, null, 2), {
      encoding: "utf-8",
      mode: 0o600, // owner-only read/write
    });
  } catch (err) {
    logger.error(
      "[PersonalDataHub] failed to save email-accounts.json:",
      err && err.message,
    );
    throw err;
  }
}

/**
 * Phase 6: Alipay account persistence (mirrors loadEmailAccounts /
 * saveEmailAccounts). File lives at <hubDir>/alipay-accounts.json with
 * mode 0o600.
 */
function loadAlipayAccounts(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return [];
    }
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    logger.warn(
      "[PersonalDataHub] failed to load alipay-accounts.json — starting empty:",
      err && err.message,
    );
    return [];
  }
}

function saveAlipayAccounts(filePath, accounts) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(accounts, null, 2), {
      encoding: "utf-8",
      mode: 0o600,
    });
  } catch (err) {
    logger.error(
      "[PersonalDataHub] failed to save alipay-accounts.json:",
      err && err.message,
    );
    throw err;
  }
}

/**
 * Idempotent init. Multiple parallel callers will share the same in-flight
 * init promise instead of triggering double-init on the vault.
 */
async function getHub() {
  if (_hub) {
    return _hub;
  }
  if (!_initPromise) {
    _initPromise = initHub()
      .then((h) => {
        _hub = h;
        return h;
      })
      .catch((err) => {
        _initPromise = null;
        logger.error("[PersonalDataHub] init failed:", err && err.message);
        throw err;
      });
  }
  return _initPromise;
}

/**
 * Clean shutdown — flush vault, close handles. Safe to call on a never-
 * initialized hub (no-op).
 */
function close() {
  if (_hub && _hub.aichatHealthChecker) {
    try {
      _hub.aichatHealthChecker.stop();
    } catch (err) {
      logger.warn(
        "[PersonalDataHub] AIChat HealthChecker stop failed:",
        err && err.message,
      );
    }
  }
  if (_hub && _hub.vault) {
    try {
      _hub.vault.close();
      logger.info("[PersonalDataHub] vault closed");
    } catch (err) {
      logger.warn("[PersonalDataHub] vault close failed:", err && err.message);
    }
  }
  _hub = null;
  _initPromise = null;
  _hubExtras.bm25 = null;
  _kgModule = null;
  _bm25Module = null;
}

module.exports = {
  getHub,
  close,
  resolveHubDir,
};
