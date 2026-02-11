/**
 * 剪贴板同步处理器
 *
 * 处理 PC 和 Android 之间的剪贴板同步：
 * - clipboard.get: 获取当前剪贴板内容
 * - clipboard.set: 设置剪贴板内容
 * - clipboard.watch: 开始监听剪贴板变化
 * - clipboard.unwatch: 停止监听剪贴板变化
 * - clipboard.getHistory: 获取剪贴板历史
 * - clipboard.clearHistory: 清除剪贴板历史
 *
 * 支持内容类型：
 * - text: 纯文本
 * - html: HTML 格式文本
 * - image: 图片（Base64）
 * - files: 文件路径列表
 *
 * @module remote/handlers/clipboard-handler
 */

const { logger } = require("../../utils/logger");
const { clipboard, nativeImage } = require("electron");
const crypto = require("crypto");

/**
 * 剪贴板处理器类
 */
class ClipboardHandler {
  constructor(database, options = {}) {
    this.database = database;
    this.options = {
      maxHistorySize: options.maxHistorySize || 100,
      watchInterval: options.watchInterval || 1000, // 1秒检查一次
      maxImageSize: options.maxImageSize || 5 * 1024 * 1024, // 最大5MB图片
      enableHistory: options.enableHistory !== false,
      ...options,
    };

    // 监听状态
    this.isWatching = false;
    this.watchTimer = null;
    this.lastContentHash = null;

    // 剪贴板历史
    this.history = [];

    // 回调函数
    this.onChangeCallback = null;

    // 事件发射器（由外部设置）
    this.eventEmitter = null;

    // 初始化数据库表
    this.ensureTables();

    logger.info("[ClipboardHandler] 剪贴板处理器已初始化");
  }

  /**
   * 确保数据库表存在
   */
  ensureTables() {
    if (!this.database) {
      logger.warn(
        "[ClipboardHandler] 数据库未提供，剪贴板历史将只保存在内存中",
      );
      return;
    }

    try {
      this.database.exec(`
        CREATE TABLE IF NOT EXISTS clipboard_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          content_hash TEXT NOT NULL UNIQUE,
          content_type TEXT NOT NULL,
          content TEXT NOT NULL,
          preview TEXT,
          source TEXT,
          created_at INTEGER NOT NULL
        )
      `);

      this.database.exec(`
        CREATE INDEX IF NOT EXISTS idx_clipboard_history_created_at
        ON clipboard_history(created_at DESC)
      `);

      logger.info("[ClipboardHandler] 剪贴板历史表已就绪");
    } catch (error) {
      logger.error("[ClipboardHandler] 创建剪贴板历史表失败:", error);
    }
  }

  /**
   * 处理命令（统一入口）
   */
  async handle(action, params, context) {
    logger.debug(`[ClipboardHandler] 处理命令: ${action}`);

    switch (action) {
      case "get":
        return await this.getClipboard(params, context);

      case "set":
        return await this.setClipboard(params, context);

      case "watch":
        return await this.startWatch(params, context);

      case "unwatch":
        return await this.stopWatch(params, context);

      case "getHistory":
        return await this.getHistory(params, context);

      case "clearHistory":
        return await this.clearHistory(params, context);

      default:
        throw new Error(`Unknown action: ${action}`);
    }
  }

  /**
   * 获取当前剪贴板内容
   */
  async getClipboard(params, context) {
    logger.info("[ClipboardHandler] 获取剪贴板内容");

    try {
      const result = {
        timestamp: Date.now(),
        formats: clipboard.availableFormats(),
        content: null,
        type: "unknown",
      };

      // 检查是否有图片
      const image = clipboard.readImage();
      if (!image.isEmpty()) {
        const size = image.getSize();
        const buffer = image.toPNG();

        // 检查图片大小
        if (buffer.length > this.options.maxImageSize) {
          result.type = "image";
          result.content = null;
          result.error = "Image too large";
          result.imageInfo = {
            width: size.width,
            height: size.height,
            size: buffer.length,
          };
        } else {
          result.type = "image";
          result.content = buffer.toString("base64");
          result.imageInfo = {
            width: size.width,
            height: size.height,
            size: buffer.length,
          };
        }
        return result;
      }

      // 检查是否有 HTML
      const html = clipboard.readHTML();
      if (html && html.trim()) {
        result.type = "html";
        result.content = html;
        result.text = clipboard.readText(); // 同时提供纯文本版本
        return result;
      }

      // 检查是否有纯文本
      const text = clipboard.readText();
      if (text) {
        result.type = "text";
        result.content = text;
        return result;
      }

      // 检查是否有文件路径（仅 Windows/macOS）
      // 注意：Electron 的 clipboard 不直接支持读取文件，
      // 需要使用 clipboard.read('NSFilenamesPboardType') 等平台特定方法
      if (process.platform === "darwin") {
        try {
          const files = clipboard.read("NSFilenamesPboardType");
          if (files) {
            result.type = "files";
            result.content = files.split("\n").filter((f) => f.trim());
            return result;
          }
        } catch (e) {
          // 忽略
        }
      }

      result.type = "empty";
      result.content = null;
      return result;
    } catch (error) {
      logger.error("[ClipboardHandler] 获取剪贴板失败:", error);
      throw new Error(`Get clipboard failed: ${error.message}`);
    }
  }

  /**
   * 设置剪贴板内容
   */
  async setClipboard(params, context) {
    const { type, content, html } = params;

    logger.info(`[ClipboardHandler] 设置剪贴板内容 (类型: ${type})`);

    try {
      switch (type) {
        case "text":
          if (html) {
            // 同时设置 HTML 和纯文本
            clipboard.write({
              text: content,
              html: html,
            });
          } else {
            clipboard.writeText(content);
          }
          break;

        case "html":
          clipboard.write({
            text: content.replace(/<[^>]*>/g, ""), // 提取纯文本
            html: content,
          });
          break;

        case "image": {
          // content 应该是 Base64 编码的图片
          const buffer = Buffer.from(content, "base64");
          const image = nativeImage.createFromBuffer(buffer);
          if (image.isEmpty()) {
            throw new Error("Invalid image data");
          }
          clipboard.writeImage(image);
          break;
        }

        default:
          throw new Error(`Unsupported content type: ${type}`);
      }

      // 记录到历史
      if (this.options.enableHistory) {
        await this.addToHistory(type, content, context.did || "remote");
      }

      // 更新最后内容哈希
      this.lastContentHash = this.hashContent(type, content);

      return {
        success: true,
        type,
        timestamp: Date.now(),
      };
    } catch (error) {
      logger.error("[ClipboardHandler] 设置剪贴板失败:", error);
      throw new Error(`Set clipboard failed: ${error.message}`);
    }
  }

  /**
   * 开始监听剪贴板变化
   */
  async startWatch(params, context) {
    if (this.isWatching) {
      logger.info("[ClipboardHandler] 剪贴板监听已在运行");
      return { success: true, status: "already_watching" };
    }

    logger.info("[ClipboardHandler] 开始监听剪贴板变化");

    // 记录当前内容哈希
    const current = await this.getClipboard({}, context);
    this.lastContentHash = this.hashContent(current.type, current.content);

    // 启动定时检查
    this.watchTimer = setInterval(async () => {
      try {
        await this.checkClipboardChange(context);
      } catch (error) {
        logger.error("[ClipboardHandler] 检查剪贴板变化失败:", error);
      }
    }, this.options.watchInterval);

    this.isWatching = true;

    return {
      success: true,
      status: "watching",
      interval: this.options.watchInterval,
    };
  }

  /**
   * 停止监听剪贴板变化
   */
  async stopWatch(params, context) {
    if (!this.isWatching) {
      logger.info("[ClipboardHandler] 剪贴板监听未运行");
      return { success: true, status: "not_watching" };
    }

    logger.info("[ClipboardHandler] 停止监听剪贴板变化");

    if (this.watchTimer) {
      clearInterval(this.watchTimer);
      this.watchTimer = null;
    }

    this.isWatching = false;

    return {
      success: true,
      status: "stopped",
    };
  }

  /**
   * 检查剪贴板变化
   */
  async checkClipboardChange(context) {
    const current = await this.getClipboard({}, context);
    const currentHash = this.hashContent(current.type, current.content);

    if (currentHash !== this.lastContentHash) {
      this.lastContentHash = currentHash;

      logger.info(
        `[ClipboardHandler] 检测到剪贴板变化 (类型: ${current.type})`,
      );

      // 记录到历史
      if (this.options.enableHistory && current.content) {
        await this.addToHistory(current.type, current.content, "local");
      }

      // 触发回调
      if (this.onChangeCallback) {
        this.onChangeCallback(current);
      }

      // 发送事件
      if (this.eventEmitter) {
        this.eventEmitter.emit("clipboard:changed", current);
      }
    }
  }

  /**
   * 获取剪贴板历史
   */
  async getHistory(params, context) {
    const { limit = 20, offset = 0 } = params;

    logger.info(
      `[ClipboardHandler] 获取剪贴板历史 (limit: ${limit}, offset: ${offset})`,
    );

    try {
      if (this.database) {
        const rows = this.database
          .prepare(
            `
            SELECT id, content_type, content, preview, source, created_at
            FROM clipboard_history
            ORDER BY created_at DESC
            LIMIT ? OFFSET ?
          `,
          )
          .all(limit, offset);

        return {
          items: rows.map((row) => ({
            id: row.id,
            type: row.content_type,
            content: row.content,
            preview: row.preview,
            source: row.source,
            createdAt: row.created_at,
          })),
          total: this.database
            .prepare("SELECT COUNT(*) as count FROM clipboard_history")
            .get().count,
        };
      } else {
        // 从内存历史获取
        const items = this.history.slice(offset, offset + limit);
        return {
          items,
          total: this.history.length,
        };
      }
    } catch (error) {
      logger.error("[ClipboardHandler] 获取剪贴板历史失败:", error);
      throw new Error(`Get history failed: ${error.message}`);
    }
  }

  /**
   * 清除剪贴板历史
   */
  async clearHistory(params, context) {
    logger.info("[ClipboardHandler] 清除剪贴板历史");

    try {
      if (this.database) {
        this.database.prepare("DELETE FROM clipboard_history").run();
      }

      this.history = [];

      return {
        success: true,
        timestamp: Date.now(),
      };
    } catch (error) {
      logger.error("[ClipboardHandler] 清除剪贴板历史失败:", error);
      throw new Error(`Clear history failed: ${error.message}`);
    }
  }

  /**
   * 添加到历史记录
   */
  async addToHistory(type, content, source) {
    const hash = this.hashContent(type, content);
    const preview = this.createPreview(type, content);
    const now = Date.now();

    try {
      if (this.database) {
        // 使用 INSERT OR REPLACE 避免重复
        this.database
          .prepare(
            `
            INSERT OR REPLACE INTO clipboard_history
            (content_hash, content_type, content, preview, source, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
          `,
          )
          .run(hash, type, JSON.stringify(content), preview, source, now);

        // 清理超出限制的历史
        this.database
          .prepare(
            `
            DELETE FROM clipboard_history
            WHERE id NOT IN (
              SELECT id FROM clipboard_history
              ORDER BY created_at DESC
              LIMIT ?
            )
          `,
          )
          .run(this.options.maxHistorySize);
      } else {
        // 内存历史
        this.history.unshift({
          type,
          content,
          preview,
          source,
          createdAt: now,
        });

        // 限制历史大小
        if (this.history.length > this.options.maxHistorySize) {
          this.history = this.history.slice(0, this.options.maxHistorySize);
        }
      }
    } catch (error) {
      logger.error("[ClipboardHandler] 添加历史记录失败:", error);
    }
  }

  /**
   * 计算内容哈希
   */
  hashContent(type, content) {
    if (!content) {
      return "empty";
    }

    const data =
      typeof content === "string" ? content : JSON.stringify(content);
    return crypto.createHash("md5").update(`${type}:${data}`).digest("hex");
  }

  /**
   * 创建预览文本
   */
  createPreview(type, content) {
    if (!content) {
      return "";
    }

    switch (type) {
      case "text":
      case "html": {
        const text = typeof content === "string" ? content : "";
        // 移除HTML标签，截取前100个字符
        return text.replace(/<[^>]*>/g, "").substring(0, 100);
      }

      case "image":
        return "[Image]";

      case "files":
        if (Array.isArray(content)) {
          return `[${content.length} files]`;
        }
        return "[Files]";

      default:
        return "";
    }
  }

  /**
   * 设置变化回调
   */
  setOnChangeCallback(callback) {
    this.onChangeCallback = callback;
  }

  /**
   * 设置事件发射器
   */
  setEventEmitter(emitter) {
    this.eventEmitter = emitter;
  }

  /**
   * 获取监听状态
   */
  isWatchingClipboard() {
    return this.isWatching;
  }

  /**
   * 清理资源
   */
  cleanup() {
    this.stopWatch({}, {});
    this.onChangeCallback = null;
    this.eventEmitter = null;
    logger.info("[ClipboardHandler] 剪贴板处理器已清理");
  }
}

module.exports = { ClipboardHandler };
