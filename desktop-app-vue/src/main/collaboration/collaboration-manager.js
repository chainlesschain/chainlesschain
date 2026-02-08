/**
 * 协作管理器
 * 提供实时协作编辑功能，支持多用户同时编辑文档
 * 基于ShareDB实现OT (Operational Transformation) 算法
 */

const { logger } = require("../utils/logger.js");
const ShareDB = require("sharedb");
const WebSocket = require("ws");
const WebSocketJSONStream = require("@teamwork/websocket-json-stream");
const { EventEmitter } = require("events");

class CollaborationManager extends EventEmitter {
  constructor(organizationManager = null) {
    super();
    this.sharedb = null;
    this.wss = null;
    this.connections = new Map();
    this.documents = new Map();
    this.port = 8080;
    this.initialized = false;
    this.database = null;
    this.organizationManager = organizationManager; // 组织管理器引用
  }

  /**
   * 初始化协作管理器
   */
  async initialize(options = {}) {
    if (this.initialized) {
      return;
    }

    try {
      const { port = 8080 } = options;
      this.port = port;

      // 初始化ShareDB
      this.sharedb = new ShareDB();

      // 获取数据库
      const { getDatabase } = require("../database");
      this.database = getDatabase();

      // 创建数据库表
      await this.createTables();

      this.initialized = true;
      logger.info("[CollaborationManager] 初始化完成");
    } catch (error) {
      logger.error("[CollaborationManager] 初始化失败:", error);
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

      logger.info("[CollaborationManager] 数据库表创建成功");
    } catch (error) {
      logger.error("[CollaborationManager] 创建数据库表失败:", error);
      throw error;
    }
  }

  /**
   * 启动WebSocket服务器
   */
  async startServer() {
    if (this.wss) {
      logger.warn("[CollaborationManager] 服务器已在运行");
      return;
    }

    try {
      this.wss = new WebSocket.Server({ port: this.port });

      this.wss.on("connection", (ws, req) => {
        const connectionId = this.generateConnectionId();
        logger.info(`[CollaborationManager] 新连接: ${connectionId}`);

        // 创建ShareDB stream
        const stream = new WebSocketJSONStream(ws);
        this.sharedb.listen(stream);

        // 保存连接信息
        this.connections.set(connectionId, {
          ws: ws,
          stream: stream,
          userId: null,
          documentId: null,
          connectedAt: Date.now(),
        });

        // 处理消息
        ws.on("message", async (data) => {
          try {
            const message = JSON.parse(data);
            await this.handleMessage(connectionId, message);
          } catch (error) {
            logger.error("[CollaborationManager] 处理消息失败:", error);
          }
        });

        // 处理断开连接
        ws.on("close", () => {
          logger.info(`[CollaborationManager] 连接关闭: ${connectionId}`);
          this.handleDisconnect(connectionId);
          this.connections.delete(connectionId);
        });

        // 处理错误
        ws.on("error", (error) => {
          logger.error(`[CollaborationManager] WebSocket错误:`, error);
        });
      });

      logger.info(
        `[CollaborationManager] WebSocket服务器启动在端口 ${this.port}`,
      );
      this.emit("server:started", { port: this.port });

      return { success: true, port: this.port };
    } catch (error) {
      logger.error("[CollaborationManager] 启动服务器失败:", error);
      throw error;
    }
  }

  /**
   * 停止WebSocket服务器
   */
  async stopServer() {
    if (!this.wss) {
      return;
    }

    try {
      // 关闭所有连接
      this.connections.forEach((conn) => {
        conn.ws.close();
      });

      // 关闭服务器
      await new Promise((resolve) => {
        this.wss.close(() => {
          logger.info("[CollaborationManager] 服务器已停止");
          resolve();
        });
      });

      this.wss = null;
      this.connections.clear();

      this.emit("server:stopped");

      return { success: true };
    } catch (error) {
      logger.error("[CollaborationManager] 停止服务器失败:", error);
      throw error;
    }
  }

  /**
   * 处理消息
   */
  async handleMessage(connectionId, message) {
    const conn = this.connections.get(connectionId);
    if (!conn) {
      return;
    }

    const { type, payload } = message;

    switch (type) {
      case "join":
        await this.handleJoin(connectionId, payload);
        break;

      case "cursor":
        await this.handleCursorUpdate(connectionId, payload);
        break;

      case "selection":
        await this.handleSelectionUpdate(connectionId, payload);
        break;

      case "presence":
        await this.handlePresenceUpdate(connectionId, payload);
        break;

      default:
        logger.warn(`[CollaborationManager] 未知消息类型: ${type}`);
    }
  }

  /**
   * 处理加入文档
   */
  async handleJoin(connectionId, payload) {
    const { userId, userName, documentId, orgId, knowledgeId } = payload;

    try {
      // 企业版: 检查组织权限
      if (orgId && this.organizationManager) {
        const hasPermission = await this.checkDocumentPermission(
          userId,
          orgId,
          knowledgeId || documentId,
          "write", // 协作编辑需要写权限
        );

        if (!hasPermission) {
          // 权限不足,拒绝加入
          const conn = this.connections.get(connectionId);
          if (conn && conn.ws) {
            conn.ws.send(
              JSON.stringify({
                type: "error",
                payload: {
                  code: "PERMISSION_DENIED",
                  message: "您没有权限编辑此文档",
                  documentId: documentId,
                },
              }),
            );
          }
          logger.warn(
            "[CollaborationManager] 用户权限不足:",
            userId,
            documentId,
          );
          return;
        }

        logger.info(
          "[CollaborationManager] 权限检查通过:",
          userId,
          "可编辑",
          documentId,
        );
      }

      const conn = this.connections.get(connectionId);
      if (conn) {
        conn.userId = userId;
        conn.documentId = documentId;
        conn.userName = userName;
        conn.orgId = orgId; // 保存组织ID
      }

      // 记录会话
      const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const now = Date.now();

      this.database
        .prepare(
          `
        INSERT INTO collaboration_sessions
        (id, document_id, user_id, user_name, joined_at, last_seen)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
        )
        .run(sessionId, documentId, userId, userName, now, now);

      // 通知其他用户
      this.broadcastToDocument(documentId, userId, {
        type: "user:joined",
        payload: {
          userId: userId,
          userName: userName,
          sessionId: sessionId,
        },
      });

      // 获取当前在线用户
      const onlineUsers = this.getOnlineUsers(documentId);

      // 发送加入成功消息 (包含在线用户列表)
      if (conn && conn.ws) {
        conn.ws.send(
          JSON.stringify({
            type: "join:success",
            payload: {
              sessionId: sessionId,
              onlineUsers: onlineUsers,
            },
          }),
        );
      }
    } catch (error) {
      logger.error("[CollaborationManager] 处理加入失败:", error);

      // 发送错误消息
      const conn = this.connections.get(connectionId);
      if (conn && conn.ws) {
        conn.ws.send(
          JSON.stringify({
            type: "error",
            payload: {
              code: "JOIN_FAILED",
              message: error.message,
              documentId: documentId,
            },
          }),
        );
      }
    }
  }

  /**
   * 处理光标更新
   */
  async handleCursorUpdate(connectionId, payload) {
    const conn = this.connections.get(connectionId);
    if (!conn) {
      return;
    }

    const { position } = payload;

    // 广播光标位置
    this.broadcastToDocument(conn.documentId, conn.userId, {
      type: "cursor:update",
      payload: {
        userId: conn.userId,
        userName: conn.userName,
        position: position,
      },
    });
  }

  /**
   * 处理选区更新
   */
  async handleSelectionUpdate(connectionId, payload) {
    const conn = this.connections.get(connectionId);
    if (!conn) {
      return;
    }

    const { selection } = payload;

    // 广播选区
    this.broadcastToDocument(conn.documentId, conn.userId, {
      type: "selection:update",
      payload: {
        userId: conn.userId,
        userName: conn.userName,
        selection: selection,
      },
    });
  }

  /**
   * 处理在线状态更新
   */
  async handlePresenceUpdate(connectionId, payload) {
    const conn = this.connections.get(connectionId);
    if (!conn) {
      return;
    }

    const { status } = payload;

    // 更新最后活跃时间
    const now = Date.now();
    this.database
      .prepare(
        `
      UPDATE collaboration_sessions
      SET last_seen = ?
      WHERE user_id = ? AND document_id = ? AND is_active = 1
    `,
      )
      .run(now, conn.userId, conn.documentId);

    // 广播状态更新
    this.broadcastToDocument(conn.documentId, conn.userId, {
      type: "presence:update",
      payload: {
        userId: conn.userId,
        userName: conn.userName,
        status: status,
      },
    });
  }

  /**
   * 处理断开连接
   */
  handleDisconnect(connectionId) {
    const conn = this.connections.get(connectionId);
    if (!conn) {
      return;
    }

    if (conn.userId && conn.documentId) {
      // 更新会话状态
      this.database
        .prepare(
          `
        UPDATE collaboration_sessions
        SET is_active = 0
        WHERE user_id = ? AND document_id = ? AND is_active = 1
      `,
        )
        .run(conn.userId, conn.documentId);

      // 通知其他用户
      this.broadcastToDocument(conn.documentId, conn.userId, {
        type: "user:left",
        payload: {
          userId: conn.userId,
          userName: conn.userName,
        },
      });

      logger.info(
        `[CollaborationManager] 用户离开文档: ${conn.userName} <- ${conn.documentId}`,
      );
    }
  }

  /**
   * 加入文档协作
   */
  async joinDocument(userId, userName, documentId) {
    try {
      const connection = this.sharedb.connection;
      const doc = connection.get("documents", documentId);

      // 订阅文档
      await new Promise((resolve, reject) => {
        doc.fetch((err) => {
          if (err) {
            return reject(err);
          }

          if (!doc.type) {
            // 文档不存在，创建新文档
            doc.create({ content: "", version: 0 }, (err) => {
              if (err) {
                return reject(err);
              }
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
        content: doc.data,
      };
    } catch (error) {
      logger.error("[CollaborationManager] 加入文档失败:", error);
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
          if (err) {
            return reject(err);
          }
          resolve();
        });
      });

      // 记录操作历史
      const opId = `op_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      this.database
        .prepare(
          `
        INSERT INTO collaboration_operations
        (id, document_id, user_id, operation, version, timestamp)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
        )
        .run(
          opId,
          documentId,
          userId,
          JSON.stringify(operation),
          doc.version,
          Date.now(),
        );

      return {
        success: true,
        version: doc.version,
      };
    } catch (error) {
      logger.error("[CollaborationManager] 提交操作失败:", error);
      throw error;
    }
  }

  /**
   * 监听文档变更
   */
  onDocumentChange(documentId, callback) {
    const doc = this.documents.get(documentId);
    if (!doc) {
      logger.warn(`[CollaborationManager] 文档不存在: ${documentId}`);
      return;
    }

    doc.on("op", (op, source) => {
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
          logger.error("[CollaborationManager] 广播消息失败:", error);
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
          connectedAt: conn.connectedAt,
        });
      }
    });

    return users;
  }

  /**
   * 获取文档操作历史
   */
  getOperationHistory(documentId, limit = 100) {
    return this.database
      .prepare(
        `
      SELECT * FROM collaboration_operations
      WHERE document_id = ?
      ORDER BY timestamp DESC
      LIMIT ?
    `,
      )
      .all(documentId, limit);
  }

  /**
   * 获取会话历史
   */
  getSessionHistory(documentId, limit = 50) {
    return this.database
      .prepare(
        `
      SELECT * FROM collaboration_sessions
      WHERE document_id = ?
      ORDER BY joined_at DESC
      LIMIT ?
    `,
      )
      .all(documentId, limit);
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
      onlineUsers: this.getAllOnlineUsers(),
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
          documentId: conn.documentId,
        });
      }
    });

    return Array.from(users.values());
  }

  /**
   * 检查文档权限 (企业版功能)
   * @param {string} userDID - 用户DID
   * @param {string} orgId - 组织ID
   * @param {string} knowledgeId - 知识库ID
   * @param {string} action - 操作类型 (read/write/delete)
   * @returns {Promise<boolean>} 是否有权限
   */
  async checkDocumentPermission(userDID, orgId, knowledgeId, action = "read") {
    if (!this.organizationManager) {
      // 如果没有组织管理器,默认允许 (个人版模式)
      logger.warn("[CollaborationManager] 组织管理器未初始化,跳过权限检查");
      return true;
    }

    try {
      // 1. 检查用户是否是组织成员
      const isMember = await this.organizationManager.checkPermission(
        orgId,
        userDID,
        "knowledge.read", // 至少需要读权限
      );

      if (!isMember) {
        logger.warn("[CollaborationManager] 用户不是组织成员:", userDID, orgId);
        return false;
      }

      // 2. 根据操作类型检查具体权限
      const permissionMap = {
        read: "knowledge.read",
        write: "knowledge.write",
        delete: "knowledge.delete",
      };

      const requiredPermission = permissionMap[action] || "knowledge.read";

      const hasPermission = await this.organizationManager.checkPermission(
        orgId,
        userDID,
        requiredPermission,
      );

      if (!hasPermission) {
        logger.warn(
          "[CollaborationManager] 用户权限不足:",
          userDID,
          requiredPermission,
        );
        return false;
      }

      // 3. 检查知识库级别的权限 (如果知识库有特定的共享范围)
      if (knowledgeId && this.database) {
        try {
          const knowledge = this.database.db
            .prepare(
              `
            SELECT share_scope, permissions, created_by, owner_did
            FROM knowledge_items
            WHERE id = ?
          `,
            )
            .get(knowledgeId);

          if (knowledge) {
            // 检查共享范围
            const shareScope = knowledge.share_scope || "private";

            // 如果是私有的，只有创建者可以访问
            if (shareScope === "private") {
              const isOwner =
                knowledge.created_by === userDID ||
                knowledge.owner_did === userDID;
              if (!isOwner) {
                logger.warn(
                  "[CollaborationManager] 知识库为私有，用户无权访问:",
                  userDID,
                );
                return false;
              }
            }

            // 如果是组织级别，检查用户是否在组织中
            if (shareScope === "organization" && this.organizationManager) {
              const userOrgs =
                await this.organizationManager.getUserOrganizations(userDID);
              const knowledgeOrg = knowledge.organization_id;

              if (
                knowledgeOrg &&
                !userOrgs.some((org) => org.id === knowledgeOrg)
              ) {
                logger.warn(
                  "[CollaborationManager] 用户不在知识库所属组织中:",
                  userDID,
                );
                return false;
              }
            }

            // 检查特定权限设置
            if (knowledge.permissions) {
              try {
                const permissions = JSON.parse(knowledge.permissions);

                // 检查黑名单
                if (
                  permissions.blacklist &&
                  permissions.blacklist.includes(userDID)
                ) {
                  logger.warn(
                    "[CollaborationManager] 用户在黑名单中:",
                    userDID,
                  );
                  return false;
                }

                // 检查白名单（如果设置了白名单，只有白名单中的用户可以访问）
                if (permissions.whitelist && permissions.whitelist.length > 0) {
                  if (!permissions.whitelist.includes(userDID)) {
                    logger.warn(
                      "[CollaborationManager] 用户不在白名单中:",
                      userDID,
                    );
                    return false;
                  }
                }

                // 检查特定权限级别
                if (permissions.users && permissions.users[userDID]) {
                  const userPermLevel = permissions.users[userDID];
                  const requiredLevel =
                    this._getPermissionLevel(requiredPermission);
                  const userLevel = this._getPermissionLevel(userPermLevel);

                  if (userLevel < requiredLevel) {
                    logger.warn(
                      "[CollaborationManager] 用户权限级别不足:",
                      userDID,
                      userPermLevel,
                      "<",
                      requiredPermission,
                    );
                    return false;
                  }
                }
              } catch (parseError) {
                logger.error(
                  "[CollaborationManager] 解析权限配置失败:",
                  parseError,
                );
              }
            }
          }
        } catch (dbError) {
          logger.error("[CollaborationManager] 查询知识库权限失败:", dbError);
          // 出错时拒绝访问，安全优先
          return false;
        }
      }

      logger.info(
        "[CollaborationManager] ✓ 权限检查通过:",
        userDID,
        requiredPermission,
      );
      return true;
    } catch (error) {
      logger.error("[CollaborationManager] 权限检查失败:", error);
      return false; // 出错时拒绝访问,安全优先
    }
  }

  /**
   * 获取权限级别数值
   * @param {string} permission - 权限名称
   * @returns {number} 权限级别（数值越大权限越高）
   * @private
   */
  _getPermissionLevel(permission) {
    const levels = {
      view: 1,
      read: 1,
      comment: 2,
      edit: 3,
      write: 3,
      admin: 4,
      owner: 5,
    };
    return levels[permission] || 0;
  }

  /**
   * 设置组织管理器引用
   * @param {Object} organizationManager - 组织管理器实例
   */
  setOrganizationManager(organizationManager) {
    this.organizationManager = organizationManager;
    logger.info("[CollaborationManager] ✓ 组织管理器已设置");
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
  getCollaborationManager,
};
