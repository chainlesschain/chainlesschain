/**
 * ChainlessChain Desktop App - 优化版主入口
 * 使用 Bootstrap 模块进行模块化初始化
 *
 * @version 2.0.0
 * @description 从 3800+ 行优化到 ~800 行
 */

// Load environment variables first (optional in production)
try {
  require("dotenv").config();
} catch (err) {
  // dotenv is optional in production builds
}

const { app, BrowserWindow, ipcMain, Notification } = require("electron");
const { logger } = require("./utils/logger.js");
const path = require("path");
const fs = require("fs");

// Bootstrap 模块
const {
  bootstrapApplication,
  lazyLoadModule,
  getModule,
  getAllModules,
  setupP2PPostInit,
} = require("./bootstrap");

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
 * ChainlessChain 应用 (优化版)
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

    // 单实例锁定
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
    logger.info("ChainlessChain Vue 启动中... (优化版)");

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

    // 使用 Bootstrap 模块进行初始化
    try {
      const instances = await bootstrapApplication({
        progressCallback: (message, progress) => {
          // 映射 bootstrap 进度 5-85%
          const mappedProgress = 5 + Math.round(progress * 0.8);
          this.splashWindow?.updateProgress(message, mappedProgress);
        },
        context: { mainWindow: this.mainWindow },
      });

      // 保存实例引用到 this
      this.applyInstances(instances);

      // 设置 Token Tracker 预算告警
      if (this.tokenTracker) {
        this.tokenTracker.on("budget-alert", (alert) => {
          logger.info("[Main] 预算告警:", alert);
          this.handleBudgetAlert(alert);
        });
      }

      logger.info("[Main] Bootstrap 初始化完成");
    } catch (error) {
      logger.error("[Main] Bootstrap 初始化失败:", error);
    }

    // 初始化 Initial Setup IPC
    if (this.database) {
      const { getLLMConfig } = require("./llm/llm-config");
      this.initialSetupIPC = new InitialSetupIPC(
        app,
        this.database,
        getAppConfig(),
        getLLMConfig(),
      );
      if (this.dbEncryptionIPC) {
        this.dbEncryptionIPC.setDatabaseManager(this.database);
      }
    }

    // P2P 后续初始化
    await setupP2PPostInit(
      getAllModules(),
      () => this.setupP2PEncryptionEvents(),
      () => this.initializeMobileBridge(),
    );

    // 注册技能工具 IPC
    this.registerSkillToolIPC();

    // 注册高级特性 IPC
    this.registerAdvancedFeaturesIPC();

    // 初始化 MCP 系统
    await this.initializeMCPSystem();

    // 创建主窗口
    this.splashWindow?.updateProgress("创建主窗口...", 95);
    await this.createWindow();

    // 处理启动时的协议URL
    if (this.deepLinkHandler && process.platform !== "darwin") {
      this.deepLinkHandler.handleStartupUrl(process.argv);
    }
  }

  /**
   * 将 bootstrap 实例应用到 this
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

    // RAG 与 Git
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
   * 注册技能工具 IPC
   */
  registerSkillToolIPC() {
    try {
      const {
        registerSkillToolIPC,
      } = require("./skill-tool-system/skill-tool-ipc");
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
      const {
        registerMultiAgentIPC,
      } = require("./ai-engine/multi-agent/multi-agent-ipc");

      if (this.skillManager && this.toolManager) {
        registerSkillToolIPC({
          ipcMain,
          skillManager: this.skillManager,
          toolManager: this.toolManager,
        });
        logger.info("[Main] 技能工具IPC已注册");
      }

      registerVolcengineIPC();
      registerSecureStorageIPC();

      if (this.sessionManager) {
        registerSessionManagerIPC({ sessionManager: this.sessionManager });
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
      registerMultiAgentIPC({
        llmManager: this.llmManager,
        functionCaller: this.functionCaller,
      });

      logger.info("[Main] 高级IPC handlers注册完成");
    } catch (error) {
      logger.error("[Main] 高级IPC注册失败:", error);
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
      const mcpConfig = mcpConfigLoader.load();

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
      logger.error("[Main] MCP系统初始化失败:", error);
      this.registerMCPFallbackHandlers();
    }
  }

  /**
   * MCP 回退处理器
   */
  registerMCPFallbackHandlers() {
    logger.info("[Main] 注册MCP回退处理器");
    const disabledResponse = {
      success: false,
      error: "MCP system is disabled",
    };
    const handlers = [
      "mcp:get-config",
      "mcp:list-servers",
      "mcp:get-connected-servers",
      "mcp:connect-server",
      "mcp:disconnect-server",
      "mcp:list-tools",
      "mcp:call-tool",
      "mcp:list-resources",
      "mcp:read-resource",
      "mcp:get-metrics",
      "mcp:update-config",
    ];

    for (const channel of handlers) {
      try {
        if (channel === "mcp:get-config") {
          ipcMain.handle(channel, () => ({
            success: true,
            config: { enabled: false, servers: {} },
          }));
        } else if (
          channel === "mcp:list-servers" ||
          channel === "mcp:get-connected-servers"
        ) {
          ipcMain.handle(channel, () => ({ success: true, servers: [] }));
        } else {
          ipcMain.handle(channel, () => disabledResponse);
        }
      } catch (e) {
        // 已注册，忽略重复注册错误
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
      backgroundColor: "#ffffff",
      show: process.env.NODE_ENV === "test",
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, "../preload/index.js"),
      },
      titleBarStyle: "hidden",
      titleBarOverlay: { color: "#ffffff", symbolColor: "#000000" },
    });

    if (process.env.NODE_ENV === "development") {
      const devServerUrl =
        process.env.VITE_DEV_SERVER_URL ||
        process.env.DEV_SERVER_URL ||
        "http://localhost:5173";
      this.mainWindow.loadURL(devServerUrl);
      this.mainWindow.webContents.openDevTools();
    } else {
      this.mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
    }

    this.mainWindow.webContents.on("did-finish-load", () => {
      this.splashWindow?.updateProgress("加载完成", 100);
      if (this.splashWindow) {
        setTimeout(() => {
          this.splashWindow?.close();
          this.splashWindow = null;
          this.mainWindow?.show();
          this.mainWindow?.focus();
        }, 300);
      } else {
        this.mainWindow?.show();
        this.mainWindow?.focus();
      }

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
      logger.error("[Main] 数据库同步管理器初始化失败:", error);
    }

    // 注册所有 IPC
    this.setupIPC();
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
    // 移动端桥接初始化
    logger.info("[Main] 移动端桥接初始化完成");
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

    if (this.menuManager) {
      this.menuManager.destroy();
      this.menuManager = null;
    }

    const {
      getBackendServiceManager,
    } = require("./api/backend-service-manager");
    const backendManager = getBackendServiceManager();
    await backendManager.stopServices();

    app.exit(0);
  }
}

// 启动应用
new ChainlessChainApp();
