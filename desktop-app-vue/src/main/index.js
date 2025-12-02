const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const DatabaseManager = require('./database');
const { UKeyManager, DriverTypes } = require('./ukey/ukey-manager');
const GitManager = require('./git/git-manager');
const MarkdownExporter = require('./git/markdown-exporter');
const { getGitConfig } = require('./git/git-config');
const { LLMManager } = require('./llm/llm-manager');
const { getLLMConfig } = require('./llm/llm-config');
const { RAGManager } = require('./rag/rag-manager');

class ChainlessChainApp {
  constructor() {
    this.mainWindow = null;
    this.database = null;
    this.ukeyManager = null;
    this.gitManager = null;
    this.markdownExporter = null;
    this.llmManager = null;
    this.ragManager = null;
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
      this.database.initialize();
      console.log('数据库初始化成功');
    } catch (error) {
      console.error('数据库初始化失败:', error);
      // 即使数据库初始化失败，也继续启动应用
    }

    // 初始化U盾管理器
    try {
      console.log('初始化U盾管理器...');
      this.ukeyManager = new UKeyManager({
        driverType: DriverTypes.XINJINKE,
      });
      await this.ukeyManager.initialize();

      // 启动设备监听
      this.ukeyManager.startDeviceMonitor(5000);

      // 监听U盾事件
      this.setupUKeyEvents();

      console.log('U盾管理器初始化成功');
    } catch (error) {
      console.error('U盾管理器初始化失败:', error);
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
      console.log('[Main] U盾设备已连接');
      if (this.mainWindow) {
        this.mainWindow.webContents.send('ukey:device-connected', status);
      }
    });

    this.ukeyManager.on('device-disconnected', () => {
      console.log('[Main] U盾设备已断开');
      if (this.mainWindow) {
        this.mainWindow.webContents.send('ukey:device-disconnected');
      }
    });

    this.ukeyManager.on('unlocked', (result) => {
      console.log('[Main] U盾已解锁');
      if (this.mainWindow) {
        this.mainWindow.webContents.send('ukey:unlocked', result);
      }
    });

    this.ukeyManager.on('locked', () => {
      console.log('[Main] U盾已锁定');
      if (this.mainWindow) {
        this.mainWindow.webContents.send('ukey:locked');
      }
    });
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

        await this.gitManager.pull();
        return true;
      } catch (error) {
        console.error('[Main] Git拉取失败:', error);
        throw error;
      }
    });

    ipcMain.handle('git:get-log', async (_event, depth = 10) => {
      try {
        if (!this.gitManager) {
          throw new Error('Git同步未启用');
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

    // 系统操作
    ipcMain.handle('system:get-version', () => {
      return app.getVersion();
    });

    ipcMain.handle('system:minimize', () => {
      this.mainWindow?.minimize();
    });

    ipcMain.handle('system:maximize', () => {
      if (this.mainWindow?.isMaximized()) {
        this.mainWindow.unmaximize();
      } else {
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
