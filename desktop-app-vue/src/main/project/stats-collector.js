/**
 * 项目统计收集器
 * 功能：实时收集项目统计数据
 */
const { logger, createLogger } = require('../utils/logger.js');
const chokidar = require("chokidar");
const fs = require("fs-extra");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

class ProjectStatsCollector {
  constructor(db) {
    this.db = db;
    this.watchers = new Map(); // projectId -> watcher
    this.updateQueue = new Map(); // projectId -> timeout
    this.debounceDelay = 3000; // 3秒防抖
  }

  /**
   * 启动项目监听
   */
  startWatching(projectId, projectPath) {
    // 如果已经在监听，先停止
    if (this.watchers.has(projectId)) {
      this.stopWatching(projectId);
    }

    logger.info(
      `[StatsCollector] 开始监听项目: ${projectId} at ${projectPath}`,
    );

    const watcher = chokidar.watch(projectPath, {
      ignored: [
        /(^|[/\\])\./, // 隐藏文件
        /node_modules/,
        /dist/,
        /build/,
        /\.git/,
      ],
      persistent: true,
      ignoreInitial: false,
      awaitWriteFinish: {
        stabilityThreshold: 2000,
        pollInterval: 100,
      },
    });

    watcher
      .on("add", (filePath) =>
        this.scheduleUpdate(projectId, "file_added", filePath),
      )
      .on("change", (filePath) =>
        this.scheduleUpdate(projectId, "file_changed", filePath),
      )
      .on("unlink", (filePath) =>
        this.scheduleUpdate(projectId, "file_deleted", filePath),
      )
      .on("error", (error) =>
        logger.error(`[StatsCollector] 监听错误:`, error),
      );

    this.watchers.set(projectId, watcher);

    // 初始统计
    this.scheduleUpdate(projectId, "initial", projectPath);
  }

  /**
   * 调度更新（防抖）
   */
  scheduleUpdate(projectId, event, filePath) {
    // 清除之前的定时器
    if (this.updateQueue.has(projectId)) {
      clearTimeout(this.updateQueue.get(projectId));
    }

    // 设置新的定时器
    const timeout = setTimeout(() => {
      this.updateStats(projectId, event, filePath);
      this.updateQueue.delete(projectId);
    }, this.debounceDelay);

    this.updateQueue.set(projectId, timeout);
  }

  /**
   * 更新统计数据
   */
  async updateStats(projectId, event, filePath) {
    try {
      logger.info(`[StatsCollector] 更新统计: ${projectId}, 事件: ${event}`);

      const stats = await this.calculateStats(projectId);

      if (!stats) {
        logger.warn(`[StatsCollector] 无法计算统计数据: ${projectId}`);
        return;
      }

      // 更新project_stats表 (使用 UPSERT 保留 created_at)
      const now = Date.now();
      const stmt = this.db.prepare(`
        INSERT INTO project_stats (
          project_id, file_count, total_size_kb,
          code_lines, comment_lines, blank_lines,
          contributor_count, last_updated_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(project_id) DO UPDATE SET
          file_count = excluded.file_count,
          total_size_kb = excluded.total_size_kb,
          code_lines = excluded.code_lines,
          comment_lines = excluded.comment_lines,
          blank_lines = excluded.blank_lines,
          contributor_count = excluded.contributor_count,
          last_updated_at = excluded.last_updated_at,
          updated_at = excluded.updated_at
      `);

      stmt.run(
        projectId,
        stats.fileCount,
        Math.round(stats.totalSizeKB * 100) / 100, // 保留2位小数
        stats.codeLines,
        stats.commentLines,
        stats.blankLines,
        stats.contributorCount || 1,
        now,
        now,
        now,
      );

      // 记录日志（仅记录重要事件）
      if (
        event === "initial" ||
        event === "file_added" ||
        event === "file_deleted"
      ) {
        const logStmt = this.db.prepare(`
          INSERT INTO project_logs (
            id, project_id, log_level, category, message, details, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `);

        logStmt.run(
          uuidv4(),
          projectId,
          "info",
          "stats",
          `Stats event: ${event}`,
          JSON.stringify({
            filePath,
            fileCount: stats.fileCount,
            codeLines: stats.codeLines,
          }),
          Date.now(),
        );
      }

      logger.info(`[StatsCollector] 统计更新完成:`, stats);
    } catch (error) {
      logger.error(`[StatsCollector] 统计更新失败:`, error);
    }
  }

  /**
   * 计算项目统计数据
   */
  async calculateStats(projectId) {
    try {
      const project = this.db
        .prepare("SELECT root_path FROM projects WHERE id = ?")
        .get(projectId);

      if (!project || !project.root_path) {
        logger.warn(`[StatsCollector] 项目不存在或无路径: ${projectId}`);
        return null;
      }

      const projectPath = project.root_path;

      // 检查路径是否存在
      if (!(await fs.pathExists(projectPath))) {
        logger.warn(`[StatsCollector] 项目路径不存在: ${projectPath}`);
        return null;
      }

      const stats = {
        fileCount: 0,
        totalSizeKB: 0,
        codeLines: 0,
        commentLines: 0,
        blankLines: 0,
        contributorCount: 1,
        fileTypes: {}, // 统计文件类型
      };

      // 递归遍历文件
      const files = await this.getAllFiles(projectPath);

      for (const file of files) {
        try {
          const fileStats = await fs.stat(file);
          stats.fileCount++;
          stats.totalSizeKB += fileStats.size / 1024;

          // 统计文件类型
          const ext = path.extname(file).toLowerCase();
          stats.fileTypes[ext] = (stats.fileTypes[ext] || 0) + 1;

          // 分析代码行数（仅对代码文件，且文件小于1MB）
          if (this.isCodeFile(file) && fileStats.size < 1024 * 1024) {
            const lineStats = await this.analyzeCodeLines(file);
            stats.codeLines += lineStats.code;
            stats.commentLines += lineStats.comment;
            stats.blankLines += lineStats.blank;
          }
        } catch (error) {
          logger.warn(`[StatsCollector] 处理文件失败: ${file}`, error.message);
        }
      }

      return stats;
    } catch (error) {
      logger.error(`[StatsCollector] 计算统计失败:`, error);
      return null;
    }
  }

  /**
   * 获取所有文件
   */
  async getAllFiles(dir, files = []) {
    try {
      const items = await fs.readdir(dir);

      for (const item of items) {
        const fullPath = path.join(dir, item);

        try {
          const stat = await fs.stat(fullPath);

          if (stat.isDirectory()) {
            // 跳过特定目录
            if (
              !item.startsWith(".") &&
              item !== "node_modules" &&
              item !== "dist" &&
              item !== "build" &&
              item !== "__pycache__"
            ) {
              await this.getAllFiles(fullPath, files);
            }
          } else if (stat.isFile()) {
            files.push(fullPath);
          }
        } catch (error) {
          // 跳过无法访问的文件
          logger.warn(`[StatsCollector] 跳过文件: ${fullPath}`);
        }
      }
    } catch (error) {
      logger.warn(`[StatsCollector] 读取目录失败: ${dir}`, error.message);
    }

    return files;
  }

  /**
   * 分析代码行数
   */
  async analyzeCodeLines(filePath) {
    try {
      const content = await fs.readFile(filePath, "utf-8");
      const lines = content.split("\n");

      const stats = { code: 0, comment: 0, blank: 0 };
      let inBlockComment = false;
      const ext = path.extname(filePath).toLowerCase();

      for (const line of lines) {
        const trimmed = line.trim();

        if (trimmed === "") {
          stats.blank++;
        } else if (this.isCommentLine(trimmed, ext, inBlockComment)) {
          stats.comment++;
          // 检查块注释状态
          if (
            ext === ".js" ||
            ext === ".ts" ||
            ext === ".vue" ||
            ext === ".css" ||
            ext === ".java" ||
            ext === ".c" ||
            ext === ".cpp"
          ) {
            if (trimmed.includes("/*")) {inBlockComment = true;}
            if (trimmed.includes("*/")) {inBlockComment = false;}
          }
        } else {
          stats.code++;
        }
      }

      return stats;
    } catch (error) {
      // 非文本文件或读取失败
      return { code: 0, comment: 0, blank: 0 };
    }
  }

  /**
   * 判断是否为注释行
   */
  isCommentLine(trimmed, ext, inBlockComment) {
    if (inBlockComment) {return true;}

    // JavaScript/TypeScript/Vue/Java/C/C++
    if (
      [".js", ".ts", ".vue", ".java", ".c", ".cpp", ".go", ".rs"].includes(ext)
    ) {
      return (
        trimmed.startsWith("//") ||
        trimmed.startsWith("/*") ||
        trimmed.startsWith("*")
      );
    }

    // Python
    if (ext === ".py") {
      return (
        trimmed.startsWith("#") ||
        trimmed.startsWith('"""') ||
        trimmed.startsWith("'''")
      );
    }

    // HTML/XML
    if ([".html", ".xml", ".svg"].includes(ext)) {
      return trimmed.startsWith("<!--");
    }

    // CSS
    if ([".css", ".scss", ".less"].includes(ext)) {
      return trimmed.startsWith("/*");
    }

    return false;
  }

  /**
   * 判断是否为代码文件
   */
  isCodeFile(filePath) {
    const codeExtensions = [
      ".js",
      ".ts",
      ".jsx",
      ".tsx",
      ".vue",
      ".py",
      ".java",
      ".go",
      ".rs",
      ".c",
      ".cpp",
      ".h",
      ".hpp",
      ".html",
      ".css",
      ".scss",
      ".less",
      ".sass",
      ".json",
      ".md",
      ".yaml",
      ".yml",
      ".toml",
      ".sh",
      ".bash",
      ".sql",
    ];

    const ext = path.extname(filePath).toLowerCase();
    return codeExtensions.includes(ext);
  }

  /**
   * 停止监听
   */
  stopWatching(projectId) {
    // 清除定时器
    if (this.updateQueue.has(projectId)) {
      clearTimeout(this.updateQueue.get(projectId));
      this.updateQueue.delete(projectId);
    }

    // 关闭watcher
    const watcher = this.watchers.get(projectId);
    if (watcher) {
      watcher.close();
      this.watchers.delete(projectId);
      logger.info(`[StatsCollector] 停止监听项目: ${projectId}`);
    }
  }

  /**
   * 停止所有监听
   */
  stopAll() {
    for (const projectId of this.watchers.keys()) {
      this.stopWatching(projectId);
    }
  }

  /**
   * 获取项目统计数据
   */
  getStats(projectId) {
    try {
      const stats = this.db
        .prepare(
          `
        SELECT * FROM project_stats WHERE project_id = ?
      `,
        )
        .get(projectId);

      return (
        stats || {
          file_count: 0,
          total_size_kb: 0,
          code_lines: 0,
          comment_lines: 0,
          blank_lines: 0,
          contributor_count: 0,
        }
      );
    } catch (error) {
      logger.error(`[StatsCollector] 获取统计失败:`, error);
      return null;
    }
  }
}

// 单例模式
let statsCollectorInstance = null;

/**
 * 获取统计收集器单例
 * @param {Object} db - 数据库实例（首次调用时需要）
 * @returns {ProjectStatsCollector}
 */
function getStatsCollector(db) {
  if (!statsCollectorInstance && db) {
    statsCollectorInstance = new ProjectStatsCollector(db);
  }
  return statsCollectorInstance;
}

module.exports = {
  ProjectStatsCollector,
  getStatsCollector,
};
