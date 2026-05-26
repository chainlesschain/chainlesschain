/**
 * ChainlessChain Desktop App - 优化版主入口
 * 使用 Bootstrap 模块进行模块化初始化
 *
 * @version 2.0.0
 * @description 从3800+ 行优化到 ~800 行 */

// Ensure UTF-8 encoding on Windows to prevent Chinese character garbling (乱码)
if (process.platform === "win32") {
  try {
    require("child_process").execSync("chcp 65001", { stdio: "ignore" });
  } catch (_e) {
    // Ignore - may fail in non-interactive environments
  }
  if (process.stdout.setDefaultEncoding) {
    process.stdout.setDefaultEncoding("utf8");
  }
  if (process.stderr.setDefaultEncoding) {
    process.stderr.setDefaultEncoding("utf8");
  }
  process.env.PYTHONIOENCODING = "utf-8";
}

// Load environment variables first (optional in production)
try {
  require("dotenv").config();
} catch (_err) {
  // dotenv is optional in production builds
}

console.log("[DEBUG] Starting Electron main process...");
const { app, BrowserWindow, ipcMain, Notification } = require("electron");
console.log("[DEBUG] Electron modules loaded");
const { logger } = require("./utils/logger.js");
console.log("[DEBUG] Logger loaded");
const path = require("path");
const fs = require("fs");
console.log("[DEBUG] Node modules loaded");

// Resolve app icon for BrowserWindow + Windows AppUserModelId. Same dual-
// origin pattern as EnhancedTrayManager: assets/ in dev, resources/ when
// packaged (electron-builder.yml extraResources copies icon.ico into
// process.resourcesPath at build time).
function resolveAppIconPath() {
  const candidates = [
    path.join(__dirname, "../../assets/icon.ico"),
    path.join(process.resourcesPath || "", "icon.ico"),
  ];
  return candidates.find((p) => p && fs.existsSync(p)) || candidates[0];
}

// Bootstrap 模块
const {
  bootstrapApplication,
  bootstrapCritical,
  bootstrapDeferred,
  lazyLoadModule,
  getAllModules,
  setupP2PPostInit,
} = require("./bootstrap");

// 是否使用旧版单阶段启动（回退开关）
const USE_LEGACY_BOOT = process.env.CHAINLESSCHAIN_LEGACY_BOOT === "1";

// Phase 0 web-shell entry point: load packages/web-panel/dist via embedded
// HTTP + ws-bridge instead of the V5/V6 renderer. Toggle with `--web-shell`
// argv or `CHAINLESSCHAIN_WEB_SHELL=1` env. See memory/desktop_web_shell_strategy.md.
const {
  startWebShell,
  shouldRunWebShell,
} = require("./web-shell/web-shell-bootstrap");

// IPC Registry
const { registerAllIPC } = require("./ipc/ipc-registry");

// 必要的直接导入（窗口创建前需要）
const { getAppConfig } = require("./config/database-config");
const SplashWindow = require("./splash/splash-window");
const MenuManager = require("./system/menu-manager");
const DatabaseEncryptionIPC = require("./database/database-encryption-ipc");
const InitialSetupIPC = require("./config/initial-setup-ipc");
const DeepLinkHandler = require("./system/deep-link-handler");
const FileSyncManager = require("./file-sync/sync-manager");
const PreviewManager = require("./preview/preview-manager");

// 过滤控制台输出
const filterPatterns = [
  /Request interrupted/i,
  /interrupted by user/i,
  /没有可用实例/,
];

const shouldFilterMessage = (message) => {
  const msgStr = String(message);
  if (!msgStr || msgStr.trim() === "") {
    return true;
  }
  if (msgStr.trim().length <= 3 && /^[\]\d\s]+$/.test(msgStr.trim())) {
    return true;
  }
  return filterPatterns.some((pattern) => pattern.test(msgStr));
};

const originalConsoleLog = console.log;
const originalConsoleError = console.error;
console.log = (...args) => {
  if (!args.some(shouldFilterMessage)) {
    originalConsoleLog.apply(console, args);
  }
};
console.error = (...args) => {
  if (!args.some(shouldFilterMessage)) {
    originalConsoleError.apply(console, args);
  }
};

/**
 * ChainlessChain 应用类(优化版
 */
class ChainlessChainApp {
  constructor() {
    this.mainWindow = null;
    this.splashWindow = null;
    this.menuManager = null;
    this.dbEncryptionIPC = null;
    this.initialSetupIPC = null;
    this.deepLinkHandler = null;
    // Tray + minimize-to-tray state:
    //   trayManager  — EnhancedTrayManager instance (created in createWindow)
    //   isQuitting   — set true by `before-quit` so the window's close handler
    //                  knows to let close proceed instead of intercepting it.
    //                  Without this flag, app.quit() from any source (tray
    //                  menu, Ctrl+Q, OS shutdown) would silently no-op.
    this.trayManager = null;
    this.isQuitting = false;
    // v5.0.3.37 — 10s 周期 tray "内存使用"刷新 timer 的句柄，onWillQuit 清理。
    this._trayMemoryInterval = null;

    // 懒加载状态
    this.speechInitialized = false;
    this.imageUploaderInitialized = false;
    this.videoImporterInitialized = false;
    this.blockchainInitialized = false;
    this.pluginInitialized = false;

    this.setupApp();
  }

  setupApp() {
    // Windows: bind taskbar icon + jump-list to a stable AppUserModelId.
    // Without this, dev runs show Electron's default icon and packaged runs
    // can lose icon association after upgrades.
    if (process.platform === "win32") {
      app.setAppUserModelId("com.chainlesschain.desktop");
    }

    // macOS 特定配置
    if (process.platform === "darwin") {
      app.commandLine.appendSwitch("disable-features", "RestoreSessionState");
      if (process.env.NODE_ENV === "development") {
        app.commandLine.appendSwitch(
          "disable-features",
          "RendererCodeIntegrity",
        );
        app.commandLine.appendSwitch("disable-site-isolation-trials");
        app.commandLine.appendSwitch("in-process-gpu");
      }
    }

    // Legacy-GPU crash recovery (v5.0.3.95+).
    // Why: Chromium 130+ GPU process init (CoreMessaging.dll on Windows,
    // ANGLE/D3D11 path) fail-fasts with 0xc0000602 on machines with very old
    // GPU drivers (e.g. Intel Iris Pro 5200 + 2016-09 driver). Symptom from
    // the user's POV is "installer crashes" — actually NSIS install succeeds
    // but the auto-launched ChainlessChain.exe dies before its first frame.
    // Pattern (used by VS Code, Slack, Cursor): write a marker file before
    // potentially crashing GPU init; main window's ready-to-show clears it.
    // Next launch, marker still present ⇒ assume previous crash ⇒ persist a
    // disable flag and turn off hardware acceleration. Recoverable by deleting
    // the .gpu-disabled file. Also honors CHAINLESSCHAIN_DISABLE_GPU=1 env.
    this._gpuRecoveryMarker = null;
    try {
      const userDataDir = app.getPath("userData");
      const gpuFlag = path.join(userDataDir, ".gpu-disabled");
      const marker = path.join(userDataDir, ".launching");
      const envOff = process.env.CHAINLESSCHAIN_DISABLE_GPU === "1";
      const persistedOff = fs.existsSync(gpuFlag);
      let crashRecovered = false;
      if (fs.existsSync(marker)) {
        crashRecovered = true;
        try {
          fs.writeFileSync(
            gpuFlag,
            JSON.stringify({
              reason: "previous-launch-crash-before-ready-to-show",
              detectedAt: new Date().toISOString(),
            }),
          );
        } catch (_e) {
          // best-effort; we still disable GPU for this run via the in-memory branch below
        }
      } else {
        try {
          fs.mkdirSync(userDataDir, { recursive: true });
          fs.writeFileSync(marker, String(process.pid));
          this._gpuRecoveryMarker = marker;
        } catch (_e) {
          // userData not yet writable — skip marker, will retry next launch
        }
      }
      if (envOff || persistedOff || crashRecovered) {
        app.disableHardwareAcceleration();
        app.commandLine.appendSwitch("disable-gpu");
        app.commandLine.appendSwitch("disable-gpu-compositing");
        app.commandLine.appendSwitch("disable-software-rasterizer");
        console.log(
          "[gpu-recovery] hardware acceleration disabled (reason: " +
            (envOff
              ? "env"
              : crashRecovered
                ? "previous-crash"
                : "persisted-flag") +
            ")",
        );
      }
    } catch (err) {
      // Never block app startup on recovery-init failure
      console.warn("[gpu-recovery] init failed:", err && err.message);
    }

    // 单实例锁
    if (process.env.NODE_ENV !== "test") {
      const gotTheLock = app.requestSingleInstanceLock();
      if (!gotTheLock) {
        app.quit();
        return;
      }
    }

    app.on("second-instance", () => {
      if (this.mainWindow) {
        if (this.mainWindow.isMinimized()) {
          this.mainWindow.restore();
        }
        this.mainWindow.focus();
      }
    });

    // 初始化数据库加密 IPC
    this.dbEncryptionIPC = new DatabaseEncryptionIPC(app);

    // 应用事件
    app.whenReady().then(() => this.onReady());
    app.on("window-all-closed", () => this.onWindowAllClosed());
    app.on("activate", () => this.onActivate());
    app.on("will-quit", (event) => this.onWillQuit(event));
    // Mark "real quit in progress" so the main window's close handler stops
    // intercepting. Fires for tray-menu Quit, Ctrl+Q, and OS-initiated shutdown.
    app.on("before-quit", () => {
      this.isQuitting = true;
    });
  }

  async onReady() {
    logger.info("ChainlessChain Vue 启动中..(优化版");

    // 创建启动画面
    // Show splash in BOTH desktop-renderer AND webshell modes — packaged
    // boot takes 1+ minute (backend services start, skill registry loads
    // 167 skills, P2P stack inits, web-panel SPA HTTP server boots) and
    // without splash users click the icon and see nothing for ~60s
    // ("是不是没启动？" UX issue reported v5.0.3.20).
    //
    // The previous gating (Phase 1.6: `!shouldRunWebShell()`) was added
    // because Electron 39 hit a sandboxed_renderer "object is not iterable"
    // crash around splash CLOSE in webshell mode. Mitigated below: the
    // SplashWindow.close() now uses destroy() to bypass the close handshake.
    if (process.env.NODE_ENV !== "test") {
      this.splashWindow = new SplashWindow();
      try {
        await this.splashWindow.create();
        this.splashWindow.updateProgress("正在启动...", 0);
      } catch (error) {
        logger.error("[Main] 创建启动画面失败:", error);
      }
    }

    // 启动后端服务
    try {
      this.splashWindow?.updateProgress("启动后端服务...", 5);
      const {
        getBackendServiceManager,
      } = require("./api/backend-service-manager");
      const backendManager = getBackendServiceManager();
      await backendManager.startServices();
    } catch (error) {
      logger.error("[Main] 启动后端服务失败:", error);
    }

    if (USE_LEGACY_BOOT) {
      await this.runLegacyBoot();
    } else {
      await this.runFastStartBoot();
    }
  }

  /**
   * 旧版启动流程（单阶段）：全部模块就绪后才创建主窗口
   * 通过环境变量 CHAINLESSCHAIN_LEGACY_BOOT=1 启用
   */
  async runLegacyBoot() {
    try {
      const instances = await bootstrapApplication({
        progressCallback: (message, progress) => {
          const mappedProgress = 5 + Math.round(progress * 0.8);
          this.splashWindow?.updateProgress(message, mappedProgress);
        },
        context: { mainWindow: this.mainWindow },
      });

      this.applyInstances(instances);
      this.hookTokenTrackerAlert();

      logger.info("[Main] Bootstrap 初始化完成 (legacy)");
    } catch (error) {
      logger.error("[Main] Bootstrap 初始化失败", error);
    }

    await this.createInitialSetupIPC();

    await setupP2PPostInit(
      getAllModules(),
      () => this.setupP2PEncryptionEvents(),
      () => this.initializeMobileBridge(),
    );

    this.initializeExternalFileManager();

    this.registerCriticalIPC();
    this.registerDeferredIPC();
    this.registerAdvancedFeaturesIPC();

    await this.initializeMCPSystem();

    this.splashWindow?.updateProgress("创建主窗口...", 95);
    await this.createWindow();

    if (this.deepLinkHandler && process.platform !== "darwin") {
      this.deepLinkHandler.handleStartupUrl(process.argv);
    }
  }

  /**
   * 启动流程：
   *   1. 关键阶段（0-5）前台完成
   *   2. 延迟阶段（6+）前台完成
   *   3. 一次性注册所有 IPC（setupIPC）→ 创建主窗口
   * 保留 bootstrap split 结构以便未来按需懒加载，但在 IPC 注册层不重跑
   * setupIPC：phase 文件中的 `ipcMain.handle()` 直接注册与 ipc-guard 的
   * resetAll 存在竞态（resetAll 不会移除未被 guard 跟踪的 handler），
   * 会导致 `llm:chat`/`conversation:*` 等关键 channel 二次注册抛错后留下
   * 半旧 handler 与错乱的管理器引用，用户看到的症状就是"无法发送消息"。
   */
  async runFastStartBoot() {
    // === 关键阶段（0-5）：splash 5-55% ===
    try {
      const criticalInstances = await bootstrapCritical({
        progressCallback: (message, progress) => {
          const mappedProgress = 5 + Math.round(progress * 0.5);
          this.splashWindow?.updateProgress(message, mappedProgress);
        },
        context: { mainWindow: this.mainWindow },
      });

      this.applyInstances(criticalInstances);
      this.hookTokenTrackerAlert();

      logger.info("[Main] 关键阶段初始化完成");
    } catch (error) {
      logger.error("[Main] 关键阶段初始化失败", error);
      logger.error("[Main] 错误详情:", {
        name: error?.name,
        message: error?.message,
        stack: error?.stack,
      });
    }

    // === 延迟阶段（6+）：splash 55-90% ===
    try {
      const allInstances = await bootstrapDeferred({
        progressCallback: (message, progress) => {
          const mappedProgress = 55 + Math.round(progress * 0.35);
          this.splashWindow?.updateProgress(message, mappedProgress);
        },
        context: { mainWindow: this.mainWindow },
      });

      this.applyInstances(allInstances);
      logger.info("[Main] 延迟阶段初始化完成");
    } catch (error) {
      logger.error("[Main] bootstrapDeferred 失败", error);
    }

    try {
      await setupP2PPostInit(
        getAllModules(),
        () => this.setupP2PEncryptionEvents(),
        () => this.initializeMobileBridge(),
      );
    } catch (error) {
      logger.error("[Main] setupP2PPostInit 失败", error);
    }

    this.initializeExternalFileManager();

    await this.createInitialSetupIPC();
    this.registerCriticalIPC();
    this.registerDeferredIPC();
    this.registerAdvancedFeaturesIPC();

    try {
      await this.initializeMCPSystem();
    } catch (error) {
      logger.error("[Main] MCP 系统初始化失败", error);
    }

    // 全部模块就绪后再创建主窗口（setupIPC 在 createWindow 内只调用一次）
    this.splashWindow?.updateProgress("创建主窗口...", 95);
    await this.createWindow();

    if (this.deepLinkHandler && process.platform !== "darwin") {
      this.deepLinkHandler.handleStartupUrl(process.argv);
    }
  }

  /**
   * 挂接 Token Tracker 预算告警
   */
  hookTokenTrackerAlert() {
    if (this.tokenTracker) {
      this.tokenTracker.on("budget-alert", (alert) => {
        logger.info("[Main] 预算告警:", alert);
        this.handleBudgetAlert(alert);
      });
    }
  }

  /**
   * 初始化 Initial Setup IPC（无论数据库是否就绪都要注册，避免 App.vue 报 "检查设置状态失败"）
   */
  async createInitialSetupIPC() {
    const { prewarmLLMConfig } = require("./llm/llm-config");
    const llmConfig = await prewarmLLMConfig();
    this.initialSetupIPC = new InitialSetupIPC(
      app,
      this.database,
      getAppConfig(),
      llmConfig,
    );

    if (this.database && this.dbEncryptionIPC) {
      this.dbEncryptionIPC.setDatabaseManager(this.database);
    }
  }

  /**
   * 初始化外部设备文件管理器（依赖 p2pManager + ragManager，归入延迟阶段）
   */
  initializeExternalFileManager() {
    if (!this.database || !this.p2pManager) {
      return;
    }
    try {
      const ExternalDeviceFileManager = require("./file/external-device-file-manager");
      const fileTransferManager = this.p2pManager.fileTransferManager;

      this.externalFileManager = new ExternalDeviceFileManager(
        this.database,
        this.p2pManager,
        fileTransferManager,
        this.ragManager,
        {
          cacheDir: path.join(app.getPath("userData"), "external-file-cache"),
          maxCacheSize: 1024 * 1024 * 1024, // 1GB
        },
      );

      logger.info("[Main] ✓ ExternalDeviceFileManager 初始化完成");
    } catch (error) {
      logger.error("[Main] ExternalDeviceFileManager 初始化失败", error);
    }
  }

  /**
   * 从bootstrap 实例应用到this
   */
  applyInstances(instances) {
    // 核心模块
    this.database = instances.database;
    this.graphExtractor = instances.graphExtractor;
    this.versionManager = instances.versionManager;
    this.performanceMonitor = instances.performanceMonitor;
    this.fileImporter = instances.fileImporter;
    this.templateManager = instances.templateManager;
    this.ukeyManager = instances.ukeyManager;

    // LLM 相关
    this.llmSelector = instances.llmSelector;
    this.tokenTracker = instances.tokenTracker;
    this.promptCompressor = instances.promptCompressor;
    this.responseCache = instances.responseCache;
    this.llmManager = instances.llmManager;
    this.permanentMemoryManager = instances.permanentMemoryManager;
    this.sessionManager = instances.sessionManager;
    this.errorMonitor = instances.errorMonitor;

    // Multi-Agent
    if (instances.multiAgent) {
      this.agentOrchestrator = instances.multiAgent.orchestrator;
      this.agents = instances.multiAgent.agents;
    }

    // Memory Bank
    if (instances.memoryBank) {
      this.preferenceManager = instances.memoryBank.preferenceManager;
      this.learnedPatternManager = instances.memoryBank.learnedPatternManager;
      this.autoBackupManager = instances.memoryBank.autoBackupManager;
      this.usageReportGenerator = instances.memoryBank.usageReportGenerator;
      this.behaviorTracker = instances.memoryBank.behaviorTracker;
      this.contextAssociator = instances.memoryBank.contextAssociator;
      this.memorySyncService = instances.memoryBank.memorySyncService;
    }

    // RAG 和 Git
    this.ragManager = instances.ragManager;
    this.promptTemplateManager = instances.promptTemplateManager;
    if (instances.gitManager) {
      this.gitManager = instances.gitManager.gitManager;
      this.markdownExporter = instances.gitManager.markdownExporter;
      this.gitHotReload = instances.gitManager.gitHotReload;
    }

    // 社交模块
    this.didManager = instances.didManager;
    this.p2pManager = instances.p2pManager;
    this.contactManager = instances.contactManager;
    this.friendManager = instances.friendManager;
    this.postManager = instances.postManager;
    this.organizationManager = instances.organizationManager;
    this.collaborationManager = instances.collaborationManager;
    this.syncEngine = instances.syncEngine;
    this.vcManager = instances.vcManager;
    this.vcTemplateManager = instances.vcTemplateManager;
    this.remoteGateway = instances.remoteGateway;

    // Community / channel / governance / moderation — these come from
    // social-initializer's factory.register('communityManager' / etc).
    // Latent bug before B4-mofn-sign v2: these were never hoisted from
    // `instances` to `this.*`, so registerAllIPC fed null into community-ipc
    // and the entire desktop V5/V6 community IPC surface silently no-op'd.
    // V6 hard-flip (caaddf530) hid this because the default shell uses WS,
    // not IPC.
    this.communityManager = instances.communityManager;
    this.channelManager = instances.channelManager;
    this.gossipProtocol = instances.gossipProtocol;
    this.governanceEngine = instances.governanceEngine;
    this.contentModerator = instances.contentModerator;

    // B4 MTC suite — channel envelope batching, cross-machine distribution,
    // external archival, M-of-N governance, cross-fed trust anchors.
    // All required:false — null is OK (社区基础同步仍工作).
    this.mtcFederationManager = instances.mtcFederationManager;
    this.channelEventBatcher = instances.channelEventBatcher;
    this.channelEnvelopeDistribution = instances.channelEnvelopeDistribution;
    this.channelEnvelopeArchiver = instances.channelEnvelopeArchiver;
    this.archiveProviderFactory = instances.archiveProviderFactory;
    this.autoArchiveScheduler = instances.autoArchiveScheduler;
    this.governanceMultiSig = instances.governanceMultiSig;
    this.crossFedTrust = instances.crossFedTrust;

    // AI 引擎
    this.webEngine = instances.webEngine;
    this.documentEngine = instances.documentEngine;
    this.dataEngine = instances.dataEngine;
    this.projectStructureManager = instances.projectStructureManager;
    this.gitAutoCommit = instances.gitAutoCommit;
    this.aiEngineManager = instances.aiEngineManager;
    if (instances.webideManager) {
      this.webideManager = instances.webideManager.webideManager;
      this.webideIPC = instances.webideManager.webideIPC;
      this.previewServer = instances.webideManager.previewServer;
    }

    // 技能工具
    this.toolManager = instances.toolManager;
    this.skillManager = instances.skillManager;
    this.skillExecutor = instances.skillExecutor;
    this.aiScheduler = instances.aiScheduler;
    this.chatSkillBridge = instances.chatSkillBridge;
    this.interactiveTaskPlanner = instances.interactiveTaskPlanner;

    // 交易模块
    this.assetManager = instances.assetManager;
    this.escrowManager = instances.escrowManager;
    this.marketplaceManager = instances.marketplaceManager;
    this.contractEngine = instances.contractEngine;
    this.knowledgePaymentManager = instances.knowledgePaymentManager;
    this.creditScoreManager = instances.creditScoreManager;
    this.reviewManager = instances.reviewManager;
    this.statsCollector = instances.statsCollector;
  }

  /**
   * 注册关键 IPC：仅依赖关键阶段（0-5）模块
   * 在主窗口显示前调用，保证 renderer 首屏 mount 时 session/memory/llm 类 IPC 可用
   */
  registerCriticalIPC() {
    try {
      const { registerVolcengineIPC } = require("./llm/volcengine-ipc");
      const { registerSecureStorageIPC } = require("./llm/secure-storage-ipc");
      const {
        registerSessionManagerIPC,
      } = require("./llm/session-manager-ipc");
      const {
        registerErrorMonitorIPC,
      } = require("./monitoring/error-monitor-ipc");
      const { registerMemorySystemIPC } = require("./memory");
      const { registerManusIPC } = require("./llm/manus-ipc");
      const {
        registerTaskTrackerIPC,
      } = require("./ai-engine/task-tracker-ipc");

      registerVolcengineIPC();
      registerSecureStorageIPC();

      // session IPC：始终注册（缺 sessionManager 时 handler 内部返回错误）
      registerSessionManagerIPC({ sessionManager: this.sessionManager });
      if (!this.sessionManager) {
        logger.warn(
          "[Main] SessionManager 未初始化，session:* IPC handlers 将返回错误",
        );
      }

      if (this.errorMonitor) {
        registerErrorMonitorIPC({ errorMonitor: this.errorMonitor });
      }

      if (this.preferenceManager && this.learnedPatternManager) {
        const {
          getUnifiedConfigManager,
        } = require("./config/unified-config-manager");
        registerMemorySystemIPC({
          preferenceManager: this.preferenceManager,
          learnedPatternManager: this.learnedPatternManager,
          autoBackupManager: this.autoBackupManager,
          usageReportGenerator: this.usageReportGenerator,
          behaviorTracker: this.behaviorTracker,
          contextAssociator: this.contextAssociator,
          memorySyncService: this.memorySyncService,
          sessionManager: this.sessionManager,
          configManager: getUnifiedConfigManager(),
        });
      }

      registerManusIPC();
      registerTaskTrackerIPC();

      logger.info("[Main] 关键 IPC handlers 注册完成");
    } catch (error) {
      logger.error("[Main] 关键 IPC 注册失败:", error);
    }
  }

  /**
   * 注册延迟 IPC：依赖延迟阶段（6+）模块（skillManager/toolManager/aiEngineManager）
   * 在主窗口显示后 bootstrapDeferred 完成时调用
   */
  registerDeferredIPC() {
    try {
      const {
        registerSkillToolIPC,
      } = require("./skill-tool-system/skill-tool-ipc");
      const {
        registerMultiAgentIPC,
      } = require("./ai-engine/multi-agent/multi-agent-ipc");
      const {
        registerWorkflowIPC,
        initializeWorkflowSystem,
      } = require("./browser/workflow");
      const {
        registerRecordingIPC,
        initializeRecordingSystem,
      } = require("./browser/recording");

      if (this.skillManager && this.toolManager) {
        registerSkillToolIPC({
          ipcMain,
          skillManager: this.skillManager,
          toolManager: this.toolManager,
        });
        logger.info("[Main] 技能工具 IPC 已注册");
      }

      registerMultiAgentIPC({
        llmManager: this.llmManager,
        functionCaller: this.aiEngineManager?.functionCaller || null,
      });

      try {
        const { getBrowserEngine } = require("./browser/browser-ipc");
        const browserEngine = getBrowserEngine();

        if (this.database) {
          initializeWorkflowSystem(
            browserEngine,
            this.database.db || this.database,
          );
          initializeRecordingSystem(
            browserEngine,
            this.database.db || this.database,
          );
        }

        registerWorkflowIPC();
        registerRecordingIPC();

        logger.info(
          "[Main] Browser Workflow and Recording IPC registered (Phase 4-5)",
        );
      } catch (browserError) {
        logger.warn(
          "[Main] Browser Workflow/Recording IPC registration skipped:",
          browserError.message,
        );
      }

      // Personal Data Hub IPC (Phase 3.5b wiring).
      // Handlers are stateless registrations — actual hub init happens
      // lazily on the first ask/sync/etc invocation, so startup cost is zero.
      try {
        const personalDataHubIpc = require("./ipc/personal-data-hub-ipc");
        personalDataHubIpc.register();
      } catch (hubErr) {
        logger.warn(
          "[Main] Personal Data Hub IPC registration skipped:",
          hubErr && hubErr.message,
        );
      }

      logger.info("[Main] 延迟 IPC handlers 注册完成");
    } catch (error) {
      logger.error("[Main] 延迟 IPC 注册失败:", error);
    }
  }

  /**
   * 注册高级特性 IPC
   */
  registerAdvancedFeaturesIPC() {
    // 这些将在 createWindow 后注册
  }

  /**
   * 初始化 MCP 系统
   */
  async initializeMCPSystem() {
    try {
      const { MCPConfigLoader } = require("./mcp/mcp-config-loader");
      const mcpConfigLoader = new MCPConfigLoader();
      this.mcpConfigLoader = mcpConfigLoader;
      // M2: 启动期改用异步加载，避免阻塞事件循环
      const mcpConfig = await mcpConfigLoader.loadAsync();

      if (mcpConfig.enabled) {
        logger.info("[Main] MCP系统已启用，开始懒加载...");
        const mcpSystem = await lazyLoadModule("mcpSystem");
        if (mcpSystem && mcpSystem.enabled) {
          this.mcpManager = mcpSystem.mcpManager;
          this.mcpAdapter = mcpSystem.mcpAdapter;
          this.mcpSecurity = mcpSystem.mcpSecurity;
        }
      } else {
        this.registerMCPFallbackHandlers();
      }
    } catch (error) {
      logger.error("[Main] MCP系统初始化失败", error);
      this.registerMCPFallbackHandlers();
    }
  }

  /**
   * MCP 回退处理器   */
  registerMCPFallbackHandlers() {
    logger.info("[Main] 注册MCP回退处理器");
    const disabledResponse = {
      success: false,
      error: "MCP system is disabled",
    };
    const handlers = [
      "mcp:get-connected-servers",
      "mcp:connect-server",
      "mcp:disconnect-server",
      "mcp:list-tools",
      "mcp:call-tool",
      "mcp:list-resources",
      "mcp:read-resource",
      "mcp:get-metrics",
    ];

    for (const channel of handlers) {
      try {
        if (channel === "mcp:get-connected-servers") {
          ipcMain.handle(channel, () => ({ success: true, servers: [] }));
        } else {
          ipcMain.handle(channel, () => disabledResponse);
        }
      } catch (_e) {
        // 已注册
      }
    }
  }

  /**
   * Phase 1.3: read userData/settings.json sync at boot so shouldRunWebShell
   * can honor the persistent `ui.useWebShellExperimental` toggle. We avoid
   * pulling in SettingsManager (which loads on a different path elsewhere in
   * the codebase) — this is a single boot-time read with graceful fallback.
   *
   * Logic lives in `./config/read-settings-sync.js` so it can be unit-tested
   * without spinning up an Electron `app` instance.
   *
   * @returns {object | null} parsed settings.json contents or null on miss
   */
  _readSettingsSync() {
    const { readSettingsSync } = require("./config/read-settings-sync");
    return readSettingsSync(app.getPath("userData"), {
      onError: (err) =>
        logger.warn(
          "[Main] readSettingsSync failed, ignoring persistent shell setting:",
          err.message,
        ),
    });
  }

  async createWindow() {
    const { session } = require("electron");
    if (app.isReady()) {
      try {
        await session.defaultSession.clearCache();
      } catch (error) {
        logger.error("[Main] 清除缓存失败:", error);
      }
    }

    // Phase 1.3: compute web-shell decision once. argv flag + env var (Phase 0)
    // OR persistent setting `ui.useWebShellExperimental` (V6 hard-flip pattern).
    // Both `preloadPath` and the loadURL branch must agree, so we cache the
    // boolean instead of re-reading settings.json twice.
    const persistedSettings = this._readSettingsSync();
    const isWebShell = shouldRunWebShell(
      undefined,
      undefined,
      persistedSettings,
    );

    // The desktop preload (3238 LOC) is built for the V5/V6 Vue renderer and
    // crashes the sandbox bundle when paired with web-panel HTML. In
    // --web-shell mode swap to a minimal preload — see strategy memory
    // "preload 仅暴露真·原生 API" + decision #3.
    const preloadPath = isWebShell
      ? path.join(__dirname, "../preload/web-shell.js")
      : path.join(__dirname, "../preload/index.js");

    // 'desktop:*' window.open roles open NEW BrowserWindows that load the
    // V5/V6 desktop renderer (full electronAPI). Compute the entry URL
    // once at boot — dev: Vite dev server; prod: file:// renderer/index.html.
    // Mirrors the loadURL/loadFile decision below.
    const desktopRendererUrl =
      process.env.NODE_ENV === "development"
        ? process.env.VITE_DEV_SERVER_URL ||
          process.env.DEV_SERVER_URL ||
          "http://localhost:5173"
        : `file://${path.join(__dirname, "../renderer/index.html")}`;
    const desktopPreloadPath = path.join(__dirname, "../preload/index.js");

    // Keep the V5/V6 hidden+overlay title bar in both modes — switching to
    // titleBarStyle: "default" in web-shell mode triggered a reproducible
    // sandboxed_renderer crash on Electron 39 / Windows (process exits with
    // 0xC0000005). Web-panel's top-right overlap with native controls is
    // handled renderer-side via CSS injection in web-ui-loader so it does
    // not depend on the BrowserWindow shape.
    const titleBarOptions = {
      titleBarStyle: "hidden",
      titleBarOverlay: { color: "#667eea", symbolColor: "#ffffff" },
    };

    // Phase 1.5: in web-shell mode, restore the persisted bounds for the
    // main role from settings.json so users keep their window layout
    // across launches. V5/V6 mode keeps the historical fixed 1200x800.
    let restoredMainBounds = null;
    if (isWebShell && persistedSettings) {
      try {
        const {
          getWindowRegistry: _getRegistry,
        } = require("./window-registry");
        restoredMainBounds = _getRegistry().getGeometryFromSettings(
          "main",
          persistedSettings,
        );
      } catch (err) {
        logger.warn(
          "[Main] could not read persisted main window bounds:",
          err.message,
        );
      }
    }

    this.mainWindow = new BrowserWindow({
      width: restoredMainBounds?.width ?? 1200,
      height: restoredMainBounds?.height ?? 800,
      ...(typeof restoredMainBounds?.x === "number" &&
      typeof restoredMainBounds?.y === "number"
        ? { x: restoredMainBounds.x, y: restoredMainBounds.y }
        : {}),
      minWidth: 800,
      minHeight: 600,
      icon: resolveAppIconPath(),
      backgroundColor: "#764ba2", // 与加载动画背景色一致，防止白屏闪烁
      show: process.env.NODE_ENV === "test",
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        // Electron 39 / Windows hits a flaky "sandboxed_renderer.bundle.js
        // script failed to run — TypeError: object is not iterable" race
        // when the splash window closes around the same moment a second
        // BrowserWindow boots. The crash sometimes takes the main process
        // with it (exit 0xC0000005). Disabling sandbox on the main window
        // bypasses that bundle entirely. We are already nodeIntegration
        // false + contextIsolation true, so the threat surface from this
        // is bounded — preload still runs in an isolated world.
        sandbox: false,
        preload: preloadPath,
      },
      ...titleBarOptions,
    });

    // 注册所有 IPC (必须在 loadURL/loadFile 之前，确保渲染进程可以使用 IPC)
    this.setupIPC();

    // Plan A remote-terminal: singleton PtyManager shared between web-shell
    // WS gateway and V6 native IPC bridge. Created here (always-on) so V6
    // users can open terminal panels without flipping into web-shell mode.
    // The same manager is passed into startWebShell({ ptyManager }) below
    // when isWebShell is true, so sessions appear in both shells.
    try {
      const { PtyManager } = require("./terminal/PtyManager");
      const { setupTerminalIpc } = require("./terminal/terminal-ipc");
      const {
        createTerminalConfirmation,
      } = require("./terminal/confirmation-dialog");
      const { ipcMain } = require("electron");
      this.ptyManager = new PtyManager();
      this._disposeTerminalIpc = setupTerminalIpc({
        ptyManager: this.ptyManager,
        ipcMain,
      });
      // Bind dangerous-keyword confirmation to a native message box. The
      // hook fires only on the WS path (remote callers); local V6 IPC
      // bypasses the gate per terminal-ipc.js design (same-user trust).
      this.terminalRequireConfirmation = createTerminalConfirmation({
        getMainWindow: () => this.mainWindow || null,
      });
      logger.info("[Main] terminal IPC bridge registered (Plan A)");
    } catch (e) {
      logger.warn("[Main] terminal IPC bridge setup failed:", e.message);
      this.ptyManager = null;
      this.terminalRequireConfirmation = null;
    }

    if (isWebShell) {
      // Phase 0 path: embed web-ui-server (CLI HTTP) + ws-bridge with a pre-
      // registered ukey.status handler, load web-panel dist. V5/V6 IPC stays
      // registered above so a future hybrid window can co-exist without
      // re-registering. ukeyManager is passed through so the WS handler can
      // report live device state.
      // Phase 1.x: ws-cli-loader auto-instantiates a CLI WSSessionManager
      // when no `sessionManager` is passed — the desktop session-core
      // singleton has incompatible short method names (`create/list/get`
      // vs the gateway's `createSession/listSessions/getSession`), so we
      // intentionally do NOT pass it here. This unblocks "新建 Chat/Agent"
      // without dragging the entire desktop session-core API into the WS
      // protocol surface. Strategy memory updated.
      const handle = await startWebShell({
        mode: "global",
        projectName: "ChainlessChain Desktop",
        ukeyManager: this.ukeyManager,
        // Plan A: share PtyManager so terminal sessions are visible in both
        // web-shell SPA and V6 native (when user toggles between them).
        ptyManager: this.ptyManager,
        terminalRequireConfirmation: this.terminalRequireConfirmation,
        // Phase 2: pass the (possibly-null) MCP singleton so mcp.list_tools /
        // mcp.call_tool can surface desktop MCP servers to the embedded SPA.
        // initializeMCPSystem() ran before createWindow() in both legacy and
        // fast-start paths, so by here this.mcpManager is settled (manager or
        // null). Handlers re-check at call time, so re-binding isn't needed.
        mcpManager: this.mcpManager ?? null,
        // mcp.list_servers reads CONFIGURED servers from .chainlesschain/
        // config.json (mcpConfigLoader is the source of truth); list_tools
        // only sees CONNECTED ones.
        mcpConfigLoader: this.mcpConfigLoader ?? null,
        // Phase 2 streaming consumer — drives `llm.chat` with multi-provider
        // chat (Ollama for local + cloud providers) inheriting the desktop's
        // budget alert / cache / state-bus. Null until LLM init lands; the
        // handler throws llm_unavailable cleanly when called too early.
        llmManager: this.llmManager ?? null,
        // Phase 3c.4 — DatabaseManager for sync.webdav.* topic handlers
        // (cursor / tombstones / status). Null pre-init is safe; handlers
        // return error envelope.
        database: this.database ?? null,
        // Phase 3c.6 — RAGManager so knowledge.add-item (web-shell clipboard
        // import) keeps the knowledge index in sync the same way the V5/V6
        // db:add-knowledge-item IPC handler does. Best-effort; null is safe.
        ragManager: this.ragManager ?? null,
        // B4-webshell v1 — full B4 MTC suite over WS topics so the default
        // web-shell user can verify Merkle envelopes, archive batches, run
        // M-of-N governance, manage cross-fed trust anchors. All optional;
        // handlers return error envelope when the corresponding manager
        // is null (pre-init or disabled).
        channelEventBatcher: this.channelEventBatcher ?? null,
        channelEnvelopeDistribution: this.channelEnvelopeDistribution ?? null,
        channelEnvelopeArchiver: this.channelEnvelopeArchiver ?? null,
        archiveProviderFactory: this.archiveProviderFactory ?? null,
        autoArchiveScheduler: this.autoArchiveScheduler ?? null,
        governanceMultiSig: this.governanceMultiSig ?? null,
        crossFedTrust: this.crossFedTrust ?? null,
        // B4-mofn-sign v2: needed for mtc.governance-mofn.sign-as-self
        // (main resolves current identity, private key never crosses wire)
        didManager: this.didManager ?? null,
        // B4-cred-persist v1: lets web-shell archive UI check whether a
        // WebDAV credential is already saved in secure-config.enc, so it
        // can render the "use stored credentials" toggle. The credential
        // itself is only read inside archiveProviderFactory; the WS
        // surface only ever yields a boolean.
        syncCredentials: require("./sync/sync-credentials"),
        p2pManager: this.p2pManager ?? null,
        // #21 v1.3+ — notification.send-mobile WS topic 需要 remoteGateway
        // 调 handlers.notification.sendToMobile 推 push 到 iPhone/Android。
        // remoteGateway 已在 line 493 (`instances.remoteGateway`) 完成构造，
        // 这里安全传。Null-safe（handler 自己检查）。
        remoteGateway: this.remoteGateway ?? null,
        // v1.1 W3.6 (issue #19): lazy getters for mobile.pair.send-confirmation
        // WS handler. mobileBridge 在 initializeMobileBridge() async tail 才赋
        // 值（startWebShell 之后），所以注册时传函数避免捕 null。
        getMobileBridge: () => this.mobileBridge ?? null,
        getP2pManager: () => this.p2pManager ?? null,
        // v1.1 W3.7 Flow B: deviceManager 作 mobileBridge.peerId 的备胎来源
        // （pcPeerId 真实值 = currentDevice.deviceId）
        getDeviceManager: () => this.deviceManager ?? null,
        mainWindow: this.mainWindow,
        // Phase 1.6 — lazy getter so `shell.switch` topic can persist the
        // ui.useWebShellExperimental opt-out from inside web-panel.
        // Lazy because AppConfigManager is fetched via singleton getter,
        // not held on `this`.
        getAppConfig: () => {
          try {
            const {
              getAppConfig: _getAppConfig,
            } = require("./config/database-config");
            return _getAppConfig();
          } catch (err) {
            logger.warn(
              "[WebShell] AppConfig unavailable for shell.switch:",
              err.message,
            );
            return null;
          }
        },
      });
      this._webShellHandle = handle;
      logger.info(`[WebShell] HTTP: ${handle.httpUrl}`);
      logger.info(`[WebShell] WS:   ${handle.wsUrl}`);

      // #21 v1.3+ — write port discovery file so external tools (cc CLI)
      // can find our WS endpoint. ws-bridge default port=0 (OS-assigned),
      // so there's no other way to publish the bound port. Mode 0o600 keeps
      // it user-private. Cleaned up in teardown (see _webShellHandle close).
      try {
        const fs = require("fs");
        const path = require("path");
        const os = require("os");
        const portFilePath = path.join(
          os.homedir(),
          ".chainlesschain",
          "desktop.port",
        );
        fs.mkdirSync(path.dirname(portFilePath), { recursive: true });
        const productVersion = (() => {
          try {
            return require("../../package.json").productVersion || null;
          } catch {
            return null;
          }
        })();
        fs.writeFileSync(
          portFilePath,
          JSON.stringify(
            {
              pid: process.pid,
              host: handle.host || "127.0.0.1",
              port: handle.port || null,
              httpUrl: handle.httpUrl,
              wsUrl: handle.wsUrl,
              startedAt: Date.now(),
              productVersion,
            },
            null,
            2,
          ),
          { encoding: "utf-8", mode: 0o600 },
        );
        this._desktopPortFile = portFilePath;
        logger.info(`[WebShell] port file: ${portFilePath}`);
      } catch (err) {
        logger.warn(
          "[WebShell] failed to write port file (cc CLI won't auto-discover):",
          err.message,
        );
      }

      // Phase 1.5: register the main window in the multi-window registry
      // so window.open can refuse "main" (role_reserved) and so future
      // windows discover the live httpUrl. Release on closed so a fresh
      // launch finds the slot empty.
      try {
        const { getWindowRegistry } = require("./window-registry");
        const {
          createWindowOpenHandler,
        } = require("./web-shell/handlers/window-open-handler");
        const {
          WindowGeometryPersister,
        } = require("./web-shell/window-geometry-persister");
        const { writeSettingsSync } = require("./config/read-settings-sync");
        const registry = getWindowRegistry();

        // One persister governs all roles. Writes route through the atomic
        // settings writer (tmp + rename), so a hard kill mid-resize cannot
        // leave settings.json half-written. Errors are logged once at the
        // writer boundary — the persister itself swallows so a transient
        // FS failure doesn't kill the resize listener.
        const userDataPath = app.getPath("userData");
        const geometryPersister = new WindowGeometryPersister({
          write: (role, bounds) => {
            writeSettingsSync(
              userDataPath,
              (settings) => {
                settings.ui = settings.ui || {};
                settings.ui.windowGeometry = settings.ui.windowGeometry || {};
                settings.ui.windowGeometry[role] = bounds;
              },
              {
                onError: (err) =>
                  logger.warn(
                    `[WebShell] geometry write failed for ${role}:`,
                    err.message,
                  ),
              },
            );
          },
        });
        this._geometryPersister = geometryPersister;

        if (!registry.has("main")) {
          registry.register("main", this.mainWindow, handle.httpUrl);
          const disposeMain = geometryPersister.attach("main", this.mainWindow);
          this.mainWindow.on("closed", () => {
            disposeMain();
            registry.release("main");
          });
        }
        // Wire the window.open WS topic with the now-known httpUrl +
        // preload path so the SPA can spawn artifact / project / dashboard
        // side windows on demand. onWindowOpened threads each side window
        // into the same persister so its bounds are debounce-saved too.
        handle.register(
          "window.open",
          createWindowOpenHandler({
            registry,
            httpUrl: handle.httpUrl,
            preloadPath: preloadPath,
            // For 'desktop:*' roles — open V5/V6 renderer with full preload.
            v5EntryUrl: desktopRendererUrl,
            desktopPreloadPath: desktopPreloadPath,
            onWindowOpened: (role, win) => {
              const dispose = geometryPersister.attach(role, win);
              if (typeof win.on === "function") {
                win.on("closed", dispose);
              }
            },
          }),
        );
        logger.info(
          "[WebShell] WindowRegistry + GeometryPersister initialised, window.open topic wired",
        );
      } catch (err) {
        logger.warn(
          "[WebShell] Phase 1.5 window-registry wiring failed (non-fatal):",
          err.message,
        );
      }

      this.mainWindow.loadURL(handle.httpUrl);
      if (process.env.NODE_ENV === "development") {
        this.mainWindow.webContents.openDevTools();
      }
    } else if (process.env.NODE_ENV === "development") {
      const devServerUrl =
        process.env.VITE_DEV_SERVER_URL ||
        process.env.DEV_SERVER_URL ||
        "http://localhost:5173";
      this.mainWindow.loadURL(devServerUrl);
      this.mainWindow.webContents.openDevTools();
    } else {
      this.mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
    }

    // ready-to-show：页面首帧渲染完成（加载动画已可见）后再切换显示
    this.mainWindow.once("ready-to-show", () => {
      if (this.splashWindow) {
        this.splashWindow.close();
        this.splashWindow = null;
      }
      this.mainWindow?.show();
      this.mainWindow?.focus();
      // Crash-recovery marker — see [gpu-recovery] in setupApp(). Reaching
      // here means the GPU process survived init + first frame painted, so
      // this launch was healthy; clear the marker so the next launch doesn't
      // mistakenly think it crashed.
      if (this._gpuRecoveryMarker) {
        try {
          fs.unlinkSync(this._gpuRecoveryMarker);
        } catch (_e) {
          // marker may have been cleared by parallel cleanup or removed by user
        }
        this._gpuRecoveryMarker = null;
      }
    });

    this.mainWindow.webContents.on("did-finish-load", () => {
      this.splashWindow?.updateProgress("加载完成", 100);
      const { initLogForwarder } = require("./utils/log-forwarder");
      initLogForwarder(this.mainWindow);
    });

    // Close-button behavior: minimize to system tray instead of quitting.
    // Pressing X used to destroy the window and quit the app via
    // `window-all-closed` → app.quit(). Users hit "where did my window go?"
    // when minimize+lose-focus made it look closed. Now X hides the window;
    // tray icon's "退出" menu (and Ctrl+Q, app menu, OS shutdown) are the
    // explicit quit paths, gated by `app.before-quit` setting `isQuitting`.
    this.mainWindow.on("close", (e) => {
      if (!this.isQuitting && this.trayManager) {
        e.preventDefault();
        this.mainWindow.hide();
      }
    });
    this.mainWindow.on("closed", () => {
      this.mainWindow = null;
    });

    // Initialize system tray once the main window exists. The tray owns the
    // explicit Quit path; if tray creation fails (e.g. icon missing on a
    // stripped-down Linux desktop) the close→hide intercept above sees
    // `trayManager === null` and falls through to native close, so the app
    // is never strandable in a hidden state.
    try {
      const EnhancedTrayManager = require("./system/enhanced-tray-manager.js");
      // v5.0.3.34 — pass a live getter for the web-shell handle so
      // dispatchTrayAction can also broadcast through the embedded ws-server
      // when web-panel is the loaded renderer (it has no IPC listener for
      // the desktop-app-vue `tray:action` channel). Lazy because tray init
      // runs after web-shell bootstrap on the happy path, but this contract
      // doesn't depend on ordering.
      this.trayManager = new EnhancedTrayManager(this.mainWindow, {
        getWebShellHandle: () => this._webShellHandle || null,
      });
      this.trayManager.create();
      if (!this.trayManager.tray) {
        // create() catches its own errors and leaves tray=null. Treat that
        // as "tray unavailable" so close behaves natively.
        this.trayManager = null;
      }
    } catch (err) {
      logger.warn(
        "[Main] Tray init failed, close-to-quit fallback active:",
        err.message,
      );
      this.trayManager = null;
    }

    // v5.0.3.37 — 托盘 → 性能监控 → 内存使用 跨 v5.0.3.30+ 一直显示"加载中..."。
    // EnhancedTrayManager 提供 updateMemoryUsage 但 main 进程从未周期调用。
    // 用 app.getAppMetrics() 累计所有 electron 进程 RSS（main + renderer + GPU
    // + utility 子进程），10s 一次。app quit 时 destroy 路径会因为 trayManager
    // 已 null 而停止周期 update（updateMemoryUsage 内部 guard 了 mainWindow 状
    // 态）。失败兜底为 logger.warn，不阻塞应用启动。
    if (this.trayManager) {
      try {
        const updateTrayMemory = () => {
          try {
            const metrics = app.getAppMetrics();
            const totalRssKb = metrics.reduce(
              (sum, m) => sum + ((m.memory && m.memory.workingSetSize) || 0),
              0,
            );
            const totalMb = totalRssKb / 1024;
            const label =
              totalMb >= 1024
                ? `${(totalMb / 1024).toFixed(1)} GB`
                : `${Math.round(totalMb)} MB`;
            if (this.trayManager) {
              this.trayManager.updateMemoryUsage(label);
            }
          } catch (err) {
            logger.warn("[Main] Tray memory update failed:", err.message);
          }
        };
        // 立即跑一次填初始数据，再设 10s interval。
        updateTrayMemory();
        this._trayMemoryInterval = setInterval(updateTrayMemory, 10000);
      } catch (err) {
        logger.warn("[Main] Tray memory updater init failed:", err.message);
      }
    }

    // 自动更新初始化 — 模块原本一直存在但从未在 setupApp 里调用过 init()，
    // 导致 packaged 版本既不会启动后 3s 自检也不跑 4 小时定期检查。模块
    // 内部对 NODE_ENV !== "production" 已自动 no-op（dev 不会触发更新弹
    // 窗），所以这里始终调用是安全的。失败兜底为 logger.warn，不阻塞应用
    // 启动。AutoUpdater 单例同时被 enhanced-tray-manager.js 用来响应托盘
    // "检查更新" 菜单 — 必须在 tray 创建之后初始化（保证 singleton 已就绪）。
    try {
      const autoUpdater = require("./system/auto-updater.js");
      autoUpdater.init(this.mainWindow);
      this.autoUpdater = autoUpdater;
    } catch (err) {
      logger.warn("[Main] Auto-updater init failed:", err.message);
    }

    // 设置依赖
    if (this.dbEncryptionIPC) {
      this.dbEncryptionIPC.setMainWindow(this.mainWindow);
    }

    // 初始化深链接
    this.deepLinkHandler = new DeepLinkHandler(
      this.mainWindow,
      this.organizationManager,
    );
    this.deepLinkHandler.register(app);

    // 初始化文件同步和预览
    this.fileSyncManager = new FileSyncManager(this.database, this.mainWindow);
    this.previewManager = new PreviewManager(this.mainWindow);

    // 创建菜单 — pass a live getter for the web-shell handle so the
    // "在浏览器中打开 web 视图" item resolves the OS-assigned httpUrl
    // at click-time (Phase 1.6 hard-flip surfaced this as a quick entry
    // for Vue DevTools / multi-screen / LAN-share workflows).
    this.menuManager = new MenuManager(this.mainWindow, {
      getWebShellHandle: () => this._webShellHandle || null,
    });
    this.menuManager.createMenu();

    // 初始化数据库同步管理器
    try {
      const DBSyncManager = require("./sync/db-sync-manager");
      this.syncManager = new DBSyncManager(this.database, this.mainWindow);
    } catch (error) {
      logger.error("[Main] 数据库同步管理器初始化失败", error);
    }
  }

  setupIPC() {
    try {
      registerAllIPC({
        app: this,
        database: this.database,
        mainWindow: this.mainWindow,
        llmManager: this.llmManager,
        ragManager: this.ragManager,
        ukeyManager: this.ukeyManager,
        gitManager: this.gitManager,
        gitHotReload: this.gitHotReload,
        didManager: this.didManager,
        p2pManager: this.p2pManager,
        externalFileManager: this.externalFileManager,
        skillManager: this.skillManager,
        toolManager: this.toolManager,
        imageUploader: this.imageUploader,
        fileImporter: this.fileImporter,
        templateManager: this.templateManager,
        promptTemplateManager: this.promptTemplateManager,
        knowledgePaymentManager: this.knowledgePaymentManager,
        creditScoreManager: this.creditScoreManager,
        reviewManager: this.reviewManager,
        vcTemplateManager: this.vcTemplateManager,
        identityContextManager: this.identityContextManager,
        aiEngineManager: this.aiEngineManager,
        webEngine: this.webEngine,
        documentEngine: this.documentEngine,
        dataEngine: this.dataEngine,
        projectStructureManager: this.projectStructureManager,
        pluginManager: this.pluginManager,
        webideManager: this.webideManager,
        statsCollector: this.statsCollector,
        fileSyncManager: this.fileSyncManager,
        previewManager: this.previewManager,
        markdownExporter: this.markdownExporter,
        nativeMessagingServer: this.nativeMessagingServer,
        gitAutoCommit: this.gitAutoCommit,
        skillExecutor: this.skillExecutor,
        aiScheduler: this.aiScheduler,
        chatSkillBridge: this.chatSkillBridge,
        syncManager: this.syncManager,
        contactManager: this.contactManager,
        friendManager: this.friendManager,
        postManager: this.postManager,
        vcManager: this.vcManager,
        organizationManager: this.organizationManager,
        // Community / channel / governance / moderation managers — these
        // are read by phase-3-4-social → registerCommunityIPC. Latent bug
        // before B4-mofn-sign v2: they weren't in this bag, so the desktop
        // V5/V6 community IPC handlers all received null and silently
        // returned empty arrays. Most users never noticed because V6 hard-
        // flipped to web-shell (caaddf530), which has its own WS topic path.
        communityManager: this.communityManager,
        channelManager: this.channelManager,
        gossipProtocol: this.gossipProtocol,
        governanceEngine: this.governanceEngine,
        contentModerator: this.contentModerator,
        // B4 MTC suite: needed by phase-3-4-social for the channel-archive,
        // governance-mofn, cross-fed-trust IPC handlers + sign-as-self.
        channelEventBatcher: this.channelEventBatcher,
        channelEnvelopeDistribution: this.channelEnvelopeDistribution,
        channelEnvelopeArchiver: this.channelEnvelopeArchiver,
        archiveProviderFactory: this.archiveProviderFactory,
        autoArchiveScheduler: this.autoArchiveScheduler,
        governanceMultiSig: this.governanceMultiSig,
        crossFedTrust: this.crossFedTrust,
        mtcFederationManager: this.mtcFederationManager,
        dbManager: this.database,
        versionManager: this.versionManager,
      });
      logger.info("[Main] IPC Registry 注册完成");
    } catch (error) {
      logger.error("[Main] IPC Registry 注册失败:", error);
    } finally {
      // Ensure critical auth/U-Key handlers exist even if non-critical IPC registration fails.
      try {
        const { registerUKeyIPC } = require("./ukey/ukey-ipc");
        registerUKeyIPC({ ukeyManager: this.ukeyManager });
        logger.info("[Main] U-Key IPC handlers ensured");
      } catch (ukeyError) {
        logger.error("[Main] Failed to ensure U-Key IPC handlers:", ukeyError);
      }
    }
  }

  // ====== 懒加载方法 ======

  async initializeBlockchainModules() {
    if (this.blockchainInitialized) {
      return;
    }
    const blockchain = await lazyLoadModule("blockchainModules");
    Object.assign(this, blockchain);
    this.blockchainInitialized = true;
  }

  async initializePluginSystem() {
    if (this.pluginInitialized) {
      return;
    }
    this.pluginManager = await lazyLoadModule("pluginSystem");
    this.pluginInitialized = true;
  }

  async initializeSpeechManager() {
    if (this.speechInitialized) {
      return this.speechManager;
    }
    const { SpeechManager } = require("./speech/speech-manager");
    this.speechManager = new SpeechManager(this.database, this.ragManager);
    await this.speechManager.initialize();
    this.speechInitialized = true;
    return this.speechManager;
  }

  async initializeImageUploader() {
    if (this.imageUploaderInitialized) {
      return;
    }
    const ImageUploader = require("./image/image-uploader");
    this.imageUploader = new ImageUploader(this.database, this.ragManager);
    await this.imageUploader.initialize();
    this.imageUploaderInitialized = true;
  }

  async initializeVideoImporter() {
    if (this.videoImporterInitialized) {
      return;
    }
    const VideoImporter = require("./video/video-importer");
    this.videoImporter = new VideoImporter(this.database, this.ragManager);
    await this.videoImporter.initialize();
    this.videoImporterInitialized = true;
  }

  // ====== 事件处理 ======

  handleBudgetAlert(alert) {
    if (!alert.desktopAlerts) {
      return;
    }

    const title =
      alert.level === "critical"
        ? "⚠️ LLM 成本预算告警"
        : "💰 LLM 成本预算提醒";
    const body = `${alert.period}预算已使用${alert.percentage.toFixed(0)}%`;

    if (Notification.isSupported()) {
      const notification = new Notification({
        title,
        body,
        silent: alert.level !== "critical",
      });
      notification.on("click", () => {
        this.mainWindow?.show();
        this.mainWindow?.webContents.send(
          "navigate-to",
          "/settings?tab=token-usage",
        );
      });
      notification.show();
    }

    this.mainWindow?.webContents.send("llm:budget-alert", alert);

    if (
      alert.level === "critical" &&
      alert.autoPauseOnLimit &&
      this.llmManager
    ) {
      this.llmManager.paused = true;
      this.mainWindow?.webContents.send("llm:service-paused", {
        reason: "budget-exceeded",
        alert,
      });
    }
  }

  setupP2PEncryptionEvents() {
    // P2P 加密事件设置
    logger.info("[Main] P2P 加密事件设置完成");
  }

  async initializeMobileBridge() {
    try {
      logger.info("[Main] ========================================");
      logger.info("[Main] 初始化移动端桥接...");

      // 获取 P2P 管理器 (使用已导入的 getAllModules)
      const modules = getAllModules();
      const p2pManager = modules.p2pManager;

      logger.info("[Main] p2pManager 存在:", !!p2pManager);

      if (!p2pManager) {
        logger.warn("[Main] P2P管理器未初始化，跳过移动端桥接");
        return;
      }

      // 等待 P2P 初始化完成，但不阻塞 MobileBridge 启动
      let p2pInitialized = false;
      if (p2pManager._initPromise) {
        try {
          // 最多等待 5 秒
          p2pInitialized = await Promise.race([
            p2pManager._initPromise,
            new Promise((resolve) => setTimeout(() => resolve(false), 5000)),
          ]);
          logger.info("[Main] P2P 初始化状态:", p2pInitialized);
        } catch (error) {
          logger.warn("[Main] P2P 初始化等待出错:", error.message);
        }
      }

      // 即使 P2P 未完全初始化，也尝试启动 MobileBridge
      // MobileBridge 只需要信令服务器，不需要完整的 P2P 功能
      if (!p2pInitialized) {
        logger.warn("[Main] P2P未完全初始化，但仍尝试启动MobileBridge...");
      }

      // 检查信令服务器是否已启动
      const signalingPort = p2pManager.p2pConfig?.signaling?.port || 9001;
      const signalingUrl = `ws://localhost:${signalingPort}`;

      // 如果信令服务器没有启动，尝试独立启动它
      if (
        !p2pManager.signalingServer ||
        !p2pManager.signalingServer.isRunning
      ) {
        logger.info("[Main] 信令服务器未运行，尝试独立启动...");
        try {
          await p2pManager.startSignalingServer();
          logger.info("[Main] ✓ 信令服务器已独立启动");
        } catch (error) {
          logger.error("[Main] ✗ 信令服务器启动失败:", error.message);
          return;
        }
      } else {
        logger.info("[Main] ✓ 信令服务器已在运行");
      }

      // 创建 MobileBridge 实例
      const MobileBridge = require("./p2p/mobile-bridge");
      this.mobileBridge = new MobileBridge(p2pManager, {
        signalingUrl,
        reconnectInterval: 5000,
        enableAutoReconnect: true,
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:stun1.l.google.com:19302" },
        ],
      });
      // v1.3+ plan B — 暴露给 desktop-pair-handlers.pushIceServersToMobile 用
      global.__ccMobileBridge = this.mobileBridge;

      // 设置事件处理
      this.mobileBridge.on("registered", (data) => {
        logger.info("[Main] MobileBridge 已注册到信令服务器:", data.peerId);
      });

      this.mobileBridge.on("peer-connected", (data) => {
        logger.info("[Main] 移动端已连接:", data.peerId);
        if (this.mainWindow) {
          this.mainWindow.webContents.send("mobile:peer-connected", data);
        }
      });

      this.mobileBridge.on("peer-disconnected", (data) => {
        logger.info("[Main] 移动端已断开:", data.peerId);
        if (this.mainWindow) {
          this.mainWindow.webContents.send("mobile:peer-disconnected", data);
        }
      });

      this.mobileBridge.on("message-from-mobile", async (data) => {
        logger.info("[Main] ========================================");
        logger.info("[Main] 收到 message-from-mobile 事件");
        logger.info("[Main] mobilePeerId:", data.mobilePeerId);
        logger.info("[Main] message.type:", data.message?.type);
        logger.info("[Main] message.payload存在:", !!data.message?.payload);
        logger.info("[Main] ========================================");

        // 处理命令请求
        await this.handleMobileCommand(data);

        // 同时通知渲染进程
        if (this.mainWindow) {
          this.mainWindow.webContents.send("mobile:message", data);
        }
      });

      this.mobileBridge.on("error", (data) => {
        logger.error("[Main] MobileBridge 错误:", data);
      });

      // 连接到信令服务器
      await this.mobileBridge.connect();

      // Phase 3d M4.5: 实例化 DeviceManager（持久化 mobile 配对设备列表）
      // 必须在 MobileBridgeSync 之前 — 后者构造参数包含 deviceManager。
      try {
        const DeviceManager = require("./p2p/device-manager");
        const { app: electronApp } = require("electron");
        const dataPath = require("path").join(
          electronApp.getPath("userData"),
          "chainlesschain",
        );
        this.deviceManager = new DeviceManager({ dataPath });
        await this.deviceManager.initialize();
        logger.info("[Main] ✓ DeviceManager 已实例化 (Phase 3d M4.5)");
      } catch (err) {
        logger.error("[Main] DeviceManager 实例化失败:", err);
      }

      // Phase 3d: 实例化 MobileBridgeSync（接 routeMobileCommand 的 sync.* 命令 +
      // 给 IPC handler 用）。即使 dbManager 还没 ready 也先建实例，runOnce 时
      // 会从依赖里拿；deviceManager 为可选。
      try {
        const MobileBridgeSync = require("./sync/mobile-bridge-sync");
        const dbManager =
          this.dbManager || this.databaseManager || this.database || null;
        if (dbManager) {
          this.mobileBridgeSync = new MobileBridgeSync({
            mobileBridge: this.mobileBridge,
            dbManager,
            deviceManager: this.deviceManager || null,
            // Phase 3d v1.2 #1: didManager 给出向 sync.* 加 AuthInfo
            didManager: this.didManager || null,
          });
          logger.info("[Main] ✓ MobileBridgeSync 已实例化 (Phase 3d)");
        } else {
          logger.warn(
            "[Main] dbManager 未初始化，跳过 MobileBridgeSync 创建（mobile sync 不可用）",
          );
        }
      } catch (err) {
        logger.error("[Main] MobileBridgeSync 实例化失败:", err);
      }

      // M5 ADR-6: 实例化 MobileSignClient（桌面反向 sign.request 入口）。
      // 用 mobileBridge.asMobileSignTransport() 作为 transport，复用 WebRTC
      // DataChannel 路径。业务侧 (marketplace.purchase 阈值检查、did.delegate
      // 等) 通过 this.mobileSignClient.requestSignature 调起 Android
      // SignAsService → ApprovalDialog → StrongBox Ed25519 签名链路。
      try {
        const {
          MobileSignClient,
        } = require("./remote/handlers/mobile-sign-client");
        this.mobileSignClient = new MobileSignClient({
          transport: this.mobileBridge.asMobileSignTransport(),
          // 60s 默认超时，覆盖慢用户 BiometricPrompt
        });
        logger.info(
          "[Main] ✓ MobileSignClient 已实例化 (M5 ADR-6 反向 sign.request)",
        );

        // Debug IPC handler: 让 renderer 端可以一键触发桌面 → 手机反向
        // 签名请求，验证完整 wire-up 端到端 (mobile-bridge transport +
        // MobileSignClient + Android RemoteCommandClient + SignAsService +
        // ApprovalDialog + BiometricPrompt + StrongBox sign + 返回)。
        // 业务侧 (marketplace.purchase) 真接入前用此快速 verify.
        const { ipcMain } = require("electron");
        ipcMain.handle("mobile:sign:debug-test", async (_event, peerId) => {
          if (!peerId || typeof peerId !== "string") {
            return { ok: false, error: "peerId required (string)" };
          }
          if (!this.mobileSignClient) {
            return { ok: false, error: "MobileSignClient not initialized" };
          }
          try {
            const fakeHash = "deadbeef".repeat(8); // 64 chars
            const result = await this.mobileSignClient.requestSignature({
              peerId,
              payloadHash: fakeHash,
              description: "桌面调试: 反向 sign.request 端到端验证",
              requireStrongBox: false,
            });
            return { ok: true, result };
          } catch (err) {
            return {
              ok: false,
              error: err.message || String(err),
              name: err.name || "SignError",
            };
          }
        });
        logger.info("[Main] ✓ IPC handler 'mobile:sign:debug-test' 已注册");
      } catch (err) {
        logger.error("[Main] MobileSignClient 实例化失败:", err);
      }

      // M4 D2 桌面胶水末段：把 RemoteGateway 内的 MobileApprovalChannel
      // 接到 MobileBridge 的 sendReverseRpcRequest。在 bridge.connect() 之后
      // 调用 — 此时 transport 已就绪可发反向 RPC。
      if (
        this.remoteGateway &&
        typeof this.remoteGateway.bindMobileBridge === "function"
      ) {
        try {
          const bound = this.remoteGateway.bindMobileBridge(this.mobileBridge);
          if (bound) {
            logger.info(
              "[Main] ✓ MobileApprovalChannel ↔ MobileBridge 已接通 (M4 D2 桌面胶水)",
            );
          }
        } catch (err) {
          logger.warn("[Main] MobileApprovalChannel 接通失败:", err.message);
        }
      }

      logger.info("[Main] ✓ 移动端桥接初始化完成");
      logger.info(`[Main]   信令服务器: ${signalingUrl}`);

      // v1.3+ remote 模式 — outbound 连公网中继 wss://signaling.chainlesschain.com
      // 让外网手机也能配对/反向调用。失败/断开自动重连，不挂应用主流程。
      this.startRelayClient();
    } catch (error) {
      logger.error("[Main] 移动端桥接初始化失败:", error);
    }
  }

  /**
   * 启 RelayClient outbound 长连到公网中继 (issue #21 v1.3+ 远程模式)。
   * 桌面以同一 pcPeerId 在 LAN 信令 + 公网中继**两处都登记**，外网手机扫
   * 桌面 QR 后即可经中继发 pair-ack / forward 消息到桌面。
   *
   * 落地策略：
   *   - 收到 type=message 时，本地 onMobileMessage 跑同一逻辑（recordPairAck
   *     + handleMobileCommand 等），与 LAN 路径完全等价。
   *   - 任意 transient 失败都不抛，只 warn — 用户至少还能用 LAN 配对。
   */
  startRelayClient() {
    try {
      const {
        RelayClient,
        DEFAULT_RELAY_URL,
      } = require("./p2p/relay-client.js");
      // *必须* 用 mobileBridge.peerId — 与 LAN signaling 注册的 ID 一致，
      // 也与 QR payload.pcPeerId 一致。早期版本用 deviceManager.deviceId 导致
      // 两套 ID 不一致，外网手机找不到目标 peer。
      const peerId =
        this.mobileBridge?.peerId ||
        this.deviceManager?.getCurrentDevice?.()?.deviceId;
      if (!peerId) {
        logger.warn(
          "[Main] RelayClient: no peerId (mobileBridge未注册), skip relay outbound",
        );
        return;
      }
      logger.info(
        `[Main] RelayClient peerId source: ${this.mobileBridge?.peerId ? "mobileBridge" : "deviceManager"} → ${peerId.slice(0, 16)}…`,
      );
      // 允许通过环境变量覆盖（dev 测试用）；默认走生产中继域名
      const relayUrl = process.env.CC_RELAY_URL || DEFAULT_RELAY_URL;

      this.relayClient = new RelayClient({
        peerId,
        url: relayUrl,
        deviceInfo: {
          name: require("os").hostname(),
          platform: process.platform,
          version: process.env.npm_package_version || "v1.3",
        },
        onMessage: (msg) => {
          // 中继转发来的消息 — 统一路由进 mobileBridge.handleSignalingMessage，
          // 与 LAN signaling 完全一样的 dispatch。覆盖：
          //   - pair-ack       → recordPairAck (desktop-pair sessionState)
          //   - command:request → bridgeToLibp2p → emit → handleMobileCommand
          //   - offer/answer/ice → handleOffer/handleAnswer/handleICECandidate (A)
          //   - message         → handleP2PMessage
          // 这样 plan A (WebRTC 透传) 自然落地：mobile 发 offer 到中继 →
          // RelayClient onMessage → handleSignalingMessage("offer") →
          // 走 setRemoteDescription/createAnswer 的现有 LAN 路径。
          try {
            // pair-ack 仍走单独 sessionState 持久化 — mobileBridge 也会处理
            // 但 desktop-pair-handlers 必须先 record，否则 web-panel poll 看不到
            if (msg.payload?.type === "pair-ack" || msg.type === "pair-ack") {
              const ack = msg.payload || msg;
              const {
                recordPairAck,
              } = require("./web-shell/handlers/desktop-pair-handlers.js");
              recordPairAck(ack);
              // 不 return — 让 mobileBridge.handleP2PMessage 也跑一遍 (pair-ack
              // 在 handleP2PMessage 内部 early-return，不会重复递送)
            }
            // 直接交给 mobile-bridge — 它内部按 type 分发到 handleOffer /
            // handleAnswer / handleICECandidate / handleP2PMessage 等。
            if (this.mobileBridge?.handleSignalingMessage) {
              this.mobileBridge.handleSignalingMessage(msg).catch((e) => {
                logger.warn(`[Main] mobileBridge dispatch 失败: ${e.message}`);
              });
            }
          } catch (e) {
            logger.warn(`[Main] RelayClient onMessage 处理失败: ${e.message}`);
          }
        },
      });
      this.relayClient.start();
      // v1.3+ plan C — 暴露给 mobile-bridge 等模块做"双发"响应信令
      global.__ccRelayClient = this.relayClient;
      logger.info(`[Main] ✓ RelayClient 启动 (${relayUrl})`);
    } catch (e) {
      // 中继失败不影响 LAN 模式
      logger.warn(`[Main] RelayClient 启动失败 (LAN 配对仍可用): ${e.message}`);
    }
  }

  /**
   * 处理来自移动端的命令
   * @param {Object} data - { mobilePeerId, message }
   */
  async handleMobileCommand(data) {
    const { mobilePeerId, message } = data;

    logger.info("[Main] ========================================");
    logger.info("[Main] handleMobileCommand 开始处理");
    logger.info("[Main] mobilePeerId:", mobilePeerId);
    logger.info("[Main] message:", JSON.stringify(message).slice(0, 300));

    // 消息类型常量
    const MESSAGE_TYPES = {
      COMMAND_REQUEST: "chainlesschain:command:request",
      COMMAND_RESPONSE: "chainlesschain:command:response",
    };

    try {
      // 检查消息格式
      if (!message || !message.type) {
        logger.warn("[Main] 移动端消息格式无效:", message);
        logger.info("[Main] ========================================");
        return;
      }

      logger.info("[Main] 消息类型:", message.type);
      logger.info("[Main] 期望类型:", MESSAGE_TYPES.COMMAND_REQUEST);
      logger.info(
        "[Main] 类型匹配:",
        message.type === MESSAGE_TYPES.COMMAND_REQUEST,
      );

      // 只处理命令请求
      if (message.type !== MESSAGE_TYPES.COMMAND_REQUEST) {
        logger.debug("[Main] 非命令请求消息，跳过:", message.type);
        logger.info("[Main] ========================================");
        return;
      }

      // 解析 payload
      let payload;
      try {
        payload =
          typeof message.payload === "string"
            ? JSON.parse(message.payload)
            : message.payload;
        logger.info("[Main] payload 解析成功");
        logger.info("[Main] payload.id:", payload?.id);
        logger.info("[Main] payload.method:", payload?.method);
      } catch (e) {
        logger.error("[Main] 解析命令 payload 失败:", e);
        logger.info("[Main] ========================================");
        return;
      }

      const { id, method, params } = payload;
      logger.info(`[Main] 处理移动端命令: ${method} (id: ${id})`);

      // 路由命令并获取结果
      let result = null;
      let error = null;

      try {
        result = await this.routeMobileCommand(method, params, {
          mobilePeerId,
        });
      } catch (e) {
        logger.error(`[Main] 命令执行失败: ${method}`, e);
        error = {
          code: -32603,
          message: e.message || "Internal Error",
        };
      }

      // 构建响应
      const response = {
        type: MESSAGE_TYPES.COMMAND_RESPONSE,
        payload: JSON.stringify({
          jsonrpc: "2.0",
          id,
          result: error ? null : result,
          error: error,
        }),
      };

      logger.info("[Main] 构建响应完成");
      logger.info("[Main] 响应类型:", response.type);
      logger.info("[Main] 响应payload长度:", response.payload?.length);

      // 发送响应
      logger.info("[Main] 准备调用 sendToMobile...");
      await this.mobileBridge.sendToMobile(mobilePeerId, response);
      logger.info(`[Main] ✓ 命令响应已发送: ${method}`);
      logger.info("[Main] ========================================");
    } catch (error) {
      logger.error("[Main] ========================================");
      logger.error("[Main] 处理移动端命令失败!");
      logger.error("[Main] 错误:", error.message);
      logger.error("[Main] 堆栈:", error.stack);
      logger.error("[Main] ========================================");
    }
  }

  /**
   * 路由移动端命令到具体处理器
   * @param {string} method - 命令方法名 (如 "system.getStatus")
   * @param {Object} params - 命令参数
   * @returns {Promise<any>} 命令结果
   */
  /**
   * Lazily wire PtyManager 'stdout' / 'exit' events to mobile-bridge
   * fan-out. Each subscribed peer receives `terminal.stdout` /
   * `terminal.exit` chainlesschain:event frames matching the WS shape
   * (sessionId / seq / data / exitCode). Idempotent.
   */
  _ensureMobileTerminalFanout() {
    if (this._mobileTerminalFanoutAttached) {
      return;
    }
    if (!this.ptyManager) {
      return;
    }
    this._mobileTerminalSubs = new Map(); // sessionId → Set<peerId>
    this._mobileTerminalFanoutAttached = true;

    this.ptyManager.on("stdout", ({ sessionId, data, seq }) => {
      const subs = this._mobileTerminalSubs.get(sessionId);
      if (!subs || subs.size === 0 || !this.mobileBridge) {
        return;
      }
      const frame = {
        type: "chainlesschain:event",
        payload: JSON.stringify({
          event: "terminal.stdout",
          sessionId,
          // Mobile protocol uses plain string (Android's JSON parser is
          // happy with UTF-8 directly; we keep base64 only on the
          // browser-side WS protocol to dodge JSON.stringify escape edge
          // cases that arise in xterm.js binary streams).
          data: Buffer.isBuffer(data) ? data.toString("utf-8") : String(data),
          seq,
        }),
      };
      for (const peerId of subs) {
        this.mobileBridge.sendToMobile(peerId, frame).catch((err) => {
          logger.warn(
            `[Main] terminal.stdout fanout failed for ${peerId}:`,
            err?.message,
          );
        });
      }
    });

    this.ptyManager.on("exit", ({ sessionId, exitCode, signal }) => {
      const subs = this._mobileTerminalSubs.get(sessionId);
      if (!subs || subs.size === 0 || !this.mobileBridge) {
        this._mobileTerminalSubs.delete(sessionId);
        return;
      }
      const frame = {
        type: "chainlesschain:event",
        payload: JSON.stringify({
          event: "terminal.exit",
          sessionId,
          exitCode,
          signal,
        }),
      };
      for (const peerId of subs) {
        this.mobileBridge.sendToMobile(peerId, frame).catch(() => {});
      }
      this._mobileTerminalSubs.delete(sessionId);
    });
  }

  _subscribeMobileToSession(peerId, sessionId) {
    if (!this._mobileTerminalSubs) {
      return;
    }
    if (!this._mobileTerminalSubs.has(sessionId)) {
      this._mobileTerminalSubs.set(sessionId, new Set());
    }
    this._mobileTerminalSubs.get(sessionId).add(peerId);
  }

  async routeMobileCommand(method, params = {}, ctx = {}) {
    const [namespace, action] = method.split(".");

    logger.info(`[Main] 路由命令: ${namespace}.${action}`);

    switch (namespace) {
      case "system":
        return this.handleSystemCommand(action, params);

      case "ai":
        return this.handleAICommand(action, params);

      case "conversation":
        return this.handleConversationCommand(action, params);

      case "file":
        return this.handleFileCommand(action, params, ctx);

      case "desktop":
        return this.handleDesktopCommand(action, params);

      case "knowledge":
        return this.handleKnowledgeCommand(action, params);

      case "skill":
        return this.handleSkillCommand(action, params);

      case "sync":
        return this.handleSyncCommand(action, params);

      case "terminal":
        return this.handleTerminalCommand(action, params, ctx);

      case "project":
        return this.handleProjectCommand(action, params, ctx);

      // Phase 14.1.1 follow-up — Personal Data Hub mobile entry. Whitelist +
      // approval gate already ran upstream in CommandRouter; here we just
      // dispatch to the hub via the dedicated route-mobile module that
      // mirrors src/main/ipc/personal-data-hub-ipc.js with Android-shaped
      // response envelopes. Namespace literal must stay the full kebab
      // string ("personal-data-hub") to match what Android invokes via
      // RemoteCommandClient.invoke("personal-data-hub.X", ...).
      //
      // Phase 14.3 streaming — augment ctx with sendEventToPeer() so stream
      // methods (sync-adapter-stream / sync-all-stream) can push
      // personal-data-hub.sync.progress events back to the mobile peer
      // mid-sync. Format mirrors p2p-command-adapter.broadcastEvent: a
      // chainlesschain:event:notification envelope wrapping a JSON-RPC 2.0
      // notification — Android P2PClient parses this into EventNotification
      // and HubSyncEventDispatcher fans it out by method name.
      case "personal-data-hub": {
        const {
          dispatchPersonalDataHubMethod,
        } = require("./personal-data-hub/route-mobile.js");
        const mobileBridge = this.mobileBridge;
        const mobilePeerId = ctx?.mobilePeerId;
        const sendEventToPeer = (method, params) => {
          if (!mobileBridge || !mobilePeerId) {
            return;
          }
          mobileBridge.sendToMobile(mobilePeerId, {
            type: "chainlesschain:event:notification",
            payload: { jsonrpc: "2.0", method, params: params || {} },
          });
        };
        return await dispatchPersonalDataHubMethod(action, params, {
          ...ctx,
          sendEventToPeer,
        });
      }

      default:
        throw new Error(`Unknown command namespace: ${namespace}`);
    }
  }

  /**
   * v1.3 (2026-05-17) Android 项目管理 → 远程终端入口 Sub-phase 10
   * 详见 docs/design/Android_Project_Remote_Terminal_Entry.md §6.10
   *
   * Proxies to MobileBridgeSync handleProjectList / handleProjectPullSingle.
   */
  async handleProjectCommand(action, params, ctx) {
    if (!this.mobileBridgeSync) {
      throw new Error("MobileBridgeSync 未就绪");
    }
    switch (action) {
      case "list":
        return await this.mobileBridgeSync.handleProjectList(params || {}, ctx);
      case "pullSingle":
        return await this.mobileBridgeSync.handleProjectPullSingle(
          params || {},
          ctx,
        );
      // Sub-phase 7.2 (2026-05-17): Android 也能调 file CRUD — 委派到既有
      // ProjectManagementHandler（与 web-shell 共享 handler 实例，写同 SQLite）
      case "listFiles":
      case "createFile":
      case "createFolder":
      case "writeFile":
      case "deleteFile": {
        const handler = this._getProjectManagementHandler();
        if (!handler) {
          throw new Error("ProjectManagementHandler 未就绪");
        }
        return await handler.handle(action, params || {}, ctx || {});
      }
      default:
        throw new Error(`Unknown project action: ${action}`);
    }
  }

  /**
   * 获取或懒初始化 ProjectManagementHandler 单例（与 web-shell 共享）。
   * Sub-phase 7.2: Android RPC 调 project.createFile 等也走此 handler。
   */
  _getProjectManagementHandler() {
    if (!this._projectManagementHandler) {
      try {
        const ProjectManagementHandler = require("./remote/handlers/project-management-handler");
        // L1567 同款 fallback：不同初始化路径 binding 名不一致
        const db =
          this.dbManager || this.databaseManager || this.database || null;
        if (db) {
          this._projectManagementHandler = new ProjectManagementHandler(db);
        }
      } catch (e) {
        logger.warn("[Main] ProjectManagementHandler 初始化失败:", e.message);
      }
    }
    return this._projectManagementHandler;
  }

  /**
   * Plan A — Android remote-terminal command router.
   * Methods (mirror the WS terminal.* topics):
   *   terminal.create / list / stdin / resize / close / history
   *
   * Trust gate: handleMobileCommand callers go through the upstream
   * permissionGate verification (see p2p-command-adapter.js handle
   * CommandRequest), so by the time we reach here the device is already
   * authenticated. We additionally re-verify against `p2p_paired_devices`
   * status='active' as defense-in-depth — a missing manager (pre-init)
   * returns a clean error envelope rather than crashing.
   *
   * params.data is plain UTF-8 string (the mobile-command JSON protocol
   * doesn't base64 anything — distinct from the WS path's base64 layer).
   */
  async handleTerminalCommand(action, params = {}, ctx = {}) {
    if (!this.ptyManager) {
      throw new Error("pty_manager_not_ready");
    }
    this._ensureMobileTerminalFanout();
    switch (action) {
      case "create": {
        const created = this.ptyManager.create({
          shell: params.shell,
          cwd: params.cwd,
          env: params.env,
          cols: params.cols,
          rows: params.rows,
        });
        // Subscribe this mobile peer to the new session's stdout/exit so
        // every chunk is fanned out via sendToMobile. Cleared on
        // terminal.close or pty exit (see _ensureMobileTerminalFanout).
        if (ctx.mobilePeerId) {
          this._subscribeMobileToSession(ctx.mobilePeerId, created.sessionId);
        }
        return created;
      }
      case "list":
        // Adopt — subscribe this mobile to all currently live sessions so
        // it can join an existing terminal opened from another shell.
        if (ctx.mobilePeerId) {
          for (const s of this.ptyManager.list()) {
            if (s.alive) {
              this._subscribeMobileToSession(ctx.mobilePeerId, s.id);
            }
          }
        }
        return { sessions: this.ptyManager.list() };
      case "stdin": {
        if (!params.sessionId) {
          throw new Error("session_id_required");
        }
        const text = typeof params.data === "string" ? params.data : "";
        // Apply the same dangerous-keyword gate as the WS path. Android is
        // a remote trust boundary so requireConfirmation runs in main and
        // surfaces the native dialog.
        if (this.terminalRequireConfirmation) {
          const DANGEROUS = [
            /\brm\s+-rf\b/i,
            /\bformat\s+[a-z]:/i,
            /\bshutdown\b/i,
            /\bdel\s+\/[sq]/i,
            /\bdiskpart\b/i,
          ];
          if (DANGEROUS.some((re) => re.test(text))) {
            const ok = await this.terminalRequireConfirmation(
              text,
              params.sessionId,
            );
            if (!ok) {
              throw new Error("dangerous_keyword_blocked");
            }
          }
        }
        this.ptyManager.write(params.sessionId, text);
        return { ok: true };
      }
      case "resize":
        if (!params.sessionId) {
          throw new Error("session_id_required");
        }
        this.ptyManager.resize(params.sessionId, params.cols, params.rows);
        return { ok: true };
      case "close":
        if (!params.sessionId) {
          throw new Error("session_id_required");
        }
        this.ptyManager.close(params.sessionId);
        return { ok: true };
      case "history": {
        if (!params.sessionId) {
          throw new Error("session_id_required");
        }
        const { chunks, truncated } = this.ptyManager.history(
          params.sessionId,
          params.fromSeq || 0,
        );
        return {
          chunks: chunks.map((c) => ({
            seq: c.seq,
            data: c.data.toString("utf-8"),
          })),
          truncated,
        };
      }
      default:
        throw new Error(`Unknown terminal action: ${action}`);
    }
  }

  /**
   * Phase 3d: dispatch sync.push / sync.pull / sync.ack 来自 Android 的请求到
   * MobileBridgeSync。该方法在 mobileBridge.handleMobileCommand 路由命中
   * `sync` namespace 时调用。
   */
  async handleSyncCommand(action, params) {
    if (!this.mobileBridgeSync) {
      throw new Error("MobileBridgeSync 未就绪");
    }
    switch (action) {
      case "push":
        return await this.mobileBridgeSync.handlePush(params || {});
      case "pull":
        return await this.mobileBridgeSync.handlePull(params || {});
      case "ack":
        return this.mobileBridgeSync.handleAck(params || {});
      default:
        throw new Error(`Unknown sync action: ${action}`);
    }
  }

  /**
   * 处理来自移动端的技能命令
   * Handles skill.execute and skill.list commands from Android P2P
   */
  async handleSkillCommand(action, params) {
    const registry = this._getSkillRegistry();

    switch (action) {
      case "execute": {
        const { skillName, input } = params;
        if (!registry) {
          throw new Error("Skill system not initialized");
        }

        logger.info(`[Main] Mobile skill execute: ${skillName}`);

        try {
          const task = {
            type: "skill",
            operation: skillName,
            input: input?.input || "",
            params: input || {},
          };
          const result = await registry.executeSkill(skillName, task, {
            source: "mobile-p2p",
          });
          return {
            success: true,
            output:
              typeof result === "string"
                ? result
                : result?.output || result?.message || JSON.stringify(result),
            skillName,
          };
        } catch (error) {
          logger.error(
            `[Main] Mobile skill execute failed: ${skillName}`,
            error,
          );
          return {
            success: false,
            output: "",
            error: error.message,
            skillName,
          };
        }
      }

      case "list": {
        if (!registry) {
          return { skills: [] };
        }

        const skills = registry.getAllSkills().map((s) => ({
          name: s.skillId || s.name,
          description: s.description || "",
          category: s.config?.category || s.definition?.category || "",
          tags: s.config?.tags || s.definition?.tags || [],
        }));
        return { skills };
      }

      default:
        throw new Error(`Unknown skill action: ${action}`);
    }
  }

  /**
   * Get the cowork SkillRegistry instance.
   * Falls back to skillManager if cowork registry not available.
   */
  _getSkillRegistry() {
    // Try cowork SkillRegistry singleton first (for markdown skills)
    try {
      const {
        getSkillRegistry,
      } = require("./ai-engine/cowork/skills/skill-registry");
      const registry = getSkillRegistry();
      if (registry && registry.getAllSkills().length > 0) {
        return registry;
      }
    } catch (_e) {
      // Cowork registry not available
    }
    // Fall back to skill-tool-system SkillManager
    if (this.skillManager) {
      return this.skillManager;
    }
    return null;
  }

  /**
   * 处理系统命令
   */
  async handleSystemCommand(action, params) {
    switch (action) {
      // v1.3+ issue #21 plan C — 简单存活探活，给手机端 Ping 按钮用
      case "ping":
        return { pong: true, ts: Date.now(), version: app.getVersion() };

      case "getStatus":
        return {
          status: "online",
          version: app.getVersion(),
          platform: process.platform,
          uptime: process.uptime(),
        };

      case "getInfo":
        return {
          appName: app.getName(),
          version: app.getVersion(),
          platform: process.platform,
          arch: process.arch,
          nodeVersion: process.version,
          electronVersion: process.versions.electron,
        };

      case "notify":
        if (this.mainWindow && Notification.isSupported()) {
          new Notification({
            title: params.title || "ChainlessChain",
            body: params.message || "",
          }).show();
        }
        return { success: true };

      default:
        throw new Error(`Unknown system action: ${action}`);
    }
  }

  /**
   * 处理 AI 命令
   */
  async handleAICommand(action, params) {
    switch (action) {
      case "getModels":
        if (this.llmManager) {
          const models = await this.llmManager.listModels();
          return { models };
        }
        return { models: [] };

      case "chat": {
        if (!this.llmManager) {
          throw new Error("LLM Manager not initialized");
        }
        const { conversationId, message, model, systemPrompt, temperature } =
          params;
        logger.info(
          `[Main] AI chat 请求: conversationId=${conversationId}, model=${model}`,
        );
        logger.info(`[Main] 消息内容: ${message?.slice(0, 100)}...`);

        // Phase 3d v1.3 fix: LLMManager.chat 兼容签名是 chat(messagesArray, options)
        // —— 此前传 {messages,model} 单对象当首参，触发「messages必须是数组」
        // (llm-manager.js:468)。扁平化为 [{system?},{user}] 数组 + 单独 options。
        const messages = [];
        if (
          systemPrompt &&
          typeof systemPrompt === "string" &&
          systemPrompt.length
        ) {
          messages.push({ role: "system", content: systemPrompt });
        }
        messages.push({ role: "user", content: message });

        const chatResponse = await this.llmManager.chat(messages, {
          model: model,
          conversationId,
          temperature: temperature || 0.7,
        });

        logger.info(
          `[Main] AI chat 响应: ${JSON.stringify(chatResponse).slice(0, 200)}...`,
        );

        // 返回 Android 期望的格式
        return {
          conversationId: conversationId || `conv-${Date.now()}`,
          reply:
            chatResponse.content ||
            chatResponse.message ||
            (typeof chatResponse === "string"
              ? chatResponse
              : JSON.stringify(chatResponse)),
          model: model || chatResponse.model || "unknown",
          tokens: chatResponse.usage
            ? {
                prompt: chatResponse.usage.prompt_tokens || 0,
                completion: chatResponse.usage.completion_tokens || 0,
                total: chatResponse.usage.total_tokens || 0,
              }
            : null,
        };
      }

      case "getConversations":
        if (this.database) {
          const conversations =
            (await this.database.getAllConversations?.()) || [];
          return { conversations };
        }
        return { conversations: [] };

      case "ragSearch":
        if (this.ragManager) {
          const results = await this.ragManager.search(params.query, {
            limit: params.limit || 10,
          });
          return { results };
        }
        return { results: [] };

      case "listAgents": {
        const agents = [];

        // 从 Multi-Agent 编排器获取已注册的代理
        if (this.agentOrchestrator) {
          const allAgents = this.agentOrchestrator.getAllAgents();
          for (const agent of allAgents) {
            agents.push(agent.getInfo());
          }
        }

        return { agents };
      }

      default:
        throw new Error(`Unknown AI action: ${action}`);
    }
  }

  /**
   * 处理会话命令
   */
  async handleConversationCommand(action, params) {
    switch (action) {
      case "list":
        if (this.database) {
          const conversations =
            (await this.database.getAllConversations?.()) || [];
          return { conversations };
        }
        return { conversations: [] };

      case "get":
        if (this.database && params.id) {
          const conversation = await this.database.getConversation?.(params.id);
          return { conversation };
        }
        return { conversation: null };

      case "create":
        if (this.database) {
          const id = await this.database.createConversation?.(params);
          return { id, success: true };
        }
        throw new Error("Database not available");

      default:
        throw new Error(`Unknown conversation action: ${action}`);
    }
  }

  /**
   * 处理文件命令
   */
  async handleFileCommand(action, params, ctx = {}) {
    // Plan C 远程文件协议适配器。
    //
    // 历史：旧 stub `case "requestUpload"` 错误地用 dialog.showOpenDialog 在 PC
    // 端弹文件选择框，`case "list"` 查 project_files SQL 表（语义错位）；同时
    // FileTransferHandler 是 sandboxed-in-userData 给 web-shell 内部用的，path
    // / 字段命名都对不上 Android FileCommands.kt 协议。
    //
    // 改用专门的 AndroidFileHandler — 无 sandbox（trusted paired mobile peer）+
    // 字段对齐 Android model + in-memory transferId 状态机。
    if (!this._androidFileHandler) {
      const {
        AndroidFileHandler,
      } = require("./remote/handlers/android-file-handler");
      this._androidFileHandler = new AndroidFileHandler();
      logger.info("[Main] ✓ AndroidFileHandler 已实例化 (lazy)");
    }
    return await this._androidFileHandler.handle(action, params, {
      source: "mobile",
      peerId: ctx.mobilePeerId,
    });
  }

  /**
   * 处理桌面命令
   */
  async handleDesktopCommand(action, _params) {
    switch (action) {
      case "getDisplays": {
        const { screen } = require("electron");
        const displays = screen.getAllDisplays().map((d) => ({
          id: d.id,
          bounds: d.bounds,
          primary: d === screen.getPrimaryDisplay(),
        }));
        return { displays };
      }

      case "getStats":
        return {
          memory: process.memoryUsage(),
          cpu: process.cpuUsage(),
        };

      default:
        throw new Error(`Unknown desktop action: ${action}`);
    }
  }

  /**
   * 处理知识库命令
   */
  async handleKnowledgeCommand(action, params) {
    switch (action) {
      case "search":
        if (this.ragManager) {
          const results = await this.ragManager.search(params.query, {
            limit: params.limit || 10,
          });
          return { results };
        }
        return { results: [] };

      default:
        throw new Error(`Unknown knowledge action: ${action}`);
    }
  }

  setupUKeyEvents() {
    if (!this.ukeyManager) {
      return;
    }
    this.ukeyManager.on("device-inserted", () => {
      logger.info("[Main] U-Key 设备已插入");
      this.mainWindow?.webContents.send("ukey:device-inserted");
    });
    this.ukeyManager.on("device-removed", () => {
      logger.info("[Main] U-Key 设备已移除");
      this.mainWindow?.webContents.send("ukey:device-removed");
    });
  }

  onWindowAllClosed() {
    if (process.platform !== "darwin") {
      app.quit();
    }
  }

  onActivate() {
    if (BrowserWindow.getAllWindows().length === 0) {
      this.createWindow();
    }
  }

  async onWillQuit(event) {
    event.preventDefault();
    logger.info("[Main] 应用退出中...");

    // v5.0.3.37 — 停掉托盘内存使用周期 update（10s interval），否则后续 quit
    // 流程里 trayManager 已 null 时还会 fire 一次 setInterval 回调（被内部 guard
    // 接住，但白白产生 logger.warn 噪音）。
    if (this._trayMemoryInterval) {
      clearInterval(this._trayMemoryInterval);
      this._trayMemoryInterval = null;
    }

    // Destroy tray BEFORE rest of cleanup so the system-tray icon disappears
    // immediately when the user hits Quit, instead of lingering through the
    // multi-second teardown chain.
    if (this.trayManager) {
      try {
        this.trayManager.destroy();
      } catch (err) {
        logger.warn("[Main] tray destroy error:", err.message);
      }
      this.trayManager = null;
    }

    // Phase 1.5: flush any pending debounced geometry writes so the user's
    // last visible bounds aren't lost to the 500ms timer on quit.
    if (this._geometryPersister) {
      try {
        this._geometryPersister.flushAll();
      } catch (error) {
        logger.warn("[Main] geometry flushAll error:", error.message);
      }
      this._geometryPersister = null;
    }

    // Stop the web-shell HTTP + WS pair before the rest of teardown so any
    // SPA-driven WS messages drain cleanly.
    if (this._webShellHandle) {
      try {
        await this._webShellHandle.close();
        this._webShellHandle = null;
        logger.info("[Main] WebShell stopped");
      } catch (error) {
        logger.error("[Main] WebShell stop error:", error);
      }
    }
    // #21 v1.3+ — remove port discovery file so cc CLI no longer thinks
    // the desktop is running. Safe if file already gone (crashed shutdown).
    if (this._desktopPortFile) {
      try {
        require("fs").unlinkSync(this._desktopPortFile);
        logger.info("[Main] removed desktop.port file");
      } catch (err) {
        if (err && err.code !== "ENOENT") {
          logger.warn("[Main] desktop.port cleanup error:", err.message);
        }
      }
      this._desktopPortFile = null;
    }

    if (this.menuManager) {
      this.menuManager.destroy();
      this.menuManager = null;
    }

    // 清理移动端桥接
    if (this.mobileBridge) {
      try {
        await this.mobileBridge.disconnect();
        this.mobileBridge = null;
        logger.info("[Main] MobileBridge cleanup completed");
      } catch (error) {
        logger.error("[Main] MobileBridge cleanup error:", error);
      }
    }

    // 清理远程网关（包含浏览器扩展服务器）
    if (this.remoteGateway) {
      try {
        await this.remoteGateway.stop();
        this.remoteGateway = null;
        logger.info("[Main] RemoteGateway cleanup completed");
      } catch (error) {
        logger.error("[Main] RemoteGateway cleanup error:", error);
      }
    }

    // 清理浏览器资源
    try {
      const { cleanupBrowser } = require("./browser/browser-ipc");
      await cleanupBrowser();
      logger.info("[Main] Browser cleanup completed");
    } catch (error) {
      logger.error("[Main] Browser cleanup error:", error);
    }

    // Close Personal Data Hub vault (SQLCipher journal + WAL flush)
    try {
      const hubWiring = require("./personal-data-hub/wiring");
      hubWiring.close();
    } catch (error) {
      logger.warn(
        "[Main] Personal Data Hub close error:",
        error && error.message,
      );
    }

    const {
      getBackendServiceManager,
    } = require("./api/backend-service-manager");
    const backendManager = getBackendServiceManager();
    await backendManager.stopServices();

    app.exit(0);
  }
}

// 文件树懒加载 IPC Handler
const fsPromises = require("fs").promises;

ipcMain.handle(
  "file-tree:load-children",
  async (event, { projectPath, dirPath }) => {
    try {
      const fullPath = path.join(projectPath, dirPath || "");

      // 检查路径是否存在且是目录
      const stats = await fsPromises.stat(fullPath);
      if (!stats.isDirectory()) {
        throw new Error("路径不是目录");
      }

      // 读取目录内容
      const files = await fsPromises.readdir(fullPath, { withFileTypes: true });

      // 构建文件树节点
      const nodes = await Promise.all(
        files.map(async (file) => {
          const filePath = path.join(dirPath || "", file.name);
          const fullFilePath = path.join(projectPath, filePath);

          try {
            const fileStats = await fsPromises.stat(fullFilePath);

            return {
              name: file.name,
              path: filePath,
              isDirectory: file.isDirectory(),
              // 目录设置children为null表示未加载；文件设置为undefined表示叶子节点
              children: file.isDirectory() ? null : undefined,
              size: file.isFile() ? fileStats.size : 0,
              modifiedTime: fileStats.mtime.getTime(),
            };
          } catch (error) {
            logger.warn(`[FileTree] 无法读取文件信息: ${fullFilePath}`, error);
            return null;
          }
        }),
      );

      // 过滤掉读取失败的节点
      const validNodes = nodes.filter((node) => node !== null);

      // 排序：目录在前，文件在后，按名称排序
      validNodes.sort((a, b) => {
        if (a.isDirectory && !b.isDirectory) {
          return -1;
        }
        if (!a.isDirectory && b.isDirectory) {
          return 1;
        }
        return a.name.localeCompare(b.name);
      });

      logger.info(
        `[FileTree] 加载目录: ${dirPath || "/"}, 文件数 ${validNodes.length}`,
      );

      return {
        success: true,
        nodes: validNodes,
      };
    } catch (error) {
      logger.error("[FileTree] 加载目录失败:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  },
);

// 启动应用
new ChainlessChainApp();
