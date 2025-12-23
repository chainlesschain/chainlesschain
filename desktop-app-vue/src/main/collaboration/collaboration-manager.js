/**
 * 协作管理器
 * 提供实时协作编辑功能，支持多用户同时编辑文档
 * 基于ShareDB实现OT (Operational Transformation) 算法
 */

const ShareDB = require('sharedb');
const WebSocket = require('ws');
const WebSocketJSONStream = require('@teamwork/websocket-json-stream');
const { EventEmitter } = require('events');

class CollaborationManager extends EventEmitter {
  constructor() {
    super();
    this.sharedb = null;
    this.wss = null;
    this.connections = new Map();
    this.documents = new Map();
    this.port = 8080;
    this.initialized = false;
    this.database = null;
  }

  /**
   * 初始化协作管理器
   */
  async initialize(options = {}) {
    if (this.initialized) return;

    try {
      const { port = 8080 } = options;
      this.port = port;

      // 初始化ShareDB
      this.sharedb = new ShareDB();

      // 获取数据库
      const { getDatabase } = require('../database');
      this.database = getDatabase();

      // 创建数据库表
      await this.createTables();

      this.initialized = true;
      console.log('[CollaborationManager] 初始化完成');
    } catch (error) {
      console.error('[CollaborationManager] 初始化失败:', error);
      throw error;
    }
  }

  /**
   * 创建数据库表
   */
  async createTables() {
    try {
      this.database.exec(`
        CREATE TABLE IF NOT EXISTS collaboration_sessions (
          id TEXT PRIMARY KEY,
          document_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          user_name TEXT NOT NULL,
          joined_at INTEGER NOT NULL,
          last_seen INTEGER NOT NULL,
          is_active INTEGER DEFAULT 1
        )
      `);

      this.database.exec(`
        CREATE TABLE IF NOT EXISTS collaboration_operations (
          id TEXT PRIMARY KEY,
          document_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          operation TEXT NOT NULL,
          version INTEGER NOT NULL,
          timestamp INTEGER NOT NULL
        )
      `);

      console.log('[CollaborationManager] 数据库表创建成功');
    } catch (error) {
      console.error('[CollaborationManager] 创建数据库表失败:', error);
      throw error;
    }
  }

  /**
   * 启动WebSocket服务器
   */
  async startServer() {
    if (this.wss) {
      console.warn('[CollaborationManager] 服务器已在运行');
      return;
    }

    try {
      this.wss = new WebSocket.Server({ port: this.port });

      this.wss.on('connection', (ws, req) => {
        const connectionId = this.generateConnectionId();
        console.log(`[CollaborationManager] 新连接: ${connectionId}`);

        // 创建ShareDB stream
        const stream = new WebSocketJSONStream(ws);
        this.sharedb.listen(stream);

        // 保存连接信息
        this.connections.set(connectionId, {
          ws: ws,
          stream: stream,
          userId: null,
          documentId: null,
          connectedAt: Date.now()
        });

        // 处理消息
        ws.on('message', async (data) => {
          try {
            const message = JSON.parse(data);
            await this.handleMessage(connectionId, message);
          } catch (error) {
            console.error('[CollaborationManager] 处理消息失败:', error);
          }
        });

        // 处理断开连接
        ws.on('close', () => {
          console.log(`[CollaborationManager] 连接关闭: ${connectionId}`);
          this.handleDisconnect(connectionId);
          this.connections.delete(connectionId);
        });

        // 处理错误
        ws.on('error', (error) => {
          console.error(`[CollaborationManager] WebSocket错误:`, error);
        });
      });

      console.log(`[CollaborationManager] WebSocket服务器启动在端口 ${this.port}`);
      this.emit('server:started', { port: this.port });

      return { success: true, port: this.port };

    } catch (error) {
      console.error('[CollaborationManager] 启动服务器失败:', error);
      throw error;
    }
  }

  /**
   * 停止WebSocket服务器
   */
  async stopServer() {
    if (!this.wss) return;

    try {
      // 关闭所有连接
      this.connections.forEach((conn) => {
        conn.ws.close();
      });

      // 关闭服务器
      await new Promise((resolve) => {
        this.wss.close(() => {
          console.log('[CollaborationManager] 服务器已停止');
          resolve();
        });
      });

      this.wss = null;
      this.connections.clear();

      this.emit('server:stopped');

      return { success: true };

    } catch (error) {
      console.error('[CollaborationManager] 停止服务器失败:', error);
      throw error;
    }
  }

  /**
   * 处理消息
   */
  async handleMessage(connectionId, message) {
    const conn = this.connections.get(connectionId);
    if (!conn) return;

    const { type, payload } = message;

    switch (type) {
      case 'join':
        await this.handleJoin(connectionId, payload);
        break;

      case 'cursor':
        await this.handleCursorUpdate(connectionId, payload);
        break;

      case 'selection':
        await this.handleSelectionUpdate(connectionId, payload);
        break;

      case 'presence':
        await this.handlePresenceUpdate(connectionId, payload);
        break;

      default:
        console.warn(`[CollaborationManager] 未知消息类型: ${type}`);
    }
  }

  /**
   * 处理加入文档
   */
  async handleJoin(connectionId, payload) {
    const { userId, userName, documentId } = payload;

    const conn = this.connections.get(connectionId);
    if (conn) {
      conn.userId = userId;
      conn.documentId = documentId;
      conn.userName = userName;
    }

    // 记录会话
    const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const now = Date.now();

    this.database.prepare(`
      INSERT INTO collaboration_sessions
      (id, document_id, user_id, user_name, joined_at, last_seen)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(sessionId, documentId, userId, userName, now, now);

    // 通知其他用户
    this.broadcastToDocument(documentId, userId, {
      type: 'user:joined',
      payload: {
        userId: userId,
        userName: userName,
        sessionId: sessionId
      }
    });

    // 获取当前在线用户
    const onlineUsers = this.getOnlineUsers(documentId);

    // 发送当前用户列表给新加入的用户
    conn.ws.send(JSON.stringify({
      type: 'users:online',
      payload: { users: onlineUsers }
    }));

    console.log(`[CollaborationManager] 用户加入文档: ${userName} -> ${documentId}`);
  }

  /**
   * 处理光标更新
   */
  async handleCursorUpdate(connectionId, payload) {
    const conn = this.connections.get(connectionId);
    if (!conn) return;

    const { position } = payload;

    // 广播光标位置
    this.broadcastToDocument(conn.documentId, conn.userId, {
      type: 'cursor:update',
      payload: {
        userId: conn.userId,
        userName: conn.userName,
        position: position
      }
    });
  }

  /**
   * 处理选区更新
   */
  async handleSelectionUpdate(connectionId, payload) {
    const conn = this.connections.get(connectionId);
    if (!conn) return;

    const { selection } = payload;

    // 广播选区
    this.broadcastToDocument(conn.documentId, conn.userId, {
      type: 'selection:update',
      payload: {
        userId: conn.userId,
        userName: conn.userName,
        selection: selection
      }
    });
  }

  /**
   * 处理在线状态更新
   */
  async handlePresenceUpdate(connectionId, payload) {
    const conn = this.connections.get(connectionId);
    if (!conn) return;

    const { status } = payload;

    // 更新最后活跃时间
    const now = Date.now();
    this.database.prepare(`
      UPDATE collaboration_sessions
      SET last_seen = ?
      WHERE user_id = ? AND document_id = ? AND is_active = 1
    `).run(now, conn.userId, conn.documentId);

    // 广播状态更新
    this.broadcastToDocument(conn.documentId, conn.userId, {
      type: 'presence:update',
      payload: {
        userId: conn.userId,
        userName: conn.userName,
        status: status
      }
    });
  }

  /**
   * 处理断开连接
   */
  handleDisconnect(connectionId) {
    const conn = this.connections.get(connectionId);
    if (!conn) return;

    if (conn.userId && conn.documentId) {
      // 更新会话状态
      this.database.prepare(`
        UPDATE collaboration_sessions
        SET is_active = 0
        WHERE user_id = ? AND document_id = ? AND is_active = 1
      `).run(conn.userId, conn.documentId);

      // 通知其他用户
      this.broadcastToDocument(conn.documentId, conn.userId, {
        type: 'user:left',
        payload: {
          userId: conn.userId,
          userName: conn.userName
        }
      });

      console.log(`[CollaborationManager] 用户离开文档: ${conn.userName} <- ${conn.documentId}`);
    }
  }

  /**
   * 加入文档协作
   */
  async joinDocument(userId, userName, documentId) {
    try {
      const connection = this.sharedb.connection;
      const doc = connection.get('documents', documentId);

      // 订阅文档
      await new Promise((resolve, reject) => {
        doc.fetch((err) => {
          if (err) return reject(err);

          if (!doc.type) {
            // 文档不存在，创建新文档
            doc.create({ content: '', version: 0 }, (err) => {
              if (err) return reject(err);
              resolve();
            });
          } else {
            resolve();
          }
        });
      });

      // 订阅文档变更
      doc.subscribe();

      // 保存文档引用
      this.documents.set(documentId, doc);

      return {
        success: true,
        documentId: documentId,
        version: doc.version,
        content: doc.data
      };

    } catch (error) {
      console.error('[CollaborationManager] 加入文档失败:', error);
      throw error;
    }
  }

  /**
   * 提交操作
   */
  async submitOperation(documentId, userId, operation) {
    try {
      const doc = this.documents.get(documentId);
      if (!doc) {
        throw new Error(`文档不存在: ${documentId}`);
      }

      // 提交操作到ShareDB
      await new Promise((resolve, reject) => {
        doc.submitOp(operation, { source: userId }, (err) => {
          if (err) return reject(err);
          resolve();
        });
      });

      // 记录操作历史
      const opId = `op_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      this.database.prepare(`
        INSERT INTO collaboration_operations
        (id, document_id, user_id, operation, version, timestamp)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        opId,
        documentId,
        userId,
        JSON.stringify(operation),
        doc.version,
        Date.now()
      );

      return {
        success: true,
        version: doc.version
      };

    } catch (error) {
      console.error('[CollaborationManager] 提交操作失败:', error);
      throw error;
    }
  }

  /**
   * 监听文档变更
   */
  onDocumentChange(documentId, callback) {
    const doc = this.documents.get(documentId);
    if (!doc) {
      console.warn(`[CollaborationManager] 文档不存在: ${documentId}`);
      return;
    }

    doc.on('op', (op, source) => {
      if (!source) {
        // 来自其他客户端的操作
        callback(op);
      }
    });
  }

  /**
   * 广播消息到文档的所有用户
   */
  broadcastToDocument(documentId, excludeUserId, message) {
    this.connections.forEach((conn) => {
      if (conn.documentId === documentId && conn.userId !== excludeUserId) {
        try {
          conn.ws.send(JSON.stringify(message));
        } catch (error) {
          console.error('[CollaborationManager] 广播消息失败:', error);
        }
      }
    });
  }

  /**
   * 获取在线用户
   */
  getOnlineUsers(documentId) {
    const users = [];

    this.connections.forEach((conn) => {
      if (conn.documentId === documentId && conn.userId) {
        users.push({
          userId: conn.userId,
          userName: conn.userName,
          connectedAt: conn.connectedAt
        });
      }
    });

    return users;
  }

  /**
   * 获取文档操作历史
   */
  getOperationHistory(documentId, limit = 100) {
    return this.database.prepare(`
      SELECT * FROM collaboration_operations
      WHERE document_id = ?
      ORDER BY timestamp DESC
      LIMIT ?
    `).all(documentId, limit);
  }

  /**
   * 获取会话历史
   */
  getSessionHistory(documentId, limit = 50) {
    return this.database.prepare(`
      SELECT * FROM collaboration_sessions
      WHERE document_id = ?
      ORDER BY joined_at DESC
      LIMIT ?
    `).all(documentId, limit);
  }

  /**
   * 生成连接ID
   */
  generateConnectionId() {
    return `conn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 获取服务器状态
   */
  getStatus() {
    return {
      running: !!this.wss,
      port: this.port,
      connections: this.connections.size,
      documents: this.documents.size,
      onlineUsers: this.getAllOnlineUsers()
    };
  }

  /**
   * 获取所有在线用户
   */
  getAllOnlineUsers() {
    const users = new Map();

    this.connections.forEach((conn) => {
      if (conn.userId) {
        users.set(conn.userId, {
          userId: conn.userId,
          userName: conn.userName,
          documentId: conn.documentId
        });
      }
    });

    return Array.from(users.values());
  }
}

// 单例模式
let collaborationManager = null;

/**
 * 获取协作管理器实例
 * @returns {CollaborationManager}
 */
function getCollaborationManager() {
  if (!collaborationManager) {
    collaborationManager = new CollaborationManager();
  }
  return collaborationManager;
}

module.exports = {
  CollaborationManager,
  getCollaborationManager
};
