// IPC通信封装
const api = window.electronAPI;

/**
 * 需要重试逻辑的 IPC 通道（在启动时可能未就绪）
 */
const STARTUP_RETRY_CHANNELS = [
  'project:get-all',
  'template:getAll',
  'notification:get-all',
  'chat:get-sessions',
  'friend:get-friends',
];

/**
 * IPC 重试配置
 */
const RETRY_CONFIG = {
  maxRetries: 5,          // 最大重试次数
  initialDelay: 100,      // 初始延迟 (毫秒)
  maxDelay: 2000,         // 最大延迟 (毫秒)
  backoffMultiplier: 2,   // 延迟倍增因子
  retryableErrors: [
    'No handler registered',
    'handler not found',
    'ECONNREFUSED',
  ]
};

/**
 * 检查错误是否可重试
 */
function isRetryableError(error) {
  if (!error) return false;
  const errorMessage = error.message || String(error);
  return RETRY_CONFIG.retryableErrors.some(pattern =>
    errorMessage.includes(pattern)
  );
}

/**
 * 延迟函数
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * IPC 调用重试包装器
 *
 * @param {Function} ipcCall - IPC 调用函数
 * @param {Object} options - 重试选项
 * @param {number} options.maxRetries - 最大重试次数
 * @param {number} options.initialDelay - 初始延迟
 * @param {boolean} options.silentErrors - 是否静默错误（不在控制台输出）
 * @returns {Promise} IPC 调用结果
 */
export async function ipcWithRetry(ipcCall, options = {}) {
  const {
    maxRetries = RETRY_CONFIG.maxRetries,
    initialDelay = RETRY_CONFIG.initialDelay,
    silentErrors = false,
  } = options;

  let lastError;
  let currentDelay = initialDelay;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // 第一次尝试直接调用，后续尝试先延迟
      if (attempt > 0) {
        if (!silentErrors) {
          console.log(`[IPC Retry] 第 ${attempt} 次重试，延迟 ${currentDelay}ms...`);
        }
        await delay(currentDelay);
        // 指数退避
        currentDelay = Math.min(currentDelay * RETRY_CONFIG.backoffMultiplier, RETRY_CONFIG.maxDelay);
      }

      const result = await ipcCall();

      // 如果之前有重试，记录成功信息
      if (attempt > 0 && !silentErrors) {
        console.log(`[IPC Retry] 第 ${attempt} 次重试成功`);
      }

      return result;
    } catch (error) {
      lastError = error;

      // 检查是否可重试
      if (!isRetryableError(error)) {
        if (!silentErrors) {
          console.warn('[IPC Retry] 不可重试的错误:', error.message);
        }
        throw error;
      }

      // 如果已达到最大重试次数，抛出错误
      if (attempt >= maxRetries) {
        if (!silentErrors) {
          console.error(`[IPC Retry] 达到最大重试次数 (${maxRetries})，放弃重试`);
        }
        throw lastError;
      }

      // 记录重试信息
      if (!silentErrors) {
        console.warn(`[IPC Retry] IPC 调用失败 (尝试 ${attempt + 1}/${maxRetries + 1}):`, error.message);
      }
    }
  }

  throw lastError;
}

/**
 * 创建带重试的 IPC 调用包装器
 *
 * @param {Object} ipcObject - IPC 对象 (如 window.electron.ipcRenderer)
 * @param {Object} options - 重试选项
 * @returns {Object} 包装后的 IPC 对象
 */
export function createRetryableIPC(ipcObject, options = {}) {
  return {
    invoke: (channel, ...args) => ipcWithRetry(
      () => ipcObject.invoke(channel, ...args),
      options
    ),
    // 保留其他方法不变
    on: ipcObject.on?.bind(ipcObject),
    once: ipcObject.once?.bind(ipcObject),
    removeListener: ipcObject.removeListener?.bind(ipcObject),
    removeAllListeners: ipcObject.removeAllListeners?.bind(ipcObject),
  };
}

// U盾API
export const ukeyAPI = {
  detect: () => api.ukey.detect(),
  verifyPIN: (pin) => api.ukey.verifyPIN(pin),
};

// 认证API
export const authAPI = {
  verifyPassword: (username, password) => api.auth.verifyPassword(username, password),
};

// 数据库API
export const dbAPI = {
  getKnowledgeItems: () => api.db.getKnowledgeItems(),
  getKnowledgeItemById: (id) => api.db.getKnowledgeItemById(id),
  addKnowledgeItem: (item) => api.db.addKnowledgeItem(item),
  updateKnowledgeItem: (id, updates) => api.db.updateKnowledgeItem(id, updates),
  deleteKnowledgeItem: (id) => api.db.deleteKnowledgeItem(id),
  searchKnowledgeItems: (query) => api.db.searchKnowledgeItems(query),
};

// LLM API
export const llmAPI = {
  checkStatus: () => api.llm.checkStatus(),
  query: (prompt, context) => api.llm.query(prompt, context),
};

// Git API
export const gitAPI = {
  status: () => api.git.status(),
};

// 系统API
export const systemAPI = {
  getVersion: () => api.system.getVersion(),
  minimize: () => api.system.minimize(),
  maximize: () => api.system.maximize(),
  close: () => api.system.close(),
};

/**
 * 为 electronAPI 的特定方法添加重试包装
 * 这样在应用启动时，如果 IPC 处理程序还未就绪，会自动重试
 */
function wrapAPIMethodWithRetry(method, channelName) {
  // 如果这个通道需要启动重试
  if (STARTUP_RETRY_CHANNELS.some(channel => channelName.includes(channel))) {
    return function(...args) {
      return ipcWithRetry(
        () => method(...args),
        { silentErrors: true } // 静默错误避免控制台污染
      );
    };
  }
  // 否则返回原方法
  return method;
}

/**
 * 递归包装对象的所有方法
 */
function wrapAPIObject(obj, pathPrefix = '') {
  const wrapped = {};

  for (const key in obj) {
    if (!obj.hasOwnProperty(key)) continue;

    const value = obj[key];
    const currentPath = pathPrefix ? `${pathPrefix}:${key}` : key;

    if (typeof value === 'function') {
      // 包装函数
      wrapped[key] = wrapAPIMethodWithRetry(value, currentPath);
    } else if (typeof value === 'object' && value !== null) {
      // 递归包装嵌套对象
      wrapped[key] = wrapAPIObject(value, currentPath);
    } else {
      // 其他类型直接复制
      wrapped[key] = value;
    }
  }

  return wrapped;
}

/**
 * 导出带重试包装的 electronAPI
 * 使用方式：import { electronAPI } from '@/utils/ipc'
 */
export const electronAPI = wrapAPIObject(window.electronAPI);
