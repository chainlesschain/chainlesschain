/**
 * Backend Service Integration Patch
 *
 * 在主进程index.js中添加以下代码来集成后端服务管理器
 *
 * 修改步骤：
 * 1. 在文件顶部导入后端服务管理器
 * 2. 在 setupApp() 中添加 will-quit 事件监听
 * 3. 在 onReady() 开始时启动后端服务
 * 4. 添加IPC处理程序用于服务状态查询
 */

// ==========================================
// 步骤1: 在文件顶部添加导入（约第67行之后）
// ==========================================
/*
const { getBackendServiceManager } = require('./backend-service-manager');
*/

// ==========================================
// 步骤2: 在 setupApp() 方法中添加（约第260行之后）
// ==========================================
/*
    app.whenReady().then(() => this.onReady());
    app.on('window-all-closed', () => this.onWindowAllClosed());
    app.on('activate', () => this.onActivate());

    // 添加以下代码：
    app.on('will-quit', async (event) => {
      event.preventDefault();
      console.log('[Main] Application is quitting, stopping backend services...');
      const backendManager = getBackendServiceManager();
      await backendManager.stopServices();
      app.exit(0);
    });
*/

// ==========================================
// 步骤3: 在 onReady() 方法开始时添加（约第265行之后）
// ==========================================
/*
  async onReady() {
    console.log('ChainlessChain Vue 启动中...');

    // 添加以下代码：
    // 启动后端服务（仅在生产环境）
    try {
      const backendManager = getBackendServiceManager();
      await backendManager.startServices();
    } catch (error) {
      console.error('[Main] Failed to start backend services:', error);
      // 继续启动应用，即使后端服务启动失败
    }

    // 原有代码继续...
    // IPC handlers
    try {
*/

// ==========================================
// 步骤4: 在 registerCoreIPCHandlers() 中添加（搜索 "Register core IPC handlers"）
// ==========================================
/*
    // 后端服务管理 IPC handlers
    ipcMain.handle('backend-service:get-status', async () => {
      try {
        const backendManager = getBackendServiceManager();
        return await backendManager.getServicesStatus();
      } catch (error) {
        console.error('[Main] Failed to get backend service status:', error);
        return { error: error.message };
      }
    });

    ipcMain.handle('backend-service:restart', async () => {
      try {
        const backendManager = getBackendServiceManager();
        await backendManager.restartServices();
        return { success: true };
      } catch (error) {
        console.error('[Main] Failed to restart backend services:', error);
        return { error: error.message };
      }
    });
*/

// ==========================================
// 完整的代码片段示例
// ==========================================

module.exports = {
  // 导入语句（在文件顶部添加）
  importStatement: `const { getBackendServiceManager } = require('./backend-service-manager');`,

  // 退出事件处理（在 setupApp() 中添加）
  willQuitHandler: `
    // 应用退出时停止后端服务
    app.on('will-quit', async (event) => {
      event.preventDefault();
      console.log('[Main] Application is quitting, stopping backend services...');
      const backendManager = getBackendServiceManager();
      await backendManager.stopServices();
      app.exit(0);
    });`,

  // 启动服务代码（在 onReady() 开始时添加）
  startServicesCode: `
    // 启动后端服务（仅在生产环境）
    try {
      const backendManager = getBackendServiceManager();
      await backendManager.startServices();
    } catch (error) {
      console.error('[Main] Failed to start backend services:', error);
      // 继续启动应用，即使后端服务启动失败
    }`,

  // IPC处理程序（在 registerCoreIPCHandlers() 中添加）
  ipcHandlers: `
    // 后端服务管理 IPC handlers
    ipcMain.handle('backend-service:get-status', async () => {
      try {
        const backendManager = getBackendServiceManager();
        return await backendManager.getServicesStatus();
      } catch (error) {
        console.error('[Main] Failed to get backend service status:', error);
        return { error: error.message };
      }
    });

    ipcMain.handle('backend-service:restart', async () => {
      try {
        const backendManager = getBackendServiceManager();
        await backendManager.restartServices();
        return { success: true };
      } catch (error) {
        console.error('[Main] Failed to restart backend services:', error);
        return { error: error.message };
      }
    });`
};

// ==========================================
// 使用说明
// ==========================================
/*
由于自动修改大型文件可能导致问题，请手动将上述代码片段添加到 index.js 的相应位置。

或者，如果需要自动化，可以创建一个简单的脚本来执行这些修改：

const fs = require('fs');
const path = require('path');

const indexPath = path.join(__dirname, 'index.js');
let content = fs.readFileSync(indexPath, 'utf8');

// 1. 添加导入
const importLine = 67;
const lines = content.split('\n');
lines.splice(importLine, 0, "const { getBackendServiceManager } = require('./backend-service-manager');");
content = lines.join('\n');

// 2. 查找并修改相应位置...
// （具体实现根据需要）

fs.writeFileSync(indexPath, content, 'utf8');
*/
