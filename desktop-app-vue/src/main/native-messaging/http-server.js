/**
 * ChainlessChain Native Messaging HTTP Server
 * 为 Native Messaging Host 提供 HTTP API，用于接收浏览器扩展的剪藏请求
 */

const { logger } = require("../utils/logger.js");
const http = require("http");

const DEFAULT_PORT = 23456;

class NativeMessagingHTTPServer {
  constructor(database, ragManager, llmManager = null) {
    this.database = database;
    this.ragManager = ragManager;
    this.llmManager = llmManager;
    this.server = null;
    this.port = DEFAULT_PORT;
  }

  /**
   * 启动服务器
   */
  start(port = DEFAULT_PORT) {
    this.port = port;

    this.server = http.createServer((req, res) => {
      this.handleRequest(req, res);
    });

    return new Promise((resolve, reject) => {
      this.server.listen(this.port, "localhost", () => {
        logger.info(
          `[NativeMessagingHTTPServer] 服务器已启动: http://localhost:${this.port}`,
        );
        resolve();
      });

      this.server.on("error", (error) => {
        if (error.code === "EADDRINUSE") {
          logger.error(
            `[NativeMessagingHTTPServer] 端口 ${this.port} 已被占用`,
          );
        } else {
          logger.error("[NativeMessagingHTTPServer] 服务器错误:", error);
        }
        reject(error);
      });
    });
  }

  /**
   * 停止服务器
   */
  stop() {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          logger.info("[NativeMessagingHTTPServer] 服务器已停止");
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * 处理请求
   */
  async handleRequest(req, res) {
    // 设置 CORS 头（仅允许本地）
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    // 处理 OPTIONS 预检请求
    if (req.method === "OPTIONS") {
      res.writeHead(200);
      res.end();
      return;
    }

    // 仅接受 POST 请求
    if (req.method !== "POST") {
      this.sendError(res, 405, "Method Not Allowed");
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host}`);

    // 路由
    if (url.pathname === "/api/clip") {
      await this.handleClipRequest(req, res);
    } else if (url.pathname === "/api/ping") {
      this.handlePingRequest(req, res);
    } else if (url.pathname === "/api/generate-tags") {
      await this.handleGenerateTagsRequest(req, res);
    } else if (url.pathname === "/api/generate-summary") {
      await this.handleGenerateSummaryRequest(req, res);
    } else if (url.pathname === "/api/upload-screenshot") {
      await this.handleUploadScreenshotRequest(req, res);
    } else if (url.pathname === "/api/batch-clip") {
      await this.handleBatchClipRequest(req, res);
    } else if (url.pathname === "/api/search") {
      await this.handleSearchRequest(req, res);
    } else if (url.pathname === "/api/stats") {
      await this.handleStatsRequest(req, res);
    } else {
      this.sendError(res, 404, "Not Found");
    }
  }

  /**
   * 处理 Ping 请求
   */
  handlePingRequest(req, res) {
    this.sendSuccess(res, { message: "pong" });
  }

  /**
   * 处理剪藏请求
   */
  async handleClipRequest(req, res) {
    try {
      // 读取请求体
      const body = await this.readRequestBody(req);
      const data = JSON.parse(body);

      logger.info("[NativeMessagingHTTPServer] 收到剪藏请求:", data.title);

      // 验证数据
      if (!data.title || !data.content) {
        this.sendError(res, 400, "缺少必要字段: title, content");
        return;
      }

      // 保存到数据库
      const knowledgeItem = {
        title: data.title,
        content: data.content,
        type: data.type || "web_clip",
        tags: data.tags || [],
        source_url: data.url || "",
        author: data.author || "",
        published_date: data.date || new Date().toISOString(),
        metadata: JSON.stringify({
          domain: data.domain || "",
          excerpt: data.excerpt || "",
          clipped_at: new Date().toISOString(),
        }),
      };

      const savedItem = await this.database.addKnowledgeItem(knowledgeItem);

      logger.info("[NativeMessagingHTTPServer] 知识库项已保存:", savedItem.id);

      // 添加到 RAG 索引
      if (data.autoIndex && this.ragManager) {
        try {
          await this.ragManager.addToIndex(savedItem);
          logger.info("[NativeMessagingHTTPServer] 已添加到 RAG 索引");
        } catch (error) {
          logger.error(
            "[NativeMessagingHTTPServer] 添加到 RAG 索引失败:",
            error,
          );
          // 不抛出错误，因为保存已成功
        }
      }

      // 返回成功响应
      this.sendSuccess(res, {
        id: savedItem.id,
        title: savedItem.title,
      });
    } catch (error) {
      logger.error("[NativeMessagingHTTPServer] 处理剪藏请求失败:", error);
      this.sendError(res, 500, error.message);
    }
  }

  /**
   * 处理AI标签生成请求
   */
  async handleGenerateTagsRequest(req, res) {
    try {
      // 读取请求体
      const body = await this.readRequestBody(req);
      const data = JSON.parse(body);

      logger.info("[NativeMessagingHTTPServer] 收到AI标签生成请求");

      // 验证数据
      if (!data.title) {
        this.sendError(res, 400, "缺少必要字段: title");
        return;
      }

      // 检查LLM服务
      if (!this.llmManager) {
        logger.warn("[NativeMessagingHTTPServer] LLM服务未配置，使用fallback");
        // 使用简单的关键词提取作为fallback
        const tags = this.extractSimpleTags(data);
        this.sendSuccess(res, { tags });
        return;
      }

      // 调用LLM生成标签
      const tags = await this.llmManager.generateTags({
        title: data.title,
        content: data.content || data.excerpt || "",
        url: data.url || "",
      });

      logger.info("[NativeMessagingHTTPServer] AI生成标签:", tags);

      this.sendSuccess(res, { tags });
    } catch (error) {
      logger.error("[NativeMessagingHTTPServer] 标签生成失败:", error);
      this.sendError(res, 500, error.message);
    }
  }

  /**
   * 处理AI摘要生成请求
   */
  async handleGenerateSummaryRequest(req, res) {
    try {
      // 读取请求体
      const body = await this.readRequestBody(req);
      const data = JSON.parse(body);

      logger.info("[NativeMessagingHTTPServer] 收到AI摘要生成请求");

      // 验证数据
      if (!data.content) {
        this.sendError(res, 400, "缺少必要字段: content");
        return;
      }

      // 检查LLM服务
      if (!this.llmManager) {
        logger.warn("[NativeMessagingHTTPServer] LLM服务未配置，使用fallback");
        // 使用简单的截取作为fallback
        const summary = this.extractSimpleSummary(data.content);
        this.sendSuccess(res, { summary });
        return;
      }

      // 调用LLM生成摘要
      const summary = await this.llmManager.generateSummary({
        title: data.title || "",
        content: data.content,
      });

      logger.info(
        "[NativeMessagingHTTPServer] AI生成摘要:",
        summary.substring(0, 50) + "...",
      );

      this.sendSuccess(res, { summary });
    } catch (error) {
      logger.error("[NativeMessagingHTTPServer] 摘要生成失败:", error);
      this.sendError(res, 500, error.message);
    }
  }

  /**
   * 简单的标签提取（fallback）
   */
  extractSimpleTags(data) {
    const tags = [];

    // 从域名提取
    if (data.url) {
      try {
        const url = new URL(data.url);
        const domain = url.hostname.split(".").slice(-2, -1)[0];
        if (domain) {
          tags.push(domain);
        }
      } catch (e) {
        // 忽略
      }
    }

    // 从标题提取关键词
    if (data.title) {
      const keywords = ["教程", "指南", "文档", "博客", "新闻", "技术", "开发"];
      for (const keyword of keywords) {
        if (data.title.includes(keyword)) {
          tags.push(keyword);
          break;
        }
      }
    }

    return tags.slice(0, 3);
  }

  /**
   * 简单的摘要提取（fallback）
   */
  extractSimpleSummary(content) {
    // 去除HTML标签
    const textContent = content.replace(/<[^>]*>/g, "").trim();
    // 取前200字
    return (
      textContent.substring(0, 200) + (textContent.length > 200 ? "..." : "")
    );
  }

  /**
   * 处理截图上传请求
   */
  async handleUploadScreenshotRequest(req, res) {
    try {
      // 读取请求体
      const body = await this.readRequestBody(req);
      const data = JSON.parse(body);

      logger.info("[NativeMessagingHTTPServer] 收到截图上传请求");

      // 验证数据
      if (!data.image) {
        this.sendError(res, 400, "缺少必要字段: image");
        return;
      }

      // 解码base64图片
      const base64Data = data.image.replace(/^data:image\/\w+;base64,/, "");
      const buffer = Buffer.from(base64Data, "base64");

      // 获取用户数据路径
      const { app } = require("electron");
      const path = require("path");
      const fs = require("fs").promises;

      // 确保screenshots目录存在
      const screenshotsDir = path.join(app.getPath("userData"), "screenshots");
      await fs.mkdir(screenshotsDir, { recursive: true });

      // 生成文件名
      const filename = `screenshot-${Date.now()}.png`;
      const filepath = path.join(screenshotsDir, filename);

      // 保存文件
      await fs.writeFile(filepath, buffer);

      logger.info("[NativeMessagingHTTPServer] 截图已保存:", filepath);

      // 保存到数据库
      const { v4: uuidv4 } = require("uuid");
      const screenshotId = uuidv4();

      // 如果有关联的knowledge item，保存关联
      if (this.database && this.database.db) {
        const now = Date.now();

        // 插入截图记录
        this.database.db.run(
          `
          INSERT INTO screenshots (
            id, knowledge_item_id, image_path, annotations, created_at
          ) VALUES (?, ?, ?, ?, ?)
        `,
          [
            screenshotId,
            data.knowledgeItemId || null,
            filepath,
            data.annotations || null,
            now,
          ],
        );

        logger.info("[NativeMessagingHTTPServer] 截图记录已保存到数据库");
      }

      // 返回成功响应
      this.sendSuccess(res, {
        id: screenshotId,
        path: filepath,
      });
    } catch (error) {
      logger.error("[NativeMessagingHTTPServer] 截图上传失败:", error);
      this.sendError(res, 500, error.message);
    }
  }

  /**
   * 读取请求体
   */
  readRequestBody(req) {
    return new Promise((resolve, reject) => {
      let body = "";

      req.on("data", (chunk) => {
        body += chunk.toString();
      });

      req.on("end", () => {
        resolve(body);
      });

      req.on("error", (error) => {
        reject(error);
      });
    });
  }

  /**
   * 发送成功响应
   */
  sendSuccess(res, data) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        success: true,
        data,
      }),
    );
  }

  /**
   * 发送错误响应
   */
  sendError(res, statusCode, error) {
    res.writeHead(statusCode, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        success: false,
        error,
      }),
    );
  }

  /**
   * 处理批量剪藏请求
   */
  async handleBatchClipRequest(req, res) {
    try {
      const body = await this.readRequestBody(req);
      const data = JSON.parse(body);

      logger.info(
        "[NativeMessagingHTTPServer] 收到批量剪藏请求:",
        data.items?.length,
      );

      if (!data.items || !Array.isArray(data.items)) {
        this.sendError(res, 400, "缺少必要字段: items (array)");
        return;
      }

      const results = [];
      for (const item of data.items) {
        try {
          const knowledgeItem = {
            title: item.title,
            content: item.content,
            type: item.type || "web_clip",
            tags: item.tags || [],
            source_url: item.url || "",
            author: item.author || "",
            published_date: item.date || new Date().toISOString(),
            metadata: JSON.stringify({
              domain: item.domain || "",
              excerpt: item.excerpt || "",
              clipped_at: new Date().toISOString(),
            }),
          };

          const savedItem = await this.database.addKnowledgeItem(knowledgeItem);

          // 添加到 RAG 索引
          if (data.autoIndex && this.ragManager) {
            try {
              await this.ragManager.addToIndex(savedItem);
            } catch (error) {
              logger.error(
                "[NativeMessagingHTTPServer] 添加到 RAG 索引失败:",
                error,
              );
            }
          }

          results.push({
            success: true,
            id: savedItem.id,
            title: savedItem.title,
          });
        } catch (error) {
          results.push({
            success: false,
            title: item.title,
            error: error.message,
          });
        }
      }

      const summary = {
        total: data.items.length,
        succeeded: results.filter((r) => r.success).length,
        failed: results.filter((r) => !r.success).length,
      };

      logger.info("[NativeMessagingHTTPServer] 批量剪藏完成:", summary);

      this.sendSuccess(res, {
        summary,
        results,
      });
    } catch (error) {
      logger.error("[NativeMessagingHTTPServer] 批量剪藏失败:", error);
      this.sendError(res, 500, error.message);
    }
  }

  /**
   * 处理搜索请求
   */
  async handleSearchRequest(req, res) {
    try {
      const body = await this.readRequestBody(req);
      const data = JSON.parse(body);

      logger.info("[NativeMessagingHTTPServer] 收到搜索请求:", data.query);

      if (!data.query) {
        this.sendError(res, 400, "缺少必要字段: query");
        return;
      }

      // 使用数据库搜索
      const results = await this.database.searchKnowledgeItems(data.query, {
        type: data.type || null,
        limit: data.limit || 20,
        offset: data.offset || 0,
      });

      this.sendSuccess(res, {
        results,
        total: results.length,
      });
    } catch (error) {
      logger.error("[NativeMessagingHTTPServer] 搜索失败:", error);
      this.sendError(res, 500, error.message);
    }
  }

  /**
   * 处理统计请求
   */
  async handleStatsRequest(req, res) {
    try {
      logger.info("[NativeMessagingHTTPServer] 收到统计请求");

      // 获取统计信息
      const stats = {
        totalItems: 0,
        webClips: 0,
        notes: 0,
        documents: 0,
        conversations: 0,
        recentClips: [],
      };

      if (this.database && this.database.db) {
        // 总数
        const totalResult = await new Promise((resolve, reject) => {
          this.database.db.get(
            "SELECT COUNT(*) as count FROM knowledge_items",
            (err, row) => {
              if (err) {
                reject(err);
              } else {
                resolve(row);
              }
            },
          );
        });
        stats.totalItems = totalResult.count;

        // 按类型统计
        const typeResults = await new Promise((resolve, reject) => {
          this.database.db.all(
            "SELECT type, COUNT(*) as count FROM knowledge_items GROUP BY type",
            (err, rows) => {
              if (err) {
                reject(err);
              } else {
                resolve(rows);
              }
            },
          );
        });

        typeResults.forEach((row) => {
          if (row.type === "web_clip") {
            stats.webClips = row.count;
          } else if (row.type === "note") {
            stats.notes = row.count;
          } else if (row.type === "document") {
            stats.documents = row.count;
          } else if (row.type === "conversation") {
            stats.conversations = row.count;
          }
        });

        // 最近的剪藏
        const recentResults = await new Promise((resolve, reject) => {
          this.database.db.all(
            "SELECT id, title, type, created_at FROM knowledge_items WHERE type = ? ORDER BY created_at DESC LIMIT 10",
            ["web_clip"],
            (err, rows) => {
              if (err) {
                reject(err);
              } else {
                resolve(rows);
              }
            },
          );
        });
        stats.recentClips = recentResults;
      }

      this.sendSuccess(res, stats);
    } catch (error) {
      logger.error("[NativeMessagingHTTPServer] 获取统计失败:", error);
      this.sendError(res, 500, error.message);
    }
  }
}

module.exports = NativeMessagingHTTPServer;
