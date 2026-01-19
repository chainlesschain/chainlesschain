/**
 * 资源监控工具
 * 提供内存、磁盘空间监控和优雅降级策略
 */

const { logger, createLogger } = require('./logger.js');
const os = require("os");
const fs = require("fs").promises;
const path = require("path");
const { EventEmitter } = require("events");

class ResourceMonitor extends EventEmitter {
  constructor(options = {}) {
    super();

    // 配置阈值
    this.thresholds = {
      // 内存阈值（可用内存低于此值时触发警告）
      memoryWarning: options.memoryWarning || 500 * 1024 * 1024, // 500MB
      memoryCritical: options.memoryCritical || 200 * 1024 * 1024, // 200MB

      // 磁盘空间阈值
      diskWarning: options.diskWarning || 1024 * 1024 * 1024, // 1GB
      diskCritical: options.diskCritical || 500 * 1024 * 1024, // 500MB

      // 内存使用率阈值（百分比）
      memoryUsageWarning: options.memoryUsageWarning || 85, // 85%
      memoryUsageCritical: options.memoryUsageCritical || 95, // 95%
    };

    // 降级策略配置
    this.degradationStrategy = {
      // 图片处理降级策略
      imageProcessing: {
        normal: { maxDimension: 1920, quality: 85, concurrent: 3 },
        warning: { maxDimension: 1280, quality: 75, concurrent: 2 },
        critical: { maxDimension: 800, quality: 60, concurrent: 1 },
      },

      // OCR处理降级策略
      ocrProcessing: {
        normal: { concurrent: 3, language: "chi_sim+eng" },
        warning: { concurrent: 2, language: "chi_sim+eng" },
        critical: { concurrent: 1, language: "eng" }, // 只使用英文，减少内存
      },

      // 批量导入降级策略
      batchImport: {
        normal: { batchSize: 10, concurrent: 3 },
        warning: { batchSize: 5, concurrent: 2 },
        critical: { batchSize: 1, concurrent: 1 },
      },
    };

    this.currentLevel = "normal";
    this.monitoringInterval = null;
  }

  /**
   * 获取当前内存状态
   */
  getMemoryStatus() {
    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();
    const usedMemory = totalMemory - freeMemory;
    const usagePercentage = (usedMemory / totalMemory) * 100;

    // 获取当前进程内存使用
    const processMemory = process.memoryUsage();

    return {
      total: totalMemory,
      free: freeMemory,
      used: usedMemory,
      usagePercentage: Math.round(usagePercentage * 100) / 100,
      process: {
        heapUsed: processMemory.heapUsed,
        heapTotal: processMemory.heapTotal,
        rss: processMemory.rss,
        external: processMemory.external,
      },
    };
  }

  /**
   * 获取磁盘空间状态
   * @param {string} dirPath - 要检查的目录路径
   */
  async getDiskStatus(dirPath) {
    try {
      // 不同平台获取磁盘空间的方法
      if (process.platform === "win32") {
        return await this._getWindowsDiskSpace(dirPath);
      } else {
        return await this._getUnixDiskSpace(dirPath);
      }
    } catch (error) {
      logger.error("获取磁盘空间失败:", error);
      return null;
    }
  }

  /**
   * Windows 平台磁盘空间检查
   */
  async _getWindowsDiskSpace(dirPath) {
    const { spawnSync } = require("child_process");
    try {
      const drive = path.parse(dirPath).root;
      // 验证驱动器格式 (如 "C:" 或 "D:")
      const driveMatch = drive.match(/^([A-Za-z]:)/);
      if (!driveMatch) {
        logger.error("Invalid drive format:", drive);
        return null;
      }
      const deviceId = driveMatch[1];

      // 使用 spawnSync 替代 execSync 避免命令注入
      const result = spawnSync(
        "wmic",
        [
          "logicaldisk",
          "where",
          `DeviceID='${deviceId}'`,
          "get",
          "Size,FreeSpace",
        ],
        { encoding: "utf8", windowsHide: true },
      );

      const output = result.stdout || "";

      const lines = output
        .trim()
        .split("\n")
        .filter((line) => line.trim());
      if (lines.length >= 2) {
        const values = lines[1].trim().split(/\s+/);
        const freeSpace = parseInt(values[0]);
        const totalSpace = parseInt(values[1]);

        return {
          total: totalSpace,
          free: freeSpace,
          used: totalSpace - freeSpace,
          usagePercentage:
            Math.round(((totalSpace - freeSpace) / totalSpace) * 10000) / 100,
        };
      }
    } catch (error) {
      logger.error("Windows 磁盘空间检查失败:", error);
    }
    return null;
  }

  /**
   * Unix/Linux/macOS 平台磁盘空间检查
   */
  async _getUnixDiskSpace(dirPath) {
    const { spawnSync } = require("child_process");
    try {
      // 使用 spawnSync 替代 execSync 避免命令注入
      const result = spawnSync("df", ["-k", dirPath], { encoding: "utf8" });
      const output = result.stdout || "";
      const lines = output.trim().split("\n");

      if (lines.length >= 2) {
        const values = lines[1].trim().split(/\s+/);
        const totalSpace = parseInt(values[1]) * 1024; // KB to bytes
        const usedSpace = parseInt(values[2]) * 1024;
        const freeSpace = parseInt(values[3]) * 1024;

        return {
          total: totalSpace,
          free: freeSpace,
          used: usedSpace,
          usagePercentage: Math.round((usedSpace / totalSpace) * 10000) / 100,
        };
      }
    } catch (error) {
      logger.error("Unix 磁盘空间检查失败:", error);
    }
    return null;
  }

  /**
   * 评估当前资源水平
   */
  assessResourceLevel() {
    const memStatus = this.getMemoryStatus();

    // 检查可用内存
    if (
      memStatus.free < this.thresholds.memoryCritical ||
      memStatus.usagePercentage > this.thresholds.memoryUsageCritical
    ) {
      return "critical";
    }

    if (
      memStatus.free < this.thresholds.memoryWarning ||
      memStatus.usagePercentage > this.thresholds.memoryUsageWarning
    ) {
      return "warning";
    }

    return "normal";
  }

  /**
   * 更新资源水平并触发事件
   */
  updateResourceLevel() {
    const newLevel = this.assessResourceLevel();

    if (newLevel !== this.currentLevel) {
      const oldLevel = this.currentLevel;
      this.currentLevel = newLevel;

      this.emit("level-change", {
        oldLevel,
        newLevel,
        memoryStatus: this.getMemoryStatus(),
        timestamp: Date.now(),
      });

      logger.info(`资源水平变化: ${oldLevel} -> ${newLevel}`);
    }

    return this.currentLevel;
  }

  /**
   * 获取当前降级策略
   * @param {string} category - 策略类别（imageProcessing, ocrProcessing, batchImport）
   */
  getDegradationStrategy(category) {
    const strategies = this.degradationStrategy[category];
    if (!strategies) {
      throw new Error(`未知的策略类别: ${category}`);
    }

    return strategies[this.currentLevel];
  }

  /**
   * 检查是否有足够的磁盘空间
   * @param {string} dirPath - 目标目录
   * @param {number} requiredSpace - 需要的空间（字节）
   */
  async checkDiskSpace(dirPath, requiredSpace) {
    const diskStatus = await this.getDiskStatus(dirPath);

    if (!diskStatus) {
      // 无法获取磁盘状态，假设有足够空间
      return {
        available: true,
        warning: false,
        critical: false,
      };
    }

    const available = diskStatus.free >= requiredSpace;
    const warning = diskStatus.free < this.thresholds.diskWarning;
    const critical = diskStatus.free < this.thresholds.diskCritical;

    return {
      available,
      warning,
      critical,
      freeSpace: diskStatus.free,
      requiredSpace,
      deficit: available ? 0 : requiredSpace - diskStatus.free,
    };
  }

  /**
   * 强制垃圾回收（如果可用）
   */
  forceGarbageCollection() {
    if (global.gc) {
      logger.info("执行垃圾回收...");
      global.gc();
      return true;
    } else {
      logger.warn("垃圾回收不可用。启动时使用 --expose-gc 标志启用。");
      return false;
    }
  }

  /**
   * 启动定期监控
   * @param {number} interval - 监控间隔（毫秒）
   */
  startMonitoring(interval = 10000) {
    if (this.monitoringInterval) {
      return; // 已在监控中
    }

    logger.info(`启动资源监控，间隔: ${interval}ms`);

    this.monitoringInterval = setInterval(() => {
      this.updateResourceLevel();
    }, interval);

    // 立即执行一次评估
    this.updateResourceLevel();
  }

  /**
   * 停止定期监控
   */
  stopMonitoring() {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
      logger.info("停止资源监控");
    }
  }

  /**
   * 获取资源报告
   */
  async getReport(dirPath) {
    const memStatus = this.getMemoryStatus();
    const diskStatus = await this.getDiskStatus(dirPath);

    return {
      timestamp: Date.now(),
      level: this.currentLevel,
      memory: memStatus,
      disk: diskStatus,
      strategies: {
        imageProcessing: this.getDegradationStrategy("imageProcessing"),
        ocrProcessing: this.getDegradationStrategy("ocrProcessing"),
        batchImport: this.getDegradationStrategy("batchImport"),
      },
    };
  }
}

/**
 * 单例实例
 */
let globalMonitor = null;

/**
 * 获取全局资源监控器实例
 */
function getResourceMonitor(options) {
  if (!globalMonitor) {
    globalMonitor = new ResourceMonitor(options);
  }
  return globalMonitor;
}

module.exports = {
  ResourceMonitor,
  getResourceMonitor,
};
