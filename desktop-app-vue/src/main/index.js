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

    /* ========================================================================
       MIGRATED TO document/document-ipc.js (1 ppt: handler)
       包括: PPT导出

       已迁移 handlers:
       - ppt:export
       ======================================================================== */

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


    /* ========================================================================
       MIGRATED TO project/project-rag-ipc.js (10 project: RAG handlers)
       包括: 文件索引, RAG查询, 索引统计等

       已迁移 handlers:
       - project:indexFiles, project:ragQuery, project:updateFileIndex
       - project:deleteIndex, project:getIndexStats
       - project:rag-index, project:rag-stats, project:rag-query
       - project:rag-update-file, project:rag-delete
       ======================================================================== */


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
