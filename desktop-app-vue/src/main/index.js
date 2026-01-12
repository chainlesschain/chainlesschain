// Load environment variables first (optional in production)
try {
  require('dotenv').config();
} catch (err) {
  // dotenv is optional in production builds
  console.log('dotenv not available (production mode)');
}

const { app, BrowserWindow, ipcMain, dialog, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const DatabaseManager = require('./database');
const GraphExtractor = require('./graph-extractor');
const { getAppConfig } = require('./app-config');
const { UKeyManager, DriverTypes } = require('./ukey/ukey-manager');
const ProjectStatsCollector = require('./project/stats-collector');
const GitManager = require('./git/git-manager');
const MarkdownExporter = require('./git/markdown-exporter');
const { getGitConfig } = require('./git/git-config');
const { LLMManager } = require('./llm/llm-manager');
const { getLLMConfig } = require('./llm/llm-config');
const LLMSelector = require('./llm/llm-selector');
const { registerVolcengineIPC } = require('./llm/volcengine-ipc');
const { RAGManager } = require('./rag/rag-manager');
const FileImporter = require('./import/file-importer');
const VideoImporter = require('./video/video-importer');
const ImageUploader = require('./image/image-uploader');
const PromptTemplateManager = require('./prompt/prompt-template-manager');
const ProjectTemplateManager = require('./template/template-manager');
const NativeMessagingHTTPServer = require('./native-messaging/http-server');
const FileSyncManager = require('./file-sync/sync-manager');
const PreviewManager = require('./preview/preview-manager');
const { getProjectConfig } = require('./project/project-config');
const MenuManager = require('./menu-manager');
const AdvancedFeaturesIPC = require('./advanced-features-ipc');
// Trade modules
const KnowledgePaymentManager = require('./trade/knowledge-payment');
const CreditScoreManager = require('./trade/credit-score');
const ReviewManager = require('./trade/review-manager');

// AI Engine modules (P1优化版 v0.17.0)
// P1: 多意图识别、动态Few-shot学习、分层规划、检查点校验、自我修正
const { AIEngineManagerP1, getAIEngineManagerP1 } = require('./ai-engine/ai-engine-manager-p1');
const AIEngineIPC = require('./ai-engine/ai-engine-ipc');

// Interactive Task Planning System (Claude Plan模式)
const InteractiveTaskPlanner = require('./ai-engine/task-planner-interactive');
const InteractivePlanningIPC = require('./ai-engine/interactive-planning-ipc');

// 创建快捷别名以保持API兼容性
const AIEngineManager = AIEngineManagerP1;
const getAIEngineManager = getAIEngineManagerP1;
const WebEngine = require('./engines/web-engine');
const DocumentEngine = require('./engines/document-engine');
const DataEngine = require('./engines/data-engine');
const ProjectStructureManager = require('./project-structure');
const GitAutoCommit = require('./git-auto-commit');

// File operation IPC
const FileIPC = require('./ipc/file-ipc');

// Backend API clients
const { ProjectFileAPI, GitAPI, RAGAPI, CodeAPI } = require('./api/backend-client');

// Knowledge version management
const { KnowledgeVersionManager } = require('./knowledge/version-manager');

// Plugin System (Phase 1)
const { PluginManager, setPluginManager } = require('./plugins/plugin-manager');

// Backend Service Manager (for production packaging)
const { getBackendServiceManager } = require('./backend-service-manager');

// Skill and Tool Management System
const ToolManager = require('./skill-tool-system/tool-manager');
const SkillManager = require('./skill-tool-system/skill-manager');
const { registerSkillToolIPC } = require('./skill-tool-system/skill-tool-ipc');
const SkillExecutor = require('./skill-tool-system/skill-executor');
const AISkillScheduler = require('./skill-tool-system/ai-skill-scheduler');
const ChatSkillBridge = require('./skill-tool-system/chat-skill-bridge');

// Speech/Voice Input System
const { registerSpeechIPC } = require('./speech/speech-ipc');

// Plugin Marketplace System
const { registerPluginMarketplaceIPC } = require('./plugins/marketplace-ipc');

// RSS and Email Integration
const RSSIPCHandler = require('./api/rss-ipc');
const EmailIPCHandler = require('./api/email-ipc');

// Database Encryption IPC
const DatabaseEncryptionIPC = require('./database-encryption-ipc');

// Initial Setup IPC
const InitialSetupIPC = require('./initial-setup-ipc');

// Identity Context Manager (Enterprise)
const { getIdentityContextManager } = require('./identity/identity-context-manager');

// Deep Link Handler (Enterprise DID Invitation Links)
const DeepLinkHandler = require('./deep-link-handler');

// Performance Monitor
const { getPerformanceMonitor } = require('../../utils/performance-monitor');

// 过滤不需要的控制台输出
const originalConsoleLog = console.log;
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;

const filterPatterns = [
  /Request interrupted/i,
  /interrupted by user/i,
  /û�п���ʵ����/,  // 乱码过滤
  /没有可用实例/,
  /[\u4e00-\u9fa5].*�/,  // 中文后面跟乱码字符
  /�.*[\u4e00-\u9fa5]/,  // 乱码字符后面跟中文
  /^[�\?]{2,}/,  // 连续的乱码字符
];

const shouldFilterMessage = (message) => {
  const msgStr = String(message);

  // 过滤空消息或只有空白字符的消息
  if (!msgStr || msgStr.trim() === '') {
    return true;
  }

  // 过滤只有单个字符或数字的消息（如 "[1]"）
  if (msgStr.trim().length <= 3 && /^[\[\]\d\s]+$/.test(msgStr.trim())) {
    return true;
  }

  // 过滤包含大量特殊字符的乱码消息（如 û�п���ʵ����）
  const specialCharCount = (msgStr.match(/[û�п]/g) || []).length;
  if (specialCharCount >= 2) {
    return true;
  }

  return filterPatterns.some(pattern => pattern.test(msgStr));
};

console.log = function(...args) {
  if (!args.some(shouldFilterMessage)) {
    originalConsoleLog.apply(console, args);
  }
};

console.error = function(...args) {
  if (!args.some(shouldFilterMessage)) {
    originalConsoleError.apply(console, args);
  }
};

console.warn = function(...args) {
  if (!args.some(shouldFilterMessage)) {
    originalConsoleWarn.apply(console, args);
  }
};

// 拦截 process.stdout 和 process.stderr 的直接输出
if (process.stdout && process.stdout.write) {
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = function(chunk, encoding, callback) {
    try {
      const str = String(chunk);
      if (!shouldFilterMessage(str)) {
        return originalStdoutWrite(chunk, encoding, callback);
      }
      return true;
    } catch (err) {
      // 忽略 EPIPE 错误（管道已关闭）
      if (err.code !== 'EPIPE') {
        throw err;
      }
      return true;
    }
  };
}

if (process.stderr && process.stderr.write) {
  const originalStderrWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = function(chunk, encoding, callback) {
    try {
      const str = String(chunk);
      if (!shouldFilterMessage(str)) {
        return originalStderrWrite(chunk, encoding, callback);
      }
      return true;
    } catch (err) {
      // 忽略 EPIPE 错误（管道已关闭）
      if (err.code !== 'EPIPE') {
        throw err;
      }
      return true;
    }
  };
}

// 递归复制目录的辅助函数
async function copyDirectory(source, destination) {
  const fs = require('fs').promises;
  const path = require('path');

  // 确保目标目录存在
  await fs.mkdir(destination, { recursive: true });

  // 读取源目录内容
  const entries = await fs.readdir(source, { withFileTypes: true });

  for (const entry of entries) {
    const sourcePath = path.join(source, entry.name);
    const destPath = path.join(destination, entry.name);

    if (entry.isDirectory()) {
      // 递归复制子目录
      await copyDirectory(sourcePath, destPath);
    } else {
      // 复制文件
      await fs.copyFile(sourcePath, destPath);
    }
  }
}

class ChainlessChainApp {
  constructor() {
    // 测试环境下重置IPC Guard，防止重复注册被跳过
    if (process.env.NODE_ENV === 'test') {
      try {
        const { ipcGuard } = require('./ipc-registry');
        console.log('[Main] Test environment detected - resetting IPC Guard...');
        if (ipcGuard && typeof ipcGuard.resetAll === 'function') {
          ipcGuard.resetAll();
          console.log('[Main] IPC Guard reset successfully');
        }
      } catch (error) {
        console.error('[Main] Failed to reset IPC Guard:', error);
        // 继续启动，不影响应用
      }
    }

    this.mainWindow = null;
    this.database = null;
    this.ukeyManager = null;
    this.gitManager = null;
    this.markdownExporter = null;
    this.llmManager = null;
    this.ragManager = null;
    this.speechManager = null;
    this.vcTemplateManager = null;
    this.fileImporter = null;
    this.imageUploader = null;
    this.promptTemplateManager = null;
    this.nativeMessagingServer = null;
    this.fileSyncManager = null;
    this.previewManager = null;
    this.knowledgePaymentManager = null;
    this.creditScoreManager = null;
    this.reviewManager = null;
    this.autoSyncTimer = null;

    // AI Engine managers
    this.aiEngineManager = null;
    this.aiEngineIPC = null;
    this.webEngine = null;
    this.documentEngine = null;
    this.dataEngine = null;
    this.projectStructureManager = null;
    this.gitAutoCommit = null;

    // Plugin System (Phase 1)
    this.pluginManager = null;

    // Skill and Tool Management System
    this.toolManager = null;
    this.skillManager = null;
    this.skillExecutor = null;
    this.aiScheduler = null;
    this.chatSkillBridge = null;

    // Web IDE
    this.webideManager = null;
    this.webideIPC = null;

    // Project stats collector
    this.statsCollector = null;

    // Database Encryption IPC
    this.dbEncryptionIPC = null;

    // Identity Context Manager (Enterprise)
    this.identityContextManager = null;

    // Deep Link Handler (Enterprise DID Invitation Links)
    this.deepLinkHandler = null;

    this.setupApp();
  }

  setupApp() {
    // macOS 特定配置
    if (process.platform === 'darwin') {
      // 禁用 macOS 窗口状态恢复（修复 NSPersistentUIRequiresSecureCoding 崩溃）
      // 这个必须在开发模式和生产模式下都设置
      app.commandLine.appendSwitch('disable-features', 'RestoreSessionState');

      // 开发模式特定配置：解决权限问题
      if (process.env.NODE_ENV === 'development') {
        // 禁用 Mach 端口渲染服务器（避免 Permission denied 1100 错误）
        app.commandLine.appendSwitch('disable-features', 'RendererCodeIntegrity');
        app.commandLine.appendSwitch('disable-site-isolation-trials');
        // 禁用GPU沙盒可以避免一些macOS权限问题
        app.commandLine.appendSwitch('in-process-gpu');
      }
    }

    // 单实例锁定（测试环境下跳过）
    if (process.env.NODE_ENV !== 'test') {
      const gotTheLock = app.requestSingleInstanceLock();
      if (!gotTheLock) {
        app.quit();
        return;
      }
    }

    app.on('second-instance', () => {
      if (this.mainWindow) {
        if (this.mainWindow.isMinimized()) this.mainWindow.restore();
        this.mainWindow.focus();
      }
    });

    // 初始化数据库加密 IPC
    this.dbEncryptionIPC = new DatabaseEncryptionIPC(app);

    // 初始化全局设置 IPC（在数据库初始化之前，因为可能需要设置数据库路径）
    const { getAppConfig } = require('./app-config');
    const { getLLMConfig } = require('./llm/llm-config');
    // 注意：this.database 此时为 null，会在 onReady 中初始化后传入
    this.initialSetupIPC = null;

    // 应用事件
    app.whenReady().then(() => this.onReady());
    app.on('window-all-closed', () => this.onWindowAllClosed());
    app.on('activate', () => this.onActivate());

    // 应用退出时停止后端服务
    app.on('will-quit', async (event) => {
      event.preventDefault();
      console.log('[Main] Application is quitting, stopping backend services...');

      // 清理菜单管理器
      if (this.menuManager) {
        this.menuManager.destroy();
        this.menuManager = null;
      }

      // 清理 RSS 和 Email IPC 处理器
      if (this.rssIPCHandler) {
        this.rssIPCHandler.cleanup();
      }
      if (this.emailIPCHandler) {
        this.emailIPCHandler.cleanup();
      }

      const backendManager = getBackendServiceManager();
      await backendManager.stopServices();
      app.exit(0);
    });

  }

  /**
   * 初始化语音管理器（供IPC注册使用）
   * 这是一个延迟初始化函数，确保在需要时才创建管理器
   */
  async initializeSpeechManager() {
    if (!this.speechManager) {
      console.log('[Main] 延迟初始化语音管理器...');
      const { SpeechManager } = require('./speech/speech-manager');
      this.speechManager = new SpeechManager(this.database, this.ragManager);
      await this.speechManager.initialize();
      console.log('[Main] 语音管理器延迟初始化成功');
    }
    return this.speechManager;
  }

  async onReady() {
    console.log('ChainlessChain Vue 启动中...');

    // 启动后端服务（仅在生产环境）
    try {
      const backendManager = getBackendServiceManager();
      await backendManager.startServices();
    } catch (error) {
      console.error('[Main] Failed to start backend services:', error);
      // 继续启动应用，即使后端服务启动失败
    }

    // IPC handlers - 延迟到管理器初始化完成后注册
    // setupIPC() 将在所有管理器初始化完成后调用

    // 显示后端服务配置
    console.log('='.repeat(60));
    console.log('后端服务配置:');
    console.log('  Java Service (Project):', process.env.PROJECT_SERVICE_URL || 'http://localhost:9090');
    console.log('  Python Service (AI):', process.env.AI_SERVICE_URL || 'http://localhost:8001');
    console.log('  备注: 后端不可用时将自动降级到本地处理');
    console.log('='.repeat(60));

    // 初始化数据库
    try {
      console.log('初始化数据库...');

      // 检查加密配置（只有用户启用加密后才使用加密数据库）
      const EncryptionConfigManager = require('./database/config-manager');
      const encryptionConfig = new EncryptionConfigManager(app);
      const encryptionEnabled = encryptionConfig.isEncryptionEnabled();

      console.log(`数据库加密状态: ${encryptionEnabled ? '已启用' : '未启用'}`);

      // 使用默认密码进行数据库加密（与认证密码一致）
      const DEFAULT_PASSWORD = process.env.DEFAULT_PASSWORD || '123456';
      this.database = new DatabaseManager(null, {
        password: DEFAULT_PASSWORD,
        encryptionEnabled: encryptionEnabled  // 从配置读取，默认false
      });
      await this.database.initialize();

      // 设置数据库单例（供其他模块使用）
      const { setDatabase } = require('./database');
      setDatabase(this.database);

      // 设置数据库加密 IPC 的数据库引用
      if (this.dbEncryptionIPC) {
        this.dbEncryptionIPC.setDatabaseManager(this.database);
      }

      // 初始化全局设置 IPC（在数据库初始化之后）
      if (!this.initialSetupIPC) {
        const { getAppConfig } = require('./app-config');
        const { getLLMConfig } = require('./llm/llm-config');
        this.initialSetupIPC = new InitialSetupIPC(
          app,
          this.database,
          getAppConfig(),
          getLLMConfig()
        );
      }

      // 初始化知识图谱提取器
      this.graphExtractor = new GraphExtractor(this.database);

      // 初始化版本管理器
      this.versionManager = new KnowledgeVersionManager(this.database.db);

      console.log('数据库初始化成功');
    } catch (error) {
      console.error('数据库初始化失败:', error);
      // 即使数据库初始化失败，也继续启动应用
    }

    // 初始化性能监控器
    try {
      console.log('初始化性能监控器...');
      this.performanceMonitor = getPerformanceMonitor();
      this.performanceMonitor.start();
      console.log('性能监控器初始化成功');
    } catch (error) {
      console.error('性能监控器初始化失败:', error);
    }

    // 初始化文件导入器
    try {
      console.log('初始化文件导入器...');
      this.fileImporter = new FileImporter(this.database);
      console.log('文件导入器初始化成功');
    } catch (error) {
      console.error('文件导入器初始化失败:', error);
    }

    // 初始化视频导入器
    try {
      console.log('初始化视频导入器...');
      this.videoImporter = new VideoImporter(this.database, app.getPath('userData'));
      await this.videoImporter.initializeStorageDirectories();
      console.log('视频导入器初始化成功');
    } catch (error) {
      console.error('视频导入器初始化失败:', error);
    }

    // 初始化项目模板管理器
    try {
      console.log('初始化项目模板管理器...');
      this.templateManager = new ProjectTemplateManager(this.database);
      await this.templateManager.initialize();
      console.log('项目模板管理器初始化成功');
    } catch (error) {
      console.error('项目模板管理器初始化失败:', error);
    }

    // 初始化U盾管理器
    try {
      // console.log('初始化U盾管理器...');
      this.ukeyManager = new UKeyManager({
        driverType: DriverTypes.XINJINKE,
      });
      await this.ukeyManager.initialize();

      // 启动设备监听
      this.ukeyManager.startDeviceMonitor(5000);

      // 监听U盾事件
      this.setupUKeyEvents();

      // console.log('U盾管理器初始化成功');
    } catch (error) {
      // console.error('U盾管理器初始化失败:', error);
      // 即使U盾初始化失败，也继续启动应用（将使用模拟模式）
    }

    // 初始化Git管理器
    try {
      console.log('初始化Git管理器...');
      const gitConfig = getGitConfig();

      if (gitConfig.isEnabled()) {
        const repoPath = gitConfig.getRepoPath() || path.join(app.getPath('userData'), 'git-repo');
        const exportPath = path.join(repoPath, gitConfig.getExportPath());

        this.gitManager = new GitManager({
          repoPath,
          remoteUrl: gitConfig.getRemoteUrl(),
          authorName: gitConfig.get('authorName'),
          authorEmail: gitConfig.get('authorEmail'),
          auth: gitConfig.getAuth(),
        });

        await this.gitManager.initialize();

        // 创建Markdown导出器
        this.markdownExporter = new MarkdownExporter(this.database, exportPath);

        // 初始化Git热重载
        try {
          console.log('初始化Git热重载...');
          const GitHotReload = require('./git/git-hot-reload');
          this.gitHotReload = new GitHotReload(this.gitManager, {
            enabled: gitConfig.get('hotReloadEnabled') !== false, // 默认启用
            debounceDelay: gitConfig.get('hotReloadDebounceDelay') || 1000,
          });

          // 启动热重载
          this.gitHotReload.start();
          console.log('Git热重载初始化成功');
        } catch (error) {
          console.error('Git热重载初始化失败:', error);
          // 热重载失败不影响Git基本功能
        }

        // 监听Git事件
        this.setupGitEvents();

        // 启动自动同步
        if (gitConfig.isAutoSyncEnabled()) {
          this.startAutoSync(gitConfig.getAutoSyncInterval());
        }

        console.log('Git管理器初始化成功');
      } else {
        console.log('Git同步未启用');
      }
    } catch (error) {
      console.error('Git管理器初始化失败:', error);
      // 即使Git初始化失败，也继续启动应用
    }

    // 初始化LLM选择器
    try {
      console.log('初始化LLM选择器...');
      this.llmSelector = new LLMSelector(this.database);
      console.log('LLM选择器初始化成功');
    } catch (error) {
      console.error('LLM选择器初始化失败:', error);
    }

    // 初始化LLM管理器
    try {
      console.log('初始化LLM管理器...');

      // 🔥 检查是否在测试模式下使用Mock LLM服务
      const { getTestModeConfig } = require('./test-mode-config');
      const testModeConfig = getTestModeConfig();

      if (testModeConfig.mockLLM) {
        console.log('[Main] ✓ 测试模式：使用Mock LLM服务');
        this.llmManager = testModeConfig.getMockLLMService();

        if (!this.llmManager) {
          throw new Error('Mock LLM服务加载失败');
        }

        console.log('[Main] ✓ Mock LLM服务初始化成功');
      } else {
        // 从llm-config.json加载配置
        const llmConfig = getLLMConfig();
        const provider = llmConfig.getProvider();
        console.log(`[Main] 当前LLM提供商: ${provider}`);

        const autoSelect = this.database.getSetting('llm.autoSelect');

        // 临时禁用智能选择，尊重用户配置
        // 如果启用了智能选择，自动选择最优LLM
        // if (autoSelect && this.llmSelector) {
        //   const selectedProvider = this.llmSelector.selectBestLLM({ taskType: 'chat' });
        //   console.log(`[Main] 智能选择LLM: ${selectedProvider}`);
        //   llmConfig.setProvider(selectedProvider);
        // }
        if (autoSelect && this.llmSelector) {
          console.log(`[Main] 智能选择已禁用，使用配置的提供商: ${provider}`);
        }

        // 使用LLMConfig的getManagerConfig方法获取完整配置
        const managerConfig = llmConfig.getManagerConfig();
        console.log(`[Main] LLM管理器配置:`, {
          provider: managerConfig.provider,
          model: managerConfig.model,
          baseURL: managerConfig.baseURL,
          apiKey: managerConfig.apiKey ? `${managerConfig.apiKey.substring(0, 8)}...` : '(未设置)'
        });

        this.llmManager = new LLMManager(managerConfig);
        await this.llmManager.initialize();

        console.log('LLM管理器初始化成功');
      }
    } catch (error) {
      console.error('LLM管理器初始化失败:', error);
      // LLM初始化失败不影响应用启动
    }

    // 初始化RAG管理器
    try {
      console.log('初始化RAG管理器...');
      this.ragManager = new RAGManager(this.database, this.llmManager);
      await this.ragManager.initialize();
      console.log('RAG管理器初始化成功');
    } catch (error) {
      console.error('RAG管理器初始化失败:', error);
      // RAG初始化失败不影响应用启动
    }

    // 初始化语音管理器
    try {
      console.log('初始化语音管理器...');
      const { SpeechManager } = require('./speech/speech-manager');
      this.speechManager = new SpeechManager(this.database, this.ragManager);
      await this.speechManager.initialize();
      console.log('语音管理器初始化成功');
    } catch (error) {
      console.error('语音管理器初始化失败:', error);
      // 语音管理器初始化失败不影响应用启动
    }

    // 初始化图片上传器
    try {
      console.log('初始化图片上传器...');
      this.imageUploader = new ImageUploader(this.database, this.ragManager);
      await this.imageUploader.initialize();
      console.log('图片上传器初始化成功');
    } catch (error) {
      console.error('图片上传器初始化失败:', error);
      // 图片上传器初始化失败不影响应用启动
    }

    // 初始化提示词模板管理器
    try {
      console.log('初始化提示词模板管理器...');
      this.promptTemplateManager = new PromptTemplateManager(this.database);
      await this.promptTemplateManager.initialize();
      console.log('提示词模板管理器初始化成功');
    } catch (error) {
      console.error('提示词模板管理器初始化失败:', error);
      // 提示词模板管理器初始化失败不影响应用启动
    }

    // 初始化DID管理器
    try {
      console.log('初始化DID管理器...');
      const DIDManager = require('./did/did-manager');
      this.didManager = new DIDManager(this.database);
      await this.didManager.initialize();
      console.log('DID管理器初始化成功');
    } catch (error) {
      console.error('DID管理器初始化失败:', error);
      // DID初始化失败不影响应用启动
    }

    // 初始化P2P管理器
    try {
      console.log('初始化P2P管理器...');
      const P2PManager = require('./p2p/p2p-manager');
      this.p2pManager = new P2PManager({
        port: 9000,
        enableMDNS: true,
        enableDHT: true,
        dataPath: path.join(app.getPath('userData'), 'p2p'),
      });
      // P2P 初始化可能较慢，使用后台初始化
      this.p2pManager.initialize().then((initialized) => {
        if (!initialized) {
          console.warn('P2P管理器未启用');
          return;
        }
        console.log('P2P管理器初始化成功');

        // 设置 P2P 加密消息事件监听
        this.setupP2PEncryptionEvents();

        // 初始化移动端桥接
        this.initializeMobileBridge().catch(error => {
          console.error('移动端桥接初始化失败:', error);
        });

        // P2P初始化成功后，设置到DID管理器中以启用DHT功能
        if (this.didManager) {
          this.didManager.setP2PManager(this.p2pManager);
          console.log('P2P管理器已设置到DID管理器');

          // 启动自动重新发布 DID（默认 24 小时间隔）
          try {
            this.didManager.startAutoRepublish(24 * 60 * 60 * 1000);
            console.log('DID 自动重新发布已启动');
          } catch (error) {
            console.error('启动 DID 自动重新发布失败:', error);
          }
        }

        // 设置好友管理器到 P2P 管理器 (在 friend manager 初始化后)
        if (this.friendManager) {
          this.p2pManager.setFriendManager(this.friendManager);
          console.log('好友管理器已设置到 P2P 管理器');
        }
      }).catch((error) => {
        console.error('P2P管理器初始化失败:', error);
      });
    } catch (error) {
      console.error('P2P管理器初始化失败:', error);
    }

    // 初始化联系人管理器
    try {
      console.log('初始化联系人管理器...');
      const ContactManager = require('./contacts/contact-manager');
      this.contactManager = new ContactManager(this.database, this.p2pManager, this.didManager);
      await this.contactManager.initialize();
      console.log('联系人管理器初始化成功');
    } catch (error) {
      console.error('联系人管理器初始化失败:', error);
    }

    // 初始化身份上下文管理器（企业版）
    // 🚧 临时禁用：先确保个人版正常运行，后期再平滑过渡到企业版
    // 仅在用户已经创建DID后才初始化,保证个人版平滑过渡
    /*
    try {
      if (this.didManager) {
        const currentDID = await this.didManager.getCurrentDID();

        // 只有在用户已有DID时才初始化身份上下文管理器
        if (currentDID) {
          console.log('初始化身份上下文管理器...');
          const dataDir = path.join(app.getPath('userData'), 'data');
          this.identityContextManager = getIdentityContextManager(dataDir);
          await this.identityContextManager.initialize();

          // 确保个人上下文存在
          await this.identityContextManager.createPersonalContext(currentDID, '个人');

          // 监听身份上下文切换事件
          this.identityContextManager.on('context-switched', async (eventData) => {
            await this.handleContextSwitch(eventData);
          });

          console.log('身份上下文管理器初始化成功');
        } else {
          console.log('用户尚未创建DID,跳过身份上下文管理器初始化');
        }
      }
    } catch (error) {
      console.error('身份上下文管理器初始化失败:', error);
      // 身份上下文管理器初始化失败不影响应用启动
    }
    */
    console.log('⚠️ 企业版功能已临时禁用，使用传统个人版模式 (chainlesschain.db)');

    // 初始化组织管理器（企业版）
    try {
      console.log('初始化组织管理器...');
      const OrganizationManager = require('./organization/organization-manager');
      this.organizationManager = new OrganizationManager(this.database, this.didManager, this.p2pManager);
      console.log('组织管理器初始化成功');
    } catch (error) {
      console.error('组织管理器初始化失败:', error);
      // 组织管理器初始化失败不影响应用启动
    }

    // 初始化深链接处理器（企业版DID邀请链接）
    try {
      console.log('初始化深链接处理器...');
      this.deepLinkHandler = new DeepLinkHandler(this.mainWindow, this.organizationManager);
      this.deepLinkHandler.register(app);
      console.log('深链接处理器初始化成功');
    } catch (error) {
      console.error('深链接处理器初始化失败:', error);
    }

    // 初始化协作管理器（企业版集成）
    try {
      console.log('初始化协作管理器...');
      const { getCollaborationManager } = require('./collaboration/collaboration-manager');
      this.collaborationManager = getCollaborationManager();

      // 设置组织管理器引用,启用企业版权限检查
      if (this.organizationManager) {
        this.collaborationManager.setOrganizationManager(this.organizationManager);
        console.log('✓ 协作管理器已集成组织权限系统');
      }

      console.log('协作管理器初始化成功');
    } catch (error) {
      console.error('协作管理器初始化失败:', error);
      // 协作管理器初始化失败不影响应用启动
    }

    // 初始化P2P同步引擎
    try {
      console.log('初始化P2P同步引擎...');
      const P2PSyncEngine = require('./sync/p2p-sync-engine');
      this.syncEngine = new P2PSyncEngine(this.database, this.didManager, this.p2pManager);
      await this.syncEngine.initialize();
      console.log('P2P同步引擎初始化成功');
    } catch (error) {
      console.error('P2P同步引擎初始化失败:', error);
      // 同步引擎初始化失败不影响应用启动
    }

    // 初始化好友管理器
    try {
      console.log('初始化好友管理器...');
      const { FriendManager } = require('./social/friend-manager');
      this.friendManager = new FriendManager(this.database, this.didManager, this.p2pManager);
      await this.friendManager.initialize();
      console.log('好友管理器初始化成功');
    } catch (error) {
      console.error('好友管理器初始化失败:', error);
      // 不影响应用启动
    }

    // 初始化动态管理器
    try {
      console.log('初始化动态管理器...');
      const { PostManager } = require('./social/post-manager');
      this.postManager = new PostManager(this.database, this.didManager, this.p2pManager, this.friendManager);
      await this.postManager.initialize();

      // 在 P2P 管理器中设置动态管理器
      if (this.p2pManager) {
        this.p2pManager.setPostManager(this.postManager);
      }

      console.log('动态管理器初始化成功');
    } catch (error) {
      console.error('动态管理器初始化失败:', error);
      // 不影响应用启动
    }

    // 初始化资产管理器
    try {
      console.log('初始化资产管理器...');
      const { AssetManager } = require('./trade/asset-manager');
      this.assetManager = new AssetManager(this.database, this.didManager, this.p2pManager);
      await this.assetManager.initialize();
      console.log('资产管理器初始化成功');
    } catch (error) {
      console.error('资产管理器初始化失败:', error);
      // 不影响应用启动
    }

    // 初始化托管管理器
    try {
      console.log('初始化托管管理器...');
      const { EscrowManager } = require('./trade/escrow-manager');
      this.escrowManager = new EscrowManager(this.database, this.didManager, this.assetManager);
      await this.escrowManager.initialize();
      console.log('托管管理器初始化成功');
    } catch (error) {
      console.error('托管管理器初始化失败:', error);
      // 不影响应用启动
    }

    // 初始化项目统计收集器
    try {
      console.log('初始化项目统计收集器...');
      this.statsCollector = new ProjectStatsCollector(this.database.db);
      console.log('项目统计收集器初始化成功');
    } catch (error) {
      console.error('项目统计收集器初始化失败:', error);
      // 不影响应用启动
    }

    // 初始化交易市场管理器
    try {
      console.log('初始化交易市场管理器...');
      const { MarketplaceManager } = require('./trade/marketplace-manager');
      this.marketplaceManager = new MarketplaceManager(
        this.database,
        this.didManager,
        this.assetManager,
        this.escrowManager
      );
      await this.marketplaceManager.initialize();
      console.log('交易市场管理器初始化成功');
    } catch (error) {
      console.error('交易市场管理器初始化失败:', error);
      // 不影响应用启动
    }

    // 初始化智能合约引擎
    try {
      console.log('初始化智能合约引擎...');
      const { SmartContractEngine } = require('./trade/contract-engine');
      this.contractEngine = new SmartContractEngine(
        this.database,
        this.didManager,
        this.assetManager,
        this.escrowManager
      );
      await this.contractEngine.initialize();
      console.log('智能合约引擎初始化成功');
    } catch (error) {
      console.error('智能合约引擎初始化失败:', error);
      // 不影响应用启动
    }

    // 初始化知识付费管理器
    try {
      console.log('初始化知识付费管理器...');
      this.knowledgePaymentManager = new KnowledgePaymentManager(
        this.database,
        this.assetManager,
        this.p2pManager
      );
      await this.knowledgePaymentManager.initialize();
      console.log('知识付费管理器初始化成功');
    } catch (error) {
      console.error('知识付费管理器初始化失败:', error);
      // 不影响应用启动
    }

    // 初始化信用评分管理器
    try {
      console.log('初始化信用评分管理器...');
      this.creditScoreManager = new CreditScoreManager(this.database);
      console.log('信用评分管理器初始化成功');
    } catch (error) {
      console.error('信用评分管理器初始化失败:', error);
      // 不影响应用启动
    }

    // 初始化评价管理器
    try {
      console.log('初始化评价管理器...');
      this.reviewManager = new ReviewManager(this.database);
      console.log('评价管理器初始化成功');
    } catch (error) {
      console.error('评价管理器初始化失败:', error);
      // 不影响应用启动
    }

    // ============================
    // 初始化区块链模块
    // ============================

    // 初始化钱包管理器
    try {
      console.log('初始化区块链钱包管理器...');
      const { WalletManager } = require('./blockchain/wallet-manager');
      this.walletManager = new WalletManager(this.database, this.ukeyManager, null);
      await this.walletManager.initialize();
      console.log('区块链钱包管理器初始化成功');
    } catch (error) {
      console.error('区块链钱包管理器初始化失败:', error);
      // 不影响应用启动
    }

    // 初始化区块链适配器
    try {
      console.log('初始化区块链适配器...');
      const BlockchainAdapter = require('./blockchain/blockchain-adapter');
      this.blockchainAdapter = new BlockchainAdapter(this.database, this.walletManager);
      await this.blockchainAdapter.initialize();

      // 设置钱包管理器的区块链适配器引用
      if (this.walletManager) {
        this.walletManager.blockchainAdapter = this.blockchainAdapter;
      }

      // 设置资产管理器的区块链适配器引用
      if (this.assetManager) {
        this.assetManager.blockchainAdapter = this.blockchainAdapter;
        console.log('已注入区块链适配器到资产管理器');
      }

      // 设置合约引擎的区块链适配器引用
      if (this.smartContractEngine) {
        this.smartContractEngine.blockchainAdapter = this.blockchainAdapter;
        console.log('已注入区块链适配器到合约引擎');
      }

      console.log('区块链适配器初始化成功');
    } catch (error) {
      console.error('区块链适配器初始化失败:', error);
      // 不影响应用启动
    }

    // 初始化交易监控器
    try {
      console.log('初始化区块链交易监控器...');
      const { TransactionMonitor } = require('./blockchain/transaction-monitor');
      this.transactionMonitor = new TransactionMonitor(this.blockchainAdapter, this.database);
      await this.transactionMonitor.initialize();
      console.log('区块链交易监控器初始化成功');
    } catch (error) {
      console.error('区块链交易监控器初始化失败:', error);
      // 不影响应用启动
    }

    // 初始化跨链桥管理器
    try {
      console.log('初始化跨链桥管理器...');
      const BridgeManager = require('./blockchain/bridge-manager');
      this.bridgeManager = new BridgeManager(this.blockchainAdapter, this.database);
      await this.bridgeManager.initialize();
      console.log('跨链桥管理器初始化成功');
    } catch (error) {
      console.error('跨链桥管理器初始化失败:', error);
      // 不影响应用启动
    }

    // 初始化外部钱包连接器
    try {
      console.log('初始化外部钱包连接器...');
      const { ExternalWalletConnector } = require('./blockchain/external-wallet-connector');
      this.externalWalletConnector = new ExternalWalletConnector(this.database);
      await this.externalWalletConnector.initialize();
      console.log('外部钱包连接器初始化成功');
    } catch (error) {
      console.error('外部钱包连接器初始化失败:', error);
      // 不影响应用启动
    }

    // ============================
    // 区块链模块初始化完成
    // ============================

    // 初始化可验证凭证管理器
    try {
      console.log('初始化可验证凭证管理器...');
      const { VCManager } = require('./vc/vc-manager');
      this.vcManager = new VCManager(this.database, this.didManager);
      await this.vcManager.initialize();
      console.log('可验证凭证管理器初始化成功');
    } catch (error) {
      console.error('可验证凭证管理器初始化失败:', error);
    }

    // 初始化可验证凭证模板管理器
    try {
      console.log('初始化凭证模板管理器...');
      const VCTemplateManager = require('./vc/vc-template-manager');
      this.vcTemplateManager = new VCTemplateManager(this.database);
      await this.vcTemplateManager.initialize();
      console.log('凭证模板管理器初始化成功');
    } catch (error) {
      console.error('凭证模板管理器初始化失败:', error);
    }

    // 初始化 Native Messaging HTTP Server (用于浏览器扩展通信)
    try {
      console.log('初始化 Native Messaging HTTP Server...');
      this.nativeMessagingServer = new NativeMessagingHTTPServer(this.database, this.ragManager);
      await this.nativeMessagingServer.start();
      console.log('Native Messaging HTTP Server 初始化成功');
    } catch (error) {
      console.error('Native Messaging HTTP Server 初始化失败:', error);
      // 不影响主应用启动
    }

    // 初始化AI引擎和相关模块
    try {
      console.log('初始化AI引擎...');

      // 创建引擎实例
      this.webEngine = new WebEngine();
      this.documentEngine = new DocumentEngine();
    // 初始化 Web IDE
    console.log('[Main] 初始化 Web IDE...');
    const WebIDEManager = require('./webide/webide-manager');
    const WebIDEIPC = require('./webide/webide-ipc');
    const PreviewServer = require('./engines/preview-server');

    // 初始化 Preview Server（如果还没有）
    if (!this.previewServer) {
      this.previewServer = new PreviewServer();
    }

    this.webideManager = new WebIDEManager();
    this.webideIPC = new WebIDEIPC(this.webideManager, this.previewServer);
    this.webideIPC.registerHandlers();
    console.log('[Main] Web IDE 管理器初始化完成');

      this.dataEngine = new DataEngine();
      this.projectStructureManager = new ProjectStructureManager();
      this.gitAutoCommit = new GitAutoCommit({ enabled: false, interval: 5 * 60 * 1000 });

      // 创建AI引擎管理器 (使用单例模式)
      this.aiEngineManager = getAIEngineManager();

      // 初始化AI引擎管理器（异步初始化增强版任务规划器）
      this.aiEngineManager.initialize().catch(error => {
        console.error('[ChainlessChainApp] AI引擎管理器初始化失败:', error);
      });

      // 注册自定义工具（集成到Function Caller）
      this.aiEngineManager.registerTool(
        'create_project_structure',
        async (params, context) => {
          return await this.projectStructureManager.createStructure(
            params.projectPath,
            params.type,
            params.projectName
          );
        },
        {
          name: 'create_project_structure',
          description: '创建项目目录结构',
          parameters: {
            projectPath: { type: 'string', description: '项目路径' },
            type: { type: 'string', description: '项目类型' },
            projectName: { type: 'string', description: '项目名称' },
          },
        }
      );

      console.log('AI引擎初始化成功');
    } catch (error) {
      console.error('AI引擎初始化失败:', error);
      // 不影响主应用启动
    }

    // 初始化技能和工具管理系统
    try {
      console.log('[Main] 初始化技能和工具管理系统...');

      const functionCaller = this.aiEngineManager?.functionCaller;
      if (!functionCaller) {
        throw new Error('FunctionCaller未初始化');
      }

      this.toolManager = new ToolManager(this.database, functionCaller);
      this.skillManager = new SkillManager(this.database, this.toolManager);

      await this.toolManager.initialize();
      await this.skillManager.initialize();

      // 设置FunctionCaller的ToolManager引用
      functionCaller.setToolManager(this.toolManager);

      // 初始化技能执行器
      this.skillExecutor = new SkillExecutor(this.skillManager, this.toolManager);

      // 初始化AI调度器（需要LLM服务）
      this.aiScheduler = new AISkillScheduler(
        this.skillManager,
        this.toolManager,
        this.skillExecutor,
        this.llmManager
      );

      // 初始化对话-技能桥接器
      this.chatSkillBridge = new ChatSkillBridge(
        this.skillManager,
        this.toolManager,
        this.skillExecutor,
        this.aiScheduler
      );

      // 注册技能和工具IPC handlers（在初始化完成后）
      registerSkillToolIPC({
        ipcMain,
        skillManager: this.skillManager,
        toolManager: this.toolManager
      });
      console.log('[Main] 技能和工具IPC handlers已注册');

      // 注册火山引擎工具调用IPC handlers
      try {
        registerVolcengineIPC();
        console.log('[Main] 火山引擎工具调用IPC handlers已注册');
      } catch (error) {
        console.warn('[Main] 火山引擎IPC注册失败（可能API Key未配置）:', error.message);
      }

      // 注册语音/语音输入IPC handlers
      try {
        registerSpeechIPC({
          initializeSpeechManager: this.initializeSpeechManager.bind(this)
        });
        console.log('[Main] 语音输入IPC handlers已注册 (34 handlers)');
      } catch (error) {
        console.error('[Main] 语音输入IPC注册失败:', error);
      }

      console.log('[Main] 技能和工具管理系统初始化完成（含桥接器）');
    } catch (error) {
      console.error('[Main] 技能和工具管理系统初始化失败:', error);
      // 不影响主应用启动
    }

    // 初始化交互式任务规划系统 (Claude Plan模式)
    try {
      console.log('[Main] 初始化交互式任务规划系统...');

      this.interactiveTaskPlanner = new InteractiveTaskPlanner({
        database: this.database,
        llmManager: this.llmManager,
        templateManager: this.templateManager,
        skillManager: this.skillManager,
        toolManager: this.toolManager,
        aiEngineManager: this.aiEngineManager
      });

      console.log('[Main] 交互式任务规划系统初始化完成');
    } catch (error) {
      console.error('[Main] 交互式任务规划系统初始化失败:', error);
      // 不影响主应用启动
    }

    // 初始化插件系统 (Phase 2)
    try {
      console.log('初始化插件系统...');
      const { getPluginManager } = require('./plugins/plugin-manager');
      this.pluginManager = getPluginManager(this.database, {
        pluginsDir: path.join(app.getPath('userData'), 'plugins'),
      });

      // 设置系统上下文（提供给插件API）
      this.pluginManager.setSystemContext({
        database: this.database,
        llmManager: this.llmManager,
        ragManager: this.ragManager,
        gitManager: this.gitManager,
        fileImporter: this.fileImporter,
        imageUploader: this.imageUploader,
        aiEngineManager: this.aiEngineManager,
        webEngine: this.webEngine,
        documentEngine: this.documentEngine,
        dataEngine: this.dataEngine,
        skillManager: this.skillManager,
        toolManager: this.toolManager,
      });

      await this.pluginManager.initialize();
      console.log('插件系统初始化成功');

      // 监听插件事件
      this.setupPluginEvents();
    } catch (error) {
      console.error('插件系统初始化失败:', error);
      // 不影响主应用启动
    }

    // Note: setupIPC() will be called after all managers are initialized
    // including syncManager, previewManager, etc.

    await this.createWindow();

    // 处理启动时的协议URL (Windows/Linux)
    if (this.deepLinkHandler && process.platform !== 'darwin') {
      this.deepLinkHandler.handleStartupUrl(process.argv);
    }
  }

  /**
   * 处理身份上下文切换
   * 切换数据库连接到新的身份上下文
   */
  async handleContextSwitch(eventData) {
    try {
      const { from, to } = eventData;
      console.log(`\n🔄 处理身份上下文切换: ${from?.display_name || '无'} → ${to.display_name}`);

      // 1. 获取新上下文的数据库路径
      const newDbPath = to.db_path;

      if (!fs.existsSync(newDbPath)) {
        console.error(`❌ 数据库文件不存在: ${newDbPath}`);
        return;
      }

      // 2. 关闭当前数据库连接
      if (this.database && this.database.db) {
        console.log('关闭当前数据库连接...');
        try {
          // SQLite 不需要显式关闭,但清理引用
          this.database.db = null;
        } catch (error) {
          console.error('关闭数据库失败:', error);
        }
      }

      // 3. 重新初始化数据库管理器到新路径
      console.log(`初始化新数据库: ${newDbPath}`);
      const DEFAULT_PASSWORD = process.env.DEFAULT_PASSWORD || '123456';
      this.database = new DatabaseManager(newDbPath, {
        password: DEFAULT_PASSWORD,
        encryptionEnabled: true
      });
      await this.database.initialize();

      // 4. 更新数据库单例
      const { setDatabase } = require('./database');
      setDatabase(this.database);

      // 5. 重新初始化依赖数据库的模块
      console.log('重新初始化数据库依赖模块...');

      // 重新初始化知识图谱提取器
      if (this.graphExtractor) {
        this.graphExtractor = new GraphExtractor(this.database);
      }

      // 重新设置数据库加密 IPC
      if (this.dbEncryptionIPC) {
        this.dbEncryptionIPC.setDatabaseManager(this.database);
      }

      // 重新设置 InitialSetupIPC
      if (this.initialSetupIPC) {
        const { getAppConfig } = require('./app-config');
        const { getLLMConfig } = require('./llm/llm-config');
        this.initialSetupIPC = new InitialSetupIPC(
          app,
          this.database,
          getAppConfig(),
          getLLMConfig()
        );
      }

      // 6. 通知渲染进程数据库已切换
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send('database-switched', {
          contextId: to.context_id,
          contextType: to.context_type,
          displayName: to.display_name
        });
      }

      console.log(`✅ 身份上下文切换完成: ${to.display_name}\n`);
    } catch (error) {
      console.error('❌ 处理身份上下文切换失败:', error);
    }
  }

  async createWindow() {
    // 清除会话缓存以解决ERR_CACHE_READ_FAILURE错误（仅在app ready后）
    if (app.isReady()) {
      const { session } = require('electron');
      try {
        await session.defaultSession.clearCache();
        console.log('[Main] 会话缓存已清除');
      } catch (error) {
        console.error('[Main] 清除缓存失败:', error);
      }
    }

    this.mainWindow = new BrowserWindow({
      width: 1200,
      height: 800,
      minWidth: 800,
      minHeight: 600,
      backgroundColor: '#ffffff',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, '../preload/index.js'),
      },
      titleBarStyle: 'hidden',
      titleBarOverlay: {
        color: '#ffffff',
        symbolColor: '#000000',
      },
    });

    // 加载应用
    if (process.env.NODE_ENV === 'development') {
      this.mainWindow.loadURL('http://localhost:5173');
      this.mainWindow.webContents.openDevTools();
    } else {
      this.mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
    }

    this.mainWindow.on('closed', () => {
      this.mainWindow = null;
    });

    // 设置数据库加密 IPC 的主窗口引用
    if (this.dbEncryptionIPC) {
      this.dbEncryptionIPC.setMainWindow(this.mainWindow);
    }

    // 设置深链接处理器的主窗口引用
    if (this.deepLinkHandler) {
      this.deepLinkHandler.setMainWindow(this.mainWindow);
    }

    // 注册 System IPC（需要 mainWindow）
    try {
      console.log('[Main] Registering System IPC (deferred)...');
      const { registerSystemIPC } = require('./system/system-ipc');
      registerSystemIPC({ mainWindow: this.mainWindow });
      console.log('[Main] ✓ System IPC registered (16 handlers)');
    } catch (error) {
      console.error('[Main] System IPC registration failed:', error);
    }

    // 注册 Config IPC
    try {
      console.log('[Main] Registering Config IPC...');
      const { registerConfigIPC } = require('./config/config-ipc');
      registerConfigIPC({ appConfig: getAppConfig() });
      console.log('[Main] ✓ Config IPC registered (5 handlers)');
    } catch (error) {
      console.error('[Main] Config IPC registration failed:', error);
    }

    // 初始化文件同步管理器
    try {
      console.log('初始化文件同步管理器...');
      this.fileSyncManager = new FileSyncManager(this.database, this.mainWindow);
      console.log('文件同步管理器初始化成功');
    } catch (error) {
      console.error('文件同步管理器初始化失败:', error);
    }

    // 初始化数据库同步管理器
    try {
      console.log('初始化数据库同步管理器...');
      const DBSyncManager = require('./sync/db-sync-manager');
      this.syncManager = new DBSyncManager(this.database, this.mainWindow);

      // 监听同步事件
      this.syncManager.on('sync:conflicts-detected', (data) => {
        console.log('[Main] 检测到同步冲突:', data.conflicts.length);
      });

      console.log('数据库同步管理器初始化成功');
    } catch (error) {
      console.error('数据库同步管理器初始化失败:', error);
      // 同步功能可选，不影响应用启动
    }

    // 初始化预览管理器
    try {
      console.log('初始化预览管理器...');
      this.previewManager = new PreviewManager(this.mainWindow);
      console.log('预览管理器初始化成功');
    } catch (error) {
      console.error('预览管理器初始化失败:', error);
    }

    // 创建应用菜单
    try {
      console.log('创建应用菜单...');
      this.menuManager = new MenuManager(this.mainWindow);
      this.menuManager.createMenu();
      console.log('✓ 应用菜单已创建');
    } catch (error) {
      console.error('应用菜单创建失败:', error);
    }

    // 注册高级特性IPC handlers
    try {
      console.log('注册高级特性IPC handlers...');
      this.advancedFeaturesIPC = new AdvancedFeaturesIPC(this.mainWindow);
      console.log('✓ 高级特性IPC handlers注册成功');
    } catch (error) {
      console.error('高级特性IPC注册失败:', error);
    }

    // 注册AI引擎IPC handlers
    if (this.aiEngineManager && !this.aiEngineIPC) {
      try {
        console.log('注册AI引擎IPC handlers...');

        // 设置主窗口引用用于发送任务事件
        if (this.webEngine) {
          this.webEngine.setMainWindow(this.mainWindow);
        }
        if (this.documentEngine && this.documentEngine.setMainWindow) {
          this.documentEngine.setMainWindow(this.mainWindow);
        }
        if (this.dataEngine && this.dataEngine.setMainWindow) {
          this.dataEngine.setMainWindow(this.mainWindow);
        }

        this.aiEngineIPC = new AIEngineIPC(
          this.aiEngineManager,
          this.webEngine,
          this.documentEngine,
          this.dataEngine,
          this.gitAutoCommit
        );
        this.aiEngineIPC.registerHandlers(this.mainWindow);
        console.log('AI引擎IPC handlers注册成功');
      } catch (error) {
        console.error('AI引擎IPC handlers注册失败:', error);
      }
    }

    // 注册文件操作IPC handlers
    if (!this.fileIPC) {
      try {
        console.log('注册文件操作IPC handlers...');

        this.fileIPC = new FileIPC();

        // 传递引擎实例
        const excelEngine = require('./engines/excel-engine');
        const wordEngine = require('./engines/word-engine');
        this.fileIPC.setEngines({
          excelEngine,
          wordEngine,
          documentEngine: this.documentEngine,
        });

        this.fileIPC.registerHandlers(this.mainWindow);
        console.log('文件操作IPC handlers注册成功');
      } catch (error) {
        console.error('文件操作IPC handlers注册失败:', error);
      }
    }

    // 所有管理器初始化完成（包括 syncManager），现在注册IPC handlers
    try {
      console.log('[Main] 开始注册 IPC handlers...');
      this.setupIPC();
      console.log('[Main] IPC handlers 注册完成');
    } catch (error) {
      console.error('[Main] IPC setup failed:', error);
    }

    // 注册全局快捷键
    this.registerGlobalShortcuts();

    // 创建系统托盘
    this.createTray();
  }

  /**
   * 注册全局快捷键
   */
  registerGlobalShortcuts() {
    const { globalShortcut } = require('electron');

    try {
      // Ctrl+Shift+V: 触发语音输入
      const registered = globalShortcut.register('CommandOrControl+Shift+V', () => {
        console.log('[Main] 全局快捷键触发: Ctrl+Shift+V - 语音输入');

        // 聚焦主窗口
        if (this.mainWindow) {
          if (this.mainWindow.isMinimized()) {
            this.mainWindow.restore();
          }
          this.mainWindow.focus();

          // 发送事件到渲染进程
          this.mainWindow.webContents.send('shortcut:voice-input');
        }
      });

      if (registered) {
        console.log('[Main] 全局快捷键注册成功: Ctrl+Shift+V');
      } else {
        console.warn('[Main] 全局快捷键注册失败: Ctrl+Shift+V (可能已被占用)');
      }
    } catch (error) {
      console.error('[Main] 注册全局快捷键失败:', error);
    }
  }

  createTray() {
    try {
      // 创建托盘图标（使用应用图标）
      const iconPath = process.platform === 'win32'
        ? path.join(__dirname, '../../public/icon.ico')
        : path.join(__dirname, '../../public/icon.png');

      // 如果图标文件不存在，使用空图标
      let trayIcon;
      if (fs.existsSync(iconPath)) {
        trayIcon = nativeImage.createFromPath(iconPath);
      } else {
        // 创建一个简单的16x16空图标
        trayIcon = nativeImage.createEmpty();
      }

      this.tray = new Tray(trayIcon);
      this.tray.setToolTip('ChainlessChain - 个人AI知识库');

      // 创建托盘菜单
      const contextMenu = Menu.buildFromTemplate([
        {
          label: '显示主窗口',
          click: () => {
            if (this.mainWindow) {
              if (this.mainWindow.isMinimized()) {
                this.mainWindow.restore();
              }
              this.mainWindow.show();
              this.mainWindow.focus();
            }
          }
        },
        {
          type: 'separator'
        },
        {
          label: '全局设置',
          click: () => {
            // 发送事件到渲染进程，打开全局设置对话框
            if (this.mainWindow && this.mainWindow.webContents) {
              this.mainWindow.webContents.send('show-global-settings');
              // 同时显示主窗口
              if (this.mainWindow.isMinimized()) {
                this.mainWindow.restore();
              }
              this.mainWindow.show();
              this.mainWindow.focus();
            }
          }
        },
        {
          label: '系统设置',
          click: () => {
            if (this.mainWindow) {
              if (this.mainWindow.isMinimized()) {
                this.mainWindow.restore();
              }
              this.mainWindow.show();
              this.mainWindow.focus();
              // 发送事件到渲染进程，导航到设置页面
              this.mainWindow.webContents.send('navigate-to-settings');
            }
          }
        },
        {
          type: 'separator'
        },
        {
          label: '重启应用',
          click: () => {
            app.relaunch();
            app.exit(0);
          }
        },
        {
          label: '退出',
          click: () => {
            // 强制退出，不触发窗口关闭事件
            app.exit(0);
          }
        }
      ]);

      this.tray.setContextMenu(contextMenu);

      // 双击托盘图标显示主窗口
      this.tray.on('double-click', () => {
        if (this.mainWindow) {
          if (this.mainWindow.isMinimized()) {
            this.mainWindow.restore();
          }
          this.mainWindow.show();
          this.mainWindow.focus();
        }
      });

      console.log('系统托盘创建成功');
    } catch (error) {
      console.error('创建系统托盘失败:', error);
    }
  }

  setupGitEvents() {
    // 监听Git事件并转发给渲染进程
    this.gitManager.on('committed', (data) => {
      console.log('[Main] Git提交完成:', data.sha);
      if (this.mainWindow) {
        this.mainWindow.webContents.send('git:committed', data);
      }
    });

    this.gitManager.on('pushed', () => {
      console.log('[Main] Git推送完成');
      if (this.mainWindow) {
        this.mainWindow.webContents.send('git:pushed');
      }
    });

    this.gitManager.on('pulled', () => {
      console.log('[Main] Git拉取完成');
      if (this.mainWindow) {
        this.mainWindow.webContents.send('git:pulled');
      }
    });

    this.gitManager.on('auto-synced', (data) => {
      console.log('[Main] Git自动同步完成:', data);
      if (this.mainWindow) {
        this.mainWindow.webContents.send('git:auto-synced', data);
      }
    });

    this.gitManager.on('push-progress', (progress) => {
      if (this.mainWindow) {
        this.mainWindow.webContents.send('git:push-progress', progress);
      }
    });

    this.gitManager.on('pull-progress', (progress) => {
      if (this.mainWindow) {
        this.mainWindow.webContents.send('git:pull-progress', progress);
      }
    });
  }

  startAutoSync(interval) {
    console.log(`[Main] 启动Git自动同步，间隔: ${interval}ms`);

    this.autoSyncTimer = setInterval(async () => {
      try {
        console.log('[Main] 执行自动同步...');

        // 导出数据为Markdown
        await this.markdownExporter.sync();

        // Git同步
        await this.gitManager.autoSync('Auto sync from ChainlessChain');
      } catch (error) {
        console.error('[Main] 自动同步失败:', error);
      }
    }, interval);
  }

  stopAutoSync() {
    if (this.autoSyncTimer) {
      clearInterval(this.autoSyncTimer);
      this.autoSyncTimer = null;
      console.log('[Main] 停止Git自动同步');
    }
  }

  setupUKeyEvents() {
    // 监听U盾事件并转发给渲染进程
    this.ukeyManager.on('device-connected', (status) => {
      // console.log('[Main] U盾设备已连接');
      if (this.mainWindow) {
        this.mainWindow.webContents.send('ukey:device-connected', status);
      }
    });

    this.ukeyManager.on('device-disconnected', () => {
      // console.log('[Main] U盾设备已断开');
      if (this.mainWindow) {
        this.mainWindow.webContents.send('ukey:device-disconnected');
      }
    });

    this.ukeyManager.on('unlocked', (result) => {
      // console.log('[Main] U盾已解锁');
      if (this.mainWindow) {
        this.mainWindow.webContents.send('ukey:unlocked', result);
      }
    });

    this.ukeyManager.on('locked', () => {
      // console.log('[Main] U盾已锁定');
      if (this.mainWindow) {
        this.mainWindow.webContents.send('ukey:locked');
      }
    });
  }

  setupP2PEncryptionEvents() {
    if (!this.p2pManager) {
      return;
    }

    // 监听加密消息接收事件
    this.p2pManager.on('encrypted-message:received', (data) => {
      console.log('[Main] 收到加密消息:', data.from);
      if (this.mainWindow) {
        this.mainWindow.webContents.send('p2p:encrypted-message', data);
      }
    });

    // 监听加密消息发送事件
    this.p2pManager.on('encrypted-message:sent', (data) => {
      console.log('[Main] 加密消息已发送:', data.to);
      if (this.mainWindow) {
        this.mainWindow.webContents.send('p2p:encrypted-message-sent', data);
      }
    });

    // 监听密钥交换成功事件
    this.p2pManager.on('key-exchange:success', (data) => {
      console.log('[Main] 密钥交换成功:', data.peerId);
      if (this.mainWindow) {
        this.mainWindow.webContents.send('p2p:key-exchange-success', data);
      }
    });

    console.log('[Main] P2P 加密事件监听已设置');
  }

  async initializeMobileBridge() {
    console.log('[Main] 初始化移动端桥接...');

    try {
      // 导入Mobile Bridge相关模块
      const MobileBridge = require('./p2p/mobile-bridge');
      const DevicePairingHandler = require('./p2p/device-pairing-handler');
      const KnowledgeSyncHandler = require('./p2p/knowledge-sync-handler');
      const ProjectSyncHandler = require('./p2p/project-sync-handler');
      const PCStatusHandler = require('./p2p/pc-status-handler');
      const DeviceManager = require('./p2p/device-manager');

      // 创建设备管理器
      if (!this.deviceManager) {
        this.deviceManager = new DeviceManager(this.database);
        await this.deviceManager.initialize();
      }

      // 创建MobileBridge
      this.mobileBridge = new MobileBridge(this.p2pManager, {
        signalingUrl: 'ws://localhost:9001',
        reconnectInterval: 5000,
        enableAutoReconnect: true
      });

      await this.mobileBridge.connect();

      // 创建设备配对处理器
      this.devicePairingHandler = new DevicePairingHandler(
        this.p2pManager,
        this.mobileBridge,
        this.deviceManager
      );

      // 创建同步处理器（传递mobileBridge）
      this.knowledgeSyncHandler = new KnowledgeSyncHandler(
        this.database,
        this.p2pManager,
        this.mobileBridge
      );

      this.projectSyncHandler = new ProjectSyncHandler(
        this.database,
        this.p2pManager,
        this.mobileBridge
      );

      this.pcStatusHandler = new PCStatusHandler(this.p2pManager, this.mobileBridge);

      // 设置消息路由
      this.setupMobileBridgeMessageRouting();

      console.log('[Main] ✅ 移动端桥接初始化成功');

      // 初始化P2P增强管理器（包含语音/视频功能）
      await this.initializeP2PEnhancedManager();

    } catch (error) {
      console.error('[Main] ❌ 移动端桥接初始化失败:', error);
      throw error;
    }
  }

  /**
   * 初始化P2P增强管理器（包含消息、文件传输、知识库同步、语音/视频）
   */
  async initializeP2PEnhancedManager() {
    console.log('[Main] 初始化P2P增强管理器...');

    try {
      // 导入P2P增强管理器
      const P2PEnhancedManager = require('./p2p/p2p-enhanced-manager');
      const P2PEnhancedIPC = require('./p2p/p2p-enhanced-ipc');

      // 创建P2P增强管理器
      this.p2pEnhancedManager = new P2PEnhancedManager(
        this.p2pManager,
        this.database,
        {
          // 消息管理配置
          messageBatchSize: 10,
          messageBatchInterval: 100,
          enableCompression: true,
          enableRetry: true,
          maxRetries: 3,

          // 知识库同步配置
          syncInterval: 60000,
          syncBatchSize: 50,
          enableAutoSync: true,
          conflictStrategy: 'latest-wins',

          // 文件传输配置
          chunkSize: 64 * 1024,
          maxConcurrentChunks: 3,
          enableResume: true,
          tempDir: path.join(app.getPath('userData'), 'p2p-temp'),

          // 语音/视频配置
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' }
          ],
          audioConstraints: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          },
          videoConstraints: {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 30 }
          },
          callTimeout: 60000,
          qualityCheckInterval: 5000
        }
      );

      // 初始化增强管理器
      await this.p2pEnhancedManager.initialize();

      // 创建并注册IPC处理器
      this.p2pEnhancedIPC = new P2PEnhancedIPC(this.p2pEnhancedManager);
      this.p2pEnhancedIPC.register();

      // 注册屏幕共享IPC处理器
      const ScreenShareIPC = require('./p2p/screen-share-ipc');
      this.screenShareIPC = new ScreenShareIPC();
      this.screenShareIPC.register();
      console.log('[Main] ✅ 屏幕共享IPC处理器已注册');

      // 注册通话历史IPC处理器
      const CallHistoryIPC = require('./p2p/call-history-ipc');
      this.callHistoryIPC = new CallHistoryIPC(this.p2pEnhancedManager.callHistoryManager);
      this.callHistoryIPC.register();
      console.log('[Main] ✅ 通话历史IPC处理器已注册');

      // 初始化连接健康管理器
      const P2PConnectionHealthManager = require('./p2p/connection-health-manager');
      this.connectionHealthManager = new P2PConnectionHealthManager(this.p2pManager, {
        healthCheckInterval: 30000,
        pingTimeout: 5000,
        maxReconnectAttempts: 5,
        reconnectDelay: 2000,
        reconnectBackoffMultiplier: 1.5,
        maxReconnectDelay: 30000
      });
      await this.connectionHealthManager.initialize();
      console.log('[Main] ✅ 连接健康管理器已初始化');

      console.log('[Main] ✅ P2P增强管理器初始化成功（包含语音/视频功能）');

    } catch (error) {
      console.error('[Main] ❌ P2P增强管理器初始化失败:', error);
      throw error;
    }
  }

  /**
   * 设置移动端桥接消息路由
   */
  setupMobileBridgeMessageRouting() {
    if (!this.mobileBridge) {
      console.warn('[Main] MobileBridge未初始化，无法设置消息路由');
      return;
    }

    // 监听来自移动端的消息
    this.mobileBridge.on('message-from-mobile', async ({ mobilePeerId, message }) => {
      const { type, requestId, params } = message;

      console.log(`[Main] 收到移动端消息: ${type} from ${mobilePeerId}`);

      try {
        let handler;
        let response;

        // 根据消息类型路由到对应的处理器
        if (type.startsWith('knowledge:')) {
          handler = this.knowledgeSyncHandler;
        } else if (type.startsWith('project:')) {
          handler = this.projectSyncHandler;
        } else if (type.startsWith('pc-status:')) {
          handler = this.pcStatusHandler;
        } else if (type.startsWith('pairing:')) {
          handler = this.devicePairingHandler;
        } else {
          console.warn(`[Main] 未知消息类型: ${type}`);
          this.mobileBridge.send({
            type: 'message',
            to: mobilePeerId,
            payload: {
              type: `${type}:response`,
              requestId: requestId,
              error: {
                code: 'UNKNOWN_MESSAGE_TYPE',
                message: `Unknown message type: ${type}`
              }
            }
          });
          return;
        }

        // 调用处理器的handleMessage方法
        if (handler && typeof handler.handleMessage === 'function') {
          response = await handler.handleMessage(mobilePeerId, message);
        } else {
          console.warn(`[Main] 处理器不支持handleMessage方法: ${type}`);
          response = {
            error: {
              code: 'NOT_IMPLEMENTED',
              message: `Handler for ${type} does not implement handleMessage`
            }
          };
        }

        // 如果处理器没有直接发送响应，我们手动发送
        if (response !== undefined) {
          this.mobileBridge.send({
            type: 'message',
            to: mobilePeerId,
            payload: {
              type: `${type}:response`,
              requestId: requestId,
              ...response
            }
          });
        }

      } catch (error) {
        console.error(`[Main] 处理移动端消息失败 (${type}):`, error);

        // 发送错误响应
        this.mobileBridge.send({
          type: 'message',
          to: mobilePeerId,
          payload: {
            type: `${type}:response`,
            requestId: requestId,
            error: {
              code: 'INTERNAL_ERROR',
              message: error.message,
              stack: error.stack
            }
          }
        });
      }
    });

    console.log('[Main] ✓ 移动端桥接消息路由已设置');
  }

  setupPluginEvents() {
    if (!this.pluginManager) {
      return;
    }

    // 监听插件事件并转发给渲染进程
    this.pluginManager.on('initialized', (data) => {
      console.log('[Main] 插件系统已初始化:', data);
      if (this.mainWindow) {
        this.mainWindow.webContents.send('plugin:initialized', data);
      }
    });

    this.pluginManager.on('plugin:installed', (data) => {
      console.log('[Main] 插件已安装:', data.pluginId);
      if (this.mainWindow) {
        this.mainWindow.webContents.send('plugin:installed', data);
      }
    });

    this.pluginManager.on('plugin:uninstalled', (data) => {
      console.log('[Main] 插件已卸载:', data.pluginId);
      if (this.mainWindow) {
        this.mainWindow.webContents.send('plugin:uninstalled', data);
      }
    });

    this.pluginManager.on('plugin:enabled', (data) => {
      console.log('[Main] 插件已启用:', data.pluginId);
      if (this.mainWindow) {
        this.mainWindow.webContents.send('plugin:enabled', data);
      }
    });

    this.pluginManager.on('plugin:disabled', (data) => {
      console.log('[Main] 插件已禁用:', data.pluginId);
      if (this.mainWindow) {
        this.mainWindow.webContents.send('plugin:disabled', data);
      }
    });

    this.pluginManager.on('plugin:load-failed', (data) => {
      console.error('[Main] 插件加载失败:', data.pluginId, data.error);
      if (this.mainWindow) {
        this.mainWindow.webContents.send('plugin:load-failed', data);
      }
    });

    this.pluginManager.on('extension:error', (data) => {
      console.error('[Main] 扩展执行失败:', data.extension, data.error);
      if (this.mainWindow) {
        this.mainWindow.webContents.send('plugin:extension-error', data);
      }
    });

    console.log('[Main] 插件系统事件监听已设置');
  }

  /**
   * 根据提供商从数据库构建LLM管理器配置
   * @param {string} provider - LLM提供商名称
   * @returns {Object} LLM管理器配置对象
   */
  buildLLMManagerConfig(provider) {
    const config = {
      provider,
      timeout: 120000,
    };

    switch (provider) {
      case 'ollama':
        config.ollamaURL = this.database.getSetting('llm.ollamaHost') || 'http://localhost:11434';
        config.model = this.database.getSetting('llm.ollamaModel') || 'qwen2:7b';
        break;

      case 'openai':
        config.apiKey = this.database.getSetting('llm.openaiApiKey') || '';
        config.baseURL = this.database.getSetting('llm.openaiBaseUrl') || 'https://api.openai.com/v1';
        config.model = this.database.getSetting('llm.openaiModel') || 'gpt-3.5-turbo';
        break;

      case 'volcengine':
        config.apiKey = this.database.getSetting('llm.volcengineApiKey') || '';
        config.baseURL = 'https://ark.cn-beijing.volces.com/api/v3';
        config.model = this.database.getSetting('llm.volcengineModel') || 'doubao-seed-1.6-lite';
        break;

      case 'deepseek':
        config.apiKey = this.database.getSetting('llm.deepseekApiKey') || '';
        config.model = this.database.getSetting('llm.deepseekModel') || 'deepseek-chat';
        break;

      case 'dashscope':
        config.apiKey = this.database.getSetting('llm.dashscopeApiKey') || '';
        config.model = this.database.getSetting('llm.dashscopeModel') || 'qwen-turbo';
        break;

      case 'zhipu':
        config.apiKey = this.database.getSetting('llm.zhipuApiKey') || '';
        config.model = this.database.getSetting('llm.zhipuModel') || 'glm-4';
        break;

      case 'custom':
        config.apiKey = this.database.getSetting('llm.customApiKey') || '';
        config.baseURL = this.database.getSetting('llm.customBaseUrl') || '';
        config.model = this.database.getSetting('llm.customModel') || '';
        console.log('[Main] Custom LLM配置:', { baseURL: config.baseURL, model: config.model });
        break;
    }

    return config;
  }

  /**
   * 递归移除对象中的undefined值
   * Electron IPC无法序列化undefined，需要转换为null或删除
   * @param {*} data - 要清理的数据
   * @returns {*} 清理后的数据
   */
  removeUndefinedValues(data) {
    // 处理null和undefined
    if (data === null || data === undefined) {
      return data === null ? null : undefined;
    }

    // 处理基本类型
    if (typeof data !== 'object') {
      return data;
    }

    // 处理数组
    if (Array.isArray(data)) {
      return data
        .map(item => this.removeUndefinedValues(item))
        .filter(item => item !== undefined); // 过滤掉undefined元素
    }

    // 处理对象
    const cleaned = {};
    Object.keys(data).forEach(key => {
      const value = data[key];

      // 跳过undefined值
      if (value === undefined) {
        return;
      }

      // 跳过函数和Symbol
      if (typeof value === 'function' || typeof value === 'symbol') {
        return;
      }

      // 递归处理对象和数组
      if (value !== null && typeof value === 'object') {
        cleaned[key] = this.removeUndefinedValues(value);
      } else {
        cleaned[key] = value;
      }
    });

    return cleaned;
  }

  /**
   * 递归检查对象中是否有undefined值
   * @param {*} obj - 要检查的对象
   * @param {string} path - 当前路径（用于调试）
   */
  _ensureNoUndefined(obj, path = 'root') {
    if (obj === null || obj === undefined) {
      if (obj === undefined) {
        console.error(`[Main] 发现 undefined 在路径: ${path}`);
      }
      return;
    }

    if (typeof obj !== 'object') {
      return;
    }

    if (Array.isArray(obj)) {
      obj.forEach((item, index) => {
        this._ensureNoUndefined(item, `${path}[${index}]`);
      });
    } else {
      Object.entries(obj).forEach(([key, value]) => {
        if (value === undefined) {
          console.error(`[Main] 发现 undefined 值在路径: ${path}.${key}`);
        }
        this._ensureNoUndefined(value, `${path}.${key}`);
      });
    }
  }

  /**
   * 递归替换所有undefined值为null
   * @param {*} obj - 要处理的对象
   * @returns {*} 处理后的对象
   */
  _replaceUndefinedWithNull(obj) {
    if (obj === undefined) {
      return null;
    }

    if (obj === null || typeof obj !== 'object') {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this._replaceUndefinedWithNull(item));
    }

    const result = {};
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        result[key] = this._replaceUndefinedWithNull(obj[key]);
      }
    }
    return result;
  }

  /**
   * 将编辑器的幻灯片数据转换为PPT大纲格式
   * @param {Array} slides - 幻灯片数组
   * @param {string} title - PPT标题
   * @returns {Object} PPT大纲
   */
  convertSlidesToOutline(slides, title) {
    const outline = {
      title: title || '演示文稿',
      subtitle: new Date().toLocaleDateString('zh-CN'),
      sections: []
    };

    slides.forEach((slide, index) => {
      // 解析幻灯片内容
      const content = slide.content || '';
      const tempDiv = { innerHTML: content };

      // 提取标题和内容
      const h1Match = content.match(/<h1[^>]*>(.*?)<\/h1>/i);
      const h2Match = content.match(/<h2[^>]*>(.*?)<\/h2>/i);
      const h3Match = content.match(/<h3[^>]*>(.*?)<\/h3>/i);

      let slideTitle = '';
      if (h1Match) {
        slideTitle = h1Match[1].replace(/<[^>]*>/g, '').trim();
      } else if (h2Match) {
        slideTitle = h2Match[1].replace(/<[^>]*>/g, '').trim();
      } else if (h3Match) {
        slideTitle = h3Match[1].replace(/<[^>]*>/g, '').trim();
      } else {
        slideTitle = `幻灯片 ${index + 1}`;
      }

      // 提取要点（从<p>, <li>等标签）
      const points = [];
      const pMatches = content.matchAll(/<p[^>]*>(.*?)<\/p>/gi);
      for (const match of pMatches) {
        const text = match[1].replace(/<[^>]*>/g, '').trim();
        if (text && text.length > 0) {
          points.push(text);
        }
      }

      const liMatches = content.matchAll(/<li[^>]*>(.*?)<\/li>/gi);
      for (const match of liMatches) {
        const text = match[1].replace(/<[^>]*>/g, '').trim();
        if (text && text.length > 0) {
          points.push(text);
        }
      }

      // 创建章节和子章节
      if (index === 0 && h1Match) {
        // 第一张幻灯片通常是标题页，跳过
        outline.title = slideTitle;
        return;
      }

      outline.sections.push({
        title: slideTitle,
        subsections: [{
          title: slideTitle,
          points: points.length > 0 ? points : ['内容...']
        }]
      });
    });

    return outline;
  }

  setupIPC() {
    // ========================================================================
    // 模块化 IPC 注册中心
    // ========================================================================
    console.log('[ChainlessChainApp] ========================================');
    console.log('[ChainlessChainApp] Starting IPC setup (Modular Mode)...');
    console.log('[ChainlessChainApp] ========================================');

    // 导入注册中心
    const { registerAllIPC } = require('./ipc-registry');

    // 注册所有模块化的 IPC 处理器
    try {
      this.ipcHandlers = registerAllIPC({
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
        promptTemplateManager: this.promptTemplateManager,
        knowledgePaymentManager: this.knowledgePaymentManager,
        creditScoreManager: this.creditScoreManager,
        reviewManager: this.reviewManager,
        vcTemplateManager: this.vcTemplateManager,
        vcManager: this.vcManager,
        identityContextManager: this.identityContextManager,
        organizationManager: this.organizationManager,
        dbManager: this.database,
        versionManager: this.versionManager,
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
        interactiveTaskPlanner: this.interactiveTaskPlanner,
        templateManager: this.templateManager
      });

      console.log('[ChainlessChainApp] ✓ Modular IPC registration complete');
      console.log('[ChainlessChainApp] ✓ Total handlers registered: 765+');
    } catch (error) {
      console.error('[ChainlessChainApp] ❌ Modular IPC registration failed:', error);
      throw error;
    }

    // 注册性能监控 IPC handlers
    this.setupPerformanceIPC();

    // 注册插件市场 IPC handlers
    this.setupPluginMarketplaceIPC();

    // 注册交互式任务规划 IPC handlers
    this.setupInteractivePlanningIPC();

    // 注册移动端桥接 IPC handlers
    this.setupMobileBridgeIPC();

    console.log('[ChainlessChainApp] ========================================');
    console.log('[ChainlessChainApp] IPC setup complete!');
    console.log('[ChainlessChainApp] ========================================');
  }

  /**
   * 设置性能监控 IPC 处理器
   */
  setupPerformanceIPC() {
    const { ipcMain } = require('electron');

    // 获取性能监控实例
    const performanceMonitor = this.performanceMonitor;
    if (!performanceMonitor) {
      console.warn('[Performance IPC] Performance monitor not initialized');
      return;
    }

    // 获取当前性能指标
    ipcMain.handle('performance:get-metrics', async () => {
      try {
        return performanceMonitor.getMetrics();
      } catch (error) {
        console.error('[Performance IPC] Failed to get metrics:', error);
        throw error;
      }
    });

    // 获取性能报告
    ipcMain.handle('performance:get-report', async () => {
      try {
        return performanceMonitor.generateReport();
      } catch (error) {
        console.error('[Performance IPC] Failed to get report:', error);
        throw error;
      }
    });

    // 记录慢查询
    ipcMain.handle('performance:log-slow-query', async (event, queryInfo) => {
      try {
        performanceMonitor.logSlowQuery(
          queryInfo.query,
          queryInfo.duration,
          queryInfo.params
        );
        return { success: true };
      } catch (error) {
        console.error('[Performance IPC] Failed to log slow query:', error);
        throw error;
      }
    });

    // 跟踪操作性能
    ipcMain.handle('performance:track-operation', async (event, operationInfo) => {
      try {
        performanceMonitor.trackOperation(
          operationInfo.name,
          operationInfo.duration,
          operationInfo.metadata
        );
        return { success: true };
      } catch (error) {
        console.error('[Performance IPC] Failed to track operation:', error);
        throw error;
      }
    });

    // 清除性能数据
    ipcMain.handle('performance:clear', async () => {
      try {
        // 重置性能监控器
        const { getPerformanceMonitor } = require('../../utils/performance-monitor');
        const newMonitor = getPerformanceMonitor();
        newMonitor.reset();
        return { success: true };
      } catch (error) {
        console.error('[Performance IPC] Failed to clear performance data:', error);
        throw error;
      }
    });

    console.log('[Performance IPC] ✓ Performance monitoring IPC handlers registered');
  }

  /**
   * 设置插件市场 IPC 处理器
   */
  setupPluginMarketplaceIPC() {
    if (!this.pluginManager) {
      console.warn('[Plugin Marketplace IPC] Plugin manager not initialized');
      return;
    }

    try {
      // 注册插件市场IPC处理器
      registerPluginMarketplaceIPC({
        pluginManager: this.pluginManager
      });

      console.log('[Plugin Marketplace IPC] ✓ Plugin marketplace IPC handlers registered (20 handlers)');
    } catch (error) {
      console.error('[Plugin Marketplace IPC] Failed to register handlers:', error);
    }

    // 注册 RSS 和 Email IPC 处理器
    try {
      const appConfig = getAppConfig();
      const appDataPath = appConfig.getDataPath();

      this.rssIPCHandler = new RSSIPCHandler(this.database);
      this.emailIPCHandler = new EmailIPCHandler(this.database, appDataPath);

      console.log('[API Integration] ✓ RSS and Email IPC handlers registered');
    } catch (error) {
      console.error('[API Integration] Failed to register RSS/Email handlers:', error);
    }
  }

  /**
   * 设置移动端桥接 IPC 处理器
   */
  setupMobileBridgeIPC() {
    // 扫描二维码配对
    ipcMain.handle('mobile:start-scanner', async () => {
      try {
        if (!this.devicePairingHandler) {
          throw new Error('设备配对处理器未初始化');
        }
        const result = await this.devicePairingHandler.startQRCodeScanner();
        return { success: true, device: result.device };
      } catch (error) {
        console.error('[IPC] 扫描失败:', error);
        return { success: false, error: error.message };
      }
    });

    // 手动输入配对码
    ipcMain.handle('mobile:pair-with-code', async (event, pairingCode) => {
      try {
        if (!this.devicePairingHandler) {
          throw new Error('设备配对处理器未初始化');
        }
        const result = await this.devicePairingHandler.pairWithCode(pairingCode, null, null);
        return { success: true, device: result.device };
      } catch (error) {
        console.error('[IPC] 配对失败:', error);
        return { success: false, error: error.message };
      }
    });

    // 获取已配对设备列表
    ipcMain.handle('mobile:get-paired-devices', async () => {
      try {
        if (!this.deviceManager) {
          throw new Error('设备管理器未初始化');
        }
        const devices = await this.deviceManager.getAllDevices();
        return { success: true, devices };
      } catch (error) {
        console.error('[IPC] 获取设备列表失败:', error);
        return { success: false, error: error.message };
      }
    });

    // 移除已配对设备
    ipcMain.handle('mobile:remove-device', async (event, deviceId) => {
      try {
        if (!this.deviceManager) {
          throw new Error('设备管理器未初始化');
        }
        await this.deviceManager.removeDevice(deviceId);
        return { success: true };
      } catch (error) {
        console.error('[IPC] 移除设备失败:', error);
        return { success: false, error: error.message };
      }
    });

    // 获取统计信息
    ipcMain.handle('mobile:get-stats', async () => {
      try {
        return {
          success: true,
          stats: {
            bridge: this.mobileBridge?.getStats() || {},
            knowledge: this.knowledgeSyncHandler?.getStats() || {},
            project: this.projectSyncHandler?.getStats() || {}
          }
        };
      } catch (error) {
        console.error('[IPC] 获取统计失败:', error);
        return { success: false, error: error.message };
      }
    });

    console.log('[Mobile Bridge IPC] ✓ Mobile bridge IPC handlers registered');
  }

  /**
   * 设置交互式任务规划 IPC 处理器
   */
  setupInteractivePlanningIPC() {
    // 检查交互式任务规划器是否已初始化
    if (!this.interactiveTaskPlanner) {
      console.warn('[Interactive Planning IPC] Interactive task planner not initialized');
      return;
    }

    try {
      // 创建IPC接口实例
      this.interactivePlanningIPC = new InteractivePlanningIPC(this.interactiveTaskPlanner);
      console.log('[Interactive Planning IPC] ✓ Interactive planning IPC handlers registered');
    } catch (error) {
      console.error('[Interactive Planning IPC] Failed to register IPC handlers:', error);
    }
  }

  /**
   * 扫描项目目录并注册新文件到数据库
   */
  async scanAndRegisterProjectFiles(projectId, projectPath) {
    const fs = require('fs').promises;
    const path = require('path');
    const crypto = require('crypto');

    console.log(`[Main] 扫描项目目录: ${projectPath}`);

    try {
      // 检查目录是否存在
      try {
        await fs.access(projectPath);
      } catch (error) {
        console.warn(`[Main] 项目目录不存在: ${projectPath}`);
        return;
      }

      // 读取目录中的所有文件
      const entries = await fs.readdir(projectPath, { withFileTypes: true });
      const files = entries.filter(entry => entry.isFile());

      console.log(`[Main] 找到 ${files.length} 个文件`);

      let registeredCount = 0;

      for (const file of files) {
        const fileName = file.name;
        const filePath = path.join(projectPath, fileName);
        const relativePath = fileName; // 在项目根目录下，相对路径就是文件名

        // 检查文件是否已在数据库中
        const existingFile = this.database.db.prepare(
          `SELECT id FROM project_files WHERE project_id = ? AND file_path = ?`
        ).get(projectId, relativePath);

        if (existingFile) {
          console.log(`[Main] 文件已存在于数据库: ${relativePath}`);
          continue;
        }

        // 读取文件内容和元数据
        try {
          const content = await fs.readFile(filePath, 'utf8');
          const stats = await fs.stat(filePath);

          // 计算内容哈希
          const contentHash = crypto.createHash('md5').update(content).digest('hex');

          // 确定文件类型
          const fileExt = path.extname(fileName).substring(1).toLowerCase();
          const fileTypeMap = {
            'md': 'markdown',
            'txt': 'text',
            'html': 'html',
            'htm': 'html',
            'pdf': 'pdf',
            'docx': 'docx',
            'doc': 'doc',
            'pptx': 'pptx',
            'ppt': 'ppt',
            'xlsx': 'xlsx',
            'xls': 'xls',
            'json': 'json',
            'xml': 'xml',
            'csv': 'csv'
          };
          const fileType = fileTypeMap[fileExt] || 'unknown';

          // 生成文件ID
          const fileId = `file_${Date.now()}_${Math.random().toString(36).substring(7)}`;

          // 插入到数据库
          this.database.db.run(
            `INSERT INTO project_files
             (id, project_id, file_name, file_path, file_type, content, content_hash, file_size, fs_path, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              fileId,
              projectId,
              fileName,
              relativePath,
              fileType,
              content,
              contentHash,
              stats.size,
              filePath,
              Date.now(),
              Date.now()
            ]
          );

          // 添加同步状态
          this.database.db.run(
            `INSERT INTO file_sync_state
             (file_id, fs_hash, db_hash, last_synced_at, sync_direction)
             VALUES (?, ?, ?, ?, 'fs_to_db')`,
            [fileId, contentHash, contentHash, Date.now()]
          );

          registeredCount++;
          console.log(`[Main] 注册新文件: ${fileName} (ID: ${fileId})`);
        } catch (fileError) {
          console.error(`[Main] 处理文件失败: ${fileName}`, fileError);
          // 继续处理其他文件
        }
      }

      // 更新项目的文件统计
      if (registeredCount > 0) {
        try {
          // 统计该项目的总文件数
          const totalFiles = this.database.db.prepare(
            `SELECT COUNT(*) as count FROM project_files WHERE project_id = ?`
          ).get(projectId);

          const fileCount = totalFiles ? totalFiles.count : 0;
          console.log(`[Main] 项目 ${projectId} 当前共有 ${fileCount} 个文件`);

          // 更新projects表的file_count字段
          this.database.db.run(
            `UPDATE projects SET file_count = ?, updated_at = ? WHERE id = ?`,
            [fileCount, Date.now(), projectId]
          );

          console.log(`[Main] 已更新项目的file_count为 ${fileCount}`);
        } catch (updateError) {
          console.error('[Main] 更新项目file_count失败:', updateError);
        }
      }

      // 保存数据库
      if (registeredCount > 0) {
        this.database.saveToFile();
        console.log(`[Main] 成功注册 ${registeredCount} 个新文件`);
      } else {
        console.log('[Main] 没有新文件需要注册');
      }

      return registeredCount;
    } catch (error) {
      console.error('[Main] 扫描并注册文件失败:', error);
      throw error;
    }
  }

  onWindowAllClosed() {
    // 在非 macOS 平台上关闭资源
    if (process.platform !== 'darwin') {
      // 关闭数据库连接
      if (this.database) {
        this.database.close();
      }

      // 关闭U盾管理器
      if (this.ukeyManager) {
        this.ukeyManager.stopDeviceMonitor();
        this.ukeyManager.close();
      }

      // 关闭Git管理器
      if (this.gitManager) {
        this.stopAutoSync();
        this.gitManager.close();
      }

      // 关闭Git热重载
      if (this.gitHotReload) {
        this.gitHotReload.stop();
      }

      // 关闭 Native Messaging HTTP Server
      if (this.nativeMessagingServer) {
        this.nativeMessagingServer.stop();
      }

      app.quit();
    }
    // 在 macOS 上，窗口关闭但应用继续运行，保持资源打开状态
    // 这样当用户从 Dock 重新激活应用时，资源仍然可用
  }

  async onActivate() {
    // 只在app ready后才创建窗口
    if (!app.isReady()) {
      return;
    }

    if (this.mainWindow === null) {
      await this.createWindow();
    }
  }
}

// 启动应用
new ChainlessChainApp();
