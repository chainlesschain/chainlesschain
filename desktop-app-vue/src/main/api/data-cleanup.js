/**
 * Data Cleanup Manager
 * 定期清理旧的 RSS 和邮件数据
 *
 * v0.20.1: 新增数据清理功能
 */

const { EventEmitter } = require('events');

class DataCleanupManager extends EventEmitter {
  constructor(database) {
    super();
    this.database = database;
    this.cleanupInterval = null;
    this.defaultRetentionDays = 30; // 默认保留30天
  }

  /**
   * 启动自动清理任务
   * @param {number} intervalMs - 清理间隔（毫秒），默认24小时
   */
  startAutoCleanup(intervalMs = 24 * 60 * 60 * 1000) {
    if (this.cleanupInterval) {
      console.log('[DataCleanup] 自动清理任务已在运行');
      return;
    }

    console.log(`[DataCleanup] 启动自动清理任务，间隔: ${intervalMs}ms`);

    // 立即执行一次清理
    this.runCleanup().catch(error => {
      console.error('[DataCleanup] 初始清理失败:', error);
    });

    // 设置定时清理
    this.cleanupInterval = setInterval(() => {
      this.runCleanup().catch(error => {
        console.error('[DataCleanup] 定时清理失败:', error);
      });
    }, intervalMs);
  }

  /**
   * 停止自动清理任务
   */
  stopAutoCleanup() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
      console.log('[DataCleanup] 自动清理任务已停止');
    }
  }

  /**
   * 执行清理任务
   */
  async runCleanup() {
    console.log('[DataCleanup] 开始执行数据清理...');
    this.emit('cleanup-start');

    const results = {
      rssItems: 0,
      emails: 0,
      attachments: 0,
      errors: [],
    };

    try {
      // 清理旧的 RSS 文章
      results.rssItems = await this.cleanupOldRSSItems();

      // 清理旧的邮件
      results.emails = await this.cleanupOldEmails();

      // 清理孤立的附件
      results.attachments = await this.cleanupOrphanedAttachments();

      console.log('[DataCleanup] 清理完成:', results);
      this.emit('cleanup-complete', results);

      return results;
    } catch (error) {
      console.error('[DataCleanup] 清理失败:', error);
      results.errors.push(error.message);
      this.emit('cleanup-error', error);
      throw error;
    }
  }

  /**
   * 清理旧的 RSS 文章
   * @param {number} retentionDays - 保留天数，默认30天
   */
  async cleanupOldRSSItems(retentionDays = this.defaultRetentionDays) {
    const cutoffTime = Date.now() - (retentionDays * 24 * 60 * 60 * 1000);

    try {
      // 删除未标星、未归档的旧文章
      const result = this.database.db.prepare(`
        DELETE FROM rss_items
        WHERE is_archived = 0
          AND is_starred = 0
          AND created_at < ?
      `).run(cutoffTime);

      const deletedCount = result.changes || 0;
      console.log(`[DataCleanup] 清理了 ${deletedCount} 条旧的 RSS 文章`);

      return deletedCount;
    } catch (error) {
      console.error('[DataCleanup] 清理 RSS 文章失败:', error);
      throw error;
    }
  }

  /**
   * 清理旧的邮件
   * @param {number} retentionDays - 保留天数，默认30天
   */
  async cleanupOldEmails(retentionDays = this.defaultRetentionDays) {
    const cutoffTime = Date.now() - (retentionDays * 24 * 60 * 60 * 1000);

    try {
      // 删除已归档的旧邮件
      const result = this.database.db.prepare(`
        DELETE FROM emails
        WHERE is_archived = 1
          AND created_at < ?
      `).run(cutoffTime);

      const deletedCount = result.changes || 0;
      console.log(`[DataCleanup] 清理了 ${deletedCount} 封旧邮件`);

      return deletedCount;
    } catch (error) {
      console.error('[DataCleanup] 清理邮件失败:', error);
      throw error;
    }
  }

  /**
   * 清理孤立的附件（邮件已删除但附件仍存在）
   */
  async cleanupOrphanedAttachments() {
    try {
      // 删除没有对应邮件的附件
      const result = this.database.db.prepare(`
        DELETE FROM email_attachments
        WHERE email_id NOT IN (SELECT id FROM emails)
      `).run();

      const deletedCount = result.changes || 0;
      console.log(`[DataCleanup] 清理了 ${deletedCount} 个孤立附件`);

      return deletedCount;
    } catch (error) {
      console.error('[DataCleanup] 清理孤立附件失败:', error);
      throw error;
    }
  }

  /**
   * 获取数据统计信息
   */
  async getDataStats() {
    try {
      const stats = {
        rss: {
          totalItems: 0,
          starredItems: 0,
          archivedItems: 0,
          oldItems: 0,
        },
        email: {
          totalEmails: 0,
          archivedEmails: 0,
          oldEmails: 0,
          totalAttachments: 0,
          orphanedAttachments: 0,
        },
      };

      // RSS 统计
      const rssTotal = this.database.db.prepare('SELECT COUNT(*) as count FROM rss_items').get();
      stats.rss.totalItems = rssTotal.count;

      const rssStarred = this.database.db.prepare('SELECT COUNT(*) as count FROM rss_items WHERE is_starred = 1').get();
      stats.rss.starredItems = rssStarred.count;

      const rssArchived = this.database.db.prepare('SELECT COUNT(*) as count FROM rss_items WHERE is_archived = 1').get();
      stats.rss.archivedItems = rssArchived.count;

      const cutoffTime = Date.now() - (this.defaultRetentionDays * 24 * 60 * 60 * 1000);
      const rssOld = this.database.db.prepare(`
        SELECT COUNT(*) as count FROM rss_items
        WHERE is_archived = 0 AND is_starred = 0 AND created_at < ?
      `).get(cutoffTime);
      stats.rss.oldItems = rssOld.count;

      // 邮件统计
      const emailTotal = this.database.db.prepare('SELECT COUNT(*) as count FROM emails').get();
      stats.email.totalEmails = emailTotal.count;

      const emailArchived = this.database.db.prepare('SELECT COUNT(*) as count FROM emails WHERE is_archived = 1').get();
      stats.email.archivedEmails = emailArchived.count;

      const emailOld = this.database.db.prepare(`
        SELECT COUNT(*) as count FROM emails
        WHERE is_archived = 1 AND created_at < ?
      `).get(cutoffTime);
      stats.email.oldEmails = emailOld.count;

      const attachmentTotal = this.database.db.prepare('SELECT COUNT(*) as count FROM email_attachments').get();
      stats.email.totalAttachments = attachmentTotal.count;

      const orphanedAttachments = this.database.db.prepare(`
        SELECT COUNT(*) as count FROM email_attachments
        WHERE email_id NOT IN (SELECT id FROM emails)
      `).get();
      stats.email.orphanedAttachments = orphanedAttachments.count;

      return stats;
    } catch (error) {
      console.error('[DataCleanup] 获取数据统计失败:', error);
      throw error;
    }
  }

  /**
   * 设置保留天数
   */
  setRetentionDays(days) {
    this.defaultRetentionDays = days;
    console.log(`[DataCleanup] 保留天数已设置为: ${days} 天`);
  }
}

module.exports = DataCleanupManager;
