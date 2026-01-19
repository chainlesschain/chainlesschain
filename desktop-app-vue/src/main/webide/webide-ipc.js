/**
 * Web IDE IPC 处理器
 * 负责处理渲染进程和主进程之间的通信
 */

const { logger, createLogger } = require('../utils/logger.js');
const { ipcMain, app } = require('electron');
const fs = require('fs').promises;
const path = require('path');

class WebIDEIPC {
  constructor(webideManager, previewServer) {
    this.webideManager = webideManager;
    this.previewServer = previewServer;
    this.activeServers = new Map(); // 存储活动的预览服务器
  }

  /**
   * 注册所有 IPC handlers
   */
  registerHandlers() {
    logger.info('[WebIDE IPC] 注册 IPC handlers...');

    // 项目管理
    this.registerProjectHandlers();

    // 预览服务器
    this.registerPreviewHandlers();

    // 导出功能
    this.registerExportHandlers();

    logger.info('[WebIDE IPC] IPC handlers 注册完成');
  }

  /**
   * 注册项目管理相关的 handlers
   * @private
   */
  registerProjectHandlers() {
    // 保存项目
    ipcMain.handle('webide:saveProject', async (event, projectData) => {
      try {
        logger.info('[WebIDE IPC] 处理保存项目请求');

        const result = await this.webideManager.saveProject(projectData);

        return result;
      } catch (error) {
        logger.error('[WebIDE IPC] 保存项目失败:', error);
        return {
          success: false,
          error: error.message,
        };
      }
    });

    // 加载项目
    ipcMain.handle('webide:loadProject', async (event, projectId) => {
      try {
        logger.info(`[WebIDE IPC] 处理加载项目请求: ${projectId}`);

        const result = await this.webideManager.loadProject(projectId);

        return result;
      } catch (error) {
        logger.error('[WebIDE IPC] 加载项目失败:', error);
        return {
          success: false,
          error: error.message,
        };
      }
    });

    // 获取项目列表
    ipcMain.handle('webide:getProjectList', async () => {
      try {
        logger.info('[WebIDE IPC] 处理获取项目列表请求');

        const result = await this.webideManager.getProjectList();

        return result;
      } catch (error) {
        logger.error('[WebIDE IPC] 获取项目列表失败:', error);
        return {
          success: false,
          error: error.message,
          projects: [],
        };
      }
    });

    // 删除项目
    ipcMain.handle('webide:deleteProject', async (event, projectId) => {
      try {
        logger.info(`[WebIDE IPC] 处理删除项目请求: ${projectId}`);

        const result = await this.webideManager.deleteProject(projectId);

        return result;
      } catch (error) {
        logger.error('[WebIDE IPC] 删除项目失败:', error);
        return {
          success: false,
          error: error.message,
        };
      }
    });
  }

  /**
   * 注册预览服务器相关的 handlers
   * @private
   */
  registerPreviewHandlers() {
    // 启动开发服务器
    ipcMain.handle('webide:startDevServer', async (event, serverData) => {
      try {
        const { html, css, js, port = 3000 } = serverData;

        logger.info(`[WebIDE IPC] 启动开发服务器，端口: ${port}`);

        // 创建临时项目目录
        const tempPath = path.join(
          app.getPath('temp'),
          `webide-server-${Date.now()}`
        );

        await fs.mkdir(tempPath, { recursive: true });
        await fs.mkdir(path.join(tempPath, 'css'), { recursive: true });
        await fs.mkdir(path.join(tempPath, 'js'), { recursive: true });

        // 写入文件
        await Promise.all([
          fs.writeFile(
            path.join(tempPath, 'index.html'),
            `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Web IDE Preview</title>
  <link rel="stylesheet" href="css/style.css">
</head>
<body>
${html}
  <script src="js/script.js"></script>
</body>
</html>`,
            'utf-8'
          ),
          fs.writeFile(path.join(tempPath, 'css', 'style.css'), css, 'utf-8'),
          fs.writeFile(path.join(tempPath, 'js', 'script.js'), js, 'utf-8'),
        ]);

        // 启动预览服务器
        const result = await this.previewServer.start(tempPath, port);

        if (result.success) {
          // 保存服务器信息
          this.activeServers.set(port, {
            tempPath,
            port,
            url: result.url,
          });

          logger.info(`[WebIDE IPC] 开发服务器启动成功: ${result.url}`);
        }

        return result;
      } catch (error) {
        logger.error('[WebIDE IPC] 启动开发服务器失败:', error);
        return {
          success: false,
          error: error.message,
        };
      }
    });

    // 停止开发服务器
    ipcMain.handle('webide:stopDevServer', async (event, port = 3000) => {
      try {
        logger.info(`[WebIDE IPC] 停止开发服务器，端口: ${port}`);

        // 停止服务器
        const result = await this.previewServer.stop();

        // 清理临时文件
        const serverInfo = this.activeServers.get(port);
        if (serverInfo && serverInfo.tempPath) {
          try {
            await fs.rm(serverInfo.tempPath, { recursive: true, force: true });
            logger.info(`[WebIDE IPC] 临时文件已清理: ${serverInfo.tempPath}`);
          } catch (cleanError) {
            logger.warn('[WebIDE IPC] 清理临时文件失败:', cleanError);
          }
        }

        // 移除服务器记录
        this.activeServers.delete(port);

        logger.info('[WebIDE IPC] 开发服务器已停止');

        return result;
      } catch (error) {
        logger.error('[WebIDE IPC] 停止开发服务器失败:', error);
        return {
          success: false,
          error: error.message,
        };
      }
    });

    // 获取服务器状态
    ipcMain.handle('webide:getServerStatus', async () => {
      try {
        const status = this.previewServer.getStatus();

        return {
          success: true,
          ...status,
        };
      } catch (error) {
        logger.error('[WebIDE IPC] 获取服务器状态失败:', error);
        return {
          success: false,
          error: error.message,
          isRunning: false,
        };
      }
    });
  }

  /**
   * 注册导出功能相关的 handlers
   * @private
   */
  registerExportHandlers() {
    // 导出 HTML
    ipcMain.handle('webide:exportHTML', async (event, exportData) => {
      try {
        logger.info('[WebIDE IPC] 处理导出 HTML 请求');

        const result = await this.webideManager.exportHTML(exportData);

        return result;
      } catch (error) {
        logger.error('[WebIDE IPC] 导出 HTML 失败:', error);
        return {
          success: false,
          error: error.message,
        };
      }
    });

    // 导出 ZIP
    ipcMain.handle('webide:exportZIP', async (event, exportData) => {
      try {
        logger.info('[WebIDE IPC] 处理导出 ZIP 请求');

        const result = await this.webideManager.exportZIP(exportData);

        return result;
      } catch (error) {
        logger.error('[WebIDE IPC] 导出 ZIP 失败:', error);
        return {
          success: false,
          error: error.message,
        };
      }
    });

    // 截图功能（可选，暂时返回成功）
    ipcMain.handle('webide:captureScreenshot', async (event, options) => {
      try {
        logger.info('[WebIDE IPC] 处理截图请求');

        // TODO: 实现截图功能
        // 可以使用 Electron 的 webContents.capturePage()

        return {
          success: true,
          message: '截图功能开发中',
        };
      } catch (error) {
        logger.error('[WebIDE IPC] 截图失败:', error);
        return {
          success: false,
          error: error.message,
        };
      }
    });
  }

  /**
   * 清理所有活动的服务器
   */
  async cleanup() {
    logger.info('[WebIDE IPC] 清理所有活动服务器...');

    for (const [port, serverInfo] of this.activeServers.entries()) {
      try {
        // 停止服务器
        await this.previewServer.stop();

        // 清理临时文件
        if (serverInfo.tempPath) {
          await fs.rm(serverInfo.tempPath, { recursive: true, force: true });
        }

        logger.info(`[WebIDE IPC] 服务器已清理: ${port}`);
      } catch (error) {
        logger.error(`[WebIDE IPC] 清理服务器失败 (端口 ${port}):`, error);
      }
    }

    this.activeServers.clear();
    logger.info('[WebIDE IPC] 清理完成');
  }
}

module.exports = WebIDEIPC;
