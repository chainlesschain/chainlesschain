/**
 * Vision IPC 处理器
 *
 * 负责处理视觉分析相关的前后端通信
 *
 * @module vision-ipc
 * @version 1.0.0
 */

const { logger } = require('../utils/logger.js');
const defaultIpcGuard = require('../ipc/ipc-guard');

/**
 * 注册 Vision IPC 处理器
 * @param {Object} dependencies - 依赖对象
 * @param {Object} dependencies.visionManager - Vision 管理器
 * @param {Object} [dependencies.mainWindow] - 主窗口实例
 * @param {Object} [dependencies.ipcMain] - IPC主进程对象（用于测试注入）
 * @param {Object} [dependencies.ipcGuard] - IPC 守卫（用于测试注入）
 */
function registerVisionIPC({
  visionManager,
  mainWindow,
  ipcMain: injectedIpcMain,
  ipcGuard: injectedIpcGuard,
}) {
  const ipcGuard = injectedIpcGuard || defaultIpcGuard;

  // 防止重复注册
  if (ipcGuard.isModuleRegistered('vision-ipc')) {
    logger.info('[Vision IPC] Handlers already registered, skipping...');
    return;
  }

  const electron = require('electron');
  const ipcMain = injectedIpcMain || electron.ipcMain;

  logger.info('[Vision IPC] Registering Vision IPC handlers...');

  // 创建可变引用
  const managerRef = { current: visionManager };

  // ============================================================
  // 服务状态
  // ============================================================

  /**
   * 检查视觉服务状态
   * Channel: 'vision:check-status'
   */
  ipcMain.handle('vision:check-status', async () => {
    try {
      if (!managerRef.current) {
        return {
          available: false,
          error: 'Vision 服务未初始化',
        };
      }

      return await managerRef.current.checkStatus();
    } catch (error) {
      logger.error('[Vision IPC] 检查状态失败:', error);
      return {
        available: false,
        error: error.message,
      };
    }
  });

  // ============================================================
  // 图片分析
  // ============================================================

  /**
   * 分析图片（通用）
   * Channel: 'vision:analyze-image'
   * @param {Object} params - 分析参数
   * @param {string} params.imagePath - 图片路径
   * @param {string} [params.imageBase64] - Base64 图片数据
   * @param {string} [params.type] - 分析类型 (describe|ocr|vqa|analyze)
   * @param {string} [params.prompt] - 自定义提示词
   * @param {string} [params.question] - 问题（VQA 用）
   * @param {Object} [params.options] - 其他选项
   */
  ipcMain.handle('vision:analyze-image', async (event, params) => {
    try {
      if (!managerRef.current) {
        throw new Error('Vision 服务未初始化');
      }

      const { options = {}, ...analysisParams } = params;

      const result = await managerRef.current.analyzeImage(analysisParams, options);

      return {
        success: true,
        data: result,
      };
    } catch (error) {
      logger.error('[Vision IPC] 图片分析失败:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 描述图片
   * Channel: 'vision:describe-image'
   */
  ipcMain.handle('vision:describe-image', async (event, params) => {
    try {
      if (!managerRef.current) {
        throw new Error('Vision 服务未初始化');
      }

      const { imagePath, imageBase64, style = 'detailed', options = {} } = params;

      const result = await managerRef.current.describeImage(
        { imagePath, imageBase64, style },
        options
      );

      return {
        success: true,
        data: result,
      };
    } catch (error) {
      logger.error('[Vision IPC] 图片描述失败:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * OCR 文字识别
   * Channel: 'vision:ocr'
   */
  ipcMain.handle('vision:ocr', async (event, params) => {
    try {
      if (!managerRef.current) {
        throw new Error('Vision 服务未初始化');
      }

      const { imagePath, imageBase64, language = '中文和英文', options = {} } = params;

      const result = await managerRef.current.performOCR(
        { imagePath, imageBase64, language },
        options
      );

      return {
        success: true,
        data: result,
      };
    } catch (error) {
      logger.error('[Vision IPC] OCR 失败:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 视觉问答 (VQA)
   * Channel: 'vision:vqa'
   */
  ipcMain.handle('vision:vqa', async (event, params) => {
    try {
      if (!managerRef.current) {
        throw new Error('Vision 服务未初始化');
      }

      const { imagePath, imageBase64, question, options = {} } = params;

      if (!question) {
        throw new Error('请提供问题');
      }

      const result = await managerRef.current.visualQA(
        { imagePath, imageBase64, question },
        options
      );

      return {
        success: true,
        data: result,
      };
    } catch (error) {
      logger.error('[Vision IPC] VQA 失败:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 流式分析图片
   * Channel: 'vision:analyze-stream'
   * 返回分析 ID，结果通过事件发送
   */
  ipcMain.handle('vision:analyze-stream', async (event, params) => {
    try {
      if (!managerRef.current) {
        throw new Error('Vision 服务未初始化');
      }

      const analysisId = `vision-${Date.now()}`;
      const { imagePath, imageBase64, prompt, options = {} } = params;

      // 异步执行流式分析
      managerRef.current.analyzeImageStream(
        { imagePath, imageBase64, prompt },
        (chunk, fullText) => {
          // 发送流式数据到渲染进程
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('vision:stream-chunk', {
              analysisId,
              chunk,
              fullText,
            });
          }
        },
        options
      ).then(result => {
        // 发送完成事件
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('vision:stream-complete', {
            analysisId,
            result,
          });
        }
      }).catch(error => {
        // 发送错误事件
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('vision:stream-error', {
            analysisId,
            error: error.message,
          });
        }
      });

      return {
        success: true,
        analysisId,
      };
    } catch (error) {
      logger.error('[Vision IPC] 流式分析启动失败:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 批量分析图片
   * Channel: 'vision:batch-analyze'
   */
  ipcMain.handle('vision:batch-analyze', async (event, params) => {
    try {
      if (!managerRef.current) {
        throw new Error('Vision 服务未初始化');
      }

      const { imageList, options = {} } = params;

      if (!imageList || !Array.isArray(imageList) || imageList.length === 0) {
        throw new Error('请提供图片列表');
      }

      const results = await managerRef.current.batchAnalyze(imageList, options);

      return {
        success: true,
        data: results,
        total: imageList.length,
        successful: results.filter(r => !r.error).length,
      };
    } catch (error) {
      logger.error('[Vision IPC] 批量分析失败:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  // ============================================================
  // 配置与统计
  // ============================================================

  /**
   * 获取统计数据
   * Channel: 'vision:get-stats'
   */
  ipcMain.handle('vision:get-stats', async () => {
    try {
      if (!managerRef.current) {
        return { success: false, error: 'Vision 服务未初始化' };
      }

      return {
        success: true,
        data: managerRef.current.getStats(),
      };
    } catch (error) {
      logger.error('[Vision IPC] 获取统计失败:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 更新配置
   * Channel: 'vision:update-config'
   */
  ipcMain.handle('vision:update-config', async (event, config) => {
    try {
      if (!managerRef.current) {
        return { success: false, error: 'Vision 服务未初始化' };
      }

      managerRef.current.updateConfig(config);

      return {
        success: true,
        message: '配置已更新',
      };
    } catch (error) {
      logger.error('[Vision IPC] 更新配置失败:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 清除缓存
   * Channel: 'vision:clear-cache'
   */
  ipcMain.handle('vision:clear-cache', async () => {
    try {
      if (!managerRef.current) {
        return { success: false, error: 'Vision 服务未初始化' };
      }

      managerRef.current.clearCache();

      return {
        success: true,
        message: '缓存已清除',
      };
    } catch (error) {
      logger.error('[Vision IPC] 清除缓存失败:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  // ============================================================
  // 模型管理
  // ============================================================

  /**
   * 拉取视觉模型
   * Channel: 'vision:pull-model'
   */
  ipcMain.handle('vision:pull-model', async (event, params) => {
    try {
      if (!managerRef.current || !managerRef.current.llavaClient) {
        throw new Error('本地 Vision 服务未初始化');
      }

      const { modelName = 'llava:7b' } = params;
      const pullId = `pull-${Date.now()}`;

      // 异步拉取，通过事件报告进度
      managerRef.current.llavaClient.pullModel(modelName, (progress) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('vision:pull-progress', {
            pullId,
            modelName,
            progress,
          });
        }
      }).then(result => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('vision:pull-complete', {
            pullId,
            modelName,
            result,
          });
        }
      }).catch(error => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('vision:pull-error', {
            pullId,
            modelName,
            error: error.message,
          });
        }
      });

      return {
        success: true,
        pullId,
        modelName,
      };
    } catch (error) {
      logger.error('[Vision IPC] 拉取模型失败:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  // 标记为已注册
  ipcGuard.markModuleRegistered('vision-ipc');
  logger.info('[Vision IPC] All handlers registered successfully');
}

module.exports = {
  registerVisionIPC,
};
