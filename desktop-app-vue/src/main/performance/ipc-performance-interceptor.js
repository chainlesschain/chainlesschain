const { logger, createLogger } = require('../utils/logger.js');
const { performance } = require('perf_hooks');
const { getPerformanceMonitor } = require('./performance-monitor');

/**
 * IPC性能拦截器
 * 自动跟踪所有IPC调用的性能
 */
class IPCPerformanceInterceptor {
  constructor() {
    this.performanceMonitor = getPerformanceMonitor();
    this.activeRequests = new Map();
  }

  /**
   * 注册IPC性能监控
   * @param {Electron.IpcMain} ipcMain - Electron IPC主进程对象
   */
  register(ipcMain) {
    // 保存原始的handle方法
    const originalHandle = ipcMain.handle.bind(ipcMain);

    // 包装handle方法
    ipcMain.handle = (channel, listener) => {
      const wrappedListener = async (event, ...args) => {
        const requestId = `${channel}-${Date.now()}-${Math.random()}`;
        const startTime = performance.now();

        this.activeRequests.set(requestId, {
          channel,
          startTime,
          args: args.length
        });

        try {
          const result = await listener(event, ...args);
          const duration = performance.now() - startTime;

          // 记录IPC调用性能
          this.performanceMonitor.recordIPCCall(channel, duration, {
            argsCount: args.length,
            success: true
          });

          this.activeRequests.delete(requestId);
          return result;
        } catch (error) {
          const duration = performance.now() - startTime;

          this.performanceMonitor.recordIPCCall(channel, duration, {
            argsCount: args.length,
            success: false,
            error: error.message
          });

          this.activeRequests.delete(requestId);
          throw error;
        }
      };

      return originalHandle(channel, wrappedListener);
    };

    logger.info('[IPCPerformanceInterceptor] IPC性能监控已注册');
  }

  /**
   * 获取活动请求
   */
  getActiveRequests() {
    const now = performance.now();
    const requests = [];

    for (const [id, request] of this.activeRequests.entries()) {
      requests.push({
        id,
        channel: request.channel,
        duration: now - request.startTime,
        args: request.args
      });
    }

    return requests;
  }

  /**
   * 获取慢请求
   */
  getSlowRequests(threshold = 1000) {
    return this.getActiveRequests().filter(req => req.duration > threshold);
  }
}

// 单例实例
let ipcInterceptorInstance = null;

/**
 * 获取IPC性能拦截器实例
 */
function getIPCPerformanceInterceptor() {
  if (!ipcInterceptorInstance) {
    ipcInterceptorInstance = new IPCPerformanceInterceptor();
  }
  return ipcInterceptorInstance;
}

module.exports = {
  IPCPerformanceInterceptor,
  getIPCPerformanceInterceptor
};
