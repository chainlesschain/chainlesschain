/**
 * Personal Data Hub — CLI / web-shell wiring.
 *
 * Mirror of desktop-app-vue/src/main/personal-data-hub/wiring.js so the
 * SAME vault is reachable from both the Electron app's IPC channels AND
 * the `cc ui` / `cc serve` web-shell's WS topics. Per memory
 * feedback_cross_shell_feature_pattern: any new feature must be reachable
 * via both gateways or the SPA's behavior diverges across shells.
 *
 * Shared vault path: getElectronUserDataDir() + "/.chainlesschain/hub/"
 * — resolves to the same directory that the Electron app uses, so opening
 * either shell sees the same data. Only ONE process should hold the vault
 * at a time (SQLite WAL allows multi-reader / single-writer, but for v0
 * we assume serial access — Phase 4 will add a file-lock).
 *
 * LLM wiring: cli has no llm-manager singleton — it relies on
 * lib/llm-providers.js + per-command HTTP calls. v0 cli-side hub uses a
 * direct OllamaClient (the hub's standalone fallback). To use the same
 * provider the desktop app uses (Volcengine etc.), pass a custom chat
 * function via the env var CC_HUB_LLM_BASE (Ollama URL) or wire it later
 * when cli ↔ desktop LLM sharing is figured out.
 *
 * KG / RAG wiring: same cli modules the desktop uses via dynamic import —
 * but here we're already in cli, so direct import works.
 */

import { join } from "node:path";
import { mkdirSync } from "node:fs";
// Hub package is CJS; in ESM we default-import then destructure (Node 22
// won't let us name-import a CJS module unless it ships a separate ESM
// shim, which we don't).
import hub from "@chainlesschain/personal-data-hub";
const {
  LocalVault,
  AdapterRegistry,
  AnalysisEngine,
  MockAdapter,
  OllamaClient,
  CcKgSink,
  CcRagSink,
  FileKeyProvider,
  generateKeyHex,
  EmailAdapter,
  AlipayBillAdapter,
} = hub;
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { getElectronUserDataDir } from "./paths.js";

// ─── Lazy ESM imports of cli KG / BM25 ───────────────────────────────────

let _kgMod = null;
async function loadKg() {
  if (_kgMod) return _kgMod;
  try {
    _kgMod = await import("./knowledge-graph.js");
  } catch (_err) {
    _kgMod = null;
  }
  return _kgMod;
}

let _bm25Mod = null;
async function loadBm25() {
  if (_bm25Mod) return _bm25Mod;
  try {
    _bm25Mod = await import("./bm25-search.js");
  } catch (_err) {
    _bm25Mod = null;
  }
  return _bm25Mod;
}

// ─── Hub singleton (CLI process scope) ───────────────────────────────────

let _hub = null;
let _initPromise = null;
let _bm25 = null;

export function resolveHubDir() {
  return join(getElectronUserDataDir(), ".chainlesschain", "hub");
}

async function initHub() {
  const hubDir = resolveHubDir();
  mkdirSync(hubDir, { recursive: true });
  mkdirSync(join(hubDir, "keys"), { recursive: true });

  const keyProvider = new FileKeyProvider(join(hubDir, "keys"));
  const KEY_NAME = "vault:default";
  let key = await keyProvider.get(KEY_NAME);
  if (!key) {
    key = generateKeyHex();
    await keyProvider.set(KEY_NAME, key);
  }

  const vault = new LocalVault({ path: join(hubDir, "vault.db"), key });
  vault.open();

  // LLM: standalone OllamaClient — connects to localhost:11434.
  // Override via env CC_HUB_OLLAMA_URL / CC_HUB_OLLAMA_MODEL.
  const llm = new OllamaClient({
    baseUrl: process.env.CC_HUB_OLLAMA_URL || "http://localhost:11434",
    model: process.env.CC_HUB_OLLAMA_MODEL || "qwen2.5:7b-instruct",
  });

  // KG sink — direct ESM import works here.
  let kgSink = null;
  const kgMod = await loadKg();
  if (
    kgMod &&
    typeof kgMod.addEntity === "function" &&
    typeof kgMod.addRelation === "function"
  ) {
    kgSink = new CcKgSink({
      addEntity: kgMod.addEntity,
      addRelation: kgMod.addRelation,
      db: null,
    });
  }

  // RAG sink — instantiate a BM25 per hub.
  let ragSink = null;
  const bm25Mod = await loadBm25();
  if (bm25Mod && typeof bm25Mod.BM25Search === "function") {
    _bm25 = new bm25Mod.BM25Search({ language: "auto" });
    ragSink = new CcRagSink({ bm25: _bm25 });
  }

  const registry = new AdapterRegistry({
    vault,
    kgSink: kgSink ? kgSink.write.bind(kgSink) : null,
    ragSink: ragSink ? ragSink.write.bind(ragSink) : null,
  });

  const engine = new AnalysisEngine({
    vault,
    llm,
    ragRetriever: _bm25
      ? async (question) => {
          try {
            const hits = _bm25.search(question, { topK: 10 });
            return Array.isArray(hits)
              ? hits
                  .map((h) => ({
                    id: h.id || (h.doc && h.doc.id),
                    text: "",
                    metadata: {},
                  }))
                  .filter((d) => d.id)
              : [];
          } catch (_e) {
            return [];
          }
        }
      : null,
  });

  // Phase 5.6: auto-register persisted email accounts.
  const emailAccountsPath = join(hubDir, "email-accounts.json");
  const emailAccounts = loadEmailAccounts(emailAccountsPath);
  for (const cfg of emailAccounts) {
    try {
      const adapter = new EmailAdapter({
        account: cfg.account,
        ...(cfg.opts || {}),
      });
      registry.register(adapter);
    } catch (_err) {
      // Continue boot even if one config is corrupt
    }
  }

  // Phase 6: auto-register persisted Alipay accounts.
  const alipayAccountsPath = join(hubDir, "alipay-accounts.json");
  const alipayAccounts = loadAlipayAccounts(alipayAccountsPath);
  for (const cfg of alipayAccounts) {
    try {
      const adapter = new AlipayBillAdapter({
        account: cfg.account,
        ...(cfg.opts || {}),
      });
      if (!registry.has(adapter.name)) registry.register(adapter);
    } catch (_err) {
      // Continue boot even if one config is corrupt
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
    bm25: _bm25,
    registerMockAdapter(opts = {}) {
      if (registry.has(opts.name || "mock"))
        return registry.get(opts.name || "mock");
      const adapter = new MockAdapter(opts);
      registry.register(adapter);
      return adapter;
    },

    /** Phase 5.6 — see desktop wiring for full doc */
    async testEmailAuth({ account }) {
      if (!account || typeof account !== "object")
        throw new Error("account required");
      const adapter = new EmailAdapter({ account });
      return await adapter.authenticate();
    },

    async registerEmailAdapter({ account, opts = {} } = {}) {
      if (!account || typeof account !== "object")
        throw new Error("account required");
      const adapter = new EmailAdapter({ account, ...opts });
      if (registry.has(adapter.name)) {
        throw new Error(`adapter name "${adapter.name}" already registered`);
      }
      registry.register(adapter);
      const accounts = loadEmailAccounts(emailAccountsPath);
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

    async unregisterEmailAdapter(emailAddress) {
      const accounts = loadEmailAccounts(emailAccountsPath);
      const target = accounts.find((c) => c.account.email === emailAddress);
      const next = accounts.filter((c) => c.account.email !== emailAddress);
      saveEmailAccounts(emailAccountsPath, next);
      if (target) registry.unregister("email-imap");
      return { ok: true, removed: !!target };
    },

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

    eventDetail(eventId) {
      const ev = vault.getEvent ? vault.getEvent(eventId) : null;
      if (!ev) return null;
      return {
        event: ev,
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

    async registerAlipayAdapter({ account, opts = {} } = {}) {
      if (!account || typeof account !== "object")
        throw new Error("account required");
      const adapter = new AlipayBillAdapter({ account, ...opts });
      if (registry.has(adapter.name)) registry.unregister(adapter.name);
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
      if (target) registry.unregister("alipay-bill");
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

    async importAlipayBill({ zipPath, csvPath, zipPassword } = {}) {
      const adapter = registry.get("alipay-bill");
      if (!adapter)
        throw new Error(
          "No Alipay adapter registered — call registerAlipayAdapter first",
        );
      return await registry.syncAdapter("alipay-bill", {
        zipPath,
        csvPath,
        zipPassword,
      });
    },
  };
}

// ─── Email account persistence (Phase 5.6) ───────────────────────────────

function loadEmailAccounts(filePath) {
  try {
    if (!existsSync(filePath)) return [];
    const raw = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_err) {
    return [];
  }
}

function saveEmailAccounts(filePath, accounts) {
  writeFileSync(filePath, JSON.stringify(accounts, null, 2), {
    encoding: "utf-8",
    mode: 0o600,
  });
}

// ─── Alipay account persistence (Phase 6) ───────────────────────────────

function loadAlipayAccounts(filePath) {
  try {
    if (!existsSync(filePath)) return [];
    const raw = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_err) {
    return [];
  }
}

function saveAlipayAccounts(filePath, accounts) {
  writeFileSync(filePath, JSON.stringify(accounts, null, 2), {
    encoding: "utf-8",
    mode: 0o600,
  });
}

export async function getHub() {
  if (_hub) return _hub;
  if (!_initPromise) {
    _initPromise = initHub()
      .then((h) => {
        _hub = h;
        return h;
      })
      .catch((err) => {
        _initPromise = null;
        throw err;
      });
  }
  return _initPromise;
}

export function close() {
  if (_hub && _hub.vault) {
    try {
      _hub.vault.close();
    } catch (_e) {}
  }
  _hub = null;
  _initPromise = null;
  _bm25 = null;
  _kgMod = null;
  _bm25Mod = null;
}
