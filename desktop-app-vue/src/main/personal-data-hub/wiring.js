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
  EntityResolver,
  EntityResolverEmbeddingStage,
  EntityResolverLLMStage,
  EntityResolverWorker,
} = require("@chainlesschain/personal-data-hub");

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
    entityResolver,
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
