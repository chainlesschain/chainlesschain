/**
 * Resource Monitor IPC 处理器
 *
 * 提供系统资源监控的前端访问接口
 * 支持内存、磁盘空间监控和优雅降级策略
 *
 * 功能：
 * - 内存状态监控（系统和进程级别）
 * - 磁盘空间检查
 * - 资源水平评估（normal/warning/critical）
 * - 降级策略管理
 * - 定期监控启停
 *
 * @module resource-monitor-ipc
 */

const { logger } = require("./logger.js");
const defaultIpcGuard = require("../ipc/ipc-guard");
const {
  ResourceMonitor,
  getResourceMonitor,
} = require("./resource-monitor.js");

// 模块级别的实例引用
let resourceMonitorInstance = null;

/**
 * 设置 ResourceMonitor 实例
 * @param {Object} monitor - ResourceMonitor 实例
 */
function setResourceMonitorInstance(monitor) {
  resourceMonitorInstance = monitor;
}

/**
 * 获取 ResourceMonitor 实例
 * @returns {Object|null}
 */
function getResourceMonitorInstance() {
  return resourceMonitorInstance || getResourceMonitor();
}

/**
 * 注册 Resource Monitor IPC 处理器
 * @param {Object} dependencies - 依赖
 * @param {Object} [dependencies.ipcMain] - IPC 主进程对象
 * @param {Object} [dependencies.ipcGuard] - IPC 防重复注册守卫
 * @param {Object} [dependencies.resourceMonitor] - ResourceMonitor 实例
 * @param {Object} [dependencies.mainWindow] - 主窗口（用于发送事件）
 */
function registerResourceMonitorIPC({
  ipcMain: injectedIpcMain,
  ipcGuard: injectedIpcGuard,
  resourceMonitor,
  mainWindow,
} = {}) {
  const ipcGuard = injectedIpcGuard || defaultIpcGuard;

  // 防止重复注册
  if (ipcGuard.isModuleRegistered("resource-monitor-ipc")) {
    logger.info(
      "[Resource Monitor IPC] Handlers already registered, skipping...",
    );
    return;
  }

  const electron = require("electron");
  const ipcMain = injectedIpcMain || electron.ipcMain;

  // 设置实例
  if (resourceMonitor) {
    setResourceMonitorInstance(resourceMonitor);
  }

  logger.info("[Resource Monitor IPC] Registering handlers...");

  // ============================================================
  // 辅助函数
  // ============================================================

  /**
   * 获取 Monitor 实例
   */
  function getMonitor() {
    return getResourceMonitorInstance();
  }

  /**
   * 格式化字节数为可读字符串
   */
  function formatBytes(bytes) {
    if (bytes === 0) {
      return "0 B";
    }
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  }

  // ============================================================
  // 状态查询 (Status) - 4 handlers
  // ============================================================

  /**
   * 获取内存状态
   * Channel: 'resource:get-memory-status'
   *
   * @returns {Object} 内存状态（系统和进程级别）
   */
  ipcMain.handle("resource:get-memory-status", async () => {
    try {
      const monitor = getMonitor();
      const status = monitor.getMemoryStatus();

      return {
        success: true,
        memory: {
          ...status,
          // 添加可读格式
          totalFormatted: formatBytes(status.total),
          freeFormatted: formatBytes(status.free),
          usedFormatted: formatBytes(status.used),
          process: {
            ...status.process,
            heapUsedFormatted: formatBytes(status.process.heapUsed),
            heapTotalFormatted: formatBytes(status.process.heapTotal),
            rssFormatted: formatBytes(status.process.rss),
          },
        },
      };
    } catch (error) {
      logger.error("[Resource Monitor IPC] 获取内存状态失败:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 获取磁盘状态
   * Channel: 'resource:get-disk-status'
   *
   * @param {string} [dirPath] - 目标目录路径（默认: 应用数据目录）
   * @returns {Object} 磁盘状态
   */
  ipcMain.handle("resource:get-disk-status", async (_event, dirPath) => {
    try {
      const monitor = getMonitor();

      // 默认检查应用数据目录
      const targetPath = dirPath || electron.app.getPath("userData");
      const status = await monitor.getDiskStatus(targetPath);

      if (!status) {
        return {
          success: false,
          error: "Failed to get disk status",
        };
      }

      return {
        success: true,
        disk: {
          ...status,
          path: targetPath,
          // 添加可读格式
          totalFormatted: formatBytes(status.total),
          freeFormatted: formatBytes(status.free),
          usedFormatted: formatBytes(status.used),
        },
      };
    } catch (error) {
      logger.error("[Resource Monitor IPC] 获取磁盘状态失败:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 获取当前资源水平
   * Channel: 'resource:get-level'
   *
   * @returns {Object} 资源水平（normal/warning/critical）
   */
  ipcMain.handle("resource:get-level", async () => {
    try {
      const monitor = getMonitor();
      const level = monitor.assessResourceLevel();

      return {
        success: true,
        level,
        currentLevel: monitor.currentLevel,
        thresholds: monitor.thresholds,
      };
    } catch (error) {
      logger.error("[Resource Monitor IPC] 获取资源水平失败:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 获取完整资源报告
   * Channel: 'resource:get-report'
   *
   * @param {string} [dirPath] - 磁盘检查目录
   * @returns {Object} 完整资源报告
   */
  ipcMain.handle("resource:get-report", async (_event, dirPath) => {
    try {
      const monitor = getMonitor();
      const targetPath = dirPath || electron.app.getPath("userData");
      const report = await monitor.getReport(targetPath);

      return {
        success: true,
        report: {
          ...report,
          memory: {
            ...report.memory,
            totalFormatted: formatBytes(report.memory.total),
            freeFormatted: formatBytes(report.memory.free),
            usedFormatted: formatBytes(report.memory.used),
          },
          disk: report.disk
            ? {
                ...report.disk,
                totalFormatted: formatBytes(report.disk.total),
                freeFormatted: formatBytes(report.disk.free),
                usedFormatted: formatBytes(report.disk.used),
              }
            : null,
        },
      };
    } catch (error) {
      logger.error("[Resource Monitor IPC] 获取资源报告失败:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  // ============================================================
  // 降级策略 (Degradation) - 3 handlers
  // ============================================================

  /**
   * 获取降级策略
   * Channel: 'resource:get-strategy'
   *
   * @param {string} category - 策略类别（imageProcessing/ocrProcessing/batchImport）
   * @returns {Object} 当前降级策略
   */
  ipcMain.handle("resource:get-strategy", async (_event, category) => {
    try {
      const monitor = getMonitor();

      if (!category) {
        return {
          success: false,
          error: "category is required",
        };
      }

      const strategy = monitor.getDegradationStrategy(category);

      return {
        success: true,
        category,
        level: monitor.currentLevel,
        strategy,
      };
    } catch (error) {
      logger.error("[Resource Monitor IPC] 获取降级策略失败:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 获取所有降级策略
   * Channel: 'resource:get-all-strategies'
   *
   * @returns {Object} 所有类别的降级策略
   */
  ipcMain.handle("resource:get-all-strategies", async () => {
    try {
      const monitor = getMonitor();

      return {
        success: true,
        level: monitor.currentLevel,
        strategies: {
          imageProcessing: monitor.getDegradationStrategy("imageProcessing"),
          ocrProcessing: monitor.getDegradationStrategy("ocrProcessing"),
          batchImport: monitor.getDegradationStrategy("batchImport"),
        },
        allStrategies: monitor.degradationStrategy,
      };
    } catch (error) {
      logger.error("[Resource Monitor IPC] 获取所有降级策略失败:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 检查磁盘空间是否足够
   * Channel: 'resource:check-disk-space'
   *
   * @param {Object} params - 检查参数
   * @param {string} [params.dirPath] - 目标目录
   * @param {number} params.requiredSpace - 需要的空间（字节）
   * @returns {Object} 检查结果
   */
  ipcMain.handle("resource:check-disk-space", async (_event, params = {}) => {
    try {
      const monitor = getMonitor();

      const { dirPath, requiredSpace } = params;

      if (!requiredSpace || requiredSpace <= 0) {
        return {
          success: false,
          error: "requiredSpace must be a positive number",
        };
      }

      const targetPath = dirPath || electron.app.getPath("userData");
      const result = await monitor.checkDiskSpace(targetPath, requiredSpace);

      return {
        success: true,
        check: {
          ...result,
          path: targetPath,
          requiredFormatted: formatBytes(requiredSpace),
          freeSpaceFormatted: result.freeSpace
            ? formatBytes(result.freeSpace)
            : null,
          deficitFormatted: result.deficit ? formatBytes(result.deficit) : null,
        },
      };
    } catch (error) {
      logger.error("[Resource Monitor IPC] 检查磁盘空间失败:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  // ============================================================
  // 监控控制 (Control) - 4 handlers
  // ============================================================

  /**
   * 启动定期监控
   * Channel: 'resource:start-monitoring'
   *
   * @param {number} [interval] - 监控间隔（毫秒，默认 10000）
   * @returns {Object} 启动结果
   */
  ipcMain.handle(
    "resource:start-monitoring",
    async (_event, interval = 10000) => {
      try {
        const monitor = getMonitor();

        if (monitor.monitoringInterval) {
          return {
            success: true,
            message: "Monitoring is already running",
            interval,
          };
        }

        monitor.startMonitoring(interval);

        // 如果有主窗口，设置事件转发
        if (mainWindow && !mainWindow.isDestroyed()) {
          monitor.removeAllListeners("level-change");
          monitor.on("level-change", (data) => {
            mainWindow.webContents.send("resource:level-changed", data);
          });
        }

        logger.info("[Resource Monitor IPC] 资源监控已启动:", interval, "ms");

        return {
          success: true,
          message: "Monitoring started",
          interval,
        };
      } catch (error) {
        logger.error("[Resource Monitor IPC] 启动监控失败:", error);
        return {
          success: false,
          error: error.message,
        };
      }
    },
  );

  /**
   * 停止定期监控
   * Channel: 'resource:stop-monitoring'
   *
   * @returns {Object} 停止结果
   */
  ipcMain.handle("resource:stop-monitoring", async () => {
    try {
      const monitor = getMonitor();
      monitor.stopMonitoring();

      logger.info("[Resource Monitor IPC] 资源监控已停止");

      return {
        success: true,
        message: "Monitoring stopped",
      };
    } catch (error) {
      logger.error("[Resource Monitor IPC] 停止监控失败:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 强制垃圾回收
   * Channel: 'resource:force-gc'
   *
   * @returns {Object} GC 结果
   */
  ipcMain.handle("resource:force-gc", async () => {
    try {
      const monitor = getMonitor();

      const beforeMemory = monitor.getMemoryStatus();
      const gcExecuted = monitor.forceGarbageCollection();
      const afterMemory = monitor.getMemoryStatus();

      const freedMemory = gcExecuted
        ? beforeMemory.process.heapUsed - afterMemory.process.heapUsed
        : 0;

      return {
        success: true,
        gcExecuted,
        freedMemory,
        freedMemoryFormatted: formatBytes(freedMemory),
        before: {
          heapUsed: beforeMemory.process.heapUsed,
          heapUsedFormatted: formatBytes(beforeMemory.process.heapUsed),
        },
        after: {
          heapUsed: afterMemory.process.heapUsed,
          heapUsedFormatted: formatBytes(afterMemory.process.heapUsed),
        },
        message: gcExecuted
          ? `Garbage collection executed, freed ${formatBytes(freedMemory)}`
          : "Garbage collection not available (start with --expose-gc)",
      };
    } catch (error) {
      logger.error("[Resource Monitor IPC] 强制 GC 失败:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 更新资源水平（手动触发评估）
   * Channel: 'resource:update-level'
   *
   * @returns {Object} 新的资源水平
   */
  ipcMain.handle("resource:update-level", async () => {
    try {
      const monitor = getMonitor();
      const oldLevel = monitor.currentLevel;
      const newLevel = monitor.updateResourceLevel();

      return {
        success: true,
        oldLevel,
        newLevel,
        changed: oldLevel !== newLevel,
      };
    } catch (error) {
      logger.error("[Resource Monitor IPC] 更新资源水平失败:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  // ============================================================
  // 配置 (Config) - 2 handlers
  // ============================================================

  /**
   * 获取阈值配置
   * Channel: 'resource:get-thresholds'
   *
   * @returns {Object} 阈值配置
   */
  ipcMain.handle("resource:get-thresholds", async () => {
    try {
      const monitor = getMonitor();

      return {
        success: true,
        thresholds: {
          ...monitor.thresholds,
          // 添加可读格式
          memoryWarningFormatted: formatBytes(monitor.thresholds.memoryWarning),
          memoryCriticalFormatted: formatBytes(
            monitor.thresholds.memoryCritical,
          ),
          diskWarningFormatted: formatBytes(monitor.thresholds.diskWarning),
          diskCriticalFormatted: formatBytes(monitor.thresholds.diskCritical),
        },
      };
    } catch (error) {
      logger.error("[Resource Monitor IPC] 获取阈值配置失败:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 设置阈值配置
   * Channel: 'resource:set-thresholds'
   *
   * @param {Object} thresholds - 新的阈值配置
   * @returns {Object} 更新结果
   */
  ipcMain.handle("resource:set-thresholds", async (_event, thresholds = {}) => {
    try {
      const monitor = getMonitor();

      // 更新阈值
      if (thresholds.memoryWarning !== undefined) {
        monitor.thresholds.memoryWarning = thresholds.memoryWarning;
      }
      if (thresholds.memoryCritical !== undefined) {
        monitor.thresholds.memoryCritical = thresholds.memoryCritical;
      }
      if (thresholds.diskWarning !== undefined) {
        monitor.thresholds.diskWarning = thresholds.diskWarning;
      }
      if (thresholds.diskCritical !== undefined) {
        monitor.thresholds.diskCritical = thresholds.diskCritical;
      }
      if (thresholds.memoryUsageWarning !== undefined) {
        monitor.thresholds.memoryUsageWarning = thresholds.memoryUsageWarning;
      }
      if (thresholds.memoryUsageCritical !== undefined) {
        monitor.thresholds.memoryUsageCritical = thresholds.memoryUsageCritical;
      }

      logger.info("[Resource Monitor IPC] 阈值配置已更新:", thresholds);

      return {
        success: true,
        message: "Thresholds updated",
        thresholds: monitor.thresholds,
      };
    } catch (error) {
      logger.error("[Resource Monitor IPC] 设置阈值配置失败:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  // 标记模块为已注册
  ipcGuard.markModuleRegistered("resource-monitor-ipc");

  logger.info(
    "[Resource Monitor IPC] ✓ All handlers registered (13 handlers: 4 status + 3 degradation + 4 control + 2 config)",
  );
}

/**
 * 注销 Resource Monitor IPC 处理器
 * @param {Object} [dependencies] - 依赖
 */
function unregisterResourceMonitorIPC({
  ipcMain: injectedIpcMain,
  ipcGuard: injectedIpcGuard,
} = {}) {
  const ipcGuard = injectedIpcGuard || defaultIpcGuard;

  if (!ipcGuard.isModuleRegistered("resource-monitor-ipc")) {
    return;
  }

  const electron = require("electron");
  const ipcMain = injectedIpcMain || electron.ipcMain;

  // 所有 channel 名称
  const channels = [
    // Status
    "resource:get-memory-status",
    "resource:get-disk-status",
    "resource:get-level",
    "resource:get-report",
    // Degradation
    "resource:get-strategy",
    "resource:get-all-strategies",
    "resource:check-disk-space",
    // Control
    "resource:start-monitoring",
    "resource:stop-monitoring",
    "resource:force-gc",
    "resource:update-level",
    // Config
    "resource:get-thresholds",
    "resource:set-thresholds",
  ];

  for (const channel of channels) {
    ipcMain.removeHandler(channel);
  }

  // 停止监控
  const monitor = getResourceMonitorInstance();
  if (monitor) {
    monitor.stopMonitoring();
    monitor.removeAllListeners("level-change");
  }

  ipcGuard.unmarkModuleRegistered("resource-monitor-ipc");
  logger.info("[Resource Monitor IPC] Handlers unregistered");
}

module.exports = {
  registerResourceMonitorIPC,
  unregisterResourceMonitorIPC,
  setResourceMonitorInstance,
  getResourceMonitorInstance,
};
