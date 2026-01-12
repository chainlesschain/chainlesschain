const { ipcMain } = require('electron');
const { getPerformanceMonitor } = require('./performance-monitor');
const { getIPCPerformanceInterceptor } = require('./ipc-performance-interceptor');

/**
 * 注册性能监控IPC处理器
 */
function registerPerformanceIPC() {
  const performanceMonitor = getPerformanceMonitor();
  const ipcInterceptor = getIPCPerformanceInterceptor();

  // 启动性能监控
  ipcMain.handle('performance:start', async () => {
    try {
      performanceMonitor.start();
      return { success: true };
    } catch (error) {
      console.error('[PerformanceIPC] 启动监控失败:', error);
      return { success: false, error: error.message };
    }
  });

  // 停止性能监控
  ipcMain.handle('performance:stop', async () => {
    try {
      performanceMonitor.stop();
      return { success: true };
    } catch (error) {
      console.error('[PerformanceIPC] 停止监控失败:', error);
      return { success: false, error: error.message };
    }
  });

  // 获取性能摘要
  ipcMain.handle('performance:getSummary', async () => {
    try {
      const summary = performanceMonitor.getSummary();
      return { success: true, data: summary };
    } catch (error) {
      console.error('[PerformanceIPC] 获取摘要失败:', error);
      return { success: false, error: error.message };
    }
  });

  // 获取详细指标
  ipcMain.handle('performance:getMetrics', async () => {
    try {
      const metrics = performanceMonitor.getMetrics();
      return { success: true, data: metrics };
    } catch (error) {
      console.error('[PerformanceIPC] 获取指标失败:', error);
      return { success: false, error: error.message };
    }
  });

  // 获取系统CPU指标
  ipcMain.handle('performance:getCPUMetrics', async () => {
    try {
      const cpuMetrics = performanceMonitor.getCPUMetrics();
      return { success: true, data: cpuMetrics };
    } catch (error) {
      console.error('[PerformanceIPC] 获取CPU指标失败:', error);
      return { success: false, error: error.message };
    }
  });

  // 获取系统内存指标
  ipcMain.handle('performance:getMemoryMetrics', async () => {
    try {
      const memoryMetrics = performanceMonitor.getMemoryMetrics();
      return { success: true, data: memoryMetrics };
    } catch (error) {
      console.error('[PerformanceIPC] 获取内存指标失败:', error);
      return { success: false, error: error.message };
    }
  });

  // 获取活动IPC请求
  ipcMain.handle('performance:getActiveIPCRequests', async () => {
    try {
      const requests = ipcInterceptor.getActiveRequests();
      return { success: true, data: requests };
    } catch (error) {
      console.error('[PerformanceIPC] 获取活动请求失败:', error);
      return { success: false, error: error.message };
    }
  });

  // 获取慢IPC请求
  ipcMain.handle('performance:getSlowIPCRequests', async (event, threshold) => {
    try {
      const requests = ipcInterceptor.getSlowRequests(threshold);
      return { success: true, data: requests };
    } catch (error) {
      console.error('[PerformanceIPC] 获取慢请求失败:', error);
      return { success: false, error: error.message };
    }
  });

  // 清除历史数据
  ipcMain.handle('performance:clearHistory', async () => {
    try {
      performanceMonitor.clearHistory();
      return { success: true };
    } catch (error) {
      console.error('[PerformanceIPC] 清除历史失败:', error);
      return { success: false, error: error.message };
    }
  });

  // 更新配置
  ipcMain.handle('performance:updateConfig', async (event, config) => {
    try {
      performanceMonitor.updateConfig(config);
      return { success: true };
    } catch (error) {
      console.error('[PerformanceIPC] 更新配置失败:', error);
      return { success: false, error: error.message };
    }
  });

  // 导出性能报告
  ipcMain.handle('performance:exportReport', async () => {
    try {
      const report = performanceMonitor.exportReport();
      return { success: true, data: report };
    } catch (error) {
      console.error('[PerformanceIPC] 导出报告失败:', error);
      return { success: false, error: error.message };
    }
  });

  // 获取数据库慢查询
  ipcMain.handle('performance:getSlowQueries', async (event, limit = 50) => {
    try {
      const metrics = performanceMonitor.getMetrics();
      const slowQueries = metrics.database.slowQueries.slice(-limit);
      return { success: true, data: slowQueries };
    } catch (error) {
      console.error('[PerformanceIPC] 获取慢查询失败:', error);
      return { success: false, error: error.message };
    }
  });

  // 获取IPC慢调用
  ipcMain.handle('performance:getSlowIPCCalls', async (event, limit = 50) => {
    try {
      const metrics = performanceMonitor.getMetrics();
      const slowCalls = metrics.ipc.slowCalls.slice(-limit);
      return { success: true, data: slowCalls };
    } catch (error) {
      console.error('[PerformanceIPC] 获取慢调用失败:', error);
      return { success: false, error: error.message };
    }
  });

  console.log('[PerformanceIPC] 性能监控IPC处理器已注册');
}

module.exports = {
  registerPerformanceIPC
};
