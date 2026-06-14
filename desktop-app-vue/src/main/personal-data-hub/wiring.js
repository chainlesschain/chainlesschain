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
  BrowserHistoryChromeAdapter,
  BrowserHistoryEdgeAdapter,
  VSCodeAdapter,
  WinRecentAdapter,
  GitActivityAdapter,
  ShellHistoryAdapter,
  LocalFilesAdapter,
  BilibiliAdapter,
  WeiboAdapter,
  ZhihuAdapter,
  BossZhipinAdapter,
  CsdnAdapter,
  DongchediAdapter,
  DouyinAdapter,
  XiaohongshuAdapter,
  ToutiaoAdapter,
  KuaishouAdapter,
  QQAdapter,
  WeChatPcAdapter,
  QQPcAdapter,
  AppleHealthAdapter,
  NeteaseMusicAdapter,
  KugouMusicAdapter,
  IqiyiVideoAdapter,
  TencentVideoAdapter,
  WeReadAdapter,
  WpsDocAdapter,
  TencentDocsAdapter,
  BaiduNetdiskAdapter,
  CamScannerDocAdapter,
  DingTalkPcAdapter,
  FeishuPcAdapter,
  BaiduMapAdapter,
  TencentMapAdapter,
  JdAdapter,
  MeituanAdapter,
  PinduoduoAdapter,
  DianpingAdapter,
  Train12306Adapter,
  TaobaoAdapter,
  CtripAdapter,
  TongchengAdapter,
  DidiAdapter,
  AmapAdapter,
  TelegramAdapter,
  WhatsAppAdapter,
  EntityResolver,
  EntityResolverEmbeddingStage,
  EntityResolverLLMStage,
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
  // Phase 1c: hoisted so the hub-level `bilibiliAdbSync` method can reuse
  // the same bridge instance the system-data-android adapter wires below.
  // Mirrors the cli wiring (packages/cli/src/lib/personal-data-hub-wiring.js).
  let desktopAdbBridge = null;
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
  // ADB one-click readiness for the social platforms — mirror of the CLI
  // wiring. One `adb devices` lets readiness() show "已连接手机，点一键采集" vs
  // "请插上 root 手机". Best-effort; never throws into the readiness probe.
  const ADB_ONE_CLICK_NAMES = new Set([
    "social-bilibili",
    "social-weibo",
    "social-douyin",
    "social-xiaohongshu",
    "social-toutiao",
    "social-kuaishou",
  ]);
  const adbReadinessProbe = async () => {
    try {
      const { listDevices } = require("./desktop-adb-bridge");
      const serials = await listDevices();
      return {
        deviceConnected: Array.isArray(serials) && serials.length > 0,
        serial: serials && serials[0],
      };
    } catch (_e) {
      return { deviceConnected: false };
    }
  };

  const registry = new AdapterRegistry({
    vault,
    kgSink: kgSink ? kgSink.write.bind(kgSink) : null,
    ragSink: ragSink ? ragSink.write.bind(ragSink) : null,
    entityResolver, // Phase 8.6 — sync-time rule resolution on every ingest
    onSyncEvent: (msg) =>
      logger.debug("[PersonalDataHub sync]", msg.kind, msg.adapter || ""),
    adbReadiness: {
      probe: adbReadinessProbe,
      oneClickNames: ADB_ONE_CLICK_NAMES,
    },
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
            } catch (_e) {
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

  // Plan A — register SystemDataAndroidAdapter on every desktop boot.
  //
  // 2026-05-24 update: the adapter is now wired with `bridgeProvider` =
  // `desktop-adb-bridge`, which invokes ADB shell commands against the
  // attached developer-mode phone (no root, no in-APK cc needed). When
  // the user clicks 同步 on the desktop UI with no `inputPath`, the
  // adapter auto-engages bridge mode and pulls contacts + app.list via
  // ADB. Snapshot mode (Path C phone-push) still works in parallel —
  // ingestSystemDataAndroidSnapshot writes the JSON then calls
  // syncAdapter() with inputPath, which takes precedence over bridge.
  //
  // If `adb` isn't installed or no device is connected, the bridge
  // throws DESKTOP_ADB_BRIDGE_NOT_AVAILABLE — the registry catches and
  // surfaces it as the sync report's `.error` field (now rendered in
  // the UI alert description after the syncSummary patch).
  try {
    const { createDesktopAdbBridge } = require("./desktop-adb-bridge");
    // Phase 1b: register `bilibili.cookies` extension so the Phase 1c
    // collector can pull WebView cookies from the user's Android Bilibili
    // App. The factory is a pure function — no side effects until the
    // handler is invoked, so cost of always-registering is zero.
    const {
      createBilibiliCookiesExtension,
    } = require("@chainlesschain/personal-data-hub/adapters/social-bilibili-adb");
    // Phase 2a: register `douyin.pull-im-db` extension (mirror of cli wiring).
    const {
      createDouyinDbExtension,
      createDouyinWatchExtension,
    } = require("@chainlesschain/personal-data-hub/adapters/social-douyin-adb");
    // Phase 3a: register `weibo.cookies` extension (mirror of cli wiring).
    const {
      createWeiboCookiesExtension,
    } = require("@chainlesschain/personal-data-hub/adapters/social-weibo-adb");
    // Phase 3c: register `xhs.cookies` extension (mirror of cli wiring).
    const {
      createXhsCookiesExtension,
    } = require("@chainlesschain/personal-data-hub/adapters/social-xiaohongshu-adb");
    // Phase 6c: register `toutiao.cookies` extension (mirror of cli wiring).
    const {
      createToutiaoCookiesExtension,
      createToutiaoAccountExtension,
    } = require("@chainlesschain/personal-data-hub/adapters/social-toutiao-adb");
    // Phase 6d: register `kuaishou.cookies` extension (mirror of cli wiring).
    const {
      createKuaishouCookiesExtension,
    } = require("@chainlesschain/personal-data-hub/adapters/social-kuaishou-adb");
    desktopAdbBridge = createDesktopAdbBridge({
      extensions: {
        "bilibili.cookies": createBilibiliCookiesExtension(),
        "douyin.pull-im-db": createDouyinDbExtension(),
        "douyin.watch-history": createDouyinWatchExtension(),
        "weibo.cookies": createWeiboCookiesExtension(),
        "xhs.cookies": createXhsCookiesExtension(),
        "toutiao.cookies": createToutiaoCookiesExtension(),
        "toutiao.account": createToutiaoAccountExtension(),
        "kuaishou.cookies": createKuaishouCookiesExtension(),
      },
    });
    const sda = new SystemDataAndroidAdapter();
    // SystemDataAndroidAdapter's constructor ignores opts.bridgeProvider
    // and hardcodes `_deps.bridgeProvider = () => null`. Mutate after
    // construction. (Better: teach the adapter to accept the override
    // via constructor opts. Tracked as follow-up.)
    sda._deps.bridgeProvider = () => desktopAdbBridge;
    if (!registry.has(sda.name)) {
      registry.register(sda);
    }
  } catch (err) {
    logger.warn(
      "[PersonalDataHub] failed to register system-data-android adapter",
      err && err.message,
    );
  }

  // Phase 17 (2026-05-24) — desktop Chrome history + bookmarks. Stateless;
  // reads %LOCALAPPDATA%\Google\Chrome\User Data\Default\{History,Bookmarks}
  // on Win (per-platform equivalent on macOS/Linux). authenticate() reports
  // PROFILE_NOT_FOUND when Chrome isn't installed; sync() throws same.
  try {
    const chrome = new BrowserHistoryChromeAdapter();
    if (!registry.has(chrome.name)) {
      registry.register(chrome);
    }
  } catch (err) {
    logger.warn(
      "[PersonalDataHub] failed to register browser-history-chrome adapter",
      err && err.message,
    );
  }

  try {
    const edge = new BrowserHistoryEdgeAdapter();
    if (!registry.has(edge.name)) {
      registry.register(edge);
    }
  } catch (err) {
    logger.warn(
      "[PersonalDataHub] failed to register browser-history-edge adapter",
      err && err.message,
    );
  }

  // VS Code workspace + terminal history. Same desktop-local file-import
  // pattern as the browser adapters.
  try {
    const vscode = new VSCodeAdapter();
    if (!registry.has(vscode.name)) {
      registry.register(vscode);
    }
  } catch (err) {
    logger.warn(
      "[PersonalDataHub] failed to register vscode adapter",
      err && err.message,
    );
  }

  // Windows Recent — Win-only; authenticate() returns PLATFORM_UNSUPPORTED
  // on macOS/Linux which surfaces as a friendly card in the UI.
  try {
    const winRecent = new WinRecentAdapter();
    if (!registry.has(winRecent.name)) {
      registry.register(winRecent);
    }
  } catch (err) {
    logger.warn(
      "[PersonalDataHub] failed to register win-recent adapter",
      err && err.message,
    );
  }

  // Phase 18 — git activity + shell history. Pure local file walks
  // (git log + PSReadLine/.bash_history/.zsh_history). authenticate()
  // returns NO_GIT_REPOS / NO_HISTORY_SOURCES gracefully if absent.
  try {
    const git = new GitActivityAdapter();
    if (!registry.has(git.name)) {
      registry.register(git);
    }
  } catch (err) {
    logger.warn(
      "[PersonalDataHub] failed to register git-activity adapter",
      err && err.message,
    );
  }

  try {
    const shell = new ShellHistoryAdapter();
    if (!registry.has(shell.name)) {
      registry.register(shell);
    }
  } catch (err) {
    logger.warn(
      "[PersonalDataHub] failed to register shell-history adapter",
      err && err.message,
    );
  }

  try {
    const localFiles = new LocalFilesAdapter();
    if (!registry.has(localFiles.name)) {
      registry.register(localFiles);
    }
  } catch (err) {
    logger.warn(
      "[PersonalDataHub] failed to register local-files adapter",
      err && err.message,
    );
  }

  // A8 v0.1 (2026-05-22) — register BilibiliAdapter stateless. Snapshot mode
  // means the desktop registry can ingest a JSON the phone produced (when
  // wired) without needing per-account config files. The Android UI's
  // "Adapter" tab queries this list, so adding here is what makes Bilibili
  // visible alongside system-data-android. Sqlite-mode (legacy Phase 7.5
  // device-pull) still works for desktop users who provide opts.dbPath.
  try {
    const bilibili = new BilibiliAdapter();
    if (!registry.has(bilibili.name)) {
      registry.register(bilibili);
    }
  } catch (err) {
    logger.warn(
      "[PersonalDataHub] failed to register social-bilibili adapter",
      err && err.message,
    );
  }

  // A8 v0.2 (2026-05-22/23) — 11 no-arg snapshot-mode adapters mirroring
  // CLI `personal-data-hub-wiring.js` so desktop IPC and `cc hub sync-adapter`
  // see the same registry. Per `feedback_cross_shell_feature_pattern`: every
  // PDH feature must be reachable via both gateways or the SPA's behaviour
  // diverges across shells. Earlier desktop only wired Bilibili — the other
  // 10 surfaced "AdapterRegistry.syncAdapter: no adapter X" on real device
  // when the Android collector produced staging JSON for them.
  //
  // **No more deferred adapters** — 2026-05-25 final pass made all sqlite/
  // device-pull adapters (Amap/Telegram/WhatsApp) ctor-optional + inputPath
  // alias. The sqlite sync still requires user to pre-extract DB (Telegram
  // unencrypted, WhatsApp needs Crypt key, Amap needs root ADB pull) but the
  // registry slot is claimed so syncAdapter("<name>", path) routes correctly.
  for (const Cls of [
    WeiboAdapter,
    ZhihuAdapter,
    BossZhipinAdapter,
    CsdnAdapter,
    DongchediAdapter,
    DouyinAdapter,
    XiaohongshuAdapter,
    ToutiaoAdapter,
    KuaishouAdapter,
    QQAdapter,
    WeChatPcAdapter,
    QQPcAdapter,
    AppleHealthAdapter,
    NeteaseMusicAdapter,
    KugouMusicAdapter,
    IqiyiVideoAdapter,
    TencentVideoAdapter,
    WeReadAdapter,
    WpsDocAdapter,
    TencentDocsAdapter,
    BaiduNetdiskAdapter,
    CamScannerDocAdapter,
    DingTalkPcAdapter,
    FeishuPcAdapter,
    BaiduMapAdapter,
    TencentMapAdapter,
    JdAdapter,
    MeituanAdapter,
    PinduoduoAdapter,
    DianpingAdapter,
    Train12306Adapter,
    TaobaoAdapter,
    CtripAdapter,
    TongchengAdapter,
    DidiAdapter,
    AmapAdapter,
    TelegramAdapter,
    WhatsAppAdapter,
  ]) {
    try {
      const adapter = new Cls();
      if (!registry.has(adapter.name)) {
        registry.register(adapter);
      }
    } catch (err) {
      logger.warn(
        "[PersonalDataHub] failed to register adapter",
        Cls.name,
        err && err.message,
      );
    }
  }

  // Phase 5.8 — email-imap snapshot mode (2026-05-25): Android
  // EmailLocalCollector does Jakarta Mail IMAP fetch on-device + writes
  // staging JSON; desktop EmailAdapter consumes via snapshot path (no IMAP
  // credentials needed at boot). Skipped when a persisted email-imap
  // account already claimed the slot via the loop at line 308-322 (desktop-
  // direct IMAP wins — the snapshot adapter is just a fallback for the
  // Android-to-desktop path).
  try {
    if (!registry.has("email-imap")) {
      registry.register(new EmailAdapter({ snapshotMode: true }));
    }
  } catch (err) {
    logger.warn(
      "[PersonalDataHub] failed to register email-imap snapshot adapter",
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
      // Phase 5.8 — if the boot-time snapshot stub claimed the "email-imap"
      // slot, swap it out for this per-account IMAP adapter (user's explicit
      // IMAP credentials should take priority over the Android-snapshot
      // fallback). Both share `name === "email-imap"`.
      if (registry.has(adapter.name)) {
        registry.unregister(adapter.name);
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
        // Phase 5.8 — restore the snapshot stub so Android sync paths still
        // work after the user unregisters their explicit IMAP account.
        try {
          registry.register(new EmailAdapter({ snapshotMode: true }));
        } catch (err) {
          logger.warn(
            "[PersonalDataHub] failed to restore email-imap snapshot adapter",
            err && err.message,
          );
        }
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

    // ─── Phase 1e — Bilibili C 路径 dry-run env probe ────────────────────
    //
    // Mirror of cli `bilibiliAdbDoctor`. Probes the cookies path only
    // (no API calls, no vault writes) so the user can confirm env before
    // triggering a sync. Same 9 typed reasons as bilibiliAdbSync.
    async bilibiliAdbDoctor() {
      if (!desktopAdbBridge) {
        return {
          ok: false,
          reason: "BRIDGE_UNAVAILABLE",
          message:
            "desktop-adb-bridge failed to initialize at hub boot — check `adb` is on PATH or set ADB_PATH env var",
        };
      }
      try {
        const result = await desktopAdbBridge.invoke("bilibili.cookies");
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
    // Mirror of cli `bilibiliAdbSync`. Pulls cookies via the bilibili.cookies
    // extension (P1a) → fetches 4 endpoints via BilibiliApiClient (P1b) →
    // writes a snapshot JSON → calls registry.syncAdapter("social-bilibili")
    // to ingest into the vault. Returns `{ok: true, report}` on success or
    // `{ok: false, reason, message}` with a typed reason the UI can pattern-
    // match: BRIDGE_UNAVAILABLE / MODULE_LOAD_FAILED / BILIBILI_NO_ROOT /
    // BILIBILI_NOT_INSTALLED_OR_NEVER_LOGGED_IN / BILIBILI_COOKIES_INCOMPLETE /
    // BILIBILI_COOKIES_TRUNCATED / BILIBILI_NOT_SQLITE / BILIBILI_INVALID_UID /
    // SYNC_FAILED.
    async bilibiliAdbSync(opts = {}) {
      if (!desktopAdbBridge) {
        return {
          ok: false,
          reason: "BRIDGE_UNAVAILABLE",
          message:
            "desktop-adb-bridge failed to initialize at hub boot — check `adb` is on PATH or set ADB_PATH env var",
        };
      }
      let collector;
      try {
        collector = require("@chainlesschain/personal-data-hub/adapters/social-bilibili-adb");
      } catch (err) {
        return {
          ok: false,
          reason: "MODULE_LOAD_FAILED",
          message: err && err.message ? err.message : String(err),
        };
      }
      try {
        const report = await collector.collectAndSync(
          desktopAdbBridge,
          registry,
          opts,
        );
        return { ok: true, report };
      } catch (err) {
        const msg = err && err.message ? err.message : String(err);
        const m = msg.match(/^(BILIBILI_[A-Z_]+)/);
        return {
          ok: false,
          reason: m ? m[1] : "SYNC_FAILED",
          message: msg,
        };
      }
    },

    // ─── Phase 3a — Weibo C 路径 one-shot sync ──────────────────────────
    //
    // Mirror of cli `weiboAdbSync`. Pulls m.weibo.cn cookies → fetchUid →
    // 3 endpoints (posts/favourites/follows) → ingests via social-weibo
    // snapshot mode.
    async weiboAdbSync(opts = {}) {
      if (!desktopAdbBridge) {
        return {
          ok: false,
          reason: "BRIDGE_UNAVAILABLE",
          message:
            "desktop-adb-bridge failed to initialize at hub boot — check `adb` is on PATH or set ADB_PATH env var",
        };
      }
      let collector;
      try {
        collector = require("@chainlesschain/personal-data-hub/adapters/social-weibo-adb");
      } catch (err) {
        return {
          ok: false,
          reason: "MODULE_LOAD_FAILED",
          message: err && err.message ? err.message : String(err),
        };
      }
      try {
        const report = await collector.collectAndSync(
          desktopAdbBridge,
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

    // ─── Phase 3c + 6b — Xhs C 路径 one-shot sync ───────────────────────
    //
    // Phase 6b: inject XhsSignBridge so X-S signing hits ~100% (vs
    // ~60% GET / <30% POST without bridge). Bridge spawns a hidden
    // Electron WebContentsView, navigates to xiaohongshu.com, and runs
    // xhs's own `_webmsxyw` signer JS per request. Heavy (~30-50MB heap)
    // — released via shutdown() in collector's finally.
    async xhsAdbSync(opts = {}) {
      if (!desktopAdbBridge) {
        return {
          ok: false,
          reason: "BRIDGE_UNAVAILABLE",
          message:
            "desktop-adb-bridge failed to initialize at hub boot — check `adb` is on PATH or set ADB_PATH env var",
        };
      }
      let collector;
      try {
        collector = require("@chainlesschain/personal-data-hub/adapters/social-xiaohongshu-adb");
      } catch (err) {
        return {
          ok: false,
          reason: "MODULE_LOAD_FAILED",
          message: err && err.message ? err.message : String(err),
        };
      }
      // Phase 6b: create the XhsSignBridge per-sync. Lazy require so
      // cli/test contexts don't try to load Electron-only module at
      // import time.
      let signProvider = null;
      try {
        const { XhsSignBridge } = require("../sign-bridge");
        signProvider = new XhsSignBridge({
          onWarn: (m) => logger.warn("[PersonalDataHub] XhsSignBridge:", m),
        });
      } catch (err) {
        logger.warn(
          "[PersonalDataHub] XhsSignBridge load failed — Xhs sync will use ~60% best-effort fallback:",
          err && err.message ? err.message : String(err),
        );
      }
      try {
        const report = await collector.collectAndSync(
          desktopAdbBridge,
          registry,
          { ...opts, signProvider },
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

    // ─── Phase 6c — Toutiao C 路径 one-shot sync ────────────────────────
    //
    // Mirror of cli `toutiaoAdbSync` but with ToutiaoSignBridge injected
    // (Electron WebContentsView running acrawler.js → ~100% _signature
    // hit rate). Bridge is per-sync (released after) — ~30-50MB heap.
    async toutiaoAdbSync(opts = {}) {
      if (!desktopAdbBridge) {
        return {
          ok: false,
          reason: "BRIDGE_UNAVAILABLE",
          message:
            "desktop-adb-bridge failed to initialize at hub boot — check `adb` is on PATH or set ADB_PATH env var",
        };
      }
      let collector;
      try {
        collector = require("@chainlesschain/personal-data-hub/adapters/social-toutiao-adb");
      } catch (err) {
        return {
          ok: false,
          reason: "MODULE_LOAD_FAILED",
          message: err && err.message ? err.message : String(err),
        };
      }
      // Phase 6c: instantiate ToutiaoSignBridge per-sync. Lazy require
      // so non-Electron contexts (cli, tests) don't try to load it.
      let signProvider = null;
      try {
        const { ToutiaoSignBridge } = require("../sign-bridge");
        signProvider = new ToutiaoSignBridge({
          onWarn: (m) => logger.warn("[PersonalDataHub] ToutiaoSignBridge:", m),
        });
      } catch (err) {
        logger.warn(
          "[PersonalDataHub] ToutiaoSignBridge load failed — Toutiao signed endpoints will short-circuit:",
          err && err.message ? err.message : String(err),
        );
      }
      try {
        const report = await collector.collectAndSync(
          desktopAdbBridge,
          registry,
          { ...opts, signProvider },
        );
        return { ok: true, report };
      } catch (err) {
        const msg = err && err.message ? err.message : String(err);
        const m = msg.match(/^(TOUTIAO_[A-Z_]+)/);
        return {
          ok: false,
          reason: m ? m[1] : "SYNC_FAILED",
          message: msg,
        };
      }
    },

    // ─── Phase 6d — Kuaishou C 路径 one-shot sync ───────────────────────
    //
    // Mirror of cli `kuaishouAdbSync` but with KuaishouSignBridge injected
    // (Electron WebContentsView running NS_sig3 SDK → ~100% hit rate on
    // 3 GraphQL endpoints). Bridge per-sync — ~30-50MB heap released
    // after via collector's try/finally shutdown.
    async kuaishouAdbSync(opts = {}) {
      if (!desktopAdbBridge) {
        return {
          ok: false,
          reason: "BRIDGE_UNAVAILABLE",
          message:
            "desktop-adb-bridge failed to initialize at hub boot — check `adb` is on PATH or set ADB_PATH env var",
        };
      }
      let collector;
      try {
        collector = require("@chainlesschain/personal-data-hub/adapters/social-kuaishou-adb");
      } catch (err) {
        return {
          ok: false,
          reason: "MODULE_LOAD_FAILED",
          message: err && err.message ? err.message : String(err),
        };
      }
      // Phase 6d: instantiate KuaishouSignBridge per-sync. Lazy require
      // so non-Electron contexts don't load it at import time.
      let signProvider = null;
      try {
        const { KuaishouSignBridge } = require("../sign-bridge");
        signProvider = new KuaishouSignBridge({
          onWarn: (m) =>
            logger.warn("[PersonalDataHub] KuaishouSignBridge:", m),
        });
      } catch (err) {
        logger.warn(
          "[PersonalDataHub] KuaishouSignBridge load failed — Kuaishou signed endpoints will short-circuit:",
          err && err.message ? err.message : String(err),
        );
      }
      try {
        const report = await collector.collectAndSync(
          desktopAdbBridge,
          registry,
          { ...opts, signProvider },
        );
        return { ok: true, report };
      } catch (err) {
        const msg = err && err.message ? err.message : String(err);
        const m = msg.match(/^(KUAISHOU_[A-Z_]+)/);
        return {
          ok: false,
          reason: m ? m[1] : "SYNC_FAILED",
          message: msg,
        };
      }
    },

    // ─── Phase 6e — Bridge dry-run doctor ───────────────────────────────
    //
    // Spins up each of the 3 Electron WebContentsView sign bridges
    // (Xhs / Toutiao / Kuaishou) in sequence with NO cookie auth,
    // probes for candidate signing globals, times each phase, and
    // returns a structured report. Lets users detect SDK rotation
    // BEFORE starting a real sync — when xhs.js / acrawler.js /
    // NS_sig3 renames its entry function, the doctor surfaces it
    // immediately with actionable detail.
    //
    // No phone needed; just live internet + xiaohongshu.com /
    // toutiao.com / kuaishou.com reachable.
    //
    // Returns `{ok: true, results: {xhs, toutiao, kuaishou}}` where
    // each entry is `{ok, homepageUrl, warmUpMs, probeMs, candidates,
    // anyCandidatePresent}` on success, or `{ok: false, error}` on
    // bridge failure (Electron 32+ check, navigation timeout, etc).
    async bridgeDoctor(_opts = {}) {
      let XhsSignBridge, ToutiaoSignBridge, KuaishouSignBridge;
      try {
        const sb = require("../sign-bridge");
        XhsSignBridge = sb.XhsSignBridge;
        ToutiaoSignBridge = sb.ToutiaoSignBridge;
        KuaishouSignBridge = sb.KuaishouSignBridge;
      } catch (err) {
        return {
          ok: false,
          reason: "MODULE_LOAD_FAILED",
          message: err && err.message ? err.message : String(err),
        };
      }
      const platforms = [
        ["xhs", XhsSignBridge],
        ["toutiao", ToutiaoSignBridge],
        ["kuaishou", KuaishouSignBridge],
      ];
      const results = {};
      for (const [key, Klass] of platforms) {
        const bridge = new Klass({
          onWarn: (m) => logger.warn(`[bridge-doctor:${key}]`, m),
        });
        const homepageUrl = bridge.homepageUrl;
        const startWarm = Date.now();
        try {
          // Empty cookie — we just want to load the page + check globals
          // existence. Anti-bot SDKs load even for anonymous visitors.
          await bridge.warmUp("");
          const warmUpMs = Date.now() - startWarm;
          const startProbe = Date.now();
          const probe = await bridge.probe();
          const probeMs = Date.now() - startProbe;
          results[key] = {
            ok: true,
            homepageUrl,
            warmUpMs,
            probeMs,
            candidates: probe.candidates,
            anyCandidatePresent: probe.anyPresent,
            probeError: probe.error || null,
          };
        } catch (err) {
          results[key] = {
            ok: false,
            homepageUrl,
            error: err && err.message ? err.message : String(err),
          };
        } finally {
          try {
            await bridge.shutdown();
          } catch (_e) {
            // best-effort
          }
        }
      }
      return { ok: true, results };
    },

    // ─── Phase 2a — Douyin C 路径 one-shot sync ─────────────────────────
    //
    // Mirror of cli `douyinAdbSync`. Pulls <uid>_im.db cohort via the
    // douyin.pull-im-db extension → parses msg + SIMPLE_USER → ingests
    // via social-douyin snapshot mode.
    async douyinAdbSync(opts = {}) {
      if (!desktopAdbBridge) {
        return {
          ok: false,
          reason: "BRIDGE_UNAVAILABLE",
          message:
            "desktop-adb-bridge failed to initialize at hub boot — check `adb` is on PATH or set ADB_PATH env var",
        };
      }
      let collector;
      try {
        collector = require("@chainlesschain/personal-data-hub/adapters/social-douyin-adb");
      } catch (err) {
        return {
          ok: false,
          reason: "MODULE_LOAD_FAILED",
          message: err && err.message ? err.message : String(err),
        };
      }
      try {
        const report = await collector.collectAndSync(
          desktopAdbBridge,
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
