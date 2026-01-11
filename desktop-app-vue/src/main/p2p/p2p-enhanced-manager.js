/**
 * P2P增强管理器 - 集成消息去重、知识库同步、文件传输
 *
 * 功能：
 * - 集成MessageManager（消息去重和批量处理）
 * - 集成KnowledgeSyncManager（知识库增量同步）
 * - 集成FileTransferManager（大文件分块传输）
 * - 统一的事件管理和错误处理
 * - 性能监控和统计
 */

const EventEmitter = require('events');
const MessageManager = require('./message-manager');
const KnowledgeSyncManager = require('./knowledge-sync-manager');
const FileTransferManager = require('./file-transfer-manager');

class P2PEnhancedManager extends EventEmitter {
  constructor(p2pManager, database, options = {}) {
    super();

    this.p2pManager = p2pManager;
    this.database = database;
    this.options = options;

    // 初始化子管理器
    this.messageManager = null;
    this.knowledgeSyncManager = null;
    this.fileTransferManager = null;

    // 状态
    this.initialized = false;
    this.isRunning = false;

    // 统计信息
    this.stats = {
      startTime: null,
      totalMessages: 0,
      totalSyncs: 0,
      totalFileTransfers: 0,
      errors: 0
    };
  }

  /**
   * 初始化增强管理器
   */
  async initialize() {
    if (this.initialized) {
      console.log('[P2PEnhanced] 已经初始化');
      return;
    }

    console.log('[P2PEnhanced] 初始化增强管理器...');

    try {
      // 1. 初始化消息管理器
      this.messageManager = new MessageManager({
        batchSize: this.options.messageBatchSize || 10,
        batchInterval: this.options.messageBatchInterval || 100,
        enableCompression: this.options.enableCompression !== false,
        enableRetry: this.options.enableRetry !== false,
        maxRetries: this.options.maxRetries || 3
      });

      // 2. 初始化知识库同步管理器
      this.knowledgeSyncManager = new KnowledgeSyncManager(
        this.database,
        this.messageManager,
        {
          syncInterval: this.options.syncInterval || 60000,
          batchSize: this.options.syncBatchSize || 50,
          enableAutoSync: this.options.enableAutoSync !== false,
          conflictStrategy: this.options.conflictStrategy || 'latest-wins'
        }
      );

      // 3. 初始化文件传输管理器
      this.fileTransferManager = new FileTransferManager(
        this.messageManager,
        {
          chunkSize: this.options.chunkSize || 64 * 1024,
          maxConcurrentChunks: this.options.maxConcurrentChunks || 3,
          enableResume: this.options.enableResume !== false,
          tempDir: this.options.tempDir
        }
      );

      // 4. 设置事件监听
      this.setupEventHandlers();

      // 5. 连接到P2P网络
      this.connectToP2PNetwork();

      this.initialized = true;
      this.isRunning = true;
      this.stats.startTime = Date.now();

      console.log('[P2PEnhanced] ✅ 增强管理器初始化完成');

      this.emit('initialized');

    } catch (error) {
      console.error('[P2PEnhanced] ❌ 初始化失败:', error);
      throw error;
    }
  }

  /**
   * 设置事件处理器
   */
  setupEventHandlers() {
    // 消息管理器事件
    this.messageManager.on('message', (data) => {
      this.handleIncomingMessage(data);
      this.stats.totalMessages++;
    });

    this.messageManager.on('send', async ({ peerId, message }) => {
      await this.sendToP2PNetwork(peerId, message);
    });

    this.messageManager.on('send-batch', async ({ peerId, messages }) => {
      await this.sendBatchToP2PNetwork(peerId, messages);
    });

    this.messageManager.on('send-failed', ({ messageId, peerId, message }) => {
      console.error('[P2PEnhanced] 消息发送失败:', messageId);
      this.emit('message:send-failed', { messageId, peerId, message });
      this.stats.errors++;
    });

    // 知识库同步事件
    this.knowledgeSyncManager.on('sync:started', ({ peerId }) => {
      console.log('[P2PEnhanced] 知识库同步开始:', peerId);
      this.emit('knowledge:sync-started', { peerId });
    });

    this.knowledgeSyncManager.on('sync:completed', (data) => {
      console.log('[P2PEnhanced] 知识库同步完成:', data);
      this.emit('knowledge:sync-completed', data);
      this.stats.totalSyncs++;
    });

    this.knowledgeSyncManager.on('sync:failed', ({ peerId, error }) => {
      console.error('[P2PEnhanced] 知识库同步失败:', peerId, error);
      this.emit('knowledge:sync-failed', { peerId, error });
      this.stats.errors++;
    });

    this.knowledgeSyncManager.on('sync:progress', (data) => {
      this.emit('knowledge:sync-progress', data);
    });

    this.knowledgeSyncManager.on('conflict:detected', (conflict) => {
      console.warn('[P2PEnhanced] 检测到冲突:', conflict.noteId);
      this.emit('knowledge:conflict', conflict);
    });

    this.knowledgeSyncManager.on('conflict:resolved', (data) => {
      console.log('[P2PEnhanced] 冲突已解决:', data.noteId);
      this.emit('knowledge:conflict-resolved', data);
    });

    // 文件传输事件
    this.fileTransferManager.on('upload:completed', (data) => {
      console.log('[P2PEnhanced] 文件上传完成:', data.fileName);
      this.emit('file:upload-completed', data);
      this.stats.totalFileTransfers++;
    });

    this.fileTransferManager.on('upload:failed', ({ transferId, fileName, error }) => {
      console.error('[P2PEnhanced] 文件上传失败:', fileName, error);
      this.emit('file:upload-failed', { transferId, fileName, error });
      this.stats.errors++;
    });

    this.fileTransferManager.on('upload:progress', (data) => {
      this.emit('file:upload-progress', data);
    });

    this.fileTransferManager.on('download:completed', (data) => {
      console.log('[P2PEnhanced] 文件下载完成:', data.fileName);
      this.emit('file:download-completed', data);
      this.stats.totalFileTransfers++;
    });

    this.fileTransferManager.on('download:failed', ({ transferId, fileName, error }) => {
      console.error('[P2PEnhanced] 文件下载失败:', fileName, error);
      this.emit('file:download-failed', { transferId, fileName, error });
      this.stats.errors++;
    });

    this.fileTransferManager.on('download:progress', (data) => {
      this.emit('file:download-progress', data);
    });

    this.fileTransferManager.on('transfer:request', (data) => {
      console.log('[P2PEnhanced] 收到文件传输请求:', data.fileName);
      this.emit('file:transfer-request', data);
    });
  }

  /**
   * 连接到P2P网络
   */
  connectToP2PNetwork() {
    if (!this.p2pManager) {
      console.warn('[P2PEnhanced] P2P管理器未初始化');
      return;
    }

    // 监听P2P网络消息
    this.p2pManager.on('message', async ({ peerId, message }) => {
      try {
        await this.messageManager.receiveMessage(peerId, message);
      } catch (error) {
        console.error('[P2PEnhanced] 处理P2P消息失败:', error);
        this.stats.errors++;
      }
    });

    // 监听P2P连接事件
    this.p2pManager.on('peer:connected', ({ peerId }) => {
      console.log('[P2PEnhanced] 节点已连接:', peerId);
      this.emit('peer:connected', { peerId });
    });

    this.p2pManager.on('peer:disconnected', ({ peerId }) => {
      console.log('[P2PEnhanced] 节点已断开:', peerId);
      this.emit('peer:disconnected', { peerId });
    });
  }

  /**
   * 处理接收到的消息
   */
  async handleIncomingMessage({ peerId, messageId, type, payload }) {
    try {
      switch (type) {
        case 'knowledge:sync-request':
          await this.knowledgeSyncManager.handleSyncRequest(peerId, payload.since);
          break;

        case 'knowledge:sync-response':
          // 由KnowledgeSyncManager内部处理
          break;

        case 'knowledge:sync-push':
          await this.knowledgeSyncManager.handleSyncPush(peerId, payload.changes);
          break;

        case 'message:ack':
          this.messageManager.receiveAck(payload.ackFor);
          break;

        default:
          // 转发给应用层
          this.emit('message', { peerId, messageId, type, payload });
      }
    } catch (error) {
      console.error('[P2PEnhanced] 处理消息失败:', error);
      this.stats.errors++;
    }
  }

  /**
   * 发送消息到P2P网络
   */
  async sendToP2PNetwork(peerId, message) {
    if (!this.p2pManager) {
      throw new Error('P2P管理器未初始化');
    }

    try {
      // 使用P2P管理器发送消息
      await this.p2pManager.sendMessage(peerId, message);
    } catch (error) {
      console.error('[P2PEnhanced] 发送消息失败:', error);
      throw error;
    }
  }

  /**
   * 批量发送消息到P2P网络
   */
  async sendBatchToP2PNetwork(peerId, messages) {
    if (!this.p2pManager) {
      throw new Error('P2P管理器未初始化');
    }

    try {
      // 发送批量消息包
      await this.p2pManager.sendMessage(peerId, {
        id: this.messageManager.generateMessageId(),
        type: 'batch',
        payload: {
          messages: messages
        },
        timestamp: Date.now()
      });
    } catch (error) {
      console.error('[P2PEnhanced] 批量发送消息失败:', error);
      throw error;
    }
  }

  /**
   * 发送消息（公共API）
   */
  async sendMessage(peerId, payload, options = {}) {
    if (!this.initialized) {
      throw new Error('增强管理器未初始化');
    }

    return await this.messageManager.sendMessage(peerId, payload, options);
  }

  /**
   * 同步知识库（公共API）
   */
  async syncKnowledge(peerId, options = {}) {
    if (!this.initialized) {
      throw new Error('增强管理器未初始化');
    }

    return await this.knowledgeSyncManager.startSync(peerId, options);
  }

  /**
   * 上传文件（公共API）
   */
  async uploadFile(peerId, filePath, options = {}) {
    if (!this.initialized) {
      throw new Error('增强管理器未初始化');
    }

    return await this.fileTransferManager.uploadFile(peerId, filePath, options);
  }

  /**
   * 下载文件（公共API）
   */
  async downloadFile(peerId, transferId, savePath) {
    if (!this.initialized) {
      throw new Error('增强管理器未初始化');
    }

    return await this.fileTransferManager.downloadFile(peerId, transferId, savePath);
  }

  /**
   * 获取文件传输进度
   */
  getFileTransferProgress(transferId) {
    return this.fileTransferManager.getProgress(transferId);
  }

  /**
   * 取消文件传输
   */
  async cancelFileTransfer(transferId) {
    return await this.fileTransferManager.cancelTransfer(transferId);
  }

  /**
   * 获取知识库冲突列表
   */
  getKnowledgeConflicts() {
    return this.knowledgeSyncManager.getConflicts();
  }

  /**
   * 手动解决知识库冲突
   */
  async resolveKnowledgeConflict(conflictId, resolution) {
    return await this.knowledgeSyncManager.resolveConflictManually(conflictId, resolution);
  }

  /**
   * 获取统计信息
   */
  getStats() {
    const uptime = this.stats.startTime ? Date.now() - this.stats.startTime : 0;

    return {
      uptime,
      totalMessages: this.stats.totalMessages,
      totalSyncs: this.stats.totalSyncs,
      totalFileTransfers: this.stats.totalFileTransfers,
      errors: this.stats.errors,
      messageManager: this.messageManager ? this.messageManager.getStats() : null,
      knowledgeSyncManager: this.knowledgeSyncManager ? this.knowledgeSyncManager.getStats() : null,
      fileTransferManager: this.fileTransferManager ? this.fileTransferManager.getStats() : null
    };
  }

  /**
   * 停止增强管理器
   */
  async stop() {
    console.log('[P2PEnhanced] 停止增强管理器...');

    this.isRunning = false;

    // 清理资源
    if (this.messageManager) {
      this.messageManager.cleanup();
    }

    if (this.knowledgeSyncManager) {
      this.knowledgeSyncManager.cleanup();
    }

    if (this.fileTransferManager) {
      this.fileTransferManager.cleanup();
    }

    this.emit('stopped');

    console.log('[P2PEnhanced] ✅ 增强管理器已停止');
  }
}

module.exports = P2PEnhancedManager;
