/**
 * 联网搜索IPC处理器
 */

const { logger, createLogger } = require('./logger.js');
const { ipcMain } = require('electron');
const {
  search,
  searchDuckDuckGo,
  searchBing,
  formatSearchResults
} = require('./web-search');

/**
 * 注册联网搜索IPC handlers
 */
function registerWebSearchIPC() {
  /**
   * 通用搜索
   */
  ipcMain.handle('webSearch:search', async (_event, query, options = {}) => {
    try {
      logger.info('[WebSearch IPC] 搜索:', query);
      const result = await search(query, options);
      return {
        success: true,
        ...result
      };
    } catch (error) {
      logger.error('[WebSearch IPC] 搜索失败:', error);
      return {
        success: false,
        error: error.message
      };
    }
  });

  /**
   * DuckDuckGo搜索
   */
  ipcMain.handle('webSearch:duckduckgo', async (_event, query, options = {}) => {
    try {
      logger.info('[WebSearch IPC] DuckDuckGo搜索:', query);
      const result = await searchDuckDuckGo(query, options);
      return {
        success: true,
        ...result
      };
    } catch (error) {
      logger.error('[WebSearch IPC] DuckDuckGo搜索失败:', error);
      return {
        success: false,
        error: error.message
      };
    }
  });

  /**
   * Bing搜索
   */
  ipcMain.handle('webSearch:bing', async (_event, query, options = {}) => {
    try {
      logger.info('[WebSearch IPC] Bing搜索:', query);
      const result = await searchBing(query, options);
      return {
        success: true,
        ...result
      };
    } catch (error) {
      logger.error('[WebSearch IPC] Bing搜索失败:', error);
      return {
        success: false,
        error: error.message
      };
    }
  });

  /**
   * 格式化搜索结果
   */
  ipcMain.handle('webSearch:format', async (_event, searchResult) => {
    try {
      const formatted = formatSearchResults(searchResult);
      return {
        success: true,
        formatted
      };
    } catch (error) {
      logger.error('[WebSearch IPC] 格式化失败:', error);
      return {
        success: false,
        error: error.message
      };
    }
  });

  logger.info('[WebSearch IPC] 已注册4个联网搜索handlers');
}

/**
 * 注销IPC handlers
 */
function unregisterWebSearchIPC() {
  const channels = [
    'webSearch:search',
    'webSearch:duckduckgo',
    'webSearch:bing',
    'webSearch:format'
  ];

  channels.forEach(channel => {
    ipcMain.removeHandler(channel);
  });

  logger.info('[WebSearch IPC] 已注销所有handlers');
}

module.exports = {
  registerWebSearchIPC,
  unregisterWebSearchIPC
};
