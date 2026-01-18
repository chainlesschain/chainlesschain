/**
 * MemorySyncService - 内存数据文件系统同步服务
 *
 * 负责将数据库中的数据同步到 .chainlesschain/ 文件系统目录，
 * 确保数据同时存在于数据库和文件系统中。
 *
 * 功能：
 * - 初始化时自动同步所有数据
 * - 定期后台同步
 * - 按类别同步（preferences, patterns, sessions, reports 等）
 * - 增量同步和全量同步
 *
 * @module memory-sync-service
 * @version 1.0.0
 * @since 2026-01-18
 */

const fs = require("fs").promises;
const path = require("path");
const { EventEmitter } = require("events");

/**
 * MemorySyncService 类
 */
class MemorySyncService extends EventEmitter {
  /**
   * 创建同步服务实例
   * @param {Object} options - 配置选项
   * @param {Object} options.configManager - UnifiedConfigManager 实例
   * @param {Object} [options.preferenceManager] - PreferenceManager 实例
   * @param {Object} [options.learnedPatternManager] - LearnedPatternManager 实例
   * @param {Object} [options.sessionManager] - SessionManager 实例
   * @param {Object} [options.autoBackupManager] - AutoBackupManager 实例
   * @param {Object} [options.usageReportGenerator] - UsageReportGenerator 实例
   * @param {Object} [options.behaviorTracker] - BehaviorTracker 实例
   * @param {Object} [options.contextAssociator] - ContextAssociator 实例
   * @param {number} [options.syncInterval=300000] - 同步间隔（毫秒，默认5分钟）
   * @param {boolean} [options.enablePeriodicSync=true] - 启用定期同步
   */
  constructor(options = {}) {
    super();

    if (!options.configManager) {
      throw new Error("[MemorySyncService] configManager is required");
    }

    this.configManager = options.configManager;
    this.preferenceManager = options.preferenceManager;
    this.learnedPatternManager = options.learnedPatternManager;
    this.sessionManager = options.sessionManager;
    this.autoBackupManager = options.autoBackupManager;
    this.usageReportGenerator = options.usageReportGenerator;
    this.behaviorTracker = options.behaviorTracker;
    this.contextAssociator = options.contextAssociator;

    this.syncInterval = options.syncInterval || 5 * 60 * 1000; // 5分钟
    this.enablePeriodicSync = options.enablePeriodicSync !== false;

    this._syncTimer = null;
    this._isSyncing = false;
    this._lastSyncTime = null;
    this._syncStats = {
      totalSyncs: 0,
      successfulSyncs: 0,
      failedSyncs: 0,
      lastError: null,
    };

    // 获取路径
    this.paths = this.configManager.getPaths();

    console.log("[MemorySyncService] Initialized", {
      syncInterval: this.syncInterval,
      enablePeriodicSync: this.enablePeriodicSync,
      memoryDir: this.paths.memory,
    });
  }

  /**
   * 初始化并执行首次同步
   */
  async initialize() {
    try {
      console.log("[MemorySyncService] Starting initialization sync...");

      // 确保所有目录存在
      await this.ensureDirectories();

      // 执行首次全量同步
      await this.syncAll();

      // 启动定期同步
      if (this.enablePeriodicSync) {
        this.startPeriodicSync();
      }

      console.log("[MemorySyncService] Initialization complete");
    } catch (error) {
      console.error("[MemorySyncService] Initialization failed:", error);
      throw error;
    }
  }

  /**
   * 确保所有目录存在
   */
  async ensureDirectories() {
    const dirs = [
      this.paths.memory,
      this.paths.sessions,
      this.paths.preferences,
      this.paths.learnedPatterns,
      this.paths.logs,
      this.paths.cache,
      this.paths.embeddings,
      this.paths.queryResults,
      this.paths.modelOutputs,
      this.paths.checkpoints,
      this.paths.autoBackup,
      this.paths.reports,
      this.paths.backups,
    ];

    for (const dir of dirs) {
      try {
        await fs.mkdir(dir, { recursive: true });
      } catch (error) {
        if (error.code !== "EEXIST") {
          console.warn(
            `[MemorySyncService] Failed to create directory: ${dir}`,
            error.message,
          );
        }
      }
    }

    console.log("[MemorySyncService] Directories ensured");
  }

  /**
   * 同步所有数据到文件系统
   * @returns {Promise<Object>} 同步结果
   */
  async syncAll() {
    if (this._isSyncing) {
      console.log("[MemorySyncService] Sync already in progress, skipping...");
      return { success: false, reason: "already_syncing" };
    }

    this._isSyncing = true;
    const startTime = Date.now();
    const results = {};

    try {
      console.log("[MemorySyncService] Starting full sync...");

      // 同步偏好设置
      results.preferences = await this.syncPreferences();

      // 同步学习模式
      results.patterns = await this.syncPatterns();

      // 同步会话
      results.sessions = await this.syncSessions();

      // 同步行为数据
      results.behaviors = await this.syncBehaviors();

      // 同步上下文关联
      results.contexts = await this.syncContexts();

      // 生成同步报告
      results.report = await this.generateSyncReport();

      // 更新统计
      this._syncStats.totalSyncs++;
      this._syncStats.successfulSyncs++;
      this._lastSyncTime = Date.now();

      const duration = Date.now() - startTime;
      console.log(`[MemorySyncService] Full sync complete in ${duration}ms`);

      this.emit("sync-complete", { results, duration });

      return { success: true, results, duration };
    } catch (error) {
      console.error("[MemorySyncService] Full sync failed:", error);
      this._syncStats.totalSyncs++;
      this._syncStats.failedSyncs++;
      this._syncStats.lastError = error.message;

      this.emit("sync-error", { error });

      return { success: false, error: error.message };
    } finally {
      this._isSyncing = false;
    }
  }

  /**
   * 同步偏好设置到文件系统
   */
  async syncPreferences() {
    if (!this.preferenceManager) {
      return { skipped: true, reason: "no_manager" };
    }

    try {
      const allPrefs = await this.preferenceManager.getAll();
      let syncedCount = 0;

      // 按分类保存
      for (const [category, prefs] of Object.entries(allPrefs)) {
        const filePath = path.join(this.paths.preferences, `${category}.json`);
        await fs.writeFile(filePath, JSON.stringify(prefs, null, 2), "utf-8");
        syncedCount++;
      }

      // 保存汇总文件
      const summaryPath = path.join(this.paths.preferences, "_all.json");
      await fs.writeFile(
        summaryPath,
        JSON.stringify(
          {
            syncedAt: new Date().toISOString(),
            categories: Object.keys(allPrefs),
            data: allPrefs,
          },
          null,
          2,
        ),
        "utf-8",
      );

      console.log(
        `[MemorySyncService] Synced ${syncedCount} preference categories`,
      );
      return { success: true, count: syncedCount };
    } catch (error) {
      console.error("[MemorySyncService] Preference sync failed:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 同步学习模式到文件系统
   */
  async syncPatterns() {
    if (!this.learnedPatternManager) {
      return { skipped: true, reason: "no_manager" };
    }

    try {
      // 使用 learnedPatternManager 的备份方法
      const result = await this.learnedPatternManager.backupToFiles();

      // 额外保存统计信息
      const stats = await this.learnedPatternManager.getStats();
      const statsPath = path.join(this.paths.learnedPatterns, "_stats.json");
      await fs.writeFile(
        statsPath,
        JSON.stringify(
          {
            syncedAt: new Date().toISOString(),
            ...stats,
          },
          null,
          2,
        ),
        "utf-8",
      );

      console.log("[MemorySyncService] Patterns synced");
      return result;
    } catch (error) {
      console.error("[MemorySyncService] Pattern sync failed:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 同步会话到文件系统
   */
  async syncSessions() {
    if (!this.sessionManager) {
      return { skipped: true, reason: "no_manager" };
    }

    try {
      // 获取最近的会话（listSessions 返回数组）
      const sessions = await this.sessionManager.listSessions({
        limit: 100,
      });

      let syncedCount = 0;

      for (const session of sessions) {
        try {
          // 加载完整会话
          const fullSession = await this.sessionManager.loadSession(session.id);
          if (fullSession) {
            await this.sessionManager.saveSessionToFile(fullSession);
            syncedCount++;
          }
        } catch (error) {
          console.warn(
            `[MemorySyncService] Failed to sync session ${session.id}:`,
            error.message,
          );
        }
      }

      // 保存会话索引
      const indexPath = path.join(this.paths.sessions, "_index.json");
      await fs.writeFile(
        indexPath,
        JSON.stringify(
          {
            syncedAt: new Date().toISOString(),
            totalSessions: sessions.length,
            sessions: sessions.map((s) => ({
              id: s.id,
              title: s.title,
              updatedAt: s.updatedAt,
            })),
          },
          null,
          2,
        ),
        "utf-8",
      );

      console.log(`[MemorySyncService] Synced ${syncedCount} sessions`);
      return { success: true, count: syncedCount };
    } catch (error) {
      console.error("[MemorySyncService] Session sync failed:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 同步行为数据到文件系统
   */
  async syncBehaviors() {
    if (!this.behaviorTracker) {
      return { skipped: true, reason: "no_manager" };
    }

    try {
      let stats = {};
      let recommendations = [];

      // 安全地获取统计信息
      if (typeof this.behaviorTracker.getStats === "function") {
        try {
          stats = await this.behaviorTracker.getStats();
        } catch (e) {
          console.warn(
            "[MemorySyncService] Failed to get behavior stats:",
            e.message,
          );
        }
      }

      // 安全地获取推荐
      if (typeof this.behaviorTracker.getRecommendations === "function") {
        try {
          recommendations = await this.behaviorTracker.getRecommendations();
        } catch (e) {
          console.warn(
            "[MemorySyncService] Failed to get recommendations:",
            e.message,
          );
        }
      }

      const behaviorPath = path.join(
        this.paths.learnedPatterns,
        "behaviors.json",
      );
      await fs.writeFile(
        behaviorPath,
        JSON.stringify(
          {
            syncedAt: new Date().toISOString(),
            stats,
            recommendations,
          },
          null,
          2,
        ),
        "utf-8",
      );

      console.log("[MemorySyncService] Behaviors synced");
      return { success: true };
    } catch (error) {
      console.error("[MemorySyncService] Behavior sync failed:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 同步上下文关联到文件系统
   */
  async syncContexts() {
    if (!this.contextAssociator) {
      return { skipped: true, reason: "no_manager" };
    }

    try {
      // 尝试导出知识图谱（如果方法存在）
      let knowledgeGraph = null;
      if (typeof this.contextAssociator.exportKnowledgeGraph === "function") {
        knowledgeGraph = await this.contextAssociator.exportKnowledgeGraph();
      } else if (typeof this.contextAssociator.getStats === "function") {
        // 回退到获取统计信息
        knowledgeGraph = await this.contextAssociator.getStats();
      }

      const contextPath = path.join(
        this.paths.learnedPatterns,
        "contexts.json",
      );
      await fs.writeFile(
        contextPath,
        JSON.stringify(
          {
            syncedAt: new Date().toISOString(),
            knowledgeGraph: knowledgeGraph || {},
          },
          null,
          2,
        ),
        "utf-8",
      );

      console.log("[MemorySyncService] Contexts synced");
      return { success: true };
    } catch (error) {
      console.error("[MemorySyncService] Context sync failed:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 生成同步报告
   */
  async generateSyncReport() {
    try {
      const report = {
        generatedAt: new Date().toISOString(),
        configDir: this.paths.root,
        syncStats: this._syncStats,
        lastSyncTime: this._lastSyncTime
          ? new Date(this._lastSyncTime).toISOString()
          : null,
        directories: {},
      };

      // 检查各目录状态
      const dirsToCheck = [
        { name: "preferences", path: this.paths.preferences },
        { name: "learnedPatterns", path: this.paths.learnedPatterns },
        { name: "sessions", path: this.paths.sessions },
        { name: "reports", path: this.paths.reports },
        { name: "backups", path: this.paths.backups },
        { name: "logs", path: this.paths.logs },
        { name: "cache", path: this.paths.cache },
      ];

      for (const dir of dirsToCheck) {
        try {
          const files = await fs.readdir(dir.path);
          report.directories[dir.name] = {
            path: dir.path,
            exists: true,
            fileCount: files.filter((f) => !f.startsWith(".")).length,
          };
        } catch {
          report.directories[dir.name] = {
            path: dir.path,
            exists: false,
            fileCount: 0,
          };
        }
      }

      // 保存报告到文件
      const reportPath = path.join(this.paths.reports, "sync-report.json");
      await fs.writeFile(reportPath, JSON.stringify(report, null, 2), "utf-8");

      return report;
    } catch (error) {
      console.error("[MemorySyncService] Generate report failed:", error);
      return { error: error.message };
    }
  }

  /**
   * 启动定期同步
   */
  startPeriodicSync() {
    if (this._syncTimer) {
      return;
    }

    this._syncTimer = setInterval(async () => {
      console.log("[MemorySyncService] Running periodic sync...");
      try {
        await this.syncAll();
      } catch (error) {
        console.error("[MemorySyncService] Periodic sync failed:", error);
      }
    }, this.syncInterval);

    console.log(
      `[MemorySyncService] Periodic sync started (interval: ${this.syncInterval}ms)`,
    );
  }

  /**
   * 停止定期同步
   */
  stopPeriodicSync() {
    if (this._syncTimer) {
      clearInterval(this._syncTimer);
      this._syncTimer = null;
      console.log("[MemorySyncService] Periodic sync stopped");
    }
  }

  /**
   * 按类别同步
   * @param {string} category - 类别名称
   * @returns {Promise<Object>} 同步结果
   */
  async syncCategory(category) {
    switch (category) {
      case "preferences":
        return this.syncPreferences();
      case "patterns":
        return this.syncPatterns();
      case "sessions":
        return this.syncSessions();
      case "behaviors":
        return this.syncBehaviors();
      case "contexts":
        return this.syncContexts();
      default:
        return { success: false, error: `Unknown category: ${category}` };
    }
  }

  /**
   * 获取同步状态
   * @returns {Object} 同步状态
   */
  getStatus() {
    return {
      isSyncing: this._isSyncing,
      lastSyncTime: this._lastSyncTime,
      stats: this._syncStats,
      periodicSyncEnabled: !!this._syncTimer,
      syncInterval: this.syncInterval,
    };
  }

  /**
   * 更新 Manager 引用
   * @param {Object} managers - 新的 manager 引用
   */
  updateManagers(managers) {
    if (managers.preferenceManager) {
      this.preferenceManager = managers.preferenceManager;
    }
    if (managers.learnedPatternManager) {
      this.learnedPatternManager = managers.learnedPatternManager;
    }
    if (managers.sessionManager) {
      this.sessionManager = managers.sessionManager;
    }
    if (managers.autoBackupManager) {
      this.autoBackupManager = managers.autoBackupManager;
    }
    if (managers.usageReportGenerator) {
      this.usageReportGenerator = managers.usageReportGenerator;
    }
    if (managers.behaviorTracker) {
      this.behaviorTracker = managers.behaviorTracker;
    }
    if (managers.contextAssociator) {
      this.contextAssociator = managers.contextAssociator;
    }

    console.log("[MemorySyncService] Manager references updated");
  }

  /**
   * 停止服务
   */
  stop() {
    this.stopPeriodicSync();
    console.log("[MemorySyncService] Service stopped");
  }
}

module.exports = {
  MemorySyncService,
};
