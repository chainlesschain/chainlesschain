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

      // 清理菜单管理器
      if (this.menuManager) {
        this.menuManager.destroy();
        this.menuManager = null;
      }

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

    // 所有管理器初始化完成，现在注册IPC handlers
    try {
      this.setupIPC();
    } catch (error) {
      console.error('[Main] IPC setup failed:', error);
    } finally {
      this.registerCoreIPCHandlers();
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
    // ========================================================================
    // 覆盖 ipcMain.handle 以自动跳过重复注册（临时）
    // ========================================================================
    const originalHandle = ipcMain.handle.bind(ipcMain);
    ipcMain.handle = (channel, handler) => {
      try {
        originalHandle(channel, handler);
      } catch (error) {
        const message = String(error?.message || error);
        const isDuplicate = message.includes('second handler') || message.includes('register a second handler');
        if (isDuplicate) {
          // 忽略重复注册错误（handler已在模块化IPC中注册）
          console.log(`[ChainlessChainApp] Skipping duplicate handler: ${channel}`);
        } else {
          // 其他错误需要报告
          console.error(`[ChainlessChainApp] Failed to register IPC handler: ${channel}`, error);
          throw error;
        }
      }
    };

    // Helper函数：安全注册IPC handler（向后兼容）
    const safeRegisterHandler = ipcMain.handle;

    // ========================================================================
    // 模块化 IPC 注册中心 (第一阶段：LLM 和 RAG 模块已迁移)
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
        chatSkillBridge: this.chatSkillBridge
      });

      console.log('[ChainlessChainApp] ✓ Modular IPC registration complete');
    } catch (error) {
      console.error('[ChainlessChainApp] ❌ Modular IPC registration failed:', error);
    }

    console.log('[ChainlessChainApp] ========================================');
    console.log('[ChainlessChainApp] Registering legacy IPC handlers...');
    console.log('[ChainlessChainApp] (To be migrated in future phases)');
    console.log('[ChainlessChainApp] ========================================');

    // ========================================================================
    // 遗留 IPC Handlers（待迁移到模块化）
    // ========================================================================

    // 注册技能和工具IPC handlers
    // 注意：实际注册在 onReady() 中进行，因为需要等待 skillManager 和 toolManager 初始化完成

    /* ========================================================================
       ⚠️ MIGRATED TO ukey/ukey-ipc.js (9 handlers)
       已迁移的 handlers:
       - ukey:detect, ukey:verify-pin, ukey:get-device-info
       - ukey:sign, ukey:encrypt, ukey:decrypt
       - ukey:lock, ukey:get-public-key
       - auth:verify-password
       ======================================================================== */

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

    /* ========================================================================
       MIGRATED TO database/database-ipc.js (15 db:* handlers)
       已迁移的 handlers:
       - db:get-knowledge-items, db:get-knowledge-item-by-id
       - db:add-knowledge-item, db:update-knowledge-item, db:delete-knowledge-item
       - db:search-knowledge-items
       - db:get-all-tags, db:create-tag, db:get-knowledge-tags
       - db:get-statistics, db:get-path
       - db:switch-database, db:get-context-path, db:get-current-path
       - db:backup
       ======================================================================== */

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

    /* ========================================================================
       MIGRATED TO video/video-ipc.js (18 video: handlers)
       包括: 文件选择导入, 视频管理, 视频编辑处理

       已迁移 handlers (导入管理部分):
       - video:select-files, video:import-file, video:import-files
       - video:get-video, video:get-videos, video:get-analysis
       - video:get-keyframes, video:delete-video, video:get-stats

       已迁移 handlers (编辑处理部分):
       - video:convert, video:trim, video:merge
       - video:addSubtitles, video:generateSubtitles, video:extractAudio
       - video:generateThumbnail, video:compress, video:getInfo
       ======================================================================== */

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

    /* ========================================================================
       MIGRATED TO image/image-ipc.js (22 image: handlers)
       包括: 图片选择上传, 图片管理, AI图像生成与处理

       已迁移 handlers:
       - image:select-images, image:upload, image:upload-batch
       - image:ocr, image:get, image:list, image:search, image:delete
       - image:get-stats, image:get-supported-formats, image:get-supported-languages
       - image:generateFromText, image:removeBackground, image:resize, image:crop
       - image:enhance, image:upscale, image:addWatermark, image:batchProcess
       - image:convertFormat, image:createCollage, image:getInfo
       ======================================================================== */

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

    /* ========================================================================
       MIGRATED TO prompt-template/prompt-template-ipc.js (11 prompt-template: handlers)
       包括: 模板查询, 模板管理, 模板使用, 分类统计, 导入导出

       已迁移 handlers:
       - prompt-template:get-all, prompt-template:get, prompt-template:search
       - prompt-template:create, prompt-template:update, prompt-template:delete
       - prompt-template:fill
       - prompt-template:get-categories, prompt-template:get-statistics
       - prompt-template:export, prompt-template:import
       ======================================================================== */

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

    // ========================================================================
    // ⚠️ LLM & RAG 相关 IPC 已迁移到模块化 (llm/llm-ipc.js 和 rag/rag-ipc.js)
    // 以下代码已注释，避免重复注册
    // ========================================================================

    /* ========================================================================
       MIGRATED TO llm/llm-ipc.js & rag/rag-ipc.js (21 handlers)

       LLM handlers (14):
       - llm:check-status, llm:query, llm:chat, llm:chat-with-template
       - llm:query-stream, llm:get-config, llm:set-config, llm:list-models
       - llm:clear-context, llm:embeddings

       RAG handlers (7):
       - rag:retrieve, rag:enhance-query, rag:rebuild-index, rag:get-stats
       - rag:update-config, rag:get-rerank-config, rag:set-reranking-enabled
       ======================================================================== */

    // DID身份管理
    /* ========================================================================
       MIGRATED TO did/did-ipc.js (24 did:* handlers)
       ======================================================================== */

    // ============================
    // 企业版：身份上下文 IPC Handler
    // ============================
    /* ========================================================================
       MIGRATED TO identity-context/identity-context-ipc.js (7 identity:* handlers)
       ======================================================================== */


    // ============================
    // 企业版：组织管理IPC Handler
    // ============================
    /* ========================================================================
       MIGRATED TO organization/organization-ipc.js (32 org:* handlers)
       ======================================================================== */


    /* ========================================================================
       MIGRATED TO knowledge/knowledge-ipc.js (17 knowledge: handlers)
       包括: 标签管理, 版本管理, 付费内容管理

       已迁移 handlers:
       - knowledge:get-tags
       - knowledge:get-version-history, knowledge:restore-version, knowledge:compare-versions
       - knowledge:create-content, knowledge:update-content, knowledge:delete-content
       - knowledge:get-content, knowledge:list-contents
       - knowledge:purchase-content, knowledge:subscribe, knowledge:unsubscribe
       - knowledge:get-my-purchases, knowledge:get-my-subscriptions
       - knowledge:access-content, knowledge:check-access, knowledge:get-statistics
       ======================================================================== */

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
    /* ========================================================================
       MIGRATED TO social/social-ipc.js (33 handlers)
       - Contact Management (9 handlers): contact:*
       - Friend Management (9 handlers): friend:*
       - Post/Feed Management (10 handlers): post:*
       - Chat/Messaging (5 handlers): chat:*
       ======================================================================== */

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
    /* ========================================================================
       MIGRATED TO p2p/p2p-ipc.js (18 p2p:* handlers)
       ======================================================================== */

    // 可验证凭证 (VC)
    /* ========================================================================
       MIGRATED TO vc/vc-ipc.js (10 vc:* handlers)
       ======================================================================== */

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

    /* MIGRATED TO git/git-ipc.js (15 git:* handlers)
    // Git同步 - 完整实现

    // ==================== 项目管理 IPC ====================

    /* ========================================================================
       MIGRATED TO project/project-core-ipc.js (34 project: handlers)
       包括: CRUD, 文件管理, 路径修复, 同步恢复, 统计等

       已迁移 handlers:
       - project:get-all, project:get, project:create, project:create-stream
       - project:stream-cancel, project:create-quick, project:save, project:update
       - project:delete, project:delete-local, project:fetch-from-backend
       - project:fix-path, project:repair-root-path, project:repair-all-root-paths
       - project:get-files, project:get-file, project:save-files
       - project:update-file, project:delete-file
       - project:indexConversations, project:startWatcher, project:stopWatcher
       - project:resolve-path
       - project:sync, project:sync-one
       - project:scan-recoverable, project:recover, project:recover-batch
       - project:auto-recover, project:recovery-stats
       - project:stats:start, project:stats:stop, project:stats:get, project:stats:update
       ======================================================================== */


    // ==================== 项目AI对话 IPC ====================

    /* ========================================================================
       MIGRATED TO project/project-ai-ipc.js (15 project: AI handlers)
       包括: AI对话, 文件扫描, 任务规划, 内容处理, 代码助手

       已迁移 handlers:
       - project:aiChat, project:scan-files
       - project:decompose-task, project:execute-task-plan
       - project:get-task-plan, project:get-task-plan-history, project:cancel-task-plan
       - project:polishContent, project:expandContent
       - project:code-generate, project:code-review, project:code-refactor
       - project:code-explain, project:code-fix-bug
       - project:code-generate-tests, project:code-optimize
       ======================================================================== */

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

    /* ========================================================================
       MIGRATED TO file/file-ipc.js (17 file: handlers)
       包括: 文件读写, 文件管理, 系统剪贴板, 扩展操作

       已迁移 handlers:
       - file:read-content, file:write-content, file:read-binary
       - file:revealInExplorer, file:copyItem, file:moveItem, file:deleteItem
       - file:renameItem, file:createFile, file:createFolder, file:openWithDefault
       - file:copyToSystemClipboard, file:cutToSystemClipboard
       - file:pasteFromSystemClipboard, file:importFromSystemClipboard
       - file:openWith, file:openWithProgram
       ======================================================================== */

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

    /* ⚠️ MIGRATED TO llm/llm-ipc.js
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
    END OF MIGRATED LLM智能选择 */

    // ==================== 数据库配置 IPC ====================
    /* MIGRATED TO database/database-ipc.js (6 database:* handlers) */

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

    /* ========================================================================
       MIGRATED TO project/project-export-ipc.js (17 project: export/share handlers)
       包括: 文档导出, PPT生成, 分享功能, 文件操作等

       已迁移 handlers:
       - project:exportDocument, project:generatePPT, project:generatePodcastScript, project:generateArticleImages
       - project:shareProject, project:getShare, project:deleteShare, project:accessShare, project:shareToWechat
       - project:copyFile, project:move-file, project:import-file
       - project:export-file, project:export-files, project:select-export-directory
       - project:select-import-files, project:import-files
       ======================================================================== */

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

    /* ========================================================================
       MIGRATED TO document/document-ipc.js (1 ppt: handler)
       包括: PPT导出

       已迁移 handlers:
       - ppt:export
       ======================================================================== */

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

    /* ========================================================================
       MIGRATED TO template/template-ipc.js (20 template: handlers)
       包括: 模板查询, 模板管理, 模板渲染, 使用评价, 文件操作

       已迁移 handlers:
       - template:getAll, template:getById, template:search
       - template:getStats, template:getRecent, template:getPopular
       - template:create, template:update, template:delete, template:duplicate
       - template:renderPrompt, template:render, template:validate
       - template:recordUsage, template:rate
       - template:preview, template:loadTemplate, template:saveTemplate
       - template:extractVariables, template:getDefaultVariables
       ======================================================================== */

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

    /* ========================================================================
       MIGRATED TO project/project-rag-ipc.js (10 project: RAG handlers)
       包括: 文件索引, RAG查询, 索引统计等

       已迁移 handlers:
       - project:indexFiles, project:ragQuery, project:updateFileIndex
       - project:deleteIndex, project:getIndexStats
       - project:rag-index, project:rag-stats, project:rag-query
       - project:rag-update-file, project:rag-delete
       ======================================================================== */

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

    /* ========================================================================
       MIGRATED TO pdf/pdf-ipc.js (4 pdf: handlers)
       包括: Markdown/HTML/文本转PDF, 批量转换

       已迁移 handlers:
       - pdf:markdownToPDF, pdf:htmlFileToPDF
       - pdf:textFileToPDF, pdf:batchConvert
       ======================================================================== */

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
    /* MIGRATED TO git/git-ipc.js */


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

    /* ========================================================================
       MIGRATED TO project/project-git-ipc.js (14 project: Git handlers)
       包括: Git基础操作, 历史与差异, 分支管理等

       已迁移 handlers:
       - project:git-init, project:git-status, project:git-commit
       - project:git-push, project:git-pull
       - project:git-log, project:git-show-commit, project:git-diff
       - project:git-branches, project:git-create-branch, project:git-checkout
       - project:git-merge, project:git-resolve-conflicts, project:git-generate-commit-message
       ======================================================================== */

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

    /* ========================================================================
       MIGRATED TO speech/speech-ipc.js (34 speech: handlers)
       包括: 文件转录, 配置管理, 历史记录, 音频处理, 字幕生成, 实时录音, 命令识别

       已迁移 handlers:
       - speech:transcribe-file, speech:transcribe-batch, speech:select-audio-files
       - speech:get-config, speech:update-config, speech:set-engine, speech:get-available-engines
       - speech:get-history, speech:delete-history
       - speech:get-audio-file, speech:list-audio-files, speech:search-audio-files
       - speech:delete-audio-file, speech:get-stats
       - speech:denoise-audio, speech:enhance-audio, speech:enhance-for-recognition
       - speech:detect-language, speech:detect-languages
       - speech:generate-subtitle, speech:transcribe-and-generate-subtitle, speech:batch-generate-subtitles
       - speech:start-realtime-recording, speech:add-realtime-audio-data
       - speech:pause-realtime-recording, speech:resume-realtime-recording
       - speech:stop-realtime-recording, speech:cancel-realtime-recording, speech:get-realtime-status
       - speech:recognize-command, speech:register-command, speech:get-all-commands
       - speech:get-cache-stats, speech:clear-cache
       ======================================================================== */

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
