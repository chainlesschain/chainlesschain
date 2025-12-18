import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
// import { Database } from './database'; // 旧的内存数据库
import { SQLCipherDatabase } from './database-sqlcipher';
import { UKeyManager } from './ukey';
import { GitSync } from './git-sync';
import { LLMService } from './llm-service';

class ChainlessChainApp {
  private mainWindow: BrowserWindow | null = null;
  private database: SQLCipherDatabase | null = null;
  private ukeyManager: UKeyManager | null = null;
  private gitSync: GitSync | null = null;
  private llmService: LLMService | null = null;

  constructor() {
    this.setupApp();
  }

  private setupApp() {
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

  private async onReady() {
    console.log('ChainlessChain 启动中...');

    // 初始化组件
    try {
      await this.initializeComponents();
      this.createWindow();
    } catch (error) {
      console.error('初始化失败:', error);
      app.quit();
    }
  }

  private async initializeComponents() {
    console.log('初始化U盾管理器...');
    this.ukeyManager = new UKeyManager();

    console.log('初始化SQLCipher数据库...');
    this.database = new SQLCipherDatabase();
    // TODO: 后续从U盾获取加密密钥
    // const encryptionKey = await this.ukeyManager.getDatabaseKey();
    await this.database.initialize(/* encryptionKey */);

    console.log('初始化Git同步...');
    this.gitSync = new GitSync(this.database);

    console.log('初始化LLM服务...');
    this.llmService = new LLMService();
    await this.llmService.checkConnection();

    console.log('所有组件初始化完成');
  }

  private createWindow() {
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

  private setupIPC() {
    // U盾相关
    ipcMain.handle('ukey:detect', async () => {
      return this.ukeyManager?.detectUKey();
    });

    ipcMain.handle('ukey:verify-pin', async (_event, pin: string) => {
      return this.ukeyManager?.verifyPIN(pin);
    });

    ipcMain.handle('ukey:sign', async (_event, data: string) => {
      return this.ukeyManager?.sign(data);
    });

    ipcMain.handle('ukey:verify-signature', async (_event, data: string, signature: string) => {
      return this.ukeyManager?.verifySignature(data, signature);
    });

    // 数据库操作
    ipcMain.handle('db:get-knowledge-items', async (_event, limit?: number, offset?: number) => {
      return this.database?.getKnowledgeItems(limit, offset);
    });

    ipcMain.handle('db:get-knowledge-item-by-id', async (_event, id: string) => {
      return this.database?.getKnowledgeItemById(id);
    });

    ipcMain.handle('db:add-knowledge-item', async (_event, item: any) => {
      return this.database?.addKnowledgeItem(item);
    });

    ipcMain.handle('db:update-knowledge-item', async (_event, id: string, updates: any) => {
      return this.database?.updateKnowledgeItem(id, updates);
    });

    ipcMain.handle('db:delete-knowledge-item', async (_event, id: string) => {
      return this.database?.deleteKnowledgeItem(id);
    });

    ipcMain.handle('db:search-knowledge-items', async (_event, query: string) => {
      return this.database?.searchKnowledge(query);
    });

    // Git同步
    ipcMain.handle('git:sync', async () => {
      return this.gitSync?.sync();
    });

    ipcMain.handle('git:commit', async (_event, message: string) => {
      return this.gitSync?.commit(message);
    });

    ipcMain.handle('git:status', async () => {
      return this.gitSync?.getStatus();
    });

    // LLM服务
    ipcMain.handle('llm:query', async (_event, prompt: string, context?: string[]) => {
      return this.llmService?.query(prompt, context);
    });

    ipcMain.handle('llm:embed', async (_event, text: string) => {
      return this.llmService?.embed(text);
    });

    ipcMain.handle('llm:check-status', async () => {
      return this.llmService?.checkConnection();
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

  private onWindowAllClosed() {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  }

  private onActivate() {
    if (this.mainWindow === null) {
      this.createWindow();
    }
  }
}

// 启动应用
new ChainlessChainApp();
