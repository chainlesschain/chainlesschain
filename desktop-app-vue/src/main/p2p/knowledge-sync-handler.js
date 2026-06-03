/**
 * Knowledge Sync Handler - 知识库同步处理器
 *
 * 功能：
 * - 处理移动端知识库查询请求
 * - 同步知识库笔记列表
 * - 同步笔记内容
 * - 搜索笔记
 * - 处理离线缓存
 */

const { logger } = require("../utils/logger.js");
const EventEmitter = require("events");

class KnowledgeSyncHandler extends EventEmitter {
  constructor(databaseManager, p2pManager, mobileBridge) {
    super();

    this.db = databaseManager;
    this.p2pManager = p2pManager;
    this.mobileBridge = mobileBridge;

    // 同步统计
    this.stats = {
      notesSynced: 0,
      bytesTransferred: 0,
      searchQueries: 0,
    };
  }

  /**
   * 统一消息处理入口
   * 由主进程的消息路由调用
   */
  async handleMessage(mobilePeerId, message) {
    const { type } = message;

    switch (type) {
      case "knowledge:list-notes":
        await this.handleListNotes(mobilePeerId, message);
        break;

      case "knowledge:get-note":
        await this.handleGetNote(mobilePeerId, message);
        break;

      case "knowledge:search":
        await this.handleSearch(mobilePeerId, message);
        break;

      case "knowledge:get-folders":
        await this.handleGetFolders(mobilePeerId, message);
        break;

      case "knowledge:get-tags":
        await this.handleGetTags(mobilePeerId, message);
        break;

      default:
        logger.warn(`[KnowledgeSync] 未知消息类型: ${type}`);
        return {
          error: {
            code: "UNKNOWN_TYPE",
            message: `Unknown knowledge sync message type: ${type}`,
          },
        };
    }

    // 处理器方法直接发送响应，不需要返回值
    return undefined;
  }

  /**
   * 处理获取笔记列表请求
   */
  async handleListNotes(mobilePeerId, message) {
    logger.info("[KnowledgeSync] 处理笔记列表请求:", message);

    try {
      const {
        folderId,
        limit = 50,
        offset = 0,
        sortBy = "updated_at",
        sortOrder = "DESC",
      } = message.params || {};

      // 从数据库获取笔记列表
      let query = `
        SELECT
          id, title, folder_id, tags, created_at, updated_at,
          LENGTH(content) as content_length,
          SUBSTR(content, 1, 200) as preview
        FROM notes
        WHERE 1=1
      `;

      const params = [];

      if (folderId) {
        query += " AND folder_id = ?";
        params.push(folderId);
      }

      query += ` ORDER BY ${sortBy} ${sortOrder} LIMIT ? OFFSET ?`;
      params.push(limit, offset);

      const notes = await this.db.all(query, params);

      // 获取总数
      let countQuery = "SELECT COUNT(*) as total FROM notes WHERE 1=1";
      const countParams = [];
      if (folderId) {
        countQuery += " AND folder_id = ?";
        countParams.push(folderId);
      }

      const { total } = await this.db.get(countQuery, countParams);

      // 发送响应
      await this.sendToMobile(mobilePeerId, {
        type: "knowledge:list-notes:response",
        requestId: message.requestId,
        data: {
          notes: notes.map((note) => ({
            ...note,
            tags: note.tags ? JSON.parse(note.tags) : [],
            preview: note.preview || "",
            contentLength: note.content_length || 0,
          })),
          total,
          limit,
          offset,
        },
      });

      this.stats.notesSynced += notes.length;

      logger.info("[KnowledgeSync] ✅ 笔记列表已发送:", notes.length);
    } catch (error) {
      logger.error("[KnowledgeSync] 处理笔记列表请求失败:", error);

      // 如果是表不存在错误，返回空数组
      if (error.message && error.message.includes("no such table")) {
        await this.sendToMobile(mobilePeerId, {
          type: "knowledge:list-notes:response",
          requestId: message.requestId,
          data: {
            notes: [],
            total: 0,
            limit: message.params?.limit || 50,
            offset: message.params?.offset || 0,
          },
        });
        logger.info("[KnowledgeSync] ⚠️  数据库表不存在，返回空列表");
      } else {
        await this.sendError(mobilePeerId, message.requestId, error.message);
      }
    }
  }

  /**
   * 处理获取笔记详情请求
   */
  async handleGetNote(mobilePeerId, message) {
    logger.info("[KnowledgeSync] 处理笔记详情请求:", message);

    try {
      const { noteId } = message.params || {};

      if (!noteId) {
        throw new Error("缺少笔记ID");
      }

      // 从数据库获取笔记
      const note = await this.db.get(`SELECT * FROM notes WHERE id = ?`, [
        noteId,
      ]);

      if (!note) {
        throw new Error("笔记不存在");
      }

      // 解析tags
      note.tags = note.tags ? JSON.parse(note.tags) : [];

      // 发送响应
      await this.sendToMobile(mobilePeerId, {
        type: "knowledge:get-note:response",
        requestId: message.requestId,
        data: { note },
      });

      this.stats.bytesTransferred += (note.content || "").length;

      logger.info("[KnowledgeSync] ✅ 笔记详情已发送:", noteId);
    } catch (error) {
      logger.error("[KnowledgeSync] 处理笔记详情请求失败:", error);

      await this.sendError(mobilePeerId, message.requestId, error.message);
    }
  }

  /**
   * 处理搜索请求
   */
  async handleSearch(mobilePeerId, message) {
    logger.info("[KnowledgeSync] 处理搜索请求:", message);

    try {
      const { query, limit = 20, offset = 0 } = message.params || {};

      if (!query || query.trim().length === 0) {
        throw new Error("搜索关键词不能为空");
      }

      // 全文搜索 - JOIN notes表获取folder_id等字段
      const searchQuery = `
        SELECT
          n.id, n.title, n.folder_id, n.tags, n.created_at, n.updated_at,
          LENGTH(n.content) as content_length,
          snippet(notes_fts, -1, '<mark>', '</mark>', '...', 64) as snippet
        FROM notes_fts
        JOIN notes n ON notes_fts.id = n.id
        WHERE notes_fts MATCH ?
        ORDER BY rank
        LIMIT ? OFFSET ?
      `;

      const notes = await this.db.all(searchQuery, [query, limit, offset]);

      // 获取匹配总数
      const { total } = await this.db.get(
        `SELECT COUNT(*) as total FROM notes_fts WHERE notes_fts MATCH ?`,
        [query],
      );

      // 发送响应
      await this.sendToMobile(mobilePeerId, {
        type: "knowledge:search:response",
        requestId: message.requestId,
        data: {
          notes: notes.map((note) => ({
            ...note,
            tags: note.tags ? JSON.parse(note.tags) : [],
            snippet: note.snippet || "",
            contentLength: note.content_length || 0,
          })),
          total,
          limit,
          offset,
          query,
        },
      });

      this.stats.searchQueries++;

      logger.info("[KnowledgeSync] ✅ 搜索结果已发送:", notes.length);
    } catch (error) {
      logger.error("[KnowledgeSync] 处理搜索请求失败:", error);

      // 如果是表不存在错误，返回空数组
      if (error.message && error.message.includes("no such table")) {
        await this.sendToMobile(mobilePeerId, {
          type: "knowledge:search:response",
          requestId: message.requestId,
          data: {
            notes: [],
            total: 0,
            limit: message.params?.limit || 20,
            offset: message.params?.offset || 0,
            query: message.params?.query || "",
          },
        });
        logger.info("[KnowledgeSync] ⚠️  数据库表不存在，返回空搜索结果");
      } else {
        await this.sendError(mobilePeerId, message.requestId, error.message);
      }
    }
  }

  /**
   * 处理获取文件夹列表请求
   */
  async handleGetFolders(mobilePeerId, message) {
    logger.info("[KnowledgeSync] 处理文件夹列表请求");

    try {
      // 获取所有文件夹
      const folders = await this.db.all(`
        SELECT
          f.id, f.name, f.parent_id, f.created_at,
          COUNT(n.id) as note_count
        FROM folders f
        LEFT JOIN notes n ON n.folder_id = f.id
        GROUP BY f.id
        ORDER BY f.name ASC
      `);

      // 构建树形结构
      const folderTree = this.buildFolderTree(folders);

      // 发送响应
      await this.sendToMobile(mobilePeerId, {
        type: "knowledge:get-folders:response",
        requestId: message.requestId,
        data: { folders: folderTree },
      });

      logger.info("[KnowledgeSync] ✅ 文件夹列表已发送:", folders.length);
    } catch (error) {
      logger.error("[KnowledgeSync] 处理文件夹列表请求失败:", error);

      // 如果是表不存在错误，返回空数组
      if (error.message && error.message.includes("no such table")) {
        await this.sendToMobile(mobilePeerId, {
          type: "knowledge:get-folders:response",
          requestId: message.requestId,
          data: { folders: [] },
        });
        logger.info("[KnowledgeSync] ⚠️  数据库表不存在，返回空文件夹列表");
      } else {
        await this.sendError(mobilePeerId, message.requestId, error.message);
      }
    }
  }

  /**
   * 处理获取标签列表请求
   */
  async handleGetTags(mobilePeerId, message) {
    logger.info("[KnowledgeSync] 处理标签列表请求");

    try {
      // 从所有笔记的tags字段中提取标签并统计
      const notes = await this.db.all(`
        SELECT tags FROM notes WHERE tags IS NOT NULL AND tags != '[]'
      `);

      const tagCount = {};

      notes.forEach((note) => {
        try {
          const tags = JSON.parse(note.tags);
          tags.forEach((tag) => {
            tagCount[tag] = (tagCount[tag] || 0) + 1;
          });
        } catch (e) {
          // 忽略解析错误
        }
      });

      // 转换为数组并排序
      const tags = Object.entries(tagCount)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count);

      // 发送响应
      await this.sendToMobile(mobilePeerId, {
        type: "knowledge:get-tags:response",
        requestId: message.requestId,
        data: { tags },
      });

      logger.info("[KnowledgeSync] ✅ 标签列表已发送:", tags.length);
    } catch (error) {
      logger.error("[KnowledgeSync] 处理标签列表请求失败:", error);

      // 如果是表不存在错误，返回空数组
      if (error.message && error.message.includes("no such table")) {
        await this.sendToMobile(mobilePeerId, {
          type: "knowledge:get-tags:response",
          requestId: message.requestId,
          data: { tags: [] },
        });
        logger.info("[KnowledgeSync] ⚠️  数据库表不存在，返回空标签列表");
      } else {
        await this.sendError(mobilePeerId, message.requestId, error.message);
      }
    }
  }

  /**
   * 构建文件夹树形结构
   */
  buildFolderTree(folders) {
    const folderMap = new Map();
    const rootFolders = [];

    // 创建映射
    folders.forEach((folder) => {
      folderMap.set(folder.id, { ...folder, children: [] });
    });

    // 构建树
    folders.forEach((folder) => {
      const node = folderMap.get(folder.id);

      if (folder.parent_id && folderMap.has(folder.parent_id)) {
        const parent = folderMap.get(folder.parent_id);
        parent.children.push(node);
      } else {
        rootFolders.push(node);
      }
    });

    return rootFolders;
  }

  /**
   * 发送消息到移动端
   */
  async sendToMobile(mobilePeerId, message) {
    if (this.mobileBridge) {
      await this.mobileBridge.send({
        type: "message",
        to: mobilePeerId,
        payload: message,
      });
    } else {
      logger.error("[KnowledgeSync] MobileBridge未初始化");
    }
  }

  /**
   * 发送错误响应
   */
  async sendError(mobilePeerId, requestId, errorMessage) {
    await this.sendToMobile(mobilePeerId, {
      type: "error",
      requestId,
      error: errorMessage,
    });
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return { ...this.stats };
  }
}

module.exports = KnowledgeSyncHandler;
