/**
 * 图像管理 IPC
 * 处理图像上传、OCR、搜索、AI生成、图像处理等操作
 *
 * @module image-ipc
 * @description 图像管理模块，提供图像上传、OCR识别、AI图像生成、图像处理等功能
 */

const { logger, createLogger } = require('../utils/logger.js');
const { ipcMain, dialog } = require('electron');
const ipcGuard = require('../ipc/ipc-guard');

/**
 * 注册图像管理相关的 IPC 处理器
 * @param {Object} dependencies - 依赖对象
 * @param {Object} dependencies.imageUploader - 图片上传器实例
 * @param {Object} dependencies.llmManager - LLM 管理器实例（用于 AI 图像生成）
 * @param {Object} dependencies.mainWindow - 主窗口实例（用于进度通知）
 */
function registerImageIPC({
  imageUploader,
  llmManager,
  mainWindow
}) {
  // 防止重复注册
  if (ipcGuard.isModuleRegistered('image-ipc')) {
    logger.info('[Image IPC] Handlers already registered, skipping...');
    return;
  }

  logger.info('[Image IPC] Registering Image IPC handlers...');

  // ============================================================
  // 图片选择与上传操作 (3 handlers)
  // ============================================================

  /**
   * 选择图片
   */
  ipcMain.handle('image:select-images', async () => {
    try {
      if (!imageUploader) {
        throw new Error('图片上传器未初始化');
      }

      // 打开图片选择对话框
      const result = await dialog.showOpenDialog(mainWindow, {
        title: '选择要上传的图片',
        filters: [
          { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'] },
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
      logger.error('[Image] 选择图片失败:', error);
      throw error;
    }
  });

  /**
   * 上传图片
   */
  ipcMain.handle('image:upload', async (_event, imagePath, options) => {
    try {
      if (!imageUploader) {
        throw new Error('图片上传器未初始化');
      }

      // 设置事件监听器
      imageUploader.on('upload-start', (data) => {
        if (mainWindow) {
          mainWindow.webContents.send('image:upload-start', data);
        }
      });

      imageUploader.on('upload-complete', (data) => {
        if (mainWindow) {
          mainWindow.webContents.send('image:upload-complete', data);
        }
      });

      imageUploader.on('ocr:progress', (data) => {
        if (mainWindow) {
          mainWindow.webContents.send('image:ocr-progress', data);
        }
      });

      const result = await imageUploader.uploadImage(imagePath, options);
      return result;
    } catch (error) {
      logger.error('[Image] 上传图片失败:', error);
      throw error;
    }
  });

  /**
   * 批量上传图片
   */
  ipcMain.handle('image:upload-batch', async (_event, imagePaths, options) => {
    try {
      if (!imageUploader) {
        throw new Error('图片上传器未初始化');
      }

      // 设置事件监听器
      imageUploader.on('batch-progress', (data) => {
        if (mainWindow) {
          mainWindow.webContents.send('image:batch-progress', data);
        }
      });

      imageUploader.on('batch-complete', (data) => {
        if (mainWindow) {
          mainWindow.webContents.send('image:batch-complete', data);
        }
      });

      const results = await imageUploader.uploadImages(imagePaths, options);
      return results;
    } catch (error) {
      logger.error('[Image] 批量上传图片失败:', error);
      throw error;
    }
  });

  // ============================================================
  // 图片管理操作 (6 handlers)
  // ============================================================

  /**
   * OCR 识别
   */
  ipcMain.handle('image:ocr', async (_event, imagePath) => {
    try {
      if (!imageUploader) {
        throw new Error('图片上传器未初始化');
      }

      const result = await imageUploader.performOCR(imagePath);
      return result;
    } catch (error) {
      logger.error('[Image] OCR 识别失败:', error);
      throw error;
    }
  });

  /**
   * 获取图片信息
   */
  ipcMain.handle('image:get', async (_event, imageId) => {
    try {
      if (!imageUploader) {
        throw new Error('图片上传器未初始化');
      }

      const image = await imageUploader.getImageInfo(imageId);
      return image;
    } catch (error) {
      logger.error('[Image] 获取图片失败:', error);
      throw error;
    }
  });

  /**
   * 列出图片
   */
  ipcMain.handle('image:list', async (_event, options) => {
    try {
      if (!imageUploader) {
        throw new Error('图片上传器未初始化');
      }

      const images = await imageUploader.getAllImages(options);
      return images;
    } catch (error) {
      logger.error('[Image] 获取图片列表失败:', error);
      throw error;
    }
  });

  /**
   * 搜索图片
   */
  ipcMain.handle('image:search', async (_event, query) => {
    try {
      if (!imageUploader) {
        throw new Error('图片上传器未初始化');
      }

      const images = await imageUploader.searchImages(query);
      return images;
    } catch (error) {
      logger.error('[Image] 搜索图片失败:', error);
      throw error;
    }
  });

  /**
   * 删除图片
   */
  ipcMain.handle('image:delete', async (_event, imageId) => {
    try {
      if (!imageUploader) {
        throw new Error('图片上传器未初始化');
      }

      const result = await imageUploader.deleteImage(imageId);
      return result;
    } catch (error) {
      logger.error('[Image] 删除图片失败:', error);
      throw error;
    }
  });

  /**
   * 获取统计信息
   */
  ipcMain.handle('image:get-stats', async () => {
    try {
      if (!imageUploader) {
        throw new Error('图片上传器未初始化');
      }

      const stats = await imageUploader.getStats();
      return stats;
    } catch (error) {
      logger.error('[Image] 获取统计信息失败:', error);
      throw error;
    }
  });

  // ============================================================
  // 图片配置操作 (2 handlers)
  // ============================================================

  /**
   * 获取支持的格式
   */
  ipcMain.handle('image:get-supported-formats', async () => {
    try {
      if (!imageUploader) {
        throw new Error('图片上传器未初始化');
      }

      return imageUploader.getSupportedFormats();
    } catch (error) {
      logger.error('[Image] 获取支持格式失败:', error);
      throw error;
    }
  });

  /**
   * 获取支持的语言
   */
  ipcMain.handle('image:get-supported-languages', async () => {
    try {
      if (!imageUploader) {
        throw new Error('图片上传器未初始化');
      }

      return imageUploader.getSupportedLanguages();
    } catch (error) {
      logger.error('[Image] 获取支持语言失败:', error);
      throw error;
    }
  });

  // ============================================================
  // AI 图像生成与处理操作 (11 handlers)
  // ============================================================

  /**
   * AI 文生图
   */
  ipcMain.handle('image:generateFromText', async (_event, params) => {
    try {
      logger.info('[Image] AI文生图:', params.prompt.substring(0, 50));

      const { getImageEngine } = require('../engines/image-engine');
      const imageEngine = getImageEngine(llmManager);

      const result = await imageEngine.handleProjectTask({
        taskType: 'generateFromText',
        ...params
      }, (progress) => {
        if (mainWindow) {
          mainWindow.webContents.send('image:generation-progress', progress);
        }
      });

      logger.info('[Image] 图片生成完成');
      return result;
    } catch (error) {
      logger.error('[Image] 图片生成失败:', error);
      throw error;
    }
  });

  /**
   * 移除背景
   */
  ipcMain.handle('image:removeBackground', async (_event, params) => {
    try {
      logger.info('[Image] 移除背景');

      const { getImageEngine } = require('../engines/image-engine');
      const imageEngine = getImageEngine(llmManager);

      const result = await imageEngine.handleProjectTask({
        taskType: 'removeBackground',
        ...params
      }, (progress) => {
        if (mainWindow) {
          mainWindow.webContents.send('image:processing-progress', progress);
        }
      });

      logger.info('[Image] 背景移除完成');
      return result;
    } catch (error) {
      logger.error('[Image] 背景移除失败:', error);
      throw error;
    }
  });

  /**
   * 调整图片大小
   */
  ipcMain.handle('image:resize', async (_event, params) => {
    try {
      logger.info('[Image] 调整图片大小:', params.width, 'x', params.height);

      const { getImageEngine } = require('../engines/image-engine');
      const imageEngine = getImageEngine(llmManager);

      const result = await imageEngine.handleProjectTask({
        taskType: 'resize',
        ...params
      });

      logger.info('[Image] 图片调整完成');
      return result;
    } catch (error) {
      logger.error('[Image] 图片调整失败:', error);
      throw error;
    }
  });

  /**
   * 裁剪图片
   */
  ipcMain.handle('image:crop', async (_event, params) => {
    try {
      logger.info('[Image] 裁剪图片');

      const { getImageEngine } = require('../engines/image-engine');
      const imageEngine = getImageEngine(llmManager);

      const result = await imageEngine.handleProjectTask({
        taskType: 'crop',
        ...params
      });

      logger.info('[Image] 图片裁剪完成');
      return result;
    } catch (error) {
      logger.error('[Image] 图片裁剪失败:', error);
      throw error;
    }
  });

  /**
   * 增强图片
   */
  ipcMain.handle('image:enhance', async (_event, params) => {
    try {
      logger.info('[Image] 增强图片');

      const { getImageEngine } = require('../engines/image-engine');
      const imageEngine = getImageEngine(llmManager);

      const result = await imageEngine.handleProjectTask({
        taskType: 'enhance',
        ...params
      });

      logger.info('[Image] 图片增强完成');
      return result;
    } catch (error) {
      logger.error('[Image] 图片增强失败:', error);
      throw error;
    }
  });

  /**
   * 图片超分辨率
   */
  ipcMain.handle('image:upscale', async (_event, params) => {
    try {
      logger.info('[Image] 图片超分辨率');

      const { getImageEngine } = require('../engines/image-engine');
      const imageEngine = getImageEngine(llmManager);

      const result = await imageEngine.handleProjectTask({
        taskType: 'upscale',
        ...params
      }, (progress) => {
        if (mainWindow) {
          mainWindow.webContents.send('image:processing-progress', progress);
        }
      });

      logger.info('[Image] 超分辨率完成');
      return result;
    } catch (error) {
      logger.error('[Image] 超分辨率失败:', error);
      throw error;
    }
  });

  /**
   * 添加水印
   */
  ipcMain.handle('image:addWatermark', async (_event, params) => {
    try {
      logger.info('[Image] 添加水印');

      const { getImageEngine } = require('../engines/image-engine');
      const imageEngine = getImageEngine(llmManager);

      const result = await imageEngine.handleProjectTask({
        taskType: 'addWatermark',
        ...params
      });

      logger.info('[Image] 水印添加完成');
      return result;
    } catch (error) {
      logger.error('[Image] 水印添加失败:', error);
      throw error;
    }
  });

  /**
   * 批量处理图片
   */
  ipcMain.handle('image:batchProcess', async (_event, params) => {
    try {
      logger.info('[Image] 批量处理图片:', params.imageList.length, '张');

      const { getImageEngine } = require('../engines/image-engine');
      const imageEngine = getImageEngine(llmManager);

      const result = await imageEngine.handleProjectTask({
        taskType: 'batchProcess',
        ...params
      }, (progress) => {
        if (mainWindow) {
          mainWindow.webContents.send('image:batch-progress', progress);
        }
      });

      logger.info('[Image] 批量处理完成');
      return result;
    } catch (error) {
      logger.error('[Image] 批量处理失败:', error);
      throw error;
    }
  });

  /**
   * 转换图片格式
   */
  ipcMain.handle('image:convertFormat', async (_event, params) => {
    try {
      logger.info('[Image] 转换图片格式:', params.format);

      const { getImageEngine } = require('../engines/image-engine');
      const imageEngine = getImageEngine(llmManager);

      const result = await imageEngine.handleProjectTask({
        taskType: 'convertFormat',
        ...params
      });

      logger.info('[Image] 格式转换完成');
      return result;
    } catch (error) {
      logger.error('[Image] 格式转换失败:', error);
      throw error;
    }
  });

  /**
   * 创建图片拼贴
   */
  ipcMain.handle('image:createCollage', async (_event, params) => {
    try {
      logger.info('[Image] 创建图片拼贴:', params.imageList.length, '张');

      const { getImageEngine } = require('../engines/image-engine');
      const imageEngine = getImageEngine(llmManager);

      const result = await imageEngine.handleProjectTask({
        taskType: 'createCollage',
        ...params
      });

      logger.info('[Image] 拼贴创建完成');
      return result;
    } catch (error) {
      logger.error('[Image] 拼贴创建失败:', error);
      throw error;
    }
  });

  /**
   * 获取图片详细信息（使用引擎）
   */
  ipcMain.handle('image:getInfo', async (_event, imagePath) => {
    try {
      const { getImageEngine } = require('../engines/image-engine');
      const imageEngine = getImageEngine(llmManager);

      const info = await imageEngine.getImageInfo(imagePath);
      return info;
    } catch (error) {
      logger.error('[Image] 获取图片信息失败:', error);
      throw error;
    }
  });

  // 标记模块为已注册
  ipcGuard.markModuleRegistered('image-ipc');

  logger.info('[Image IPC] ✓ 22 handlers registered');
  logger.info('[Image IPC] - 3 image selection & upload handlers');
  logger.info('[Image IPC] - 6 image management handlers');
  logger.info('[Image IPC] - 2 configuration handlers');
  logger.info('[Image IPC] - 11 AI generation & processing handlers');
}

module.exports = {
  registerImageIPC
};
