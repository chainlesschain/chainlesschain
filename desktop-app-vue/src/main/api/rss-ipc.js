/**
 * RSS IPC Handlers
 * 处理 RSS 订阅相关的 IPC 通信
 *
 * v0.20.0: 新增 RSS 订阅功能
 */

const { ipcMain } = require('electron');
const { v4: uuidv4 } = require('uuid');
const RSSFetcher = require('./rss-fetcher');
const { getAPINotificationManager } = require('./notification-manager');

class RSSIPCHandler {
  constructor(database) {
    this.database = database;
    this.rssFetcher = new RSSFetcher();
    this.syncIntervals = new Map(); // 存储自动同步定时器
    this.notificationManager = getAPINotificationManager();
    this.registerHandlers();
  }

  registerHandlers() {
    // RSS 订阅源管理
    ipcMain.handle('rss:add-feed', async (event, feedUrl, options = {}) => {
      return this.addFeed(feedUrl, options);
    });

    ipcMain.handle('rss:remove-feed', async (event, feedId) => {
      return this.removeFeed(feedId);
    });

    ipcMain.handle('rss:update-feed', async (event, feedId, updates) => {
      return this.updateFeed(feedId, updates);
    });

    ipcMain.handle('rss:get-feeds', async (event, options = {}) => {
      return this.getFeeds(options);
    });

    ipcMain.handle('rss:get-feed', async (event, feedId) => {
      return this.getFeed(feedId);
    });

    // RSS 文章管理
    ipcMain.handle('rss:fetch-feed', async (event, feedId) => {
      return this.fetchFeed(feedId);
    });

    ipcMain.handle('rss:fetch-all-feeds', async (event) => {
      return this.fetchAllFeeds();
    });

    ipcMain.handle('rss:get-items', async (event, options = {}) => {
      return this.getItems(options);
    });

    ipcMain.handle('rss:get-item', async (event, itemId) => {
      return this.getItem(itemId);
    });

    ipcMain.handle('rss:mark-as-read', async (event, itemId) => {
      return this.markAsRead(itemId);
    });

    ipcMain.handle('rss:mark-as-starred', async (event, itemId, starred = true) => {
      return this.markAsStarred(itemId, starred);
    });

    ipcMain.handle('rss:archive-item', async (event, itemId) => {
      return this.archiveItem(itemId);
    });

    ipcMain.handle('rss:save-to-knowledge', async (event, itemId) => {
      return this.saveToKnowledge(itemId);
    });

    // RSS 分类管理
    ipcMain.handle('rss:add-category', async (event, name, options = {}) => {
      return this.addCategory(name, options);
    });

    ipcMain.handle('rss:get-categories', async (event) => {
      return this.getCategories();
    });

    ipcMain.handle('rss:assign-category', async (event, feedId, categoryId) => {
      return this.assignCategory(feedId, categoryId);
    });

    // Feed 发现
    ipcMain.handle('rss:discover-feeds', async (event, websiteUrl) => {
      return this.discoverFeeds(websiteUrl);
    });

    ipcMain.handle('rss:validate-feed', async (event, feedUrl) => {
      return this.validateFeed(feedUrl);
    });

    // 自动同步
    ipcMain.handle('rss:start-auto-sync', async (event, feedId) => {
      return this.startAutoSync(feedId);
    });

    ipcMain.handle('rss:stop-auto-sync', async (event, feedId) => {
      return this.stopAutoSync(feedId);
    });

    console.log('[RSSIPCHandler] RSS IPC handlers registered');
  }

  /**
   * 添加 RSS 订阅源
   */
  async addFeed(feedUrl, options = {}) {
    try {
      // 验证并获取 Feed 信息
      const feedData = await this.rssFetcher.fetchFeed(feedUrl);

      const feedId = uuidv4();
      const now = Date.now();

      // 保存订阅源
      const stmt = this.database.db.prepare(`
        INSERT INTO rss_feeds (
          id, url, title, description, link, language, image_url,
          category, update_frequency, last_fetched_at, last_build_date,
          status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run([
        feedId,
        feedUrl,
        feedData.title,
        feedData.description,
        feedData.link,
        feedData.language,
        feedData.image?.url || null,
        options.category || null,
        options.updateFrequency || 3600,
        now,
        feedData.lastBuildDate,
        'active',
        now,
        now,
      ]);

      // 保存文章
      await this.saveFeedItems(feedId, feedData.items);

      // 启动自动同步
      if (options.autoSync !== false) {
        this.startAutoSync(feedId);
      }

      return {
        success: true,
        feedId,
        feed: feedData,
      };
    } catch (error) {
      console.error('[RSSIPCHandler] 添加订阅源失败:', error);
      throw error;
    }
  }

  /**
   * 删除 RSS 订阅源
   */
  async removeFeed(feedId) {
    try {
      // 停止自动同步
      this.stopAutoSync(feedId);

      const stmt = this.database.db.prepare('DELETE FROM rss_feeds WHERE id = ?');
      stmt.run([feedId]);

      return { success: true };
    } catch (error) {
      console.error('[RSSIPCHandler] 删除订阅源失败:', error);
      throw error;
    }
  }

  /**
   * 更新 RSS 订阅源
   */
  async updateFeed(feedId, updates) {
    try {
      const fields = [];
      const values = [];

      for (const [key, value] of Object.entries(updates)) {
        fields.push(`${key} = ?`);
        values.push(value);
      }

      fields.push('updated_at = ?');
      values.push(Date.now());
      values.push(feedId);

      const stmt = this.database.db.prepare(`
        UPDATE rss_feeds SET ${fields.join(', ')} WHERE id = ?
      `);
      stmt.run(values);

      return { success: true };
    } catch (error) {
      console.error('[RSSIPCHandler] 更新订阅源失败:', error);
      throw error;
    }
  }

  /**
   * 获取订阅源列表
   */
  async getFeeds(options = {}) {
    try {
      let query = 'SELECT * FROM rss_feeds';
      const conditions = [];
      const params = [];

      if (options.status) {
        conditions.push('status = ?');
        params.push(options.status);
      }

      if (options.category) {
        conditions.push('category = ?');
        params.push(options.category);
      }

      if (conditions.length > 0) {
        query += ' WHERE ' + conditions.join(' AND ');
      }

      query += ' ORDER BY title ASC';

      const stmt = this.database.db.prepare(query);
      const feeds = stmt.all(params);

      return { success: true, feeds };
    } catch (error) {
      console.error('[RSSIPCHandler] 获取订阅源列表失败:', error);
      throw error;
    }
  }

  /**
   * 获取单个订阅源
   */
  async getFeed(feedId) {
    try {
      const stmt = this.database.db.prepare('SELECT * FROM rss_feeds WHERE id = ?');
      const feed = stmt.get([feedId]);

      if (!feed) {
        throw new Error('订阅源不存在');
      }

      return { success: true, feed };
    } catch (error) {
      console.error('[RSSIPCHandler] 获取订阅源失败:', error);
      throw error;
    }
  }

  /**
   * 获取 RSS 文章列表
   */
  async getItems(options = {}) {
    try {
      let query = 'SELECT * FROM rss_items';
      const conditions = [];
      const params = [];

      if (options.feedId) {
        conditions.push('feed_id = ?');
        params.push(options.feedId);
      }

      if (options.isRead !== undefined) {
        conditions.push('is_read = ?');
        params.push(options.isRead ? 1 : 0);
      }

      if (options.isStarred !== undefined) {
        conditions.push('is_starred = ?');
        params.push(options.isStarred ? 1 : 0);
      }

      if (options.isArchived !== undefined) {
        conditions.push('is_archived = ?');
        params.push(options.isArchived ? 1 : 0);
      }

      if (conditions.length > 0) {
        query += ' WHERE ' + conditions.join(' AND ');
      }

      query += ' ORDER BY pub_date DESC';

      if (options.limit) {
        query += ` LIMIT ${options.limit}`;
      }

      const stmt = this.database.db.prepare(query);
      const items = stmt.all(params);

      return { success: true, items };
    } catch (error) {
      console.error('[RSSIPCHandler] 获取文章列表失败:', error);
      throw error;
    }
  }

  /**
   * 获取单篇文章
   */
  async getItem(itemId) {
    try {
      const stmt = this.database.db.prepare('SELECT * FROM rss_items WHERE id = ?');
      const item = stmt.get([itemId]);

      if (!item) {
        throw new Error('文章不存在');
      }

      return { success: true, item };
    } catch (error) {
      console.error('[RSSIPCHandler] 获取文章失败:', error);
      throw error;
    }
  }

  /**
   * 标记为已读
   */
  async markAsRead(itemId) {
    try {
      const stmt = this.database.db.prepare('UPDATE rss_items SET is_read = 1 WHERE id = ?');
      stmt.run([itemId]);

      return { success: true };
    } catch (error) {
      console.error('[RSSIPCHandler] 标记已读失败:', error);
      throw error;
    }
  }

  /**
   * 标记为收藏
   */
  async markAsStarred(itemId, starred = true) {
    try {
      const stmt = this.database.db.prepare('UPDATE rss_items SET is_starred = ? WHERE id = ?');
      stmt.run([starred ? 1 : 0, itemId]);

      return { success: true };
    } catch (error) {
      console.error('[RSSIPCHandler] 标记收藏失败:', error);
      throw error;
    }
  }

  /**
   * 归档文章
   */
  async archiveItem(itemId) {
    try {
      const stmt = this.database.db.prepare('UPDATE rss_items SET is_archived = 1 WHERE id = ?');
      stmt.run([itemId]);

      return { success: true };
    } catch (error) {
      console.error('[RSSIPCHandler] 归档文章失败:', error);
      throw error;
    }
  }

  /**
   * 保存到知识库
   */
  async saveToKnowledge(itemId) {
    try {
      const itemStmt = this.database.db.prepare('SELECT * FROM rss_items WHERE id = ?');
      const item = itemStmt.get([itemId]);

      if (!item) {
        throw new Error('文章不存在');
      }

      // 创建知识库条目
      const knowledgeId = uuidv4();
      const now = Date.now();

      const knowledgeStmt = this.database.db.prepare(`
        INSERT INTO knowledge_items (
          id, title, type, content, created_at, updated_at, sync_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      knowledgeStmt.run([
        knowledgeId,
        item.title,
        'web_clip',
        item.content || item.description,
        now,
        now,
        'pending',
      ]);

      // 更新 RSS 文章关联
      const updateStmt = this.database.db.prepare(
        'UPDATE rss_items SET knowledge_item_id = ? WHERE id = ?'
      );
      updateStmt.run([knowledgeId, itemId]);

      return { success: true, knowledgeId };
    } catch (error) {
      console.error('[RSSIPCHandler] 保存到知识库失败:', error);
      throw error;
    }
  }

  /**
   * 获取 Feed 更新
   */
  async fetchFeed(feedId) {
    try {
      const feedStmt = this.database.db.prepare('SELECT * FROM rss_feeds WHERE id = ?');
      const feed = feedStmt.get([feedId]);

      if (!feed) {
        throw new Error('订阅源不存在');
      }

      // 获取当前文章数量（用于计算新文章）
      const countStmt = this.database.db.prepare('SELECT COUNT(*) as count FROM rss_items WHERE feed_id = ?');
      const beforeCount = countStmt.get([feedId])?.count || 0;

      // 获取最新内容
      const feedData = await this.rssFetcher.fetchFeed(feed.url);

      // 更新订阅源信息
      const updateStmt = this.database.db.prepare(`
        UPDATE rss_feeds
        SET last_fetched_at = ?, last_build_date = ?, status = 'active', error_message = NULL
        WHERE id = ?
      `);
      updateStmt.run([Date.now(), feedData.lastBuildDate, feedId]);

      // 保存新文章
      await this.saveFeedItems(feedId, feedData.items);

      // 计算新文章数量
      const afterCount = countStmt.get([feedId])?.count || 0;
      const newItemsCount = afterCount - beforeCount;

      // 发送通知（如果有新文章）
      if (newItemsCount > 0) {
        this.notificationManager.notifyNewArticles(
          feed.title,
          newItemsCount,
          feedData.items.slice(0, 5)
        );
      }

      return { success: true, itemCount: feedData.items.length, newItemsCount };
    } catch (error) {
      console.error('[RSSIPCHandler] 获取 Feed 更新失败:', error);

      // 获取 feed 信息用于通知
      const feedStmt = this.database.db.prepare('SELECT title FROM rss_feeds WHERE id = ?');
      const feed = feedStmt.get([feedId]);

      // 发送错误通知
      if (feed) {
        this.notificationManager.notifyRSSError(feed.title, error.message);
      }

      // 更新错误状态
      const updateStmt = this.database.db.prepare(`
        UPDATE rss_feeds SET status = 'error', error_message = ? WHERE id = ?
      `);
      updateStmt.run([error.message, feedId]);

      throw error;
    }
  }

  /**
   * 获取所有 Feed 更新
   */
  async fetchAllFeeds() {
    try {
      const stmt = this.database.db.prepare("SELECT id FROM rss_feeds WHERE status = 'active'");
      const feeds = stmt.all([]);

      const results = {
        success: 0,
        failed: 0,
        total: feeds.length,
      };

      for (const feed of feeds) {
        try {
          await this.fetchFeed(feed.id);
          results.success++;
        } catch (error) {
          results.failed++;
        }
      }

      return { success: true, results };
    } catch (error) {
      console.error('[RSSIPCHandler] 批量获取更新失败:', error);
      throw error;
    }
  }

  /**
   * 保存 Feed 文章
   */
  async saveFeedItems(feedId, items) {
    const stmt = this.database.db.prepare(`
      INSERT OR IGNORE INTO rss_items (
        id, feed_id, item_id, title, link, description, content,
        author, pub_date, categories, enclosure_url, enclosure_type,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const item of items) {
      const itemId = uuidv4();
      stmt.run([
        itemId,
        feedId,
        item.id,
        item.title,
        item.link,
        item.description,
        item.content,
        item.author,
        item.pubDate,
        JSON.stringify(item.categories),
        item.enclosure?.url || null,
        item.enclosure?.type || null,
        Date.now(),
      ]);
    }
  }

  /**
   * 添加分类
   */
  async addCategory(name, options = {}) {
    try {
      const categoryId = uuidv4();
      const stmt = this.database.db.prepare(`
        INSERT INTO rss_categories (id, name, color, icon, sort_order, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `);

      stmt.run([
        categoryId,
        name,
        options.color || '#1890ff',
        options.icon || null,
        options.sortOrder || 0,
        Date.now(),
      ]);

      return { success: true, categoryId };
    } catch (error) {
      console.error('[RSSIPCHandler] 添加分类失败:', error);
      throw error;
    }
  }

  /**
   * 获取分类列表
   */
  async getCategories() {
    try {
      const stmt = this.database.db.prepare('SELECT * FROM rss_categories ORDER BY sort_order, name');
      const categories = stmt.all([]);

      return { success: true, categories };
    } catch (error) {
      console.error('[RSSIPCHandler] 获取分类列表失败:', error);
      throw error;
    }
  }

  /**
   * 分配分类
   */
  async assignCategory(feedId, categoryId) {
    try {
      const stmt = this.database.db.prepare(`
        INSERT OR IGNORE INTO rss_feed_categories (feed_id, category_id, created_at)
        VALUES (?, ?, ?)
      `);

      stmt.run([feedId, categoryId, Date.now()]);

      return { success: true };
    } catch (error) {
      console.error('[RSSIPCHandler] 分配分类失败:', error);
      throw error;
    }
  }

  /**
   * 发现 Feed
   */
  async discoverFeeds(websiteUrl) {
    try {
      const feeds = await this.rssFetcher.discoverFeeds(websiteUrl);
      return { success: true, feeds };
    } catch (error) {
      console.error('[RSSIPCHandler] 发现 Feed 失败:', error);
      throw error;
    }
  }

  /**
   * 验证 Feed
   */
  async validateFeed(feedUrl) {
    try {
      const validation = await this.rssFetcher.validateFeed(feedUrl);
      return { success: true, validation };
    } catch (error) {
      console.error('[RSSIPCHandler] 验证 Feed 失败:', error);
      throw error;
    }
  }

  /**
   * 启动自动同步
   */
  startAutoSync(feedId) {
    try {
      // 如果已存在，先停止
      this.stopAutoSync(feedId);

      const feedStmt = this.database.db.prepare('SELECT update_frequency FROM rss_feeds WHERE id = ?');
      const feed = feedStmt.get([feedId]);

      if (!feed) {
        return { success: false, error: '订阅源不存在' };
      }

      const interval = setInterval(async () => {
        try {
          await this.fetchFeed(feedId);
          console.log(`[RSSIPCHandler] 自动同步完成: ${feedId}`);
        } catch (error) {
          console.error(`[RSSIPCHandler] 自动同步失败: ${feedId}`, error);
        }
      }, feed.update_frequency * 1000);

      this.syncIntervals.set(feedId, interval);

      return { success: true };
    } catch (error) {
      console.error('[RSSIPCHandler] 启动自动同步失败:', error);
      throw error;
    }
  }

  /**
   * 停止自动同步
   */
  stopAutoSync(feedId) {
    const interval = this.syncIntervals.get(feedId);
    if (interval) {
      clearInterval(interval);
      this.syncIntervals.delete(feedId);
    }
    return { success: true };
  }

  /**
   * 清理资源
   */
  cleanup() {
    // 停止所有自动同步
    for (const [feedId, interval] of this.syncIntervals) {
      clearInterval(interval);
    }
    this.syncIntervals.clear();
  }
}

module.exports = RSSIPCHandler;
