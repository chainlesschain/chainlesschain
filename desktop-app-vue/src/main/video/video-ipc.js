/**
 * 视频处理 IPC
 * 处理视频导入、编辑、转码、分析等操作
 *
 * @module video-ipc
 * @description 视频处理模块，提供视频导入、批量处理、编辑、转码、字幕处理等功能
 */

const { logger, createLogger } = require('../utils/logger.js');
const { ipcMain, dialog } = require('electron');

/**
 * 注册视频处理相关的 IPC 处理器
 * @param {Object} dependencies - 依赖对象
 * @param {Object} dependencies.videoImporter - 视频导入器实例
 * @param {Object} dependencies.mainWindow - 主窗口实例（用于进度通知）
 * @param {Object} dependencies.llmManager - LLM 管理器实例（用于AI视频处理）
 */
function registerVideoIPC({
  videoImporter,
  mainWindow,
  llmManager
}) {
  logger.info('[Video IPC] Registering Video IPC handlers...');

  // ============================================================
  // 文件选择与导入操作 (4 handlers)
  // ============================================================

  /**
   * 选择视频文件
   */
  ipcMain.handle('video:select-files', async () => {
    try {
      if (!videoImporter) {
        throw new Error('视频导入器未初始化');
      }

      const result = await dialog.showOpenDialog(mainWindow, {
        title: '选择要导入的视频文件',
        filters: [
          { name: 'Video Files', extensions: ['mp4', 'avi', 'mov', 'mkv', 'flv', 'webm', 'wmv', 'mpg', 'mpeg', 'm4v', '3gp'] },
          { name: 'All Files', extensions: ['*'] },
        ],
        properties: ['openFile', 'multiSelections'],
      });

      if (result.canceled) {
        return { canceled: true };
      }

      return {
        canceled: false,
        filePaths: result.filePaths,
      };
    } catch (error) {
      logger.error('[Video] 选择视频文件失败:', error);
      throw error;
    }
  });

  /**
   * 导入单个视频文件
   */
  ipcMain.handle('video:import-file', async (_event, filePath, options) => {
    try {
      if (!videoImporter) {
        throw new Error('视频导入器未初始化');
      }

      // 设置事件监听器，向渲染进程发送进度
      videoImporter.on('import:start', (data) => {
        if (mainWindow) {
          mainWindow.webContents.send('video:import:start', data);
        }
      });

      videoImporter.on('import:progress', (data) => {
        if (mainWindow) {
          mainWindow.webContents.send('video:import:progress', data);
        }
      });

      videoImporter.on('import:complete', (data) => {
        if (mainWindow) {
          mainWindow.webContents.send('video:import:complete', data);
        }
      });

      videoImporter.on('import:error', (data) => {
        if (mainWindow) {
          mainWindow.webContents.send('video:import:error', data);
        }
      });

      videoImporter.on('analysis:start', (data) => {
        if (mainWindow) {
          mainWindow.webContents.send('video:analysis:start', data);
        }
      });

      videoImporter.on('analysis:progress', (data) => {
        if (mainWindow) {
          mainWindow.webContents.send('video:analysis:progress', data);
        }
      });

      videoImporter.on('analysis:complete', (data) => {
        if (mainWindow) {
          mainWindow.webContents.send('video:analysis:complete', data);
        }
      });

      videoImporter.on('analysis:error', (data) => {
        if (mainWindow) {
          mainWindow.webContents.send('video:analysis:error', data);
        }
      });

      const result = await videoImporter.importVideo(filePath, options);
      return result;
    } catch (error) {
      logger.error('[Video] 导入视频失败:', error);
      throw error;
    }
  });

  /**
   * 批量导入视频文件
   */
  ipcMain.handle('video:import-files', async (_event, filePaths, options) => {
    try {
      if (!videoImporter) {
        throw new Error('视频导入器未初始化');
      }

      // 设置事件监听器，向渲染进程发送批量导入进度
      videoImporter.on('batch:start', (data) => {
        if (mainWindow) {
          mainWindow.webContents.send('video:batch:start', data);
        }
      });

      videoImporter.on('batch:progress', (data) => {
        if (mainWindow) {
          mainWindow.webContents.send('video:batch:progress', data);
        }
      });

      videoImporter.on('batch:complete', (data) => {
        if (mainWindow) {
          mainWindow.webContents.send('video:batch:complete', data);
        }
      });

      const results = await videoImporter.importVideoBatch(filePaths, options);
      return results;
    } catch (error) {
      logger.error('[Video] 批量导入视频失败:', error);
      throw error;
    }
  });

  /**
   * 获取视频信息
   */
  ipcMain.handle('video:get-video', async (_event, videoId) => {
    try {
      if (!videoImporter) {
        throw new Error('视频导入器未初始化');
      }
      return await videoImporter.storage.getVideoFile(videoId);
    } catch (error) {
      logger.error('[Video] 获取视频信息失败:', error);
      throw error;
    }
  });

  // ============================================================
  // 视频管理操作 (5 handlers)
  // ============================================================

  /**
   * 获取视频列表
   */
  ipcMain.handle('video:get-videos', async (_event, options) => {
    try {
      if (!videoImporter) {
        throw new Error('视频导入器未初始化');
      }
      return await videoImporter.storage.getAllVideos(options);
    } catch (error) {
      logger.error('[Video] 获取视频列表失败:', error);
      throw error;
    }
  });

  /**
   * 获取视频分析
   */
  ipcMain.handle('video:get-analysis', async (_event, videoId) => {
    try {
      if (!videoImporter) {
        throw new Error('视频导入器未初始化');
      }
      return await videoImporter.storage.getVideoAnalysisByVideoId(videoId);
    } catch (error) {
      logger.error('[Video] 获取视频分析失败:', error);
      throw error;
    }
  });

  /**
   * 获取关键帧
   */
  ipcMain.handle('video:get-keyframes', async (_event, videoId) => {
    try {
      if (!videoImporter) {
        throw new Error('视频导入器未初始化');
      }
      return await videoImporter.storage.getKeyframesByVideoId(videoId);
    } catch (error) {
      logger.error('[Video] 获取关键帧失败:', error);
      throw error;
    }
  });

  /**
   * 删除视频
   */
  ipcMain.handle('video:delete-video', async (_event, videoId) => {
    try {
      if (!videoImporter) {
        throw new Error('视频导入器未初始化');
      }
      await videoImporter.storage.deleteVideoFile(videoId);
      return { success: true };
    } catch (error) {
      logger.error('[Video] 删除视频失败:', error);
      throw error;
    }
  });

  /**
   * 获取统计信息
   */
  ipcMain.handle('video:get-stats', async () => {
    try {
      if (!videoImporter) {
        throw new Error('视频导入器未初始化');
      }
      const count = await videoImporter.storage.getVideoCount();
      const totalDuration = await videoImporter.storage.getTotalDuration();
      const totalSize = await videoImporter.storage.getTotalStorageSize();
      const statusStats = await videoImporter.storage.getVideoCountByStatus();

      return {
        count,
        totalDuration,
        totalSize,
        statusStats
      };
    } catch (error) {
      logger.error('[Video] 获取统计信息失败:', error);
      throw error;
    }
  });

  // ============================================================
  // 视频编辑操作 (9 handlers)
  // ============================================================

  /**
   * 转换视频格式
   */
  ipcMain.handle('video:convert', async (_event, params) => {
    try {
      logger.info('[Video] 转换视频格式');

      const { getVideoEngine } = require('../engines/video-engine');
      const videoEngine = getVideoEngine(llmManager);

      const result = await videoEngine.handleProjectTask({
        taskType: 'convert',
        ...params
      }, (progress) => {
        if (mainWindow) {
          mainWindow.webContents.send('video:processing-progress', progress);
        }
      });

      logger.info('[Video] 格式转换完成');
      return result;
    } catch (error) {
      logger.error('[Video] 格式转换失败:', error);
      throw error;
    }
  });

  /**
   * 裁剪视频
   */
  ipcMain.handle('video:trim', async (_event, params) => {
    try {
      logger.info('[Video] 裁剪视频');

      const { getVideoEngine } = require('../engines/video-engine');
      const videoEngine = getVideoEngine(llmManager);

      const result = await videoEngine.handleProjectTask({
        taskType: 'trim',
        ...params
      }, (progress) => {
        if (mainWindow) {
          mainWindow.webContents.send('video:processing-progress', progress);
        }
      });

      logger.info('[Video] 视频裁剪完成');
      return result;
    } catch (error) {
      logger.error('[Video] 视频裁剪失败:', error);
      throw error;
    }
  });

  /**
   * 合并视频
   */
  ipcMain.handle('video:merge', async (_event, params) => {
    try {
      logger.info('[Video] 合并视频:', params.videoList.length, '个');

      const { getVideoEngine } = require('../engines/video-engine');
      const videoEngine = getVideoEngine(llmManager);

      const result = await videoEngine.handleProjectTask({
        taskType: 'merge',
        ...params
      }, (progress) => {
        if (mainWindow) {
          mainWindow.webContents.send('video:processing-progress', progress);
        }
      });

      logger.info('[Video] 视频合并完成');
      return result;
    } catch (error) {
      logger.error('[Video] 视频合并失败:', error);
      throw error;
    }
  });

  /**
   * 添加字幕
   */
  ipcMain.handle('video:addSubtitles', async (_event, params) => {
    try {
      logger.info('[Video] 添加字幕');

      const { getVideoEngine } = require('../engines/video-engine');
      const videoEngine = getVideoEngine(llmManager);

      const result = await videoEngine.handleProjectTask({
        taskType: 'addSubtitles',
        ...params
      });

      logger.info('[Video] 字幕添加完成');
      return result;
    } catch (error) {
      logger.error('[Video] 字幕添加失败:', error);
      throw error;
    }
  });

  /**
   * 生成字幕
   */
  ipcMain.handle('video:generateSubtitles', async (_event, params) => {
    try {
      logger.info('[Video] 生成字幕');

      const { getVideoEngine } = require('../engines/video-engine');
      const videoEngine = getVideoEngine(llmManager);

      const result = await videoEngine.handleProjectTask({
        taskType: 'generateSubtitles',
        ...params
      }, (progress) => {
        if (mainWindow) {
          mainWindow.webContents.send('video:processing-progress', progress);
        }
      });

      logger.info('[Video] 字幕生成完成');
      return result;
    } catch (error) {
      logger.error('[Video] 字幕生成失败:', error);
      throw error;
    }
  });

  /**
   * 提取音频
   */
  ipcMain.handle('video:extractAudio', async (_event, params) => {
    try {
      logger.info('[Video] 提取音频');

      const { getVideoEngine } = require('../engines/video-engine');
      const videoEngine = getVideoEngine(llmManager);

      const result = await videoEngine.handleProjectTask({
        taskType: 'extractAudio',
        ...params
      });

      logger.info('[Video] 音频提取完成');
      return result;
    } catch (error) {
      logger.error('[Video] 音频提取失败:', error);
      throw error;
    }
  });

  /**
   * 生成缩略图
   */
  ipcMain.handle('video:generateThumbnail', async (_event, params) => {
    try {
      logger.info('[Video] 生成缩略图');

      const { getVideoEngine } = require('../engines/video-engine');
      const videoEngine = getVideoEngine(llmManager);

      const result = await videoEngine.handleProjectTask({
        taskType: 'generateThumbnail',
        ...params
      });

      logger.info('[Video] 缩略图生成完成');
      return result;
    } catch (error) {
      logger.error('[Video] 缩略图生成失败:', error);
      throw error;
    }
  });

  /**
   * 压缩视频
   */
  ipcMain.handle('video:compress', async (_event, params) => {
    try {
      logger.info('[Video] 压缩视频');

      const { getVideoEngine } = require('../engines/video-engine');
      const videoEngine = getVideoEngine(llmManager);

      const result = await videoEngine.handleProjectTask({
        taskType: 'compress',
        ...params
      }, (progress) => {
        if (mainWindow) {
          mainWindow.webContents.send('video:processing-progress', progress);
        }
      });

      logger.info('[Video] 视频压缩完成');
      return result;
    } catch (error) {
      logger.error('[Video] 视频压缩失败:', error);
      throw error;
    }
  });

  /**
   * 获取视频详细信息
   */
  ipcMain.handle('video:getInfo', async (_event, videoPath) => {
    try {
      const { getVideoEngine } = require('../engines/video-engine');
      const videoEngine = getVideoEngine(llmManager);

      const info = await videoEngine.getVideoInfo(videoPath);
      return info;
    } catch (error) {
      logger.error('[Video] 获取视频信息失败:', error);
      throw error;
    }
  });

  // ============================================================
  // v0.18.0: 高级视频编辑操作 (6 handlers)
  // ============================================================

  /**
   * 应用单个滤镜
   */
  ipcMain.handle('video:applyFilter', async (_event, params) => {
    try {
      logger.info('[Video] 应用滤镜:', params.options?.filterType);

      const { getVideoEngine } = require('../engines/video-engine');
      const videoEngine = getVideoEngine(llmManager);

      const result = await videoEngine.handleProjectTask({
        taskType: 'applyFilter',
        ...params
      }, (progress) => {
        if (mainWindow) {
          mainWindow.webContents.send('video:processing-progress', progress);
        }
      });

      logger.info('[Video] 滤镜应用完成');
      return result;
    } catch (error) {
      logger.error('[Video] 滤镜应用失败:', error);
      throw error;
    }
  });

  /**
   * 应用滤镜链
   */
  ipcMain.handle('video:applyFilterChain', async (_event, params) => {
    try {
      logger.info('[Video] 应用滤镜链:', params.options?.filters?.length, '个滤镜');

      const { getVideoEngine } = require('../engines/video-engine');
      const videoEngine = getVideoEngine(llmManager);

      const result = await videoEngine.handleProjectTask({
        taskType: 'applyFilterChain',
        ...params
      }, (progress) => {
        if (mainWindow) {
          mainWindow.webContents.send('video:processing-progress', progress);
        }
      });

      logger.info('[Video] 滤镜链应用完成');
      return result;
    } catch (error) {
      logger.error('[Video] 滤镜链应用失败:', error);
      throw error;
    }
  });

  /**
   * 分离音轨
   */
  ipcMain.handle('video:separateAudio', async (_event, params) => {
    try {
      logger.info('[Video] 分离音轨');

      const { getVideoEngine } = require('../engines/video-engine');
      const videoEngine = getVideoEngine(llmManager);

      const result = await videoEngine.handleProjectTask({
        taskType: 'separateAudio',
        ...params
      });

      logger.info('[Video] 音轨分离完成');
      return result;
    } catch (error) {
      logger.error('[Video] 音轨分离失败:', error);
      throw error;
    }
  });

  /**
   * 替换音轨
   */
  ipcMain.handle('video:replaceAudio', async (_event, params) => {
    try {
      logger.info('[Video] 替换音轨');

      const { getVideoEngine } = require('../engines/video-engine');
      const videoEngine = getVideoEngine(llmManager);

      const result = await videoEngine.handleProjectTask({
        taskType: 'replaceAudio',
        ...params
      }, (progress) => {
        if (mainWindow) {
          mainWindow.webContents.send('video:processing-progress', progress);
        }
      });

      logger.info('[Video] 音轨替换完成');
      return result;
    } catch (error) {
      logger.error('[Video] 音轨替换失败:', error);
      throw error;
    }
  });

  /**
   * 调节音量
   */
  ipcMain.handle('video:adjustVolume', async (_event, params) => {
    try {
      logger.info('[Video] 调节音量:', params.options?.volumeLevel);

      const { getVideoEngine } = require('../engines/video-engine');
      const videoEngine = getVideoEngine(llmManager);

      const result = await videoEngine.handleProjectTask({
        taskType: 'adjustVolume',
        ...params
      }, (progress) => {
        if (mainWindow) {
          mainWindow.webContents.send('video:processing-progress', progress);
        }
      });

      logger.info('[Video] 音量调节完成');
      return result;
    } catch (error) {
      logger.error('[Video] 音量调节失败:', error);
      throw error;
    }
  });

  /**
   * 使用预设样式添加字幕
   */
  ipcMain.handle('video:addSubtitlesWithPreset', async (_event, params) => {
    try {
      logger.info('[Video] 应用字幕预设:', params.presetName);

      const { getVideoEngine } = require('../engines/video-engine');
      const videoEngine = getVideoEngine(llmManager);

      const result = await videoEngine.addSubtitlesWithPreset(
        params.inputPath,
        params.subtitlePath,
        params.outputPath,
        params.presetName,
        (progress) => {
          if (mainWindow) {
            mainWindow.webContents.send('video:processing-progress', progress);
          }
        }
      );

      logger.info('[Video] 预设字幕添加完成');
      return result;
    } catch (error) {
      logger.error('[Video] 预设字幕添加失败:', error);
      throw error;
    }
  });

  logger.info('[Video IPC] ✓ 24 handlers registered (+6 new)');
  logger.info('[Video IPC] - 4 file selection & import handlers');
  logger.info('[Video IPC] - 5 video management handlers');
  logger.info('[Video IPC] - 9 video editing handlers');
  logger.info('[Video IPC] - 6 advanced editing handlers (filters, audio, subtitles)');
}

module.exports = {
  registerVideoIPC
};
