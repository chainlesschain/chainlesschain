/**
 * 数据备份恢复管理器
 * 提供数据库和配置文件的备份与恢复功能
 */

const { logger, createLogger } = require('../utils/logger.js');
const { app, dialog } = require("electron");
const fs = require("fs");
const path = require("path");
const archiver = require("archiver");
const extract = require("extract-zip");

class BackupManager {
  constructor() {
    this.userDataPath = app.getPath("userData");
    this.backupDir = path.join(this.userDataPath, "backups");
    this.maxBackups = 10; // 最多保留10个备份

    // 确保备份目录存在
    this.ensureBackupDir();
  }

  /**
   * 确保备份目录存在
   */
  ensureBackupDir() {
    if (!fs.existsSync(this.backupDir)) {
      fs.mkdirSync(this.backupDir, { recursive: true });
    }
  }

  /**
   * 创建备份
   */
  async createBackup(options = {}) {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const backupName = options.name || `backup-${timestamp}`;
      const backupPath = path.join(this.backupDir, `${backupName}.zip`);

      logger.info("[BackupManager] Creating backup:", backupPath);

      // 要备份的文件和目录
      const itemsToBackup = [
        {
          path: path.join(this.userDataPath, "chainlesschain.db"),
          name: "database/chainlesschain.db",
        },
        {
          path: path.join(this.userDataPath, "config.json"),
          name: "config.json",
        },
        {
          path: path.join(this.userDataPath, "window-states.json"),
          name: "window-states.json",
        },
        {
          path: path.join(this.userDataPath, "settings"),
          name: "settings",
          isDir: true,
        },
        {
          path: path.join(this.userDataPath, "plugins"),
          name: "plugins",
          isDir: true,
        },
      ];

      await this.createZipArchive(backupPath, itemsToBackup);

      // 清理旧备份
      await this.cleanOldBackups();

      logger.info("[BackupManager] Backup created successfully");

      return {
        success: true,
        path: backupPath,
        name: backupName,
        size: fs.statSync(backupPath).size,
        timestamp: Date.now(),
      };
    } catch (error) {
      logger.error("[BackupManager] Create backup error:", error);
      throw error;
    }
  }

  /**
   * 创建ZIP压缩包
   */
  createZipArchive(outputPath, items) {
    return new Promise((resolve, reject) => {
      const output = fs.createWriteStream(outputPath);
      const archive = archiver("zip", {
        zlib: { level: 9 }, // 最高压缩级别
      });

      output.on("close", () => {
        logger.info(
          `[BackupManager] Archive created: ${archive.pointer()} bytes`,
        );
        resolve();
      });

      archive.on("error", (err) => {
        reject(err);
      });

      archive.pipe(output);

      // 添加文件和目录
      for (const item of items) {
        if (!fs.existsSync(item.path)) {
          logger.info(`[BackupManager] Skipping non-existent: ${item.path}`);
          continue;
        }

        if (item.isDir) {
          archive.directory(item.path, item.name);
        } else {
          archive.file(item.path, { name: item.name });
        }
      }

      // 添加元数据
      const metadata = {
        version: app.getVersion(),
        platform: process.platform,
        arch: process.arch,
        timestamp: new Date().toISOString(),
        appName: app.getName(),
      };

      archive.append(JSON.stringify(metadata, null, 2), {
        name: "metadata.json",
      });

      archive.finalize();
    });
  }

  /**
   * 恢复备份
   */
  async restoreBackup(backupPath, options = {}) {
    try {
      logger.info("[BackupManager] Restoring backup:", backupPath);

      if (!fs.existsSync(backupPath)) {
        throw new Error("备份文件不存在");
      }

      // 创建临时目录
      const tempDir = path.join(this.userDataPath, "temp-restore");
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
      fs.mkdirSync(tempDir, { recursive: true });

      // 解压备份文件
      await extract(backupPath, { dir: tempDir });

      // 读取元数据
      const metadataPath = path.join(tempDir, "metadata.json");
      let metadata = null;
      if (fs.existsSync(metadataPath)) {
        metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
        logger.info("[BackupManager] Backup metadata:", metadata);
      }

      // 验证备份兼容性
      if (metadata && !options.force) {
        if (metadata.platform !== process.platform) {
          throw new Error(`备份来自不同的平台: ${metadata.platform}`);
        }
      }

      // 创建当前数据的备份（以防恢复失败）
      const safetyBackup = await this.createBackup({
        name: "safety-backup-before-restore",
      });
      logger.info("[BackupManager] Safety backup created:", safetyBackup.path);

      try {
        // 恢复文件
        const itemsToRestore = [
          { from: "database/chainlesschain.db", to: "chainlesschain.db" },
          { from: "config.json", to: "config.json" },
          { from: "window-states.json", to: "window-states.json" },
          { from: "settings", to: "settings", isDir: true },
          { from: "plugins", to: "plugins", isDir: true },
        ];

        for (const item of itemsToRestore) {
          const sourcePath = path.join(tempDir, item.from);
          const targetPath = path.join(this.userDataPath, item.to);

          if (!fs.existsSync(sourcePath)) {
            logger.info(`[BackupManager] Skipping non-existent: ${item.from}`);
            continue;
          }

          // 删除目标文件/目录
          if (fs.existsSync(targetPath)) {
            if (item.isDir) {
              fs.rmSync(targetPath, { recursive: true, force: true });
            } else {
              fs.unlinkSync(targetPath);
            }
          }

          // 复制文件/目录
          if (item.isDir) {
            this.copyDir(sourcePath, targetPath);
          } else {
            fs.copyFileSync(sourcePath, targetPath);
          }

          logger.info(`[BackupManager] Restored: ${item.from}`);
        }

        // 清理临时目录
        fs.rmSync(tempDir, { recursive: true, force: true });

        logger.info("[BackupManager] Backup restored successfully");

        return {
          success: true,
          metadata,
          safetyBackup: safetyBackup.path,
        };
      } catch (error) {
        // 恢复失败，尝试回滚到安全备份
        logger.error("[BackupManager] Restore failed, rolling back:", error);

        try {
          await this.restoreBackup(safetyBackup.path, { force: true });
          logger.info("[BackupManager] Rolled back to safety backup");
        } catch (rollbackError) {
          logger.error("[BackupManager] Rollback failed:", rollbackError);
        }

        throw error;
      }
    } catch (error) {
      logger.error("[BackupManager] Restore backup error:", error);
      throw error;
    }
  }

  /**
   * 复制目录
   */
  copyDir(src, dest) {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }

    const entries = fs.readdirSync(src, { withFileTypes: true });

    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);

      if (entry.isDirectory()) {
        this.copyDir(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }

  /**
   * 获取备份列表
   */
  getBackupList() {
    try {
      const files = fs.readdirSync(this.backupDir);
      const backups = [];

      for (const file of files) {
        if (!file.endsWith(".zip")) {continue;}

        const filePath = path.join(this.backupDir, file);
        const stats = fs.statSync(filePath);

        backups.push({
          name: file.replace(".zip", ""),
          path: filePath,
          size: stats.size,
          created: stats.birthtime.getTime(),
          modified: stats.mtime.getTime(),
        });
      }

      // 按创建时间降序排序
      backups.sort((a, b) => b.created - a.created);

      return backups;
    } catch (error) {
      logger.error("[BackupManager] Get backup list error:", error);
      return [];
    }
  }

  /**
   * 删除备份
   */
  deleteBackup(backupPath) {
    try {
      if (fs.existsSync(backupPath)) {
        fs.unlinkSync(backupPath);
        logger.info("[BackupManager] Backup deleted:", backupPath);
        return true;
      }
      return false;
    } catch (error) {
      logger.error("[BackupManager] Delete backup error:", error);
      throw error;
    }
  }

  /**
   * 清理旧备份
   */
  async cleanOldBackups() {
    try {
      const backups = this.getBackupList();

      if (backups.length > this.maxBackups) {
        const toDelete = backups.slice(this.maxBackups);

        for (const backup of toDelete) {
          this.deleteBackup(backup.path);
          logger.info("[BackupManager] Cleaned old backup:", backup.name);
        }
      }
    } catch (error) {
      logger.error("[BackupManager] Clean old backups error:", error);
    }
  }

  /**
   * 导出备份到指定位置
   */
  async exportBackup(backupPath, targetPath) {
    try {
      if (!fs.existsSync(backupPath)) {
        throw new Error("备份文件不存在");
      }

      fs.copyFileSync(backupPath, targetPath);
      logger.info("[BackupManager] Backup exported to:", targetPath);

      return true;
    } catch (error) {
      logger.error("[BackupManager] Export backup error:", error);
      throw error;
    }
  }

  /**
   * 导入备份
   */
  async importBackup(sourcePath) {
    try {
      if (!fs.existsSync(sourcePath)) {
        throw new Error("源文件不存在");
      }

      const fileName = path.basename(sourcePath);
      const targetPath = path.join(this.backupDir, fileName);

      fs.copyFileSync(sourcePath, targetPath);
      logger.info("[BackupManager] Backup imported:", targetPath);

      return {
        success: true,
        path: targetPath,
        name: fileName.replace(".zip", ""),
      };
    } catch (error) {
      logger.error("[BackupManager] Import backup error:", error);
      throw error;
    }
  }

  /**
   * 自动备份
   */
  async autoBackup() {
    try {
      const result = await this.createBackup({
        name: `auto-backup-${Date.now()}`,
      });
      logger.info("[BackupManager] Auto backup completed:", result.name);
      return result;
    } catch (error) {
      logger.error("[BackupManager] Auto backup error:", error);
      return null;
    }
  }

  /**
   * 启动自动备份
   */
  startAutoBackup(interval = 24 * 60 * 60 * 1000) {
    // 每24小时自动备份一次
    setInterval(() => {
      this.autoBackup();
    }, interval);

    logger.info("[BackupManager] Auto backup started, interval:", interval);
  }
}

// 创建单例
let backupManager = null;

function getBackupManager() {
  if (!backupManager) {
    backupManager = new BackupManager();
  }
  return backupManager;
}

module.exports = { BackupManager, getBackupManager };
