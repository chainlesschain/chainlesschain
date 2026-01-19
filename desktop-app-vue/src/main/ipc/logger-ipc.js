/**
 * 日志系统 IPC 处理器
 * 接收渲染进程的日志并写入文件
 */

const { ipcMain } = require('electron');
const { logger } = require('../utils/logger');

/**
 * 注册日志相关的 IPC 处理器
 */
function registerLoggerIPC() {
  // 接收渲染进程的日志
  ipcMain.handle('logger:write', async (event, logData) => {
    try {
      const { level, module, message, data, timestamp, stack } = logData;

      // 根据日志级别调用对应的方法
      const childLogger = logger.child(module || 'renderer');

      switch (level) {
        case 'DEBUG':
          childLogger.debug(message, data);
          break;
        case 'INFO':
          childLogger.info(message, data);
          break;
        case 'WARN':
          childLogger.warn(message, data);
          break;
        case 'ERROR':
        case 'FATAL':
          childLogger.error(message, { ...data, stack });
          break;
        default:
          childLogger.info(message, data);
      }

      return { success: true };
    } catch (error) {
      logger.error('日志写入失败:', error);
      return { success: false, error: error.message };
    }
  });

  // 获取日志配置
  ipcMain.handle('logger:get-config', async () => {
    try {
      return {
        success: true,
        config: logger.config,
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // 更新日志配置
  ipcMain.handle('logger:set-config', async (event, config) => {
    try {
      logger.setConfig(config);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // 清理旧日志
  ipcMain.handle('logger:cleanup', async (event, daysToKeep = 7) => {
    try {
      const deletedCount = logger.cleanup(daysToKeep);
      return { success: true, deletedCount };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // 获取日志文件列表
  ipcMain.handle('logger:get-files', async () => {
    try {
      const fs = require('fs');
      const files = fs.readdirSync(logger.logDir)
        .filter(f => f.endsWith('.log'))
        .map(f => ({
          name: f,
          path: require('path').join(logger.logDir, f),
          size: fs.statSync(require('path').join(logger.logDir, f)).size,
          mtime: fs.statSync(require('path').join(logger.logDir, f)).mtime,
        }))
        .sort((a, b) => b.mtime - a.mtime);

      return { success: true, files };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // 读取日志文件内容
  ipcMain.handle('logger:read-file', async (event, filename) => {
    try {
      const fs = require('fs');
      const path = require('path');
      const filePath = path.join(logger.logDir, filename);

      // 安全检查：防止路径遍历攻击
      if (!filePath.startsWith(logger.logDir)) {
        throw new Error('Invalid file path');
      }

      const content = fs.readFileSync(filePath, 'utf8');
      return { success: true, content };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  logger.info('[Logger IPC] 已注册 6 个日志处理器');
}

module.exports = { registerLoggerIPC };
