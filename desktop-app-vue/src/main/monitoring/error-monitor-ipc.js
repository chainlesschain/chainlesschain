/**
 * ErrorMonitor IPC 处理器
 * 负责处理错误监控和 AI 诊断相关的前后端通信
 *
 * @module error-monitor-ipc
 * @version 1.0.0
 * @since 2026-01-16
 */

const { logger, createLogger } = require('../utils/logger.js');
const ipcGuard = require("../ipc/ipc-guard");

/**
 * 注册所有 ErrorMonitor IPC 处理器
 * @param {Object} dependencies - 依赖对象
 * @param {Object} dependencies.errorMonitor - ErrorMonitor 实例
 * @param {Object} [dependencies.ipcMain] - IPC 主进程对象（可选，用于测试注入）
 */
function registerErrorMonitorIPC({ errorMonitor, ipcMain: injectedIpcMain }) {
  // 防止重复注册
  if (ipcGuard.isModuleRegistered("error-monitor-ipc")) {
    logger.info("[ErrorMonitor IPC] Handlers already registered, skipping...");
    return;
  }

  // 支持依赖注入，用于测试
  const electron = require("electron");
  const ipcMain = injectedIpcMain || electron.ipcMain;

  logger.info("[ErrorMonitor IPC] Registering ErrorMonitor IPC handlers...");

  // 创建可变的引用容器
  const monitorRef = { current: errorMonitor };

  // ============================================================
  // 错误分析和诊断
  // ============================================================

  /**
   * 分析错误并提供 AI 诊断
   * Channel: 'error:analyze'
   */
  ipcMain.handle("error:analyze", async (_event, error) => {
    try {
      if (!monitorRef.current) {
        throw new Error("ErrorMonitor 未初始化");
      }

      return await monitorRef.current.analyzeError(error);
    } catch (error) {
      logger.error("[ErrorMonitor IPC] 分析错误失败:", error);
      throw error;
    }
  });

  /**
   * 生成错误诊断报告（Markdown 格式）
   * Channel: 'error:get-diagnosis-report'
   */
  ipcMain.handle("error:get-diagnosis-report", async (_event, analysisId) => {
    try {
      if (!monitorRef.current) {
        throw new Error("ErrorMonitor 未初始化");
      }

      // 从数据库获取分析结果
      const analysis = await monitorRef.current.getAnalysisById(analysisId);
      if (!analysis) {
        throw new Error(`分析记录未找到: ${analysisId}`);
      }

      return monitorRef.current.generateDiagnosisReport(analysis);
    } catch (error) {
      logger.error("[ErrorMonitor IPC] 生成诊断报告失败:", error);
      throw error;
    }
  });

  /**
   * 获取错误统计信息
   * Channel: 'error:get-stats'
   */
  ipcMain.handle("error:get-stats", async (_event, options = {}) => {
    try {
      if (!monitorRef.current) {
        throw new Error("ErrorMonitor 未初始化");
      }

      return await monitorRef.current.getErrorStats(options);
    } catch (error) {
      logger.error("[ErrorMonitor IPC] 获取错误统计失败:", error);
      throw error;
    }
  });

  /**
   * 查找相关错误
   * Channel: 'error:get-related-issues'
   */
  ipcMain.handle(
    "error:get-related-issues",
    async (_event, error, limit = 5) => {
      try {
        if (!monitorRef.current) {
          throw new Error("ErrorMonitor 未初始化");
        }

        return await monitorRef.current.findRelatedIssues(error, limit);
      } catch (error) {
        logger.error("[ErrorMonitor IPC] 查找相关错误失败:", error);
        throw error;
      }
    },
  );

  /**
   * 获取错误分析历史
   * Channel: 'error:get-analysis-history'
   */
  ipcMain.handle("error:get-analysis-history", async (_event, options = {}) => {
    try {
      if (!monitorRef.current) {
        throw new Error("ErrorMonitor 未初始化");
      }

      return await monitorRef.current.getAnalysisHistory(options);
    } catch (error) {
      logger.error("[ErrorMonitor IPC] 获取分析历史失败:", error);
      throw error;
    }
  });

  /**
   * 删除错误分析记录
   * Channel: 'error:delete-analysis'
   */
  ipcMain.handle("error:delete-analysis", async (_event, analysisId) => {
    try {
      if (!monitorRef.current) {
        throw new Error("ErrorMonitor 未初始化");
      }

      await monitorRef.current.deleteAnalysis(analysisId);
      return { success: true };
    } catch (error) {
      logger.error("[ErrorMonitor IPC] 删除分析记录失败:", error);
      throw error;
    }
  });

  /**
   * 清理旧的错误分析记录
   * Channel: 'error:cleanup-old-analyses'
   */
  ipcMain.handle(
    "error:cleanup-old-analyses",
    async (_event, daysToKeep = 30) => {
      try {
        if (!monitorRef.current) {
          throw new Error("ErrorMonitor 未初始化");
        }

        const deletedCount =
          await monitorRef.current.cleanupOldAnalyses(daysToKeep);
        return {
          success: true,
          deletedCount,
        };
      } catch (error) {
        logger.error("[ErrorMonitor IPC] 清理旧分析记录失败:", error);
        throw error;
      }
    },
  );

  /**
   * 获取错误分类统计
   * Channel: 'error:get-classification-stats'
   */
  ipcMain.handle("error:get-classification-stats", async (_event, days = 7) => {
    try {
      if (!monitorRef.current) {
        throw new Error("ErrorMonitor 未初始化");
      }

      return await monitorRef.current.getClassificationStats(days);
    } catch (error) {
      logger.error("[ErrorMonitor IPC] 获取分类统计失败:", error);
      throw error;
    }
  });

  /**
   * 获取错误严重程度统计
   * Channel: 'error:get-severity-stats'
   */
  ipcMain.handle("error:get-severity-stats", async (_event, days = 7) => {
    try {
      if (!monitorRef.current) {
        throw new Error("ErrorMonitor 未初始化");
      }

      return await monitorRef.current.getSeverityStats(days);
    } catch (error) {
      logger.error("[ErrorMonitor IPC] 获取严重程度统计失败:", error);
      throw error;
    }
  });

  /**
   * 启用/禁用 AI 诊断
   * Channel: 'error:toggle-ai-diagnosis'
   */
  ipcMain.handle("error:toggle-ai-diagnosis", async (_event, enabled) => {
    try {
      if (!monitorRef.current) {
        throw new Error("ErrorMonitor 未初始化");
      }

      monitorRef.current.enableAIDiagnosis = enabled;
      return {
        success: true,
        enabled: monitorRef.current.enableAIDiagnosis,
      };
    } catch (error) {
      logger.error("[ErrorMonitor IPC] 切换 AI 诊断失败:", error);
      throw error;
    }
  });

  /**
   * 更新分析状态
   * Channel: 'error:update-status'
   */
  ipcMain.handle(
    "error:update-status",
    async (_event, analysisId, status, resolution = null) => {
      try {
        if (!monitorRef.current) {
          throw new Error("ErrorMonitor 未初始化");
        }

        await monitorRef.current.updateAnalysisStatus(
          analysisId,
          status,
          resolution,
        );
        return { success: true };
      } catch (error) {
        logger.error("[ErrorMonitor IPC] 更新分析状态失败:", error);
        throw error;
      }
    },
  );

  /**
   * 获取诊断配置
   * Channel: 'error:get-config'
   */
  ipcMain.handle("error:get-config", async () => {
    try {
      if (!monitorRef.current) {
        throw new Error("ErrorMonitor 未初始化");
      }

      return await monitorRef.current.getDiagnosisConfig();
    } catch (error) {
      logger.error("[ErrorMonitor IPC] 获取诊断配置失败:", error);
      throw error;
    }
  });

  /**
   * 更新诊断配置
   * Channel: 'error:update-config'
   */
  ipcMain.handle("error:update-config", async (_event, updates) => {
    try {
      if (!monitorRef.current) {
        throw new Error("ErrorMonitor 未初始化");
      }

      await monitorRef.current.updateDiagnosisConfig(updates);
      return { success: true };
    } catch (error) {
      logger.error("[ErrorMonitor IPC] 更新诊断配置失败:", error);
      throw error;
    }
  });

  /**
   * 获取每日错误趋势
   * Channel: 'error:get-daily-trend'
   */
  ipcMain.handle("error:get-daily-trend", async (_event, days = 7) => {
    try {
      if (!monitorRef.current) {
        throw new Error("ErrorMonitor 未初始化");
      }

      return await monitorRef.current.getDailyTrend(days);
    } catch (error) {
      logger.error("[ErrorMonitor IPC] 获取每日趋势失败:", error);
      throw error;
    }
  });

  /**
   * 重新分析错误（使用 AI）
   * Channel: 'error:reanalyze'
   */
  ipcMain.handle("error:reanalyze", async (_event, errorId) => {
    try {
      if (!monitorRef.current) {
        throw new Error("ErrorMonitor 未初始化");
      }

      // 获取原始错误信息
      const originalError = await monitorRef.current.getErrorById(errorId);
      if (!originalError) {
        throw new Error(`错误记录未找到: ${errorId}`);
      }

      // 重新分析
      return await monitorRef.current.analyzeError(originalError);
    } catch (error) {
      logger.error("[ErrorMonitor IPC] 重新分析错误失败:", error);
      throw error;
    }
  });

  // ============================================================
  // 日志记录
  // ============================================================

  /**
   * 记录渲染进程的错误到日志文件
   * Channel: 'log:error'
   */
  ipcMain.handle("log:error", async (_event, errorInfo) => {
    try {
      const { getLogger } = require("../logging/logger");
      const logger = getLogger("Renderer");

      // 记录错误到日志
      logger.error("Renderer process error:", errorInfo);

      // 如果 ErrorMonitor 可用，也记录到数据库
      if (monitorRef.current) {
        try {
          await monitorRef.current.analyzeError(errorInfo);
        } catch (analyzeError) {
          // 分析失败不影响日志记录
          logger.warn(
            "[ErrorMonitor IPC] 错误分析失败:",
            analyzeError.message,
          );
        }
      }

      return { success: true };
    } catch (error) {
      logger.error("[ErrorMonitor IPC] 记录错误日志失败:", error);
      // 不抛出异常，避免影响渲染进程
      return { success: false, error: error.message };
    }
  });

  /**
   * 更新 ErrorMonitor 引用
   * 用于热重载或重新初始化
   * @param {ErrorMonitor} newErrorMonitor - 新的 ErrorMonitor 实例
   */
  function updateErrorMonitor(newErrorMonitor) {
    monitorRef.current = newErrorMonitor;
    logger.info("[ErrorMonitor IPC] ErrorMonitor 引用已更新");
  }

  // 标记为已注册
  ipcGuard.markModuleRegistered("error-monitor-ipc");

  logger.info(
    "[ErrorMonitor IPC] ErrorMonitor IPC handlers registered successfully",
  );

  // 返回更新函数，供主进程使用
  return {
    updateErrorMonitor,
  };
}

module.exports = {
  registerErrorMonitorIPC,
};
