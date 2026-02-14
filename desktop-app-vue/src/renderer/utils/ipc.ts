/**
 * IPC 通信封装
 * 提供带重试机制的 IPC 调用
 */

import { logger } from '@/utils/logger';
import type { ElectronAPI } from '@renderer/types/electron.d';
import type { IPCRetryConfig, IPCRetryOptions } from '@renderer/types/ipc.d';

// IPC通信封装
const api = (window as any).electronAPI as ElectronAPI;

/**
 * 需要重试逻辑的 IPC 通道（在启动时可能未就绪）
 * 注意：使用 wrapAPIObject 生成的属性路径格式（camelCase），不是 IPC 通道名
 */
const STARTUP_RETRY_CHANNELS: string[] = [
  'project:getAll',
  'template:getAll',
  'notification:getAll',
  'friend:getPendingRequests',
  'friend:getFriends',
];

/**
 * IPC 重试配置
 */
const RETRY_CONFIG: IPCRetryConfig = {
  maxRetries: 8,          // 最大重试次数
  initialDelay: 200,      // 初始延迟 (毫秒)
  maxDelay: 3000,         // 最大延迟 (毫秒)
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
function isRetryableError(error: Error | null | undefined): boolean {
  if (!error) { return false; }
  const errorMessage = error.message || String(error);
  return RETRY_CONFIG.retryableErrors.some(pattern =>
    errorMessage.includes(pattern)
  );
}

/**
 * 延迟函数
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * IPC 调用重试包装器
 */
export async function ipcWithRetry<T>(
  ipcCall: () => Promise<T>,
  options: IPCRetryOptions = {}
): Promise<T> {
  const {
    maxRetries = RETRY_CONFIG.maxRetries,
    initialDelay = RETRY_CONFIG.initialDelay,
    silentErrors = false,
  } = options;

  let lastError: Error | undefined;
  let currentDelay = initialDelay;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // 第一次尝试直接调用，后续尝试先延迟
      if (attempt > 0) {
        if (!silentErrors) {
          logger.info(`[IPC Retry] 第 ${attempt} 次重试，延迟 ${currentDelay}ms...`);
        }
        await delay(currentDelay);
        // 指数退避
        currentDelay = Math.min(currentDelay * RETRY_CONFIG.backoffMultiplier, RETRY_CONFIG.maxDelay);
      }

      const result = await ipcCall();

      // 如果之前有重试，记录成功信息
      if (attempt > 0 && !silentErrors) {
        logger.info(`[IPC Retry] 第 ${attempt} 次重试成功`);
      }

      return result;
    } catch (error) {
      lastError = error as Error;

      // 检查是否可重试
      if (!isRetryableError(lastError)) {
        if (!silentErrors) {
          logger.warn('[IPC Retry] 不可重试的错误:', lastError.message);
        }
        throw lastError;
      }

      // 如果已达到最大重试次数，抛出错误
      if (attempt >= maxRetries) {
        if (!silentErrors) {
          logger.error(`[IPC Retry] 达到最大重试次数 (${maxRetries})，放弃重试`);
        }
        throw lastError;
      }

      // 记录重试信息
      if (!silentErrors) {
        logger.warn(`[IPC Retry] IPC 调用失败 (尝试 ${attempt + 1}/${maxRetries + 1}):`, lastError.message);
      }
    }
  }

  throw lastError!;
}

/**
 * 创建带重试的 IPC 调用包装器
 */
export interface RetryableIPC {
  invoke<T = any>(channel: string, ...args: any[]): Promise<T>;
  on?(channel: string, listener: (...args: any[]) => void): void;
  once?(channel: string, listener: (...args: any[]) => void): void;
  removeListener?(channel: string, listener: (...args: any[]) => void): void;
  removeAllListeners?(channel: string): void;
}

export function createRetryableIPC(
  ipcObject: RetryableIPC | undefined | null,
  options: IPCRetryOptions = {}
): RetryableIPC {
  // 如果 ipcObject 未定义，返回一个空操作的包装器
  if (!ipcObject) {
    return {
      invoke: async <T>(_channel: string, ..._args: any[]): Promise<T> => {
        throw new Error('IPC not available');
      },
      on: () => {},
      once: () => {},
      removeListener: () => {},
      removeAllListeners: () => {},
    };
  }

  return {
    invoke: <T>(channel: string, ...args: any[]) => ipcWithRetry<T>(
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

// ==================== API 模块 ====================

/**
 * U盾API
 */
export const ukeyAPI = {
  detect: () => api.ukey.detect(),
  verifyPIN: (pin: string) => api.ukey.verifyPIN(pin),
};

/**
 * 认证API
 */
export const authAPI = {
  verifyPassword: (username: string, password: string) => api.auth.verifyPassword(username, password),
};

/**
 * 数据库API
 */
export const dbAPI = {
  getKnowledgeItems: () => api.db.getKnowledgeItems(),
  getKnowledgeItemById: (id: string) => api.db.getKnowledgeItemById(id),
  addKnowledgeItem: (item: any) => api.db.addKnowledgeItem(item),
  updateKnowledgeItem: (id: string, updates: any) => api.db.updateKnowledgeItem(id, updates),
  deleteKnowledgeItem: (id: string) => api.db.deleteKnowledgeItem(id),
  searchKnowledgeItems: (query: string) => api.db.searchKnowledgeItems(query),
};

/**
 * LLM API
 */
export const llmAPI = {
  checkStatus: () => api.llm.checkStatus(),
  query: (prompt: string, context?: any) => api.llm.query(prompt, context),
};

/**
 * Git API
 */
export const gitAPI = {
  status: () => api.git.status(),
};

/**
 * 系统API
 */
export const systemAPI = {
  getVersion: () => api.system.getVersion(),
  minimize: () => api.system.minimize(),
  maximize: () => api.system.maximize(),
  close: () => api.system.close(),
};

// ==================== 工具函数 ====================

/**
 * 为 electronAPI 的特定方法添加重试包装
 * 这样在应用启动时，如果 IPC 处理程序还未就绪，会自动重试
 */
function wrapAPIMethodWithRetry<T extends (...args: any[]) => Promise<any>>(
  method: T,
  channelName: string
): T {
  // 如果这个通道需要启动重试
  if (STARTUP_RETRY_CHANNELS.some(channel => channelName.includes(channel))) {
    return (function(...args: any[]) {
      return ipcWithRetry(
        () => method(...args),
        { silentErrors: true } // 静默错误避免控制台污染
      );
    }) as T;
  }
  // 否则返回原方法
  return method;
}

/**
 * 递归包装对象的所有方法
 */
function wrapAPIObject<T extends Record<string, any>>(obj: T, pathPrefix: string = ''): T {
  const wrapped = {} as T;

  for (const key in obj) {
    if (!Object.prototype.hasOwnProperty.call(obj, key)) { continue; }

    const value = obj[key];
    const currentPath = pathPrefix ? `${pathPrefix}:${key}` : key;

    if (typeof value === 'function') {
      // 包装函数
      (wrapped as any)[key] = wrapAPIMethodWithRetry(value, currentPath);
    } else if (typeof value === 'object' && value !== null) {
      // 递归包装嵌套对象
      (wrapped as any)[key] = wrapAPIObject(value, currentPath);
    } else {
      // 其他类型直接复制
      (wrapped as any)[key] = value;
    }
  }

  return wrapped;
}

/**
 * 导出带重试包装的 electronAPI
 * 使用方式：import { electronAPI } from '@/utils/ipc'
 */
export const electronAPI = wrapAPIObject((window as any).electronAPI as ElectronAPI);
