/**
 * Browser IPC 接口
 * 为渲染进程提供浏览器控制功能
 *
 * @module browser/browser-ipc
 * @author ChainlessChain Team
 * @since v0.27.0
 */

const { ipcMain, app } = require('electron');
const path = require('path');
const { BrowserEngine } = require('./browser-engine');
const { createIPCErrorHandler } = require('../utils/ipc-error-handler');
const { logger } = require('../utils/logger');

// 创建浏览器引擎实例
let browserEngine = null;

/**
 * 获取浏览器引擎实例
 * @returns {BrowserEngine}
 */
function getBrowserEngine() {
  if (!browserEngine) {
    const profileDir = path.join(
      app.getPath('userData'),
      '.browser-profiles'
    );

    browserEngine = new BrowserEngine({
      headless: false,
      cdpPort: 18800,
      profileDir
    });

    // 监听事件并记录日志
    browserEngine.on('browser:started', (data) => {
      logger.info('[Browser] Browser started', data);
    });

    browserEngine.on('browser:stopped', (data) => {
      logger.info('[Browser] Browser stopped', data);
    });

    browserEngine.on('browser:error', (data) => {
      logger.error('[Browser] Browser error', data);
    });

    browserEngine.on('tab:opened', (data) => {
      logger.info('[Browser] Tab opened', data);
    });

    browserEngine.on('tab:closed', (data) => {
      logger.info('[Browser] Tab closed', data);
    });
  }

  return browserEngine;
}

/**
 * 注册所有 Browser IPC 处理器
 */
function registerBrowserIPC() {
  const withErrorHandler = createIPCErrorHandler('browser');

  // ==================== 浏览器生命周期 ====================

  /**
   * 启动浏览器
   * @param {Object} options - 启动选项
   * @param {boolean} options.headless - 是否无头模式
   * @param {string} options.channel - 浏览器渠道 (chrome/msedge)
   * @returns {Promise<Object>} { success, cdpPort, pid }
   */
  ipcMain.handle('browser:start', withErrorHandler(async (event, options = {}) => {
    const engine = getBrowserEngine();
    const result = await engine.start(options);

    logger.info('[Browser IPC] Browser started', {
      cdpPort: result.cdpPort,
      pid: result.pid
    });

    return result;
  }));

  /**
   * 停止浏览器
   * @returns {Promise<Object>} { success, uptime }
   */
  ipcMain.handle('browser:stop', withErrorHandler(async (event) => {
    const engine = getBrowserEngine();
    const result = await engine.stop();

    logger.info('[Browser IPC] Browser stopped', {
      uptime: result.uptime
    });

    return result;
  }));

  /**
   * 获取浏览器状态
   * @returns {Promise<Object>} 状态信息
   */
  ipcMain.handle('browser:getStatus', withErrorHandler(async (event) => {
    const engine = getBrowserEngine();
    return engine.getStatus();
  }));

  // ==================== 上下文（Profile）管理 ====================

  /**
   * 创建浏览器上下文
   * @param {string} profileName - Profile 名称
   * @param {Object} options - 上下文选项
   * @returns {Promise<Object>} { success, profileName, exists }
   */
  ipcMain.handle('browser:createContext', withErrorHandler(async (event, profileName, options = {}) => {
    const engine = getBrowserEngine();
    const result = await engine.createContext(profileName, options);

    logger.info('[Browser IPC] Context created', {
      profileName,
      exists: result.exists
    });

    return result;
  }));

  // ==================== 标签页管理 ====================

  /**
   * 打开新标签页
   * @param {string} profileName - Profile 名称
   * @param {string} url - 目标 URL
   * @param {Object} options - 打开选项
   * @returns {Promise<Object>} { success, targetId, url, title }
   */
  ipcMain.handle('browser:openTab', withErrorHandler(async (event, profileName, url, options = {}) => {
    const engine = getBrowserEngine();
    const result = await engine.openTab(profileName, url, options);

    logger.info('[Browser IPC] Tab opened', {
      targetId: result.targetId,
      url: result.url,
      profileName
    });

    return result;
  }));

  /**
   * 关闭标签页
   * @param {string} targetId - 标签页 ID
   * @returns {Promise<Object>} { success, targetId }
   */
  ipcMain.handle('browser:closeTab', withErrorHandler(async (event, targetId) => {
    const engine = getBrowserEngine();
    const result = await engine.closeTab(targetId);

    logger.info('[Browser IPC] Tab closed', { targetId });

    return result;
  }));

  /**
   * 聚焦标签页
   * @param {string} targetId - 标签页 ID
   * @returns {Promise<Object>} { success, targetId }
   */
  ipcMain.handle('browser:focusTab', withErrorHandler(async (event, targetId) => {
    const engine = getBrowserEngine();
    const result = await engine.focusTab(targetId);

    logger.info('[Browser IPC] Tab focused', { targetId });

    return result;
  }));

  /**
   * 列出所有标签页
   * @param {string} profileName - Profile 名称（可选）
   * @returns {Promise<Array>} 标签页列表
   */
  ipcMain.handle('browser:listTabs', withErrorHandler(async (event, profileName = null) => {
    const engine = getBrowserEngine();
    const tabs = await engine.listTabs(profileName);

    logger.debug('[Browser IPC] List tabs', {
      profileName,
      count: tabs.length
    });

    return tabs;
  }));

  // ==================== 页面操作 ====================

  /**
   * 导航到指定 URL
   * @param {string} targetId - 标签页 ID
   * @param {string} url - 目标 URL
   * @param {Object} options - 导航选项
   * @returns {Promise<Object>} { success, url, title }
   */
  ipcMain.handle('browser:navigate', withErrorHandler(async (event, targetId, url, options = {}) => {
    const engine = getBrowserEngine();
    const result = await engine.navigate(targetId, url, options);

    logger.info('[Browser IPC] Navigated', {
      targetId,
      url: result.url
    });

    return result;
  }));

  /**
   * 截图
   * @param {string} targetId - 标签页 ID
   * @param {Object} options - 截图选项
   * @returns {Promise<Object>} { screenshot: base64 }
   */
  ipcMain.handle('browser:screenshot', withErrorHandler(async (event, targetId, options = {}) => {
    const engine = getBrowserEngine();
    const buffer = await engine.screenshot(targetId, options);

    logger.info('[Browser IPC] Screenshot taken', {
      targetId,
      size: buffer.length
    });

    // 返回 base64 编码的截图
    return {
      screenshot: buffer.toString('base64'),
      type: options.type || 'png'
    };
  }));

  // ==================== 会话管理 ====================

  /**
   * 保存会话状态
   * @param {string} profileName - Profile 名称
   * @param {string} stateFile - 状态文件路径（可选）
   * @returns {Promise<Object>} { success, stateFile, cookiesCount, originsCount }
   */
  ipcMain.handle('browser:saveSession', withErrorHandler(async (event, profileName, stateFile = null) => {
    const engine = getBrowserEngine();
    const result = await engine.saveSession(profileName, stateFile);

    logger.info('[Browser IPC] Session saved', {
      profileName,
      stateFile: result.stateFile,
      cookiesCount: result.cookiesCount
    });

    return result;
  }));

  /**
   * 恢复会话状态
   * @param {string} profileName - Profile 名称
   * @param {string} stateFile - 状态文件路径（可选）
   * @returns {Promise<Object>} { success, profileName, cookiesCount, originsCount }
   */
  ipcMain.handle('browser:restoreSession', withErrorHandler(async (event, profileName, stateFile = null) => {
    const engine = getBrowserEngine();
    const result = await engine.restoreSession(profileName, stateFile);

    logger.info('[Browser IPC] Session restored', {
      profileName,
      cookiesCount: result.cookiesCount
    });

    return result;
  }));

  // ==================== Phase 2: 智能快照和元素操作 ====================

  /**
   * 获取页面快照
   * @param {string} targetId - 标签页 ID
   * @param {Object} options - 快照选项
   * @returns {Promise<Object>} 快照对象
   */
  ipcMain.handle('browser:snapshot', withErrorHandler(async (event, targetId, options = {}) => {
    const engine = getBrowserEngine();
    const snapshot = await engine.takeSnapshot(targetId, options);

    logger.info('[Browser IPC] Snapshot taken', {
      targetId,
      elementsCount: snapshot.elementsCount
    });

    return snapshot;
  }));

  /**
   * 执行元素操作
   * @param {string} targetId - 标签页 ID
   * @param {string} action - 操作类型 (click/type/select/drag/hover)
   * @param {string} ref - 元素引用
   * @param {Object} options - 操作选项
   * @returns {Promise<Object>} 操作结果
   */
  ipcMain.handle('browser:act', withErrorHandler(async (event, targetId, action, ref, options = {}) => {
    const engine = getBrowserEngine();
    const result = await engine.act(targetId, action, ref, options);

    logger.info('[Browser IPC] Element action executed', {
      targetId,
      action,
      ref
    });

    return result;
  }));

  /**
   * 查找元素
   * @param {string} targetId - 标签页 ID
   * @param {string} ref - 元素引用
   * @returns {Promise<Object>} 元素对象
   */
  ipcMain.handle('browser:findElement', withErrorHandler(async (event, targetId, ref) => {
    const engine = getBrowserEngine();
    const element = engine.findElement(targetId, ref);

    if (!element) {
      throw new Error(`Element ${ref} not found`);
    }

    logger.debug('[Browser IPC] Element found', { targetId, ref });

    return element;
  }));

  /**
   * 验证引用是否有效
   * @param {string} targetId - 标签页 ID
   * @param {string} ref - 元素引用
   * @returns {Promise<boolean>}
   */
  ipcMain.handle('browser:validateRef', withErrorHandler(async (event, targetId, ref) => {
    const engine = getBrowserEngine();
    const isValid = engine.validateRef(targetId, ref);

    logger.debug('[Browser IPC] Reference validated', {
      targetId,
      ref,
      isValid
    });

    return isValid;
  }));

  /**
   * 清除快照缓存
   * @param {string} targetId - 标签页 ID（可选）
   * @returns {Promise<Object>}
   */
  ipcMain.handle('browser:clearSnapshot', withErrorHandler(async (event, targetId = null) => {
    const engine = getBrowserEngine();
    engine.clearSnapshot(targetId);

    logger.info('[Browser IPC] Snapshot cleared', { targetId });

    return { success: true };
  }));

  /**
   * 获取快照统计
   * @returns {Promise<Object>}
   */
  ipcMain.handle('browser:getSnapshotStats', withErrorHandler(async (event) => {
    const engine = getBrowserEngine();
    const stats = engine.getSnapshotStats();

    logger.debug('[Browser IPC] Snapshot stats retrieved', {
      totalSnapshots: stats.totalSnapshots
    });

    return stats;
  }));

  logger.info('[Browser IPC] All Browser IPC handlers registered (Phase 1 + Phase 2)');
}

/**
 * 清理资源
 */
async function cleanupBrowser() {
  if (browserEngine) {
    try {
      await browserEngine.cleanup();
      logger.info('[Browser] Cleanup completed');
    } catch (error) {
      logger.error('[Browser] Cleanup error', { error: error.message });
    }
  }
}

module.exports = {
  registerBrowserIPC,
  getBrowserEngine,
  cleanupBrowser
};
