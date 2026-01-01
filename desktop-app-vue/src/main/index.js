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
// Trade modules
const KnowledgePaymentManager = require('./trade/knowledge-payment');
const CreditScoreManager = require('./trade/credit-score');
const ReviewManager = require('./trade/review-manager');

// AI Engine modules (P1优化版 v0.17.0)
// P1: 多意图识别、动态Few-shot学习、分层规划、检查点校验、自我修正
const { AIEngineManagerP1, getAIEngineManagerP1 } = require('./ai-engine/ai-engine-manager-p1');
const AIEngineIPC = require('./ai-engine/ai-engine-ipc');

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

// Category management IPC
const { registerCategoryIPCHandlers } = require('./category-ipc');

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

// Database Encryption IPC
const DatabaseEncryptionIPC = require('./database-encryption-ipc');

// Initial Setup IPC
const InitialSetupIPC = require('./initial-setup-ipc');

// Identity Context Manager (Enterprise)
const { getIdentityContextManager } = require('./identity/identity-context-manager');

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
    const str = String(chunk);
    if (!shouldFilterMessage(str)) {
      return originalStdoutWrite(chunk, encoding, callback);
    }
    return true;
  };
}

if (process.stderr && process.stderr.write) {
  const originalStderrWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = function(chunk, encoding, callback) {
    const str = String(chunk);
    if (!shouldFilterMessage(str)) {
      return originalStderrWrite(chunk, encoding, callback);
    }
    return true;
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
    this.mainWindow = null;
    this.database = null;
    this.ukeyManager = null;
    this.gitManager = null;
    this.markdownExporter = null;
    this.llmManager = null;
    this.ragManager = null;
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

    this.setupApp();
  }

  setupApp() {
    // 单实例锁定
    const gotTheLock = app.requestSingleInstanceLock();
    if (!gotTheLock) {
      app.quit();
      return;
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
      const backendManager = getBackendServiceManager();
      await backendManager.stopServices();
      app.exit(0);
    });

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

    // IPC handlers
    try {
      this.setupIPC();
    } catch (error) {
      console.error('[Main] IPC setup failed:', error);
    } finally {
      this.registerCoreIPCHandlers();
    }

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

    // 注册分类管理IPC处理函数
    try {
      console.log('注册分类管理IPC处理函数...');
      registerCategoryIPCHandlers(this.database, this.mainWindow);
      console.log('分类管理IPC处理函数注册成功');
    } catch (error) {
      console.error('分类管理IPC处理函数注册失败:', error);
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

      // 从llm-config.json加载配置
      const llmConfig = getLLMConfig();
      const provider = llmConfig.getProvider();
      console.log(`[Main] 当前LLM提供商: ${provider}`);

      const autoSelect = this.database.getSetting('llm.autoSelect');

      // 如果启用了智能选择，自动选择最优LLM
      if (autoSelect && this.llmSelector) {
        const selectedProvider = this.llmSelector.selectBestLLM({ taskType: 'chat' });
        console.log(`[Main] 智能选择LLM: ${selectedProvider}`);
        llmConfig.setProvider(selectedProvider);
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
    // 🚧 临时禁用企业版功能
    /*
    try {
      console.log('初始化组织管理器...');
      const OrganizationManager = require('./organization/organization-manager');
      this.organizationManager = new OrganizationManager(this.database, this.didManager, this.p2pManager);
      console.log('组织管理器初始化成功');
    } catch (error) {
      console.error('组织管理器初始化失败:', error);
      // 组织管理器初始化失败不影响应用启动
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
    */

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
      registerSkillToolIPC(ipcMain, this.skillManager, this.toolManager);
      console.log('[Main] 技能和工具IPC handlers已注册');

      console.log('[Main] 技能和工具管理系统初始化完成（含桥接器）');
    } catch (error) {
      console.error('[Main] 技能和工具管理系统初始化失败:', error);
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

    await this.createWindow();
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
    // 清除会话缓存以解决ERR_CACHE_READ_FAILURE错误
    const { session } = require('electron');
    try {
      await session.defaultSession.clearCache();
      console.log('[Main] 会话缓存已清除');
    } catch (error) {
      console.error('[Main] 清除缓存失败:', error);
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

    // 注册AI引擎IPC handlers
    if (this.aiEngineManager && !this.aiEngineIPC) {
      try {
        console.log('注册AI引擎IPC handlers...');
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
        config.model = this.database.getSetting('llm.volcengineModel') || 'doubao-seed-1-6-lite-251015';
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
    // 注册技能和工具IPC handlers
    // 注意：实际注册在 onReady() 中进行，因为需要等待 skillManager 和 toolManager 初始化完成

    // U盾相关 - 使用真实硬件实现
    ipcMain.handle('ukey:detect', async () => {
      try {
        if (!this.ukeyManager) {
          return {
            detected: false,
            unlocked: false,
            error: 'U盾管理器未初始化',
          };
        }

        return await this.ukeyManager.detect();
      } catch (error) {
        console.error('[Main] U盾检测失败:', error);
        return {
          detected: false,
          unlocked: false,
          error: error.message,
        };
      }
    });

    ipcMain.handle('ukey:verify-pin', async (_event, pin) => {
      try {
        if (!this.ukeyManager) {
          return {
            success: false,
            error: 'U盾管理器未初始化',
          };
        }

        return await this.ukeyManager.verifyPIN(pin);
      } catch (error) {
        console.error('[Main] PIN验证失败:', error);
        return {
          success: false,
          error: error.message,
        };
      }
    });

    ipcMain.handle('ukey:get-device-info', async () => {
      try {
        if (!this.ukeyManager) {
          throw new Error('U盾管理器未初始化');
        }

        return await this.ukeyManager.getDeviceInfo();
      } catch (error) {
        console.error('[Main] 获取设备信息失败:', error);
        throw error;
      }
    });

    ipcMain.handle('ukey:sign', async (_event, data) => {
      try {
        if (!this.ukeyManager) {
          throw new Error('U盾管理器未初始化');
        }

        return await this.ukeyManager.sign(data);
      } catch (error) {
        console.error('[Main] 签名失败:', error);
        throw error;
      }
    });

    ipcMain.handle('ukey:encrypt', async (_event, data) => {
      try {
        if (!this.ukeyManager) {
          throw new Error('U盾管理器未初始化');
        }

        return await this.ukeyManager.encrypt(data);
      } catch (error) {
        console.error('[Main] 加密失败:', error);
        throw error;
      }
    });

    ipcMain.handle('ukey:decrypt', async (_event, encryptedData) => {
      try {
        if (!this.ukeyManager) {
          throw new Error('U盾管理器未初始化');
        }

        return await this.ukeyManager.decrypt(encryptedData);
      } catch (error) {
        console.error('[Main] 解密失败:', error);
        throw error;
      }
    });

    ipcMain.handle('ukey:lock', async () => {
      try {
        if (!this.ukeyManager) {
          throw new Error('U盾管理器未初始化');
        }

        this.ukeyManager.lock();
        return true;
      } catch (error) {
        console.error('[Main] 锁定失败:', error);
        throw error;
      }
    });

    ipcMain.handle('ukey:get-public-key', async () => {
      try {
        if (!this.ukeyManager) {
          throw new Error('U盾管理器未初始化');
        }

        return await this.ukeyManager.getPublicKey();
      } catch (error) {
        console.error('[Main] 获取公钥失败:', error);
        throw error;
      }
    });

    // 密码认证 - 用于未检测到U盾时的备用登录方式
    ipcMain.handle('auth:verify-password', async (_event, username, password) => {
      try {
        // 开发模式：默认用户名和密码
        const DEFAULT_USERNAME = process.env.DEFAULT_USERNAME || 'admin';
        const DEFAULT_PASSWORD = process.env.DEFAULT_PASSWORD || '123456';

        console.log('[Main] 收到登录请求 - 用户名:', username, '密码长度:', password?.length);
        console.log('[Main] 期望用户名:', DEFAULT_USERNAME, '期望密码:', DEFAULT_PASSWORD);

        // 简单的密码验证（生产环境应使用加密存储）
        if (username === DEFAULT_USERNAME && password === DEFAULT_PASSWORD) {
          console.log('[Main] 密码验证成功');
          return {
            success: true,
            userId: 'local-user',
            username: username,
          };
        }

        console.log('[Main] 密码验证失败: 用户名或密码错误');
        console.log('[Main] 用户名匹配:', username === DEFAULT_USERNAME, '密码匹配:', password === DEFAULT_PASSWORD);
        return {
          success: false,
          error: '用户名或密码错误',
        };
      } catch (error) {
        console.error('[Main] 密码验证异常:', error);
        return {
          success: false,
          error: error.message,
        };
      }
    });

    // ==================== 数据同步 IPC 处理器 ====================

    // 启动同步
    ipcMain.handle('sync:start', async (_event, deviceId) => {
      try {
        if (!this.syncManager) {
          return { success: false, error: '同步管理器未初始化' };
        }

        const finalDeviceId = deviceId || `device-${Date.now()}`;
        console.log('[Main] 启动数据同步, 设备ID:', finalDeviceId);

        await this.syncManager.initialize(finalDeviceId);
        await this.syncManager.syncAfterLogin();

        console.log('[Main] 数据同步完成');
        return { success: true };
      } catch (error) {
        console.error('[Main] 同步失败:', error);
        return { success: false, error: error.message };
      }
    });

    // 解决冲突
    // NOTE: Duplicate handler removed - using the more complete implementation at line 3491
    // ipcMain.handle('sync:resolve-conflict', async (_event, conflictId, resolution) => {
    //   try {
    //     if (!this.syncManager) {
    //       return { success: false, error: '同步管理器未初始化' };
    //     }
    //
    //     console.log('[Main] 解决冲突:', conflictId, resolution);
    //     await this.syncManager.resolveConflict(conflictId, resolution);
    //
    //     return { success: true };
    //   } catch (error) {
    //     console.error('[Main] 解决冲突失败:', error);
    //     return { success: false, error: error.message };
    //   }
    // });

    // 获取同步状态
    ipcMain.handle('sync:get-status', async () => {
      try {
        if (!this.syncManager || !this.syncManager.httpClient) {
          return { success: false, error: '同步管理器未初始化' };
        }

        const status = await this.syncManager.httpClient.getSyncStatus(this.syncManager.deviceId);
        return { success: true, data: status };
      } catch (error) {
        console.error('[Main] 获取同步状态失败:', error);
        return { success: false, error: error.message };
      }
    });

    // 手动触发增量同步
    ipcMain.handle('sync:incremental', async () => {
      try {
        if (!this.syncManager) {
          return { success: false, error: '同步管理器未初始化' };
        }

        console.log('[Main] 手动触发增量同步');
        await this.syncManager.syncIncremental();

        return { success: true };
      } catch (error) {
        console.error('[Main] 增量同步失败:', error);
        return { success: false, error: error.message };
      }
    });

    // 数据库操作 - 使用 SQLite
    ipcMain.handle('db:get-knowledge-items', async (_event, limit, offset) => {
      try {
        return this.database?.getKnowledgeItems(limit, offset) || [];
      } catch (error) {
        console.error('获取知识库项失败:', error);
        return [];
      }
    });

    ipcMain.handle('db:get-knowledge-item-by-id', async (_event, id) => {
      try {
        return this.database?.getKnowledgeItemById(id) || null;
      } catch (error) {
        console.error('获取知识库项失败:', error);
        return null;
      }
    });

    ipcMain.handle('db:add-knowledge-item', async (_event, item) => {
      try {
        const newItem = this.database?.addKnowledgeItem(item);

        // 添加到RAG索引
        if (newItem && this.ragManager) {
          await this.ragManager.addToIndex(newItem);
        }

        return newItem;
      } catch (error) {
        console.error('添加知识库项失败:', error);
        throw error;
      }
    });

    ipcMain.handle('db:update-knowledge-item', async (_event, id, updates) => {
      try {
        const updatedItem = this.database?.updateKnowledgeItem(id, updates);

        // 更新RAG索引
        if (updatedItem && this.ragManager) {
          await this.ragManager.updateIndex(updatedItem);
        }

        return updatedItem;
      } catch (error) {
        console.error('更新知识库项失败:', error);
        throw error;
      }
    });

    ipcMain.handle('db:delete-knowledge-item', async (_event, id) => {
      try {
        const result = this.database?.deleteKnowledgeItem(id);

        // 从RAG索引移除
        if (result && this.ragManager) {
          this.ragManager.removeFromIndex(id);
        }

        return result;
      } catch (error) {
        console.error('删除知识库项失败:', error);
        return false;
      }
    });

    ipcMain.handle('db:search-knowledge-items', async (_event, query) => {
      try {
        return this.database?.searchKnowledge(query) || [];
      } catch (error) {
        console.error('搜索知识库项失败:', error);
        return [];
      }
    });

    // 标签操作
    ipcMain.handle('db:get-all-tags', async () => {
      try {
        return this.database?.getAllTags() || [];
      } catch (error) {
        console.error('获取标签失败:', error);
        return [];
      }
    });

    ipcMain.handle('db:create-tag', async (_event, name, color) => {
      try {
        return this.database?.createTag(name, color);
      } catch (error) {
        console.error('创建标签失败:', error);
        throw error;
      }
    });

    ipcMain.handle('db:get-knowledge-tags', async (_event, knowledgeId) => {
      try {
        return this.database?.getKnowledgeTags(knowledgeId) || [];
      } catch (error) {
        console.error('获取知识库项标签失败:', error);
        return [];
      }
    });

    // 统计数据
    ipcMain.handle('db:get-statistics', async () => {
      try {
        return this.database?.getStatistics() || { total: 0, today: 0, byType: {} };
      } catch (error) {
        console.error('获取统计数据失败:', error);
        return { total: 0, today: 0, byType: {} };
      }
    });

    // 数据库工具
    ipcMain.handle('db:get-path', async () => {
      return this.database?.getDatabasePath() || null;
    });

    // 数据库切换（企业版多身份）
    ipcMain.handle('db:switch-database', async (_event, contextId, options = {}) => {
      try {
        if (!this.database) {
          throw new Error('数据库管理器未初始化');
        }

        // 获取新数据库路径
        const newDbPath = this.database.getDatabasePath(contextId);
        console.log('[Main] 切换数据库到:', newDbPath, 'contextId:', contextId);

        // 切换数据库
        await this.database.switchDatabase(newDbPath, options);

        console.log('[Main] ✓ 数据库切换成功');
        return { success: true, path: newDbPath };
      } catch (error) {
        console.error('[Main] 切换数据库失败:', error);
        throw error;
      }
    });

    // 获取数据库路径（根据身份上下文）
    ipcMain.handle('db:get-context-path', async (_event, contextId) => {
      try {
        if (!this.database) {
          return null;
        }
        return this.database.getDatabasePath(contextId);
      } catch (error) {
        console.error('[Main] 获取数据库路径失败:', error);
        return null;
      }
    });

    // 获取当前数据库路径
    ipcMain.handle('db:get-current-path', async () => {
      try {
        return this.database?.getCurrentDatabasePath() || null;
      } catch (error) {
        console.error('[Main] 获取当前数据库路径失败:', error);
        return null;
      }
    });

    ipcMain.handle('db:backup', async (_event, backupPath) => {
      try {
        await this.database?.backup(backupPath);
        return true;
      } catch (error) {
        console.error('备份数据库失败:', error);
        throw error;
      }
    });

    // 文件导入
    ipcMain.handle('import:select-files', async () => {
      try {
        if (!this.fileImporter) {
          throw new Error('文件导入器未初始化');
        }

        // 打开文件选择对话框
        const result = await dialog.showOpenDialog(this.mainWindow, {
          title: '选择要导入的文件',
          filters: [
            { name: 'Markdown', extensions: ['md', 'markdown'] },
            { name: 'PDF', extensions: ['pdf'] },
            { name: 'Word', extensions: ['doc', 'docx'] },
            { name: 'Text', extensions: ['txt'] },
            { name: 'All Files', extensions: ['*'] },
          ],
          properties: ['openFile', 'multiSelections'],
        });

        if (result.canceled) {
          return { canceled: true };
        }

        return {
          canceled: false,
          filePaths: result.filePaths,
        };
      } catch (error) {
        console.error('[Main] 选择文件失败:', error);
        throw error;
      }
    });

    ipcMain.handle('import:import-file', async (_event, filePath, options) => {
      try {
        if (!this.fileImporter) {
          throw new Error('文件导入器未初始化');
        }

        // 设置事件监听器，向渲染进程发送进度
        this.fileImporter.on('import-start', (data) => {
          if (this.mainWindow) {
            this.mainWindow.webContents.send('import:start', data);
          }
        });

        this.fileImporter.on('import-success', (data) => {
          if (this.mainWindow) {
            this.mainWindow.webContents.send('import:success', data);
          }
        });

        this.fileImporter.on('import-error', (data) => {
          if (this.mainWindow) {
            this.mainWindow.webContents.send('import:error', data);
          }
        });

        const result = await this.fileImporter.importFile(filePath, options);

        // 导入成功后，添加到RAG索引
        if (result && this.ragManager) {
          const item = this.database.getKnowledgeItemById(result.id);
          if (item) {
            await this.ragManager.addToIndex(item);
          }
        }

        return result;
      } catch (error) {
        console.error('[Main] 导入文件失败:', error);
        throw error;
      }
    });

    ipcMain.handle('import:import-files', async (_event, filePaths, options) => {
      try {
        if (!this.fileImporter) {
          throw new Error('文件导入器未初始化');
        }

        // 设置事件监听器，向渲染进程发送进度
        this.fileImporter.on('import-progress', (data) => {
          if (this.mainWindow) {
            this.mainWindow.webContents.send('import:progress', data);
          }
        });

        this.fileImporter.on('import-complete', (data) => {
          if (this.mainWindow) {
            this.mainWindow.webContents.send('import:complete', data);
          }
        });

        const results = await this.fileImporter.importFiles(filePaths, options);

        // 批量导入成功后，重建RAG索引
        if (results.success.length > 0 && this.ragManager) {
          await this.ragManager.rebuildIndex();
        }

        return results;
      } catch (error) {
        console.error('[Main] 批量导入文件失败:', error);
        throw error;
      }
    });

    ipcMain.handle('import:get-supported-formats', async () => {
      try {
        if (!this.fileImporter) {
          throw new Error('文件导入器未初始化');
        }

        return this.fileImporter.getSupportedFormats();
      } catch (error) {
        console.error('[Main] 获取支持格式失败:', error);
        throw error;
      }
    });

    ipcMain.handle('import:check-file', async (_event, filePath) => {
      try {
        if (!this.fileImporter) {
          throw new Error('文件导入器未初始化');
        }

        const isSupported = this.fileImporter.isSupportedFile(filePath);
        const fileType = this.fileImporter.getFileType(filePath);

        return {
          isSupported,
          fileType,
        };
      } catch (error) {
        console.error('[Main] 检查文件失败:', error);
        throw error;
      }
    });

    // 视频导入
    ipcMain.handle('video:select-files', async () => {
      try {
        if (!this.videoImporter) {
          throw new Error('视频导入器未初始化');
        }

        const result = await dialog.showOpenDialog(this.mainWindow, {
          title: '选择要导入的视频文件',
          filters: [
            { name: 'Video Files', extensions: ['mp4', 'avi', 'mov', 'mkv', 'flv', 'webm', 'wmv', 'mpg', 'mpeg', 'm4v', '3gp'] },
            { name: 'All Files', extensions: ['*'] },
          ],
          properties: ['openFile', 'multiSelections'],
        });

        if (result.canceled) {
          return { canceled: true };
        }

        return {
          canceled: false,
          filePaths: result.filePaths,
        };
      } catch (error) {
        console.error('[Main] 选择视频文件失败:', error);
        throw error;
      }
    });

    ipcMain.handle('video:import-file', async (_event, filePath, options) => {
      try {
        if (!this.videoImporter) {
          throw new Error('视频导入器未初始化');
        }

        // 设置事件监听器，向渲染进程发送进度
        this.videoImporter.on('import:start', (data) => {
          if (this.mainWindow) {
            this.mainWindow.webContents.send('video:import:start', data);
          }
        });

        this.videoImporter.on('import:progress', (data) => {
          if (this.mainWindow) {
            this.mainWindow.webContents.send('video:import:progress', data);
          }
        });

        this.videoImporter.on('import:complete', (data) => {
          if (this.mainWindow) {
            this.mainWindow.webContents.send('video:import:complete', data);
          }
        });

        this.videoImporter.on('import:error', (data) => {
          if (this.mainWindow) {
            this.mainWindow.webContents.send('video:import:error', data);
          }
        });

        this.videoImporter.on('analysis:start', (data) => {
          if (this.mainWindow) {
            this.mainWindow.webContents.send('video:analysis:start', data);
          }
        });

        this.videoImporter.on('analysis:progress', (data) => {
          if (this.mainWindow) {
            this.mainWindow.webContents.send('video:analysis:progress', data);
          }
        });

        this.videoImporter.on('analysis:complete', (data) => {
          if (this.mainWindow) {
            this.mainWindow.webContents.send('video:analysis:complete', data);
          }
        });

        this.videoImporter.on('analysis:error', (data) => {
          if (this.mainWindow) {
            this.mainWindow.webContents.send('video:analysis:error', data);
          }
        });

        const result = await this.videoImporter.importVideo(filePath, options);
        return result;
      } catch (error) {
        console.error('[Main] 导入视频失败:', error);
        throw error;
      }
    });

    ipcMain.handle('video:import-files', async (_event, filePaths, options) => {
      try {
        if (!this.videoImporter) {
          throw new Error('视频导入器未初始化');
        }

        // 设置事件监听器，向渲染进程发送批量导入进度
        this.videoImporter.on('batch:start', (data) => {
          if (this.mainWindow) {
            this.mainWindow.webContents.send('video:batch:start', data);
          }
        });

        this.videoImporter.on('batch:progress', (data) => {
          if (this.mainWindow) {
            this.mainWindow.webContents.send('video:batch:progress', data);
          }
        });

        this.videoImporter.on('batch:complete', (data) => {
          if (this.mainWindow) {
            this.mainWindow.webContents.send('video:batch:complete', data);
          }
        });

        const results = await this.videoImporter.importVideoBatch(filePaths, options);
        return results;
      } catch (error) {
        console.error('[Main] 批量导入视频失败:', error);
        throw error;
      }
    });

    ipcMain.handle('video:get-video', async (_event, videoId) => {
      try {
        if (!this.videoImporter) {
          throw new Error('视频导入器未初始化');
        }
        return await this.videoImporter.storage.getVideoFile(videoId);
      } catch (error) {
        console.error('[Main] 获取视频信息失败:', error);
        throw error;
      }
    });

    ipcMain.handle('video:get-videos', async (_event, options) => {
      try {
        if (!this.videoImporter) {
          throw new Error('视频导入器未初始化');
        }
        return await this.videoImporter.storage.getAllVideos(options);
      } catch (error) {
        console.error('[Main] 获取视频列表失败:', error);
        throw error;
      }
    });

    ipcMain.handle('video:get-analysis', async (_event, videoId) => {
      try {
        if (!this.videoImporter) {
          throw new Error('视频导入器未初始化');
        }
        return await this.videoImporter.storage.getVideoAnalysisByVideoId(videoId);
      } catch (error) {
        console.error('[Main] 获取视频分析失败:', error);
        throw error;
      }
    });

    ipcMain.handle('video:get-keyframes', async (_event, videoId) => {
      try {
        if (!this.videoImporter) {
          throw new Error('视频导入器未初始化');
        }
        return await this.videoImporter.storage.getKeyframesByVideoId(videoId);
      } catch (error) {
        console.error('[Main] 获取关键帧失败:', error);
        throw error;
      }
    });

    ipcMain.handle('video:delete-video', async (_event, videoId) => {
      try {
        if (!this.videoImporter) {
          throw new Error('视频导入器未初始化');
        }
        await this.videoImporter.storage.deleteVideoFile(videoId);
        return { success: true };
      } catch (error) {
        console.error('[Main] 删除视频失败:', error);
        throw error;
      }
    });

    ipcMain.handle('video:get-stats', async () => {
      try {
        if (!this.videoImporter) {
          throw new Error('视频导入器未初始化');
        }
        const count = await this.videoImporter.storage.getVideoCount();
        const totalDuration = await this.videoImporter.storage.getTotalDuration();
        const totalSize = await this.videoImporter.storage.getTotalStorageSize();
        const statusStats = await this.videoImporter.storage.getVideoCountByStatus();

        return {
          count,
          totalDuration,
          totalSize,
          statusStats
        };
      } catch (error) {
        console.error('[Main] 获取视频统计失败:', error);
        throw error;
      }
    });

    // 图片上传和 OCR
    ipcMain.handle('image:select-images', async () => {
      try {
        if (!this.imageUploader) {
          throw new Error('图片上传器未初始化');
        }

        // 打开图片选择对话框
        const result = await dialog.showOpenDialog(this.mainWindow, {
          title: '选择要上传的图片',
          filters: [
            { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'] },
            { name: 'All Files', extensions: ['*'] },
          ],
          properties: ['openFile', 'multiSelections'],
        });

        if (result.canceled) {
          return { canceled: true };
        }

        return {
          canceled: false,
          filePaths: result.filePaths,
        };
      } catch (error) {
        console.error('[Main] 选择图片失败:', error);
        throw error;
      }
    });

    ipcMain.handle('image:upload', async (_event, imagePath, options) => {
      try {
        if (!this.imageUploader) {
          throw new Error('图片上传器未初始化');
        }

        // 设置事件监听器
        this.imageUploader.on('upload-start', (data) => {
          if (this.mainWindow) {
            this.mainWindow.webContents.send('image:upload-start', data);
          }
        });

        this.imageUploader.on('upload-complete', (data) => {
          if (this.mainWindow) {
            this.mainWindow.webContents.send('image:upload-complete', data);
          }
        });

        this.imageUploader.on('ocr:progress', (data) => {
          if (this.mainWindow) {
            this.mainWindow.webContents.send('image:ocr-progress', data);
          }
        });

        const result = await this.imageUploader.uploadImage(imagePath, options);
        return result;
      } catch (error) {
        console.error('[Main] 上传图片失败:', error);
        throw error;
      }
    });

    ipcMain.handle('image:upload-batch', async (_event, imagePaths, options) => {
      try {
        if (!this.imageUploader) {
          throw new Error('图片上传器未初始化');
        }

        // 设置事件监听器
        this.imageUploader.on('batch-progress', (data) => {
          if (this.mainWindow) {
            this.mainWindow.webContents.send('image:batch-progress', data);
          }
        });

        this.imageUploader.on('batch-complete', (data) => {
          if (this.mainWindow) {
            this.mainWindow.webContents.send('image:batch-complete', data);
          }
        });

        const results = await this.imageUploader.uploadImages(imagePaths, options);
        return results;
      } catch (error) {
        console.error('[Main] 批量上传图片失败:', error);
        throw error;
      }
    });

    ipcMain.handle('image:ocr', async (_event, imagePath) => {
      try {
        if (!this.imageUploader) {
          throw new Error('图片上传器未初始化');
        }

        const result = await this.imageUploader.performOCR(imagePath);
        return result;
      } catch (error) {
        console.error('[Main] OCR 识别失败:', error);
        throw error;
      }
    });

    ipcMain.handle('image:get', async (_event, imageId) => {
      try {
        if (!this.imageUploader) {
          throw new Error('图片上传器未初始化');
        }

        const image = await this.imageUploader.getImageInfo(imageId);
        return image;
      } catch (error) {
        console.error('[Main] 获取图片失败:', error);
        throw error;
      }
    });

    ipcMain.handle('image:list', async (_event, options) => {
      try {
        if (!this.imageUploader) {
          throw new Error('图片上传器未初始化');
        }

        const images = await this.imageUploader.getAllImages(options);
        return images;
      } catch (error) {
        console.error('[Main] 获取图片列表失败:', error);
        throw error;
      }
    });

    ipcMain.handle('image:search', async (_event, query) => {
      try {
        if (!this.imageUploader) {
          throw new Error('图片上传器未初始化');
        }

        const images = await this.imageUploader.searchImages(query);
        return images;
      } catch (error) {
        console.error('[Main] 搜索图片失败:', error);
        throw error;
      }
    });

    ipcMain.handle('image:delete', async (_event, imageId) => {
      try {
        if (!this.imageUploader) {
          throw new Error('图片上传器未初始化');
        }

        const result = await this.imageUploader.deleteImage(imageId);
        return result;
      } catch (error) {
        console.error('[Main] 删除图片失败:', error);
        throw error;
      }
    });

    ipcMain.handle('image:get-stats', async () => {
      try {
        if (!this.imageUploader) {
          throw new Error('图片上传器未初始化');
        }

        const stats = await this.imageUploader.getStats();
        return stats;
      } catch (error) {
        console.error('[Main] 获取统计信息失败:', error);
        throw error;
      }
    });

    ipcMain.handle('image:get-supported-formats', async () => {
      try {
        if (!this.imageUploader) {
          throw new Error('图片上传器未初始化');
        }

        return this.imageUploader.getSupportedFormats();
      } catch (error) {
        console.error('[Main] 获取支持格式失败:', error);
        throw error;
      }
    });

    ipcMain.handle('image:get-supported-languages', async () => {
      try {
        if (!this.imageUploader) {
          throw new Error('图片上传器未初始化');
        }

        return this.imageUploader.getSupportedLanguages();
      } catch (error) {
        console.error('[Main] 获取支持语言失败:', error);
        throw error;
      }
    });

    // 提示词模板管理
    ipcMain.handle('prompt-template:get-all', async (_event, filters) => {
      try {
        if (!this.promptTemplateManager) {
          return [];
        }

        return await this.promptTemplateManager.getTemplates(filters);
      } catch (error) {
        console.error('[Main] 获取模板列表失败:', error);
        return [];
      }
    });

    ipcMain.handle('prompt-template:get', async (_event, id) => {
      try {
        if (!this.promptTemplateManager) {
          return null;
        }

        return await this.promptTemplateManager.getTemplateById(id);
      } catch (error) {
        console.error('[Main] 获取模板失败:', error);
        return null;
      }
    });

    ipcMain.handle('prompt-template:create', async (_event, templateData) => {
      try {
        if (!this.promptTemplateManager) {
          throw new Error('提示词模板管理器未初始化');
        }

        return await this.promptTemplateManager.createTemplate(templateData);
      } catch (error) {
        console.error('[Main] 创建模板失败:', error);
        throw error;
      }
    });

    ipcMain.handle('prompt-template:update', async (_event, id, updates) => {
      try {
        if (!this.promptTemplateManager) {
          throw new Error('提示词模板管理器未初始化');
        }

        return await this.promptTemplateManager.updateTemplate(id, updates);
      } catch (error) {
        console.error('[Main] 更新模板失败:', error);
        throw error;
      }
    });

    ipcMain.handle('prompt-template:delete', async (_event, id) => {
      try {
        if (!this.promptTemplateManager) {
          throw new Error('提示词模板管理器未初始化');
        }

        return await this.promptTemplateManager.deleteTemplate(id);
      } catch (error) {
        console.error('[Main] 删除模板失败:', error);
        throw error;
      }
    });

    ipcMain.handle('prompt-template:fill', async (_event, id, values) => {
      try {
        if (!this.promptTemplateManager) {
          throw new Error('提示词模板管理器未初始化');
        }

        return await this.promptTemplateManager.fillTemplate(id, values);
      } catch (error) {
        console.error('[Main] 填充模板失败:', error);
        throw error;
      }
    });

    ipcMain.handle('prompt-template:get-categories', async () => {
      try {
        if (!this.promptTemplateManager) {
          return [];
        }

        return await this.promptTemplateManager.getCategories();
      } catch (error) {
        console.error('[Main] 获取分类失败:', error);
        return [];
      }
    });

    ipcMain.handle('prompt-template:search', async (_event, query) => {
      try {
        if (!this.promptTemplateManager) {
          return [];
        }

        return await this.promptTemplateManager.searchTemplates(query);
      } catch (error) {
        console.error('[Main] 搜索模板失败:', error);
        return [];
      }
    });

    ipcMain.handle('prompt-template:get-statistics', async () => {
      try {
        if (!this.promptTemplateManager) {
          return { total: 0, system: 0, custom: 0, byCategory: {}, mostUsed: [] };
        }

        return await this.promptTemplateManager.getStatistics();
      } catch (error) {
        console.error('[Main] 获取统计信息失败:', error);
        return { total: 0, system: 0, custom: 0, byCategory: {}, mostUsed: [] };
      }
    });

    ipcMain.handle('prompt-template:export', async (_event, id) => {
      try {
        if (!this.promptTemplateManager) {
          throw new Error('提示词模板管理器未初始化');
        }

        return await this.promptTemplateManager.exportTemplate(id);
      } catch (error) {
        console.error('[Main] 导出模板失败:', error);
        throw error;
      }
    });

    ipcMain.handle('prompt-template:import', async (_event, importData) => {
      try {
        if (!this.promptTemplateManager) {
          throw new Error('提示词模板管理器未初始化');
        }

        return await this.promptTemplateManager.importTemplate(importData);
      } catch (error) {
        console.error('[Main] 导入模板失败:', error);
        throw error;
      }
    });

    // LLM服务 - 完整实现
    ipcMain.handle('llm:check-status', async () => {
      try {
        if (!this.llmManager) {
          return {
            available: false,
            error: 'LLM服务未初始化',
          };
        }

        return await this.llmManager.checkStatus();
      } catch (error) {
        return {
          available: false,
          error: error.message,
        };
      }
    });

    ipcMain.handle('llm:query', async (_event, prompt, options = {}) => {
      try {
        if (!this.llmManager) {
          throw new Error('LLM服务未初始化');
        }

        return await this.llmManager.query(prompt, options);
      } catch (error) {
        console.error('[Main] LLM查询失败:', error);
        throw error;
      }
    });

    // 聊天对话（支持 messages 数组格式，保留完整对话历史，自动RAG增强）
    ipcMain.handle('llm:chat', async (_event, { messages, stream = false, enableRAG = true, ...options }) => {
      try {
        if (!this.llmManager) {
          throw new Error('LLM服务未初始化');
        }

        console.log('[Main] LLM 聊天请求, messages:', messages?.length || 0, 'stream:', stream, 'RAG:', enableRAG);

        let enhancedMessages = messages;
        let retrievedDocs = [];

        // 如果启用RAG，自动检索知识库并增强上下文
        if (enableRAG && this.ragManager) {
          try {
            // 获取最后一条用户消息作为查询
            const lastUserMessage = [...messages].reverse().find(msg => msg.role === 'user');

            if (lastUserMessage) {
              const query = lastUserMessage.content;

              // 检索相关知识
              const ragResult = await this.ragManager.enhanceQuery(query, {
                topK: options.ragTopK || 3,
                includeMetadata: true,
              });

              if (ragResult.retrievedDocs && ragResult.retrievedDocs.length > 0) {
                console.log('[Main] RAG检索到', ragResult.retrievedDocs.length, '条相关知识');
                retrievedDocs = ragResult.retrievedDocs;

                // 构建知识库上下文
                const knowledgeContext = ragResult.retrievedDocs
                  .map((doc, idx) => `[知识${idx + 1}] ${doc.title || doc.content.substring(0, 50)}\n${doc.content}`)
                  .join('\n\n');

                // 在消息数组中插入知识库上下文
                // 如果有系统消息，追加到系统消息；否则创建新的系统消息
                const systemMsgIndex = messages.findIndex(msg => msg.role === 'system');

                if (systemMsgIndex >= 0) {
                  enhancedMessages = [...messages];
                  enhancedMessages[systemMsgIndex] = {
                    ...messages[systemMsgIndex],
                    content: `${messages[systemMsgIndex].content}\n\n## 知识库参考\n${knowledgeContext}`,
                  };
                } else {
                  enhancedMessages = [
                    {
                      role: 'system',
                      content: `## 知识库参考\n以下是从知识库中检索到的相关信息，请参考这些内容来回答用户的问题：\n\n${knowledgeContext}`,
                    },
                    ...messages,
                  ];
                }
              }
            }
          } catch (ragError) {
            console.error('[Main] RAG检索失败，继续普通对话:', ragError);
          }
        }

        // 使用新的 chatWithMessages 方法，保留完整的 messages 历史
        const response = await this.llmManager.chatWithMessages(enhancedMessages, options);

        console.log('[Main] LLM 聊天响应成功, tokens:', response.tokens);

        // 返回 OpenAI 兼容格式，包含检索到的文档
        return {
          content: response.text,
          message: response.message || {
            role: 'assistant',
            content: response.text,
          },
          usage: response.usage || {
            total_tokens: response.tokens || 0,
          },
          // 返回检索到的知识库文档，供前端展示引用
          retrievedDocs: retrievedDocs.map(doc => ({
            id: doc.id,
            title: doc.title,
            content: doc.content.substring(0, 200), // 只返回摘要
            score: doc.score,
          })),
        };
      } catch (error) {
        console.error('[Main] LLM 聊天失败:', error);
        throw error;
      }
    });

    // 使用提示词模板进行聊天
    ipcMain.handle('llm:chat-with-template', async (_event, { templateId, variables, messages = [], ...options }) => {
      try {
        if (!this.llmManager) {
          throw new Error('LLM服务未初始化');
        }

        if (!this.promptTemplateManager) {
          throw new Error('提示词模板管理器未初始化');
        }

        console.log('[Main] 使用模板进行聊天, templateId:', templateId);

        // 填充模板变量
        const filledPrompt = await this.promptTemplateManager.fillTemplate(templateId, variables);

        console.log('[Main] 模板已填充');

        // 构建消息数组，将填充后的模板作为用户消息
        const enhancedMessages = [
          ...messages,
          {
            role: 'user',
            content: filledPrompt,
          },
        ];

        // 调用标准的聊天方法
        return await this.llmManager.chatWithMessages(enhancedMessages, options);
      } catch (error) {
        console.error('[Main] 模板聊天失败:', error);
        throw error;
      }
    });

    ipcMain.handle('llm:query-stream', async (_event, prompt, options = {}) => {
      try {
        if (!this.llmManager) {
          throw new Error('LLM服务未初始化');
        }

        // 流式响应通过事件发送
        const result = await this.llmManager.queryStream(
          prompt,
          (chunk, fullText) => {
            if (this.mainWindow) {
              this.mainWindow.webContents.send('llm:stream-chunk', {
                chunk,
                fullText,
                conversationId: options.conversationId,
              });
            }
          },
          options
        );

        return result;
      } catch (error) {
        console.error('[Main] LLM流式查询失败:', error);
        throw error;
      }
    });

    ipcMain.handle('llm:get-config', async () => {
      try {
        const llmConfig = getLLMConfig();
        return llmConfig.getAll();
      } catch (error) {
        console.error('[Main] 获取LLM配置失败:', error);
        throw error;
      }
    });

    ipcMain.handle('llm:set-config', async (_event, config) => {
      try {
        const llmConfig = getLLMConfig();

        // 更新配置
        Object.keys(config).forEach((key) => {
          llmConfig.set(key, config[key]);
        });

        llmConfig.save();

        // 重新初始化LLM管理器
        if (this.llmManager) {
          await this.llmManager.close();
        }

        const managerConfig = llmConfig.getManagerConfig();
        this.llmManager = new LLMManager(managerConfig);
        await this.llmManager.initialize();

        return true;
      } catch (error) {
        console.error('[Main] 设置LLM配置失败:', error);
        throw error;
      }
    });

    ipcMain.handle('llm:list-models', async () => {
      try {
        if (!this.llmManager) {
          return [];
        }

        return await this.llmManager.listModels();
      } catch (error) {
        console.error('[Main] 列出模型失败:', error);
        return [];
      }
    });

    ipcMain.handle('llm:clear-context', async (_event, conversationId) => {
      try {
        if (!this.llmManager) {
          throw new Error('LLM服务未初始化');
        }

        this.llmManager.clearContext(conversationId);
        return true;
      } catch (error) {
        console.error('[Main] 清除上下文失败:', error);
        throw error;
      }
    });

    ipcMain.handle('llm:embeddings', async (_event, text) => {
      try {
        if (!this.llmManager) {
          throw new Error('LLM服务未初始化');
        }

        return await this.llmManager.embeddings(text);
      } catch (error) {
        console.error('[Main] 生成嵌入失败:', error);
        throw error;
      }
    });

    // RAG - 知识库检索增强
    ipcMain.handle('rag:retrieve', async (_event, query, options = {}) => {
      try {
        if (!this.ragManager) {
          return [];
        }

        return await this.ragManager.retrieve(query, options);
      } catch (error) {
        console.error('[Main] RAG检索失败:', error);
        return [];
      }
    });

    ipcMain.handle('rag:enhance-query', async (_event, query, options = {}) => {
      try {
        if (!this.ragManager) {
          return {
            query,
            context: '',
            retrievedDocs: [],
          };
        }

        return await this.ragManager.enhanceQuery(query, options);
      } catch (error) {
        console.error('[Main] RAG增强查询失败:', error);
        return {
          query,
          context: '',
          retrievedDocs: [],
        };
      }
    });

    ipcMain.handle('rag:rebuild-index', async () => {
      try {
        if (!this.ragManager) {
          throw new Error('RAG服务未初始化');
        }

        await this.ragManager.rebuildIndex();
        return { success: true };
      } catch (error) {
        console.error('[Main] RAG重建索引失败:', error);
        throw error;
      }
    });

    ipcMain.handle('rag:get-stats', async () => {
      try {
        if (!this.ragManager) {
          return {
            totalItems: 0,
            cacheStats: { size: 0, maxSize: 0 },
            config: {},
          };
        }

        return this.ragManager.getIndexStats();
      } catch (error) {
        console.error('[Main] 获取RAG统计失败:', error);
        return {
          totalItems: 0,
          cacheStats: { size: 0, maxSize: 0 },
          config: {},
        };
      }
    });

    ipcMain.handle('rag:update-config', async (_event, config) => {
      try {
        if (!this.ragManager) {
          throw new Error('RAG服务未初始化');
        }

        this.ragManager.updateConfig(config);
        return { success: true };
      } catch (error) {
        console.error('[Main] 更新RAG配置失败:', error);
        throw error;
      }
    });

    // RAG - 重排序功能
    ipcMain.handle('rag:get-rerank-config', async () => {
      try {
        if (!this.ragManager) {
          return null;
        }

        return this.ragManager.getRerankConfig();
      } catch (error) {
        console.error('[Main] 获取重排序配置失败:', error);
        return null;
      }
    });

    ipcMain.handle('rag:set-reranking-enabled', async (_event, enabled) => {
      try {
        if (!this.ragManager) {
          throw new Error('RAG服务未初始化');
        }

        this.ragManager.setRerankingEnabled(enabled);
        return { success: true };
      } catch (error) {
        console.error('[Main] 设置重排序状态失败:', error);
        throw error;
      }
    });

    // DID身份管理
    ipcMain.handle('did:create-identity', async (_event, profile, options) => {
      try {
        if (!this.didManager) {
          throw new Error('DID管理器未初始化');
        }

        return await this.didManager.createIdentity(profile, options);
      } catch (error) {
        console.error('[Main] 创建身份失败:', error);
        throw error;
      }
    });

    ipcMain.handle('did:get-all-identities', async () => {
      try {
        if (!this.didManager) {
          throw new Error('DID管理器未初始化');
        }

        return this.didManager.getAllIdentities();
      } catch (error) {
        console.error('[Main] 获取身份列表失败:', error);
        throw error;
      }
    });

    ipcMain.handle('did:get-identity', async (_event, did) => {
      try {
        if (!this.didManager) {
          throw new Error('DID管理器未初始化');
        }

        return this.didManager.getIdentityByDID(did);
      } catch (error) {
        console.error('[Main] 获取身份失败:', error);
        throw error;
      }
    });

    ipcMain.handle('did:get-current-identity', async () => {
      try {
        if (!this.didManager) {
          throw new Error('DID管理器未初始化');
        }

        return this.didManager.getCurrentIdentity();
      } catch (error) {
        console.error('[Main] 获取当前身份失败:', error);
        throw error;
      }
    });

    ipcMain.handle('did:set-default-identity', async (_event, did) => {
      try {
        if (!this.didManager) {
          throw new Error('DID管理器未初始化');
        }

        await this.didManager.setDefaultIdentity(did);
        return { success: true };
      } catch (error) {
        console.error('[Main] 设置默认身份失败:', error);
        throw error;
      }
    });

    ipcMain.handle('did:update-identity', async (_event, did, updates) => {
      try {
        if (!this.didManager) {
          throw new Error('DID管理器未初始化');
        }

        return await this.didManager.updateIdentityProfile(did, updates);
      } catch (error) {
        console.error('[Main] 更新身份失败:', error);
        throw error;
      }
    });

    ipcMain.handle('did:delete-identity', async (_event, did) => {
      try {
        if (!this.didManager) {
          throw new Error('DID管理器未初始化');
        }

        return await this.didManager.deleteIdentity(did);
      } catch (error) {
        console.error('[Main] 删除身份失败:', error);
        throw error;
      }
    });

    ipcMain.handle('did:export-document', async (_event, did) => {
      try {
        if (!this.didManager) {
          throw new Error('DID管理器未初始化');
        }

        return this.didManager.exportDIDDocument(did);
      } catch (error) {
        console.error('[Main] 导出DID文档失败:', error);
        throw error;
      }
    });

    ipcMain.handle('did:generate-qrcode', async (_event, did) => {
      try {
        if (!this.didManager) {
          throw new Error('DID管理器未初始化');
        }

        return this.didManager.generateQRCodeData(did);
      } catch (error) {
        console.error('[Main] 生成二维码失败:', error);
        throw error;
      }
    });

    ipcMain.handle('did:verify-document', async (_event, document) => {
      try {
        if (!this.didManager) {
          throw new Error('DID管理器未初始化');
        }

        return this.didManager.verifyDIDDocument(document);
      } catch (error) {
        console.error('[Main] 验证DID文档失败:', error);
        throw error;
      }
    });

    // DID DHT操作
    ipcMain.handle('did:publish-to-dht', async (_event, did) => {
      try {
        if (!this.didManager) {
          throw new Error('DID管理器未初始化');
        }

        return await this.didManager.publishToDHT(did);
      } catch (error) {
        console.error('[Main] 发布DID到DHT失败:', error);
        throw error;
      }
    });

    ipcMain.handle('did:resolve-from-dht', async (_event, did) => {
      try {
        if (!this.didManager) {
          throw new Error('DID管理器未初始化');
        }

        return await this.didManager.resolveFromDHT(did);
      } catch (error) {
        console.error('[Main] 从DHT解析DID失败:', error);
        throw error;
      }
    });

    ipcMain.handle('did:unpublish-from-dht', async (_event, did) => {
      try {
        if (!this.didManager) {
          throw new Error('DID管理器未初始化');
        }

        return await this.didManager.unpublishFromDHT(did);
      } catch (error) {
        console.error('[Main] 从DHT取消发布DID失败:', error);
        throw error;
      }
    });

    ipcMain.handle('did:is-published-to-dht', async (_event, did) => {
      try {
        if (!this.didManager) {
          throw new Error('DID管理器未初始化');
        }

        return await this.didManager.isPublishedToDHT(did);
      } catch (error) {
        console.error('[Main] 检查DID发布状态失败:', error);
        return false;
      }
    });

    // DID 自动重新发布
    ipcMain.handle('did:start-auto-republish', async (_event, interval) => {
      try {
        if (!this.didManager) {
          throw new Error('DID管理器未初始化');
        }

        this.didManager.startAutoRepublish(interval);
        return { success: true };
      } catch (error) {
        console.error('[Main] 启动自动重新发布失败:', error);
        throw error;
      }
    });

    ipcMain.handle('did:stop-auto-republish', async () => {
      try {
        if (!this.didManager) {
          throw new Error('DID管理器未初始化');
        }

        this.didManager.stopAutoRepublish();
        return { success: true };
      } catch (error) {
        console.error('[Main] 停止自动重新发布失败:', error);
        throw error;
      }
    });

    ipcMain.handle('did:get-auto-republish-status', async () => {
      try {
        if (!this.didManager) {
          throw new Error('DID管理器未初始化');
        }

        return this.didManager.getAutoRepublishStatus();
      } catch (error) {
        console.error('[Main] 获取自动重新发布状态失败:', error);
        return {
          enabled: false,
          interval: 0,
          intervalHours: 0,
        };
      }
    });

    ipcMain.handle('did:set-auto-republish-interval', async (_event, interval) => {
      try {
        if (!this.didManager) {
          throw new Error('DID管理器未初始化');
        }

        this.didManager.setAutoRepublishInterval(interval);
        return { success: true };
      } catch (error) {
        console.error('[Main] 设置自动重新发布间隔失败:', error);
        throw error;
      }
    });

    ipcMain.handle('did:republish-all', async () => {
      try {
        if (!this.didManager) {
          throw new Error('DID管理器未初始化');
        }

        return await this.didManager.republishAllDIDs();
      } catch (error) {
        console.error('[Main] 重新发布所有DID失败:', error);
        throw error;
      }
    });

    // DID 助记词管理
    ipcMain.handle('did:generate-mnemonic', async (_event, strength) => {
      try {
        if (!this.didManager) {
          throw new Error('DID管理器未初始化');
        }

        return this.didManager.generateMnemonic(strength);
      } catch (error) {
        console.error('[Main] 生成助记词失败:', error);
        throw error;
      }
    });

    ipcMain.handle('did:validate-mnemonic', async (_event, mnemonic) => {
      try {
        if (!this.didManager) {
          throw new Error('DID管理器未初始化');
        }

        return this.didManager.validateMnemonic(mnemonic);
      } catch (error) {
        console.error('[Main] 验证助记词失败:', error);
        return false;
      }
    });

    ipcMain.handle('did:create-from-mnemonic', async (_event, profile, mnemonic, options) => {
      try {
        if (!this.didManager) {
          throw new Error('DID管理器未初始化');
        }

        return await this.didManager.createIdentityFromMnemonic(profile, mnemonic, options);
      } catch (error) {
        console.error('[Main] 从助记词创建身份失败:', error);
        throw error;
      }
    });

    ipcMain.handle('did:export-mnemonic', async (_event, did) => {
      try {
        if (!this.didManager) {
          throw new Error('DID管理器未初始化');
        }

        return this.didManager.exportMnemonic(did);
      } catch (error) {
        console.error('[Main] 导出助记词失败:', error);
        throw error;
      }
    });

    ipcMain.handle('did:has-mnemonic', async (_event, did) => {
      try {
        if (!this.didManager) {
          throw new Error('DID管理器未初始化');
        }

        return this.didManager.hasMnemonic(did);
      } catch (error) {
        console.error('[Main] 检查助记词失败:', error);
        return false;
      }
    });

    // ============================
    // 企业版：身份上下文 IPC Handler
    // ============================

    // 获取所有身份上下文
    ipcMain.handle('identity:get-all-contexts', async (_event, { userDID }) => {
      try {
        if (!this.identityContextManager) {
          return { success: false, error: '身份上下文管理器未初始化', contexts: [] };
        }

        const contexts = this.identityContextManager.getAllContexts(userDID);
        return { success: true, contexts };
      } catch (error) {
        console.error('[Main] 获取身份上下文列表失败:', error);
        return { success: false, error: error.message, contexts: [] };
      }
    });

    // 获取当前激活的上下文
    ipcMain.handle('identity:get-active-context', async (_event, { userDID }) => {
      try {
        if (!this.identityContextManager) {
          return { success: false, error: '身份上下文管理器未初始化' };
        }

        const context = this.identityContextManager.getActiveContext(userDID);
        return { success: true, context };
      } catch (error) {
        console.error('[Main] 获取当前上下文失败:', error);
        return { success: false, error: error.message };
      }
    });

    // 创建个人上下文
    ipcMain.handle('identity:create-personal-context', async (_event, { userDID, displayName }) => {
      try {
        if (!this.identityContextManager) {
          return { success: false, error: '身份上下文管理器未初始化' };
        }

        return await this.identityContextManager.createPersonalContext(userDID, displayName);
      } catch (error) {
        console.error('[Main] 创建个人上下文失败:', error);
        return { success: false, error: error.message };
      }
    });

    // 创建组织上下文
    ipcMain.handle('identity:create-organization-context', async (_event, { userDID, orgId, orgDID, displayName, avatar }) => {
      try {
        if (!this.identityContextManager) {
          return { success: false, error: '身份上下文管理器未初始化' };
        }

        return await this.identityContextManager.createOrganizationContext(userDID, orgId, orgDID, displayName, avatar);
      } catch (error) {
        console.error('[Main] 创建组织上下文失败:', error);
        return { success: false, error: error.message };
      }
    });

    // 切换身份上下文
    ipcMain.handle('identity:switch-context', async (_event, { userDID, targetContextId }) => {
      try {
        if (!this.identityContextManager) {
          return { success: false, error: '身份上下文管理器未初始化' };
        }

        return await this.identityContextManager.switchContext(userDID, targetContextId);
      } catch (error) {
        console.error('[Main] 切换身份上下文失败:', error);
        return { success: false, error: error.message };
      }
    });

    // 删除组织上下文
    ipcMain.handle('identity:delete-organization-context', async (_event, { userDID, orgId }) => {
      try {
        if (!this.identityContextManager) {
          return { success: false, error: '身份上下文管理器未初始化' };
        }

        return await this.identityContextManager.deleteOrganizationContext(userDID, orgId);
      } catch (error) {
        console.error('[Main] 删除组织上下文失败:', error);
        return { success: false, error: error.message };
      }
    });

    // 获取切换历史
    ipcMain.handle('identity:get-switch-history', async (_event, { userDID, limit }) => {
      try {
        if (!this.identityContextManager) {
          return { success: false, error: '身份上下文管理器未初始化', history: [] };
        }

        const history = this.identityContextManager.getSwitchHistory(userDID, limit);
        return { success: true, history };
      } catch (error) {
        console.error('[Main] 获取切换历史失败:', error);
        return { success: false, error: error.message, history: [] };
      }
    });

    // ============================
    // 企业版：组织管理IPC Handler
    // ============================

    // 创建组织
    ipcMain.handle('org:create-organization', async (_event, orgData) => {
      try {
        if (!this.organizationManager) {
          throw new Error('组织管理器未初始化');
        }

        return await this.organizationManager.createOrganization(orgData);
      } catch (error) {
        console.error('[Main] 创建组织失败:', error);
        throw error;
      }
    });

    // 通过邀请码加入组织
    ipcMain.handle('org:join-organization', async (_event, inviteCode) => {
      try {
        if (!this.organizationManager) {
          throw new Error('组织管理器未初始化');
        }

        return await this.organizationManager.joinOrganization(inviteCode);
      } catch (error) {
        console.error('[Main] 加入组织失败:', error);
        throw error;
      }
    });

    // 获取组织信息
    ipcMain.handle('org:get-organization', async (_event, orgId) => {
      try {
        if (!this.organizationManager) {
          throw new Error('组织管理器未初始化');
        }

        return await this.organizationManager.getOrganization(orgId);
      } catch (error) {
        console.error('[Main] 获取组织信息失败:', error);
        throw error;
      }
    });

    // 获取用户所属组织列表
    ipcMain.handle('org:get-user-organizations', async (_event, userDID) => {
      try {
        if (!this.organizationManager) {
          return [];
        }

        return await this.organizationManager.getUserOrganizations(userDID);
      } catch (error) {
        console.error('[Main] 获取用户组织列表失败:', error);
        return [];
      }
    });

    // 获取组织成员列表
    ipcMain.handle('org:get-members', async (_event, orgId) => {
      try {
        if (!this.organizationManager) {
          return [];
        }

        return await this.organizationManager.getOrganizationMembers(orgId);
      } catch (error) {
        console.error('[Main] 获取组织成员失败:', error);
        return [];
      }
    });

    // 更新成员角色
    ipcMain.handle('org:update-member-role', async (_event, orgId, memberDID, newRole) => {
      try {
        if (!this.organizationManager) {
          throw new Error('组织管理器未初始化');
        }

        await this.organizationManager.updateMemberRole(orgId, memberDID, newRole);
        return { success: true };
      } catch (error) {
        console.error('[Main] 更新成员角色失败:', error);
        throw error;
      }
    });

    // 移除成员
    ipcMain.handle('org:remove-member', async (_event, orgId, memberDID) => {
      try {
        if (!this.organizationManager) {
          throw new Error('组织管理器未初始化');
        }

        await this.organizationManager.removeMember(orgId, memberDID);
        return { success: true };
      } catch (error) {
        console.error('[Main] 移除成员失败:', error);
        throw error;
      }
    });

    // 创建邀请
    ipcMain.handle('org:create-invitation', async (_event, orgId, inviteData) => {
      try {
        if (!this.organizationManager) {
          throw new Error('组织管理器未初始化');
        }

        return await this.organizationManager.createInvitation(orgId, inviteData);
      } catch (error) {
        console.error('[Main] 创建邀请失败:', error);
        throw error;
      }
    });

    // 检查权限
    ipcMain.handle('org:check-permission', async (_event, orgId, userDID, permission) => {
      try {
        if (!this.organizationManager) {
          return false;
        }

        return await this.organizationManager.checkPermission(orgId, userDID, permission);
      } catch (error) {
        console.error('[Main] 检查权限失败:', error);
        return false;
      }
    });

    // 获取组织活动日志
    ipcMain.handle('org:get-activities', async (_event, options) => {
      try {
        if (!this.organizationManager) {
          return { success: false, activities: [] };
        }

        const { orgId, limit = 500 } = options;
        const activities = await this.organizationManager.getOrganizationActivities(orgId, limit);
        return { success: true, activities };
      } catch (error) {
        console.error('[Main] 获取活动日志失败:', error);
        return { success: false, error: error.message, activities: [] };
      }
    });

    // 导出组织活动日志
    ipcMain.handle('org:export-activities', async (_event, options) => {
      try {
        const { orgId, activities } = options;
        const { dialog, app } = require('electron');
        const fs = require('fs').promises;
        const path = require('path');

        // 弹出保存对话框
        const result = await dialog.showSaveDialog({
          title: '导出活动日志',
          defaultPath: path.join(
            app.getPath('documents'),
            `organization_${orgId}_activities_${Date.now()}.json`
          ),
          filters: [
            { name: 'JSON Files', extensions: ['json'] },
            { name: 'CSV Files', extensions: ['csv'] },
            { name: 'All Files', extensions: ['*'] }
          ]
        });

        if (result.canceled || !result.filePath) {
          return { success: false, error: '用户取消' };
        }

        const filePath = result.filePath;
        const ext = path.extname(filePath).toLowerCase();

        if (ext === '.json') {
          // 导出为JSON
          await fs.writeFile(
            filePath,
            JSON.stringify(activities, null, 2),
            'utf-8'
          );
        } else if (ext === '.csv') {
          // 导出为CSV
          const headers = ['操作者DID', '操作类型', '资源类型', '资源ID', '时间', '元数据'];
          const rows = activities.map(a => [
            a.actor_did,
            a.action,
            a.resource_type,
            a.resource_id,
            new Date(a.timestamp).toISOString(),
            a.metadata
          ]);

          const csv = [
            headers.join(','),
            ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
          ].join('\n');

          await fs.writeFile(filePath, csv, 'utf-8');
        }

        return { success: true, filePath };
      } catch (error) {
        console.error('[Main] 导出活动日志失败:', error);
        return { success: false, error: error.message };
      }
    });

    // 离开组织
    ipcMain.handle('org:leave-organization', async (_event, orgId, userDID) => {
      try {
        if (!this.organizationManager) {
          throw new Error('组织管理器未初始化');
        }

        await this.organizationManager.leaveOrganization(orgId, userDID);
        return { success: true };
      } catch (error) {
        console.error('[Main] 离开组织失败:', error);
        throw error;
      }
    });

    // 删除组织
    ipcMain.handle('org:delete-organization', async (_event, orgId, userDID) => {
      try {
        if (!this.organizationManager) {
          throw new Error('组织管理器未初始化');
        }

        await this.organizationManager.deleteOrganization(orgId, userDID);
        return { success: true };
      } catch (error) {
        console.error('[Main] 删除组织失败:', error);
        throw error;
      }
    });

    // ============================
    // DID邀请相关 IPC Handler
    // ============================

    // 通过DID邀请用户
    ipcMain.handle('org:invite-by-did', async (_event, orgId, inviteData) => {
      try {
        if (!this.organizationManager) {
          throw new Error('组织管理器未初始化');
        }

        const invitation = await this.organizationManager.inviteByDID(orgId, inviteData);
        return invitation;
      } catch (error) {
        console.error('[Main] 通过DID邀请失败:', error);
        throw error;
      }
    });

    // 接受DID邀请
    ipcMain.handle('org:accept-did-invitation', async (_event, invitationId) => {
      try {
        if (!this.organizationManager) {
          throw new Error('组织管理器未初始化');
        }

        const org = await this.organizationManager.acceptDIDInvitation(invitationId);
        return org;
      } catch (error) {
        console.error('[Main] 接受DID邀请失败:', error);
        throw error;
      }
    });

    // 拒绝DID邀请
    ipcMain.handle('org:reject-did-invitation', async (_event, invitationId) => {
      try {
        if (!this.organizationManager) {
          throw new Error('组织管理器未初始化');
        }

        const result = await this.organizationManager.rejectDIDInvitation(invitationId);
        return { success: result };
      } catch (error) {
        console.error('[Main] 拒绝DID邀请失败:', error);
        throw error;
      }
    });

    // 获取待处理的DID邀请
    ipcMain.handle('org:get-pending-did-invitations', async (_event) => {
      try {
        if (!this.organizationManager) {
          return [];
        }

        const invitations = await this.organizationManager.getPendingDIDInvitations();
        return invitations;
      } catch (error) {
        console.error('[Main] 获取待处理DID邀请失败:', error);
        return [];
      }
    });

    // 获取组织的DID邀请列表
    ipcMain.handle('org:get-did-invitations', async (_event, orgId, options) => {
      try {
        if (!this.organizationManager) {
          return [];
        }

        const invitations = await this.organizationManager.getDIDInvitations(orgId, options);
        return invitations;
      } catch (error) {
        console.error('[Main] 获取DID邀请列表失败:', error);
        return [];
      }
    });

    // ============================
    // 角色管理相关 IPC Handler
    // ============================

    // 获取组织所有角色
    ipcMain.handle('org:get-roles', async (_event, orgId) => {
      try {
        if (!this.organizationManager) {
          throw new Error('组织管理器未初始化');
        }

        const roles = await this.organizationManager.getRoles(orgId);
        return roles;
      } catch (error) {
        console.error('[Main] 获取角色列表失败:', error);
        throw error;
      }
    });

    // 获取单个角色
    ipcMain.handle('org:get-role', async (_event, roleId) => {
      try {
        if (!this.organizationManager) {
          throw new Error('组织管理器未初始化');
        }

        const role = await this.organizationManager.getRole(roleId);
        return role;
      } catch (error) {
        console.error('[Main] 获取角色失败:', error);
        throw error;
      }
    });

    // 创建自定义角色
    ipcMain.handle('org:create-custom-role', async (_event, orgId, roleData, creatorDID) => {
      try {
        if (!this.organizationManager) {
          throw new Error('组织管理器未初始化');
        }

        const role = await this.organizationManager.createCustomRole(orgId, roleData, creatorDID);
        return role;
      } catch (error) {
        console.error('[Main] 创建自定义角色失败:', error);
        throw error;
      }
    });

    // 更新角色
    ipcMain.handle('org:update-role', async (_event, roleId, updates, updaterDID) => {
      try {
        if (!this.organizationManager) {
          throw new Error('组织管理器未初始化');
        }

        const role = await this.organizationManager.updateRole(roleId, updates, updaterDID);
        return role;
      } catch (error) {
        console.error('[Main] 更新角色失败:', error);
        throw error;
      }
    });

    // 删除角色
    ipcMain.handle('org:delete-role', async (_event, roleId, deleterDID) => {
      try {
        if (!this.organizationManager) {
          throw new Error('组织管理器未初始化');
        }

        await this.organizationManager.deleteRole(roleId, deleterDID);
        return { success: true };
      } catch (error) {
        console.error('[Main] 删除角色失败:', error);
        throw error;
      }
    });

    // 获取所有可用权限列表
    ipcMain.handle('org:get-all-permissions', async (_event) => {
      try {
        if (!this.organizationManager) {
          throw new Error('组织管理器未初始化');
        }

        const permissions = this.organizationManager.getAllPermissions();
        return permissions;
      } catch (error) {
        console.error('[Main] 获取权限列表失败:', error);
        throw error;
      }
    });

    // 更新组织信息
    ipcMain.handle('org:update-organization', async (_event, params) => {
      try {
        if (!this.organizationManager) {
          return { success: false, error: '组织管理器未初始化' };
        }

        const { orgId, name, type, description, visibility, p2pEnabled, syncMode } = params;

        const result = await this.organizationManager.updateOrganization(orgId, {
          name,
          type,
          description,
          visibility,
          p2p_enabled: p2pEnabled ? 1 : 0,
          sync_mode: syncMode
        });

        return result;
      } catch (error) {
        console.error('[Main] 更新组织失败:', error);
        return { success: false, error: error.message };
      }
    });

    // 获取邀请列表（包括邀请码和DID邀请）
    ipcMain.handle('org:get-invitations', async (_event, orgId) => {
      try {
        if (!this.organizationManager) {
          return { success: false, error: '组织管理器未初始化', invitations: [] };
        }

        const invitations = this.organizationManager.getInvitations(orgId);
        return { success: true, invitations };
      } catch (error) {
        console.error('[Main] 获取邀请列表失败:', error);
        return { success: false, error: error.message, invitations: [] };
      }
    });

    // 撤销邀请
    ipcMain.handle('org:revoke-invitation', async (_event, params) => {
      try {
        if (!this.organizationManager) {
          return { success: false, error: '组织管理器未初始化' };
        }

        const { orgId, invitationId } = params;
        const result = await this.organizationManager.revokeInvitation(orgId, invitationId);
        return result;
      } catch (error) {
        console.error('[Main] 撤销邀请失败:', error);
        return { success: false, error: error.message };
      }
    });

    // 删除邀请
    ipcMain.handle('org:delete-invitation', async (_event, params) => {
      try {
        if (!this.organizationManager) {
          return { success: false, error: '组织管理器未初始化' };
        }

        const { orgId, invitationId } = params;
        const result = await this.organizationManager.deleteInvitation(orgId, invitationId);
        return result;
      } catch (error) {
        console.error('[Main] 删除邀请失败:', error);
        return { success: false, error: error.message };
      }
    });

    // 获取成员活动历史
    ipcMain.handle('org:get-member-activities', async (_event, params) => {
      try {
        if (!this.organizationManager) {
          return { success: false, error: '组织管理器未初始化', activities: [] };
        }

        const { orgId, memberDID, limit = 10 } = params;
        const activities = this.organizationManager.getMemberActivities(orgId, memberDID, limit);
        return { success: true, activities };
      } catch (error) {
        console.error('[Main] 获取成员活动失败:', error);
        return { success: false, error: error.message, activities: [] };
      }
    });

    // ============================
    // 组织知识库相关 IPC Handler
    // ============================

    // 获取组织知识列表
    ipcMain.handle('org:get-knowledge-items', async (_event, params) => {
      try {
        const { orgId } = params;
        const db = this.dbManager.db;

        // 获取组织的所有知识（share_scope='org' 或 'public'）
        const items = db.prepare(`
          SELECT *
          FROM knowledge_items
          WHERE org_id = ? AND share_scope IN ('org', 'public')
          ORDER BY updated_at DESC
        `).all(orgId);

        return { success: true, items };
      } catch (error) {
        console.error('[Main] 获取组织知识列表失败:', error);
        return { success: false, error: error.message, items: [] };
      }
    });

    // 创建组织知识
    ipcMain.handle('org:create-knowledge', async (_event, params) => {
      try {
        const {
          orgId,
          title,
          type,
          content,
          shareScope,
          tags,
          createdBy
        } = params;

        const db = this.dbManager.db;
        const knowledgeId = require('uuid').v4();
        const now = Date.now();

        // 插入知识
        db.prepare(`
          INSERT INTO knowledge_items (
            id, title, type, content, org_id, created_by, updated_by,
            share_scope, version, created_at, updated_at, sync_status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          knowledgeId,
          title,
          type,
          content,
          orgId,
          createdBy,
          createdBy,
          shareScope || 'org',
          1,
          now,
          now,
          'pending'
        );

        // 添加标签（如果有）
        if (tags && tags.length > 0) {
          for (const tagName of tags) {
            // 查找或创建标签
            let tag = db.prepare('SELECT * FROM tags WHERE name = ?').get(tagName);
            if (!tag) {
              const tagId = require('uuid').v4();
              db.prepare(`
                INSERT INTO tags (id, name, color, created_at)
                VALUES (?, ?, ?, ?)
              `).run(tagId, tagName, '#1890ff', now);
              tag = { id: tagId };
            }

            // 关联标签
            db.prepare(`
              INSERT INTO knowledge_tags (knowledge_id, tag_id, created_at)
              VALUES (?, ?, ?)
            `).run(knowledgeId, tag.id, now);
          }
        }

        // 创建初始版本快照
        if (this.versionManager) {
          await this.versionManager.createVersionSnapshot(knowledgeId, createdBy, {
            changeSummary: '创建知识',
            metadata: { type: 'initial_create' }
          });
        }

        // 记录活动
        if (this.organizationManager) {
          await this.organizationManager.logActivity(
            orgId,
            createdBy,
            'create_knowledge',
            'knowledge',
            knowledgeId,
            { title }
          );
        }

        return { success: true, id: knowledgeId };
      } catch (error) {
        console.error('[Main] 创建组织知识失败:', error);
        return { success: false, error: error.message };
      }
    });

    // 删除组织知识
    ipcMain.handle('org:delete-knowledge', async (_event, params) => {
      try {
        const { orgId, knowledgeId } = params;
        const db = this.dbManager.db;

        // 检查知识是否存在且属于该组织
        const knowledge = db.prepare(`
          SELECT * FROM knowledge_items WHERE id = ? AND org_id = ?
        `).get(knowledgeId, orgId);

        if (!knowledge) {
          return { success: false, error: '知识不存在或无权删除' };
        }

        // 删除知识（级联删除关联的标签和搜索索引）
        db.prepare('DELETE FROM knowledge_items WHERE id = ?').run(knowledgeId);

        return { success: true };
      } catch (error) {
        console.error('[Main] 删除组织知识失败:', error);
        return { success: false, error: error.message };
      }
    });

    // 获取标签列表
    ipcMain.handle('knowledge:get-tags', async (_event) => {
      try {
        const db = this.dbManager.db;
        const tags = db.prepare('SELECT * FROM tags ORDER BY name').all();
        return { success: true, tags };
      } catch (error) {
        console.error('[Main] 获取标签列表失败:', error);
        return { success: false, error: error.message, tags: [] };
      }
    });

    // 获取版本历史
    ipcMain.handle('knowledge:get-version-history', async (_event, params) => {
      try {
        const { knowledgeId, limit = 50 } = params;

        if (!this.versionManager) {
          return { success: false, error: '版本管理器未初始化', versions: [] };
        }

        // 使用版本管理器获取完整版本历史
        const versions = this.versionManager.getVersionHistory(knowledgeId, limit);

        // 获取版本统计信息
        const stats = this.versionManager.getVersionStats(knowledgeId);

        return { success: true, versions, stats };
      } catch (error) {
        console.error('[Main] 获取版本历史失败:', error);
        return { success: false, error: error.message, versions: [] };
      }
    });

    // 恢复版本
    ipcMain.handle('knowledge:restore-version', async (_event, params) => {
      try {
        const { knowledgeId, versionId, restoredBy } = params;

        if (!this.versionManager) {
          return { success: false, error: '版本管理器未初始化' };
        }

        // 使用版本管理器恢复版本
        const result = await this.versionManager.restoreVersion(
          knowledgeId,
          versionId,
          restoredBy
        );

        return result;
      } catch (error) {
        console.error('[Main] 恢复版本失败:', error);
        return { success: false, error: error.message };
      }
    });

    // 对比版本
    ipcMain.handle('knowledge:compare-versions', async (_event, params) => {
      try {
        const { versionId1, versionId2 } = params;

        if (!this.versionManager) {
          return { success: false, error: '版本管理器未初始化' };
        }

        // 使用版本管理器对比版本
        const result = this.versionManager.compareVersions(versionId1, versionId2);

        return result;
      } catch (error) {
        console.error('[Main] 对比版本失败:', error);
        return { success: false, error: error.message };
      }
    });

    // ============================
    // P2P同步引擎相关 IPC Handler
    // ============================

    // 启动自动同步
    ipcMain.handle('sync:start-auto-sync', async (_event, orgId) => {
      try {
        if (!this.syncEngine) {
          throw new Error('同步引擎未初始化');
        }

        this.syncEngine.startAutoSync(orgId);
        return { success: true };
      } catch (error) {
        console.error('[Main] 启动自动同步失败:', error);
        throw error;
      }
    });

    // 停止自动同步
    ipcMain.handle('sync:stop-auto-sync', async (_event) => {
      try {
        if (!this.syncEngine) {
          throw new Error('同步引擎未初始化');
        }

        this.syncEngine.stopAutoSync();
        return { success: true };
      } catch (error) {
        console.error('[Main] 停止自动同步失败:', error);
        throw error;
      }
    });

    // 手动同步
    ipcMain.handle('sync:sync-now', async (_event, orgId, options) => {
      try {
        if (!this.syncEngine) {
          throw new Error('同步引擎未初始化');
        }

        const result = await this.syncEngine.sync(orgId, options);
        return result;
      } catch (error) {
        console.error('[Main] 手动同步失败:', error);
        throw error;
      }
    });

    // 获取同步统计
    ipcMain.handle('sync:get-stats', async (_event, orgId) => {
      try {
        if (!this.syncEngine) {
          throw new Error('同步引擎未初始化');
        }

        const stats = this.syncEngine.getSyncStats(orgId);
        return stats;
      } catch (error) {
        console.error('[Main] 获取同步统计失败:', error);
        throw error;
      }
    });

    // 获取未解决冲突列表
    ipcMain.handle('sync:get-conflicts', async (_event, orgId) => {
      try {
        if (!this.syncEngine) {
          return [];
        }

        const conflicts = this.database.prepare(`
          SELECT * FROM sync_conflicts
          WHERE org_id = ? AND resolved = 0
          ORDER BY created_at DESC
          LIMIT 100
        `).all(orgId);

        return conflicts.map(c => ({
          ...c,
          local_data: JSON.parse(c.local_data || '{}'),
          remote_data: JSON.parse(c.remote_data || '{}'),
          local_vector_clock: JSON.parse(c.local_vector_clock || '{}'),
          remote_vector_clock: JSON.parse(c.remote_vector_clock || '{}')
        }));
      } catch (error) {
        console.error('[Main] 获取冲突列表失败:', error);
        return [];
      }
    });

    // 手动解决冲突
    ipcMain.handle('sync:resolve-conflict', async (_event, conflictId, resolution) => {
      try {
        if (!this.syncEngine) {
          throw new Error('同步引擎未初始化');
        }

        // 获取冲突详情
        const conflict = this.database.prepare(`
          SELECT * FROM sync_conflicts WHERE id = ?
        `).get(conflictId);

        if (!conflict) {
          throw new Error('冲突不存在');
        }

        // 根据解决方案应用变更
        const { strategy, data } = resolution;

        if (strategy === 'local_wins') {
          // 保持本地，不做任何操作
        } else if (strategy === 'remote_wins') {
          // 应用远程数据
          const remoteData = JSON.parse(conflict.remote_data);
          await this.syncEngine.applyResourceChange(
            conflict.resource_type,
            conflict.resource_id,
            'update',
            remoteData
          );
        } else if (strategy === 'manual') {
          // 应用手动合并的数据
          await this.syncEngine.applyResourceChange(
            conflict.resource_type,
            conflict.resource_id,
            'update',
            data
          );
        }

        // 获取当前用户DID
        const currentIdentity = await this.didManager.getDefaultIdentity();

        // 更新冲突状态
        this.database.run(`
          UPDATE sync_conflicts
          SET resolution_strategy = ?,
              resolved = 1,
              resolved_at = ?,
              resolved_by_did = ?
          WHERE id = ?
        `, [strategy, Date.now(), currentIdentity.did, conflictId]);

        // 更新同步状态
        this.syncEngine.updateSyncState(
          conflict.org_id,
          conflict.resource_type,
          conflict.resource_id,
          {
            sync_status: 'synced',
            last_synced_at: Date.now()
          }
        );

        return { success: true };
      } catch (error) {
        console.error('[Main] 解决冲突失败:', error);
        throw error;
      }
    });

    // 添加到离线队列
    ipcMain.handle('sync:add-to-queue', async (_event, orgId, action, resourceType, resourceId, data) => {
      try {
        if (!this.syncEngine) {
          throw new Error('同步引擎未初始化');
        }

        const queueId = this.syncEngine.addToQueue(orgId, action, resourceType, resourceId, data);
        return { success: true, queueId };
      } catch (error) {
        console.error('[Main] 添加到离线队列失败:', error);
        throw error;
      }
    });

    // 联系人管理
    ipcMain.handle('contact:add', async (_event, contact) => {
      try {
        if (!this.contactManager) {
          throw new Error('联系人管理器未初始化');
        }

        return await this.contactManager.addContact(contact);
      } catch (error) {
        console.error('[Main] 添加联系人失败:', error);
        throw error;
      }
    });

    ipcMain.handle('contact:add-from-qr', async (_event, qrData) => {
      try {
        if (!this.contactManager) {
          throw new Error('联系人管理器未初始化');
        }

        return await this.contactManager.addContactFromQR(qrData);
      } catch (error) {
        console.error('[Main] 从二维码添加联系人失败:', error);
        throw error;
      }
    });

    ipcMain.handle('contact:get-all', async () => {
      try {
        if (!this.contactManager) {
          return [];
        }

        return this.contactManager.getAllContacts();
      } catch (error) {
        console.error('[Main] 获取联系人列表失败:', error);
        return [];
      }
    });

    ipcMain.handle('contact:get', async (_event, did) => {
      try {
        if (!this.contactManager) {
          return null;
        }

        return this.contactManager.getContactByDID(did);
      } catch (error) {
        console.error('[Main] 获取联系人失败:', error);
        return null;
      }
    });

    ipcMain.handle('contact:update', async (_event, did, updates) => {
      try {
        if (!this.contactManager) {
          throw new Error('联系人管理器未初始化');
        }

        return await this.contactManager.updateContact(did, updates);
      } catch (error) {
        console.error('[Main] 更新联系人失败:', error);
        throw error;
      }
    });

    ipcMain.handle('contact:delete', async (_event, did) => {
      try {
        if (!this.contactManager) {
          throw new Error('联系人管理器未初始化');
        }

        return await this.contactManager.deleteContact(did);
      } catch (error) {
        console.error('[Main] 删除联系人失败:', error);
        throw error;
      }
    });

    ipcMain.handle('contact:search', async (_event, query) => {
      try {
        if (!this.contactManager) {
          return [];
        }

        return this.contactManager.searchContacts(query);
      } catch (error) {
        console.error('[Main] 搜索联系人失败:', error);
        return [];
      }
    });

    ipcMain.handle('contact:get-friends', async () => {
      try {
        if (!this.contactManager) {
          return [];
        }

        return this.contactManager.getFriends();
      } catch (error) {
        console.error('[Main] 获取好友列表失败:', error);
        return [];
      }
    });

    ipcMain.handle('contact:get-statistics', async () => {
      try {
        if (!this.contactManager) {
          return { total: 0, friends: 0, byRelationship: {} };
        }

        return this.contactManager.getStatistics();
      } catch (error) {
        console.error('[Main] 获取统计信息失败:', error);
        return { total: 0, friends: 0, byRelationship: {} };
      }
    });

    // 好友管理
    ipcMain.handle('friend:send-request', async (_event, targetDid, message) => {
      try {
        if (!this.friendManager) {
          throw new Error('好友管理器未初始化');
        }

        return await this.friendManager.sendFriendRequest(targetDid, message);
      } catch (error) {
        console.error('[Main] 发送好友请求失败:', error);
        throw error;
      }
    });

    ipcMain.handle('friend:accept-request', async (_event, requestId) => {
      try {
        if (!this.friendManager) {
          throw new Error('好友管理器未初始化');
        }

        return await this.friendManager.acceptFriendRequest(requestId);
      } catch (error) {
        console.error('[Main] 接受好友请求失败:', error);
        throw error;
      }
    });

    ipcMain.handle('friend:reject-request', async (_event, requestId) => {
      try {
        if (!this.friendManager) {
          throw new Error('好友管理器未初始化');
        }

        return await this.friendManager.rejectFriendRequest(requestId);
      } catch (error) {
        console.error('[Main] 拒绝好友请求失败:', error);
        throw error;
      }
    });

    ipcMain.handle('friend:get-pending-requests', async () => {
      try {
        if (!this.friendManager) {
          return [];
        }

        return await this.friendManager.getPendingFriendRequests();
      } catch (error) {
        console.error('[Main] 获取待处理好友请求失败:', error);
        return [];
      }
    });

    ipcMain.handle('friend:get-friends', async (_event, groupName) => {
      try {
        if (!this.friendManager) {
          return [];
        }

        return await this.friendManager.getFriends(groupName);
      } catch (error) {
        console.error('[Main] 获取好友列表失败:', error);
        return [];
      }
    });

    ipcMain.handle('friend:remove', async (_event, friendDid) => {
      try {
        if (!this.friendManager) {
          throw new Error('好友管理器未初始化');
        }

        return await this.friendManager.removeFriend(friendDid);
      } catch (error) {
        console.error('[Main] 删除好友失败:', error);
        throw error;
      }
    });

    ipcMain.handle('friend:update-nickname', async (_event, friendDid, nickname) => {
      try {
        if (!this.friendManager) {
          throw new Error('好友管理器未初始化');
        }

        return await this.friendManager.updateFriendNickname(friendDid, nickname);
      } catch (error) {
        console.error('[Main] 更新好友备注失败:', error);
        throw error;
      }
    });

    ipcMain.handle('friend:update-group', async (_event, friendDid, groupName) => {
      try {
        if (!this.friendManager) {
          throw new Error('好友管理器未初始化');
        }

        return await this.friendManager.updateFriendGroup(friendDid, groupName);
      } catch (error) {
        console.error('[Main] 更新好友分组失败:', error);
        throw error;
      }
    });

    ipcMain.handle('friend:get-statistics', async () => {
      try {
        if (!this.friendManager) {
          return { total: 0, online: 0, offline: 0, byGroup: {} };
        }

        return await this.friendManager.getStatistics();
      } catch (error) {
        console.error('[Main] 获取好友统计失败:', error);
        return { total: 0, online: 0, offline: 0, byGroup: {} };
      }
    });

    // ==================== 动态管理 ====================

    // 发布动态
    ipcMain.handle('post:create', async (_event, options) => {
      try {
        if (!this.postManager) {
          throw new Error('动态管理器未初始化');
        }

        return await this.postManager.createPost(options);
      } catch (error) {
        console.error('[Main] 发布动态失败:', error);
        throw error;
      }
    });

    // 获取动态流
    ipcMain.handle('post:get-feed', async (_event, options) => {
      try {
        if (!this.postManager) {
          return [];
        }

        return await this.postManager.getFeed(options);
      } catch (error) {
        console.error('[Main] 获取动态流失败:', error);
        throw error;
      }
    });

    // 获取单条动态
    ipcMain.handle('post:get', async (_event, postId) => {
      try {
        if (!this.postManager) {
          return null;
        }

        return await this.postManager.getPost(postId);
      } catch (error) {
        console.error('[Main] 获取动态失败:', error);
        throw error;
      }
    });

    // 删除动态
    ipcMain.handle('post:delete', async (_event, postId) => {
      try {
        if (!this.postManager) {
          throw new Error('动态管理器未初始化');
        }

        return await this.postManager.deletePost(postId);
      } catch (error) {
        console.error('[Main] 删除动态失败:', error);
        throw error;
      }
    });

    // 点赞动态
    ipcMain.handle('post:like', async (_event, postId) => {
      try {
        if (!this.postManager) {
          throw new Error('动态管理器未初始化');
        }

        return await this.postManager.likePost(postId);
      } catch (error) {
        console.error('[Main] 点赞失败:', error);
        throw error;
      }
    });

    // 取消点赞
    ipcMain.handle('post:unlike', async (_event, postId) => {
      try {
        if (!this.postManager) {
          throw new Error('动态管理器未初始化');
        }

        return await this.postManager.unlikePost(postId);
      } catch (error) {
        console.error('[Main] 取消点赞失败:', error);
        throw error;
      }
    });

    // 获取点赞列表
    ipcMain.handle('post:get-likes', async (_event, postId) => {
      try {
        if (!this.postManager) {
          return [];
        }

        return await this.postManager.getLikes(postId);
      } catch (error) {
        console.error('[Main] 获取点赞列表失败:', error);
        throw error;
      }
    });

    // 添加评论
    ipcMain.handle('post:add-comment', async (_event, postId, content, parentId) => {
      try {
        if (!this.postManager) {
          throw new Error('动态管理器未初始化');
        }

        return await this.postManager.addComment(postId, content, parentId);
      } catch (error) {
        console.error('[Main] 添加评论失败:', error);
        throw error;
      }
    });

    // 获取评论列表
    ipcMain.handle('post:get-comments', async (_event, postId) => {
      try {
        if (!this.postManager) {
          return [];
        }

        return await this.postManager.getComments(postId);
      } catch (error) {
        console.error('[Main] 获取评论列表失败:', error);
        throw error;
      }
    });

    // 删除评论
    ipcMain.handle('post:delete-comment', async (_event, commentId) => {
      try {
        if (!this.postManager) {
          throw new Error('动态管理器未初始化');
        }

        return await this.postManager.deleteComment(commentId);
      } catch (error) {
        console.error('[Main] 删除评论失败:', error);
        throw error;
      }
    });

    // ==================== 聊天会话管理 ====================

    // 获取聊天会话列表
    ipcMain.handle('chat:get-sessions', async () => {
      try {
        if (!this.database || !this.database.db) {
          throw new Error('数据库未初始化');
        }
        const sessions = this.database.db
          .prepare('SELECT * FROM chat_sessions ORDER BY updated_at DESC')
          .all();
        return sessions;
      } catch (error) {
        console.error('[Main] 获取聊天会话列表失败:', error);
        throw error;
      }
    });

    // 获取聊天消息
    ipcMain.handle('chat:get-messages', async (_event, sessionId, limit = 50, offset = 0) => {
      try {
        if (!this.database || !this.database.db) {
          throw new Error('数据库未初始化');
        }
        const messages = this.database.db
          .prepare(
            'SELECT * FROM p2p_chat_messages WHERE session_id = ? ORDER BY timestamp DESC LIMIT ? OFFSET ?'
          )
          .all(sessionId, limit, offset);
        return messages;
      } catch (error) {
        console.error('[Main] 获取聊天消息失败:', error);
        throw error;
      }
    });

    // 保存消息
    ipcMain.handle('chat:save-message', async (_event, message) => {
      try {
        if (!this.database || !this.database.db) {
          throw new Error('数据库未初始化');
        }

        // 保存消息
        this.database.db.prepare(`
          INSERT INTO p2p_chat_messages (
            id, session_id, sender_did, receiver_did, content,
            message_type, file_path, encrypted, status, device_id, timestamp
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          message.id,
          message.sessionId,
          message.senderDid,
          message.receiverDid,
          message.content,
          message.messageType || 'text',
          message.filePath || null,
          message.encrypted !== undefined ? message.encrypted : 1,
          message.status || 'sent',
          message.deviceId || null,
          message.timestamp || Date.now()
        );

        // 更新会话
        const session = this.database.db
          .prepare('SELECT * FROM chat_sessions WHERE id = ?')
          .get(message.sessionId);

        if (session) {
          this.database.db.prepare(`
            UPDATE chat_sessions
            SET last_message = ?, last_message_time = ?, updated_at = ?
            WHERE id = ?
          `).run(
            message.content,
            message.timestamp || Date.now(),
            Date.now(),
            message.sessionId
          );
        } else {
          // 创建新会话
          db.prepare(`
            INSERT INTO chat_sessions (
              id, participant_did, friend_nickname, last_message,
              last_message_time, unread_count, is_pinned, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            message.sessionId,
            message.senderDid === message.receiverDid ? message.senderDid : message.receiverDid,
            null,
            message.content,
            message.timestamp || Date.now(),
            0,
            0,
            Date.now(),
            Date.now()
          );
        }

        this.database.saveToFile();
        return { success: true };
      } catch (error) {
        console.error('[Main] 保存消息失败:', error);
        throw error;
      }
    });

    // 更新消息状态
    ipcMain.handle('chat:update-message-status', async (_event, messageId, status) => {
      try {
        if (!this.database || !this.database.db) {
          throw new Error('数据库未初始化');
        }
        this.database.db.prepare('UPDATE p2p_chat_messages SET status = ? WHERE id = ?').run(status, messageId);
        this.database.saveToFile();
        return { success: true };
      } catch (error) {
        console.error('[Main] 更新消息状态失败:', error);
        throw error;
      }
    });

    // 标记会话为已读
    ipcMain.handle('chat:mark-as-read', async (_event, sessionId) => {
      try {
        if (!this.database || !this.database.db) {
          throw new Error('数据库未初始化');
        }
        this.database.db.prepare('UPDATE chat_sessions SET unread_count = 0 WHERE id = ?').run(sessionId);
        this.database.saveToFile();
        return { success: true };
      } catch (error) {
        console.error('[Main] 标记已读失败:', error);
        throw error;
      }
    });

    // ==================== 通知管理 ====================

    // 获取所有通知
    ipcMain.handle('notification:get-all', async (_event, limit = 50) => {
      try {
        if (!this.database || !this.database.db) {
          throw new Error('数据库未初始化');
        }
        const notifications = this.database.db
          .prepare('SELECT * FROM notifications ORDER BY created_at DESC LIMIT ?')
          .all(limit);
        return notifications;
      } catch (error) {
        console.error('[Main] 获取通知失败:', error);
        throw error;
      }
    });

    // 标记通知为已读
    ipcMain.handle('notification:mark-read', async (_event, id) => {
      try {
        if (!this.database || !this.database.db) {
          throw new Error('数据库未初始化');
        }
        this.database.db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ?').run(id);
        this.database.saveToFile();
        return { success: true };
      } catch (error) {
        console.error('[Main] 标记通知已读失败:', error);
        throw error;
      }
    });

    // 全部标记为已读
    ipcMain.handle('notification:mark-all-read', async () => {
      try {
        if (!this.database || !this.database.db) {
          throw new Error('数据库未初始化');
        }
        this.database.db.prepare('UPDATE notifications SET is_read = 1').run();
        this.database.saveToFile();
        return { success: true };
      } catch (error) {
        console.error('[Main] 全部标记已读失败:', error);
        throw error;
      }
    });

    // 获取未读通知数量
    ipcMain.handle('notification:get-unread-count', async () => {
      try {
        if (!this.database || !this.database.db) {
          throw new Error('数据库未初始化');
        }
        const result = this.database.db
          .prepare('SELECT COUNT(*) as count FROM notifications WHERE is_read = 0')
          .get();
        return result.count || 0;
      } catch (error) {
        console.error('[Main] 获取未读数量失败:', error);
        throw error;
      }
    });

    // 发送桌面通知
    ipcMain.handle('notification:send-desktop', async (_event, title, body) => {
      try {
        const { Notification } = require('electron');

        if (Notification.isSupported()) {
          const notification = new Notification({
            title: title,
            body: body,
            icon: path.join(__dirname, '../../resources/icon.png'), // 确保有icon文件
          });

          notification.show();
        }

        return { success: true };
      } catch (error) {
        console.error('[Main] 发送桌面通知失败:', error);
        // 不抛出错误，允许通知失败时应用继续运行
        return { success: false, error: error.message };
      }
    });

    // ==================== 区块链钱包管理 ====================

    // 创建钱包
    ipcMain.handle('wallet:create', async (_event, { password, chainId = 1 }) => {
      try {
        if (!this.walletManager) {
          throw new Error('钱包管理器未初始化');
        }

        return await this.walletManager.createWallet(password, chainId);
      } catch (error) {
        console.error('[Main] 创建钱包失败:', error);
        throw error;
      }
    });

    // 从助记词导入钱包
    ipcMain.handle('wallet:import-mnemonic', async (_event, { mnemonic, password, chainId = 1 }) => {
      try {
        if (!this.walletManager) {
          throw new Error('钱包管理器未初始化');
        }

        return await this.walletManager.importFromMnemonic(mnemonic, password, chainId);
      } catch (error) {
        console.error('[Main] 导入钱包失败:', error);
        throw error;
      }
    });

    // 从私钥导入钱包
    ipcMain.handle('wallet:import-private-key', async (_event, { privateKey, password, chainId = 1 }) => {
      try {
        if (!this.walletManager) {
          throw new Error('钱包管理器未初始化');
        }

        return await this.walletManager.importFromPrivateKey(privateKey, password, chainId);
      } catch (error) {
        console.error('[Main] 从私钥导入钱包失败:', error);
        throw error;
      }
    });

    // 解锁钱包
    ipcMain.handle('wallet:unlock', async (_event, { walletId, password }) => {
      try {
        if (!this.walletManager) {
          throw new Error('钱包管理器未初始化');
        }

        const wallet = await this.walletManager.unlockWallet(walletId, password);
        return { address: wallet.address };
      } catch (error) {
        console.error('[Main] 解锁钱包失败:', error);
        throw error;
      }
    });

    // 锁定钱包
    ipcMain.handle('wallet:lock', async (_event, { walletId }) => {
      try {
        if (!this.walletManager) {
          throw new Error('钱包管理器未初始化');
        }

        this.walletManager.lockWallet(walletId);
        return { success: true };
      } catch (error) {
        console.error('[Main] 锁定钱包失败:', error);
        throw error;
      }
    });

    // 签名交易
    ipcMain.handle('wallet:sign-transaction', async (_event, { walletId, transaction, useUKey = false }) => {
      try {
        if (!this.walletManager) {
          throw new Error('钱包管理器未初始化');
        }

        return await this.walletManager.signTransaction(walletId, transaction, useUKey);
      } catch (error) {
        console.error('[Main] 签名交易失败:', error);
        throw error;
      }
    });

    // 签名消息
    ipcMain.handle('wallet:sign-message', async (_event, { walletId, message, useUKey = false }) => {
      try {
        if (!this.walletManager) {
          throw new Error('钱包管理器未初始化');
        }

        return await this.walletManager.signMessage(walletId, message, useUKey);
      } catch (error) {
        console.error('[Main] 签名消息失败:', error);
        throw error;
      }
    });

    // 获取余额
    ipcMain.handle('wallet:get-balance', async (_event, { address, chainId, tokenAddress = null }) => {
      try {
        if (!this.walletManager) {
          throw new Error('钱包管理器未初始化');
        }

        return await this.walletManager.getBalance(address, chainId, tokenAddress);
      } catch (error) {
        console.error('[Main] 获取余额失败:', error);
        throw error;
      }
    });

    // 获取所有钱包
    ipcMain.handle('wallet:get-all', async () => {
      try {
        if (!this.walletManager) {
          throw new Error('钱包管理器未初始化');
        }

        return await this.walletManager.getAllWallets();
      } catch (error) {
        console.error('[Main] 获取钱包列表失败:', error);
        throw error;
      }
    });

    // 获取钱包详情
    ipcMain.handle('wallet:get', async (_event, { walletId }) => {
      try {
        if (!this.walletManager) {
          throw new Error('钱包管理器未初始化');
        }

        return await this.walletManager.getWallet(walletId);
      } catch (error) {
        console.error('[Main] 获取钱包详情失败:', error);
        throw error;
      }
    });

    // 设置默认钱包
    ipcMain.handle('wallet:set-default', async (_event, { walletId }) => {
      try {
        if (!this.walletManager) {
          throw new Error('钱包管理器未初始化');
        }

        await this.walletManager.setDefaultWallet(walletId);
        return { success: true };
      } catch (error) {
        console.error('[Main] 设置默认钱包失败:', error);
        throw error;
      }
    });

    // 删除钱包
    ipcMain.handle('wallet:delete', async (_event, { walletId }) => {
      try {
        if (!this.walletManager) {
          throw new Error('钱包管理器未初始化');
        }

        await this.walletManager.deleteWallet(walletId);
        return { success: true };
      } catch (error) {
        console.error('[Main] 删除钱包失败:', error);
        throw error;
      }
    });

    // 导出私钥
    ipcMain.handle('wallet:export-private-key', async (_event, { walletId, password }) => {
      try {
        if (!this.walletManager) {
          throw new Error('钱包管理器未初始化');
        }

        return await this.walletManager.exportPrivateKey(walletId, password);
      } catch (error) {
        console.error('[Main] 导出私钥失败:', error);
        throw error;
      }
    });

    // 导出助记词
    ipcMain.handle('wallet:export-mnemonic', async (_event, { walletId, password }) => {
      try {
        if (!this.walletManager) {
          throw new Error('钱包管理器未初始化');
        }

        return await this.walletManager.exportMnemonic(walletId, password);
      } catch (error) {
        console.error('[Main] 导出助记词失败:', error);
        throw error;
      }
    });

    // 保存外部钱包
    ipcMain.handle('wallet:save-external', async (_event, { address, provider, chainId }) => {
      try {
        if (!this.externalWalletConnector) {
          throw new Error('外部钱包连接器未初始化');
        }

        await this.externalWalletConnector._saveExternalWallet({ address, provider, chainId });
        return { success: true };
      } catch (error) {
        console.error('[Main] 保存外部钱包失败:', error);
        throw error;
      }
    });

    // 切换区块链网络
    ipcMain.handle('blockchain:switch-chain', async (_event, { chainId }) => {
      try {
        if (!this.blockchainAdapter) {
          throw new Error('区块链适配器未初始化');
        }

        await this.blockchainAdapter.switchChain(chainId);
        return { success: true };
      } catch (error) {
        console.error('[Main] 切换网络失败:', error);
        throw error;
      }
    });

    // 获取交易历史
    ipcMain.handle('blockchain:get-tx-history', async (_event, { address, chainId, limit = 100, offset = 0 }) => {
      try {
        if (!this.transactionMonitor) {
          throw new Error('交易监控器未初始化');
        }

        return await this.transactionMonitor.getTxHistory({ address, chainId, limit, offset });
      } catch (error) {
        console.error('[Main] 获取交易历史失败:', error);
        throw error;
      }
    });

    // 获取交易详情
    ipcMain.handle('blockchain:get-transaction', async (_event, { txHash }) => {
      try {
        if (!this.transactionMonitor) {
          throw new Error('交易监控器未初始化');
        }

        return await this.transactionMonitor.getTxDetail(txHash);
      } catch (error) {
        console.error('[Main] 获取交易详情失败:', error);
        throw error;
      }
    });

    // 部署 ERC-20 代币
    ipcMain.handle('blockchain:deploy-token', async (_event, options) => {
      try {
        if (!this.blockchainAdapter) {
          throw new Error('区块链适配器未初始化');
        }

        const { walletId, name, symbol, decimals, initialSupply, chainId } = options;
        return await this.blockchainAdapter.deployERC20Token(walletId, {
          name,
          symbol,
          decimals,
          initialSupply,
          chainId,
        });
      } catch (error) {
        console.error('[Main] 部署 ERC-20 代币失败:', error);
        throw error;
      }
    });

    // 部署 NFT
    ipcMain.handle('blockchain:deploy-nft', async (_event, options) => {
      try {
        if (!this.blockchainAdapter) {
          throw new Error('区块链适配器未初始化');
        }

        const { walletId, name, symbol, chainId } = options;
        return await this.blockchainAdapter.deployNFT(walletId, {
          name,
          symbol,
          chainId,
        });
      } catch (error) {
        console.error('[Main] 部署 NFT 失败:', error);
        throw error;
      }
    });

    // 铸造 NFT
    ipcMain.handle('blockchain:mint-nft', async (_event, options) => {
      try {
        if (!this.blockchainAdapter) {
          throw new Error('区块链适配器未初始化');
        }

        const { walletId, contractAddress, to, metadataURI, chainId } = options;
        return await this.blockchainAdapter.mintNFT(walletId, contractAddress, to, metadataURI, chainId);
      } catch (error) {
        console.error('[Main] 铸造 NFT 失败:', error);
        throw error;
      }
    });

    // 转账代币
    ipcMain.handle('blockchain:transfer-token', async (_event, options) => {
      try {
        if (!this.blockchainAdapter) {
          throw new Error('区块链适配器未初始化');
        }

        const { walletId, tokenAddress, to, amount, chainId } = options;
        return await this.blockchainAdapter.transferToken(walletId, tokenAddress, to, amount, chainId);
      } catch (error) {
        console.error('[Main] 转账代币失败:', error);
        throw error;
      }
    });

    // 获取 Gas 价格
    ipcMain.handle('blockchain:get-gas-price', async (_event, { chainId }) => {
      try {
        if (!this.blockchainAdapter) {
          throw new Error('区块链适配器未初始化');
        }

        return await this.blockchainAdapter.getGasPrice(chainId);
      } catch (error) {
        console.error('[Main] 获取 Gas 价格失败:', error);
        throw error;
      }
    });

    // 估算 Gas
    ipcMain.handle('blockchain:estimate-gas', async (_event, { transaction, chainId }) => {
      try {
        if (!this.blockchainAdapter) {
          throw new Error('区块链适配器未初始化');
        }

        return await this.blockchainAdapter.estimateGas(transaction, chainId);
      } catch (error) {
        console.error('[Main] 估算 Gas 失败:', error);
        throw error;
      }
    });

    // 获取区块信息
    ipcMain.handle('blockchain:get-block', async (_event, { blockNumber, chainId }) => {
      try {
        if (!this.blockchainAdapter) {
          throw new Error('区块链适配器未初始化');
        }

        return await this.blockchainAdapter.getBlock(blockNumber, chainId);
      } catch (error) {
        console.error('[Main] 获取区块信息失败:', error);
        throw error;
      }
    });

    // 获取当前区块号
    ipcMain.handle('blockchain:get-block-number', async (_event, { chainId }) => {
      try {
        if (!this.blockchainAdapter) {
          throw new Error('区块链适配器未初始化');
        }

        return await this.blockchainAdapter.getBlockNumber(chainId);
      } catch (error) {
        console.error('[Main] 获取区块号失败:', error);
        throw error;
      }
    });

    // 监听合约事件
    ipcMain.handle('blockchain:listen-events', async (_event, { contractAddress, eventName, abi, chainId }) => {
      try {
        if (!this.blockchainAdapter) {
          throw new Error('区块链适配器未初始化');
        }

        await this.blockchainAdapter.listenToEvents(contractAddress, eventName, abi, chainId, (event) => {
          // 发送事件到渲染进程
          if (this.mainWindow) {
            this.mainWindow.webContents.send('blockchain:event', {
              contractAddress,
              eventName,
              data: event,
            });
          }
        });

        return { success: true };
      } catch (error) {
        console.error('[Main] 监听合约事件失败:', error);
        throw error;
      }
    });

    // 获取合约部署记录
    ipcMain.handle('blockchain:get-deployed-contracts', async (_event, { chainId = null }) => {
      try {
        return new Promise((resolve, reject) => {
          let sql = 'SELECT * FROM deployed_contracts WHERE 1=1';
          const params = [];

          if (chainId !== null) {
            sql += ' AND chain_id = ?';
            params.push(chainId);
          }

          sql += ' ORDER BY deployed_at DESC';

          this.database.all(sql, params, (err, rows) => {
            if (err) {
              reject(err);
            } else {
              resolve(rows || []);
            }
          });
        });
      } catch (error) {
        console.error('[Main] 获取合约部署记录失败:', error);
        throw error;
      }
    });

    // 获取链上资产
    ipcMain.handle('blockchain:get-deployed-assets', async (_event, { chainId = null }) => {
      try {
        return new Promise((resolve, reject) => {
          let sql = 'SELECT * FROM blockchain_assets WHERE 1=1';
          const params = [];

          if (chainId !== null) {
            sql += ' AND chain_id = ?';
            params.push(chainId);
          }

          sql += ' ORDER BY deployed_at DESC';

          this.database.all(sql, params, (err, rows) => {
            if (err) {
              reject(err);
            } else {
              resolve(rows || []);
            }
          });
        });
      } catch (error) {
        console.error('[Main] 获取链上资产失败:', error);
        throw error;
      }
    });

    // ==================== 跨链桥 ====================

    // 桥接资产
    ipcMain.handle('bridge:transfer', async (_event, options) => {
      try {
        if (!this.bridgeManager) {
          throw new Error('跨链桥管理器未初始化');
        }

        return await this.bridgeManager.bridgeAsset(options);
      } catch (error) {
        console.error('[Main] 桥接资产失败:', error);
        throw error;
      }
    });

    // 获取桥接历史
    ipcMain.handle('bridge:get-history', async (_event, filters = {}) => {
      try {
        if (!this.bridgeManager) {
          throw new Error('跨链桥管理器未初始化');
        }

        return await this.bridgeManager.getBridgeHistory(filters);
      } catch (error) {
        console.error('[Main] 获取桥接历史失败:', error);
        throw error;
      }
    });

    // 获取桥接记录详情
    ipcMain.handle('bridge:get-record', async (_event, { bridgeId }) => {
      try {
        if (!this.bridgeManager) {
          throw new Error('跨链桥管理器未初始化');
        }

        return await this.bridgeManager.getBridgeRecord(bridgeId);
      } catch (error) {
        console.error('[Main] 获取桥接记录失败:', error);
        throw error;
      }
    });

    // 注册桥接合约
    ipcMain.handle('bridge:register-contract', async (_event, { chainId, contractAddress }) => {
      try {
        if (!this.bridgeManager) {
          throw new Error('跨链桥管理器未初始化');
        }

        this.bridgeManager.registerBridgeContract(chainId, contractAddress);
        return { success: true };
      } catch (error) {
        console.error('[Main] 注册桥接合约失败:', error);
        throw error;
      }
    });

    // 查询资产余额
    ipcMain.handle('bridge:get-balance', async (_event, { address, tokenAddress, chainId }) => {
      try {
        if (!this.bridgeManager) {
          throw new Error('跨链桥管理器未初始化');
        }

        return await this.bridgeManager.getAssetBalance(address, tokenAddress, chainId);
      } catch (error) {
        console.error('[Main] 查询资产余额失败:', error);
        throw error;
      }
    });

    // 批量查询余额
    ipcMain.handle('bridge:get-batch-balances', async (_event, { address, assets }) => {
      try {
        if (!this.bridgeManager) {
          throw new Error('跨链桥管理器未初始化');
        }

        return await this.bridgeManager.getBatchBalances(address, assets);
      } catch (error) {
        console.error('[Main] 批量查询余额失败:', error);
        throw error;
      }
    });

    // 查询锁定余额
    ipcMain.handle('bridge:get-locked-balance', async (_event, { tokenAddress, chainId }) => {
      try {
        if (!this.bridgeManager) {
          throw new Error('跨链桥管理器未初始化');
        }

        return await this.bridgeManager.getLockedBalance(tokenAddress, chainId);
      } catch (error) {
        console.error('[Main] 查询锁定余额失败:', error);
        throw error;
      }
    });

    // ==================== 资产管理 ====================

    // 创建资产
    ipcMain.handle('asset:create', async (_event, options) => {
      try {
        if (!this.assetManager) {
          throw new Error('资产管理器未初始化');
        }

        return await this.assetManager.createAsset(options);
      } catch (error) {
        console.error('[Main] 创建资产失败:', error);
        throw error;
      }
    });

    // 铸造资产
    ipcMain.handle('asset:mint', async (_event, assetId, toDid, amount) => {
      try {
        if (!this.assetManager) {
          throw new Error('资产管理器未初始化');
        }

        return await this.assetManager.mintAsset(assetId, toDid, amount);
      } catch (error) {
        console.error('[Main] 铸造资产失败:', error);
        throw error;
      }
    });

    // 转账资产
    ipcMain.handle('asset:transfer', async (_event, assetId, toDid, amount, memo) => {
      try {
        if (!this.assetManager) {
          throw new Error('资产管理器未初始化');
        }

        return await this.assetManager.transferAsset(assetId, toDid, amount, memo);
      } catch (error) {
        console.error('[Main] 转账失败:', error);
        throw error;
      }
    });

    // 销毁资产
    ipcMain.handle('asset:burn', async (_event, assetId, amount) => {
      try {
        if (!this.assetManager) {
          throw new Error('资产管理器未初始化');
        }

        return await this.assetManager.burnAsset(assetId, amount);
      } catch (error) {
        console.error('[Main] 销毁资产失败:', error);
        throw error;
      }
    });

    // 获取资产信息
    ipcMain.handle('asset:get', async (_event, assetId) => {
      try {
        if (!this.assetManager) {
          return null;
        }

        return await this.assetManager.getAsset(assetId);
      } catch (error) {
        console.error('[Main] 获取资产失败:', error);
        throw error;
      }
    });

    // 获取用户资产列表
    ipcMain.handle('asset:get-by-owner', async (_event, ownerDid) => {
      try {
        if (!this.assetManager) {
          return [];
        }

        return await this.assetManager.getAssetsByOwner(ownerDid);
      } catch (error) {
        console.error('[Main] 获取资产列表失败:', error);
        throw error;
      }
    });

    // 获取所有资产
    ipcMain.handle('asset:get-all', async (_event, filters) => {
      try {
        if (!this.assetManager) {
          return [];
        }

        return await this.assetManager.getAllAssets(filters);
      } catch (error) {
        console.error('[Main] 获取所有资产失败:', error);
        throw error;
      }
    });

    // 获取资产历史
    ipcMain.handle('asset:get-history', async (_event, assetId, limit) => {
      try {
        if (!this.assetManager) {
          return [];
        }

        return await this.assetManager.getAssetHistory(assetId, limit);
      } catch (error) {
        console.error('[Main] 获取资产历史失败:', error);
        throw error;
      }
    });

    // 获取余额
    ipcMain.handle('asset:get-balance', async (_event, ownerDid, assetId) => {
      try {
        if (!this.assetManager) {
          return 0;
        }

        return await this.assetManager.getBalance(ownerDid, assetId);
      } catch (error) {
        console.error('[Main] 获取余额失败:', error);
        return 0;
      }
    });

    // 获取资产的区块链部署信息
    ipcMain.handle('asset:get-blockchain-info', async (_event, assetId) => {
      try {
        if (!this.assetManager) {
          return null;
        }

        return await this.assetManager._getBlockchainAsset(assetId);
      } catch (error) {
        console.error('[Main] 获取区块链资产信息失败:', error);
        return null;
      }
    });

    // ==================== 交易市场 ====================

    // 创建订单
    ipcMain.handle('marketplace:create-order', async (_event, options) => {
      try {
        if (!this.marketplaceManager) {
          throw new Error('交易市场管理器未初始化');
        }

        return await this.marketplaceManager.createOrder(options);
      } catch (error) {
        console.error('[Main] 创建订单失败:', error);
        throw error;
      }
    });

    // 取消订单
    ipcMain.handle('marketplace:cancel-order', async (_event, orderId) => {
      try {
        if (!this.marketplaceManager) {
          throw new Error('交易市场管理器未初始化');
        }

        return await this.marketplaceManager.cancelOrder(orderId);
      } catch (error) {
        console.error('[Main] 取消订单失败:', error);
        throw error;
      }
    });

    // 获取订单列表
    ipcMain.handle('marketplace:get-orders', async (_event, filters) => {
      try {
        if (!this.marketplaceManager) {
          return [];
        }

        return await this.marketplaceManager.getOrders(filters);
      } catch (error) {
        console.error('[Main] 获取订单列表失败:', error);
        throw error;
      }
    });

    // 获取订单详情
    ipcMain.handle('marketplace:get-order', async (_event, orderId) => {
      try {
        if (!this.marketplaceManager) {
          return null;
        }

        return await this.marketplaceManager.getOrder(orderId);
      } catch (error) {
        console.error('[Main] 获取订单详情失败:', error);
        throw error;
      }
    });

    // 匹配订单（购买）
    ipcMain.handle('marketplace:match-order', async (_event, orderId, quantity) => {
      try {
        if (!this.marketplaceManager) {
          throw new Error('交易市场管理器未初始化');
        }

        return await this.marketplaceManager.matchOrder(orderId, quantity);
      } catch (error) {
        console.error('[Main] 匹配订单失败:', error);
        throw error;
      }
    });

    // 获取交易列表
    ipcMain.handle('marketplace:get-transactions', async (_event, filters) => {
      try {
        if (!this.marketplaceManager) {
          return [];
        }

        return await this.marketplaceManager.getTransactions(filters);
      } catch (error) {
        console.error('[Main] 获取交易列表失败:', error);
        throw error;
      }
    });

    // 确认交付
    ipcMain.handle('marketplace:confirm-delivery', async (_event, transactionId) => {
      try {
        if (!this.marketplaceManager) {
          throw new Error('交易市场管理器未初始化');
        }

        return await this.marketplaceManager.confirmDelivery(transactionId);
      } catch (error) {
        console.error('[Main] 确认交付失败:', error);
        throw error;
      }
    });

    // 申请退款
    ipcMain.handle('marketplace:request-refund', async (_event, transactionId, reason) => {
      try {
        if (!this.marketplaceManager) {
          throw new Error('交易市场管理器未初始化');
        }

        return await this.marketplaceManager.requestRefund(transactionId, reason);
      } catch (error) {
        console.error('[Main] 申请退款失败:', error);
        throw error;
      }
    });

    // 获取我的订单
    ipcMain.handle('marketplace:get-my-orders', async (_event, userDid) => {
      try {
        if (!this.marketplaceManager) {
          return { createdOrders: [], purchasedOrders: [] };
        }

        return await this.marketplaceManager.getMyOrders(userDid);
      } catch (error) {
        console.error('[Main] 获取我的订单失败:', error);
        throw error;
      }
    });

    // ==================== 托管管理 ====================

    // 获取托管详情
    ipcMain.handle('escrow:get', async (_event, escrowId) => {
      try {
        if (!this.escrowManager) {
          return null;
        }

        return await this.escrowManager.getEscrow(escrowId);
      } catch (error) {
        console.error('[Main] 获取托管详情失败:', error);
        throw error;
      }
    });

    // 获取托管列表
    ipcMain.handle('escrow:get-list', async (_event, filters) => {
      try {
        if (!this.escrowManager) {
          return [];
        }

        return await this.escrowManager.getEscrows(filters);
      } catch (error) {
        console.error('[Main] 获取托管列表失败:', error);
        throw error;
      }
    });

    // 获取托管历史
    ipcMain.handle('escrow:get-history', async (_event, escrowId) => {
      try {
        if (!this.escrowManager) {
          return [];
        }

        return await this.escrowManager.getEscrowHistory(escrowId);
      } catch (error) {
        console.error('[Main] 获取托管历史失败:', error);
        throw error;
      }
    });

    // 发起争议
    ipcMain.handle('escrow:dispute', async (_event, escrowId, reason) => {
      try {
        if (!this.escrowManager) {
          throw new Error('托管管理器未初始化');
        }

        return await this.escrowManager.disputeEscrow(escrowId, reason);
      } catch (error) {
        console.error('[Main] 发起争议失败:', error);
        throw error;
      }
    });

    // 获取托管统计信息
    ipcMain.handle('escrow:get-statistics', async () => {
      try {
        if (!this.escrowManager) {
          return { total: 0, locked: 0, released: 0, refunded: 0, disputed: 0 };
        }

        return await this.escrowManager.getStatistics();
      } catch (error) {
        console.error('[Main] 获取托管统计信息失败:', error);
        throw error;
      }
    });

    // ==================== 智能合约 ====================

    // 创建合约
    ipcMain.handle('contract:create', async (_event, options) => {
      try {
        if (!this.contractEngine) {
          throw new Error('智能合约引擎未初始化');
        }

        return await this.contractEngine.createContract(options);
      } catch (error) {
        console.error('[Main] 创建合约失败:', error);
        throw error;
      }
    });

    // 激活合约
    ipcMain.handle('contract:activate', async (_event, contractId) => {
      try {
        if (!this.contractEngine) {
          throw new Error('智能合约引擎未初始化');
        }

        return await this.contractEngine.activateContract(contractId);
      } catch (error) {
        console.error('[Main] 激活合约失败:', error);
        throw error;
      }
    });

    // 签名合约
    ipcMain.handle('contract:sign', async (_event, contractId, signature) => {
      try {
        if (!this.contractEngine) {
          throw new Error('智能合约引擎未初始化');
        }

        return await this.contractEngine.signContract(contractId, signature);
      } catch (error) {
        console.error('[Main] 签名合约失败:', error);
        throw error;
      }
    });

    // 检查合约条件
    ipcMain.handle('contract:check-conditions', async (_event, contractId) => {
      try {
        if (!this.contractEngine) {
          return { allMet: false, conditions: [] };
        }

        return await this.contractEngine.checkConditions(contractId);
      } catch (error) {
        console.error('[Main] 检查合约条件失败:', error);
        throw error;
      }
    });

    // 执行合约
    ipcMain.handle('contract:execute', async (_event, contractId) => {
      try {
        if (!this.contractEngine) {
          throw new Error('智能合约引擎未初始化');
        }

        return await this.contractEngine.executeContract(contractId);
      } catch (error) {
        console.error('[Main] 执行合约失败:', error);
        throw error;
      }
    });

    // 取消合约
    ipcMain.handle('contract:cancel', async (_event, contractId, reason) => {
      try {
        if (!this.contractEngine) {
          throw new Error('智能合约引擎未初始化');
        }

        return await this.contractEngine.cancelContract(contractId, reason);
      } catch (error) {
        console.error('[Main] 取消合约失败:', error);
        throw error;
      }
    });

    // 获取合约详情
    ipcMain.handle('contract:get', async (_event, contractId) => {
      try {
        if (!this.contractEngine) {
          return null;
        }

        return await this.contractEngine.getContract(contractId);
      } catch (error) {
        console.error('[Main] 获取合约详情失败:', error);
        throw error;
      }
    });

    // 获取合约列表
    ipcMain.handle('contract:get-list', async (_event, filters) => {
      try {
        if (!this.contractEngine) {
          return [];
        }

        return await this.contractEngine.getContracts(filters);
      } catch (error) {
        console.error('[Main] 获取合约列表失败:', error);
        throw error;
      }
    });

    // 获取合约条件
    ipcMain.handle('contract:get-conditions', async (_event, contractId) => {
      try {
        if (!this.contractEngine) {
          return [];
        }

        return await this.contractEngine.getContractConditions(contractId);
      } catch (error) {
        console.error('[Main] 获取合约条件失败:', error);
        throw error;
      }
    });

    // 获取合约事件
    ipcMain.handle('contract:get-events', async (_event, contractId) => {
      try {
        if (!this.contractEngine) {
          return [];
        }

        return await this.contractEngine.getContractEvents(contractId);
      } catch (error) {
        console.error('[Main] 获取合约事件失败:', error);
        throw error;
      }
    });

    // 发起仲裁
    ipcMain.handle('contract:initiate-arbitration', async (_event, contractId, reason, evidence) => {
      try {
        if (!this.contractEngine) {
          throw new Error('智能合约引擎未初始化');
        }

        return await this.contractEngine.initiateArbitration(contractId, reason, evidence);
      } catch (error) {
        console.error('[Main] 发起仲裁失败:', error);
        throw error;
      }
    });

    // 解决仲裁
    ipcMain.handle('contract:resolve-arbitration', async (_event, arbitrationId, resolution) => {
      try {
        if (!this.contractEngine) {
          throw new Error('智能合约引擎未初始化');
        }

        return await this.contractEngine.resolveArbitration(arbitrationId, resolution);
      } catch (error) {
        console.error('[Main] 解决仲裁失败:', error);
        throw error;
      }
    });

    // 获取合约模板列表
    ipcMain.handle('contract:get-templates', async () => {
      try {
        const ContractTemplates = require('./trade/contract-templates');
        return ContractTemplates.getAllTemplates();
      } catch (error) {
        console.error('[Main] 获取合约模板列表失败:', error);
        throw error;
      }
    });

    // 从模板创建合约
    ipcMain.handle('contract:create-from-template', async (_event, templateId, params) => {
      try {
        const ContractTemplates = require('./trade/contract-templates');

        // 验证参数
        const validation = ContractTemplates.validateParams(templateId, params);
        if (!validation.valid) {
          throw new Error(`参数验证失败: ${validation.errors.join(', ')}`);
        }

        // 从模板创建合约
        const contractOptions = ContractTemplates.createFromTemplate(templateId, params);

        // 调用合约引擎创建合约
        if (!this.contractEngine) {
          throw new Error('智能合约引擎未初始化');
        }

        return await this.contractEngine.createContract(contractOptions);
      } catch (error) {
        console.error('[Main] 从模板创建合约失败:', error);
        throw error;
      }
    });

    // 获取合约的区块链部署信息
    ipcMain.handle('contract:get-blockchain-info', async (_event, contractId) => {
      try {
        if (!this.contractEngine) {
          return null;
        }

        return await this.contractEngine._getDeployedContract(contractId);
      } catch (error) {
        console.error('[Main] 获取合约部署信息失败:', error);
        return null;
      }
    });

    // === 知识付费系统 ===
    ipcMain.handle('knowledge:create-content', async (_event, options) => {
      try {
        if (!this.knowledgePaymentManager) {
          throw new Error('知识付费管理器未初始化');
        }
        return await this.knowledgePaymentManager.createPaidContent(options);
      } catch (error) {
        console.error('[Main] 创建付费内容失败:', error);
        throw error;
      }
    });

    ipcMain.handle('knowledge:update-content', async (_event, contentId, updates) => {
      try {
        if (!this.knowledgePaymentManager) {
          throw new Error('知识付费管理器未初始化');
        }
        return await this.knowledgePaymentManager.updateContent(contentId, updates);
      } catch (error) {
        console.error('[Main] 更新内容失败:', error);
        throw error;
      }
    });

    ipcMain.handle('knowledge:delete-content', async (_event, contentId) => {
      try {
        if (!this.knowledgePaymentManager) {
          throw new Error('知识付费管理器未初始化');
        }
        return await this.knowledgePaymentManager.deleteContent(contentId);
      } catch (error) {
        console.error('[Main] 删除内容失败:', error);
        throw error;
      }
    });

    ipcMain.handle('knowledge:get-content', async (_event, contentId) => {
      try {
        if (!this.knowledgePaymentManager) {
          return null;
        }
        return await this.knowledgePaymentManager.getContent(contentId);
      } catch (error) {
        console.error('[Main] 获取内容失败:', error);
        return null;
      }
    });

    ipcMain.handle('knowledge:list-contents', async (_event, filters) => {
      try {
        if (!this.knowledgePaymentManager) {
          return [];
        }
        return await this.knowledgePaymentManager.listContents(filters);
      } catch (error) {
        console.error('[Main] 列出内容失败:', error);
        return [];
      }
    });

    ipcMain.handle('knowledge:purchase-content', async (_event, contentId, paymentAssetId) => {
      try {
        if (!this.knowledgePaymentManager) {
          throw new Error('知识付费管理器未初始化');
        }
        return await this.knowledgePaymentManager.purchaseContent(contentId, paymentAssetId);
      } catch (error) {
        console.error('[Main] 购买内容失败:', error);
        throw error;
      }
    });

    ipcMain.handle('knowledge:subscribe', async (_event, planId, paymentAssetId) => {
      try {
        if (!this.knowledgePaymentManager) {
          throw new Error('知识付费管理器未初始化');
        }
        return await this.knowledgePaymentManager.subscribe(planId, paymentAssetId);
      } catch (error) {
        console.error('[Main] 订阅失败:', error);
        throw error;
      }
    });

    ipcMain.handle('knowledge:unsubscribe', async (_event, planId) => {
      try {
        if (!this.knowledgePaymentManager) {
          throw new Error('知识付费管理器未初始化');
        }
        return await this.knowledgePaymentManager.unsubscribe(planId);
      } catch (error) {
        console.error('[Main] 取消订阅失败:', error);
        throw error;
      }
    });

    ipcMain.handle('knowledge:get-my-purchases', async (_event, userDid) => {
      try {
        if (!this.knowledgePaymentManager) {
          return [];
        }
        return await this.knowledgePaymentManager.getMyPurchases(userDid);
      } catch (error) {
        console.error('[Main] 获取购买记录失败:', error);
        return [];
      }
    });

    ipcMain.handle('knowledge:get-my-subscriptions', async (_event, userDid) => {
      try {
        if (!this.knowledgePaymentManager) {
          return [];
        }
        return await this.knowledgePaymentManager.getMySubscriptions(userDid);
      } catch (error) {
        console.error('[Main] 获取订阅记录失败:', error);
        return [];
      }
    });

    ipcMain.handle('knowledge:access-content', async (_event, contentId) => {
      try {
        if (!this.knowledgePaymentManager) {
          throw new Error('知识付费管理器未初始化');
        }
        return await this.knowledgePaymentManager.accessContent(contentId);
      } catch (error) {
        console.error('[Main] 访问内容失败:', error);
        throw error;
      }
    });

    ipcMain.handle('knowledge:check-access', async (_event, contentId, userDid) => {
      try {
        if (!this.knowledgePaymentManager) {
          return false;
        }
        return await this.knowledgePaymentManager.checkAccess(contentId, userDid);
      } catch (error) {
        console.error('[Main] 检查访问权限失败:', error);
        return false;
      }
    });

    ipcMain.handle('knowledge:get-statistics', async (_event, creatorDid) => {
      try {
        if (!this.knowledgePaymentManager) {
          return null;
        }
        return await this.knowledgePaymentManager.getStatistics(creatorDid);
      } catch (error) {
        console.error('[Main] 获取统计数据失败:', error);
        return null;
      }
    });

    // === 知识图谱系统 ===
    ipcMain.handle('graph:get-graph-data', async (_event, options) => {
      try {
        if (!this.database) {
          return { nodes: [], edges: [] };
        }
        return this.database.getGraphData(options);
      } catch (error) {
        console.error('[Main] 获取图谱数据失败:', error);
        return { nodes: [], edges: [] };
      }
    });

    ipcMain.handle('graph:process-note', async (_event, noteId, content, tags) => {
      try {
        if (!this.graphExtractor) {
          console.warn('[Main] GraphExtractor 未初始化');
          return 0;
        }
        return this.graphExtractor.processNote(noteId, content, tags);
      } catch (error) {
        console.error('[Main] 处理笔记关系失败:', error);
        return 0;
      }
    });

    ipcMain.handle('graph:process-all-notes', async (_event, noteIds) => {
      try {
        if (!this.graphExtractor) {
          console.warn('[Main] GraphExtractor 未初始化');
          return { processed: 0, linkRelations: 0, tagRelations: 0, temporalRelations: 0 };
        }
        return this.graphExtractor.processAllNotes(noteIds);
      } catch (error) {
        console.error('[Main] 批量处理笔记失败:', error);
        return { processed: 0, linkRelations: 0, tagRelations: 0, temporalRelations: 0 };
      }
    });

    ipcMain.handle('graph:get-knowledge-relations', async (_event, knowledgeId) => {
      try {
        if (!this.database) {
          return [];
        }
        return this.database.getKnowledgeRelations(knowledgeId);
      } catch (error) {
        console.error('[Main] 获取笔记关系失败:', error);
        return [];
      }
    });

    ipcMain.handle('graph:find-related-notes', async (_event, sourceId, targetId, maxDepth) => {
      try {
        if (!this.database) {
          return null;
        }
        return this.database.findRelatedNotes(sourceId, targetId, maxDepth);
      } catch (error) {
        console.error('[Main] 查找关联路径失败:', error);
        return null;
      }
    });

    ipcMain.handle('graph:find-potential-links', async (_event, noteId, content) => {
      try {
        if (!this.graphExtractor) {
          return [];
        }
        return this.graphExtractor.findPotentialLinks(noteId, content);
      } catch (error) {
        console.error('[Main] 查找潜在链接失败:', error);
        return [];
      }
    });

    ipcMain.handle('graph:add-relation', async (_event, sourceId, targetId, type, weight, metadata) => {
      try {
        if (!this.database) {
          throw new Error('数据库未初始化');
        }
        return this.database.addRelation(sourceId, targetId, type, weight, metadata);
      } catch (error) {
        console.error('[Main] 添加关系失败:', error);
        throw error;
      }
    });

    ipcMain.handle('graph:delete-relations', async (_event, noteId, types) => {
      try {
        if (!this.database) {
          return 0;
        }
        return this.database.deleteRelations(noteId, types);
      } catch (error) {
        console.error('[Main] 删除关系失败:', error);
        return 0;
      }
    });

    ipcMain.handle('graph:build-tag-relations', async (_event) => {
      try {
        if (!this.database) {
          return 0;
        }
        return this.database.buildTagRelations();
      } catch (error) {
        console.error('[Main] 构建标签关系失败:', error);
        return 0;
      }
    });

    ipcMain.handle('graph:build-temporal-relations', async (_event, windowDays) => {
      try {
        if (!this.database) {
          return 0;
        }
        return this.database.buildTemporalRelations(windowDays);
      } catch (error) {
        console.error('[Main] 构建时间关系失败:', error);
        return 0;
      }
    });

    ipcMain.handle('graph:extract-semantic-relations', async (_event, noteId, content) => {
      try {
        if (!this.graphExtractor || !this.llmManager) {
          console.warn('[Main] GraphExtractor 或 LLMManager 未初始化');
          return [];
        }
        return await this.graphExtractor.extractSemanticRelations(noteId, content, this.llmManager);
      } catch (error) {
        console.error('[Main] 提取语义关系失败:', error);
        return [];
      }
    });

    // === 信用评分系统 ===
    ipcMain.handle('credit:get-user-credit', async (_event, userDid) => {
      try {
        if (!this.creditScoreManager) {
          return null;
        }
        return await this.creditScoreManager.getUserCredit(userDid);
      } catch (error) {
        console.error('[Main] 获取用户信用失败:', error);
        return null;
      }
    });

    ipcMain.handle('credit:update-score', async (_event, userDid) => {
      try {
        if (!this.creditScoreManager) {
          throw new Error('信用评分管理器未初始化');
        }
        return await this.creditScoreManager.calculateScore(userDid);
      } catch (error) {
        console.error('[Main] 更新信用评分失败:', error);
        throw error;
      }
    });

    ipcMain.handle('credit:get-score-history', async (_event, userDid, limit) => {
      try {
        if (!this.creditScoreManager) {
          return [];
        }
        return await this.creditScoreManager.getScoreHistory(userDid, limit);
      } catch (error) {
        console.error('[Main] 获取评分历史失败:', error);
        return [];
      }
    });

    ipcMain.handle('credit:get-credit-level', async (_event, score) => {
      try {
        if (!this.creditScoreManager) {
          return null;
        }
        return await this.creditScoreManager.getCreditLevel(score);
      } catch (error) {
        console.error('[Main] 获取信用等级失败:', error);
        return null;
      }
    });

    ipcMain.handle('credit:get-leaderboard', async (_event, limit) => {
      try {
        if (!this.creditScoreManager) {
          return [];
        }
        return await this.creditScoreManager.getLeaderboard(limit);
      } catch (error) {
        console.error('[Main] 获取排行榜失败:', error);
        return [];
      }
    });

    ipcMain.handle('credit:get-benefits', async (_event, userDid) => {
      try {
        if (!this.creditScoreManager) {
          return [];
        }
        const credit = await this.creditScoreManager.getUserCredit(userDid);
        if (!credit) return [];
        const level = await this.creditScoreManager.getCreditLevel(credit.credit_score);
        return level ? level.benefits : [];
      } catch (error) {
        console.error('[Main] 获取信用权益失败:', error);
        return [];
      }
    });

    ipcMain.handle('credit:get-statistics', async () => {
      try {
        if (!this.creditScoreManager) {
          return null;
        }
        return await this.creditScoreManager.getStatistics();
      } catch (error) {
        console.error('[Main] 获取统计信息失败:', error);
        return null;
      }
    });

    // === 评价反馈系统 ===
    ipcMain.handle('review:create', async (_event, options) => {
      try {
        if (!this.reviewManager) {
          throw new Error('评价管理器未初始化');
        }
        return await this.reviewManager.createReview(options);
      } catch (error) {
        console.error('[Main] 创建评价失败:', error);
        throw error;
      }
    });

    ipcMain.handle('review:update', async (_event, reviewId, updates) => {
      try {
        if (!this.reviewManager) {
          throw new Error('评价管理器未初始化');
        }
        return await this.reviewManager.updateReview(reviewId, updates);
      } catch (error) {
        console.error('[Main] 更新评价失败:', error);
        throw error;
      }
    });

    ipcMain.handle('review:delete', async (_event, reviewId) => {
      try {
        if (!this.reviewManager) {
          throw new Error('评价管理器未初始化');
        }
        return await this.reviewManager.deleteReview(reviewId);
      } catch (error) {
        console.error('[Main] 删除评价失败:', error);
        throw error;
      }
    });

    ipcMain.handle('review:get', async (_event, reviewId) => {
      try {
        if (!this.reviewManager) {
          return null;
        }
        return await this.reviewManager.getReview(reviewId);
      } catch (error) {
        console.error('[Main] 获取评价失败:', error);
        return null;
      }
    });

    ipcMain.handle('review:get-by-target', async (_event, targetId, targetType, filters) => {
      try {
        if (!this.reviewManager) {
          return [];
        }
        return await this.reviewManager.getReviewsByTarget(targetId, targetType, filters);
      } catch (error) {
        console.error('[Main] 获取目标评价失败:', error);
        return [];
      }
    });

    ipcMain.handle('review:reply', async (_event, reviewId, content) => {
      try {
        if (!this.reviewManager) {
          throw new Error('评价管理器未初始化');
        }
        return await this.reviewManager.replyToReview(reviewId, content);
      } catch (error) {
        console.error('[Main] 回复评价失败:', error);
        throw error;
      }
    });

    ipcMain.handle('review:mark-helpful', async (_event, reviewId, helpful) => {
      try {
        if (!this.reviewManager) {
          throw new Error('评价管理器未初始化');
        }
        return await this.reviewManager.markHelpful(reviewId, helpful);
      } catch (error) {
        console.error('[Main] 标记有帮助失败:', error);
        throw error;
      }
    });

    ipcMain.handle('review:report', async (_event, reviewId, reason, description) => {
      try {
        if (!this.reviewManager) {
          throw new Error('评价管理器未初始化');
        }
        return await this.reviewManager.reportReview(reviewId, reason, description);
      } catch (error) {
        console.error('[Main] 举报评价失败:', error);
        throw error;
      }
    });

    ipcMain.handle('review:get-statistics', async (_event, targetId, targetType) => {
      try {
        if (!this.reviewManager) {
          return null;
        }
        return await this.reviewManager.getStatistics(targetId, targetType);
      } catch (error) {
        console.error('[Main] 获取评价统计失败:', error);
        return null;
      }
    });

    ipcMain.handle('review:get-my-reviews', async (_event, userDid) => {
      try {
        if (!this.reviewManager) {
          return [];
        }
        return await this.reviewManager.getMyReviews(userDid);
      } catch (error) {
        console.error('[Main] 获取我的评价失败:', error);
        return [];
      }
    });

    // P2P网络
    ipcMain.handle('p2p:get-node-info', async () => {
      try {
        if (!this.p2pManager || !this.p2pManager.initialized) {
          return null;
        }

        return this.p2pManager.getNodeInfo();
      } catch (error) {
        console.error('[Main] 获取节点信息失败:', error);
        return null;
      }
    });

    ipcMain.handle('p2p:connect', async (_event, multiaddr) => {
      try {
        if (!this.p2pManager) {
          throw new Error('P2P管理器未初始化');
        }

        return await this.p2pManager.connectToPeer(multiaddr);
      } catch (error) {
        console.error('[Main] 连接对等节点失败:', error);
        throw error;
      }
    });

    ipcMain.handle('p2p:disconnect', async (_event, peerId) => {
      try {
        if (!this.p2pManager) {
          throw new Error('P2P管理器未初始化');
        }

        return await this.p2pManager.disconnectFromPeer(peerId);
      } catch (error) {
        console.error('[Main] 断开对等节点失败:', error);
        throw error;
      }
    });

    ipcMain.handle('p2p:get-peers', async () => {
      try {
        if (!this.p2pManager) {
          return [];
        }

        return this.p2pManager.getConnectedPeers();
      } catch (error) {
        console.error('[Main] 获取对等节点列表失败:', error);
        return [];
      }
    });

    // P2P 加密消息
    ipcMain.handle('p2p:send-encrypted-message', async (_event, peerId, message, deviceId, options) => {
      try {
        if (!this.p2pManager) {
          throw new Error('P2P管理器未初始化');
        }

        return await this.p2pManager.sendEncryptedMessage(peerId, message, deviceId, options);
      } catch (error) {
        console.error('[Main] 发送加密消息失败:', error);
        throw error;
      }
    });

    ipcMain.handle('p2p:has-encrypted-session', async (_event, peerId) => {
      try {
        if (!this.p2pManager) {
          return false;
        }

        return await this.p2pManager.hasEncryptedSession(peerId);
      } catch (error) {
        console.error('[Main] 检查加密会话失败:', error);
        return false;
      }
    });

    ipcMain.handle('p2p:initiate-key-exchange', async (_event, peerId, deviceId) => {
      try {
        if (!this.p2pManager) {
          throw new Error('P2P管理器未初始化');
        }

        return await this.p2pManager.initiateKeyExchange(peerId, deviceId);
      } catch (error) {
        console.error('[Main] 密钥交换失败:', error);
        throw error;
      }
    });

    // P2P 多设备支持
    ipcMain.handle('p2p:get-user-devices', async (_event, userId) => {
      try {
        if (!this.p2pManager) {
          return [];
        }

        return this.p2pManager.getUserDevices(userId);
      } catch (error) {
        console.error('[Main] 获取用户设备列表失败:', error);
        return [];
      }
    });

    ipcMain.handle('p2p:get-current-device', async () => {
      try {
        if (!this.p2pManager) {
          return null;
        }

        return this.p2pManager.getCurrentDevice();
      } catch (error) {
        console.error('[Main] 获取当前设备失败:', error);
        return null;
      }
    });

    ipcMain.handle('p2p:get-device-statistics', async () => {
      try {
        if (!this.p2pManager) {
          return {
            userCount: 0,
            totalDevices: 0,
            currentDevice: null,
          };
        }

        return this.p2pManager.getDeviceStatistics();
      } catch (error) {
        console.error('[Main] 获取设备统计失败:', error);
        return {
          userCount: 0,
          totalDevices: 0,
          currentDevice: null,
        };
      }
    });

    // P2P 设备同步
    ipcMain.handle('p2p:get-sync-statistics', async () => {
      try {
        if (!this.p2pManager || !this.p2pManager.syncManager) {
          return {
            totalMessages: 0,
            deviceCount: 0,
            deviceQueues: {},
            statusCount: 0,
            activeSyncs: 0,
          };
        }

        return this.p2pManager.syncManager.getStatistics();
      } catch (error) {
        console.error('[Main] 获取同步统计失败:', error);
        return {
          totalMessages: 0,
          deviceCount: 0,
          deviceQueues: {},
          statusCount: 0,
          activeSyncs: 0,
        };
      }
    });

    ipcMain.handle('p2p:get-message-status', async (_event, messageId) => {
      try {
        if (!this.p2pManager || !this.p2pManager.syncManager) {
          return null;
        }

        return this.p2pManager.syncManager.messageStatus.get(messageId) || null;
      } catch (error) {
        console.error('[Main] 获取消息状态失败:', error);
        return null;
      }
    });

    ipcMain.handle('p2p:start-device-sync', async (_event, deviceId) => {
      try {
        if (!this.p2pManager || !this.p2pManager.syncManager) {
          throw new Error('设备同步管理器未初始化');
        }

        this.p2pManager.syncManager.startDeviceSync(deviceId);
        return { success: true };
      } catch (error) {
        console.error('[Main] 启动设备同步失败:', error);
        throw error;
      }
    });

    ipcMain.handle('p2p:stop-device-sync', async (_event, deviceId) => {
      try {
        if (!this.p2pManager || !this.p2pManager.syncManager) {
          throw new Error('设备同步管理器未初始化');
        }

        this.p2pManager.syncManager.stopDeviceSync(deviceId);
        return { success: true };
      } catch (error) {
        console.error('[Main] 停止设备同步失败:', error);
        throw error;
      }
    });

    // NAT检测
    ipcMain.handle('p2p:detect-nat', async () => {
      try {
        if (!this.p2pManager || !this.p2pManager.natDetector) {
          throw new Error('P2P管理器未初始化');
        }
        return await this.p2pManager.natDetector.detectNATType(
          this.p2pManager.p2pConfig.stun.servers
        );
      } catch (error) {
        console.error('[Main] NAT检测失败:', error);
        throw error;
      }
    });

    // 获取NAT信息
    ipcMain.handle('p2p:get-nat-info', async () => {
      try {
        if (!this.p2pManager) {
          throw new Error('P2P管理器未初始化');
        }
        return this.p2pManager.natInfo;
      } catch (error) {
        console.error('[Main] 获取NAT信息失败:', error);
        throw error;
      }
    });

    // 获取中继信息
    ipcMain.handle('p2p:get-relay-info', async () => {
      try {
        if (!this.p2pManager || !this.p2pManager.node) {
          return [];
        }

        const connections = this.p2pManager.node.getConnections();
        const relays = connections.filter(conn =>
          conn.remoteAddr.toString().includes('/p2p-circuit')
        );

        return relays.map(relay => ({
          peerId: relay.remotePeer.toString(),
          addr: relay.remoteAddr.toString(),
          status: relay.status,
        }));
      } catch (error) {
        console.error('[Main] 获取中继信息失败:', error);
        throw error;
      }
    });

    // 运行诊断
    ipcMain.handle('p2p:run-diagnostics', async () => {
      try {
        if (!this.p2pManager || !this.p2pManager.transportDiagnostics) {
          throw new Error('P2P管理器未初始化');
        }
        return await this.p2pManager.transportDiagnostics.runFullDiagnostics();
      } catch (error) {
        console.error('[Main] 运行诊断失败:', error);
        throw error;
      }
    });

    // 可验证凭证 (VC)
    ipcMain.handle('vc:create', async (_event, params) => {
      try {
        if (!this.vcManager) {
          throw new Error('可验证凭证管理器未初始化');
        }

        return await this.vcManager.createCredential(params);
      } catch (error) {
        console.error('[Main] 创建凭证失败:', error);
        throw error;
      }
    });

    ipcMain.handle('vc:get-all', async (_event, filters) => {
      try {
        if (!this.vcManager) {
          return [];
        }

        return this.vcManager.getCredentials(filters);
      } catch (error) {
        console.error('[Main] 获取凭证列表失败:', error);
        return [];
      }
    });

    ipcMain.handle('vc:get', async (_event, id) => {
      try {
        if (!this.vcManager) {
          return null;
        }

        return this.vcManager.getCredentialById(id);
      } catch (error) {
        console.error('[Main] 获取凭证失败:', error);
        return null;
      }
    });

    ipcMain.handle('vc:verify', async (_event, vcDocument) => {
      try {
        if (!this.vcManager) {
          throw new Error('可验证凭证管理器未初始化');
        }

        return await this.vcManager.verifyCredential(vcDocument);
      } catch (error) {
        console.error('[Main] 验证凭证失败:', error);
        return false;
      }
    });

    ipcMain.handle('vc:revoke', async (_event, id, issuerDID) => {
      try {
        if (!this.vcManager) {
          throw new Error('可验证凭证管理器未初始化');
        }

        return await this.vcManager.revokeCredential(id, issuerDID);
      } catch (error) {
        console.error('[Main] 撤销凭证失败:', error);
        throw error;
      }
    });

    ipcMain.handle('vc:delete', async (_event, id) => {
      try {
        if (!this.vcManager) {
          throw new Error('可验证凭证管理器未初始化');
        }

        return await this.vcManager.deleteCredential(id);
      } catch (error) {
        console.error('[Main] 删除凭证失败:', error);
        throw error;
      }
    });

    ipcMain.handle('vc:export', async (_event, id) => {
      try {
        if (!this.vcManager) {
          throw new Error('可验证凭证管理器未初始化');
        }

        return this.vcManager.exportCredential(id);
      } catch (error) {
        console.error('[Main] 导出凭证失败:', error);
        throw error;
      }
    });

    ipcMain.handle('vc:get-statistics', async (_event, did) => {
      try {
        if (!this.vcManager) {
          return { issued: 0, received: 0, total: 0, byType: {} };
        }

        return this.vcManager.getStatistics(did);
      } catch (error) {
        console.error('[Main] 获取凭证统计失败:', error);
        return { issued: 0, received: 0, total: 0, byType: {} };
      }
    });

    ipcMain.handle('vc:generate-share-data', async (_event, id) => {
      try {
        if (!this.vcManager) {
          throw new Error('可验证凭证管理器未初始化');
        }

        return await this.vcManager.generateShareData(id);
      } catch (error) {
        console.error('[Main] 生成分享数据失败:', error);
        throw error;
      }
    });

    ipcMain.handle('vc:import-from-share', async (_event, shareData) => {
      try {
        if (!this.vcManager) {
          throw new Error('可验证凭证管理器未初始化');
        }

        return await this.vcManager.importFromShareData(shareData);
      } catch (error) {
        console.error('[Main] 导入分享凭证失败:', error);
        throw error;
      }
    });

    // VC模板管理 IPC处理器
    ipcMain.handle('vc-template:get-all', async (_event, filters) => {
      try {
        if (!this.vcTemplateManager) {
          return [];
        }

        return this.vcTemplateManager.getAllTemplates(filters);
      } catch (error) {
        console.error('[Main] 获取模板列表失败:', error);
        return [];
      }
    });

    ipcMain.handle('vc-template:get', async (_event, id) => {
      try {
        if (!this.vcTemplateManager) {
          return null;
        }

        return this.vcTemplateManager.getTemplateById(id);
      } catch (error) {
        console.error('[Main] 获取模板失败:', error);
        return null;
      }
    });

    ipcMain.handle('vc-template:create', async (_event, templateData) => {
      try {
        if (!this.vcTemplateManager) {
          throw new Error('凭证模板管理器未初始化');
        }

        return await this.vcTemplateManager.createTemplate(templateData);
      } catch (error) {
        console.error('[Main] 创建模板失败:', error);
        throw error;
      }
    });

    ipcMain.handle('vc-template:update', async (_event, id, updates) => {
      try {
        if (!this.vcTemplateManager) {
          throw new Error('凭证模板管理器未初始化');
        }

        return await this.vcTemplateManager.updateTemplate(id, updates);
      } catch (error) {
        console.error('[Main] 更新模板失败:', error);
        throw error;
      }
    });

    ipcMain.handle('vc-template:delete', async (_event, id) => {
      try {
        if (!this.vcTemplateManager) {
          throw new Error('凭证模板管理器未初始化');
        }

        return await this.vcTemplateManager.deleteTemplate(id);
      } catch (error) {
        console.error('[Main] 删除模板失败:', error);
        throw error;
      }
    });

    ipcMain.handle('vc-template:fill-values', async (_event, templateId, values) => {
      try {
        if (!this.vcTemplateManager) {
          throw new Error('凭证模板管理器未初始化');
        }

        return this.vcTemplateManager.fillTemplateValues(templateId, values);
      } catch (error) {
        console.error('[Main] 填充模板值失败:', error);
        throw error;
      }
    });

    ipcMain.handle('vc-template:increment-usage', async (_event, id) => {
      try {
        if (!this.vcTemplateManager) {
          return;
        }

        await this.vcTemplateManager.incrementUsageCount(id);
      } catch (error) {
        console.error('[Main] 更新模板使用次数失败:', error);
      }
    });

    ipcMain.handle('vc-template:get-statistics', async () => {
      try {
        if (!this.vcTemplateManager) {
          return { builtIn: 0, custom: 0, public: 0, total: 0 };
        }

        return this.vcTemplateManager.getStatistics();
      } catch (error) {
        console.error('[Main] 获取模板统计失败:', error);
        return { builtIn: 0, custom: 0, public: 0, total: 0 };
      }
    });

    ipcMain.handle('vc-template:export', async (_event, id) => {
      try {
        if (!this.vcTemplateManager) {
          throw new Error('凭证模板管理器未初始化');
        }

        return this.vcTemplateManager.exportTemplate(id);
      } catch (error) {
        console.error('[Main] 导出模板失败:', error);
        throw error;
      }
    });

    ipcMain.handle('vc-template:export-multiple', async (_event, ids) => {
      try {
        if (!this.vcTemplateManager) {
          throw new Error('凭证模板管理器未初始化');
        }

        return this.vcTemplateManager.exportTemplates(ids);
      } catch (error) {
        console.error('[Main] 批量导出模板失败:', error);
        throw error;
      }
    });

    ipcMain.handle('vc-template:import', async (_event, importData, createdBy, options) => {
      try {
        if (!this.vcTemplateManager) {
          throw new Error('凭证模板管理器未初始化');
        }

        return await this.vcTemplateManager.importTemplate(importData, createdBy, options);
      } catch (error) {
        console.error('[Main] 导入模板失败:', error);
        throw error;
      }
    });

    // Git同步 - 完整实现
    ipcMain.handle('git:status', async () => {
      try {
        if (!this.gitManager) {
          return {
            enabled: false,
            error: 'Git同步未启用',
          };
        }

        const status = await this.gitManager.getStatus();
        return {
          enabled: true,
          ...status,
        };
      } catch (error) {
        console.error('[Main] 获取Git状态失败:', error);
        return {
          enabled: false,
          error: error.message,
        };
      }
    });

    ipcMain.handle('git:sync', async () => {
      try {
        if (!this.gitManager || !this.markdownExporter) {
          throw new Error('Git同步未启用');
        }

        // 导出数据
        await this.markdownExporter.sync();

        // 同步Git
        const result = await this.gitManager.autoSync('Manual sync from ChainlessChain');

        return result;
      } catch (error) {
        console.error('[Main] Git同步失败:', error);
        throw error;
      }
    });

    ipcMain.handle('git:push', async () => {
      try {
        if (!this.gitManager) {
          throw new Error('Git同步未启用');
        }

        await this.gitManager.push();
        return true;
      } catch (error) {
        console.error('[Main] Git推送失败:', error);
        throw error;
      }
    });

    ipcMain.handle('git:pull', async () => {
      try {
        if (!this.gitManager) {
          throw new Error('Git同步未启用');
        }

        const result = await this.gitManager.pull();
        return result;
      } catch (error) {
        console.error('[Main] Git拉取失败:', error);
        throw error;
      }
    });

    // Git冲突解决相关
    ipcMain.handle('git:get-conflicts', async () => {
      try {
        if (!this.gitManager) {
          throw new Error('Git同步未启用');
        }

        return await this.gitManager.getConflictFiles();
      } catch (error) {
        console.error('[Main] 获取冲突文件失败:', error);
        throw error;
      }
    });

    ipcMain.handle('git:get-conflict-content', async (_event, filepath) => {
      try {
        if (!this.gitManager) {
          throw new Error('Git同步未启用');
        }

        return await this.gitManager.getConflictContent(filepath);
      } catch (error) {
        console.error('[Main] 获取冲突内容失败:', error);
        throw error;
      }
    });

    ipcMain.handle('git:resolve-conflict', async (_event, filepath, resolution, content) => {
      try {
        if (!this.gitManager) {
          throw new Error('Git同步未启用');
        }

        return await this.gitManager.resolveConflict(filepath, resolution, content);
      } catch (error) {
        console.error('[Main] 解决冲突失败:', error);
        throw error;
      }
    });

    ipcMain.handle('git:abort-merge', async () => {
      try {
        if (!this.gitManager) {
          throw new Error('Git同步未启用');
        }

        return await this.gitManager.abortMerge();
      } catch (error) {
        console.error('[Main] 中止合并失败:', error);
        throw error;
      }
    });

    ipcMain.handle('git:complete-merge', async (_event, message) => {
      try {
        if (!this.gitManager) {
          throw new Error('Git同步未启用');
        }

        return await this.gitManager.completeMerge(message);
      } catch (error) {
        console.error('[Main] 完成合并失败:', error);
        throw error;
      }
    });

    ipcMain.handle('git:get-log', async (_event, depth = 10) => {
      try {
        if (!this.gitManager) {
          return [];
        }

        return await this.gitManager.getLog(depth);
      } catch (error) {
        console.error('[Main] 获取Git日志失败:', error);
        throw error;
      }
    });

    ipcMain.handle('git:get-config', async () => {
      try {
        const gitConfig = getGitConfig();
        return gitConfig.getAll();
      } catch (error) {
        console.error('[Main] 获取Git配置失败:', error);
        throw error;
      }
    });

    ipcMain.handle('git:set-config', async (_event, config) => {
      try {
        const gitConfig = getGitConfig();

        // 更新配置
        Object.keys(config).forEach((key) => {
          gitConfig.set(key, config[key]);
        });

        gitConfig.save();

        // 如果启用状态改变，需要重新初始化
        if ('enabled' in config) {
          // 重启应用以应用新配置
          // TODO: 实现热重载
        }

        return true;
      } catch (error) {
        console.error('[Main] 设置Git配置失败:', error);
        throw error;
      }
    });

    ipcMain.handle('git:set-remote', async (_event, url) => {
      try {
        if (!this.gitManager) {
          throw new Error('Git同步未启用');
        }

        await this.gitManager.setRemote(url);

        // 更新配置
        const gitConfig = getGitConfig();
        gitConfig.setRemoteUrl(url);

        return true;
      } catch (error) {
        console.error('[Main] 设置远程仓库失败:', error);
        throw error;
      }
    });

    ipcMain.handle('git:set-auth', async (_event, auth) => {
      try {
        if (!this.gitManager) {
          throw new Error('Git同步未启用');
        }

        this.gitManager.setAuth(auth);

        // 更新配置
        const gitConfig = getGitConfig();
        gitConfig.setAuth(auth);

        return true;
      } catch (error) {
        console.error('[Main] 设置认证信息失败:', error);
        throw error;
      }
    });

    ipcMain.handle('git:export-markdown', async () => {
      try {
        if (!this.markdownExporter) {
          throw new Error('Markdown导出器未初始化');
        }

        const files = await this.markdownExporter.exportAll();
        return files;
      } catch (error) {
        console.error('[Main] 导出Markdown失败:', error);
        throw error;
      }
    });

    // ==================== 项目管理 IPC ====================

    // 获取所有项目（本地SQLite）
    ipcMain.handle('project:get-all', async (_event, userId) => {
      try {
        console.log('[Main] ===== 开始获取项目列表 =====');
        if (!this.database) {
          throw new Error('数据库未初始化');
        }

        console.log('[Main] 获取项目列表，userId:', userId);
        const projects = this.database.getProjects(userId);
        console.log('[Main] 原始项目数量:', projects ? projects.length : 0);

        if (!projects || projects.length === 0) {
          console.log('[Main] 没有项目，返回空数组');
          return [];
        }

        // 打印第一个项目的键，帮助调试
        if (projects[0]) {
          console.log('[Main] 第一个项目的键:', Object.keys(projects[0]));
          console.log('[Main] 第一个项目的部分数据:', {
            id: projects[0].id,
            name: projects[0].name,
            project_type: projects[0].project_type
          });
        }

        console.log('[Main] 开始清理数据...');
        const cleaned = this.removeUndefinedValues(projects);
        console.log('[Main] 清理完成，清理后的项目数量:', cleaned ? cleaned.length : 0);

        // 确保返回的是有效的数组
        if (!cleaned || !Array.isArray(cleaned)) {
          console.warn('[Main] 清理后的结果不是数组，返回空数组');
          return [];
        }

        console.log('[Main] 准备返回项目列表');
        return cleaned;
      } catch (error) {
        console.error('[Main] 获取项目列表失败:', error);
        console.error('[Main] 错误堆栈:', error.stack);
        // 出错时返回空数组而不是抛出异常，避免IPC序列化错误
        return [];
      }
    });

    // 获取单个项目
    ipcMain.handle('project:get', async (_event, projectId) => {
      try {
        if (!this.database) {
          throw new Error('数据库未初始化');
        }
        const project = this.database.getProjectById(projectId);
        return this.removeUndefinedValues(project);
      } catch (error) {
        console.error('[Main] 获取项目失败:', error);
        throw error;
      }
    });

    // 调试：获取数据库统计信息
    ipcMain.handle('database:get-stats', async () => {
      try {
        if (!this.database) {
          return { error: '数据库未初始化' };
        }
        return this.database.getDatabaseStats();
      } catch (error) {
        console.error('[Main] 获取数据库统计失败:', error);
        return { error: error.message };
      }
    });

    // 创建项目（调用后端）
    ipcMain.handle('project:create', async (_event, createData) => {
      try {
        // 首先清理输入数据中的 undefined 值（IPC 已经不应该传递 undefined，但双重保险）
        const cleanedCreateData = this._replaceUndefinedWithNull(createData);
        console.log('[Main] 开始创建项目，参数:', JSON.stringify(cleanedCreateData, null, 2));

        const { getProjectHTTPClient } = require('./project/http-client');
        const httpClient = getProjectHTTPClient();

        // 调用后端API
        const project = await httpClient.createProject(cleanedCreateData);
        console.log('[Main] 后端返回项目，键:', Object.keys(project || {}));

        // 保存到本地数据库
        if (this.database && project) {
          // 先清理 project 中的 undefined，再保存到数据库
          const cleanedProject = this._replaceUndefinedWithNull(project);
          console.log('[Main] 清理后的项目:', JSON.stringify(cleanedProject, null, 2));

          const localProject = {
            ...cleanedProject,
            user_id: cleanedCreateData.userId || 'default-user',
            sync_status: 'synced',
            synced_at: Date.now(),
            file_count: cleanedProject.files ? cleanedProject.files.length : 0, // 设置文件数量
          };

          // 检查 localProject 中是否有 undefined
          console.log('[Main] localProject 准备保存到数据库');
          Object.keys(localProject).forEach(key => {
            const value = localProject[key];
            console.log(`[Main]   ${key}: ${typeof value === 'undefined' ? 'UNDEFINED!' : typeof value} = ${JSON.stringify(value).substring(0, 100)}`);
          });

          try {
            console.log('[Main] 调用 saveProject...');
            await this.database.saveProject(localProject);
            console.log('[Main] 项目已保存到本地数据库');
          } catch (saveError) {
            console.error('[Main] saveProject 失败:', saveError.message);
            console.error('[Main] saveProject 堆栈:', saveError.stack);
            throw saveError;
          }

          // 为所有类型项目创建根目录并设置root_path（统一从系统配置读取）
          const projectType = cleanedProject.project_type || cleanedProject.projectType;
          try {
            const { getProjectConfig } = require('./project/project-config');
            const projectConfig = getProjectConfig();
            const projectRootPath = require('path').join(
              projectConfig.getProjectsRootPath(),
              cleanedProject.id
            );

            console.log('[Main] 创建项目目录:', projectRootPath, '项目类型:', projectType);
            await require('fs').promises.mkdir(projectRootPath, { recursive: true });

            // 立即更新项目的root_path（无论项目类型和是否有文件）
            // updateProject 是同步函数
            this.database.updateProject(cleanedProject.id, {
              root_path: projectRootPath,
            });
            console.log('[Main] 项目root_path已设置:', projectRootPath);
          } catch (dirError) {
            console.error('[Main] 创建项目目录失败:', dirError);
            // 继续执行，不影响项目创建
          }

          // 保存项目文件
          if (cleanedProject.files && cleanedProject.files.length > 0) {
            try {
              console.log('[Main] 开始保存文件，数量:', cleanedProject.files.length);
              // 清理文件数组中的 undefined
              const cleanedFiles = this._replaceUndefinedWithNull(cleanedProject.files);
              await this.database.saveProjectFiles(cleanedProject.id, cleanedFiles);
              console.log('[Main] 项目文件已保存');
            } catch (fileError) {
              console.error('[Main] saveProjectFiles 失败:', fileError.message);
              console.error('[Main] saveProjectFiles 堆栈:', fileError.stack);
              throw fileError;
            }
          }
        }

        // 清理undefined值（IPC无法序列化undefined）
        console.log('[Main] 开始清理 undefined 值');
        console.log('[Main] 清理前的项目键值:', JSON.stringify(Object.keys(project)));

        // 检查每个键的值
        Object.keys(project).forEach(key => {
          if (project[key] === undefined) {
            console.warn(`[Main] 发现 undefined 值在键: ${key}`);
          }
        });

        const cleanProject = this.removeUndefinedValues(project);
        console.log('[Main] 清理完成，返回项目');
        console.log('[Main] 清理后的项目键:', Object.keys(cleanProject));

        // 再次检查清理后的值
        Object.keys(cleanProject).forEach(key => {
          if (cleanProject[key] === undefined) {
            console.error(`[Main] 清理后仍有 undefined 值在键: ${key}`);
          }
        });

        // 最终安全检查：递归替换所有undefined为null
        const safeProject = this._replaceUndefinedWithNull(cleanProject);
        console.log('[Main] 最终安全检查完成');

        return safeProject;
      } catch (error) {
        console.error('[Main] 创建项目失败:', error);
        throw error;
      }
    });

    // 流式创建项目（SSE）
    ipcMain.handle('project:create-stream', async (event, createData) => {
      const { getProjectHTTPClient } = require('./project/http-client');
      const httpClient = getProjectHTTPClient();

      // 流式状态
      let streamControl = null;
      let accumulatedData = {
        stages: [],
        contentByStage: {},
        files: [],
        metadata: {},
      };

      try {
        // 清理输入数据中的 undefined 值
        const cleanedCreateData = this._replaceUndefinedWithNull(createData);
        console.log('[Main] 开始流式创建项目，参数:', JSON.stringify(cleanedCreateData, null, 2));

        streamControl = await httpClient.createProjectStream(cleanedCreateData, {
          // 进度回调
          onProgress: (data) => {
            accumulatedData.stages.push({
              stage: data.stage,
              message: data.message,
              timestamp: Date.now(),
            });
            console.log(`[Main] 流式进度: ${data.stage} - ${data.message}`);
            event.sender.send('project:stream-chunk', {
              type: 'progress',
              data,
            });
          },

          // 内容回调
          onContent: (data) => {
            if (!accumulatedData.contentByStage[data.stage]) {
              accumulatedData.contentByStage[data.stage] = '';
            }
            accumulatedData.contentByStage[data.stage] += data.content;

            console.log(`[Main] 流式内容: ${data.stage}, 长度: ${data.content.length}`);
            event.sender.send('project:stream-chunk', {
              type: 'content',
              data,
            });
          },

          // 完成回调
          onComplete: async (data) => {
            // 兼容不同引擎的数据结构
            // Web引擎: { type: "complete", files: [...], metadata: {...} }
            // Document/Data引擎: { type: "complete", project_type: "document", result: { files: [...], metadata: {...} } }
            const result = data.result || data;
            accumulatedData.files = result.files || [];
            accumulatedData.metadata = result.metadata || {};

            console.log('[Main] 流式创建完成，文件数量:', accumulatedData.files.length);
            console.log('[Main] 项目类型:', data.project_type);

            // 统一数据结构：将result中的数据提升到顶层
            if (data.result) {
              data.files = result.files;
              data.metadata = result.metadata;
            }

            // 保存到SQLite数据库
            if (this.database && accumulatedData.files.length > 0) {
              try {
                // 确定项目类型：优先使用后端返回的类型，然后用户指定的类型，最后默认web
                const projectType = data.project_type || cleanedCreateData.projectType || 'web';

                // 构建项目对象
                const localProject = {
                  id: crypto.randomUUID(),
                  name: cleanedCreateData.name || '未命名项目',
                  projectType: projectType,
                  userId: cleanedCreateData.userId || 'default-user',
                  createdAt: Date.now(),
                  updatedAt: Date.now(),
                  metadata: JSON.stringify(accumulatedData.metadata),
                  user_id: cleanedCreateData.userId || 'default-user',
                  sync_status: 'pending',
                  file_count: accumulatedData.files.length, // 设置文件数量
                };

                console.log('[Main] 保存项目到数据库，ID:', localProject.id);
                await this.database.saveProject(localProject);

                // 为所有类型项目创建根目录并设置root_path（统一从系统配置读取）
                try {
                  const projectConfig = getProjectConfig();
                  const projectRootPath = path.join(
                    projectConfig.getProjectsRootPath(),
                    localProject.id
                  );

                  console.log('[Main] 创建项目目录:', projectRootPath, '项目类型:', projectType);
                  await fs.promises.mkdir(projectRootPath, { recursive: true });

                  // 立即更新项目的root_path（无论项目类型和是否有文件）
                  // updateProject 是同步函数
                  this.database.updateProject(localProject.id, {
                    root_path: projectRootPath,
                  });
                  console.log('[Main] 项目root_path已设置:', projectRootPath);

                  // 如果有文件，写入到文件系统
                  if (accumulatedData.files.length > 0) {
                    for (const file of accumulatedData.files) {
                      const filePath = path.join(projectRootPath, file.path);
                      console.log('[Main] 写入文件:', filePath);

                      // 解码base64内容
                      let fileContent;
                      if (file.content_encoding === 'base64') {
                        fileContent = Buffer.from(file.content, 'base64');
                        console.log('[Main] 已解码base64内容，大小:', fileContent.length, 'bytes');
                      } else if (typeof file.content === 'string') {
                        fileContent = Buffer.from(file.content, 'utf-8');
                      } else {
                        fileContent = file.content;
                      }

                      await fs.promises.writeFile(filePath, fileContent);
                      console.log('[Main] 文件写入成功:', file.path);
                    }
                  }
                } catch (writeError) {
                  console.error('[Main] 创建项目目录或写入文件失败:', writeError);
                  console.error('[Main] 错误堆栈:', writeError.stack);
                  // 不抛出错误，继续处理
                }

                // 保存项目文件到数据库
                const cleanedFiles = this._replaceUndefinedWithNull(accumulatedData.files);
                console.log('[Main] 准备保存文件到数据库，文件数量:', cleanedFiles.length);
                if (cleanedFiles.length > 0) {
                  console.log('[Main] 第一个文件:', {
                    path: cleanedFiles[0].path,
                    type: cleanedFiles[0].type,
                    hasContent: !!cleanedFiles[0].content,
                    contentLength: cleanedFiles[0].content ? cleanedFiles[0].content.length : 0
                  });
                }
                await this.database.saveProjectFiles(localProject.id, cleanedFiles);
                console.log('[Main] 项目文件已保存到数据库');

                // 验证保存是否成功
                const savedFiles = this.database.getProjectFiles(localProject.id);
                console.log('[Main] 验证：数据库中的文件数量:', savedFiles?.length || 0);

                // 更新项目的file_count
                if (savedFiles && savedFiles.length > 0) {
                  // updateProject 是同步函数
                  this.database.updateProject(localProject.id, {
                    file_count: savedFiles.length,
                    updated_at: Date.now()
                  });
                  console.log('[Main] 已更新项目的file_count为:', savedFiles.length);
                }

                // 返回包含本地ID的完整数据
                data.projectId = localProject.id;
              } catch (saveError) {
                console.error('[Main] 保存项目失败:', saveError);
                event.sender.send('project:stream-chunk', {
                  type: 'error',
                  error: `保存失败: ${saveError.message}`,
                });
                return;
              }
            }

            // 发送完成事件
            console.log('[Main] ===== 发送complete事件到前端 =====');
            console.log('[Main] Complete data keys:', Object.keys(data));
            console.log('[Main] Complete data.projectId:', data.projectId);

            event.sender.send('project:stream-chunk', {
              type: 'complete',
              data: data,  // 直接发送，不使用this._replaceUndefinedWithNull
            });

            console.log('[Main] ===== Complete事件已发送 =====');
          },

          // 错误回调
          onError: (error) => {
            console.error('[Main] 流式创建错误:', error);
            event.sender.send('project:stream-chunk', {
              type: 'error',
              error: error.message,
            });
          },
        });

        // 监听取消事件
        const handleCancel = () => {
          console.log('[Main] 收到取消请求');
          if (streamControl) {
            streamControl.cancel();
          }
        };
        ipcMain.once('project:stream-cancel-event', handleCancel);

        return { success: true };

      } catch (error) {
        console.error('[Main] Stream create failed:', error);
        event.sender.send('project:stream-chunk', {
          type: 'error',
          error: error.message,
        });
        return { success: false, error: error.message };
      }
    });

    // 取消流式创建
    ipcMain.handle('project:stream-cancel', () => {
      console.log('[Main] 触发取消事件');
      // 触发取消事件
      ipcMain.emit('project:stream-cancel-event');
      return { success: true };
    });

    // 快速创建项目（不使用AI）
    ipcMain.handle('project:create-quick', async (_event, createData) => {
      try {
        console.log('[Main] 开始快速创建项目，参数:', createData);

        // 生成项目ID
        const projectId = crypto.randomUUID();
        const timestamp = Date.now();

        // 创建项目文件夹
        const projectConfig = getProjectConfig();
        const projectRootPath = path.join(
          projectConfig.getProjectsRootPath(),
          projectId
        );

        console.log('[Main] 创建项目目录:', projectRootPath);
        await fs.promises.mkdir(projectRootPath, { recursive: true });

        // 创建一个默认的README.md文件
        const readmePath = path.join(projectRootPath, 'README.md');
        const readmeContent = `# ${createData.name}\n\n${createData.description || '这是一个新建的项目。'}\n\n创建时间：${new Date().toLocaleString('zh-CN')}\n`;
        await fs.promises.writeFile(readmePath, readmeContent, 'utf-8');

        // 构建项目对象
        const project = {
          id: projectId,
          name: createData.name,
          description: createData.description || '',
          project_type: createData.projectType || 'document', // 默认为document类型（允许的类型：web, document, data, app）
          user_id: createData.userId || 'default-user',
          root_path: projectRootPath,
          created_at: timestamp,
          updated_at: timestamp,
          sync_status: 'pending', // 使用pending状态（允许的类型：synced, pending, conflict, error）
          file_count: 1, // 包含README.md
          metadata: JSON.stringify({
            created_by: 'quick-create',
            created_at: new Date().toISOString(),
          }),
        };

        // 保存到本地数据库
        if (this.database) {
          await this.database.saveProject(project);
          console.log('[Main] 项目已保存到本地数据库');

          // 保存项目文件记录
          const file = {
            project_id: projectId,
            file_name: 'README.md',
            file_path: 'README.md',
            file_type: 'markdown',
            content: readmeContent,
            created_at: timestamp,
            updated_at: timestamp,
          };
          await this.database.saveProjectFiles(projectId, [file]);
          console.log('[Main] 项目文件已保存到数据库');
        }

        console.log('[Main] 快速创建项目成功，ID:', projectId);
        return this._replaceUndefinedWithNull(project);
      } catch (error) {
        console.error('[Main] 快速创建项目失败:', error);
        throw error;
      }
    });

    // 保存项目到本地SQLite
    ipcMain.handle('project:save', async (_event, project) => {
      try {
        if (!this.database) {
          throw new Error('数据库未初始化');
        }
        // 清理输入的 project 中的 undefined 值
        const cleanProject = this._replaceUndefinedWithNull(project);
        const saved = this.database.saveProject(cleanProject);
        return this.removeUndefinedValues(saved);
      } catch (error) {
        console.error('[Main] 保存项目失败:', error);
        throw error;
      }
    });

    // 更新项目
    ipcMain.handle('project:update', async (_event, projectId, updates) => {
      try {
        if (!this.database) {
          throw new Error('数据库未初始化');
        }

        // 清理输入的 updates 中的 undefined 值
        const cleanUpdates = this._replaceUndefinedWithNull(updates);

        const updatedProject = {
          ...cleanUpdates,
          updated_at: Date.now(),
          sync_status: 'pending',
        };

        const result = this.database.updateProject(projectId, updatedProject);
        return this.removeUndefinedValues(result);
      } catch (error) {
        console.error('[Main] 更新项目失败:', error);
        throw error;
      }
    });

    // 修复项目路径（为没有 root_path 的项目设置路径）
    ipcMain.handle('project:fix-path', async (_event, projectId) => {
      try {
        if (!this.database) {
          throw new Error('数据库未初始化');
        }

        const fs = require('fs').promises;
        const path = require('path');

        // 获取项目信息
        const project = this.database.getProjectById(projectId);
        if (!project) {
          throw new Error(`项目不存在: ${projectId}`);
        }

        // 如果已经有 root_path，不需要修复
        if (project.root_path) {
          console.log('[Main] 项目已有 root_path，无需修复:', project.root_path);
          return { success: true, message: '项目路径正常', path: project.root_path };
        }

        // 创建项目目录
        const { getProjectConfig } = require('./project/project-config');
        const projectConfig = getProjectConfig();
        const projectRootPath = path.join(
          projectConfig.getProjectsRootPath(),
          projectId
        );

        console.log('[Main] 为项目创建目录:', projectRootPath);
        await fs.mkdir(projectRootPath, { recursive: true });

        // 更新项目的 root_path
        this.database.updateProject(projectId, {
          root_path: projectRootPath,
        });

        // 获取项目文件并写入文件系统
        const projectFiles = this.database.db.prepare(
          'SELECT * FROM project_files WHERE project_id = ?'
        ).all(projectId);

        let fileCount = 0;
        if (projectFiles && projectFiles.length > 0) {
          console.log(`[Main] 写入 ${projectFiles.length} 个文件到文件系统`);

          for (const file of projectFiles) {
            try {
              const filePath = path.join(projectRootPath, file.file_path || file.file_name);

              // 确保文件目录存在
              await fs.mkdir(path.dirname(filePath), { recursive: true });

              // 写入文件内容
              await fs.writeFile(filePath, file.content || '', 'utf8');

              // 更新文件的 fs_path
              this.database.db.run(
                'UPDATE project_files SET fs_path = ? WHERE id = ?',
                [filePath, file.id]
              );

              fileCount++;
            } catch (fileError) {
              console.error(`[Main] 写入文件失败: ${file.file_name}`, fileError);
            }
          }
        }

        this.database.saveToFile();

        console.log('[Main] 项目路径修复完成:', projectRootPath);
        return {
          success: true,
          message: `路径已修复，写入 ${fileCount} 个文件`,
          path: projectRootPath,
          fileCount
        };

      } catch (error) {
        console.error('[Main] 修复项目路径失败:', error);
        throw error;
      }
    });

    // 修复项目的root_path（为document类型的项目创建目录并设置路径）
    ipcMain.handle('project:repair-root-path', async (_event, projectId) => {
      try {
        if (!this.database) {
          throw new Error('数据库未初始化');
        }

        const project = this.database.db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
        if (!project) {
          throw new Error('项目不存在');
        }

        const projectType = project.project_type || project.projectType;
        if (projectType !== 'document') {
          return { success: false, message: '只能修复document类型的项目' };
        }

        // 检查是否已有root_path
        if (project.root_path) {
          console.log('[Main] 项目已有root_path:', project.root_path);
          return { success: true, message: '项目已有root_path', rootPath: project.root_path };
        }

        // 创建项目目录
        const { getProjectConfig } = require('./project/project-config');
        const projectConfig = getProjectConfig();
        const projectRootPath = require('path').join(
          projectConfig.getProjectsRootPath(),
          projectId
        );

        console.log('[Main] 修复项目root_path，创建目录:', projectRootPath);
        await require('fs').promises.mkdir(projectRootPath, { recursive: true });

        // 更新数据库（updateProject 是同步函数）
        this.database.updateProject(projectId, {
          root_path: projectRootPath,
        });

        console.log('[Main] 项目root_path修复完成:', projectRootPath);
        return { success: true, message: '修复成功', rootPath: projectRootPath };
      } catch (error) {
        console.error('[Main] 修复项目root_path失败:', error);
        throw error;
      }
    });

    // 批量修复所有缺失root_path的document项目
    ipcMain.handle('project:repair-all-root-paths', async (_event) => {
      try {
        if (!this.database) {
          throw new Error('数据库未初始化');
        }

        console.log('[Main] ========== 开始批量修复项目root_path ==========');

        // 查找所有缺失root_path的document项目
        const brokenProjects = this.database.db.prepare(`
          SELECT id, name, project_type, root_path
          FROM projects
          WHERE project_type = 'document'
            AND (root_path IS NULL OR root_path = '')
          ORDER BY created_at DESC
        `).all();

        console.log(`[Main] 发现 ${brokenProjects.length} 个缺失root_path的项目`);

        if (brokenProjects.length === 0) {
          return {
            success: true,
            message: '所有项目都有正确的root_path',
            fixed: 0,
            failed: 0,
            details: []
          };
        }

        const { getProjectConfig } = require('./project/project-config');
        const projectConfig = getProjectConfig();
        const results = {
          success: true,
          fixed: 0,
          failed: 0,
          details: []
        };

        // 逐个修复
        for (const project of brokenProjects) {
          try {
            const projectRootPath = require('path').join(
              projectConfig.getProjectsRootPath(),
              project.id
            );

            console.log(`[Main] 修复项目: ${project.name} (${project.id})`);
            console.log(`[Main]   创建目录: ${projectRootPath}`);

            // 创建目录
            await require('fs').promises.mkdir(projectRootPath, { recursive: true });

            // 更新数据库（updateProject 是同步函数）
            this.database.updateProject(project.id, {
              root_path: projectRootPath,
            });

            results.fixed++;
            results.details.push({
              id: project.id,
              name: project.name,
              status: 'fixed',
              rootPath: projectRootPath
            });

            console.log(`[Main]   ✅ 修复成功`);
          } catch (error) {
            console.error(`[Main]   ❌ 修复失败:`, error.message);
            results.failed++;
            results.details.push({
              id: project.id,
              name: project.name,
              status: 'failed',
              error: error.message
            });
          }
        }

        console.log(`[Main] ========== 批量修复完成 ==========`);
        console.log(`[Main] 修复成功: ${results.fixed} 个`);
        console.log(`[Main] 修复失败: ${results.failed} 个`);

        results.message = `修复完成：成功 ${results.fixed} 个，失败 ${results.failed} 个`;
        return results;
      } catch (error) {
        console.error('[Main] 批量修复失败:', error);
        throw error;
      }
    });

    // 删除项目（后端）
    ipcMain.handle('project:delete', async (_event, projectId) => {
      try {
        const { getProjectHTTPClient } = require('./project/http-client');
        const httpClient = getProjectHTTPClient();

        // 从后端删除
        await httpClient.deleteProject(projectId);

        return { success: true };
      } catch (error) {
        console.error('[Main] 删除项目失败:', error);
        throw error;
      }
    });

    // 删除本地项目
    ipcMain.handle('project:delete-local', async (_event, projectId) => {
      try {
        if (!this.database) {
          throw new Error('数据库未初始化');
        }
        return this.database.deleteProject(projectId);
      } catch (error) {
        console.error('[Main] 删除本地项目失败:', error);
        throw error;
      }
    });

    // 从后端获取项目
    ipcMain.handle('project:fetch-from-backend', async (_event, projectId) => {
      try {
        const { getProjectHTTPClient } = require('./project/http-client');
        const httpClient = getProjectHTTPClient();

        const project = await httpClient.getProject(projectId);

        // 保存到本地
        if (this.database && project) {
          await this.database.saveProject({
            ...project,
            sync_status: 'synced',
            synced_at: Date.now(),
          });
        }

        return this.removeUndefinedValues(project);
      } catch (error) {
        console.error('[Main] 从后端获取项目失败:', error);
        throw error;
      }
    });

    // 获取项目文件列表（直接从文件系统读取）
    ipcMain.handle('project:get-files', async (_event, projectId, fileType = null, pageNum = 1, pageSize = 50) => {
      try {
        console.log('[Main] ========== 开始获取项目文件 ==========');
        console.log('[Main] ProjectId:', projectId);
        console.log('[Main] FileType过滤:', fileType);

        // 获取项目根路径
        if (!this.database) {
          throw new Error('数据库未初始化');
        }

        const project = this.database.db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
        if (!project) {
          console.error('[Main] ❌ 项目不存在, projectId:', projectId);
          throw new Error('项目不存在');
        }

        console.log('[Main] 📋 项目完整信息:', {
          id: project.id,
          name: project.name,
          root_path: project.root_path,
          folder_path: project.folder_path,
          project_type: project.project_type,
          created_at: project.created_at
        });

        const rootPath = project.root_path || project.folder_path;
        console.log('[Main] 项目根路径:', rootPath);

        if (!rootPath) {
          console.error('[Main] ⚠️  项目缺少 root_path，尝试自动修复');
          console.error('[Main] 项目ID:', projectId);
          console.error('[Main] 项目名称:', project.name);
          console.error('[Main] 项目类型:', project.project_type);

          // 尝试自动修复（支持所有项目类型）
          try {
            console.log('[Main] 开始自动修复...');
            console.log('[Main] 项目类型:', project.project_type);
            const { getProjectConfig } = require('./project/project-config');
            const projectConfig = getProjectConfig();
            const projectRootPath = require('path').join(
              projectConfig.getProjectsRootPath(),
              projectId
            );

            console.log('[Main] 创建项目目录:', projectRootPath);
            await require('fs').promises.mkdir(projectRootPath, { recursive: true });

            console.log('[Main] 更新数据库 root_path');
            await this.database.updateProject(projectId, {
              root_path: projectRootPath,
            });

            console.log('[Main] ✅ 自动修复成功，继续文件扫描');
            console.log('[Main] 修复后的路径:', projectRootPath);

            // 使用修复后的路径继续扫描（将继续使用下面的扫描逻辑）
            // 更新 project 对象以便后续使用
            project.root_path = projectRootPath;
          } catch (repairError) {
            console.error('[Main] ❌ 自动修复失败:', repairError.message);
            console.error('[Main] 建议：手动运行 await window.electronAPI.project.repairRootPath("' + projectId + '")');
            return [];
          }
        }

        // 重新获取 rootPath（可能已被修复）
        const finalRootPath = project.root_path || project.folder_path;
        if (!finalRootPath) {
          console.error('[Main] 修复后仍无法获取 root_path');
          return [];
        }

        const fs = require('fs').promises;
        const path = require('path');

        // 检查项目目录是否存在
        try {
          await fs.access(finalRootPath);
          console.log('[Main] ✅ 项目目录存在，开始扫描...');
        } catch (error) {
          console.error('[Main] ❌ 项目目录不存在:', finalRootPath, error.message);
          return [];
        }

        // 递归读取文件系统
        const files = [];
        let scanCount = 0;
        let skipCount = 0;

        async function scanDirectory(dirPath, relativePath = '') {
          try {
            const entries = await fs.readdir(dirPath, { withFileTypes: true });
            console.log(`[Main] 扫描目录: ${relativePath || '/'}, 发现 ${entries.length} 个条目`);

            for (const entry of entries) {
              scanCount++;

              // 跳过隐藏文件和特定目录
              if (/(^|[\/\\])\.|node_modules|\.git|dist|build|out/.test(entry.name)) {
                skipCount++;
                console.log(`[Main] ⏭️  跳过: ${entry.name} (隐藏文件或排除目录)`);
                continue;
              }

              const fullPath = path.join(dirPath, entry.name);
              const fileRelativePath = relativePath ? path.join(relativePath, entry.name) : entry.name;
              const isFolder = entry.isDirectory();

              try {
                const stats = await fs.stat(fullPath);

                const fileInfo = {
                  id: 'fs_' + crypto.createHash('sha256').update(fileRelativePath).digest('hex').substring(0, 16),
                  project_id: projectId,
                  file_name: entry.name,
                  file_path: fileRelativePath.replace(/\\/g, '/'), // 统一使用正斜杠
                  file_type: isFolder ? 'folder' : (path.extname(entry.name).substring(1) || 'file'),
                  is_folder: isFolder,
                  file_size: stats.size || 0,
                  created_at: stats.birthtimeMs || Date.now(),
                  updated_at: stats.mtimeMs || Date.now(),
                  sync_status: 'synced',
                  deleted: 0,
                  version: 1,
                };

                files.push(fileInfo);
                console.log(`[Main] ✅ 添加${isFolder ? '文件夹' : '文件'}: ${fileInfo.file_path} (id: ${fileInfo.id})`);

                // 递归处理子目录
                if (isFolder) {
                  await scanDirectory(fullPath, fileRelativePath);
                }
              } catch (statError) {
                console.error(`[Main] ❌ 无法读取文件状态 ${fileRelativePath}:`, statError.message);
              }
            }
          } catch (readError) {
            console.error(`[Main] 无法读取目录 ${dirPath}:`, readError.message);
          }
        }

        await scanDirectory(finalRootPath);

        console.log(`[Main] 📊 文件系统扫描完成:`);
        console.log(`[Main]   - 扫描条目总数: ${scanCount}`);
        console.log(`[Main]   - 跳过条目数: ${skipCount}`);
        console.log(`[Main]   - 有效文件数: ${files.length}`);

        // 从数据库读取文件记录（以获取content等额外信息）
        const dbFiles = this.database.getProjectFiles(projectId);
        console.log(`[Main] 📊 数据库查询结果: ${dbFiles.length} 条记录`);

        if (dbFiles.length > 0) {
          console.log(`[Main] 数据库文件示例: ${dbFiles.slice(0, 3).map(f => f.file_path).join(', ')}`);
        }

        // 构建数据库文件映射：file_path -> dbFile
        const dbFileMap = {};
        let dbMapCount = 0;
        dbFiles.forEach(f => {
          if (f.file_path) {
            dbFileMap[f.file_path] = f;
            dbMapCount++;
          } else {
            console.warn(`[Main] ⚠️  数据库文件缺少file_path:`, f);
          }
        });
        console.log(`[Main] 构建数据库映射: ${dbMapCount} 个有效路径`);

        // 合并文件系统和数据库数据（以文件系统为准，但保留数据库的额外信息）
        let mergeMatchCount = 0;
        let mergeNewCount = 0;

        const mergedFiles = files.map(fsFile => {
          const dbFile = dbFileMap[fsFile.file_path];

          if (dbFile) {
            mergeMatchCount++;
            // 文件系统和数据库都存在：合并数据
            // 优先使用文件系统的基本信息（size, time），但保留数据库的额外信息（content, hash等）
            const merged = {
              ...dbFile,           // 数据库字段（包含content, content_hash等）
              ...fsFile,           // 文件系统字段（最新的size, time等）
              id: dbFile.id,       // 保留数据库ID（UUID格式）
            };
            console.log(`[Main] 🔗 合并: ${fsFile.file_path} (DB id: ${dbFile.id})`);
            return merged;
          } else {
            mergeNewCount++;
            // 仅文件系统存在：返回文件系统信息
            console.log(`[Main] 🆕 新文件: ${fsFile.file_path} (FS id: ${fsFile.id})`);
            return fsFile;
          }
        });

        console.log(`[Main] 📊 数据合并完成:`);
        console.log(`[Main]   - 合并文件数: ${mergeMatchCount}`);
        console.log(`[Main]   - 新文件数: ${mergeNewCount}`);
        console.log(`[Main]   - 总计: ${mergedFiles.length}`);

        // 如果指定了文件类型，进行过滤
        let filteredFiles = mergedFiles;
        if (fileType) {
          const beforeFilter = filteredFiles.length;
          filteredFiles = mergedFiles.filter(f => f.file_type === fileType);
          console.log(`[Main] 🔍 类型过滤 (${fileType}): ${beforeFilter} -> ${filteredFiles.length}`);
        }

        const result = this.removeUndefinedValues(filteredFiles);
        console.log(`[Main] ========== 返回 ${result.length} 个文件 ==========`);

        if (result.length > 0 && result.length <= 5) {
          console.log('[Main] 返回的文件列表:', result.map(f => `${f.file_name} (${f.file_path})`).join(', '));
        } else if (result.length > 5) {
          console.log('[Main] 前5个文件:', result.slice(0, 5).map(f => `${f.file_name} (${f.file_path})`).join(', '));
        }

        return result;
      } catch (error) {
        console.error('[Main] 获取项目文件失败:', error);
        throw error;
      }
    });

    // 获取单个文件
    ipcMain.handle('project:get-file', async (_event, fileId) => {
      try {
        if (!this.database) {
          throw new Error('数据库未初始化');
        }
        const stmt = this.database.db.prepare('SELECT * FROM project_files WHERE id = ?');
        const file = stmt.get(fileId);
        return this.removeUndefinedValues(file);
      } catch (error) {
        console.error('[Main] 获取文件失败:', error);
        throw error;
      }
    });

    // 保存项目文件
    ipcMain.handle('project:save-files', async (_event, projectId, files) => {
      try {
        if (!this.database) {
          throw new Error('数据库未初始化');
        }
        this.database.saveProjectFiles(projectId, files);
        return { success: true };
      } catch (error) {
        console.error('[Main] 保存项目文件失败:', error);
        throw error;
      }
    });

    // 更新文件
    ipcMain.handle('project:update-file', async (_event, fileUpdate) => {
      try {
        const { projectId, fileId, content, is_base64 } = fileUpdate;

        // 调用后端API
        const result = await ProjectFileAPI.updateFile(projectId, fileId, {
          content,
          is_base64
        });

        // 如果后端不可用，降级到本地数据库
        if (!result.success || result.status === 0) {
          console.warn('[Main] 后端服务不可用，使用本地数据库');
          if (!this.database) {
            throw new Error('数据库未初始化');
          }
          this.database.updateProjectFile(fileUpdate);
          return { success: true };
        }

        return result;
      } catch (error) {
        console.error('[Main] 更新文件失败:', error);
        // 降级到本地数据库
        if (this.database) {
          this.database.updateProjectFile(fileUpdate);
          return { success: true };
        }
        throw error;
      }
    });

    // 删除文件
    ipcMain.handle('project:delete-file', async (_event, projectId, fileId) => {
      try {
        if (!this.database) {
          throw new Error('数据库未初始化');
        }

        const fs = require('fs').promises;
        const { getProjectConfig } = require('./project/project-config');
        const projectConfig = getProjectConfig();

        // 获取文件信息
        const file = this.database.db.get('SELECT * FROM project_files WHERE id = ?', [fileId]);

        if (file) {
          try {
            // 解析文件路径并删除物理文件
            const resolvedPath = projectConfig.resolveProjectPath(file.file_path);
            console.log('[Main] 删除物理文件:', resolvedPath);
            await fs.unlink(resolvedPath);
          } catch (error) {
            console.warn('[Main] 删除物理文件失败 (可能已不存在):', error.message);
            // 即使物理文件删除失败,也继续删除数据库记录
          }
        }

        // 从数据库删除记录
        this.database.db.run('DELETE FROM project_files WHERE id = ?', [fileId]);

        // 更新项目的文件统计
        try {
          const totalFiles = this.database.db.prepare(
            `SELECT COUNT(*) as count FROM project_files WHERE project_id = ?`
          ).get(projectId);

          const fileCount = totalFiles ? totalFiles.count : 0;
          this.database.db.run(
            `UPDATE projects SET file_count = ?, updated_at = ? WHERE id = ?`,
            [fileCount, Date.now(), projectId]
          );

          console.log(`[Main] 已更新项目的file_count为 ${fileCount}`);
        } catch (updateError) {
          console.error('[Main] 更新项目file_count失败:', updateError);
        }

        this.database.saveToFile();

        console.log('[Main] 文件删除成功:', fileId);
        return { success: true };
      } catch (error) {
        console.error('[Main] 删除文件失败:', error);
        throw error;
      }
    });


    // 索引项目对话历史
    ipcMain.handle('project:indexConversations', async (_event, projectId, options = {}) => {
      try {
        const { getProjectRAGManager } = require('./project/project-rag');
        const projectRAG = getProjectRAGManager();

        await projectRAG.initialize();

        const result = await projectRAG.indexConversationHistory(projectId, options);

        console.log('[Main] 对话历史索引完成:', result);
        return result;
      } catch (error) {
        console.error('[Main] 索引对话历史失败:', error);
        throw error;
      }
    });

    // 启动文件监听
    ipcMain.handle('project:startWatcher', async (_event, projectId, projectPath) => {
      try {
        const { getProjectRAGManager } = require('./project/project-rag');
        const projectRAG = getProjectRAGManager();

        await projectRAG.initialize();

        await projectRAG.startFileWatcher(projectId, projectPath);

        console.log('[Main] 文件监听已启动:', projectPath);
        return { success: true };
      } catch (error) {
        console.error('[Main] 启动文件监听失败:', error);
        throw error;
      }
    });

    // 停止文件监听
    ipcMain.handle('project:stopWatcher', async (_event, projectId) => {
      try {
        const { getProjectRAGManager } = require('./project/project-rag');
        const projectRAG = getProjectRAGManager();

        await projectRAG.initialize();

        projectRAG.stopFileWatcher(projectId);

        console.log('[Main] 文件监听已停止:', projectId);
        return { success: true };
      } catch (error) {
        console.error('[Main] 停止文件监听失败:', error);
        throw error;
      }
    });

    // ==================== 设计工具 IPC ====================

    const { DesignManager } = require('./design/design-manager');

    /**
     * 创建设计项目
     */
    ipcMain.handle('design:create-project', async (_event, projectData) => {
      try {
        const designManager = new DesignManager(this.database.db);
        const project = await designManager.createDesignProject(projectData);
        console.log('[Design] 设计项目创建成功:', project.id);
        return project;
      } catch (error) {
        console.error('[Design] 创建设计项目失败:', error);
        throw error;
      }
    });

    /**
     * 获取设计项目
     */
    ipcMain.handle('design:get-project', async (_event, projectId) => {
      try {
        const designManager = new DesignManager(this.database.db);
        return await designManager.getDesignProject(projectId);
      } catch (error) {
        console.error('[Design] 获取设计项目失败:', error);
        throw error;
      }
    });

    /**
     * 获取项目的所有画板
     */
    ipcMain.handle('design:get-artboards', async (_event, projectId) => {
      try {
        const designManager = new DesignManager(this.database.db);
        return await designManager.getProjectArtboards(projectId);
      } catch (error) {
        console.error('[Design] 获取画板列表失败:', error);
        throw error;
      }
    });

    /**
     * 创建画板
     */
    ipcMain.handle('design:create-artboard', async (_event, artboardData) => {
      try {
        const designManager = new DesignManager(this.database.db);
        const artboardId = await designManager.createArtboard(artboardData);

        // 返回完整的画板信息
        const artboard = this.database.db.prepare(
          'SELECT * FROM design_artboards WHERE id = ?'
        ).get(artboardId);

        console.log('[Design] 画板创建成功:', artboardId);
        return artboard;
      } catch (error) {
        console.error('[Design] 创建画板失败:', error);
        throw error;
      }
    });

    /**
     * 获取画板详情（包含所有对象）
     */
    ipcMain.handle('design:get-artboard', async (_event, artboardId) => {
      try {
        const designManager = new DesignManager(this.database.db);
        return await designManager.getArtboard(artboardId);
      } catch (error) {
        console.error('[Design] 获取画板失败:', error);
        throw error;
      }
    });

    /**
     * 更新画板
     */
    ipcMain.handle('design:update-artboard', async (_event, { artboardId, updates }) => {
      try {
        const designManager = new DesignManager(this.database.db);
        return await designManager.updateArtboard(artboardId, updates);
      } catch (error) {
        console.error('[Design] 更新画板失败:', error);
        throw error;
      }
    });

    /**
     * 删除画板
     */
    ipcMain.handle('design:delete-artboard', async (_event, artboardId) => {
      try {
        const designManager = new DesignManager(this.database.db);
        return await designManager.deleteArtboard(artboardId);
      } catch (error) {
        console.error('[Design] 删除画板失败:', error);
        throw error;
      }
    });

    /**
     * 添加设计对象
     */
    ipcMain.handle('design:add-object', async (_event, objectData) => {
      try {
        const designManager = new DesignManager(this.database.db);
        const objectId = await designManager.addObject(objectData);
        console.log('[Design] 对象添加成功:', objectId);
        return { id: objectId };
      } catch (error) {
        console.error('[Design] 添加对象失败:', error);
        throw error;
      }
    });

    /**
     * 更新设计对象
     */
    ipcMain.handle('design:update-object', async (_event, { id, ...updates }) => {
      try {
        const designManager = new DesignManager(this.database.db);
        return await designManager.updateObject(id, updates);
      } catch (error) {
        console.error('[Design] 更新对象失败:', error);
        throw error;
      }
    });

    /**
     * 删除设计对象
     */
    ipcMain.handle('design:delete-object', async (_event, objectId) => {
      try {
        const designManager = new DesignManager(this.database.db);
        return await designManager.deleteObject(objectId);
      } catch (error) {
        console.error('[Design] 删除对象失败:', error);
        throw error;
      }
    });

    /**
     * 保存画板（批量更新所有对象）
     */
    ipcMain.handle('design:save-artboard', async (_event, { artboard_id, objects }) => {
      try {
        const designManager = new DesignManager(this.database.db);
        return await designManager.saveArtboard(artboard_id, objects);
      } catch (error) {
        console.error('[Design] 保存画板失败:', error);
        throw error;
      }
    });

    /**
     * 获取组件库
     */
    ipcMain.handle('design:get-components', async (_event, { projectId, category }) => {
      try {
        let query = 'SELECT * FROM design_components WHERE is_system = 1';
        const params = [];

        if (projectId) {
          query += ' OR project_id = ?';
          params.push(projectId);
        }

        if (category) {
          query += ' AND category = ?';
          params.push(category);
        }

        const components = this.database.db.prepare(query).all(...params);
        return components;
      } catch (error) {
        console.error('[Design] 获取组件库失败:', error);
        throw error;
      }
    });

    /**
     * 获取 Design Tokens
     */
    ipcMain.handle('design:get-tokens', async (_event, projectId) => {
      try {
        const tokens = this.database.db.prepare(
          'SELECT * FROM design_tokens WHERE project_id = ? ORDER BY token_type, token_name'
        ).all(projectId);
        return tokens;
      } catch (error) {
        console.error('[Design] 获取 Design Tokens 失败:', error);
        throw error;
      }
    });

    // ==================== 项目AI对话 IPC ====================

    /**
     * 项目AI对话 - 支持文件操作
     * 用户可以通过自然语言与AI对话，AI会根据需要执行文件操作
     */
    ipcMain.handle('project:aiChat', async (_event, chatData) => {
      try {
        const axios = require('axios');
        const { parseAIResponse } = require('./ai-engine/response-parser');
        const { executeOperations, ensureLogTable } = require('./ai-engine/conversation-executor');
        const path = require('path');

        console.log('[Main] 项目AI对话:', chatData);

        const {
          projectId,
          userMessage,
          conversationHistory,
          contextMode,
          currentFile,
          projectInfo,
          fileList
        } = chatData;

        // 1. 检查数据库
        if (!this.database) {
          throw new Error('数据库未初始化');
        }

        // 2. 获取项目信息
        const project = this.database.db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);

        if (!project) {
          throw new Error(`项目不存在: ${projectId}`);
        }

        const projectPath = project.root_path;

        // 验证项目路径
        if (!projectPath) {
          throw new Error(`项目路径未设置: ${projectId}，请在项目设置中指定项目根目录`);
        }

        console.log('[Main] 项目路径:', projectPath);

        // 3. 确保日志表存在
        await ensureLogTable(this.database);

        // 4. 准备后端API请求数据
        // 注意：后端期望 current_file 是文件路径字符串，不是对象
        const currentFilePath = currentFile && typeof currentFile === 'object'
          ? currentFile.file_path
          : currentFile;

        // 5. 调用后端AI服务
        const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://localhost:8001';

        const requestData = {
          project_id: projectId,
          user_message: userMessage,
          conversation_history: conversationHistory || [],
          context_mode: contextMode || 'project',
          current_file: currentFilePath || null,
          project_info: projectInfo || {
            name: project.name,
            description: project.description || '',
            type: project.project_type || 'general'
          },
          file_list: fileList || []
        };

        console.log('[Main] 发送到AI服务的数据:', JSON.stringify({
          ...requestData,
          file_list: `[${fileList?.length || 0} files]`
        }, null, 2));

        const response = await axios.post(
          `${AI_SERVICE_URL}/api/projects/${projectId}/chat`,
          requestData,
          {
            timeout: 60000  // 60秒超时
          }
        );

        const { response: aiResponse, operations, rag_sources } = response.data;

        console.log('[Main] AI响应:', aiResponse);
        console.log('[Main] 文件操作数量:', operations ? operations.length : 0);

        // 5. 使用ChatSkillBridge拦截并处理
        let bridgeResult = null;
        if (this.chatSkillBridge) {
          try {
            console.log('[Main] 使用ChatSkillBridge处理响应...');
            bridgeResult = await this.chatSkillBridge.interceptAndProcess(
              userMessage,
              aiResponse,
              {
                projectId,
                projectPath,
                currentFile: currentFilePath,
                conversationHistory
              }
            );

            console.log('[Main] 桥接器处理结果:', {
              shouldIntercept: bridgeResult.shouldIntercept,
              toolCallsCount: bridgeResult.toolCalls?.length || 0
            });
          } catch (error) {
            console.error('[Main] ChatSkillBridge处理失败:', error);
            // 如果桥接器失败，继续使用原有逻辑
          }
        }

        // 6. 如果桥接器成功处理，返回增强响应
        if (bridgeResult && bridgeResult.shouldIntercept) {
          console.log('[Main] 使用桥接器处理结果');
          return {
            success: true,
            conversationResponse: bridgeResult.enhancedResponse,
            fileOperations: bridgeResult.executionResults || [],
            ragSources: rag_sources || [],
            hasFileOperations: bridgeResult.toolCalls.length > 0,
            usedBridge: true,
            toolCalls: bridgeResult.toolCalls,
            bridgeSummary: bridgeResult.summary
          };
        }

        // 7. 否则使用原有的解析逻辑（兼容后备）
        console.log('[Main] 使用原有解析逻辑');
        const parsed = parseAIResponse(aiResponse, operations);

        // 8. 执行文件操作
        let operationResults = [];
        if (parsed.hasFileOperations) {
          console.log(`[Main] 执行 ${parsed.operations.length} 个文件操作`);

          try {
            operationResults = await executeOperations(
              parsed.operations,
              projectPath,
              this.database
            );

            console.log('[Main] 文件操作完成:', operationResults.length);
          } catch (error) {
            console.error('[Main] 文件操作执行失败:', error);
            // 操作失败不影响对话响应的返回
            operationResults = [{
              status: 'error',
              error: error.message
            }];
          }
        }

        // 9. 返回结果
        return {
          success: true,
          conversationResponse: aiResponse,
          fileOperations: operationResults,
          ragSources: rag_sources || [],
          hasFileOperations: parsed.hasFileOperations,
          usedBridge: false
        };

      } catch (error) {
        console.error('[Main] 项目AI对话失败:', error);

        // 如果是网络错误或后端不可用，返回友好的错误信息
        if (error.code === 'ECONNREFUSED') {
          throw new Error('AI服务连接失败，请确保后端服务已启动');
        }

        throw error;
      }
    });

    // ==================== 文件内容读写 IPC ====================

    // 读取文件内容（文本文件）
    ipcMain.handle('file:read-content', async (_event, filePath) => {
      try {
        const fs = require('fs').promises;
        const path = require('path');

        // 解析路径
        const { getProjectConfig } = require('./project/project-config');
        const projectConfig = getProjectConfig();
        const resolvedPath = projectConfig.resolveProjectPath(filePath);

        console.log('[Main] 读取文件内容:', resolvedPath);

        // 检查文件是否存在
        try {
          await fs.access(resolvedPath);
        } catch (error) {
          throw new Error(`文件不存在: ${resolvedPath}`);
        }

        // 读取文件内容
        const content = await fs.readFile(resolvedPath, 'utf-8');
        console.log('[Main] 文件读取成功，大小:', content.length, '字符');

        return content;
      } catch (error) {
        console.error('[Main] 读取文件内容失败:', error);
        throw error;
      }
    });

    // 写入文件内容（文本文件）
    ipcMain.handle('file:write-content', async (_event, filePath, content) => {
      try {
        const fs = require('fs').promises;
        const path = require('path');

        // 解析路径
        const { getProjectConfig } = require('./project/project-config');
        const projectConfig = getProjectConfig();
        const resolvedPath = projectConfig.resolveProjectPath(filePath);

        console.log('[Main] 写入文件内容:', resolvedPath, '大小:', content?.length || 0, '字符');

        // 确保目录存在
        const dir = path.dirname(resolvedPath);
        await fs.mkdir(dir, { recursive: true });

        // 写入文件
        await fs.writeFile(resolvedPath, content || '', 'utf-8');
        console.log('[Main] 文件写入成功');

        return { success: true };
      } catch (error) {
        console.error('[Main] 写入文件内容失败:', error);
        throw error;
      }
    });

    // 读取二进制文件内容（图片等）
    ipcMain.handle('file:read-binary', async (_event, filePath) => {
      try {
        const fs = require('fs').promises;

        // 解析路径
        const { getProjectConfig } = require('./project/project-config');
        const projectConfig = getProjectConfig();
        const resolvedPath = projectConfig.resolveProjectPath(filePath);

        console.log('[Main] 读取二进制文件:', resolvedPath);

        // 检查文件是否存在
        try {
          await fs.access(resolvedPath);
        } catch (error) {
          throw new Error(`文件不存在: ${resolvedPath}`);
        }

        // 读取二进制内容并转为base64
        const buffer = await fs.readFile(resolvedPath);
        const base64 = buffer.toString('base64');

        console.log('[Main] 二进制文件读取成功，大小:', buffer.length, '字节');

        return base64;
      } catch (error) {
        console.error('[Main] 读取二进制文件失败:', error);
        throw error;
      }
    });

    // 文件另存为（下载文件）- 已移至 FileIPC 类处理

    // ==================== 文件同步 IPC ====================

    // 保存文件（双向同步）
    ipcMain.handle('file-sync:save', async (_event, fileId, content, projectId) => {
      try {
        if (!this.fileSyncManager) {
          throw new Error('文件同步管理器未初始化');
        }
        return await this.fileSyncManager.saveFile(fileId, content, projectId);
      } catch (error) {
        console.error('[Main] 保存文件失败:', error);
        throw error;
      }
    });

    // 从文件系统同步到数据库
    ipcMain.handle('file-sync:sync-from-fs', async (_event, projectId, relativePath) => {
      try {
        if (!this.fileSyncManager) {
          throw new Error('文件同步管理器未初始化');
        }
        return await this.fileSyncManager.syncFromFilesystem(projectId, relativePath);
      } catch (error) {
        console.error('[Main] 从文件系统同步失败:', error);
        throw error;
      }
    });

    // 监听项目文件变化
    ipcMain.handle('file-sync:watch-project', async (_event, projectId, rootPath) => {
      try {
        if (!this.fileSyncManager) {
          throw new Error('文件同步管理器未初始化');
        }
        return await this.fileSyncManager.watchProject(projectId, rootPath);
      } catch (error) {
        console.error('[Main] 启动文件监听失败:', error);
        throw error;
      }
    });

    // 停止监听项目
    ipcMain.handle('file-sync:stop-watch', async (_event, projectId) => {
      try {
        if (!this.fileSyncManager) {
          throw new Error('文件同步管理器未初始化');
        }
        this.fileSyncManager.stopWatch(projectId);
        return { success: true };
      } catch (error) {
        console.error('[Main] 停止文件监听失败:', error);
        throw error;
      }
    });

    // 解决文件冲突
    ipcMain.handle('file-sync:resolve-conflict', async (_event, fileId, resolution, manualContent) => {
      try {
        if (!this.fileSyncManager) {
          throw new Error('文件同步管理器未初始化');
        }
        return await this.fileSyncManager.resolveConflict(fileId, resolution, manualContent);
      } catch (error) {
        console.error('[Main] 解决冲突失败:', error);
        throw error;
      }
    });

    // 刷新项目所有更改到文件系统（Git 提交前调用）
    ipcMain.handle('file-sync:flush-all', async (_event, projectId) => {
      try {
        if (!this.fileSyncManager) {
          throw new Error('文件同步管理器未初始化');
        }
        return await this.fileSyncManager.flushAllChanges(projectId);
      } catch (error) {
        console.error('[Main] 刷新更改失败:', error);
        throw error;
      }
    });

    // 扫描项目文件夹并添加到数据库
    ipcMain.handle('project:scan-files', async (_event, projectId) => {
      try {
        console.log(`[Main] 扫描项目文件: ${projectId}`);
        const project = this.database.db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
        if (!project) throw new Error('项目不存在');
        const rootPath = project.root_path || project.folder_path;
        if (!rootPath) throw new Error('项目没有根路径');

        const fs = require('fs').promises;
        const path = require('path');
        const crypto = require('crypto');
        const addedFiles = [];

        async function scanDir(dir, base) {
          const entries = await fs.readdir(dir, { withFileTypes: true });
          for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            const relativePath = path.relative(base, fullPath);
            if (/(^|[\/\\])\.|node_modules|\.git|dist|build/.test(relativePath)) continue;
            if (entry.isDirectory()) {
              await scanDir(fullPath, base);
            } else if (entry.isFile()) {
              addedFiles.push({ fullPath, relativePath });
            }
          }
        }

        await scanDir(rootPath, rootPath);
        console.log(`[Main] 找到 ${addedFiles.length} 个文件`);

        let added = 0, skipped = 0;
        for (const { fullPath, relativePath } of addedFiles) {
          try {
            const exists = this.database.db.prepare('SELECT id FROM project_files WHERE project_id = ? AND file_path = ?').get(projectId, relativePath);
            if (exists) { skipped++; continue; }

            const content = await fs.readFile(fullPath, 'utf8');
            const stats = await fs.stat(fullPath);
            const hash = crypto.createHash('sha256').update(content, 'utf8').digest('hex');
            const ext = path.extname(relativePath).substring(1);
            const fileId = 'file_' + Date.now() + '_' + Math.random().toString(36).substring(7);
            const now = Date.now();

            this.database.db.run(
              'INSERT INTO project_files (id, project_id, file_name, file_path, file_type, content, content_hash, file_size, version, fs_path, created_at, updated_at, sync_status, synced_at, device_id, deleted) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
              [fileId, projectId, path.basename(relativePath), relativePath, ext || 'unknown', content, hash, stats.size, 1, fullPath, now, now, 'pending', null, null, 0]
            );
            added++;
          } catch (err) {
            console.error(`[Main] 文件处理失败 ${relativePath}:`, err.message);
          }
        }

        this.database.saveToFile();
        console.log(`[Main] 扫描完成: 添加${added}, 跳过${skipped}`);

        if (this.fileSyncManager) {
          await this.fileSyncManager.watchProject(projectId, rootPath);
        }

        return { success: true, addedCount: added, skippedCount: skipped };
      } catch (error) {
        console.error('[Main] 扫描失败:', error);
        throw error;
      }
    });

    // ==================== 对话管理 IPC ====================

    // 创建对话
    ipcMain.handle('conversation:create', async (_event, conversationData) => {
      try {
        if (!this.database) {
          throw new Error('数据库未初始化');
        }
        return this.database.createConversation(conversationData);
      } catch (error) {
        console.error('[Main] 创建对话失败:', error);
        throw error;
      }
    });

    // 根据ID获取对话
    ipcMain.handle('conversation:get', async (_event, conversationId) => {
      try {
        if (!this.database) {
          throw new Error('数据库未初始化');
        }
        return this.database.getConversationById(conversationId);
      } catch (error) {
        console.error('[Main] 获取对话失败:', error);
        throw error;
      }
    });

    // 根据项目ID获取对话
    ipcMain.handle('conversation:get-by-project', async (_event, projectId) => {
      try {
        if (!this.database) {
          throw new Error('数据库未初始化');
        }
        return this.database.getConversationByProject(projectId);
      } catch (error) {
        console.error('[Main] 获取项目对话失败:', error);
        throw error;
      }
    });

    // 获取所有对话
    ipcMain.handle('conversation:get-all', async (_event, options) => {
      try {
        if (!this.database) {
          throw new Error('数据库未初始化');
        }
        return this.database.getConversations(options || {});
      } catch (error) {
        console.error('[Main] 获取对话列表失败:', error);
        throw error;
      }
    });

    // 更新对话
    ipcMain.handle('conversation:update', async (_event, conversationId, updates) => {
      try {
        if (!this.database) {
          throw new Error('数据库未初始化');
        }
        return this.database.updateConversation(conversationId, updates);
      } catch (error) {
        console.error('[Main] 更新对话失败:', error);
        throw error;
      }
    });

    // 删除对话
    ipcMain.handle('conversation:delete', async (_event, conversationId) => {
      try {
        if (!this.database) {
          throw new Error('数据库未初始化');
        }
        return this.database.deleteConversation(conversationId);
      } catch (error) {
        console.error('[Main] 删除对话失败:', error);
        throw error;
      }
    });

    // 创建消息
    ipcMain.handle('conversation:create-message', async (_event, messageData) => {
      try {
        if (!this.database) {
          throw new Error('数据库未初始化');
        }

        // 确保数据是扁平的，不包含嵌套对象
        const flatData = {
          id: messageData.id || null,
          conversation_id: String(messageData.conversation_id || ''),
          role: String(messageData.role || 'user'),
          content: String(messageData.content || ''),
          timestamp: Number(messageData.timestamp || Date.now()),
          tokens: messageData.tokens ? Number(messageData.tokens) : null,
        };

        console.log('[Main] 创建消息, flatData:', flatData);
        return this.database.createMessage(flatData);
      } catch (error) {
        console.error('[Main] 创建消息失败:', error);
        throw error;
      }
    });

    // 获取对话的所有消息
    ipcMain.handle('conversation:get-messages', async (_event, conversationId, options) => {
      try {
        if (!this.database) {
          throw new Error('数据库未初始化');
        }
        return this.database.getMessagesByConversation(conversationId, options || {});
      } catch (error) {
        console.error('[Main] 获取消息列表失败:', error);
        throw error;
      }
    });

    // 删除消息
    ipcMain.handle('conversation:delete-message', async (_event, messageId) => {
      try {
        if (!this.database) {
          throw new Error('数据库未初始化');
        }
        return this.database.deleteMessage(messageId);
      } catch (error) {
        console.error('[Main] 删除消息失败:', error);
        throw error;
      }
    });

    // 清空对话消息
    ipcMain.handle('conversation:clear-messages', async (_event, conversationId) => {
      try {
        if (!this.database) {
          throw new Error('数据库未初始化');
        }
        return this.database.clearConversationMessages(conversationId);
      } catch (error) {
        console.error('[Main] 清空对话消息失败:', error);
        throw error;
      }
    });

    // ==================== 系统配置 IPC ====================

    // 获取所有配置
    ipcMain.handle('config:get-all', async () => {
      try {
        if (!this.database) {
          throw new Error('数据库未初始化');
        }
        return this.database.getAllSettings();
      } catch (error) {
        console.error('[Main] 获取配置失败:', error);
        throw error;
      }
    });

    // 获取单个配置项
    ipcMain.handle('config:get', async (_event, key) => {
      try {
        if (!this.database) {
          throw new Error('数据库未初始化');
        }
        return this.database.getSetting(key);
      } catch (error) {
        console.error('[Main] 获取配置项失败:', error);
        throw error;
      }
    });

    // 更新配置
    ipcMain.handle('config:update', async (_event, config) => {
      try {
        if (!this.database) {
          throw new Error('数据库未初始化');
        }
        return this.database.updateSettings(config);
      } catch (error) {
        console.error('[Main] 更新配置失败:', error);
        throw error;
      }
    });

    // 设置单个配置项
    ipcMain.handle('config:set', async (_event, key, value) => {
      try {
        if (!this.database) {
          throw new Error('数据库未初始化');
        }
        return this.database.setSetting(key, value);
      } catch (error) {
        console.error('[Main] 设置配置项失败:', error);
        throw error;
      }
    });

    // 重置配置为默认值
    ipcMain.handle('config:reset', async () => {
      try {
        if (!this.database) {
          throw new Error('数据库未初始化');
        }
        return this.database.resetSettings();
      } catch (error) {
        console.error('[Main] 重置配置失败:', error);
        throw error;
      }
    });

    // 导出配置为.env文件
    ipcMain.handle('config:export-env', async (_event, filePath) => {
      try {
        if (!this.database) {
          throw new Error('数据库未初始化');
        }

        const config = this.database.getAllSettings();
        const fs = require('fs');

        // 构建.env文件内容
        let envContent = '# ChainlessChain 系统配置\n';
        envContent += `# 生成时间: ${new Date().toISOString()}\n\n`;

        // 项目配置
        envContent += '# 项目配置\n';
        envContent += `PROJECT_ROOT_PATH=${config.project.rootPath || ''}\n`;
        envContent += `PROJECT_MAX_SIZE_MB=${config.project.maxSizeMB || 1000}\n`;
        envContent += `PROJECT_AUTO_SYNC=${config.project.autoSync || false}\n`;
        envContent += `PROJECT_SYNC_INTERVAL_SECONDS=${config.project.syncIntervalSeconds || 300}\n\n`;

        // LLM配置
        envContent += '# LLM配置\n';
        envContent += `LLM_PROVIDER=${config.llm.provider || 'volcengine'}\n`;
        if (config.llm.priority) envContent += `LLM_PRIORITY=${JSON.stringify(config.llm.priority)}\n`;
        envContent += `LLM_AUTO_FALLBACK=${config.llm.autoFallback !== undefined ? config.llm.autoFallback : true}\n`;
        envContent += `LLM_AUTO_SELECT=${config.llm.autoSelect !== undefined ? config.llm.autoSelect : true}\n`;
        envContent += `LLM_SELECTION_STRATEGY=${config.llm.selectionStrategy || 'balanced'}\n`;
        envContent += `OLLAMA_HOST=${config.llm.ollamaHost || 'http://localhost:11434'}\n`;
        envContent += `OLLAMA_MODEL=${config.llm.ollamaModel || 'qwen2:7b'}\n`;
        if (config.llm.openaiApiKey) envContent += `OPENAI_API_KEY=${config.llm.openaiApiKey}\n`;
        if (config.llm.openaiBaseUrl) envContent += `OPENAI_BASE_URL=${config.llm.openaiBaseUrl}\n`;
        if (config.llm.openaiModel) envContent += `OPENAI_MODEL=${config.llm.openaiModel}\n`;
        if (config.llm.volcengineApiKey) envContent += `VOLCENGINE_API_KEY=${config.llm.volcengineApiKey}\n`;
        if (config.llm.volcengineModel) envContent += `VOLCENGINE_MODEL=${config.llm.volcengineModel}\n`;
        if (config.llm.dashscopeApiKey) envContent += `DASHSCOPE_API_KEY=${config.llm.dashscopeApiKey}\n`;
        if (config.llm.dashscopeModel) envContent += `DASHSCOPE_MODEL=${config.llm.dashscopeModel}\n`;
        if (config.llm.zhipuApiKey) envContent += `ZHIPU_API_KEY=${config.llm.zhipuApiKey}\n`;
        if (config.llm.zhipuModel) envContent += `ZHIPU_MODEL=${config.llm.zhipuModel}\n`;
        if (config.llm.deepseekApiKey) envContent += `DEEPSEEK_API_KEY=${config.llm.deepseekApiKey}\n`;
        if (config.llm.deepseekModel) envContent += `DEEPSEEK_MODEL=${config.llm.deepseekModel}\n\n`;

        // 向量数据库配置
        envContent += '# 向量数据库配置\n';
        envContent += `QDRANT_HOST=${config.vector.qdrantHost || 'http://localhost:6333'}\n`;
        envContent += `QDRANT_PORT=${config.vector.qdrantPort || 6333}\n`;
        envContent += `QDRANT_COLLECTION=${config.vector.qdrantCollection || 'chainlesschain_vectors'}\n`;
        envContent += `EMBEDDING_MODEL=${config.vector.embeddingModel || 'bge-base-zh-v1.5'}\n`;
        envContent += `EMBEDDING_DIMENSION=${config.vector.embeddingDimension || 768}\n\n`;

        // Git配置
        envContent += '# Git配置\n';
        envContent += `GIT_ENABLED=${config.git.enabled || false}\n`;
        envContent += `GIT_AUTO_SYNC=${config.git.autoSync || false}\n`;
        envContent += `GIT_AUTO_SYNC_INTERVAL=${config.git.autoSyncInterval || 300}\n`;
        if (config.git.userName) envContent += `GIT_USER_NAME=${config.git.userName}\n`;
        if (config.git.userEmail) envContent += `GIT_USER_EMAIL=${config.git.userEmail}\n`;
        if (config.git.remoteUrl) envContent += `GIT_REMOTE_URL=${config.git.remoteUrl}\n\n`;

        // 后端服务配置
        envContent += '# 后端服务配置\n';
        envContent += `PROJECT_SERVICE_URL=${config.backend.projectServiceUrl || 'http://localhost:9090'}\n`;
        envContent += `AI_SERVICE_URL=${config.backend.aiServiceUrl || 'http://localhost:8001'}\n\n`;

        // 数据库配置
        if (config.database.sqlcipherKey) {
          envContent += '# 数据库配置\n';
          envContent += `SQLCIPHER_KEY=${config.database.sqlcipherKey}\n`;
        }

        fs.writeFileSync(filePath, envContent, 'utf-8');
        return true;
      } catch (error) {
        console.error('[Main] 导出配置失败:', error);
        throw error;
      }
    });

    // 选择文件夹
    ipcMain.handle('dialog:select-folder', async (_event, options = {}) => {
      try {
        const { dialog } = require('electron');
        const result = await dialog.showOpenDialog({
          properties: ['openDirectory', 'createDirectory'],
          title: options.title || '选择文件夹',
          defaultPath: options.defaultPath,
          buttonLabel: options.buttonLabel || '选择'
        });

        if (result.canceled) {
          return null;
        }

        return result.filePaths[0];
      } catch (error) {
        console.error('[Main] 选择文件夹失败:', error);
        throw error;
      }
    });

    // ==================== LLM智能选择 IPC ====================

    // 获取LLM选择器信息
    ipcMain.handle('llm:get-selector-info', async () => {
      try {
        if (!this.llmSelector) {
          throw new Error('LLM选择器未初始化');
        }

        return {
          characteristics: this.llmSelector.getAllCharacteristics(),
          taskTypes: this.llmSelector.getTaskTypes(),
        };
      } catch (error) {
        console.error('[Main] 获取LLM选择器信息失败:', error);
        throw error;
      }
    });

    // 智能选择最优LLM
    ipcMain.handle('llm:select-best', async (_event, options = {}) => {
      try {
        if (!this.llmSelector) {
          throw new Error('LLM选择器未初始化');
        }

        const provider = this.llmSelector.selectBestLLM(options);
        return provider;
      } catch (error) {
        console.error('[Main] 智能选择LLM失败:', error);
        throw error;
      }
    });

    // 生成LLM选择报告
    ipcMain.handle('llm:generate-report', async (_event, taskType = 'chat') => {
      try {
        if (!this.llmSelector) {
          throw new Error('LLM选择器未初始化');
        }

        return this.llmSelector.generateSelectionReport(taskType);
      } catch (error) {
        console.error('[Main] 生成LLM选择报告失败:', error);
        throw error;
      }
    });

    // 切换LLM提供商
    ipcMain.handle('llm:switch-provider', async (_event, provider) => {
      try {
        if (!this.database) {
          throw new Error('数据库未初始化');
        }

        // 保存新的提供商到llm-config.json
        const llmConfig = getLLMConfig();
        llmConfig.setProvider(provider);

        // 重新初始化LLM管理器
        if (this.llmManager) {
          await this.llmManager.close();
        }

        const managerConfig = llmConfig.getManagerConfig();
        console.log(`[Main] 切换到LLM提供商: ${provider}, 配置:`, { model: managerConfig.model, baseURL: managerConfig.baseURL });

        this.llmManager = new LLMManager(managerConfig);
        await this.llmManager.initialize();

        console.log(`[Main] 已切换到LLM提供商: ${provider}`);
        return true;
      } catch (error) {
        console.error('[Main] 切换LLM提供商失败:', error);
        throw error;
      }
    });

    // ==================== 数据库配置 IPC ====================

    // 获取数据库配置
    ipcMain.handle('database:get-config', async () => {
      try {
        const appConfig = getAppConfig();
        return {
          path: appConfig.getDatabasePath(),
          defaultPath: appConfig.getDefaultDatabasePath(),
          exists: appConfig.databaseExists(),
          autoBackup: appConfig.get('database.autoBackup'),
          maxBackups: appConfig.get('database.maxBackups'),
        };
      } catch (error) {
        console.error('[Main] 获取数据库配置失败:', error);
        throw error;
      }
    });

    // 设置数据库路径（需要重启应用）
    ipcMain.handle('database:set-path', async (_event, newPath) => {
      try {
        const appConfig = getAppConfig();
        appConfig.setDatabasePath(newPath);
        console.log(`[Main] 数据库路径已设置为: ${newPath}`);
        return true;
      } catch (error) {
        console.error('[Main] 设置数据库路径失败:', error);
        throw error;
      }
    });

    // 迁移数据库到新位置
    ipcMain.handle('database:migrate', async (_event, newPath) => {
      try {
        const appConfig = getAppConfig();

        // 先备份当前数据库
        const backupPath = appConfig.createDatabaseBackup();
        console.log(`[Main] 已创建备份: ${backupPath}`);

        // 执行迁移
        await appConfig.migrateDatabaseTo(newPath);

        console.log(`[Main] 数据库已迁移到: ${newPath}`);

        return {
          success: true,
          newPath,
          backupPath,
        };
      } catch (error) {
        console.error('[Main] 数据库迁移失败:', error);
        throw error;
      }
    });

    // 创建数据库备份
    ipcMain.handle('database:create-backup', async () => {
      try {
        const appConfig = getAppConfig();
        const backupPath = appConfig.createDatabaseBackup();
        return backupPath;
      } catch (error) {
        console.error('[Main] 创建数据库备份失败:', error);
        throw error;
      }
    });

    // 列出所有备份
    ipcMain.handle('database:list-backups', async () => {
      try {
        const appConfig = getAppConfig();
        return appConfig.listBackups();
      } catch (error) {
        console.error('[Main] 列出备份失败:', error);
        throw error;
      }
    });

    // 从备份恢复
    ipcMain.handle('database:restore-backup', async (_event, backupPath) => {
      try {
        const appConfig = getAppConfig();
        appConfig.restoreFromBackup(backupPath);

        // 需要重启应用才能加载恢复的数据库
        console.log('[Main] 数据库已从备份恢复，需要重启应用');

        return true;
      } catch (error) {
        console.error('[Main] 恢复数据库失败:', error);
        throw error;
      }
    });

    // 重启应用
    ipcMain.handle('app:restart', async () => {
      try {
        console.log('[Main] 重启应用...');
        app.relaunch();
        app.exit(0);
      } catch (error) {
        console.error('[Main] 重启应用失败:', error);
        throw error;
      }
    });

    // ==================== 预览管理 IPC ====================

    // 启动静态服务器
    ipcMain.handle('preview:start-static', async (_event, projectId, rootPath, options) => {
      try {
        if (!this.previewManager) {
          throw new Error('预览管理器未初始化');
        }
        return await this.previewManager.startStaticServer(projectId, rootPath, options);
      } catch (error) {
        console.error('[Main] 启动静态服务器失败:', error);
        throw error;
      }
    });

    // 停止静态服务器
    ipcMain.handle('preview:stop-static', async (_event, projectId) => {
      try {
        if (!this.previewManager) {
          throw new Error('预览管理器未初始化');
        }
        return await this.previewManager.stopStaticServer(projectId);
      } catch (error) {
        console.error('[Main] 停止静态服务器失败:', error);
        throw error;
      }
    });

    // 启动开发服务器
    ipcMain.handle('preview:start-dev', async (_event, projectId, rootPath, command) => {
      try {
        if (!this.previewManager) {
          throw new Error('预览管理器未初始化');
        }
        return await this.previewManager.startDevServer(projectId, rootPath, command);
      } catch (error) {
        console.error('[Main] 启动开发服务器失败:', error);
        throw error;
      }
    });

    // 停止开发服务器
    ipcMain.handle('preview:stop-dev', async (_event, projectId) => {
      try {
        if (!this.previewManager) {
          throw new Error('预览管理器未初始化');
        }
        return await this.previewManager.stopDevServer(projectId);
      } catch (error) {
        console.error('[Main] 停止开发服务器失败:', error);
        throw error;
      }
    });

    // 在文件管理器中打开
    ipcMain.handle('preview:open-explorer', async (_event, rootPath) => {
      try {
        if (!this.previewManager) {
          throw new Error('预览管理器未初始化');
        }
        return await this.previewManager.openInExplorer(rootPath);
      } catch (error) {
        console.error('[Main] 打开文件管理器失败:', error);
        throw error;
      }
    });

    // 在外部浏览器中打开
    ipcMain.handle('preview:open-browser', async (_event, url) => {
      try {
        if (!this.previewManager) {
          throw new Error('预览管理器未初始化');
        }
        return await this.previewManager.openInBrowser(url);
      } catch (error) {
        console.error('[Main] 打开浏览器失败:', error);
        throw error;
      }
    });

    // 获取服务器信息
    ipcMain.handle('preview:get-server-info', async (_event, projectId) => {
      try {
        if (!this.previewManager) {
          throw new Error('预览管理器未初始化');
        }
        return this.previewManager.getServerInfo(projectId);
      } catch (error) {
        console.error('[Main] 获取服务器信息失败:', error);
        throw error;
      }
    });

    // 解析项目路径
    ipcMain.handle('project:resolve-path', async (_event, relativePath) => {
      try {
        const projectConfig = getProjectConfig();
        const resolvedPath = projectConfig.resolveProjectPath(relativePath);
        return resolvedPath;
      } catch (error) {
        console.error('[Main] 解析项目路径失败:', error);
        throw error;
      }
    });

    // ==================== AI任务智能拆解系统 IPC ====================

    // AI智能拆解任务
    ipcMain.handle('project:decompose-task', async (_event, userRequest, projectContext) => {
      try {
        console.log('[Main] AI任务拆解:', userRequest);

        // 获取 AI 引擎管理器
        if (!this.aiEngineManager) {
          const { getAIEngineManager } = require('./ai-engine/ai-engine-manager');
          this.aiEngineManager = getAIEngineManager();
        }

        // 确保已初始化（每次都检查，以防之前初始化失败）
        try {
          await this.aiEngineManager.initialize();
        } catch (initError) {
          console.error('[Main] AI引擎初始化失败:', initError);
          throw new Error(`AI引擎初始化失败: ${initError.message}`);
        }

        // 获取任务规划器
        const taskPlanner = this.aiEngineManager.getTaskPlanner();

        // 拆解任务
        const taskPlan = await taskPlanner.decomposeTask(userRequest, projectContext);

        return taskPlan;
      } catch (error) {
        console.error('[Main] AI任务拆解失败:', error);
        throw error;
      }
    });

    // 执行任务计划
    ipcMain.handle('project:execute-task-plan', async (_event, taskPlanId, projectContext) => {
      try {
        console.log('[Main] 执行任务计划:', taskPlanId);

        // 获取 AI 引擎管理器
        if (!this.aiEngineManager) {
          const { getAIEngineManager } = require('./ai-engine/ai-engine-manager');
          this.aiEngineManager = getAIEngineManager();
        }

        // 确保已初始化（每次都检查，以防之前初始化失败）
        try {
          await this.aiEngineManager.initialize();
        } catch (initError) {
          console.error('[Main] AI引擎初始化失败:', initError);
          throw new Error(`AI引擎初始化失败: ${initError.message}`);
        }

        const taskPlanner = this.aiEngineManager.getTaskPlanner();

        // 获取任务计划
        const taskPlan = await taskPlanner.getTaskPlan(taskPlanId);
        if (!taskPlan) {
          throw new Error(`任务计划不存在: ${taskPlanId}`);
        }

        // 确保项目有 root_path，如果没有则创建
        const projectId = projectContext.projectId || projectContext.id;

        console.log('[Main] 检查项目路径 - projectId:', projectId, 'root_path:', projectContext.root_path);

        if (!projectContext.root_path) {
          console.log('[Main] 项目没有root_path，创建项目目录...');
          const fs = require('fs').promises;
          const path = require('path');
          const projectConfig = getProjectConfig();

          // 如果没有projectId，使用任务计划ID作为临时目录
          const dirName = projectId || `task_${taskPlanId}`;
          const projectRootPath = path.join(
            projectConfig.getProjectsRootPath(),
            dirName
          );

          await fs.mkdir(projectRootPath, { recursive: true });
          console.log('[Main] 项目目录已创建:', projectRootPath);

          // 如果有projectId，更新数据库中的项目信息
          if (projectId) {
            // updateProject 是同步函数
            this.database.updateProject(projectId, {
              root_path: projectRootPath,
              updated_at: Date.now()
            });
          }

          // 更新 projectContext
          projectContext.root_path = projectRootPath;
          console.log('[Main] 已更新项目的root_path:', projectRootPath);
        }

        // 执行任务计划（使用事件推送进度）
        const result = await taskPlanner.executeTaskPlan(taskPlan, projectContext, (progress) => {
          // 通过IPC推送进度更新到渲染进程
          if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send('task:progress-update', progress);
          }
        });

        // 任务执行成功后，扫描项目目录并注册新文件
        if (result.success) {
          try {
            const projectId = projectContext.projectId || projectContext.id;

            // 确定要扫描的路径：优先使用任务结果中的路径，其次使用项目的root_path
            let scanPath = projectContext.root_path;

            // 检查任务结果中是否有文件路径信息
            if (result.results && Array.isArray(result.results)) {
              for (const taskResult of result.results) {
                if (taskResult && taskResult.projectPath) {
                  scanPath = taskResult.projectPath;
                  console.log('[Main] 使用任务返回的路径:', scanPath);
                  break;
                }
              }
            }

            if (scanPath) {
              console.log('[Main] 扫描项目目录以注册新生成的文件...');
              console.log('[Main] 项目ID:', projectId);
              console.log('[Main] 扫描路径:', scanPath);

              const filesRegistered = await this.scanAndRegisterProjectFiles(projectId, scanPath);

              // 如果有文件被注册，通知前端刷新
              if (filesRegistered > 0 && this.mainWindow && !this.mainWindow.isDestroyed()) {
                console.log(`[Main] 通知前端刷新项目数据（注册了 ${filesRegistered} 个文件）`);
                this.mainWindow.webContents.send('project:files-updated', {
                  projectId: projectId,
                  filesCount: filesRegistered
                });
              }
            } else {
              console.warn('[Main] 没有可用的扫描路径，跳过文件注册');
            }
          } catch (scanError) {
            console.error('[Main] 扫描并注册文件失败:', scanError);
            // 不影响主流程，只记录错误
          }
        }

        return result;
      } catch (error) {
        console.error('[Main] 执行任务计划失败:', error);
        throw error;
      }
    });

    // 获取任务计划
    ipcMain.handle('project:get-task-plan', async (_event, taskPlanId) => {
      try {
        // 获取 AI 引擎管理器
        if (!this.aiEngineManager) {
          const { getAIEngineManager } = require('./ai-engine/ai-engine-manager');
          this.aiEngineManager = getAIEngineManager();
        }

        // 确保已初始化
        try {
          await this.aiEngineManager.initialize();
        } catch (initError) {
          console.error('[Main] AI引擎初始化失败:', initError);
          throw new Error(`AI引擎初始化失败: ${initError.message}`);
        }

        const taskPlanner = this.aiEngineManager.getTaskPlanner();
        const taskPlan = await taskPlanner.getTaskPlan(taskPlanId);

        return taskPlan;
      } catch (error) {
        console.error('[Main] 获取任务计划失败:', error);
        throw error;
      }
    });

    // 获取项目的任务计划历史
    ipcMain.handle('project:get-task-plan-history', async (_event, projectId, limit = 10) => {
      try {
        // 获取 AI 引擎管理器
        if (!this.aiEngineManager) {
          const { getAIEngineManager } = require('./ai-engine/ai-engine-manager');
          this.aiEngineManager = getAIEngineManager();
        }

        // 确保已初始化
        try {
          await this.aiEngineManager.initialize();
        } catch (initError) {
          console.error('[Main] AI引擎初始化失败:', initError);
          throw new Error(`AI引擎初始化失败: ${initError.message}`);
        }

        const taskPlanner = this.aiEngineManager.getTaskPlanner();
        const history = await taskPlanner.getTaskPlanHistory(projectId, limit);

        return history;
      } catch (error) {
        console.error('[Main] 获取任务计划历史失败:', error);
        throw error;
      }
    });

    // 取消任务计划
    ipcMain.handle('project:cancel-task-plan', async (_event, taskPlanId) => {
      try {
        // 获取 AI 引擎管理器
        if (!this.aiEngineManager) {
          const { getAIEngineManager } = require('./ai-engine/ai-engine-manager');
          this.aiEngineManager = getAIEngineManager();
        }

        // 确保已初始化
        try {
          await this.aiEngineManager.initialize();
        } catch (initError) {
          console.error('[Main] AI引擎初始化失败:', initError);
          throw new Error(`AI引擎初始化失败: ${initError.message}`);
        }

        const taskPlanner = this.aiEngineManager.getTaskPlanner();
        await taskPlanner.cancelTaskPlan(taskPlanId);

        return { success: true };
      } catch (error) {
        console.error('[Main] 取消任务计划失败:', error);
        throw error;
      }
    });

    // ============ 文档导出功能 ============

    // 导出文档为多种格式
    ipcMain.handle('project:exportDocument', async (_event, params) => {
      try {
        const { projectId, sourcePath, format, outputPath } = params;

        // 解析路径（将 /data/projects/xxx 转换为绝对路径）
        const projectConfig = getProjectConfig();
        const resolvedSourcePath = projectConfig.resolveProjectPath(sourcePath);
        const resolvedOutputPath = outputPath ? projectConfig.resolveProjectPath(outputPath) : null;

        console.log(`[Main] 导出文档: ${resolvedSourcePath} -> ${format}`);

        const documentEngine = new DocumentEngine();
        const result = await documentEngine.exportTo(resolvedSourcePath, format, resolvedOutputPath);

        return {
          success: true,
          fileName: path.basename(result.path),
          path: result.path
        };
      } catch (error) {
        console.error('[Main] 文档导出失败:', error);
        throw error;
      }
    });

    // ============ Dialog 对话框 ============

    // 显示打开对话框 - 已移至 FileIPC 类处理
    // 显示保存对话框 - 已移至 FileIPC 类处理

    // 显示消息框
    ipcMain.handle('dialog:showMessageBox', async (_event, options) => {
      try {
        const result = await dialog.showMessageBox(this.mainWindow, options);
        return result;
      } catch (error) {
        console.error('[Main] 显示消息框失败:', error);
        throw error;
      }
    });

    // 在文件管理器中显示文件
    ipcMain.handle('file:revealInExplorer', async (_event, { projectId, filePath }) => {
      try {
        const { shell } = require('electron');
        const path = require('path');
        const fs = require('fs');
        const { getProjectConfig } = require('./project/project-config');

        console.log('[Main] 在文件管理器中显示:', filePath);

        // 获取项目根路径
        const projectConfig = getProjectConfig();
        const rootPath = path.join(projectConfig.getProjectsRootPath(), projectId);

        const resolvedPath = path.join(rootPath, filePath);

        console.log('[Main] 解析后的路径:', resolvedPath);

        // 检查文件是否存在
        if (!fs.existsSync(resolvedPath)) {
          throw new Error(`文件不存在: ${resolvedPath}`);
        }

        // 使用 shell.showItemInFolder 在文件管理器中显示文件
        // 这个方法会在 Windows/Mac/Linux 上自动选择正确的文件管理器
        shell.showItemInFolder(path.normalize(resolvedPath));

        return { success: true, path: resolvedPath };
      } catch (error) {
        console.error('[Main] 在文件管理器中显示失败:', error);
        throw error;
      }
    });

    // 复制文件/文件夹
    ipcMain.handle('file:copyItem', async (_event, { projectId, sourcePath, targetPath }) => {
      try {
        const fs = require('fs').promises;
        const path = require('path');
        const { getProjectConfig } = require('./project/project-config');
        const projectConfig = getProjectConfig();

        console.log('[Main] 复制文件:', { sourcePath, targetPath });

        // 获取项目根路径
        const project = this.database.db.prepare('SELECT root_path FROM projects WHERE id = ?').get(projectId);
        if (!project?.root_path) {
          throw new Error('项目没有根路径');
        }

        const rootPath = project.root_path;
        const resolvedSourcePath = path.join(rootPath, sourcePath);
        const resolvedTargetPath = targetPath ? path.join(rootPath, targetPath, path.basename(sourcePath)) : resolvedSourcePath + '_copy';

        console.log('[Main] 源路径:', resolvedSourcePath);
        console.log('[Main] 目标路径:', resolvedTargetPath);

        // 递归复制函数
        async function copyRecursive(src, dest) {
          const stats = await fs.stat(src);

          if (stats.isDirectory()) {
            // 复制文件夹
            await fs.mkdir(dest, { recursive: true });
            const entries = await fs.readdir(src, { withFileTypes: true });

            for (const entry of entries) {
              await copyRecursive(
                path.join(src, entry.name),
                path.join(dest, entry.name)
              );
            }
          } else {
            // 复制文件
            await fs.mkdir(path.dirname(dest), { recursive: true });
            await fs.copyFile(src, dest);
          }
        }

        await copyRecursive(resolvedSourcePath, resolvedTargetPath);

        console.log('[Main] 文件复制成功');

        const newTargetPath = path.relative(rootPath, resolvedTargetPath);

        // 通知渲染进程刷新文件列表
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          this.mainWindow.webContents.send('project:files-updated', {
            projectId,
            action: 'copied',
            sourcePath,
            targetPath: newTargetPath
          });
        }

        return { success: true, targetPath: newTargetPath };
      } catch (error) {
        console.error('[Main] 复制文件失败:', error);
        throw error;
      }
    });

    // 移动文件/文件夹（用于剪切粘贴）
    ipcMain.handle('file:moveItem', async (_event, { projectId, sourcePath, targetPath }) => {
      try {
        const fs = require('fs').promises;
        const path = require('path');

        console.log('[Main] 移动文件:', { sourcePath, targetPath });

        // 获取项目根路径
        const project = this.database.db.prepare('SELECT root_path FROM projects WHERE id = ?').get(projectId);
        if (!project?.root_path) {
          throw new Error('项目没有根路径');
        }

        const rootPath = project.root_path;
        const resolvedSourcePath = path.join(rootPath, sourcePath);
        const resolvedTargetPath = path.join(rootPath, targetPath, path.basename(sourcePath));

        console.log('[Main] 源路径:', resolvedSourcePath);
        console.log('[Main] 目标路径:', resolvedTargetPath);

        // 确保目标目录存在
        await fs.mkdir(path.dirname(resolvedTargetPath), { recursive: true });

        // 移动文件/文件夹
        await fs.rename(resolvedSourcePath, resolvedTargetPath);

        console.log('[Main] 文件移动成功');

        const newTargetPath = path.relative(rootPath, resolvedTargetPath);

        // 通知渲染进程刷新文件列表
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          this.mainWindow.webContents.send('project:files-updated', {
            projectId,
            action: 'moved',
            sourcePath,
            targetPath: newTargetPath
          });
        }

        return { success: true, targetPath: newTargetPath };
      } catch (error) {
        console.error('[Main] 移动文件失败:', error);
        throw error;
      }
    });

    // 复制文件到系统剪贴板
    ipcMain.handle('file:copyToSystemClipboard', async (_event, { projectId, filePath, fullPath, isDirectory, fileName }) => {
      try {
        const { clipboard } = require('electron');
        const fs = require('fs').promises;
        const path = require('path');

        console.log('[Main] 复制文件到系统剪贴板:', { filePath, fullPath });

        // 获取项目根路径
        const project = this.database.db.prepare('SELECT root_path FROM projects WHERE id = ?').get(projectId);
        if (!project?.root_path) {
          throw new Error('项目没有根路径');
        }

        const rootPath = project.root_path;
        const resolvedPath = path.join(rootPath, filePath);

        console.log('[Main] 解析后的路径:', resolvedPath);

        // 检查文件是否存在
        const exists = await fs.access(resolvedPath).then(() => true).catch(() => false);
        if (!exists) {
          throw new Error(`文件不存在: ${resolvedPath}`);
        }

        // 将文件路径写入系统剪贴板（使用 Electron 的 clipboard API）
        // Windows 使用 CF_HDROP 格式
        clipboard.writeBuffer('FileNameW', Buffer.from(resolvedPath + '\0', 'ucs2'));

        console.log('[Main] 文件路径已写入系统剪贴板');

        return { success: true, filePath: resolvedPath };
      } catch (error) {
        console.error('[Main] 复制到系统剪贴板失败:', error);
        throw error;
      }
    });

    // 剪切文件到系统剪贴板
    ipcMain.handle('file:cutToSystemClipboard', async (_event, { projectId, filePath, fullPath, isDirectory, fileName }) => {
      try {
        const { clipboard } = require('electron');
        const fs = require('fs').promises;
        const path = require('path');

        console.log('[Main] 剪切文件到系统剪贴板:', { filePath, fullPath });

        // 获取项目根路径
        const project = this.database.db.prepare('SELECT root_path FROM projects WHERE id = ?').get(projectId);
        if (!project?.root_path) {
          throw new Error('项目没有根路径');
        }

        const rootPath = project.root_path;
        const resolvedPath = path.join(rootPath, filePath);

        console.log('[Main] 解析后的路径:', resolvedPath);

        // 检查文件是否存在
        const exists = await fs.access(resolvedPath).then(() => true).catch(() => false);
        if (!exists) {
          throw new Error(`文件不存在: ${resolvedPath}`);
        }

        // 剪切模式：将文件路径写入剪贴板，并标记为剪切操作
        // 使用特殊的标记来区分复制和剪切（Windows的Preferred DropEffect）
        clipboard.writeBuffer('FileNameW', Buffer.from(resolvedPath + '\0', 'ucs2'));
        clipboard.writeBuffer('Preferred DropEffect', Buffer.from([2, 0, 0, 0])); // DROPEFFECT_MOVE = 2

        console.log('[Main] 文件已标记为剪切并写入系统剪贴板');

        return { success: true, filePath: resolvedPath };
      } catch (error) {
        console.error('[Main] 剪切到系统剪贴板失败:', error);
        throw error;
      }
    });

    // 从系统剪贴板粘贴文件
    ipcMain.handle('file:pasteFromSystemClipboard', async () => {
      try {
        const { clipboard } = require('electron');

        console.log('[Main] 读取系统剪贴板');

        // 尝试读取文件路径
        const filePathBuffer = clipboard.readBuffer('FileNameW');

        if (!filePathBuffer || filePathBuffer.length === 0) {
          console.log('[Main] 系统剪贴板中没有文件');
          return { success: true, hasFiles: false };
        }

        // 解析文件路径（Windows使用UCS-2编码）
        const filePathStr = filePathBuffer.toString('ucs2').replace(/\0/g, '');
        const filePaths = filePathStr.split('\n').filter(p => p.trim());

        if (filePaths.length === 0) {
          return { success: true, hasFiles: false };
        }

        // 检查是否是剪切操作
        const dropEffectBuffer = clipboard.readBuffer('Preferred DropEffect');
        const isCut = dropEffectBuffer && dropEffectBuffer.length >= 4 && dropEffectBuffer[0] === 2;

        console.log('[Main] 系统剪贴板文件:', filePaths);
        console.log('[Main] 是否为剪切:', isCut);

        return {
          success: true,
          hasFiles: true,
          filePaths,
          isCut
        };
      } catch (error) {
        console.error('[Main] 读取系统剪贴板失败:', error);
        return { success: true, hasFiles: false };
      }
    });

    // 从系统剪贴板导入文件到项目
    ipcMain.handle('file:importFromSystemClipboard', async (_event, { projectId, targetPath, clipboardData }) => {
      try {
        const fs = require('fs').promises;
        const path = require('path');

        console.log('[Main] 从系统剪贴板导入文件:', clipboardData);

        // 获取项目根路径
        const project = this.database.db.prepare('SELECT root_path FROM projects WHERE id = ?').get(projectId);
        if (!project?.root_path) {
          throw new Error('项目没有根路径');
        }

        const rootPath = project.root_path;
        const resolvedTargetPath = targetPath ? path.join(rootPath, targetPath) : rootPath;

        console.log('[Main] 目标路径:', resolvedTargetPath);

        // 确保目标目录存在
        await fs.mkdir(resolvedTargetPath, { recursive: true });

        let count = 0;

        // 递归复制函数
        async function copyRecursive(src, dest) {
          const stats = await fs.stat(src);

          if (stats.isDirectory()) {
            await fs.mkdir(dest, { recursive: true });
            const entries = await fs.readdir(src, { withFileTypes: true });
            for (const entry of entries) {
              await copyRecursive(
                path.join(src, entry.name),
                path.join(dest, entry.name)
              );
            }
          } else {
            await fs.mkdir(path.dirname(dest), { recursive: true });
            await fs.copyFile(src, dest);
            count++;
          }
        }

        // 复制或移动每个文件
        for (const sourcePath of clipboardData.filePaths) {
          const fileName = path.basename(sourcePath);
          const destPath = path.join(resolvedTargetPath, fileName);

          if (clipboardData.isCut) {
            // 剪切：移动文件
            await fs.rename(sourcePath, destPath);
            count++;
            console.log('[Main] 移动文件:', sourcePath, '->', destPath);
          } else {
            // 复制：递归复制
            await copyRecursive(sourcePath, destPath);
            console.log('[Main] 复制文件:', sourcePath, '->', destPath);
          }
        }

        console.log('[Main] 系统剪贴板导入完成，文件数:', count);

        // 通知渲染进程刷新文件列表
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          this.mainWindow.webContents.send('project:files-updated', {
            projectId,
            action: 'imported',
            targetPath
          });
        }

        return { success: true, count };
      } catch (error) {
        console.error('[Main] 从系统剪贴板导入失败:', error);
        throw error;
      }
    });

    // 删除文件/文件夹
    ipcMain.handle('file:deleteItem', async (_event, { projectId, filePath }) => {
      try {
        const fs = require('fs').promises;
        const path = require('path');
        const { getProjectConfig } = require('./project/project-config');

        console.log('[Main] 删除文件:', filePath);

        // 获取项目根路径
        const projectConfig = getProjectConfig();
        const rootPath = path.join(projectConfig.getProjectsRootPath(), projectId);

        const resolvedPath = path.join(rootPath, filePath);

        console.log('[Main] 删除路径:', resolvedPath);

        // 递归删除
        const stats = await fs.stat(resolvedPath);
        if (stats.isDirectory()) {
          await fs.rm(resolvedPath, { recursive: true, force: true });
        } else {
          await fs.unlink(resolvedPath);
        }

        console.log('[Main] 文件删除成功');

        // 通知渲染进程刷新文件列表
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          this.mainWindow.webContents.send('project:files-updated', {
            projectId,
            action: 'deleted',
            filePath
          });
        }

        return { success: true };
      } catch (error) {
        console.error('[Main] 删除文件失败:', error);
        throw error;
      }
    });

    // 重命名文件/文件夹
    ipcMain.handle('file:renameItem', async (_event, { projectId, oldPath, newName }) => {
      try {
        const fs = require('fs').promises;
        const path = require('path');
        const { getProjectConfig } = require('./project/project-config');

        console.log('[Main] 重命名文件:', { oldPath, newName });

        // 获取项目根路径
        const projectConfig = getProjectConfig();
        const rootPath = path.join(projectConfig.getProjectsRootPath(), projectId);

        const resolvedOldPath = path.join(rootPath, oldPath);
        const resolvedNewPath = path.join(path.dirname(resolvedOldPath), newName);

        console.log('[Main] 旧路径:', resolvedOldPath);
        console.log('[Main] 新路径:', resolvedNewPath);

        // 重命名
        await fs.rename(resolvedOldPath, resolvedNewPath);

        console.log('[Main] 文件重命名成功');

        const newPath = path.relative(rootPath, resolvedNewPath);

        // 通知渲染进程刷新文件列表
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          this.mainWindow.webContents.send('project:files-updated', {
            projectId,
            action: 'renamed',
            oldPath,
            newPath
          });
        }

        return { success: true, newPath };
      } catch (error) {
        console.error('[Main] 重命名文件失败:', error);
        throw error;
      }
    });

    // 新建文件
    ipcMain.handle('file:createFile', async (_event, { projectId, filePath, content = '' }) => {
      try {
        const fs = require('fs').promises;
        const path = require('path');
        const { getProjectConfig } = require('./project/project-config');

        console.log('[Main] 新建文件:', filePath);

        // 获取项目根路径
        const projectConfig = getProjectConfig();
        const rootPath = path.join(projectConfig.getProjectsRootPath(), projectId);

        const resolvedPath = path.join(rootPath, filePath);

        console.log('[Main] 文件路径:', resolvedPath);

        // 确保目录存在
        await fs.mkdir(path.dirname(resolvedPath), { recursive: true });

        // 创建文件
        await fs.writeFile(resolvedPath, content, 'utf-8');

        console.log('[Main] 文件创建成功');

        // 通知渲染进程刷新文件列表
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          this.mainWindow.webContents.send('project:files-updated', {
            projectId,
            action: 'created',
            filePath
          });
        }

        return { success: true, filePath };
      } catch (error) {
        console.error('[Main] 创建文件失败:', error);
        throw error;
      }
    });

    // 新建文件夹
    ipcMain.handle('file:createFolder', async (_event, { projectId, folderPath }) => {
      try {
        const fs = require('fs').promises;
        const path = require('path');
        const { getProjectConfig } = require('./project/project-config');

        console.log('[Main] 新建文件夹:', folderPath);

        // 获取项目根路径
        const projectConfig = getProjectConfig();
        const rootPath = path.join(projectConfig.getProjectsRootPath(), projectId);

        const resolvedPath = path.join(rootPath, folderPath);

        console.log('[Main] 文件夹路径:', resolvedPath);

        // 创建文件夹
        await fs.mkdir(resolvedPath, { recursive: true });

        console.log('[Main] 文件夹创建成功');

        // 通知渲染进程刷新文件列表
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          this.mainWindow.webContents.send('project:files-updated', {
            projectId,
            action: 'created',
            filePath: folderPath
          });
        }

        return { success: true, folderPath };
      } catch (error) {
        console.error('[Main] 创建文件夹失败:', error);
        throw error;
      }
    });

    // 用系统默认程序打开文件
    ipcMain.handle('file:openWithDefault', async (_event, { projectId, filePath }) => {
      try {
        const { shell } = require('electron');
        const path = require('path');
        const fs = require('fs');
        const { getProjectConfig } = require('./project/project-config');

        console.log('[Main] 用默认程序打开文件:', filePath);

        // 获取项目根路径
        const projectConfig = getProjectConfig();
        const rootPath = path.join(projectConfig.getProjectsRootPath(), projectId);

        const resolvedPath = path.join(rootPath, filePath);

        console.log('[Main] 解析后的路径:', resolvedPath);

        // 检查文件是否存在
        if (!fs.existsSync(resolvedPath)) {
          throw new Error(`文件不存在: ${resolvedPath}`);
        }

        // 使用系统默认程序打开文件
        const result = await shell.openPath(path.normalize(resolvedPath));

        if (result) {
          // 如果返回非空字符串，表示打开失败
          throw new Error(`打开文件失败: ${result}`);
        }

        console.log('[Main] 文件已用默认程序打开');
        return { success: true, path: resolvedPath };
      } catch (error) {
        console.error('[Main] 打开文件失败:', error);
        throw error;
      }
    });

    // 选择程序打开文件（显示系统的"打开方式"对话框）
    ipcMain.handle('file:openWith', async (_event, { projectId, filePath }) => {
      try {
        const { spawn } = require('child_process');
        const path = require('path');
        const fs = require('fs');
        const os = require('os');
        const { getProjectConfig } = require('./project/project-config');

        console.log('[Main] 选择程序打开文件:', filePath);

        // 获取项目根路径
        const projectConfig = getProjectConfig();
        const rootPath = path.join(projectConfig.getProjectsRootPath(), projectId);

        const resolvedPath = path.join(rootPath, filePath);

        console.log('[Main] 解析后的路径:', resolvedPath);

        // 检查文件是否存在
        if (!fs.existsSync(resolvedPath)) {
          throw new Error(`文件不存在: ${resolvedPath}`);
        }

        const normalizedPath = path.normalize(resolvedPath);
        const platform = os.platform();

        // 根据不同平台调用相应的"打开方式"命令
        if (platform === 'win32') {
          // Windows: 使用 rundll32 显示"打开方式"对话框
          spawn('rundll32.exe', ['shell32.dll,OpenAs_RunDLL', normalizedPath], {
            detached: true,
            stdio: 'ignore'
          }).unref();
        } else if (platform === 'darwin') {
          // macOS: 使用 open -a 让用户选择应用
          // 注意：macOS 没有直接的"打开方式"对话框，这里提供一个替代方案
          spawn('open', ['-a', 'Finder', normalizedPath], {
            detached: true,
            stdio: 'ignore'
          }).unref();
        } else {
          // Linux: 不同发行版有不同的方式
          // 尝试使用 xdg-open 或让用户手动选择
          throw new Error('Linux 平台暂不支持"打开方式"对话框，请使用默认程序打开');
        }

        console.log('[Main] "打开方式"对话框已显示');
        return { success: true, path: resolvedPath };
      } catch (error) {
        console.error('[Main] 显示"打开方式"对话框失败:', error);
        throw error;
      }
    });

    // 用指定程序打开文件
    ipcMain.handle('file:openWithProgram', async (_event, { filePath, programPath }) => {
      try {
        const { spawn } = require('child_process');
        const path = require('path');
        const fs = require('fs');

        console.log('[Main] 用指定程序打开文件:', { filePath, programPath });

        // 解析文件路径
        const { getProjectConfig } = require('./project/project-config');
        const projectConfig = getProjectConfig();
        const resolvedFilePath = projectConfig.resolveProjectPath(filePath);

        console.log('[Main] 解析后的文件路径:', resolvedFilePath);
        console.log('[Main] 程序路径:', programPath);

        // 检查文件是否存在
        if (!fs.existsSync(resolvedFilePath)) {
          throw new Error(`文件不存在: ${resolvedFilePath}`);
        }

        // 检查程序是否存在
        if (!fs.existsSync(programPath)) {
          throw new Error(`程序不存在: ${programPath}`);
        }

        // 使用指定程序打开文件
        spawn(programPath, [path.normalize(resolvedFilePath)], {
          detached: true,
          stdio: 'ignore'
        }).unref();

        console.log('[Main] 文件已用指定程序打开');
        return { success: true };
      } catch (error) {
        console.error('[Main] 用指定程序打开文件失败:', error);
        throw error;
      }
    });

    // ============ PPT 相关功能 ============

    // 生成PPT
    ipcMain.handle('project:generatePPT', async (_event, params) => {
      try {
        const { projectId, sourcePath } = params;

        // 解析路径（将 /data/projects/xxx 转换为绝对路径）
        const projectConfig = getProjectConfig();
        const resolvedSourcePath = projectConfig.resolveProjectPath(sourcePath);

        console.log(`[Main] 生成PPT: ${resolvedSourcePath}`);

        const fs = require('fs').promises;
        const PPTEngine = require('./engines/ppt-engine');

        // 读取Markdown内容
        const markdownContent = await fs.readFile(resolvedSourcePath, 'utf-8');

        // 生成PPT
        const pptEngine = new PPTEngine();
        const result = await pptEngine.generateFromMarkdown(markdownContent, {
          outputPath: resolvedSourcePath.replace(/\.md$/, '.pptx'),
          llmManager: this.llmManager
        });

        return {
          success: true,
          fileName: result.fileName,
          path: result.path,
          slideCount: result.slideCount
        };
      } catch (error) {
        console.error('[Main] PPT生成失败:', error);
        throw error;
      }
    });

    // 从PPT编辑器导出为 .pptx 文件
    ipcMain.handle('ppt:export', async (_event, params) => {
      try {
        const { slides, title = '演示文稿', author = '作者', theme = 'business', outputPath } = params;

        console.log(`[Main] 导出PPT: ${title}, 幻灯片数: ${slides.length}`);

        const { dialog } = require('electron');
        const PPTEngine = require('./engines/ppt-engine');
        const pptEngine = new PPTEngine();

        // 如果没有指定输出路径，让用户选择
        let savePath = outputPath;
        if (!savePath) {
          const result = await dialog.showSaveDialog({
            title: '导出PPT',
            defaultPath: `${title}.pptx`,
            filters: [
              { name: 'PowerPoint演示文稿', extensions: ['pptx'] }
            ]
          });

          if (result.canceled) {
            return { success: false, canceled: true };
          }
          savePath = result.filePath;
        }

        // 将编辑器的幻灯片数据转换为大纲格式
        const outline = this.convertSlidesToOutline(slides, title);

        // 生成PPT文件
        const result = await pptEngine.generateFromOutline(outline, {
          theme,
          author,
          outputPath: savePath
        });

        return {
          success: true,
          path: result.path,
          fileName: path.basename(result.path),
          slideCount: result.slideCount
        };
      } catch (error) {
        console.error('[Main] PPT导出失败:', error);
        throw error;
      }
    });

    // 生成播客脚本
    ipcMain.handle('project:generatePodcastScript', async (_event, params) => {
      try {
        const { projectId, sourcePath } = params;

        // 解析路径（将 /data/projects/xxx 转换为绝对路径）
        const projectConfig = getProjectConfig();
        const resolvedSourcePath = projectConfig.resolveProjectPath(sourcePath);

        console.log(`[Main] 生成播客脚本: ${resolvedSourcePath}`);

        const fs = require('fs').promises;

        // 读取文档内容
        const content = await fs.readFile(resolvedSourcePath, 'utf-8');

        // 使用LLM转换为播客脚本
        const prompt = `请将以下文章内容转换为适合播客朗读的口语化脚本：

${content}

要求：
1. 使用第一人称，自然流畅
2. 增加过渡语和互动语言
3. 适合音频传播
4. 保持原文核心内容`;

        const response = await this.llmManager.query(prompt, {
          temperature: 0.7,
          maxTokens: 3000
        });

        // 保存脚本
        const outputPath = resolvedSourcePath.replace(/\.[^.]+$/, '_podcast.txt');
        await fs.writeFile(outputPath, response.text, 'utf-8');

        return {
          success: true,
          fileName: path.basename(outputPath),
          path: outputPath,
          content: response.text
        };
      } catch (error) {
        console.error('[Main] 播客脚本生成失败:', error);
        throw error;
      }
    });

    // ==================== 项目模板管理 ====================

    // 获取所有模板
    ipcMain.handle('template:getAll', async (_event, filters = {}) => {
      try {
        if (!this.templateManager) {
          throw new Error('模板管理器未初始化');
        }
        const templates = await this.templateManager.getAllTemplates(filters);
        return { success: true, templates };
      } catch (error) {
        console.error('[Template] 获取模板列表失败:', error);
        return { success: false, error: error.message };
      }
    });

    // 根据ID获取模板
    ipcMain.handle('template:getById', async (_event, templateId) => {
      try {
        if (!this.templateManager) {
          throw new Error('模板管理器未初始化');
        }
        const template = await this.templateManager.getTemplateById(templateId);
        return { success: true, template };
      } catch (error) {
        console.error('[Template] 获取模板失败:', error);
        return { success: false, error: error.message };
      }
    });

    // 搜索模板
    ipcMain.handle('template:search', async (_event, keyword, filters = {}) => {
      try {
        if (!this.templateManager) {
          throw new Error('模板管理器未初始化');
        }
        const templates = await this.templateManager.searchTemplates(keyword, filters);
        return { success: true, templates };
      } catch (error) {
        console.error('[Template] 搜索模板失败:', error);
        return { success: false, error: error.message };
      }
    });

    // 渲染模板提示词
    ipcMain.handle('template:renderPrompt', async (_event, templateId, userVariables) => {
      try {
        if (!this.templateManager) {
          throw new Error('模板管理器未初始化');
        }

        let template = await this.templateManager.getTemplateById(templateId);

        // 如果模板的 prompt_template 为空，尝试重新加载
        if (!template.prompt_template || template.prompt_template.trim() === '') {
          console.warn(`[Template] 模板 ${templateId} 的 prompt_template 为空，尝试重新初始化模板`);

          // 重新初始化模板（强制重新加载）
          this.templateManager.templatesLoaded = false;
          await this.templateManager.initialize();

          // 重新获取模板
          template = await this.templateManager.getTemplateById(templateId);

          if (!template.prompt_template || template.prompt_template.trim() === '') {
            throw new Error(`模板 ${templateId} (${template.display_name}) 的 prompt_template 字段为空，请检查模板文件是否正确`);
          }
        }

        const renderedPrompt = this.templateManager.renderPrompt(template, userVariables);
        return { success: true, renderedPrompt };
      } catch (error) {
        console.error('[Template] 渲染模板提示词失败:', error);
        return { success: false, error: error.message };
      }
    });

    // 记录模板使用
    ipcMain.handle('template:recordUsage', async (_event, templateId, userId, projectId, variablesUsed) => {
      try {
        if (!this.templateManager) {
          throw new Error('模板管理器未初始化');
        }
        await this.templateManager.recordTemplateUsage(templateId, userId, projectId, variablesUsed);
        return { success: true };
      } catch (error) {
        console.error('[Template] 记录模板使用失败:', error);
        return { success: false, error: error.message };
      }
    });

    // 提交模板评价
    ipcMain.handle('template:rate', async (_event, templateId, userId, rating, review) => {
      try {
        if (!this.templateManager) {
          throw new Error('模板管理器未初始化');
        }
        await this.templateManager.rateTemplate(templateId, userId, rating, review);
        return { success: true };
      } catch (error) {
        console.error('[Template] 提交模板评价失败:', error);
        return { success: false, error: error.message };
      }
    });

    // 获取模板统计
    ipcMain.handle('template:getStats', async (_event) => {
      try {
        if (!this.templateManager) {
          throw new Error('模板管理器未初始化');
        }
        const stats = await this.templateManager.getTemplateStats();
        return stats;
      } catch (error) {
        console.error('[Template] 获取模板统计失败:', error);
        throw error;
      }
    });

    // 获取用户最近使用的模板
    ipcMain.handle('template:getRecent', async (_event, userId, limit = 10) => {
      try {
        if (!this.templateManager) {
          throw new Error('模板管理器未初始化');
        }
        const templates = await this.templateManager.getRecentTemplates(userId, limit);
        return templates;
      } catch (error) {
        console.error('[Template] 获取最近使用模板失败:', error);
        throw error;
      }
    });

    // 获取热门模板
    ipcMain.handle('template:getPopular', async (_event, limit = 20) => {
      try {
        if (!this.templateManager) {
          throw new Error('模板管理器未初始化');
        }
        const templates = await this.templateManager.getPopularTemplates(limit);
        return templates;
      } catch (error) {
        console.error('[Template] 获取热门模板失败:', error);
        throw error;
      }
    });

    // 创建模板
    ipcMain.handle('template:create', async (_event, templateData) => {
      try {
        if (!this.templateManager) {
          throw new Error('模板管理器未初始化');
        }
        const template = await this.templateManager.createTemplate(templateData);
        return { success: true, template };
      } catch (error) {
        console.error('[Template] 创建模板失败:', error);
        return { success: false, error: error.message };
      }
    });

    // 更新模板
    ipcMain.handle('template:update', async (_event, templateId, updates) => {
      try {
        if (!this.templateManager) {
          throw new Error('模板管理器未初始化');
        }
        const template = await this.templateManager.updateTemplate(templateId, updates);
        return { success: true, template };
      } catch (error) {
        console.error('[Template] 更新模板失败:', error);
        return { success: false, error: error.message };
      }
    });

    // 删除模板
    ipcMain.handle('template:delete', async (_event, templateId) => {
      try {
        if (!this.templateManager) {
          throw new Error('模板管理器未初始化');
        }
        await this.templateManager.deleteTemplate(templateId);
        return { success: true };
      } catch (error) {
        console.error('[Template] 删除模板失败:', error);
        return { success: false, error: error.message };
      }
    });

    // 复制模板（用于基于现有模板创建新模板）
    ipcMain.handle('template:duplicate', async (_event, templateId, newName) => {
      try {
        if (!this.templateManager) {
          throw new Error('模板管理器未初始化');
        }

        // 获取原模板
        const originalTemplate = await this.templateManager.getTemplateById(templateId);

        // 创建副本
        const duplicateData = {
          ...originalTemplate,
          name: newName || `${originalTemplate.name}_copy`,
          display_name: newName || `${originalTemplate.display_name} (副本)`,
          is_builtin: false
        };

        // 删除不需要复制的字段
        delete duplicateData.id;
        delete duplicateData.created_at;
        delete duplicateData.updated_at;
        delete duplicateData.usage_count;
        delete duplicateData.rating;
        delete duplicateData.rating_count;

        const newTemplate = await this.templateManager.createTemplate(duplicateData);
        return { success: true, template: newTemplate };
      } catch (error) {
        console.error('[Template] 复制模板失败:', error);
        return { success: false, error: error.message };
      }
    });

    // 生成文章配图
    ipcMain.handle('project:generateArticleImages', async (_event, params) => {
      try {
        const { projectId, sourcePath } = params;

        // 解析路径（将 /data/projects/xxx 转换为绝对路径）
        const projectConfig = getProjectConfig();
        const resolvedSourcePath = projectConfig.resolveProjectPath(sourcePath);

        console.log(`[Main] 生成文章配图: ${resolvedSourcePath}`);

        const fs = require('fs').promises;

        // 读取文档内容
        const content = await fs.readFile(resolvedSourcePath, 'utf-8');

        // 使用LLM提取关键主题
        const prompt = `请分析以下文章，提取3-5个适合配图的关键主题：

${content.substring(0, 2000)}

请以JSON数组格式返回主题列表，每个主题包含：
- title: 主题标题
- description: 图片描述（用于AI绘图）

格式示例：
[
  {"title": "主题1", "description": "详细的图片描述"},
  {"title": "主题2", "description": "详细的图片描述"}
]`;

        const response = await this.llmManager.query(prompt, {
          temperature: 0.7,
          maxTokens: 1000
        });

        // 解析主题
        let themes = [];
        try {
          const jsonMatch = response.text.match(/\[[\s\S]*\]/);
          if (jsonMatch) {
            themes = JSON.parse(jsonMatch[0]);
          }
        } catch (parseError) {
          console.warn('[Main] 解析主题失败，使用默认主题');
          themes = [
            { title: '文章插图1', description: '根据文章内容创作的插图' }
          ];
        }

        // 创建图片目录
        const imageDir = resolvedSourcePath.replace(/\.[^.]+$/, '_images');
        await fs.mkdir(imageDir, { recursive: true });

        // 保存主题列表
        const themesPath = path.join(imageDir, 'themes.json');
        await fs.writeFile(themesPath, JSON.stringify(themes, null, 2), 'utf-8');

        return {
          success: true,
          path: imageDir,
          themes,
          message: '主题已生成，请使用AI绘图工具生成实际图片'
        };
      } catch (error) {
        console.error('[Main] 文章配图生成失败:', error);
        throw error;
      }
    });

    // ============ 项目分享功能 ============

    // 分享项目
    // 创建或更新项目分享
    ipcMain.handle('project:shareProject', async (_event, params) => {
      try {
        const { projectId, shareMode, expiresInDays, regenerateToken } = params;
        console.log(`[Main] 分享项目: ${projectId}, 模式: ${shareMode}`);

        if (!this.database) {
          throw new Error('数据库未初始化');
        }

        // 获取分享管理器
        if (!this.shareManager) {
          const { getShareManager } = require('./project/share-manager');
          this.shareManager = getShareManager(this.database);
        }

        // 创建或更新分享
        const result = await this.shareManager.createOrUpdateShare(projectId, shareMode, {
          expiresInDays,
          regenerateToken
        });

        // 如果是公开模式，可以发布到社交模块（暂未实现）
        if (shareMode === 'public') {
          console.log('[Main] 项目设置为公开访问');
          // TODO: 集成社交模块
        }

        return {
          success: true,
          shareLink: result.share.share_link,
          shareToken: result.share.share_token,
          shareMode: result.share.share_mode,
          share: result.share
        };
      } catch (error) {
        console.error('[Main] 项目分享失败:', error);
        throw error;
      }
    });

    // 获取项目分享信息
    ipcMain.handle('project:getShare', async (_event, projectId) => {
      try {
        console.log(`[Main] 获取项目分享信息: ${projectId}`);

        if (!this.database) {
          throw new Error('数据库未初始化');
        }

        if (!this.shareManager) {
          const { getShareManager } = require('./project/share-manager');
          this.shareManager = getShareManager(this.database);
        }

        const share = this.shareManager.getShareByProjectId(projectId);

        return {
          success: true,
          share
        };
      } catch (error) {
        console.error('[Main] 获取分享信息失败:', error);
        throw error;
      }
    });

    // 删除项目分享
    ipcMain.handle('project:deleteShare', async (_event, projectId) => {
      try {
        console.log(`[Main] 删除项目分享: ${projectId}`);

        if (!this.database) {
          throw new Error('数据库未初始化');
        }

        if (!this.shareManager) {
          const { getShareManager } = require('./project/share-manager');
          this.shareManager = getShareManager(this.database);
        }

        const success = this.shareManager.deleteShare(projectId);

        return {
          success
        };
      } catch (error) {
        console.error('[Main] 删除分享失败:', error);
        throw error;
      }
    });

    // 根据token访问分享项目
    ipcMain.handle('project:accessShare', async (_event, token) => {
      try {
        console.log(`[Main] 访问分享项目: ${token}`);

        if (!this.database) {
          throw new Error('数据库未初始化');
        }

        if (!this.shareManager) {
          const { getShareManager } = require('./project/share-manager');
          this.shareManager = getShareManager(this.database);
        }

        const share = this.shareManager.getShareByToken(token);

        if (!share) {
          throw new Error('分享不存在');
        }

        if (share.is_expired) {
          throw new Error('分享已过期');
        }

        if (!share.accessible) {
          throw new Error('分享已设置为私密');
        }

        // 增加访问计数
        this.shareManager.incrementAccessCount(token);

        return {
          success: true,
          share
        };
      } catch (error) {
        console.error('[Main] 访问分享失败:', error);
        throw error;
      }
    });

    // 微信分享（生成二维码）
    ipcMain.handle('project:shareToWechat', async (_event, params) => {
      try {
        const { projectId, shareLink } = params;
        console.log(`[Main] 微信分享: ${shareLink}`);

        // TODO: 集成二维码生成库
        // const QRCode = require('qrcode');
        // const qrCodeDataURL = await QRCode.toDataURL(shareLink);

        return {
          success: true,
          message: '微信分享功能开发中，请使用复制链接'
        };
      } catch (error) {
        console.error('[Main] 微信分享失败:', error);
        throw error;
      }
    });

    // ============ AI内容润色功能 ============

    // 润色内容
    ipcMain.handle('project:polishContent', async (_event, params) => {
      try {
        const { content, style } = params;
        console.log('[Main] AI内容润色');

        const prompt = `请对以下内容进行润色，使其更加专业、流畅：

${content}

要求：
1. 保持原意不变
2. 改进表达方式
3. 修正语法错误
4. 使用恰当的专业术语
${style ? `5. 风格：${style}` : ''}`;

        const response = await this.llmManager.query(prompt, {
          temperature: 0.7,
          maxTokens: 3000
        });

        return {
          success: true,
          polishedContent: response.text
        };
      } catch (error) {
        console.error('[Main] 内容润色失败:', error);
        throw error;
      }
    });

    // 扩写内容
    ipcMain.handle('project:expandContent', async (_event, params) => {
      try {
        const { content, targetLength } = params;
        console.log('[Main] AI内容扩写');

        const prompt = `请扩展以下内容，增加更多细节和例子${targetLength ? `，目标字数约${targetLength}字` : ''}：

${content}

要求：
1. 保持原有观点和结构
2. 增加具体例子和数据支持
3. 使内容更加详实完整`;

        const response = await this.llmManager.query(prompt, {
          temperature: 0.7,
          maxTokens: 4000
        });

        return {
          success: true,
          expandedContent: response.text
        };
      } catch (error) {
        console.error('[Main] 内容扩写失败:', error);
        throw error;
      }
    });

    // 复制文件
    ipcMain.handle('project:copyFile', async (_event, params) => {
      try {
        const { sourcePath, targetPath } = params;

        // 解析路径（将 /data/projects/xxx 转换为绝对路径）
        const projectConfig = getProjectConfig();
        const resolvedSourcePath = projectConfig.resolveProjectPath(sourcePath);
        const resolvedTargetPath = projectConfig.resolveProjectPath(targetPath);

        console.log(`[Main] 复制文件: ${resolvedSourcePath} -> ${resolvedTargetPath}`);

        const fs = require('fs').promises;
        await fs.copyFile(resolvedSourcePath, resolvedTargetPath);

        return {
          success: true,
          fileName: path.basename(resolvedTargetPath),
          path: resolvedTargetPath
        };
      } catch (error) {
        console.error('[Main] 文件复制失败:', error);
        throw error;
      }
    });

    // 移动文件（项目内拖拽）
    ipcMain.handle('project:move-file', async (_event, params) => {
      try {
        const { projectId, fileId, sourcePath, targetPath } = params;
        console.log(`[Main] 移动文件: ${sourcePath} -> ${targetPath}`);

        const fs = require('fs').promises;
        const projectConfig = getProjectConfig();

        // 解析路径
        const resolvedSourcePath = projectConfig.resolveProjectPath(sourcePath);
        const resolvedTargetPath = projectConfig.resolveProjectPath(targetPath);

        // 确保目标目录存在
        const targetDir = path.dirname(resolvedTargetPath);
        await fs.mkdir(targetDir, { recursive: true });

        // 移动文件
        await fs.rename(resolvedSourcePath, resolvedTargetPath);

        // 更新数据库中的文件记录
        if (projectId && fileId) {
          const db = getDatabaseConnection();
          const newFileName = path.basename(resolvedTargetPath);
          const newFilePath = targetPath;

          const updateSQL = `
            UPDATE project_files
            SET file_name = ?, file_path = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND project_id = ?
          `;
          await db.run(updateSQL, [newFileName, newFilePath, fileId, projectId]);
          await saveDatabase();
          console.log(`[Main] 文件记录已更新: ${fileId}`);
        }

        return {
          success: true,
          fileName: path.basename(resolvedTargetPath),
          path: resolvedTargetPath
        };
      } catch (error) {
        console.error('[Main] 文件移动失败:', error);
        throw error;
      }
    });

    // 从外部导入文件到项目
    ipcMain.handle('project:import-file', async (_event, params) => {
      try {
        const { projectId, externalPath, targetPath } = params;
        console.log(`[Main] 导入文件: ${externalPath} -> ${targetPath}`);

        const fs = require('fs').promises;
        const projectConfig = getProjectConfig();

        // 解析目标路径
        const resolvedTargetPath = projectConfig.resolveProjectPath(targetPath);

        // 确保目标目录存在
        const targetDir = path.dirname(resolvedTargetPath);
        await fs.mkdir(targetDir, { recursive: true });

        // 复制文件（保留外部源文件）
        await fs.copyFile(externalPath, resolvedTargetPath);

        // 获取文件信息
        const stats = await fs.stat(resolvedTargetPath);
        const content = await fs.readFile(resolvedTargetPath, 'utf-8');

        // 添加到数据库
        const db = getDatabaseConnection();
        const fileId = require('crypto').randomUUID();
        const fileName = path.basename(resolvedTargetPath);
        const fileExt = path.extname(fileName).substring(1);

        const insertSQL = `
          INSERT INTO project_files (
            id, project_id, file_name, file_path, file_type, file_size, content,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `;

        await db.run(insertSQL, [
          fileId,
          projectId,
          fileName,
          targetPath,
          fileExt || 'unknown',
          stats.size,
          content
        ]);
        await saveDatabase();

        console.log(`[Main] 文件导入成功: ${fileId}`);

        return {
          success: true,
          fileId: fileId,
          fileName: fileName,
          path: resolvedTargetPath,
          size: stats.size
        };
      } catch (error) {
        console.error('[Main] 文件导入失败:', error);
        throw error;
      }
    });

    // 导出文件到外部
    ipcMain.handle('project:export-file', async (_event, params) => {
      try {
        const { projectPath, targetPath, isDirectory } = params;
        console.log(`[Main] 导出文件参数:`, params);

        const fs = require('fs').promises;
        const projectConfig = getProjectConfig();

        // 解析项目内路径
        const resolvedSourcePath = projectConfig.resolveProjectPath(projectPath);
        console.log(`[Main] 解析后的源路径: ${resolvedSourcePath}`);
        console.log(`[Main] 目标路径: ${targetPath}`);

        // 检查源文件/文件夹是否存在
        try {
          await fs.access(resolvedSourcePath);
        } catch (err) {
          console.error(`[Main] 源文件不存在: ${resolvedSourcePath}`);
          throw new Error(`源文件不存在: ${projectPath}`);
        }

        const stats = await fs.stat(resolvedSourcePath);

        if (stats.isDirectory()) {
          // 递归复制目录
          console.log(`[Main] 复制目录: ${resolvedSourcePath} -> ${targetPath}`);
          await copyDirectory(resolvedSourcePath, targetPath);
        } else {
          // 确保目标目录存在
          const targetDir = path.dirname(targetPath);
          await fs.mkdir(targetDir, { recursive: true });

          // 复制单个文件
          console.log(`[Main] 复制文件: ${resolvedSourcePath} -> ${targetPath}`);
          await fs.copyFile(resolvedSourcePath, targetPath);
        }

        console.log(`[Main] 文件导出成功: ${targetPath}`);

        return {
          success: true,
          path: targetPath,
          isDirectory: stats.isDirectory()
        };
      } catch (error) {
        console.error('[Main] 文件导出失败:', error);
        return {
          success: false,
          error: error.message
        };
      }
    });

    // 批量导出文件到外部
    ipcMain.handle('project:export-files', async (_event, params) => {
      try {
        const { files, targetDirectory } = params;
        console.log(`[Main] 批量导出 ${files.length} 个文件到: ${targetDirectory}`);

        const fs = require('fs').promises;
        const projectConfig = getProjectConfig();
        const results = [];

        // 确保目标目录存在
        await fs.mkdir(targetDirectory, { recursive: true });

        for (const file of files) {
          try {
            const resolvedSourcePath = projectConfig.resolveProjectPath(file.path);
            const targetPath = path.join(targetDirectory, file.name);

            const stats = await fs.stat(resolvedSourcePath);

            if (stats.isDirectory()) {
              await copyDirectory(resolvedSourcePath, targetPath);
            } else {
              await fs.copyFile(resolvedSourcePath, targetPath);
            }

            results.push({
              success: true,
              name: file.name,
              path: targetPath
            });
          } catch (error) {
            console.error(`[Main] 导出文件失败: ${file.name}`, error);
            results.push({
              success: false,
              name: file.name,
              error: error.message
            });
          }
        }

        const successCount = results.filter(r => r.success).length;
        console.log(`[Main] 批量导出完成: ${successCount}/${files.length} 成功`);

        return {
          success: true,
          results,
          successCount,
          totalCount: files.length
        };
      } catch (error) {
        console.error('[Main] 批量导出失败:', error);
        throw error;
      }
    });

    // 选择导出目录对话框
    ipcMain.handle('project:select-export-directory', async (_event) => {
      try {
        const result = await dialog.showOpenDialog(mainWindow, {
          properties: ['openDirectory', 'createDirectory'],
          title: '选择导出目录'
        });

        if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
          return {
            success: false,
            canceled: true
          };
        }

        return {
          success: true,
          path: result.filePaths[0]
        };
      } catch (error) {
        console.error('[Main] 选择导出目录失败:', error);
        throw error;
      }
    });

    // 选择导入文件对话框
    ipcMain.handle('project:select-import-files', async (_event, options = {}) => {
      try {
        const dialogOptions = {
          properties: ['openFile', 'multiSelections'],
          title: '选择要导入的文件'
        };

        // 如果允许选择文件夹
        if (options.allowDirectory) {
          dialogOptions.properties.push('openDirectory');
        }

        // 文件过滤器
        if (options.filters) {
          dialogOptions.filters = options.filters;
        }

        const result = await dialog.showOpenDialog(mainWindow, dialogOptions);

        if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
          return {
            success: false,
            canceled: true
          };
        }

        return {
          success: true,
          filePaths: result.filePaths
        };
      } catch (error) {
        console.error('[Main] 选择导入文件失败:', error);
        throw error;
      }
    });

    // 批量导入文件到项目
    ipcMain.handle('project:import-files', async (_event, params) => {
      try {
        const { projectId, externalPaths, targetDirectory } = params;
        console.log(`[Main] 批量导入 ${externalPaths.length} 个文件到: ${targetDirectory}`);

        const fs = require('fs').promises;
        const projectConfig = getProjectConfig();
        const results = [];

        for (const externalPath of externalPaths) {
          try {
            const fileName = path.basename(externalPath);
            const targetPath = path.join(targetDirectory, fileName);
            const resolvedTargetPath = projectConfig.resolveProjectPath(targetPath);

            // 确保目标目录存在
            const targetDir = path.dirname(resolvedTargetPath);
            await fs.mkdir(targetDir, { recursive: true });

            // 检查源是文件还是目录
            const stats = await fs.stat(externalPath);

            if (stats.isDirectory()) {
              await copyDirectory(externalPath, resolvedTargetPath);
            } else {
              await fs.copyFile(externalPath, resolvedTargetPath);
            }

            // 读取文件内容（仅对文件，不对目录）
            let content = '';
            let fileSize = 0;

            if (stats.isFile()) {
              try {
                content = await fs.readFile(resolvedTargetPath, 'utf-8');
                fileSize = stats.size;
              } catch (err) {
                // 如果是二进制文件，忽略内容读取错误
                console.log(`[Main] 无法读取文件内容（可能是二进制文件）: ${fileName}`);
                fileSize = stats.size;
              }
            }

            // 添加到数据库
            const db = getDatabaseConnection();
            const fileId = require('crypto').randomUUID();
            const fileExt = path.extname(fileName).substring(1);

            const insertSQL = `
              INSERT INTO project_files (
                id, project_id, file_name, file_path, file_type, file_size, content,
                created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            `;

            await db.run(insertSQL, [
              fileId,
              projectId,
              fileName,
              targetPath,
              fileExt || 'unknown',
              fileSize,
              content
            ]);

            results.push({
              success: true,
              fileId,
              name: fileName,
              path: resolvedTargetPath
            });

            console.log(`[Main] 文件导入成功: ${fileName}`);
          } catch (error) {
            console.error(`[Main] 导入文件失败: ${path.basename(externalPath)}`, error);
            results.push({
              success: false,
              name: path.basename(externalPath),
              error: error.message
            });
          }
        }

        await saveDatabase();

        const successCount = results.filter(r => r.success).length;
        console.log(`[Main] 批量导入完成: ${successCount}/${externalPaths.length} 成功`);

        return {
          success: true,
          results,
          successCount,
          totalCount: externalPaths.length
        };
      } catch (error) {
        console.error('[Main] 批量导入失败:', error);
        throw error;
      }
    });

    // ==================== 项目RAG增强接口 ====================

    // 索引项目文件
    ipcMain.handle('project:indexFiles', async (_event, projectId, options = {}) => {
      try {
        console.log(`[Main] 索引项目文件: ${projectId}`);

        const { getProjectRAGManager } = require('./project/project-rag');
        const projectRAG = getProjectRAGManager();

        // 确保初始化
        await projectRAG.initialize();

        // 执行索引
        const result = await projectRAG.indexProjectFiles(projectId, options);

        console.log('[Main] 索引完成:', result);
        return result;
      } catch (error) {
        console.error('[Main] 索引项目文件失败:', error);
        throw error;
      }
    });

    // RAG增强查询
    ipcMain.handle('project:ragQuery', async (_event, projectId, query, options = {}) => {
      try {
        console.log(`[Main] RAG增强查询: ${query}`);

        const { getProjectRAGManager } = require('./project/project-rag');
        const projectRAG = getProjectRAGManager();

        // 确保初始化
        await projectRAG.initialize();

        // 执行增强查询
        const result = await projectRAG.enhancedQuery(projectId, query, options);

        console.log('[Main] RAG查询完成，找到', result.totalDocs, '个相关文档');
        return result;
      } catch (error) {
        console.error('[Main] RAG查询失败:', error);
        throw error;
      }
    });

    // 更新单个文件索引
    ipcMain.handle('project:updateFileIndex', async (_event, fileId) => {
      try {
        console.log(`[Main] 更新文件索引: ${fileId}`);

        const { getProjectRAGManager } = require('./project/project-rag');
        const projectRAG = getProjectRAGManager();

        await projectRAG.initialize();

        const result = await projectRAG.updateFileIndex(fileId);

        console.log('[Main] 文件索引更新完成');
        return result;
      } catch (error) {
        console.error('[Main] 更新文件索引失败:', error);
        throw error;
      }
    });

    // 删除项目索引
    ipcMain.handle('project:deleteIndex', async (_event, projectId) => {
      try {
        console.log(`[Main] 删除项目索引: ${projectId}`);

        const { getProjectRAGManager } = require('./project/project-rag');
        const projectRAG = getProjectRAGManager();

        await projectRAG.initialize();

        const result = await projectRAG.deleteProjectIndex(projectId);

        console.log('[Main] 项目索引删除完成');
        return result;
      } catch (error) {
        console.error('[Main] 删除项目索引失败:', error);
        throw error;
      }
    });

    // 获取项目索引统计
    ipcMain.handle('project:getIndexStats', async (_event, projectId) => {
      try {
        const { getProjectRAGManager } = require('./project/project-rag');
        const projectRAG = getProjectRAGManager();

        await projectRAG.initialize();

        const stats = await projectRAG.getIndexStats(projectId);

        return stats;
      } catch (error) {
        console.error('[Main] 获取索引统计失败:', error);
        throw error;
      }
    });

    // ==================== 项目RAG增强接口结束 ====================

    // ==================== 项目统计接口 ====================

    // 开始监听项目统计
    ipcMain.handle('project:stats:start', async (_event, projectId, projectPath) => {
      try {
        if (this.statsCollector) {
          this.statsCollector.startWatching(projectId, projectPath);
          return { success: true };
        }
        return { success: false, error: '统计收集器未初始化' };
      } catch (error) {
        console.error('[Main] 开始统计监听失败:', error);
        throw error;
      }
    });

    // 停止监听项目统计
    ipcMain.handle('project:stats:stop', async (_event, projectId) => {
      try {
        if (this.statsCollector) {
          this.statsCollector.stopWatching(projectId);
          return { success: true };
        }
        return { success: false, error: '统计收集器未初始化' };
      } catch (error) {
        console.error('[Main] 停止统计监听失败:', error);
        throw error;
      }
    });

    // 获取项目统计数据
    ipcMain.handle('project:stats:get', async (_event, projectId) => {
      try {
        if (this.statsCollector) {
          const stats = this.statsCollector.getStats(projectId);
          return stats;
        }
        return null;
      } catch (error) {
        console.error('[Main] 获取项目统计失败:', error);
        throw error;
      }
    });

    // 手动触发统计更新
    ipcMain.handle('project:stats:update', async (_event, projectId) => {
      try {
        if (this.statsCollector) {
          await this.statsCollector.updateStats(projectId, 'manual', null);
          return { success: true };
        }
        return { success: false, error: '统计收集器未初始化' };
      } catch (error) {
        console.error('[Main] 手动更新统计失败:', error);
        throw error;
      }
    });

    // ==================== 项目统计接口结束 ====================

    // ==================== PDF导出接口 ====================

    // Markdown转PDF
    ipcMain.handle('pdf:markdownToPDF', async (_event, params) => {
      try {
        const { markdown, outputPath, options } = params;

        const { getPDFEngine } = require('./engines/pdf-engine');
        const pdfEngine = getPDFEngine();

        const result = await pdfEngine.markdownToPDF(markdown, outputPath, options || {});

        console.log('[Main] Markdown转PDF完成:', outputPath);
        return result;
      } catch (error) {
        console.error('[Main] Markdown转PDF失败:', error);
        throw error;
      }
    });

    // HTML文件转PDF
    ipcMain.handle('pdf:htmlFileToPDF', async (_event, params) => {
      try {
        const { htmlPath, outputPath, options } = params;

        const { getPDFEngine } = require('./engines/pdf-engine');
        const pdfEngine = getPDFEngine();

        const result = await pdfEngine.htmlFileToPDF(htmlPath, outputPath, options || {});

        console.log('[Main] HTML文件转PDF完成:', outputPath);
        return result;
      } catch (error) {
        console.error('[Main] HTML文件转PDF失败:', error);
        throw error;
      }
    });

    // 文本文件转PDF
    ipcMain.handle('pdf:textFileToPDF', async (_event, params) => {
      try {
        const { textPath, outputPath, options } = params;

        const { getPDFEngine } = require('./engines/pdf-engine');
        const pdfEngine = getPDFEngine();

        const result = await pdfEngine.textFileToPDF(textPath, outputPath, options || {});

        console.log('[Main] 文本文件转PDF完成:', outputPath);
        return result;
      } catch (error) {
        console.error('[Main] 文本文件转PDF失败:', error);
        throw error;
      }
    });

    // 批量转换PDF
    ipcMain.handle('pdf:batchConvert', async (_event, params) => {
      try {
        const { files, outputDir, options } = params;

        const { getPDFEngine } = require('./engines/pdf-engine');
        const pdfEngine = getPDFEngine();

        const results = await pdfEngine.batchConvert(files, outputDir, options || {});

        console.log('[Main] 批量转换PDF完成:', results.length, '个文件');
        return results;
      } catch (error) {
        console.error('[Main] 批量转换PDF失败:', error);
        throw error;
      }
    });

    // ==================== PDF导出接口结束 ====================

    // ==================== Git AI提交信息接口 ====================

    // AI生成提交信息
    ipcMain.handle('git:generateCommitMessage', async (_event, projectPath) => {
      try {
        const AICommitMessageGenerator = require('./git/ai-commit-message');
        const generator = new AICommitMessageGenerator(this.llmManager);

        const result = await generator.generateCommitMessage(projectPath);

        console.log('[Main] AI生成提交信息成功');
        return result;
      } catch (error) {
        console.error('[Main] AI生成提交信息失败:', error);
        throw error;
      }
    });

    // ==================== Git AI提交信息接口结束 ====================

    // ==================== 模板引擎接口 ====================

    // 渲染模板
    ipcMain.handle('template:render', async (_event, params) => {
      try {
        const { template, variables } = params;
        const { getTemplateEngine } = require('./engines/template-engine');
        const templateEngine = getTemplateEngine();

        const result = templateEngine.render(template, variables);

        console.log('[Main] 模板渲染成功');
        return { success: true, result };
      } catch (error) {
        console.error('[Main] 模板渲染失败:', error);
        return { success: false, error: error.message };
      }
    });

    // 验证变量
    ipcMain.handle('template:validate', async (_event, params) => {
      try {
        const { variableDefinitions, userVariables } = params;
        const { getTemplateEngine } = require('./engines/template-engine');
        const templateEngine = getTemplateEngine();

        const validation = templateEngine.validateVariables(variableDefinitions, userVariables);

        console.log('[Main] 变量验证完成:', validation.valid ? '通过' : '失败');
        return validation;
      } catch (error) {
        console.error('[Main] 变量验证失败:', error);
        return { valid: false, errors: [{ message: error.message }] };
      }
    });

    // 预览模板渲染结果
    ipcMain.handle('template:preview', async (_event, params) => {
      try {
        const { template, variables } = params;
        const { getTemplateEngine } = require('./engines/template-engine');
        const templateEngine = getTemplateEngine();

        const result = templateEngine.preview(template, variables);

        console.log('[Main] 模板预览成功');
        return result;
      } catch (error) {
        console.error('[Main] 模板预览失败:', error);
        return { success: false, error: error.message };
      }
    });

    // 加载模板文件
    ipcMain.handle('template:loadTemplate', async (_event, templatePath) => {
      try {
        const { getTemplateEngine } = require('./engines/template-engine');
        const templateEngine = getTemplateEngine();

        const template = await templateEngine.loadTemplateFromFile(templatePath);

        console.log('[Main] 模板加载成功:', template.name);
        return { success: true, template };
      } catch (error) {
        console.error('[Main] 模板加载失败:', error);
        return { success: false, error: error.message };
      }
    });

    // 保存模板到文件
    ipcMain.handle('template:saveTemplate', async (_event, params) => {
      try {
        const { template, outputPath } = params;
        const { getTemplateEngine } = require('./engines/template-engine');
        const templateEngine = getTemplateEngine();

        await templateEngine.saveTemplateToFile(template, outputPath);

        console.log('[Main] 模板保存成功:', outputPath);
        return { success: true, outputPath };
      } catch (error) {
        console.error('[Main] 模板保存失败:', error);
        return { success: false, error: error.message };
      }
    });

    // 提取模板中的变量
    ipcMain.handle('template:extractVariables', async (_event, templateString) => {
      try {
        const { getTemplateEngine } = require('./engines/template-engine');
        const templateEngine = getTemplateEngine();

        const variables = templateEngine.extractVariables(templateString);

        console.log('[Main] 变量提取成功, 数量:', variables.length);
        return { success: true, variables };
      } catch (error) {
        console.error('[Main] 变量提取失败:', error);
        return { success: false, error: error.message };
      }
    });

    // 获取变量默认值
    ipcMain.handle('template:getDefaultVariables', async (_event, variableDefinitions) => {
      try {
        const { getTemplateEngine } = require('./engines/template-engine');
        const templateEngine = getTemplateEngine();

        const defaults = templateEngine.getDefaultVariables(variableDefinitions);

        console.log('[Main] 获取默认值成功');
        return { success: true, defaults };
      } catch (error) {
        console.error('[Main] 获取默认值失败:', error);
        return { success: false, error: error.message };
      }
    });

    // ==================== 模板引擎接口结束 ====================

    // ==================== 视频处理引擎接口 ====================

    // 视频格式转换
    ipcMain.handle('video:convert', async (_event, params) => {
      try {
        console.log('[Main] 视频格式转换:', params.outputFormat);

        const { getVideoEngine } = require('./engines/video-engine');
        const videoEngine = getVideoEngine(this.llmManager);

        const result = await videoEngine.handleProjectTask({
          taskType: 'convert',
          ...params
        }, (progress) => {
          if (this.mainWindow) {
            this.mainWindow.webContents.send('video:progress', progress);
          }
        });

        console.log('[Main] 视频转换完成');
        return result;
      } catch (error) {
        console.error('[Main] 视频转换失败:', error);
        throw error;
      }
    });

    // 视频剪辑
    ipcMain.handle('video:trim', async (_event, params) => {
      try {
        console.log('[Main] 视频剪辑:', params);

        const { getVideoEngine } = require('./engines/video-engine');
        const videoEngine = getVideoEngine(this.llmManager);

        const result = await videoEngine.handleProjectTask({
          taskType: 'trim',
          ...params
        }, (progress) => {
          if (this.mainWindow) {
            this.mainWindow.webContents.send('video:progress', progress);
          }
        });

        console.log('[Main] 视频剪辑完成');
        return result;
      } catch (error) {
        console.error('[Main] 视频剪辑失败:', error);
        throw error;
      }
    });

    // 合并视频
    ipcMain.handle('video:merge', async (_event, params) => {
      try {
        console.log('[Main] 合并视频:', params.videoList.length, '个文件');

        const { getVideoEngine } = require('./engines/video-engine');
        const videoEngine = getVideoEngine(this.llmManager);

        const result = await videoEngine.handleProjectTask({
          taskType: 'merge',
          ...params
        }, (progress) => {
          if (this.mainWindow) {
            this.mainWindow.webContents.send('video:progress', progress);
          }
        });

        console.log('[Main] 视频合并完成');
        return result;
      } catch (error) {
        console.error('[Main] 视频合并失败:', error);
        throw error;
      }
    });

    // 添加字幕
    ipcMain.handle('video:addSubtitles', async (_event, params) => {
      try {
        console.log('[Main] 添加字幕');

        const { getVideoEngine } = require('./engines/video-engine');
        const videoEngine = getVideoEngine(this.llmManager);

        const result = await videoEngine.handleProjectTask({
          taskType: 'addSubtitles',
          ...params
        }, (progress) => {
          if (this.mainWindow) {
            this.mainWindow.webContents.send('video:progress', progress);
          }
        });

        console.log('[Main] 字幕添加完成');
        return result;
      } catch (error) {
        console.error('[Main] 字幕添加失败:', error);
        throw error;
      }
    });

    // AI生成字幕
    ipcMain.handle('video:generateSubtitles', async (_event, params) => {
      try {
        console.log('[Main] AI生成字幕');

        const { getVideoEngine } = require('./engines/video-engine');
        const videoEngine = getVideoEngine(this.llmManager);

        const result = await videoEngine.handleProjectTask({
          taskType: 'generateSubtitles',
          ...params
        }, (progress) => {
          if (this.mainWindow) {
            this.mainWindow.webContents.send('video:progress', progress);
          }
        });

        console.log('[Main] 字幕生成完成');
        return result;
      } catch (error) {
        console.error('[Main] 字幕生成失败:', error);
        throw error;
      }
    });

    // 提取音频
    ipcMain.handle('video:extractAudio', async (_event, params) => {
      try {
        console.log('[Main] 提取音频');

        const { getVideoEngine } = require('./engines/video-engine');
        const videoEngine = getVideoEngine(this.llmManager);

        const result = await videoEngine.handleProjectTask({
          taskType: 'extractAudio',
          ...params
        }, (progress) => {
          if (this.mainWindow) {
            this.mainWindow.webContents.send('video:progress', progress);
          }
        });

        console.log('[Main] 音频提取完成');
        return result;
      } catch (error) {
        console.error('[Main] 音频提取失败:', error);
        throw error;
      }
    });

    // 生成缩略图
    ipcMain.handle('video:generateThumbnail', async (_event, params) => {
      try {
        console.log('[Main] 生成缩略图');

        const { getVideoEngine } = require('./engines/video-engine');
        const videoEngine = getVideoEngine(this.llmManager);

        const result = await videoEngine.handleProjectTask({
          taskType: 'generateThumbnail',
          ...params
        });

        console.log('[Main] 缩略图生成完成');
        return result;
      } catch (error) {
        console.error('[Main] 缩略图生成失败:', error);
        throw error;
      }
    });

    // 压缩视频
    ipcMain.handle('video:compress', async (_event, params) => {
      try {
        console.log('[Main] 压缩视频');

        const { getVideoEngine } = require('./engines/video-engine');
        const videoEngine = getVideoEngine(this.llmManager);

        const result = await videoEngine.handleProjectTask({
          taskType: 'compress',
          ...params
        }, (progress) => {
          if (this.mainWindow) {
            this.mainWindow.webContents.send('video:progress', progress);
          }
        });

        console.log('[Main] 视频压缩完成');
        return result;
      } catch (error) {
        console.error('[Main] 视频压缩失败:', error);
        throw error;
      }
    });

    // 获取视频信息
    ipcMain.handle('video:getInfo', async (_event, videoPath) => {
      try {
        const { getVideoEngine } = require('./engines/video-engine');
        const videoEngine = getVideoEngine(this.llmManager);

        const info = await videoEngine.getVideoInfo(videoPath);
        return info;
      } catch (error) {
        console.error('[Main] 获取视频信息失败:', error);
        throw error;
      }
    });

    // ==================== 视频处理引擎接口结束 ====================

    // ==================== 图像设计引擎接口 ====================

    // AI文生图
    ipcMain.handle('image:generateFromText', async (_event, params) => {
      try {
        console.log('[Main] AI文生图:', params.prompt.substring(0, 50));

        const { getImageEngine } = require('./engines/image-engine');
        const imageEngine = getImageEngine(this.llmManager);

        const result = await imageEngine.handleProjectTask({
          taskType: 'generateFromText',
          ...params
        }, (progress) => {
          if (this.mainWindow) {
            this.mainWindow.webContents.send('image:generation-progress', progress);
          }
        });

        console.log('[Main] 图片生成完成');
        return result;
      } catch (error) {
        console.error('[Main] 图片生成失败:', error);
        throw error;
      }
    });

    // 移除背景
    ipcMain.handle('image:removeBackground', async (_event, params) => {
      try {
        console.log('[Main] 移除背景');

        const { getImageEngine } = require('./engines/image-engine');
        const imageEngine = getImageEngine(this.llmManager);

        const result = await imageEngine.handleProjectTask({
          taskType: 'removeBackground',
          ...params
        }, (progress) => {
          if (this.mainWindow) {
            this.mainWindow.webContents.send('image:processing-progress', progress);
          }
        });

        console.log('[Main] 背景移除完成');
        return result;
      } catch (error) {
        console.error('[Main] 背景移除失败:', error);
        throw error;
      }
    });

    // 调整图片大小
    ipcMain.handle('image:resize', async (_event, params) => {
      try {
        console.log('[Main] 调整图片大小:', params.width, 'x', params.height);

        const { getImageEngine } = require('./engines/image-engine');
        const imageEngine = getImageEngine(this.llmManager);

        const result = await imageEngine.handleProjectTask({
          taskType: 'resize',
          ...params
        });

        console.log('[Main] 图片调整完成');
        return result;
      } catch (error) {
        console.error('[Main] 图片调整失败:', error);
        throw error;
      }
    });

    // 裁剪图片
    ipcMain.handle('image:crop', async (_event, params) => {
      try {
        console.log('[Main] 裁剪图片');

        const { getImageEngine } = require('./engines/image-engine');
        const imageEngine = getImageEngine(this.llmManager);

        const result = await imageEngine.handleProjectTask({
          taskType: 'crop',
          ...params
        });

        console.log('[Main] 图片裁剪完成');
        return result;
      } catch (error) {
        console.error('[Main] 图片裁剪失败:', error);
        throw error;
      }
    });

    // 增强图片
    ipcMain.handle('image:enhance', async (_event, params) => {
      try {
        console.log('[Main] 增强图片');

        const { getImageEngine } = require('./engines/image-engine');
        const imageEngine = getImageEngine(this.llmManager);

        const result = await imageEngine.handleProjectTask({
          taskType: 'enhance',
          ...params
        });

        console.log('[Main] 图片增强完成');
        return result;
      } catch (error) {
        console.error('[Main] 图片增强失败:', error);
        throw error;
      }
    });

    // 图片超分辨率
    ipcMain.handle('image:upscale', async (_event, params) => {
      try {
        console.log('[Main] 图片超分辨率');

        const { getImageEngine } = require('./engines/image-engine');
        const imageEngine = getImageEngine(this.llmManager);

        const result = await imageEngine.handleProjectTask({
          taskType: 'upscale',
          ...params
        }, (progress) => {
          if (this.mainWindow) {
            this.mainWindow.webContents.send('image:processing-progress', progress);
          }
        });

        console.log('[Main] 超分辨率完成');
        return result;
      } catch (error) {
        console.error('[Main] 超分辨率失败:', error);
        throw error;
      }
    });

    // 添加水印
    ipcMain.handle('image:addWatermark', async (_event, params) => {
      try {
        console.log('[Main] 添加水印');

        const { getImageEngine } = require('./engines/image-engine');
        const imageEngine = getImageEngine(this.llmManager);

        const result = await imageEngine.handleProjectTask({
          taskType: 'addWatermark',
          ...params
        });

        console.log('[Main] 水印添加完成');
        return result;
      } catch (error) {
        console.error('[Main] 水印添加失败:', error);
        throw error;
      }
    });

    // 批量处理图片
    ipcMain.handle('image:batchProcess', async (_event, params) => {
      try {
        console.log('[Main] 批量处理图片:', params.imageList.length, '张');

        const { getImageEngine } = require('./engines/image-engine');
        const imageEngine = getImageEngine(this.llmManager);

        const result = await imageEngine.handleProjectTask({
          taskType: 'batchProcess',
          ...params
        }, (progress) => {
          if (this.mainWindow) {
            this.mainWindow.webContents.send('image:batch-progress', progress);
          }
        });

        console.log('[Main] 批量处理完成');
        return result;
      } catch (error) {
        console.error('[Main] 批量处理失败:', error);
        throw error;
      }
    });

    // 转换图片格式
    ipcMain.handle('image:convertFormat', async (_event, params) => {
      try {
        console.log('[Main] 转换图片格式:', params.format);

        const { getImageEngine } = require('./engines/image-engine');
        const imageEngine = getImageEngine(this.llmManager);

        const result = await imageEngine.handleProjectTask({
          taskType: 'convertFormat',
          ...params
        });

        console.log('[Main] 格式转换完成');
        return result;
      } catch (error) {
        console.error('[Main] 格式转换失败:', error);
        throw error;
      }
    });

    // 创建图片拼贴
    ipcMain.handle('image:createCollage', async (_event, params) => {
      try {
        console.log('[Main] 创建图片拼贴:', params.imageList.length, '张');

        const { getImageEngine } = require('./engines/image-engine');
        const imageEngine = getImageEngine(this.llmManager);

        const result = await imageEngine.handleProjectTask({
          taskType: 'createCollage',
          ...params
        });

        console.log('[Main] 拼贴创建完成');
        return result;
      } catch (error) {
        console.error('[Main] 拼贴创建失败:', error);
        throw error;
      }
    });

    // 获取图片信息
    ipcMain.handle('image:getInfo', async (_event, imagePath) => {
      try {
        const { getImageEngine } = require('./engines/image-engine');
        const imageEngine = getImageEngine(this.llmManager);

        const info = await imageEngine.getImageInfo(imagePath);
        return info;
      } catch (error) {
        console.error('[Main] 获取图片信息失败:', error);
        throw error;
      }
    });

    // ==================== 图像设计引擎接口结束 ====================

    // ==================== 代码开发引擎接口 ====================

    // 生成代码
    ipcMain.handle('code:generate', async (_event, description, options = {}) => {
      try {
        console.log('[Main] 生成代码:', description);

        const { getCodeEngine } = require('./engines/code-engine');
        const codeEngine = getCodeEngine(this.llmManager);

        const result = await codeEngine.handleProjectTask({
          taskType: 'generateCode',
          description: description,
          language: options.language || 'javascript',
          options: options
        });

        console.log('[Main] 代码生成完成');
        return result;
      } catch (error) {
        console.error('[Main] 代码生成失败:', error);
        throw error;
      }
    });

    // 生成单元测试
    ipcMain.handle('code:generateTests', async (_event, code, language) => {
      try {
        console.log('[Main] 生成单元测试:', language);

        const { getCodeEngine } = require('./engines/code-engine');
        const codeEngine = getCodeEngine(this.llmManager);

        const result = await codeEngine.handleProjectTask({
          taskType: 'generateTests',
          sourceCode: code,
          language: language
        });

        console.log('[Main] 单元测试生成完成');
        return result;
      } catch (error) {
        console.error('[Main] 单元测试生成失败:', error);
        throw error;
      }
    });

    // 代码审查
    ipcMain.handle('code:review', async (_event, code, language) => {
      try {
        console.log('[Main] 代码审查:', language);

        const { getCodeEngine } = require('./engines/code-engine');
        const codeEngine = getCodeEngine(this.llmManager);

        const result = await codeEngine.handleProjectTask({
          taskType: 'reviewCode',
          sourceCode: code,
          language: language
        });

        console.log('[Main] 代码审查完成，评分:', result.score);
        return result;
      } catch (error) {
        console.error('[Main] 代码审查失败:', error);
        throw error;
      }
    });

    // 代码重构
    ipcMain.handle('code:refactor', async (_event, code, language, refactoringType) => {
      try {
        console.log('[Main] 代码重构:', refactoringType);

        const { getCodeEngine } = require('./engines/code-engine');
        const codeEngine = getCodeEngine(this.llmManager);

        const result = await codeEngine.handleProjectTask({
          taskType: 'refactorCode',
          sourceCode: code,
          language: language,
          options: { goal: refactoringType }
        });

        console.log('[Main] 代码重构完成');
        return result;
      } catch (error) {
        console.error('[Main] 代码重构失败:', error);
        throw error;
      }
    });

    // 解释代码
    ipcMain.handle('code:explain', async (_event, code, language) => {
      try {
        console.log('[Main] 解释代码:', language);

        const { getCodeEngine } = require('./engines/code-engine');
        const codeEngine = getCodeEngine(this.llmManager);

        const result = await codeEngine.handleProjectTask({
          taskType: 'explainCode',
          sourceCode: code,
          language: language
        });

        console.log('[Main] 代码解释完成');
        return result;
      } catch (error) {
        console.error('[Main] 代码解释失败:', error);
        throw error;
      }
    });

    // 修复bug
    ipcMain.handle('code:fixBug', async (_event, code, language, errorMessage) => {
      try {
        console.log('[Main] 修复bug:', language);

        const { getCodeEngine } = require('./engines/code-engine');
        const codeEngine = getCodeEngine(this.llmManager);

        const result = await codeEngine.handleProjectTask({
          taskType: 'fixBugs',
          sourceCode: code,
          errorMessage: errorMessage,
          language: language
        });

        console.log('[Main] bug修复完成');
        return result;
      } catch (error) {
        console.error('[Main] bug修复失败:', error);
        throw error;
      }
    });

    // 生成项目脚手架
    ipcMain.handle('code:generateScaffold', async (_event, projectType, options = {}) => {
      try {
        console.log('[Main] 生成项目脚手架:', projectType);

        const { getCodeEngine } = require('./engines/code-engine');
        const codeEngine = getCodeEngine(this.llmManager);

        const result = await codeEngine.handleProjectTask({
          taskType: 'createScaffold',
          projectName: options.projectName || projectType,
          template: projectType,
          outputDir: options.outputDir || process.cwd(),
          options: options
        });

        console.log('[Main] 项目脚手架生成完成');
        return result;
      } catch (error) {
        console.error('[Main] 项目脚手架生成失败:', error);
        throw error;
      }
    });

    // 执行Python代码
    ipcMain.handle('code:executePython', async (_event, code, options = {}) => {
      try {
        console.log('[Main] 执行Python代码...');

        const { getCodeExecutor } = require('./engines/code-executor');
        const codeExecutor = getCodeExecutor();

        await codeExecutor.initialize();

        // 基础安全检查
        const safetyCheck = codeExecutor.checkSafety(code);
        if (!safetyCheck.safe && !options.ignoreWarnings) {
          return {
            success: false,
            error: 'code_unsafe',
            warnings: safetyCheck.warnings,
            message: '代码包含潜在危险操作,执行已阻止'
          };
        }

        const result = await codeExecutor.executePython(code, options);

        console.log('[Main] Python代码执行完成');
        return result;
      } catch (error) {
        console.error('[Main] Python代码执行失败:', error);
        return {
          success: false,
          error: 'execution_failed',
          message: error.message,
          stdout: '',
          stderr: error.message
        };
      }
    });

    // 执行代码文件
    ipcMain.handle('code:executeFile', async (_event, filepath, options = {}) => {
      try {
        console.log('[Main] 执行代码文件:', filepath);

        const { getCodeExecutor } = require('./engines/code-executor');
        const codeExecutor = getCodeExecutor();

        await codeExecutor.initialize();

        const result = await codeExecutor.executeFile(filepath, options);

        console.log('[Main] 代码文件执行完成');
        return result;
      } catch (error) {
        console.error('[Main] 代码文件执行失败:', error);
        return {
          success: false,
          error: 'execution_failed',
          message: error.message,
          stdout: '',
          stderr: error.message
        };
      }
    });

    // 检查代码安全性
    ipcMain.handle('code:checkSafety', async (_event, code) => {
      try {
        const { getCodeExecutor } = require('./engines/code-executor');
        const codeExecutor = getCodeExecutor();

        return codeExecutor.checkSafety(code);
      } catch (error) {
        console.error('[Main] 安全检查失败:', error);
        return {
          safe: false,
          warnings: [error.message]
        };
      }
    });

    // ==================== 代码开发引擎接口结束 ====================

    // ==================== 项目自动化规则接口 ====================

    // 创建自动化规则
    ipcMain.handle('automation:createRule', async (_event, ruleData) => {
      try {
        console.log('[Main] 创建自动化规则:', ruleData.name);

        const { getAutomationManager } = require('./project/automation-manager');
        const automationManager = getAutomationManager();

        await automationManager.initialize();

        const rule = await automationManager.createRule(ruleData);

        console.log('[Main] 自动化规则创建成功:', rule.id);
        return rule;
      } catch (error) {
        console.error('[Main] 创建自动化规则失败:', error);
        throw error;
      }
    });

    // 获取项目的自动化规则列表
    ipcMain.handle('automation:getRules', async (_event, projectId) => {
      try {
        const { getAutomationManager } = require('./project/automation-manager');
        const automationManager = getAutomationManager();

        await automationManager.initialize();

        const rules = automationManager.getRules(projectId);

        return rules;
      } catch (error) {
        console.error('[Main] 获取自动化规则列表失败:', error);
        throw error;
      }
    });

    // 获取规则详情
    ipcMain.handle('automation:getRule', async (_event, ruleId) => {
      try {
        const { getAutomationManager } = require('./project/automation-manager');
        const automationManager = getAutomationManager();

        await automationManager.initialize();

        const rule = automationManager.getRule(ruleId);

        return rule;
      } catch (error) {
        console.error('[Main] 获取规则详情失败:', error);
        throw error;
      }
    });

    // 更新自动化规则
    ipcMain.handle('automation:updateRule', async (_event, ruleId, updates) => {
      try {
        console.log('[Main] 更新自动化规则:', ruleId);

        const { getAutomationManager } = require('./project/automation-manager');
        const automationManager = getAutomationManager();

        await automationManager.initialize();

        const rule = await automationManager.updateRule(ruleId, updates);

        console.log('[Main] 自动化规则更新成功');
        return rule;
      } catch (error) {
        console.error('[Main] 更新自动化规则失败:', error);
        throw error;
      }
    });

    // 删除自动化规则
    ipcMain.handle('automation:deleteRule', async (_event, ruleId) => {
      try {
        console.log('[Main] 删除自动化规则:', ruleId);

        const { getAutomationManager } = require('./project/automation-manager');
        const automationManager = getAutomationManager();

        await automationManager.initialize();

        await automationManager.deleteRule(ruleId);

        console.log('[Main] 自动化规则删除成功');
        return { success: true };
      } catch (error) {
        console.error('[Main] 删除自动化规则失败:', error);
        throw error;
      }
    });

    // 手动触发规则
    ipcMain.handle('automation:manualTrigger', async (_event, ruleId) => {
      try {
        console.log('[Main] 手动触发规则:', ruleId);

        const { getAutomationManager } = require('./project/automation-manager');
        const automationManager = getAutomationManager();

        await automationManager.initialize();

        const result = await automationManager.manualTrigger(ruleId);

        console.log('[Main] 规则触发完成');
        return result;
      } catch (error) {
        console.error('[Main] 触发规则失败:', error);
        throw error;
      }
    });

    // 加载项目规则
    ipcMain.handle('automation:loadProjectRules', async (_event, projectId) => {
      try {
        console.log('[Main] 加载项目规则:', projectId);

        const { getAutomationManager } = require('./project/automation-manager');
        const automationManager = getAutomationManager();

        await automationManager.initialize();

        const rules = await automationManager.loadProjectRules(projectId);

        console.log('[Main] 项目规则加载完成');
        return rules;
      } catch (error) {
        console.error('[Main] 加载项目规则失败:', error);
        throw error;
      }
    });

    // 停止规则
    ipcMain.handle('automation:stopRule', async (_event, ruleId) => {
      try {
        console.log('[Main] 停止规则:', ruleId);

        const { getAutomationManager } = require('./project/automation-manager');
        const automationManager = getAutomationManager();

        await automationManager.initialize();

        automationManager.stopRule(ruleId);

        console.log('[Main] 规则已停止');
        return { success: true };
      } catch (error) {
        console.error('[Main] 停止规则失败:', error);
        throw error;
      }
    });

    // 获取统计信息
    ipcMain.handle('automation:getStatistics', async () => {
      try {
        const { getAutomationManager } = require('./project/automation-manager');
        const automationManager = getAutomationManager();

        await automationManager.initialize();

        const stats = automationManager.getStatistics();

        return stats;
      } catch (error) {
        console.error('[Main] 获取统计信息失败:', error);
        throw error;
      }
    });

    // ==================== 项目自动化规则接口结束 ====================

    // ==================== 协作实时编辑接口 ====================

    // 启动协作服务器
    ipcMain.handle('collaboration:startServer', async (_event, options = {}) => {
      try {
        console.log('[Main] 启动协作服务器');

        const { getCollaborationManager } = require('./collaboration/collaboration-manager');
        const collaborationManager = getCollaborationManager();

        await collaborationManager.initialize(options);
        const result = await collaborationManager.startServer();

        console.log('[Main] 协作服务器启动成功');
        return result;
      } catch (error) {
        console.error('[Main] 启动协作服务器失败:', error);
        throw error;
      }
    });

    // 停止协作服务器
    ipcMain.handle('collaboration:stopServer', async () => {
      try {
        console.log('[Main] 停止协作服务器');

        const { getCollaborationManager } = require('./collaboration/collaboration-manager');
        const collaborationManager = getCollaborationManager();

        const result = await collaborationManager.stopServer();

        console.log('[Main] 协作服务器已停止');
        return result;
      } catch (error) {
        console.error('[Main] 停止协作服务器失败:', error);
        throw error;
      }
    });

    // 加入文档协作
    ipcMain.handle('collaboration:joinDocument', async (_event, userId, userName, documentId) => {
      try {
        console.log('[Main] 加入文档协作:', documentId);

        const { getCollaborationManager } = require('./collaboration/collaboration-manager');
        const collaborationManager = getCollaborationManager();

        await collaborationManager.initialize();

        const result = await collaborationManager.joinDocument(userId, userName, documentId);

        console.log('[Main] 已加入文档协作');
        return result;
      } catch (error) {
        console.error('[Main] 加入文档协作失败:', error);
        throw error;
      }
    });

    // 提交协作操作
    ipcMain.handle('collaboration:submitOperation', async (_event, documentId, userId, operation) => {
      try {
        const { getCollaborationManager } = require('./collaboration/collaboration-manager');
        const collaborationManager = getCollaborationManager();

        await collaborationManager.initialize();

        const result = await collaborationManager.submitOperation(documentId, userId, operation);

        return result;
      } catch (error) {
        console.error('[Main] 提交协作操作失败:', error);
        throw error;
      }
    });

    // 获取在线用户
    ipcMain.handle('collaboration:getOnlineUsers', async (_event, documentId) => {
      try {
        const { getCollaborationManager } = require('./collaboration/collaboration-manager');
        const collaborationManager = getCollaborationManager();

        await collaborationManager.initialize();

        const users = collaborationManager.getOnlineUsers(documentId);

        return users;
      } catch (error) {
        console.error('[Main] 获取在线用户失败:', error);
        throw error;
      }
    });

    // 获取操作历史
    ipcMain.handle('collaboration:getOperationHistory', async (_event, documentId, limit) => {
      try {
        const { getCollaborationManager } = require('./collaboration/collaboration-manager');
        const collaborationManager = getCollaborationManager();

        await collaborationManager.initialize();

        const history = collaborationManager.getOperationHistory(documentId, limit);

        return history;
      } catch (error) {
        console.error('[Main] 获取操作历史失败:', error);
        throw error;
      }
    });

    // 获取会话历史
    ipcMain.handle('collaboration:getSessionHistory', async (_event, documentId, limit) => {
      try {
        const { getCollaborationManager } = require('./collaboration/collaboration-manager');
        const collaborationManager = getCollaborationManager();

        await collaborationManager.initialize();

        const history = collaborationManager.getSessionHistory(documentId, limit);

        return history;
      } catch (error) {
        console.error('[Main] 获取会话历史失败:', error);
        throw error;
      }
    });

    // 获取服务器状态
    ipcMain.handle('collaboration:getStatus', async () => {
      try {
        const { getCollaborationManager } = require('./collaboration/collaboration-manager');
        const collaborationManager = getCollaborationManager();

        await collaborationManager.initialize();

        const status = collaborationManager.getStatus();

        return status;
      } catch (error) {
        console.error('[Main] 获取服务器状态失败:', error);
        throw error;
      }
    });

    // ==================== 协作实时编辑接口结束 ====================

    // 同步项目
    ipcMain.handle('project:sync', async (_event, userId) => {
      try {
        console.log('[Main] project:sync 开始同步，userId:', userId, 'type:', typeof userId);

        const { getProjectHTTPClient } = require('./project/http-client');
        const httpClient = getProjectHTTPClient();

        // 1. 获取后端项目列表
        const response = await httpClient.listProjects(userId, 1, 1000);
        console.log('[Main] 后端响应:', response ? 'OK' : 'NULL', 'type:', typeof response);

        // 安全地访问 records
        const backendProjects = (response && response.records) ? response.records : [];
        console.log('[Main] 从后端获取到项目数量:', backendProjects.length);

        // 2. 获取本地项目
        const localProjects = this.database ? this.database.getProjects(userId) : [];

        // 3. 合并数据并同步文件
        if (this.database) {
          for (const project of backendProjects) {
            try {
              // 获取项目详情（包含文件列表）
              let projectDetail = project;
              if (!project.files || project.files.length === 0) {
                try {
                  console.log(`[Main] 获取项目 ${project.id} 的详细信息...`);
                  projectDetail = await httpClient.getProject(project.id);
                } catch (detailError) {
                  console.warn(`[Main] 获取项目 ${project.id} 详情失败，使用列表数据:`, detailError.message);
                  projectDetail = project;
                }
              }

              const createdAt = projectDetail.createdAt ? new Date(projectDetail.createdAt).getTime() : Date.now();
              const updatedAt = projectDetail.updatedAt ? new Date(projectDetail.updatedAt).getTime() : Date.now();

              // 构建项目对象，避免 undefined 值
              const projectData = {
                id: projectDetail.id,
                user_id: projectDetail.userId,
                name: projectDetail.name,
                project_type: projectDetail.projectType,
                status: projectDetail.status || 'active',
                file_count: projectDetail.fileCount || 0,
                total_size: projectDetail.totalSize || 0,
                tags: JSON.stringify(projectDetail.tags || []),
                metadata: JSON.stringify(projectDetail.metadata || {}),
                created_at: createdAt,
                updated_at: updatedAt,
                synced_at: Date.now(),
                sync_status: 'synced',
              };

              // 只有当字段存在时才添加（避免 undefined）
              if (projectDetail.description) projectData.description = projectDetail.description;
              if (projectDetail.rootPath) projectData.root_path = projectDetail.rootPath;
              if (projectDetail.coverImageUrl) projectData.cover_image_url = projectDetail.coverImageUrl;

              this.database.saveProject(projectData);

              // 同步项目文件
              if (projectDetail.files && Array.isArray(projectDetail.files) && projectDetail.files.length > 0) {
                console.log(`[Main] 同步项目 ${projectDetail.id} 的文件，数量:`, projectDetail.files.length);
                try {
                  this.database.saveProjectFiles(projectDetail.id, projectDetail.files);
                  console.log(`[Main] 项目 ${projectDetail.id} 文件同步完成`);
                } catch (fileError) {
                  console.error(`[Main] 同步项目 ${projectDetail.id} 文件失败:`, fileError);
                }
              } else {
                console.log(`[Main] 项目 ${projectDetail.id} 没有文件`);
              }
            } catch (projectError) {
              console.error(`[Main] 同步项目 ${project.id} 失败:`, projectError);
            }
          }
        }

        // 4. 推送本地pending的项目到后端
        const pendingProjects = localProjects.filter(p => p.sync_status === 'pending');
        for (const project of pendingProjects) {
          try {
            // 清理 undefined 值后再发送
            const cleanProject = this._replaceUndefinedWithNull(project);
            await httpClient.syncProject(cleanProject);

            // 更新同步状态
            if (this.database) {
              this.database.updateProject(project.id, {
                sync_status: 'synced',
                synced_at: Date.now(),
              });
            }
          } catch (syncError) {
            console.error(`[Main] 同步项目 ${project.id} 失败:`, syncError);
          }
        }

        return { success: true };
      } catch (error) {
        console.error('[Main] 同步项目失败:', error);
        throw error;
      }
    });

    // ==================== 项目恢复接口开始 ====================

    // 扫描可恢复的项目
    ipcMain.handle('project:scan-recoverable', async () => {
      try {
        const ProjectRecovery = require('./sync/project-recovery');
        const recovery = new ProjectRecovery(this.database);
        const recoverableProjects = recovery.scanRecoverableProjects();

        console.log(`[Main] 扫描到 ${recoverableProjects.length} 个可恢复的项目`);
        return {
          success: true,
          projects: recoverableProjects,
        };
      } catch (error) {
        console.error('[Main] 扫描可恢复项目失败:', error);
        return {
          success: false,
          error: error.message,
          projects: [],
        };
      }
    });

    // 恢复单个项目
    ipcMain.handle('project:recover', async (_event, projectId) => {
      try {
        const ProjectRecovery = require('./sync/project-recovery');
        const recovery = new ProjectRecovery(this.database);
        const success = recovery.recoverProject(projectId);

        if (success) {
          console.log(`[Main] 成功恢复项目: ${projectId}`);
          return { success: true };
        } else {
          throw new Error('恢复失败');
        }
      } catch (error) {
        console.error(`[Main] 恢复项目失败: ${projectId}`, error);
        return {
          success: false,
          error: error.message,
        };
      }
    });

    // 批量恢复项目
    ipcMain.handle('project:recover-batch', async (_event, projectIds) => {
      try {
        const ProjectRecovery = require('./sync/project-recovery');
        const recovery = new ProjectRecovery(this.database);
        const results = recovery.recoverProjects(projectIds);

        console.log(`[Main] 批量恢复完成: 成功 ${results.success.length}, 失败 ${results.failed.length}`);
        return {
          success: true,
          results,
        };
      } catch (error) {
        console.error('[Main] 批量恢复项目失败:', error);
        return {
          success: false,
          error: error.message,
        };
      }
    });

    // 自动恢复所有可恢复的项目
    ipcMain.handle('project:auto-recover', async () => {
      try {
        const ProjectRecovery = require('./sync/project-recovery');
        const recovery = new ProjectRecovery(this.database);
        const results = recovery.autoRecoverAll();

        console.log(`[Main] 自动恢复完成: 成功 ${results.success.length}, 失败 ${results.failed.length}`);
        return {
          success: true,
          results,
        };
      } catch (error) {
        console.error('[Main] 自动恢复失败:', error);
        return {
          success: false,
          error: error.message,
        };
      }
    });

    // 获取恢复统计信息
    ipcMain.handle('project:recovery-stats', async () => {
      try {
        const ProjectRecovery = require('./sync/project-recovery');
        const recovery = new ProjectRecovery(this.database);
        const stats = recovery.getRecoveryStats();

        return {
          success: true,
          stats,
        };
      } catch (error) {
        console.error('[Main] 获取恢复统计失败:', error);
        return {
          success: false,
          error: error.message,
        };
      }
    });

    // ==================== 项目恢复接口结束 ====================

    // 同步单个项目
    ipcMain.handle('project:sync-one', async (_event, projectId) => {
      try {
        const { getProjectHTTPClient } = require('./project/http-client');
        const httpClient = getProjectHTTPClient();

        if (!this.database) {
          throw new Error('数据库未初始化');
        }

        const project = this.database.getProjectById(projectId);
        if (!project) {
          throw new Error('项目不存在');
        }

        // 清理 undefined 值后再发送
        const cleanProject = this._replaceUndefinedWithNull(project);
        await httpClient.syncProject(cleanProject);

        // 更新同步状态
        this.database.updateProject(projectId, {
          sync_status: 'synced',
          synced_at: Date.now(),
        });

        return { success: true };
      } catch (error) {
        console.error('[Main] 同步单个项目失败:', error);
        throw error;
      }
    });

    // Git初始化
    ipcMain.handle('project:git-init', async (_event, repoPath, remoteUrl = null) => {
      try {
        // 解析路径（将 /data/projects/xxx 转换为绝对路径）
        const projectConfig = getProjectConfig();
        const resolvedPath = projectConfig.resolveProjectPath(repoPath);

        // 调用后端API
        const result = await GitAPI.init(resolvedPath, remoteUrl);

        // 如果后端不可用，降级到本地Git
        if (!result.success || result.status === 0) {
          console.warn('[Main] 后端服务不可用，使用本地Git');
          const git = require('isomorphic-git');
          const fs = require('fs');
          await git.init({ fs, dir: resolvedPath, defaultBranch: 'main' });
          return { success: true };
        }

        return result;
      } catch (error) {
        console.error('[Main] Git初始化失败:', error);
        throw error;
      }
    });

    // Git状态查询
    ipcMain.handle('project:git-status', async (_event, repoPath) => {
      try {
        // 解析路径（将 /data/projects/xxx 转换为绝对路径）
        const projectConfig = getProjectConfig();
        const resolvedPath = projectConfig.resolveProjectPath(repoPath);

        // 调用后端API
        const result = await GitAPI.status(resolvedPath);

        // 如果后端不可用，降级到本地Git
        if (!result.success || result.status === 0) {
          console.warn('[Main] 后端服务不可用，使用本地Git');
          const git = require('isomorphic-git');
          const fs = require('fs');
          const statusMatrix = await git.statusMatrix({ fs, dir: resolvedPath });

          // 将状态矩阵转换为更友好的格式
          const fileStatus = {};
          for (const [filepath, headStatus, worktreeStatus, stageStatus] of statusMatrix) {
            let status = '';
            if (headStatus === 0 && worktreeStatus === 2 && stageStatus === 0) {
              status = 'untracked';
            } else if (headStatus === 1 && worktreeStatus === 2 && stageStatus === 1) {
              status = 'modified';
            } else if (headStatus === 1 && worktreeStatus === 0 && stageStatus === 1) {
              status = 'deleted';
            } else if (headStatus === 0 && worktreeStatus === 2 && stageStatus === 2) {
              status = 'added';
            } else if (headStatus === 1 && worktreeStatus === 2 && stageStatus === 3) {
              status = 'staged';
            }
            if (status) {
              fileStatus[filepath] = status;
            }
          }
          return fileStatus;
        }

        return result.data || {};
      } catch (error) {
        console.error('[Main] Git状态查询失败:', error);
        throw error;
      }
    });

    // Git提交
    ipcMain.handle('project:git-commit', async (_event, projectId, repoPath, message, autoGenerate = false) => {
      try {
        // 解析路径（将 /data/projects/xxx 转换为绝对路径）
        const projectConfig = getProjectConfig();
        const resolvedPath = projectConfig.resolveProjectPath(repoPath);
        const fs = require('fs');
        const path = require('path');

        // 0. 检查并初始化 Git 仓库（如果需要）
        const gitDir = path.join(resolvedPath, '.git');
        if (!fs.existsSync(gitDir)) {
          console.log('[Main] Git 仓库未初始化，正在初始化...');
          const git = require('isomorphic-git');
          await git.init({ fs, dir: resolvedPath, defaultBranch: 'main' });
          console.log('[Main] Git 仓库初始化完成');
        }

        // 1. 提交前：刷新所有数据库更改到文件系统
        console.log('[Main] Git 提交前，刷新数据库更改到文件系统...');
        if (this.fileSyncManager && projectId) {
          try {
            await this.fileSyncManager.flushAllChanges(projectId);
            console.log('[Main] 文件刷新完成');
          } catch (syncError) {
            console.warn('[Main] 文件刷新失败（继续提交）:', syncError);
          }
        }

        // 2. 调用后端API
        const author = {
          name: this.gitManager?.author?.name || 'ChainlessChain User',
          email: this.gitManager?.author?.email || 'user@chainlesschain.com'
        };
        const result = await GitAPI.commit(resolvedPath, message, author, autoGenerate);

        // 如果后端不可用，降级到本地Git
        if (!result.success || result.status === 0) {
          console.warn('[Main] 后端服务不可用，使用本地Git');
          const git = require('isomorphic-git');
          const status = await git.statusMatrix({ fs, dir: resolvedPath });

          // 添加所有变更的文件
          let hasChanges = false;
          for (const row of status) {
            const [filepath, , worktreeStatus] = row;
            if (worktreeStatus !== 1) {
              await git.add({ fs, dir: resolvedPath, filepath });
              hasChanges = true;
            }
          }

          // 如果没有变更，返回成功但提示无变更
          if (!hasChanges) {
            console.log('[Main] 没有需要提交的变更');
            return { success: true, message: 'No changes to commit' };
          }

          // 执行提交
          const sha = await git.commit({ fs, dir: resolvedPath, message, author });
          console.log('[Main] Git 提交成功:', sha);
          return { success: true, sha };
        }

        console.log('[Main] Git 提交成功:', result.data?.sha);
        return result;
      } catch (error) {
        console.error('[Main] Git提交失败:', error);
        throw error;
      }
    });

    // Git推送
    ipcMain.handle('project:git-push', async (_event, repoPath, remote = 'origin', branch = null) => {
      try {
        // 解析路径（将 /data/projects/xxx 转换为绝对路径）
        const projectConfig = getProjectConfig();
        const resolvedPath = projectConfig.resolveProjectPath(repoPath);

        // 调用后端API
        const result = await GitAPI.push(resolvedPath, remote, branch);

        // 如果后端不可用，降级到本地Git
        if (!result.success || result.status === 0) {
          console.warn('[Main] 后端服务不可用，使用本地Git');
          const git = require('isomorphic-git');
          const fs = require('fs');
          const http = require('isomorphic-git/http/node');
          await git.push({
            fs,
            http,
            dir: resolvedPath,
            remote: 'origin',
            ref: 'main',
            onAuth: () => this.gitManager?.auth || {}
          });
          return { success: true };
        }

        return result;
      } catch (error) {
        console.error('[Main] Git推送失败:', error);
        throw error;
      }
    });

    // Git拉取
    ipcMain.handle('project:git-pull', async (_event, projectId, repoPath, remote = 'origin', branch = null) => {
      try {
        // 解析路径（将 /data/projects/xxx 转换为绝对路径）
        const projectConfig = getProjectConfig();
        const resolvedPath = projectConfig.resolveProjectPath(repoPath);
        const fs = require('fs');
        const path = require('path');

        // 0. 检查 Git 仓库是否存在
        const gitDir = path.join(resolvedPath, '.git');
        if (!fs.existsSync(gitDir)) {
          throw new Error('Git 仓库未初始化，请先初始化仓库后再执行 pull 操作');
        }

        // 1. 调用后端API
        console.log('[Main] 执行 Git pull...');
        const result = await GitAPI.pull(resolvedPath, remote, branch);

        // 如果后端不可用，降级到本地Git
        if (!result.success || result.status === 0) {
          console.warn('[Main] 后端服务不可用，使用本地Git');
          const git = require('isomorphic-git');
          const fs = require('fs');
          const http = require('isomorphic-git/http/node');
          await git.pull({
            fs,
            http,
            dir: resolvedPath,
            ref: 'main',
            singleBranch: true,
            onAuth: () => this.gitManager?.auth || {}
          });
          console.log('[Main] Git pull 完成');
        } else {
          console.log('[Main] Git pull 完成');
        }

        // 2. 拉取后：通知前端刷新项目文件列表
        if (this.mainWindow && projectId) {
          console.log('[Main] 通知前端刷新项目文件...');
          this.mainWindow.webContents.send('git:pulled', { projectId });
        }

        return result.success ? result : { success: true };
      } catch (error) {
        console.error('[Main] Git拉取失败:', error);
        throw error;
      }
    });

    // RAG索引管理
    ipcMain.handle('project:rag-index', async (_event, projectId, repoPath) => {
      try {
        const projectConfig = getProjectConfig();
        const resolvedPath = projectConfig.resolveProjectPath(repoPath);
        return await RAGAPI.indexProject(projectId, resolvedPath);
      } catch (error) {
        console.error('[Main] RAG索引失败:', error);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('project:rag-stats', async (_event, projectId) => {
      try {
        return await RAGAPI.getIndexStats(projectId);
      } catch (error) {
        console.error('[Main] 获取索引统计失败:', error);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('project:rag-query', async (_event, projectId, query, topK = 5) => {
      try {
        return await RAGAPI.enhancedQuery(projectId, query, topK);
      } catch (error) {
        console.error('[Main] RAG查询失败:', error);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('project:rag-update-file', async (_event, projectId, filePath, content) => {
      try {
        return await RAGAPI.updateFileIndex(projectId, filePath, content);
      } catch (error) {
        console.error('[Main] 更新文件索引失败:', error);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('project:rag-delete', async (_event, projectId) => {
      try {
        return await RAGAPI.deleteProjectIndex(projectId);
      } catch (error) {
        console.error('[Main] 删除项目索引失败:', error);
        return { success: false, error: error.message };
      }
    });

    // 代码助手功能
    ipcMain.handle('project:code-generate', async (_event, description, language, options = {}) => {
      try {
        return await CodeAPI.generate(
          description,
          language,
          options.style || 'modern',
          options.includeTests || false,
          options.includeComments !== false,
          options.context
        );
      } catch (error) {
        console.error('[Main] 代码生成失败:', error);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('project:code-review', async (_event, code, language, focusAreas = null) => {
      try {
        return await CodeAPI.review(code, language, focusAreas);
      } catch (error) {
        console.error('[Main] 代码审查失败:', error);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('project:code-refactor', async (_event, code, language, refactorType = 'general') => {
      try {
        return await CodeAPI.refactor(code, language, refactorType);
      } catch (error) {
        console.error('[Main] 代码重构失败:', error);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('project:code-explain', async (_event, code, language) => {
      try {
        return await CodeAPI.explain(code, language);
      } catch (error) {
        console.error('[Main] 代码解释失败:', error);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('project:code-fix-bug', async (_event, code, language, bugDescription) => {
      try {
        return await CodeAPI.fixBug(code, language, bugDescription);
      } catch (error) {
        console.error('[Main] Bug修复失败:', error);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('project:code-generate-tests', async (_event, code, language) => {
      try {
        return await CodeAPI.generateTests(code, language);
      } catch (error) {
        console.error('[Main] 生成测试失败:', error);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('project:code-optimize', async (_event, code, language) => {
      try {
        return await CodeAPI.optimize(code, language);
      } catch (error) {
        console.error('[Main] 代码优化失败:', error);
        return { success: false, error: error.message };
      }
    });

    // Git高级操作
    ipcMain.handle('project:git-log', async (_event, repoPath, page = 1, pageSize = 20) => {
      try {
        const projectConfig = getProjectConfig();
        const resolvedPath = projectConfig.resolveProjectPath(repoPath);
        const limit = page * pageSize;

        // 尝试调用后端API
        const result = await GitAPI.log(resolvedPath, limit);

        // 如果后端不可用，降级到本地Git
        if (!result.success || result.status === 0) {
          console.warn('[Main] 后端服务不可用，使用本地Git获取提交历史');
          const git = require('isomorphic-git');
          const fs = require('fs');

          // 使用本地 Git 获取提交历史
          const commits = await git.log({
            fs,
            dir: resolvedPath,
            depth: limit,
          });

          // 转换为统一格式（保持与组件期望的数据结构一致）
          const formattedCommits = commits.map(commit => ({
            sha: commit.oid,
            oid: commit.oid,
            message: commit.commit.message,
            timestamp: commit.commit.author.timestamp,  // 顶层时间戳，便于访问
            author: commit.commit.author.name,          // 顶层作者名，便于显示
            commit: {                                   // 保留嵌套结构作为后备
              message: commit.commit.message,
              author: {
                name: commit.commit.author.name,
                email: commit.commit.author.email,
                timestamp: commit.commit.author.timestamp,
              },
              committer: {
                name: commit.commit.committer.name,
                email: commit.commit.committer.email,
                timestamp: commit.commit.committer.timestamp,
              }
            }
          }));

          // 分页处理
          const startIndex = (page - 1) * pageSize;
          const endIndex = startIndex + pageSize;
          const paginatedCommits = formattedCommits.slice(startIndex, endIndex);

          return {
            success: true,
            commits: paginatedCommits,
            hasMore: formattedCommits.length >= limit,
          };
        }

        // 后端可用，返回分页结果
        if (result && result.commits) {
          const startIndex = (page - 1) * pageSize;
          const endIndex = startIndex + pageSize;
          const paginatedCommits = result.commits.slice(startIndex, endIndex);

          return {
            ...result,
            commits: paginatedCommits,
            hasMore: result.commits.length >= limit
          };
        }

        return result;
      } catch (error) {
        console.error('[Main] 获取提交历史失败:', error);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('project:git-show-commit', async (_event, repoPath, sha) => {
      try {
        const projectConfig = getProjectConfig();
        const resolvedPath = projectConfig.resolveProjectPath(repoPath);
        // Get the diff for a specific commit (commit vs its parent)
        const result = await GitAPI.diff(resolvedPath, sha + '^', sha);
        return result;
      } catch (error) {
        console.error('[Main] 获取提交详情失败:', error);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('project:git-diff', async (_event, repoPath, commit1 = null, commit2 = null) => {
      try {
        const projectConfig = getProjectConfig();
        const resolvedPath = projectConfig.resolveProjectPath(repoPath);
        return await GitAPI.diff(resolvedPath, commit1, commit2);
      } catch (error) {
        console.error('[Main] 获取差异失败:', error);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('project:git-branches', async (_event, repoPath) => {
      try {
        const projectConfig = getProjectConfig();
        const resolvedPath = projectConfig.resolveProjectPath(repoPath);
        return await GitAPI.branches(resolvedPath);
      } catch (error) {
        console.error('[Main] 获取分支列表失败:', error);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('project:git-create-branch', async (_event, repoPath, branchName, fromBranch = null) => {
      try {
        const projectConfig = getProjectConfig();
        const resolvedPath = projectConfig.resolveProjectPath(repoPath);
        return await GitAPI.createBranch(resolvedPath, branchName, fromBranch);
      } catch (error) {
        console.error('[Main] 创建分支失败:', error);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('project:git-checkout', async (_event, repoPath, branchName) => {
      try {
        const projectConfig = getProjectConfig();
        const resolvedPath = projectConfig.resolveProjectPath(repoPath);
        return await GitAPI.checkoutBranch(resolvedPath, branchName);
      } catch (error) {
        console.error('[Main] 切换分支失败:', error);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('project:git-merge', async (_event, repoPath, sourceBranch, targetBranch = null) => {
      try {
        const projectConfig = getProjectConfig();
        const resolvedPath = projectConfig.resolveProjectPath(repoPath);
        return await GitAPI.merge(resolvedPath, sourceBranch, targetBranch);
      } catch (error) {
        console.error('[Main] 合并分支失败:', error);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('project:git-resolve-conflicts', async (_event, repoPath, filePath = null, strategy = null) => {
      try {
        const projectConfig = getProjectConfig();
        const resolvedPath = projectConfig.resolveProjectPath(repoPath);
        return await GitAPI.resolveConflicts(resolvedPath, filePath, false, strategy);
      } catch (error) {
        console.error('[Main] 解决冲突失败:', error);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('project:git-generate-commit-message', async (_event, repoPath) => {
      try {
        const projectConfig = getProjectConfig();
        const resolvedPath = projectConfig.resolveProjectPath(repoPath);
        return await GitAPI.generateCommitMessage(resolvedPath);
      } catch (error) {
        console.error('[Main] 生成提交消息失败:', error);
        return { success: false, error: error.message };
      }
    });

    // 系统操作
    ipcMain.handle('system:get-version', () => {
      return app.getVersion();
    });

    ipcMain.handle('system:minimize', () => {
      this.mainWindow?.minimize();
    });

    ipcMain.handle('system:maximize', () => {
      if (!this.mainWindow?.isMaximized()) {
        this.mainWindow?.maximize();
      }
    });

    ipcMain.handle('system:close', () => {
      this.mainWindow?.close();
    });

    // Shell操作
    ipcMain.handle('shell:open-path', async (_event, filePath) => {
      try {
        const { shell } = require('electron');

        // 解析路径（将 /data/projects/xxx 转换为绝对路径）
        const projectConfig = getProjectConfig();
        const resolvedPath = projectConfig.resolveProjectPath(filePath);

        console.log('[Main] 在系统中打开:', resolvedPath);
        await shell.openPath(resolvedPath);
        return { success: true };
      } catch (error) {
        console.error('[Main] 打开路径失败:', error);
        throw error;
      }
    });

    // 在文件管理器中显示文件
    ipcMain.handle('shell:show-item-in-folder', async (_event, filePath) => {
      try {
        const { shell } = require('electron');

        // 解析路径（将 /data/projects/xxx 转换为绝对路径）
        const projectConfig = getProjectConfig();
        const resolvedPath = projectConfig.resolveProjectPath(filePath);

        console.log('[Main] 在文件夹中显示:', resolvedPath);
        shell.showItemInFolder(resolvedPath);
        return { success: true };
      } catch (error) {
        console.error('[Main] 显示文件失败:', error);
        throw error;
      }
    });

    // ============================================
    // 插件系统 IPC Handlers (Phase 1)
    // ============================================

    // 获取所有插件
    ipcMain.handle('plugin:get-plugins', async (_event, filters) => {
      try {
        if (!this.pluginManager) {
          return { success: false, error: '插件系统未初始化' };
        }
        const plugins = this.pluginManager.getPlugins(filters);
        return { success: true, plugins };
      } catch (error) {
        console.error('[Main] 获取插件列表失败:', error);
        return { success: false, error: error.message };
      }
    });

    // 获取单个插件信息
    ipcMain.handle('plugin:get-plugin', async (_event, pluginId) => {
      try {
        if (!this.pluginManager) {
          throw new Error('插件系统未初始化');
        }
        const plugin = this.pluginManager.getPlugin(pluginId);
        return { success: true, plugin };
      } catch (error) {
        console.error('[Main] 获取插件信息失败:', error);
        return { success: false, error: error.message };
      }
    });

    // 安装插件
    ipcMain.handle('plugin:install', async (_event, source, options) => {
      try {
        if (!this.pluginManager) {
          throw new Error('插件系统未初始化');
        }
        console.log('[Main] 安装插件:', source);
        const result = await this.pluginManager.installPlugin(source, options);
        return { success: true, ...result };
      } catch (error) {
        console.error('[Main] 安装插件失败:', error);
        return { success: false, error: error.message };
      }
    });

    // 卸载插件
    ipcMain.handle('plugin:uninstall', async (_event, pluginId) => {
      try {
        if (!this.pluginManager) {
          throw new Error('插件系统未初始化');
        }
        console.log('[Main] 卸载插件:', pluginId);
        await this.pluginManager.uninstallPlugin(pluginId);
        return { success: true };
      } catch (error) {
        console.error('[Main] 卸载插件失败:', error);
        return { success: false, error: error.message };
      }
    });

    // 启用插件
    ipcMain.handle('plugin:enable', async (_event, pluginId) => {
      try {
        if (!this.pluginManager) {
          throw new Error('插件系统未初始化');
        }
        console.log('[Main] 启用插件:', pluginId);
        await this.pluginManager.enablePlugin(pluginId);
        return { success: true };
      } catch (error) {
        console.error('[Main] 启用插件失败:', error);
        return { success: false, error: error.message };
      }
    });

    // 禁用插件
    ipcMain.handle('plugin:disable', async (_event, pluginId) => {
      try {
        if (!this.pluginManager) {
          throw new Error('插件系统未初始化');
        }
        console.log('[Main] 禁用插件:', pluginId);
        await this.pluginManager.disablePlugin(pluginId);
        return { success: true };
      } catch (error) {
        console.error('[Main] 禁用插件失败:', error);
        return { success: false, error: error.message };
      }
    });

    // 获取插件权限
    ipcMain.handle('plugin:get-permissions', async (_event, pluginId) => {
      try {
        if (!this.pluginManager) {
          throw new Error('插件系统未初始化');
        }
        const permissions = this.pluginManager.registry.getPluginPermissions(pluginId);
        return { success: true, permissions };
      } catch (error) {
        console.error('[Main] 获取插件权限失败:', error);
        return { success: false, error: error.message };
      }
    });

    // 更新插件权限
    ipcMain.handle('plugin:update-permission', async (_event, pluginId, permission, granted) => {
      try {
        if (!this.pluginManager) {
          throw new Error('插件系统未初始化');
        }
        await this.pluginManager.registry.updatePermission(pluginId, permission, granted);
        return { success: true };
      } catch (error) {
        console.error('[Main] 更新插件权限失败:', error);
        return { success: false, error: error.message };
      }
    });

    // 触发扩展点
    ipcMain.handle('plugin:trigger-extension-point', async (_event, name, context) => {
      try {
        if (!this.pluginManager) {
          throw new Error('插件系统未初始化');
        }
        const results = await this.pluginManager.triggerExtensionPoint(name, context);
        return { success: true, results };
      } catch (error) {
        console.error('[Main] 触发扩展点失败:', error);
        return { success: false, error: error.message };
      }
    });

    // 打开插件目录
    ipcMain.handle('plugin:open-plugins-dir', async () => {
      try {
        const { shell } = require('electron');
        const pluginsDir = path.join(app.getPath('userData'), 'plugins');
        await shell.openPath(pluginsDir);
        return { success: true };
      } catch (error) {
        console.error('[Main] 打开插件目录失败:', error);
        return { success: false, error: error.message };
      }
    });

    // ==================== 语音识别系统 ====================
    // 语音识别管理器（延迟初始化）
    let speechManager = null;

    const initializeSpeechManager = async () => {
      if (!speechManager) {
        const SpeechManager = require('./speech/speech-manager');
        speechManager = new SpeechManager(this.database, this.ragManager);
        await speechManager.initialize();
      }
      return speechManager;
    };

    // 转录音频文件
    ipcMain.handle('speech:transcribe-file', async (event, filePath, options = {}) => {
      try {
        const manager = await initializeSpeechManager();

        // 转发进度事件
        manager.on('transcribe-progress', (progress) => {
          event.sender.send('speech:progress', progress);
        });

        return await manager.transcribeFile(filePath, options);
      } catch (error) {
        console.error('[Main] 转录音频失败:', error);
        throw error;
      }
    });

    // 批量转录音频文件
    ipcMain.handle('speech:transcribe-batch', async (event, filePaths, options = {}) => {
      try {
        const manager = await initializeSpeechManager();

        // 转发批处理进度事件
        manager.on('batch-progress', (progress) => {
          event.sender.send('speech:batch-progress', progress);
        });

        return await manager.transcribeBatch(filePaths, options);
      } catch (error) {
        console.error('[Main] 批量转录失败:', error);
        throw error;
      }
    });

    // 选择音频文件
    ipcMain.handle('speech:select-audio-files', async () => {
      try {
        const { dialog } = require('electron');
        const result = await dialog.showOpenDialog({
          properties: ['openFile', 'multiSelections'],
          filters: [
            { name: '音频文件', extensions: ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'webm'] },
            { name: '所有文件', extensions: ['*'] }
          ]
        });

        return result.canceled ? [] : result.filePaths;
      } catch (error) {
        console.error('[Main] 选择音频文件失败:', error);
        return [];
      }
    });

    // 获取配置
    ipcMain.handle('speech:get-config', async () => {
      try {
        const manager = await initializeSpeechManager();
        return await manager.getConfig();
      } catch (error) {
        console.error('[Main] 获取语音配置失败:', error);
        throw error;
      }
    });

    // 更新配置
    ipcMain.handle('speech:update-config', async (_event, config) => {
      try {
        const manager = await initializeSpeechManager();
        return await manager.updateConfig(config);
      } catch (error) {
        console.error('[Main] 更新语音配置失败:', error);
        throw error;
      }
    });

    // 设置识别引擎
    ipcMain.handle('speech:set-engine', async (_event, engineType) => {
      try {
        const manager = await initializeSpeechManager();
        return await manager.setEngine(engineType);
      } catch (error) {
        console.error('[Main] 设置识别引擎失败:', error);
        throw error;
      }
    });

    // 获取可用引擎列表
    ipcMain.handle('speech:get-available-engines', async () => {
      try {
        const manager = await initializeSpeechManager();
        return await manager.getAvailableEngines();
      } catch (error) {
        console.error('[Main] 获取可用引擎列表失败:', error);
        throw error;
      }
    });

    // 获取转录历史
    ipcMain.handle('speech:get-history', async (_event, limit = 100, offset = 0) => {
      try {
        const manager = await initializeSpeechManager();
        return await manager.getHistory(limit, offset);
      } catch (error) {
        console.error('[Main] 获取转录历史失败:', error);
        throw error;
      }
    });

    // 删除转录历史
    ipcMain.handle('speech:delete-history', async (_event, id) => {
      try {
        const manager = await initializeSpeechManager();
        return await manager.deleteHistory(id);
      } catch (error) {
        console.error('[Main] 删除转录历史失败:', error);
        throw error;
      }
    });

    // 获取音频文件
    ipcMain.handle('speech:get-audio-file', async (_event, id) => {
      try {
        const manager = await initializeSpeechManager();
        return await manager.getAudioFile(id);
      } catch (error) {
        console.error('[Main] 获取音频文件失败:', error);
        throw error;
      }
    });

    // 列出所有音频文件
    ipcMain.handle('speech:list-audio-files', async (_event, options = {}) => {
      try {
        const manager = await initializeSpeechManager();
        return await manager.listAudioFiles(options);
      } catch (error) {
        console.error('[Main] 列出音频文件失败:', error);
        throw error;
      }
    });

    // 搜索音频文件
    ipcMain.handle('speech:search-audio-files', async (_event, query, options = {}) => {
      try {
        const manager = await initializeSpeechManager();
        return await manager.searchAudioFiles(query, options);
      } catch (error) {
        console.error('[Main] 搜索音频文件失败:', error);
        throw error;
      }
    });

    // 删除音频文件
    ipcMain.handle('speech:delete-audio-file', async (_event, id) => {
      try {
        const manager = await initializeSpeechManager();
        return await manager.deleteAudioFile(id);
      } catch (error) {
        console.error('[Main] 删除音频文件失败:', error);
        throw error;
      }
    });

    // 获取统计信息
    ipcMain.handle('speech:get-stats', async (_event, userId = 'local-user') => {
      try {
        const manager = await initializeSpeechManager();
        return await manager.getStats(userId);
      } catch (error) {
        console.error('[Main] 获取统计信息失败:', error);
        throw error;
      }
    });

    // 音频降噪
    ipcMain.handle('speech:denoise-audio', async (_event, inputPath, outputPath, options = {}) => {
      try {
        const manager = await initializeSpeechManager();
        return await manager.denoiseAudio(inputPath, outputPath, options);
      } catch (error) {
        console.error('[Main] 音频降噪失败:', error);
        throw error;
      }
    });

    // 音频增强
    ipcMain.handle('speech:enhance-audio', async (_event, inputPath, outputPath, options = {}) => {
      try {
        const manager = await initializeSpeechManager();
        return await manager.enhanceAudio(inputPath, outputPath, options);
      } catch (error) {
        console.error('[Main] 音频增强失败:', error);
        throw error;
      }
    });

    // 语音增强（针对语音识别优化）
    ipcMain.handle('speech:enhance-for-recognition', async (_event, inputPath, outputPath) => {
      try {
        const manager = await initializeSpeechManager();
        return await manager.enhanceForSpeechRecognition(inputPath, outputPath);
      } catch (error) {
        console.error('[Main] 语音增强失败:', error);
        throw error;
      }
    });

    // 语言检测
    ipcMain.handle('speech:detect-language', async (_event, audioPath) => {
      try {
        const manager = await initializeSpeechManager();
        return await manager.detectLanguage(audioPath);
      } catch (error) {
        console.error('[Main] 语言检测失败:', error);
        throw error;
      }
    });

    // 批量语言检测
    ipcMain.handle('speech:detect-languages', async (_event, audioPaths) => {
      try {
        const manager = await initializeSpeechManager();
        return await manager.detectLanguages(audioPaths);
      } catch (error) {
        console.error('[Main] 批量语言检测失败:', error);
        throw error;
      }
    });

    // 生成字幕
    ipcMain.handle('speech:generate-subtitle', async (_event, audioId, outputPath, format = 'srt') => {
      try {
        const manager = await initializeSpeechManager();
        return await manager.generateSubtitle(audioId, outputPath, format);
      } catch (error) {
        console.error('[Main] 生成字幕失败:', error);
        throw error;
      }
    });

    // 转录并生成字幕
    ipcMain.handle('speech:transcribe-and-generate-subtitle', async (_event, audioPath, subtitlePath, options = {}) => {
      try {
        const manager = await initializeSpeechManager();
        return await manager.transcribeAndGenerateSubtitle(audioPath, subtitlePath, options);
      } catch (error) {
        console.error('[Main] 转录并生成字幕失败:', error);
        throw error;
      }
    });

    // 批量生成字幕
    ipcMain.handle('speech:batch-generate-subtitles', async (_event, audioIds, outputDir, format = 'srt') => {
      try {
        const manager = await initializeSpeechManager();
        return await manager.batchGenerateSubtitles(audioIds, outputDir, format);
      } catch (error) {
        console.error('[Main] 批量生成字幕失败:', error);
        throw error;
      }
    });

    // ========== 实时语音输入 IPC Handlers ==========

    // 开始实时录音
    ipcMain.handle('speech:start-realtime-recording', async (_event, options = {}) => {
      try {
        const manager = await initializeSpeechManager();
        await manager.startRealtimeRecording(options);
        return { success: true };
      } catch (error) {
        console.error('[Main] 开始实时录音失败:', error);
        throw error;
      }
    });

    // 添加音频数据
    ipcMain.handle('speech:add-realtime-audio-data', async (_event, audioData) => {
      try {
        const manager = await initializeSpeechManager();
        // 转换为Buffer（如果需要）
        const buffer = Buffer.from(audioData);
        manager.addRealtimeAudioData(buffer);
        return { success: true };
      } catch (error) {
        console.error('[Main] 添加音频数据失败:', error);
        throw error;
      }
    });

    // 暂停实时录音
    ipcMain.handle('speech:pause-realtime-recording', async () => {
      try {
        const manager = await initializeSpeechManager();
        manager.pauseRealtimeRecording();
        return { success: true };
      } catch (error) {
        console.error('[Main] 暂停实时录音失败:', error);
        throw error;
      }
    });

    // 恢复实时录音
    ipcMain.handle('speech:resume-realtime-recording', async () => {
      try {
        const manager = await initializeSpeechManager();
        manager.resumeRealtimeRecording();
        return { success: true };
      } catch (error) {
        console.error('[Main] 恢复实时录音失败:', error);
        throw error;
      }
    });

    // 停止实时录音
    ipcMain.handle('speech:stop-realtime-recording', async () => {
      try {
        const manager = await initializeSpeechManager();
        const result = await manager.stopRealtimeRecording();
        return { success: true, result };
      } catch (error) {
        console.error('[Main] 停止实时录音失败:', error);
        throw error;
      }
    });

    // 取消实时录音
    ipcMain.handle('speech:cancel-realtime-recording', async () => {
      try {
        const manager = await initializeSpeechManager();
        manager.cancelRealtimeRecording();
        return { success: true };
      } catch (error) {
        console.error('[Main] 取消实时录音失败:', error);
        throw error;
      }
    });

    // 获取实时录音状态
    ipcMain.handle('speech:get-realtime-status', async () => {
      try {
        const manager = await initializeSpeechManager();
        const status = manager.getRealtimeStatus();
        return { success: true, status };
      } catch (error) {
        console.error('[Main] 获取实时录音状态失败:', error);
        throw error;
      }
    });

    // 识别语音命令
    ipcMain.handle('speech:recognize-command', async (_event, text, context = {}) => {
      try {
        const manager = await initializeSpeechManager();
        const command = manager.recognizeCommand(text, context);
        return { success: true, command };
      } catch (error) {
        console.error('[Main] 识别语音命令失败:', error);
        throw error;
      }
    });

    // 注册自定义命令
    ipcMain.handle('speech:register-command', async (_event, command) => {
      try {
        const manager = await initializeSpeechManager();
        manager.registerCommand(command);
        return { success: true };
      } catch (error) {
        console.error('[Main] 注册自定义命令失败:', error);
        throw error;
      }
    });

    // 获取所有命令
    ipcMain.handle('speech:get-all-commands', async () => {
      try {
        const manager = await initializeSpeechManager();
        const commands = manager.getAllCommands();
        return { success: true, commands };
      } catch (error) {
        console.error('[Main] 获取所有命令失败:', error);
        throw error;
      }
    });

    // 获取缓存统计
    ipcMain.handle('speech:get-cache-stats', async () => {
      try {
        const manager = await initializeSpeechManager();
        const stats = await manager.getCacheStats();
        return { success: true, stats };
      } catch (error) {
        console.error('[Main] 获取缓存统计失败:', error);
        throw error;
      }
    });

    // 清空缓存
    ipcMain.handle('speech:clear-cache', async () => {
      try {
        const manager = await initializeSpeechManager();
        await manager.clearCache();
        return { success: true };
      } catch (error) {
        console.error('[Main] 清空缓存失败:', error);
        throw error;
      }
    });

    // 设置实时语音输入事件监听
    if (speechManager) {
      // 转发实时语音输入事件到渲染进程
      speechManager.on('realtime:started', (data) => {
        if (this.mainWindow) {
          this.mainWindow.webContents.send('speech:realtime-started', data);
        }
      });

      speechManager.on('realtime:stopped', (data) => {
        if (this.mainWindow) {
          this.mainWindow.webContents.send('speech:realtime-stopped', data);
        }
      });

      speechManager.on('realtime:paused', (data) => {
        if (this.mainWindow) {
          this.mainWindow.webContents.send('speech:realtime-paused', data);
        }
      });

      speechManager.on('realtime:resumed', (data) => {
        if (this.mainWindow) {
          this.mainWindow.webContents.send('speech:realtime-resumed', data);
        }
      });

      speechManager.on('realtime:cancelled', (data) => {
        if (this.mainWindow) {
          this.mainWindow.webContents.send('speech:realtime-cancelled', data);
        }
      });

      speechManager.on('realtime:volume', (data) => {
        if (this.mainWindow) {
          this.mainWindow.webContents.send('speech:realtime-volume', data);
        }
      });

      speechManager.on('realtime:partial', (data) => {
        if (this.mainWindow) {
          this.mainWindow.webContents.send('speech:realtime-partial', data);
        }
      });

      speechManager.on('realtime:command', (command) => {
        if (this.mainWindow) {
          this.mainWindow.webContents.send('speech:realtime-command', command);
        }
      });
    }

    console.log('[Main] 语音识别系统 IPC handlers 注册完成（含实时语音输入）');
    console.log('[Main] 插件系统 IPC handlers 注册完成');
  }

  registerCoreIPCHandlers() {
    const registerFallback = (channel, handler) => {
      try {
        ipcMain.handle(channel, handler);
        console.warn(`[Main] Registered fallback IPC handler for ${channel}`);
      } catch (error) {
        const message = String(error?.message || error);
        const isDuplicate = message.includes('second handler') || message.includes('register a second handler');
        if (!isDuplicate) {
          console.error(`[Main] Failed to register IPC handler: ${channel}`, error);
        }
      }
    };

    registerFallback('system:maximize', () => {
      if (!this.mainWindow?.isMaximized()) {
        this.mainWindow?.maximize();
      }
    });

    registerFallback('project:get-all', async (_event, userId) => {
      try {
        if (!this.database) {
          throw new Error('数据库未初始化');
        }

        const projects = this.database.getProjects(userId);
        if (!projects || projects.length === 0) {
          return [];
        }

        const cleaned = this.removeUndefinedValues(projects);
        if (!cleaned || !Array.isArray(cleaned)) {
          return [];
        }

        return cleaned;
      } catch (error) {
        console.error('[Main] 获取项目列表失败:', error);
        return [];
      }
    });

    registerFallback('template:getAll', async (_event, filters = {}) => {
      try {
        if (!this.templateManager) {
          throw new Error('模板管理器未初始化');
        }
        const templates = await this.templateManager.getAllTemplates(filters);
        return { success: true, templates };
      } catch (error) {
        console.error('[Template] 获取模板列表失败:', error);
        return { success: false, error: error.message };
      }
    });

    // 后端服务管理 IPC handlers
    registerFallback('backend-service:get-status', async () => {
      try {
        const backendManager = getBackendServiceManager();
        return await backendManager.getServicesStatus();
      } catch (error) {
        console.error('[Main] Failed to get backend service status:', error);
        return { error: error.message };
      }
    });

    registerFallback('backend-service:restart', async () => {
      try {
        const backendManager = getBackendServiceManager();
        await backendManager.restartServices();
        return { success: true };
      } catch (error) {
        console.error('[Main] Failed to restart backend services:', error);
        return { error: error.message };
      }
    });

    console.log('[Main] Backend service IPC handlers registered');
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

    // 关闭 Native Messaging HTTP Server
    if (this.nativeMessagingServer) {
      this.nativeMessagingServer.stop();
    }

    if (process.platform !== 'darwin') {
      app.quit();
    }
  }

  async onActivate() {
    if (this.mainWindow === null) {
      await this.createWindow();
    }
  }
}

// 启动应用
new ChainlessChainApp();
