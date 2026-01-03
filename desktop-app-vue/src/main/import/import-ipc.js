/**
 * 文件导入 IPC 处理器
 * 负责处理所有文件导入相关的前后端通信
 *
 * @module import-ipc
 * @description 提供文件选择、导入、格式检查等 IPC 接口
 */

/**
 * 注册所有文件导入 IPC 处理器
 * @param {Object} dependencies - 依赖对象
 * @param {Object} dependencies.fileImporter - 文件导入器实例
 * @param {Object} dependencies.mainWindow - 主窗口实例
 * @param {Object} dependencies.database - 数据库管理器
 * @param {Object} [dependencies.ragManager] - RAG 管理器（用于索引同步）
 * @param {Object} dependencies.ipcMain - IPC主进程对象（可选，用于测试注入）
 * @param {Object} dependencies.dialog - Dialog对象（可选，用于测试注入）
 */
function registerImportIPC({
  fileImporter,
  mainWindow,
  database,
  ragManager,
  ipcMain: injectedIpcMain,
  dialog: injectedDialog
}) {
  // 支持依赖注入，用于测试
  const electron = require('electron');
  const ipcMain = injectedIpcMain || electron.ipcMain;
  const dialog = injectedDialog || electron.dialog;

  console.log('[Import IPC] Registering Import IPC handlers...');

  // ============================================================
  // 文件选择与导入 (File Selection and Import)
  // ============================================================

  /**
   * 选择要导入的文件
   * Channel: 'import:select-files'
   *
   * NOTE: This handler is already defined in index.js at line 2072
   * Keeping here for completeness and future migration
   */
  ipcMain.handle('import:select-files', async () => {
    try {
      if (!fileImporter) {
        throw new Error('文件导入器未初始化');
      }

      // 打开文件选择对话框
      const result = await dialog.showOpenDialog(mainWindow, {
        title: '选择要导入的文件',
        filters: [
          { name: 'Markdown', extensions: ['md', 'markdown'] },
          { name: 'PDF', extensions: ['pdf'] },
          { name: 'Word', extensions: ['doc', 'docx'] },
          { name: 'Text', extensions: ['txt'] },
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
      console.error('[Import IPC] 选择文件失败:', error);
      throw error;
    }
  });

  /**
   * 导入单个文件
   * Channel: 'import:import-file'
   *
   * NOTE: This handler is already defined in index.js at line 2105
   * Keeping here for completeness and future migration
   *
   * @param {string} filePath - 文件路径
   * @param {Object} options - 导入选项
   * @returns {Promise<Object>} 导入结果
   */
  ipcMain.handle('import:import-file', async (_event, filePath, options) => {
    try {
      if (!fileImporter) {
        throw new Error('文件导入器未初始化');
      }

      // 设置事件监听器，向渲染进程发送进度
      fileImporter.on('import-start', (data) => {
        if (mainWindow) {
          mainWindow.webContents.send('import:start', data);
        }
      });

      fileImporter.on('import-success', (data) => {
        if (mainWindow) {
          mainWindow.webContents.send('import:success', data);
        }
      });

      fileImporter.on('import-error', (data) => {
        if (mainWindow) {
          mainWindow.webContents.send('import:error', data);
        }
      });

      const result = await fileImporter.importFile(filePath, options);

      // 导入成功后，添加到RAG索引
      if (result && ragManager && database) {
        const item = database.getKnowledgeItemById(result.id);
        if (item) {
          await ragManager.addToIndex(item);
        }
      }

      return result;
    } catch (error) {
      console.error('[Import IPC] 导入文件失败:', error);
      throw error;
    }
  });

  /**
   * 批量导入文件
   * Channel: 'import:import-files'
   *
   * NOTE: This handler is already defined in index.js at line 2147
   * Keeping here for completeness and future migration
   *
   * @param {string[]} filePaths - 文件路径数组
   * @param {Object} options - 导入选项
   * @returns {Promise<Object>} 导入结果统计
   */
  ipcMain.handle('import:import-files', async (_event, filePaths, options) => {
    try {
      if (!fileImporter) {
        throw new Error('文件导入器未初始化');
      }

      // 设置事件监听器，向渲染进程发送进度
      fileImporter.on('import-progress', (data) => {
        if (mainWindow) {
          mainWindow.webContents.send('import:progress', data);
        }
      });

      fileImporter.on('import-complete', (data) => {
        if (mainWindow) {
          mainWindow.webContents.send('import:complete', data);
        }
      });

      const results = await fileImporter.importFiles(filePaths, options);

      // 批量导入成功后，重建RAG索引
      if (results.success.length > 0 && ragManager) {
        await ragManager.rebuildIndex();
      }

      return results;
    } catch (error) {
      console.error('[Import IPC] 批量导入文件失败:', error);
      throw error;
    }
  });

  // ============================================================
  // 文件格式检查 (File Format Validation)
  // ============================================================

  /**
   * 获取支持的文件格式列表
   * Channel: 'import:get-supported-formats'
   *
   * @returns {Promise<string[]>} 支持的文件扩展名列表
   */
  ipcMain.handle('import:get-supported-formats', async () => {
    try {
      if (!fileImporter) {
        throw new Error('文件导入器未初始化');
      }

      return fileImporter.getSupportedFormats();
    } catch (error) {
      console.error('[Import IPC] 获取支持格式失败:', error);
      throw error;
    }
  });

  /**
   * 检查文件是否支持导入
   * Channel: 'import:check-file'
   *
   * @param {string} filePath - 文件路径
   * @returns {Promise<Object>} 检查结果 { isSupported, fileType }
   */
  ipcMain.handle('import:check-file', async (_event, filePath) => {
    try {
      if (!fileImporter) {
        throw new Error('文件导入器未初始化');
      }

      const isSupported = fileImporter.isSupportedFile(filePath);
      const fileType = fileImporter.getFileType(filePath);

      return {
        isSupported,
        fileType,
      };
    } catch (error) {
      console.error('[Import IPC] 检查文件失败:', error);
      throw error;
    }
  });

  console.log('[Import IPC] Registered 5 import: handlers');
  console.log('[Import IPC] - import:select-files (ALREADY IN index.js:2072)');
  console.log('[Import IPC] - import:import-file (ALREADY IN index.js:2105)');
  console.log('[Import IPC] - import:import-files (ALREADY IN index.js:2147)');
  console.log('[Import IPC] - import:get-supported-formats');
  console.log('[Import IPC] - import:check-file');
}

module.exports = { registerImportIPC };
