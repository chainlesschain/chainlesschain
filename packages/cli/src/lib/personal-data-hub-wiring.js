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
import wechatAdapterModule from "@chainlesschain/personal-data-hub/adapters/wechat";
const { bootstrapWechatAdapter, probeWeChatEnv } = wechatAdapterModule;
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
  SystemDataAndroidAdapter,
  BrowserHistoryChromeAdapter,
  BrowserHistoryEdgeAdapter,
  VSCodeAdapter,
  WinRecentAdapter,
  GitActivityAdapter,
  ShellHistoryAdapter,
  LocalFilesAdapter,
  BilibiliAdapter,
  WeiboAdapter,
  DouyinAdapter,
  XiaohongshuAdapter,
  ToutiaoAdapter,
  KuaishouAdapter,
  QQAdapter,
  BaiduMapAdapter,
  TencentMapAdapter,
  JdAdapter,
  MeituanAdapter,
  PinduoduoAdapter,
  Train12306Adapter,
  TaobaoAdapter,
  CtripAdapter,
  AmapAdapter,
  TelegramAdapter,
  WhatsAppAdapter,
  EntityResolver,
  EntityResolverEmbeddingStage,
  EntityResolverLLMStage,
  runAnalysisSkill,
  ANALYSIS_SKILL_NAMES,
} = hub;
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { getElectronUserDataDir } from "./paths.js";

import {
  getAIChatWizard,
  createAccountsStore as createAIChatAccountsStore,
  createVendorAdapterBridge as createAIChatVendorAdapterBridge,
} from "./personal-data-hub-aichat-wizard.js";

async function loadAIChatHealthChecker() {
  // Composed-at-runtime specifier so vite import-analysis (which fails
  // to resolve subpath exports for dynamic imports in vitest SSR mode)
  // skips this — the static scanner only descends into string literals.
  const spec =
    "@chainlesschain/personal-data-hub" +
    "/adapters/ai-chat-history/health-checker";
  const mod = await import(spec);
  return (mod.default || mod).createAIChatHealthChecker;
}

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

// LLM override — see file header. Default cli-side hub uses a direct
// OllamaClient; when the desktop main process embeds this wiring via
// ws-cli-loader it can inject a CcLLMAdapter (wrapping LLMManager) so the
// SAME wiring honors the user's active provider (volcengine / anthropic /
// etc.) instead of hard-binding Ollama. Must be set BEFORE the first
// getHub() call — initHub() reads it synchronously at the LLM-wiring step.
let _llmOverride = null;

/**
 * Override the default cli-side OllamaClient with a caller-supplied LLM
 * client conforming to the hub's LLMClient contract ({ chat, name, isLocal }).
 *
 * Used by desktop-app-vue web-shell's ws-cli-loader bootstrap: see
 * desktop-app-vue/src/main/web-shell/ws-cli-loader.js. Calling this on
 * an already-initialized hub does NOT swap the live LLM — the override only
 * applies on the next fresh initHub(). Restart the process if you need to
 * change provider mid-session.
 */
export function setHubLLMOverride(llm) {
  _llmOverride = llm || null;
}

export function resolveHubDir() {
  return join(getElectronUserDataDir(), ".chainlesschain", "hub");
}

async function initHub() {
  // Phase 1c: hoisted so the hub-level `bilibiliAdbSync` method can reuse
  // the same bridge instance the system-data-android adapter wires below.
  // Single bridge per hub keeps `bilibili.cookies` extension state /
  // adb path resolution / device picking consistent across callers.
  let hostAdbBridge = null;
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

  // LLM: prefer caller-injected override (desktop web-shell wires CcLLMAdapter
  // wrapping LLMManager so PDH honors the user's saved active provider).
  // Fallback to standalone OllamaClient — connects to localhost:11434.
  // Override the fallback via env CC_HUB_OLLAMA_URL / CC_HUB_OLLAMA_MODEL.
  const llm =
    _llmOverride ||
    new OllamaClient({
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

  // Phase 8 — EntityResolver pipeline
  const entityResolver = new EntityResolver({ vault });
  // Plan A v0.1 — in-APK Android cc has no Ollama on localhost:11434.
  // Every embedding call would TCP-timeout (measured: ~60s extra per sync
  // on Xiaomi 24115RA8EC 2026-05-21). Detect Termux $PREFIX for our APK
  // and skip embedding+LLM stages entirely. Rule-stage still runs; the
  // resolve_queue picks up enqueued pairs later if a host with Ollama is
  // ever attached (e.g. desktop-side replay).
  //
  // 2026-05-25 — broadened the detection. The old startsWith("/data/data/
  // com.chainlesschain.android") missed two cases:
  //   1. /data/user/0/ — on Android 7+ (multi-user), context.filesDir
  //      resolves under /data/user/0/<pkg>/ instead of /data/data/<pkg>/,
  //      so the legacy startsWith never matched on real device.
  //   2. Variant suffixes — com.chainlesschain.android.debug,
  //      .staging, etc. all have a separate package id but should share
  //      the in-APK skip behaviour.
  // Match either path prefix + optional variant suffix in one regex; if
  // the env override is set, honour it unconditionally.
  const isInAppAndroidCc =
    typeof process.env.PREFIX === "string" &&
    /\/com\.chainlesschain\.android(\.[a-z]+)?\//.test(process.env.PREFIX);
  const skipEmbeddings =
    isInAppAndroidCc || process.env.CC_HUB_DISABLE_EMBEDDINGS === "1";
  try {
    if (llm && !skipEmbeddings) {
      const llmStage = new EntityResolverLLMStage({
        llm,
        acceptNonLocal: false,
      });
      entityResolver._llmStage = llmStage.asStageFn();
    }
    if (!skipEmbeddings) {
      const embeddingStage = new EntityResolverEmbeddingStage({
        ollamaUrl: process.env.CC_HUB_OLLAMA_URL || "http://localhost:11434",
        model: process.env.CC_HUB_OLLAMA_EMBED_MODEL || "nomic-embed-text",
        vault,
      });
      entityResolver._embeddingStage = embeddingStage.asStageFn();
    }
  } catch (_err) {
    // Fall back to rule-only — registry still works
  }

  const registry = new AdapterRegistry({
    vault,
    kgSink: kgSink ? kgSink.write.bind(kgSink) : null,
    ragSink: ragSink ? ragSink.write.bind(ragSink) : null,
    entityResolver,
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

  // Plan A v0.1 — Android on-device system-data adapter. Stateless: the UI
  // produces a snapshot JSON via ContentResolver/PackageManager and passes
  // its path through opts.inputPath at sync-time, so registration is a
  // one-shot wire here. Safe to register on every host (no-op until a sync
  // call provides inputPath); future hosts may filter by platform if useful.
  try {
    const sda = new SystemDataAndroidAdapter();
    // Auto-engage host-side ADB bridge: when the UI clicks 同步 with no
    // inputPath, the adapter falls back to bridge mode and pulls
    // contacts + app.list via `adb shell` against the
    // developer-mode-attached phone. The adapter's constructor hardcodes
    // `_deps.bridgeProvider = () => null`, so we mutate after construction.
    // See packages/cli/src/lib/host-adb-bridge.js for the bridge surface
    // + caveats (Windows CRLF parse trap, 0/multi device, ENOENT).
    try {
      const { createHostAdbBridge } = await import("./host-adb-bridge.js");
      // Phase 1b: register `bilibili.cookies` extension so the Phase 1c
      // collector can pull WebView cookies from the user's Android Bilibili
      // App. The factory is a pure function — no side effects until the
      // handler is invoked, so cost of always-registering is zero.
      const { createBilibiliCookiesExtension } =
        await import("@chainlesschain/personal-data-hub/adapters/social-bilibili-adb");
      // Phase 2a: register `douyin.pull-im-db` extension so the
      // douyinAdbSync hub method can pull <uid>_im.db cohort from the
      // user's Android Douyin App.
      const { createDouyinDbExtension } =
        await import("@chainlesschain/personal-data-hub/adapters/social-douyin-adb");
      // Phase 3a: register `weibo.cookies` extension for the Weibo
      // C-path collector (m.weibo.cn cookies + 4 HTTP endpoints).
      const { createWeiboCookiesExtension } =
        await import("@chainlesschain/personal-data-hub/adapters/social-weibo-adb");
      // Phase 3c: register `xhs.cookies` extension for the Xhs C-path
      // collector (xiaohongshu.com cookies + 4 endpoints with X-S sign).
      const { createXhsCookiesExtension } =
        await import("@chainlesschain/personal-data-hub/adapters/social-xiaohongshu-adb");
      hostAdbBridge = createHostAdbBridge({
        extensions: {
          "bilibili.cookies": createBilibiliCookiesExtension(),
          "douyin.pull-im-db": createDouyinDbExtension(),
          "weibo.cookies": createWeiboCookiesExtension(),
          "xhs.cookies": createXhsCookiesExtension(),
        },
      });
      sda._deps.bridgeProvider = () => hostAdbBridge;
    } catch (_e) {
      // Bridge module missing or failed to load — leave snapshot-only.
    }
    if (!registry.has(sda.name)) registry.register(sda);
  } catch (_err) {
    // Boot must continue even if the adapter fails to register; cc hub will
    // surface the absence via list-adapters.
  }

  // Phase 17 (2026-05-24) — desktop Chrome history + bookmarks. Reads
  // %LOCALAPPDATA%\Google\Chrome\User Data\Default\{History,Bookmarks}
  // (Win) / equivalent on macOS/Linux. No bridge, no extension, no
  // network. authenticate() reports PROFILE_NOT_FOUND when Chrome isn't
  // installed; sync() throws same. opts.profilePath overrides default.
  try {
    const chrome = new BrowserHistoryChromeAdapter();
    if (!registry.has(chrome.name)) registry.register(chrome);
  } catch (_err) {
    // Continue boot
  }

  try {
    const edge = new BrowserHistoryEdgeAdapter();
    if (!registry.has(edge.name)) registry.register(edge);
  } catch (_err) {
    // Continue boot
  }

  // VS Code workspace history + global terminal history. Reads
  // %APPDATA%\Code\User\workspaceStorage and \globalStorage\state.vscdb
  // on Win; equivalents on macOS/Linux.
  try {
    const vscode = new VSCodeAdapter();
    if (!registry.has(vscode.name)) registry.register(vscode);
  } catch (_err) {
    // Continue boot
  }

  // Windows Recent — cross-application "what did I open" .lnk timeline.
  // Win-only adapter; authenticate() fails on macOS/Linux with
  // PLATFORM_UNSUPPORTED, which surfaces nicely in the UI.
  try {
    const winRecent = new WinRecentAdapter();
    if (!registry.has(winRecent.name)) registry.register(winRecent);
  } catch (_err) {
    // Continue boot
  }

  // Phase 18 — git activity (commit timeline via local `git log`) +
  // shell history (PSReadLine / bash / zsh history files). Both pure
  // file-import, no network. authenticate() degrades gracefully when
  // no code roots / no history files exist on the host.
  try {
    const git = new GitActivityAdapter();
    if (!registry.has(git.name)) registry.register(git);
  } catch (_err) {
    // Continue boot
  }

  try {
    const shell = new ShellHistoryAdapter();
    if (!registry.has(shell.name)) registry.register(shell);
  } catch (_err) {
    // Continue boot
  }

  try {
    const localFiles = new LocalFilesAdapter();
    if (!registry.has(localFiles.name)) registry.register(localFiles);
  } catch (_err) {
    // Continue boot
  }

  // A8 v0.1 (2026-05-22) — social adapters in snapshot mode. Stateless: the
  // Android UI captures a cookie via in-app WebView, runs OkHttp against the
  // platform's HTTP API, parses the JSON response, writes a snapshot JSON to
  // filesDir/.chainlesschain/staging/, then calls `cc hub sync-adapter <name>
  // --input <path> --json` via LocalCcRunner. The adapter reads the file and
  // yields events; the same registry handles KG + RAG + vault writes — no
  // desktop connection required (this is the desktop-independent path the
  // user repeatedly asked about). Each adapter no-ops at boot when no
  // snapshot has been produced yet.
  try {
    const bilibili = new BilibiliAdapter();
    if (!registry.has(bilibili.name)) registry.register(bilibili);
  } catch (_err) {
    // Continue boot
  }

  // A8 v0.2 (2026-05-22/23) — 11 no-arg snapshot-mode adapters that work
  // identically to Bilibili: Android collector writes filesDir/.chainlesschain/
  // staging/<name>.json, CLI `cc hub sync-adapter <name> --input <path>`
  // reads it; no per-account credential needed at boot. Each wrapped in
  // its own try so one broken ctor doesn't cascade.
  //
  // **No more deferred adapters at boot** — 2026-05-25 final pass made all
  // sqlite/device-pull adapters (Amap/Telegram/WhatsApp) ctor-optional:
  // account.<x> dropped from required, inputPath alias added. The sqlite
  // sync still requires the user to pre-extract the SQLite db (Telegram
  // cache4.db unencrypted; WhatsApp msgstore.db needs WhatsApp Crypt key;
  // Amap amap.db needs root ADB pull) — but the registry slot is now
  // claimed so syncAdapter("<name>", path) routes correctly instead of
  // "no adapter X" silent swallow. v0.2 followup: Android in-APK extractor
  // for these 3 sqlite adapters (depends on root ADB / device-specific
  // Crypt key recovery; previously blocked the whole code path before).
  // Train12306Adapter moved out of deferred (v0.2 added snapshot mode —
  // account.username OPTIONAL, see adapters/travel-12306/index.js:53-56);
  // Android Kyfw12306LocalCollector ships snapshot JSON via
  // ccRunner.syncAdapter("travel-12306", path) — must be registered here
  // or cc returns "unknown adapter" + UI shows misleading "v0.2 补齐" hint.
  // Earlier oversight: v5.0.3.84 wired Telegram + WhatsApp here, but their
  // ctors throw without account args, so they were silently swallowed by
  // try/catch and never actually registered. Removed to make the list
  // accurate.
  for (const Cls of [
    WeiboAdapter,
    DouyinAdapter,
    XiaohongshuAdapter,
    ToutiaoAdapter,
    KuaishouAdapter,
    QQAdapter,
    BaiduMapAdapter,
    TencentMapAdapter,
    JdAdapter,
    MeituanAdapter,
    PinduoduoAdapter,
    Train12306Adapter,
    TaobaoAdapter,
    CtripAdapter,
    AmapAdapter,
    TelegramAdapter,
    WhatsAppAdapter,
  ]) {
    try {
      const adapter = new Cls();
      if (!registry.has(adapter.name)) registry.register(adapter);
    } catch (_err) {
      // Continue boot even if one adapter ctor throws
    }
  }

  // Phase 5.8 — email-imap snapshot mode (2026-05-25): Android
  // EmailLocalCollector does Jakarta Mail IMAP fetch on-device + writes
  // staging JSON; desktop EmailAdapter consumes it via snapshot path
  // (no IMAP-account credential needed at boot). The user-driven
  // `registerEmailAdapter` per-account flow still wires explicit IMAP
  // sessions for desktop-direct IMAP fetch (different code path, both
  // resolve `name === "email-imap"` — registry de-dups by name; the
  // per-account flow wins when the user has registered an account).
  try {
    const emailSnapshot = new EmailAdapter({ snapshotMode: true });
    if (!registry.has(emailSnapshot.name)) registry.register(emailSnapshot);
  } catch (_err) {
    // Continue boot even if snapshot ctor throws (shouldn't happen — no required opts)
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

  // Phase 10.3.5 — AIChat HealthChecker (mirror of desktop wiring). cc ui
  // typically only runs while the user has the web-shell open, but the
  // periodic loop still validates persisted cookies so list-aichat-accounts
  // can surface lastHealth reliably.
  const aichatAccountsStore = createAIChatAccountsStore({ hubDir });
  const aichatVendorAdapter = createAIChatVendorAdapterBridge();
  const createAIChatHealthChecker = await loadAIChatHealthChecker();
  const aichatHealthChecker = createAIChatHealthChecker({
    accountsStore: aichatAccountsStore,
    vendorAdapter: aichatVendorAdapter,
  });
  try {
    aichatHealthChecker.start();
  } catch (_err) {
    // Continue boot even if checker fails to schedule
  }
  const aichatWizard = getAIChatWizard({ hubDir });

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
    aichatAccountsStore,
    aichatWizard,
    aichatHealthChecker,
    analysisSkillNames: ANALYSIS_SKILL_NAMES,
    async runSkill(name, options = {}) {
      return await runAnalysisSkill({ vault, llm }, name, options);
    },
    bm25: _bm25,

    /** Phase 10.3.5 — see desktop wiring for full doc. */
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

    async unregisterAIChatVendor(vendor) {
      if (!vendor || typeof vendor !== "string") {
        return { ok: false, reason: "VENDOR_REQUIRED" };
      }
      const before = await aichatAccountsStore.get(vendor);
      if (!before) {
        return { ok: false, reason: "NOT_REGISTERED", vendor };
      }
      await aichatAccountsStore.delete(vendor);
      try {
        await aichatWizard.rotateLoginPartition({ vendor });
      } catch (_err) {
        // best-effort
      }
      return { ok: true, vendor };
    },

    async runAIChatHealthCheckOnce() {
      return await aichatHealthChecker.runOnce();
    },
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
      // Phase 5.8 — if the boot-time snapshot stub claimed the "email-imap"
      // slot, swap it out for this per-account IMAP adapter (user's explicit
      // IMAP credentials should take priority over the Android-snapshot
      // fallback). Both share `name === "email-imap"`.
      if (registry.has(adapter.name)) {
        registry.unregister(adapter.name);
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
      if (target) {
        registry.unregister("email-imap");
        // Phase 5.8 — restore the snapshot stub so Android sync paths still
        // work after the user unregisters their explicit IMAP account.
        try {
          registry.register(new EmailAdapter({ snapshotMode: true }));
        } catch (_err) {
          // Defensive — snapshot ctor has no required opts so this shouldn't fail
        }
      }
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

    // ─── Phase 12.6.8 — WeChat env-probe + register / unregister / list ──
    //
    // cc ui mirror of the desktop wiring. Same JSON file layout
    // (wechat-accounts.json under hubDir, mode 0o600) so the two shells
    // share registrations when run side-by-side on the same machine.

    async probeWechatEnv(opts = {}) {
      return await probeWeChatEnv({ exec: opts.exec });
    },

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
      if (!r.ok) return r;

      if (registry.has(r.adapter.name)) registry.unregister(r.adapter.name);
      registry.register(r.adapter);

      const wechatAccountsPath = join(hubDir, "wechat-accounts.json");
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
      const wechatAccountsPath = join(hubDir, "wechat-accounts.json");
      const accounts = loadWechatAccounts(wechatAccountsPath);
      const target = accounts.find((c) => c.account && c.account.uin === uin);
      const next = accounts.filter(
        (c) => !(c.account && c.account.uin === uin),
      );
      saveWechatAccounts(wechatAccountsPath, next);
      if (target && registry.has("wechat")) registry.unregister("wechat");
      return { ok: true, removed: !!target, uin };
    },

    listWechatAccounts() {
      const wechatAccountsPath = join(hubDir, "wechat-accounts.json");
      return loadWechatAccounts(wechatAccountsPath).map((row) => ({
        uin: row.account ? row.account.uin : null,
        dbPath: row.dbPath || null,
        hasWechatDataPath: !!row.wechatDataPath,
        chosenKeyProvider: row.chosenKeyProvider || null,
        registeredAt: row.registeredAt || null,
        lastSyncAt: row.lastSyncAt || null,
      }));
    },

    // ─── Phase 1e — Bilibili C 路径 dry-run env probe ────────────────────
    //
    // "Doctor" mode mirrors `cc hub wechat doctor`: runs only the cookies-
    // extraction half of the sync pipeline (no API calls, no vault writes)
    // so the user can confirm root / Bilibili-installed / cookie-complete
    // status before triggering a real sync. Same 9 typed reasons as
    // bilibiliAdbSync — UI maps reasons to the same banners — but with
    // an extra `cookieDiagnostic` payload on success so the doctor can
    // print "found 5 of 5 cookies, no encrypted_value rows skipped, uid=N".
    //
    // Returns one of:
    //   {ok: true, uid, extractedAt, cookieDiagnostic: {cookieCount, hadEncrypted}}
    //   {ok: false, reason, message}  — same reason taxonomy as
    //     bilibiliAdbSync; UI re-uses bilibiliReasonMessage()
    async bilibiliAdbDoctor() {
      if (!hostAdbBridge) {
        return {
          ok: false,
          reason: "BRIDGE_UNAVAILABLE",
          message:
            "host-adb-bridge failed to initialize at hub boot — check `adb` is on PATH or set ADB_PATH env var",
        };
      }
      try {
        const result = await hostAdbBridge.invoke("bilibili.cookies");
        return {
          ok: true,
          uid: result.uid,
          extractedAt: result.extractedAt,
          cookieDiagnostic: result.diagnostic || null,
        };
      } catch (err) {
        const msg = err && err.message ? err.message : String(err);
        const m = msg.match(/^(BILIBILI_[A-Z_]+)/);
        return {
          ok: false,
          reason: m ? m[1] : "PROBE_FAILED",
          message: msg,
        };
      }
    },

    // ─── Phase 1c — Bilibili C 路径 one-shot sync ────────────────────────
    //
    // Pulls cookies via the bilibili.cookies extension (P1a) → fetches
    // history/favourite/dynamic/follow via BilibiliApiClient (P1b) → writes
    // a snapshot JSON → calls registry.syncAdapter("social-bilibili") to
    // ingest into the vault. Always cleans up the staging file even on
    // error. Returns `{ok: true, report}` on success or
    // `{ok: false, reason, message}` on failure with a stable typed reason
    // string the UI can pattern-match (BILIBILI_NO_ROOT /
    // BILIBILI_NOT_INSTALLED_OR_NEVER_LOGGED_IN / BILIBILI_COOKIES_INCOMPLETE
    // / SYNC_FAILED / BRIDGE_UNAVAILABLE).
    async bilibiliAdbSync(opts = {}) {
      if (!hostAdbBridge) {
        return {
          ok: false,
          reason: "BRIDGE_UNAVAILABLE",
          message:
            "host-adb-bridge failed to initialize at hub boot — check `adb` is on PATH or set ADB_PATH env var",
        };
      }
      let collector;
      try {
        const mod =
          await import("@chainlesschain/personal-data-hub/adapters/social-bilibili-adb");
        collector = mod.default ? mod.default : mod;
      } catch (err) {
        return {
          ok: false,
          reason: "MODULE_LOAD_FAILED",
          message: err && err.message ? err.message : String(err),
        };
      }
      try {
        const report = await collector.collectAndSync(
          hostAdbBridge,
          registry,
          opts,
        );
        return { ok: true, report };
      } catch (err) {
        const msg = err && err.message ? err.message : String(err);
        // Extract a typed reason prefix from the BILIBILI_* error codes
        // the cookies-extension throws, falling back to SYNC_FAILED for
        // anything from the API client / registry path.
        const m = msg.match(/^(BILIBILI_[A-Z_]+)/);
        return {
          ok: false,
          reason: m ? m[1] : "SYNC_FAILED",
          message: msg,
        };
      }
    },

    // ─── Phase 2a — Douyin C 路径 one-shot sync ─────────────────────────
    //
    // Pulls <uid>_im.db cohort via the douyin.pull-im-db extension (P2a) →
    // parses msg + SIMPLE_USER (abrignoni DFIR) → writes snapshot →
    // syncAdapter("social-douyin") snapshot mode.
    //
    // 9 typed reason codes: BRIDGE_UNAVAILABLE / MODULE_LOAD_FAILED /
    // DOUYIN_NO_ROOT / DOUYIN_NOT_INSTALLED / DOUYIN_NO_IM_DB /
    // DOUYIN_MULTIPLE_USERS / DOUYIN_PULL_FAILED / DOUYIN_NOT_SQLITE /
    // SYNC_FAILED.
    async douyinAdbSync(opts = {}) {
      if (!hostAdbBridge) {
        return {
          ok: false,
          reason: "BRIDGE_UNAVAILABLE",
          message:
            "host-adb-bridge failed to initialize at hub boot — check `adb` is on PATH or set ADB_PATH env var",
        };
      }
      let collector;
      try {
        const mod =
          await import("@chainlesschain/personal-data-hub/adapters/social-douyin-adb");
        collector = mod.default ? mod.default : mod;
      } catch (err) {
        return {
          ok: false,
          reason: "MODULE_LOAD_FAILED",
          message: err && err.message ? err.message : String(err),
        };
      }
      try {
        const report = await collector.collectAndSync(
          hostAdbBridge,
          registry,
          opts,
        );
        return { ok: true, report };
      } catch (err) {
        const msg = err && err.message ? err.message : String(err);
        const m = msg.match(/^(DOUYIN_[A-Z_]+)/);
        return {
          ok: false,
          reason: m ? m[1] : "SYNC_FAILED",
          message: msg,
        };
      }
    },

    // ─── Phase 3a — Weibo C 路径 one-shot sync ──────────────────────────
    //
    // Pulls m.weibo.cn cookies via the weibo.cookies extension → fetchUid
    // (/api/config — cookie has no inline UID) → 3 endpoints (posts /
    // favourites / follows) → snapshot → syncAdapter("social-weibo")
    // snapshot mode. **No WBI signing** (m.weibo.cn mobile API is
    // sign-less).
    //
    // Typed reason codes: BRIDGE_UNAVAILABLE / MODULE_LOAD_FAILED /
    // WEIBO_NO_ROOT / WEIBO_NOT_INSTALLED / WEIBO_COOKIES_EMPTY /
    // WEIBO_COOKIES_TRUNCATED / WEIBO_NOT_SQLITE / WEIBO_COOKIES_INCOMPLETE /
    // WEIBO_BASE64_PARSE / SYNC_FAILED.
    async weiboAdbSync(opts = {}) {
      if (!hostAdbBridge) {
        return {
          ok: false,
          reason: "BRIDGE_UNAVAILABLE",
          message:
            "host-adb-bridge failed to initialize at hub boot — check `adb` is on PATH or set ADB_PATH env var",
        };
      }
      let collector;
      try {
        const mod =
          await import("@chainlesschain/personal-data-hub/adapters/social-weibo-adb");
        collector = mod.default ? mod.default : mod;
      } catch (err) {
        return {
          ok: false,
          reason: "MODULE_LOAD_FAILED",
          message: err && err.message ? err.message : String(err),
        };
      }
      try {
        const report = await collector.collectAndSync(
          hostAdbBridge,
          registry,
          opts,
        );
        return { ok: true, report };
      } catch (err) {
        const msg = err && err.message ? err.message : String(err);
        const m = msg.match(/^(WEIBO_[A-Z_]+)/);
        return {
          ok: false,
          reason: m ? m[1] : "SYNC_FAILED",
          message: msg,
        };
      }
    },

    // ─── Phase 3c — Xhs C 路径 one-shot sync ────────────────────────────
    //
    // Pulls xiaohongshu.com cookies via xhs.cookies extension → fetchMe
    // (/user/me — no X-S) → 3 endpoints (notes/liked/follows, X-S signed)
    // → snapshot → syncAdapter("social-xiaohongshu") snapshot mode.
    //
    // **X-S signing is best-effort** (~60% GET hit, <30% POST). Endpoint
    // failures tolerated as partial results — lastErrorCode surfaces the
    // 461 X-S rejection so UI can recommend "稍后重试".
    //
    // Typed reason codes: BRIDGE_UNAVAILABLE / MODULE_LOAD_FAILED /
    // XHS_NO_ROOT / XHS_NOT_INSTALLED / XHS_COOKIES_EMPTY /
    // XHS_COOKIES_TRUNCATED / XHS_NOT_SQLITE / XHS_COOKIES_INCOMPLETE /
    // XHS_BASE64_PARSE / SYNC_FAILED.
    async xhsAdbSync(opts = {}) {
      if (!hostAdbBridge) {
        return {
          ok: false,
          reason: "BRIDGE_UNAVAILABLE",
          message:
            "host-adb-bridge failed to initialize at hub boot — check `adb` is on PATH or set ADB_PATH env var",
        };
      }
      let collector;
      try {
        const mod =
          await import("@chainlesschain/personal-data-hub/adapters/social-xiaohongshu-adb");
        collector = mod.default ? mod.default : mod;
      } catch (err) {
        return {
          ok: false,
          reason: "MODULE_LOAD_FAILED",
          message: err && err.message ? err.message : String(err),
        };
      }
      try {
        const report = await collector.collectAndSync(
          hostAdbBridge,
          registry,
          opts,
        );
        return { ok: true, report };
      } catch (err) {
        const msg = err && err.message ? err.message : String(err);
        const m = msg.match(/^(XHS_[A-Z_]+)/);
        return {
          ok: false,
          reason: m ? m[1] : "SYNC_FAILED",
          message: msg,
        };
      }
    },
  };
}

// ─── Phase 12.6.8 — WeChat account persistence helpers (cli mirror) ──────

function loadWechatAccounts(filePath) {
  try {
    if (!existsSync(filePath)) return [];
    const raw = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_err) {
    return [];
  }
}

function saveWechatAccounts(filePath, accounts) {
  writeFileSync(filePath, JSON.stringify(accounts, null, 2), {
    encoding: "utf-8",
    mode: 0o600,
  });
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
  if (_hub && _hub.aichatHealthChecker) {
    try {
      _hub.aichatHealthChecker.stop();
    } catch (_e) {}
  }
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
