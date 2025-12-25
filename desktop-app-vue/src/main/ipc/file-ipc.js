/**
 * 文件操作 IPC Handlers
 * 处理前端与文件系统之间的通信
 */

const { ipcMain, dialog } = require('electron');
const fs = require('fs').promises;
const path = require('path');

class FileIPC {
  constructor() {
    this.excelEngine = null;
    this.documentEngine = null;
  }

  /**
   * 设置引擎实例
   */
  setEngines({ excelEngine, documentEngine }) {
    if (excelEngine) {
      this.excelEngine = excelEngine;
    }
    if (documentEngine) {
      this.documentEngine = documentEngine;
    }
  }

  /**
   * 注册所有IPC handlers
   * @param {BrowserWindow} mainWindow - 主窗口实例
   */
  registerHandlers(mainWindow) {
    // ============ Excel相关操作 ============

    // 读取Excel文件
    ipcMain.handle('file:readExcel', async (event, filePath) => {
      try {
        console.log('[File IPC] 读取Excel文件:', filePath);

        // 确保excelEngine已加载
        if (!this.excelEngine) {
          this.excelEngine = require('../engines/excel-engine');
        }

        const data = await this.excelEngine.readExcel(filePath);

        return {
          success: true,
          data,
        };
      } catch (error) {
        console.error('[File IPC] 读取Excel失败:', error);
        return {
          success: false,
          error: error.message,
        };
      }
    });

    // 写入Excel文件
    ipcMain.handle('file:writeExcel', async (event, filePath, data) => {
      try {
        console.log('[File IPC] 写入Excel文件:', filePath);

        if (!this.excelEngine) {
          this.excelEngine = require('../engines/excel-engine');
        }

        const result = await this.excelEngine.writeExcel(filePath, data);

        return {
          success: true,
          ...result,
        };
      } catch (error) {
        console.error('[File IPC] 写入Excel失败:', error);
        return {
          success: false,
          error: error.message,
        };
      }
    });

    // Excel转JSON
    ipcMain.handle('file:excelToJSON', async (event, filePath, options) => {
      try {
        console.log('[File IPC] Excel转JSON:', filePath);

        if (!this.excelEngine) {
          this.excelEngine = require('../engines/excel-engine');
        }

        const data = await this.excelEngine.excelToJSON(filePath, options);

        return {
          success: true,
          data,
        };
      } catch (error) {
        console.error('[File IPC] Excel转JSON失败:', error);
        return {
          success: false,
          error: error.message,
        };
      }
    });

    // JSON转Excel
    ipcMain.handle('file:jsonToExcel', async (event, jsonData, filePath, options) => {
      try {
        console.log('[File IPC] JSON转Excel:', filePath);

        if (!this.excelEngine) {
          this.excelEngine = require('../engines/excel-engine');
        }

        const result = await this.excelEngine.jsonToExcel(jsonData, filePath, options);

        return {
          success: true,
          ...result,
        };
      } catch (error) {
        console.error('[File IPC] JSON转Excel失败:', error);
        return {
          success: false,
          error: error.message,
        };
      }
    });

    // ============ 通用文件操作 ============

    // 读取文件内容
    ipcMain.handle('file:readContent', async (event, filePath) => {
      try {
        console.log('[File IPC] 读取文件:', filePath);
        const content = await fs.readFile(filePath, 'utf-8');

        return {
          success: true,
          content,
        };
      } catch (error) {
        console.error('[File IPC] 读取文件失败:', error);
        return {
          success: false,
          error: error.message,
        };
      }
    });

    // 写入文件内容
    ipcMain.handle('file:writeContent', async (event, filePath, content) => {
      try {
        console.log('[File IPC] 写入文件:', filePath);

        // 确保目录存在
        const dir = path.dirname(filePath);
        await fs.mkdir(dir, { recursive: true });

        await fs.writeFile(filePath, content, 'utf-8');

        return {
          success: true,
          filePath,
        };
      } catch (error) {
        console.error('[File IPC] 写入文件失败:', error);
        return {
          success: false,
          error: error.message,
        };
      }
    });

    // 另存为文件
    ipcMain.handle('file:saveAs', async (event, sourceFilePath) => {
      try {
        console.log('[File IPC] 另存为文件:', sourceFilePath);

        // 显示保存对话框
        const result = await dialog.showSaveDialog(mainWindow, {
          defaultPath: path.basename(sourceFilePath),
        });

        if (result.canceled || !result.filePath) {
          return {
            success: false,
            canceled: true,
          };
        }

        // 复制文件
        await fs.copyFile(sourceFilePath, result.filePath);

        return {
          success: true,
          filePath: result.filePath,
        };
      } catch (error) {
        console.error('[File IPC] 另存为失败:', error);
        return {
          success: false,
          error: error.message,
        };
      }
    });

    // 文件是否存在
    ipcMain.handle('file:exists', async (event, filePath) => {
      try {
        await fs.access(filePath);
        return { success: true, exists: true };
      } catch (error) {
        return { success: true, exists: false };
      }
    });

    // 获取文件信息
    ipcMain.handle('file:stat', async (event, filePath) => {
      try {
        const stats = await fs.stat(filePath);
        return {
          success: true,
          stats: {
            size: stats.size,
            isFile: stats.isFile(),
            isDirectory: stats.isDirectory(),
            mtime: stats.mtime,
            ctime: stats.ctime,
          },
        };
      } catch (error) {
        console.error('[File IPC] 获取文件信息失败:', error);
        return {
          success: false,
          error: error.message,
        };
      }
    });

    // ============ 对话框操作 ============

    // 显示打开文件对话框
    ipcMain.handle('dialog:showOpenDialog', async (event, options) => {
      try {
        const result = await dialog.showOpenDialog(mainWindow, options);
        return {
          success: true,
          ...result,
        };
      } catch (error) {
        console.error('[File IPC] 打开文件对话框失败:', error);
        return {
          success: false,
          error: error.message,
        };
      }
    });

    // 显示保存文件对话框
    ipcMain.handle('dialog:showSaveDialog', async (event, options) => {
      try {
        const result = await dialog.showSaveDialog(mainWindow, options);
        return {
          success: true,
          ...result,
        };
      } catch (error) {
        console.error('[File IPC] 保存文件对话框失败:', error);
        return {
          success: false,
          error: error.message,
        };
      }
    });

    console.log('[File IPC] 文件操作IPC处理器已注册');
  }
}

module.exports = FileIPC;
