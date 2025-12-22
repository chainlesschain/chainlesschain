const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const DatabaseManager = require('./database');
const { UKeyManager, DriverTypes } = require('./ukey/ukey-manager');
const GitManager = require('./git/git-manager');
const MarkdownExporter = require('./git/markdown-exporter');
const { getGitConfig } = require('./git/git-config');
const { LLMManager } = require('./llm/llm-manager');
const { getLLMConfig } = require('./llm/llm-config');
const { RAGManager } = require('./rag/rag-manager');
const FileImporter = require('./import/file-importer');
const ImageUploader = require('./image/image-uploader');
const PromptTemplateManager = require('./prompt/prompt-template-manager');
const NativeMessagingHTTPServer = require('./native-messaging/http-server');
const FileSyncManager = require('./file-sync/sync-manager');
// Trade modules
const KnowledgePaymentManager = require('./trade/knowledge-payment');
const CreditScoreManager = require('./trade/credit-score');
const ReviewManager = require('./trade/review-manager');

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
    this.knowledgePaymentManager = null;
    this.creditScoreManager = null;
    this.reviewManager = null;
    this.autoSyncTimer = null;
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

    // 应用事件
    app.whenReady().then(() => this.onReady());
    app.on('window-all-closed', () => this.onWindowAllClosed());
    app.on('activate', () => this.onActivate());

    // IPC通信
    this.setupIPC();
  }

  async onReady() {
    console.log('ChainlessChain Vue 启动中...');

    // 初始化数据库
    try {
      console.log('初始化数据库...');
      this.database = new DatabaseManager();
      await this.database.initialize();
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

    // 初始化LLM管理器
    try {
      console.log('初始化LLM管理器...');
      const llmConfig = getLLMConfig();
      const managerConfig = llmConfig.getManagerConfig();

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
      await this.creditScoreManager.initialize();
      console.log('信用评分管理器初始化成功');
    } catch (error) {
      console.error('信用评分管理器初始化失败:', error);
      // 不影响应用启动
    }

    // 初始化评价管理器
    try {
      console.log('初始化评价管理器...');
      this.reviewManager = new ReviewManager(this.database);
      await this.reviewManager.initialize();
      console.log('评价管理器初始化成功');
    } catch (error) {
      console.error('评价管理器初始化失败:', error);
      // 不影响应用启动
    }

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

    this.createWindow();
  }

  createWindow() {
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

    // 初始化文件同步管理器
    try {
      console.log('初始化文件同步管理器...');
      this.fileSyncManager = new FileSyncManager(this.database, this.mainWindow);
      console.log('文件同步管理器初始化成功');
    } catch (error) {
      console.error('文件同步管理器初始化失败:', error);
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

  /**
   * 递归移除对象中的undefined值
   * Electron IPC无法序列化undefined，需要转换为null或删除
   * @param {*} obj - 要清理的对象
   * @returns {*} 清理后的对象
   */
  removeUndefinedValues(obj) {
    // 处理 null 和 undefined
    if (obj === null || obj === undefined) {
      return null;
    }

    // 处理基本类型
    if (typeof obj !== 'object') {
      return obj;
    }

    // 使用 JSON 序列化来确保完全清理
    // 这会移除所有 undefined 值、函数、Symbol等不可序列化的内容
    try {
      const jsonString = JSON.stringify(obj, (key, value) => {
        // 转换 undefined 为 null（undefined会被JSON.stringify自动移除）
        if (value === undefined) {
          console.log(`[Main] 发现 undefined 值，key: ${key}，将其转换为 null`);
          return null;
        }
        // 移除函数、Symbol等不可序列化的类型
        if (typeof value === 'function' || typeof value === 'symbol') {
          console.log(`[Main] 发现不可序列化类型，key: ${key}, type: ${typeof value}`);
          return null;
        }
        return value;
      });

      // 确保 JSON.parse 成功
      if (!jsonString || jsonString === 'null') {
        console.warn('[Main] JSON 字符串为空或null，返回 null');
        return null;
      }

      const result = JSON.parse(jsonString);

      // 最后一次检查：确保没有undefined值
      this._ensureNoUndefined(result);

      return result;
    } catch (error) {
      console.error('[Main] JSON序列化失败:', error.message);
      console.error('[Main] 对象类型:', Array.isArray(obj) ? 'Array' : 'Object');
      console.error('[Main] 对象键:', obj ? Object.keys(obj).slice(0, 10) : 'N/A');

      // 备用方法：手动清理
      if (Array.isArray(obj)) {
        console.log('[Main] 使用备用方法清理数组');
        const cleaned = obj
          .map(item => this.removeUndefinedValues(item))
          .filter(item => item !== null && item !== undefined);
        return cleaned.length > 0 ? cleaned : [];
      }

      console.log('[Main] 使用备用方法清理对象');
      const cleaned = {};
      for (const [key, value] of Object.entries(obj)) {
        if (value !== undefined && typeof value !== 'function' && typeof value !== 'symbol') {
          try {
            cleaned[key] = this.removeUndefinedValues(value);
          } catch (e) {
            console.error(`[Main] 清理键 ${key} 失败:`, e.message);
            cleaned[key] = null;
          }
        }
      }
      return cleaned;
    }
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

  setupIPC() {
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

    // 获取项目文件列表
    ipcMain.handle('project:get-files', async (_event, projectId) => {
      try {
        if (!this.database) {
          throw new Error('数据库未初始化');
        }
        const files = this.database.getProjectFiles(projectId);
        return this.removeUndefinedValues(files);
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
        if (!this.database) {
          throw new Error('数据库未初始化');
        }
        this.database.updateProjectFile(fileUpdate);
        return { success: true };
      } catch (error) {
        console.error('[Main] 更新文件失败:', error);
        throw error;
      }
    });

    // 删除文件
    ipcMain.handle('project:delete-file', async (_event, fileId) => {
      try {
        if (!this.database) {
          throw new Error('数据库未初始化');
        }
        this.database.db.run('DELETE FROM project_files WHERE id = ?', [fileId]);
        this.database.saveToFile();
        return { success: true };
      } catch (error) {
        console.error('[Main] 删除文件失败:', error);
        throw error;
      }
    });

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

    // 获取模板列表
    ipcMain.handle('project:get-templates', async () => {
      try {
        if (!this.database) {
          throw new Error('数据库未初始化');
        }

        // 先从本地获取
        let templates = this.database.getProjectTemplates();

        // 如果本地为空，从后端获取
        if (templates.length === 0) {
          try {
            const { getProjectHTTPClient } = require('./project/http-client');
            const httpClient = getProjectHTTPClient();

            templates = await httpClient.getTemplates();

            // 缓存到本地
            if (templates && templates.length > 0) {
              this.database.saveProjectTemplates(templates);
            }
          } catch (backendError) {
            console.warn('[Main] 从后端获取模板失败，使用本地数据:', backendError);
          }
        }

        return templates;
      } catch (error) {
        console.error('[Main] 获取模板列表失败:', error);
        throw error;
      }
    });

    // 获取模板详情
    ipcMain.handle('project:get-template', async (_event, templateId) => {
      try {
        if (!this.database) {
          throw new Error('数据库未初始化');
        }
        const stmt = this.database.db.prepare('SELECT * FROM project_templates WHERE id = ?');
        return stmt.get(templateId);
      } catch (error) {
        console.error('[Main] 获取模板详情失败:', error);
        throw error;
      }
    });

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

        // 3. 合并数据
        if (this.database) {
          this.database.transaction(() => {
            backendProjects.forEach(project => {
              const createdAt = project.createdAt ? new Date(project.createdAt).getTime() : Date.now();
              const updatedAt = project.updatedAt ? new Date(project.updatedAt).getTime() : Date.now();

              // 构建项目对象，避免 undefined 值
              const projectData = {
                id: project.id,
                user_id: project.userId,
                name: project.name,
                project_type: project.projectType,
                status: project.status || 'active',
                file_count: project.fileCount || 0,
                total_size: project.totalSize || 0,
                tags: JSON.stringify(project.tags || []),
                metadata: JSON.stringify(project.metadata || {}),
                created_at: createdAt,
                updated_at: updatedAt,
                synced_at: Date.now(),
                sync_status: 'synced',
              };

              // 只有当字段存在时才添加（避免 undefined）
              if (project.description) projectData.description = project.description;
              if (project.rootPath) projectData.root_path = project.rootPath;
              if (project.templateId) projectData.template_id = project.templateId;
              if (project.coverImageUrl) projectData.cover_image_url = project.coverImageUrl;

              this.database.saveProject(projectData);
            });
          });
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
    ipcMain.handle('project:git-init', async (_event, repoPath) => {
      try {
        const git = require('isomorphic-git');
        const fs = require('fs');

        await git.init({
          fs,
          dir: repoPath,
          defaultBranch: 'main',
        });

        return { success: true };
      } catch (error) {
        console.error('[Main] Git初始化失败:', error);
        throw error;
      }
    });

    // Git状态查询
    ipcMain.handle('project:git-status', async (_event, repoPath) => {
      try {
        const git = require('isomorphic-git');
        const fs = require('fs');

        const status = await git.statusMatrix({ fs, dir: repoPath });

        return status;
      } catch (error) {
        console.error('[Main] Git状态查询失败:', error);
        throw error;
      }
    });

    // Git提交
    ipcMain.handle('project:git-commit', async (_event, repoPath, message) => {
      try {
        const git = require('isomorphic-git');
        const fs = require('fs');

        // Add all changes
        const status = await git.statusMatrix({ fs, dir: repoPath });
        for (const row of status) {
          const [filepath, , worktreeStatus] = row;
          if (worktreeStatus !== 1) {
            await git.add({ fs, dir: repoPath, filepath });
          }
        }

        // Commit
        const sha = await git.commit({
          fs,
          dir: repoPath,
          message,
          author: {
            name: this.gitManager?.author?.name || 'ChainlessChain User',
            email: this.gitManager?.author?.email || 'user@chainlesschain.com',
          },
        });

        return { success: true, sha };
      } catch (error) {
        console.error('[Main] Git提交失败:', error);
        throw error;
      }
    });

    // Git推送
    ipcMain.handle('project:git-push', async (_event, repoPath) => {
      try {
        const git = require('isomorphic-git');
        const fs = require('fs');
        const http = require('isomorphic-git/http/node');

        await git.push({
          fs,
          http,
          dir: repoPath,
          remote: 'origin',
          ref: 'main',
          onAuth: () => this.gitManager?.auth || {},
        });

        return { success: true };
      } catch (error) {
        console.error('[Main] Git推送失败:', error);
        throw error;
      }
    });

    // Git拉取
    ipcMain.handle('project:git-pull', async (_event, repoPath) => {
      try {
        const git = require('isomorphic-git');
        const fs = require('fs');
        const http = require('isomorphic-git/http/node');

        await git.pull({
          fs,
          http,
          dir: repoPath,
          ref: 'main',
          singleBranch: true,
          onAuth: () => this.gitManager?.auth || {},
        });

        return { success: true };
      } catch (error) {
        console.error('[Main] Git拉取失败:', error);
        throw error;
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

  onActivate() {
    if (this.mainWindow === null) {
      this.createWindow();
    }
  }
}

// 启动应用
new ChainlessChainApp();
