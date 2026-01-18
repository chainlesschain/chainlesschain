/**
 * Native Messaging Server - 桌面应用端
 *
 * 处理来自浏览器扩展的消息
 * 使用标准输入/输出进行通信
 */

const { getLogger } = require("../logging/logger");
const logger = getLogger("NativeMessaging");

class NativeMessagingServer {
  constructor(databaseManager, options = {}) {
    this.db = databaseManager;
    this.options = {
      maxMessageSize: options.maxMessageSize || 1024 * 1024, // 1MB
      ...options,
    };

    this.messageHandlers = new Map();
    this.registerDefaultHandlers();
  }

  /**
   * 启动服务器
   */
  start() {
    logger.info("Native messaging server starting");

    // 设置标准输入为二进制模式
    process.stdin.setEncoding(null);

    // 读取消息
    let messageBuffer = Buffer.alloc(0);

    process.stdin.on("data", (chunk) => {
      messageBuffer = Buffer.concat([messageBuffer, chunk]);

      // 尝试解析消息
      while (messageBuffer.length >= 4) {
        // 读取消息长度（前4字节，小端序）
        const messageLength = messageBuffer.readUInt32LE(0);

        // 检查是否接收完整消息
        if (messageBuffer.length < 4 + messageLength) {
          break;
        }

        // 提取消息内容
        const messageData = messageBuffer.slice(4, 4 + messageLength);
        messageBuffer = messageBuffer.slice(4 + messageLength);

        // 解析并处理消息
        try {
          const message = JSON.parse(messageData.toString("utf8"));
          this.handleMessage(message);
        } catch (error) {
          logger.error("Failed to parse message", error);
          this.sendError(null, "Invalid message format");
        }
      }
    });

    process.stdin.on("end", () => {
      logger.info("Native messaging server stopped");
      process.exit(0);
    });

    process.stdin.on("error", (error) => {
      logger.error("stdin error", error);
      process.exit(1);
    });

    logger.info("Native messaging server started");
  }

  /**
   * 处理消息
   */
  async handleMessage(message) {
    const { id, action, data } = message;

    logger.debug("Received message", { id, action });

    try {
      // 查找处理器
      const handler = this.messageHandlers.get(action);

      if (!handler) {
        throw new Error(`Unknown action: ${action}`);
      }

      // 执行处理器
      const result = await handler(data);

      // 发送响应
      this.sendResponse(id, result);
    } catch (error) {
      logger.error("Message handling failed", {
        id,
        action,
        error: error.message,
      });
      this.sendError(id, error.message);
    }
  }

  /**
   * 发送响应
   */
  sendResponse(id, data) {
    const response = {
      id,
      success: true,
      data,
    };

    this.sendMessage(response);
  }

  /**
   * 发送错误
   */
  sendError(id, error) {
    const response = {
      id,
      success: false,
      error,
    };

    this.sendMessage(response);
  }

  /**
   * 发送消息
   */
  sendMessage(message) {
    try {
      const messageJson = JSON.stringify(message);
      const messageBuffer = Buffer.from(messageJson, "utf8");

      // 检查消息大小
      if (messageBuffer.length > this.options.maxMessageSize) {
        throw new Error("Message too large");
      }

      // 写入消息长度（4字节，小端序）
      const lengthBuffer = Buffer.alloc(4);
      lengthBuffer.writeUInt32LE(messageBuffer.length, 0);

      // 写入标准输出
      process.stdout.write(lengthBuffer);
      process.stdout.write(messageBuffer);
    } catch (error) {
      logger.error("Failed to send message", error);
    }
  }

  /**
   * 注册消息处理器
   */
  registerHandler(action, handler) {
    this.messageHandlers.set(action, handler);
    logger.debug(`Handler registered: ${action}`);
  }

  /**
   * 注册默认处理器
   */
  registerDefaultHandlers() {
    // Ping - 检查连接
    this.registerHandler("ping", async () => {
      return { pong: true, timestamp: Date.now() };
    });

    // 保存剪藏
    this.registerHandler("saveClip", async (data) => {
      return await this.handleSaveClip(data);
    });

    // 获取标签
    this.registerHandler("getTags", async () => {
      return await this.handleGetTags();
    });

    // 搜索知识库
    this.registerHandler("searchKnowledge", async (data) => {
      return await this.handleSearchKnowledge(data);
    });

    // 获取最近剪藏
    this.registerHandler("getRecentClips", async (data) => {
      return await this.handleGetRecentClips(data);
    });

    // 上传图片
    this.registerHandler("uploadImage", async (data) => {
      return await this.handleUploadImage(data);
    });
  }

  /**
   * 处理保存剪藏
   */
  async handleSaveClip(data) {
    const {
      type,
      content,
      html,
      url,
      title,
      tags = [],
      images = [],
      links = [],
      dataUrl,
      timestamp,
    } = data;

    logger.info("Saving clip", { type, title, url });

    try {
      // 创建知识库项
      const item = {
        title: title || "无标题",
        content: content || "",
        type: "web-clip",
        source: url,
        tags: ["web-clip", ...tags],
        metadata: {
          clipType: type,
          url,
          html,
          images,
          links,
          dataUrl,
          timestamp,
        },
      };

      // 保存到数据库
      const savedItem = await this.db.addKnowledgeItem(item);

      logger.info("Clip saved", { id: savedItem.id });

      return {
        id: savedItem.id,
        title: savedItem.title,
        created_at: savedItem.created_at,
      };
    } catch (error) {
      logger.error("Failed to save clip", error);
      throw error;
    }
  }

  /**
   * 处理获取标签
   */
  async handleGetTags() {
    try {
      const tags = await this.db.getAllTags();
      return { tags };
    } catch (error) {
      logger.error("Failed to get tags", error);
      throw error;
    }
  }

  /**
   * 处理搜索知识库
   */
  async handleSearchKnowledge(data) {
    const { query } = data;

    try {
      const results = await this.db.searchKnowledge(query);
      return { results };
    } catch (error) {
      logger.error("Failed to search knowledge", error);
      throw error;
    }
  }

  /**
   * 处理获取最近剪藏
   */
  async handleGetRecentClips(data) {
    const { limit = 10 } = data;

    try {
      const clips = await this.db.getKnowledgeItems(limit, 0);
      return { clips };
    } catch (error) {
      logger.error("Failed to get recent clips", error);
      throw error;
    }
  }

  /**
   * 处理上传图片
   */
  async handleUploadImage(data) {
    const { dataUrl } = data;

    try {
      // 这里可以实现图片保存逻辑
      // 例如保存到本地文件系统或上传到云存储

      // 简单实现：返回dataUrl
      return { url: dataUrl };
    } catch (error) {
      logger.error("Failed to upload image", error);
      throw error;
    }
  }
}

module.exports = NativeMessagingServer;
