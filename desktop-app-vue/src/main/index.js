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
console.log("[DEBUG] Node modules loaded");

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

    // 懒加载状态
    this.speechInitialized = false;
    this.imageUploaderInitialized = false;
    this.videoImporterInitialized = false;
    this.blockchainInitialized = false;
    this.pluginInitialized = false;

    this.setupApp();
  }

  setupApp() {
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
  }

  async onReady() {
    logger.info("ChainlessChain Vue 启动中..(优化版");

    // 创建启动画面
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

  async createWindow() {
    const { session } = require("electron");
    if (app.isReady()) {
      try {
        await session.defaultSession.clearCache();
      } catch (error) {
        logger.error("[Main] 清除缓存失败:", error);
      }
    }

    this.mainWindow = new BrowserWindow({
      width: 1200,
      height: 800,
      minWidth: 800,
      minHeight: 600,
      backgroundColor: "#764ba2", // 与加载动画背景色一致，防止白屏闪烁
      show: process.env.NODE_ENV === "test",
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, "../preload/index.js"),
      },
      titleBarStyle: "hidden",
      titleBarOverlay: { color: "#667eea", symbolColor: "#ffffff" },
    });

    // 注册所有 IPC (必须在 loadURL/loadFile 之前，确保渲染进程可以使用 IPC)
    this.setupIPC();

    if (shouldRunWebShell()) {
      // Phase 0 path: embed web-ui-server (CLI HTTP) + ws-bridge with a pre-
      // registered ukey.status handler, load web-panel dist. V5/V6 IPC stays
      // registered above so a future hybrid window can co-exist without
      // re-registering. ukeyManager is passed through so the WS handler can
      // report live device state.
      const handle = await startWebShell({
        mode: "global",
        projectName: "ChainlessChain Desktop",
        ukeyManager: this.ukeyManager,
      });
      this._webShellHandle = handle;
      logger.info(`[WebShell] HTTP: ${handle.httpUrl}`);
      logger.info(`[WebShell] WS:   ${handle.wsUrl}`);
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
    });

    this.mainWindow.webContents.on("did-finish-load", () => {
      this.splashWindow?.updateProgress("加载完成", 100);
      const { initLogForwarder } = require("./utils/log-forwarder");
      initLogForwarder(this.mainWindow);
    });

    this.mainWindow.on("closed", () => {
      this.mainWindow = null;
    });

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

    // 创建菜单
    this.menuManager = new MenuManager(this.mainWindow);
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

      logger.info("[Main] ✓ 移动端桥接初始化完成");
      logger.info(`[Main]   信令服务器: ${signalingUrl}`);
    } catch (error) {
      logger.error("[Main] 移动端桥接初始化失败:", error);
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
        result = await this.routeMobileCommand(method, params);
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
  async routeMobileCommand(method, params = {}) {
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
        return this.handleFileCommand(action, params);

      case "desktop":
        return this.handleDesktopCommand(action, params);

      case "knowledge":
        return this.handleKnowledgeCommand(action, params);

      case "skill":
        return this.handleSkillCommand(action, params);

      default:
        throw new Error(`Unknown command namespace: ${namespace}`);
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
        const { conversationId, message, model } = params;
        logger.info(
          `[Main] AI chat 请求: conversationId=${conversationId}, model=${model}`,
        );
        logger.info(`[Main] 消息内容: ${message?.slice(0, 100)}...`);

        // 简单的聊天请求处理
        const chatResponse = await this.llmManager.chat({
          messages: [{ role: "user", content: message }],
          model: model,
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
  async handleFileCommand(action, params) {
    switch (action) {
      case "list": {
        if (this.database) {
          try {
            const projectId = params.projectId;
            if (projectId) {
              // 按项目查询文件
              const files = this.database.getProjectFiles(projectId);
              return { files };
            }
            // 查询所有未删除的文件（带分页）
            const limit = params.limit || 50;
            const offset = params.offset || 0;
            const files = this.database.db
              .prepare(
                `SELECT id, project_id, file_name, file_path, file_type, file_size,
                        created_at, updated_at
                 FROM project_files
                 WHERE deleted = 0
                 ORDER BY updated_at DESC
                 LIMIT ? OFFSET ?`,
              )
              .all(limit, offset);
            return { files };
          } catch (err) {
            logger.warn("[Main] 查询文件列表失败:", err.message);
            return { files: [] };
          }
        }
        return { files: [] };
      }

      case "requestUpload": {
        const { dialog } = require("electron");
        const fs = require("fs");

        // 打开文件选择对话框
        const result = await dialog.showOpenDialog(this.mainWindow, {
          title: "选择要上传的文件",
          properties: ["openFile", "multiSelections"],
        });

        if (result.canceled || result.filePaths.length === 0) {
          return { uploadId: null, canceled: true };
        }

        const uploadId = `upload_${Date.now()}`;
        const uploadedFiles = [];

        for (const filePath of result.filePaths) {
          const stat = fs.statSync(filePath);
          uploadedFiles.push({
            name: path.basename(filePath),
            path: filePath,
            size: stat.size,
            type: path.extname(filePath).slice(1) || "unknown",
          });
        }

        return { uploadId, files: uploadedFiles, success: true };
      }

      default:
        throw new Error(`Unknown file action: ${action}`);
    }
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
