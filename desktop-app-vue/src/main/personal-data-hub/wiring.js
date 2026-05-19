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

  // Registry with whatever sinks are available.
  const registry = new AdapterRegistry({
    vault,
    kgSink: kgSink ? kgSink.write.bind(kgSink) : null,
    ragSink: ragSink ? ragSink.write.bind(ragSink) : null,
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

  return {
    vault,
    registry,
    engine,
    llm,
    kgSink,
    ragSink,
    hubDir,
    keyProvider,
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
  };
}

const _hubExtras = { bm25: null };

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
