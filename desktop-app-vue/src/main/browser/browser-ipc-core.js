/**
 * Browser IPC handlers — core group.
 * Split verbatim from browser-ipc.js registerBrowserIPC(); see that file for
 * the shared ctx ({ _ipcMain, _getBrowserEngine, _getAutomationAgent,
 * withErrorHandler, getBrowserEngine }).
 *
 * @module browser/browser-ipc-core
 */
const { logger } = require("../utils/logger");

function registerCoreHandlers(ctx) {
  const { _ipcMain, _getBrowserEngine, withErrorHandler } = ctx;

  // ==================== 浏览器生命周期 ====================

  /**
   * 启动浏览器
   * @param {Object} options - 启动选项
   * @param {boolean} options.headless - 是否无头模式
   * @param {string} options.channel - 浏览器渠道 (chrome/msedge)
   * @returns {Promise<Object>} { success, cdpPort, pid }
   */
  _ipcMain.handle(
    "browser:start",
    withErrorHandler(async (event, options = {}) => {
      const engine = _getBrowserEngine();
      const result = await engine.start(options);

      logger.info("[Browser IPC] Browser started", {
        cdpPort: result.cdpPort,
        pid: result.pid,
      });

      return result;
    }),
  );

  /**
   * 停止浏览器
   * @returns {Promise<Object>} { success, uptime }
   */
  _ipcMain.handle(
    "browser:stop",
    withErrorHandler(async (event) => {
      const engine = _getBrowserEngine();
      const result = await engine.stop();

      logger.info("[Browser IPC] Browser stopped", {
        uptime: result.uptime,
      });

      return result;
    }),
  );

  /**
   * 获取浏览器状态
   * @returns {Promise<Object>} 状态信息
   */
  _ipcMain.handle(
    "browser:getStatus",
    withErrorHandler(async (event) => {
      const engine = _getBrowserEngine();
      return engine.getStatus();
    }),
  );

  // ==================== 上下文（Profile）管理 ====================

  /**
   * 创建浏览器上下文
   * @param {string} profileName - Profile 名称
   * @param {Object} options - 上下文选项
   * @returns {Promise<Object>} { success, profileName, exists }
   */
  _ipcMain.handle(
    "browser:createContext",
    withErrorHandler(async (event, profileName, options = {}) => {
      const engine = _getBrowserEngine();
      const result = await engine.createContext(profileName, options);

      logger.info("[Browser IPC] Context created", {
        profileName,
        exists: result.exists,
      });

      return result;
    }),
  );

  // ==================== 标签页管理 ====================

  /**
   * 打开新标签页
   * @param {string} profileName - Profile 名称
   * @param {string} url - 目标 URL
   * @param {Object} options - 打开选项
   * @returns {Promise<Object>} { success, targetId, url, title }
   */
  _ipcMain.handle(
    "browser:openTab",
    withErrorHandler(async (event, profileName, url, options = {}) => {
      const engine = _getBrowserEngine();
      const result = await engine.openTab(profileName, url, options);

      logger.info("[Browser IPC] Tab opened", {
        targetId: result.targetId,
        url: result.url,
        profileName,
      });

      return result;
    }),
  );

  /**
   * 关闭标签页
   * @param {string} targetId - 标签页 ID
   * @returns {Promise<Object>} { success, targetId }
   */
  _ipcMain.handle(
    "browser:closeTab",
    withErrorHandler(async (event, targetId) => {
      const engine = _getBrowserEngine();
      const result = await engine.closeTab(targetId);

      logger.info("[Browser IPC] Tab closed", { targetId });

      return result;
    }),
  );

  /**
   * 聚焦标签页
   * @param {string} targetId - 标签页 ID
   * @returns {Promise<Object>} { success, targetId }
   */
  _ipcMain.handle(
    "browser:focusTab",
    withErrorHandler(async (event, targetId) => {
      const engine = _getBrowserEngine();
      const result = await engine.focusTab(targetId);

      logger.info("[Browser IPC] Tab focused", { targetId });

      return result;
    }),
  );

  /**
   * 列出所有标签页
   * @param {string} profileName - Profile 名称（可选）
   * @returns {Promise<Array>} 标签页列表
   */
  _ipcMain.handle(
    "browser:listTabs",
    withErrorHandler(async (event, profileName = null) => {
      const engine = _getBrowserEngine();
      const tabs = await engine.listTabs(profileName);

      logger.debug("[Browser IPC] List tabs", {
        profileName,
        count: tabs.length,
      });

      return tabs;
    }),
  );

  // ==================== 页面操作 ====================

  /**
   * 导航到指定 URL
   * @param {string} targetId - 标签页 ID
   * @param {string} url - 目标 URL
   * @param {Object} options - 导航选项
   * @returns {Promise<Object>} { success, url, title }
   */
  _ipcMain.handle(
    "browser:navigate",
    withErrorHandler(async (event, targetId, url, options = {}) => {
      const engine = _getBrowserEngine();
      const result = await engine.navigate(targetId, url, options);

      logger.info("[Browser IPC] Navigated", {
        targetId,
        url: result.url,
      });

      return result;
    }),
  );

  /**
   * 截图
   * @param {string} targetId - 标签页 ID
   * @param {Object} options - 截图选项
   * @returns {Promise<Object>} { screenshot: base64 }
   */
  _ipcMain.handle(
    "browser:screenshot",
    withErrorHandler(async (event, targetId, options = {}) => {
      const engine = _getBrowserEngine();
      const buffer = await engine.screenshot(targetId, options);

      logger.info("[Browser IPC] Screenshot taken", {
        targetId,
        size: buffer.length,
      });

      // 返回 base64 编码的截图
      return {
        screenshot: buffer.toString("base64"),
        type: options.type || "png",
      };
    }),
  );

  // ==================== 会话管理 ====================

  /**
   * 保存会话状态
   * @param {string} profileName - Profile 名称
   * @param {string} stateFile - 状态文件路径（可选）
   * @returns {Promise<Object>} { success, stateFile, cookiesCount, originsCount }
   */
  _ipcMain.handle(
    "browser:saveSession",
    withErrorHandler(async (event, profileName, stateFile = null) => {
      const engine = _getBrowserEngine();
      const result = await engine.saveSession(profileName, stateFile);

      logger.info("[Browser IPC] Session saved", {
        profileName,
        stateFile: result.stateFile,
        cookiesCount: result.cookiesCount,
      });

      return result;
    }),
  );

  /**
   * 恢复会话状态
   * @param {string} profileName - Profile 名称
   * @param {string} stateFile - 状态文件路径（可选）
   * @returns {Promise<Object>} { success, profileName, cookiesCount, originsCount }
   */
  _ipcMain.handle(
    "browser:restoreSession",
    withErrorHandler(async (event, profileName, stateFile = null) => {
      const engine = _getBrowserEngine();
      const result = await engine.restoreSession(profileName, stateFile);

      logger.info("[Browser IPC] Session restored", {
        profileName,
        cookiesCount: result.cookiesCount,
      });

      return result;
    }),
  );
}

module.exports = { registerCoreHandlers };
