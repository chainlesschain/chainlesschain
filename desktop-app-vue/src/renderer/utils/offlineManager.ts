/**
 * 离线模式管理器
 * 检测网络状态并提供离线功能支持
 */

import { logger } from "@/utils/logger";
import { ref, computed, type Ref, type ComputedRef } from "vue";

// ==================== 类型定义 ====================

/**
 * 离线队列项
 */
export interface OfflineQueueItem {
  id: string;
  action: () => Promise<void>;
  timestamp: number;
}

export interface OfflineAdmissionResult {
  accepted: boolean;
  id?: string;
  code?: "OVERLOADED" | "INVALID_ARGUMENT";
  scope?: "offline_queue" | "offline_listeners";
  retryAfterMs?: number;
  limit?: Record<string, number>;
}

export const OFFLINE_MANAGER_LIMITS = Object.freeze({
  maxQueueItems: 128,
  maxListeners: 64,
  connectionTimeoutMs: 10_000,
});

/**
 * 网络状态监听器
 */
export type NetworkListener = (
  event: "online" | "offline",
  isOnline: boolean,
) => void;

/**
 * useOffline 返回类型
 */
export interface UseOfflineReturn {
  isOnline: ComputedRef<boolean>;
  isOffline: ComputedRef<boolean>;
  offlineQueue: ComputedRef<OfflineQueueItem[]>;
  addToQueue: (action: () => Promise<void>) => OfflineAdmissionResult;
  processQueue: () => Promise<void>;
  clearQueue: () => void;
  addListener: (listener: NetworkListener) => OfflineAdmissionResult;
  removeListener: (listener: NetworkListener) => void;
}

// ==================== 离线管理器类 ====================

/**
 * 离线模式管理器
 */
class OfflineManager {
  isOnline: Ref<boolean>;
  offlineQueue: Ref<OfflineQueueItem[]>;
  private listeners: NetworkListener[];
  private _boundHandleOnline: () => void;
  private _boundHandleOffline: () => void;
  private _checkConnectionTimer: ReturnType<typeof setInterval> | null;
  private connectionCheckPromise: Promise<void> | null;
  private connectionAbortController: AbortController | null;
  private processingPromise: Promise<void> | null;
  private reservedQueueSlots: number;
  private queueVersion: number;

  constructor() {
    this.isOnline = ref(
      typeof navigator !== "undefined" ? navigator.onLine : true,
    );
    this.offlineQueue = ref([]);
    this.listeners = [];

    this._boundHandleOnline = this.handleOnline.bind(this);
    this._boundHandleOffline = this.handleOffline.bind(this);
    this._checkConnectionTimer = null;
    this.connectionCheckPromise = null;
    this.connectionAbortController = null;
    this.processingPromise = null;
    this.reservedQueueSlots = 0;
    this.queueVersion = 0;

    this.init();
  }

  /**
   * 初始化
   */
  private init(): void {
    if (typeof window === "undefined") {
      return;
    }

    window.addEventListener("online", this._boundHandleOnline);
    window.addEventListener("offline", this._boundHandleOffline);

    this._checkConnectionTimer = setInterval(() => {
      this.checkConnection();
    }, 30000);
  }

  /**
   * 处理上线
   */
  private handleOnline(): void {
    logger.info("[OfflineManager] Network online");
    this.isOnline.value = true;
    this.notifyListeners("online");
    this.processQueue();
  }

  /**
   * 处理离线
   */
  private handleOffline(): void {
    logger.info("[OfflineManager] Network offline");
    this.isOnline.value = false;
    this.notifyListeners("offline");
  }

  /**
   * 检查连接
   */
  async checkConnection(): Promise<void> {
    if (this.connectionCheckPromise) {
      return this.connectionCheckPromise;
    }
    this.connectionCheckPromise = this.performConnectionCheck();
    try {
      await this.connectionCheckPromise;
    } finally {
      this.connectionCheckPromise = null;
    }
  }

  private async performConnectionCheck(): Promise<void> {
    const abortController = new AbortController();
    this.connectionAbortController = abortController;
    const timeoutId = setTimeout(() => {
      abortController.abort();
    }, OFFLINE_MANAGER_LIMITS.connectionTimeoutMs);
    try {
      const response = await fetch("/api/ping", {
        method: "HEAD",
        cache: "no-cache",
        signal: abortController.signal,
      });
      const online = response.ok;

      if (online !== this.isOnline.value) {
        this.isOnline.value = online;
        this.notifyListeners(online ? "online" : "offline");

        if (online) {
          this.processQueue();
        }
      }
    } catch (_error) {
      if (this.isOnline.value) {
        this.isOnline.value = false;
        this.notifyListeners("offline");
      }
    } finally {
      clearTimeout(timeoutId);
      if (this.connectionAbortController === abortController) {
        this.connectionAbortController = null;
      }
    }
  }

  /**
   * 添加到离线队列
   */
  addToQueue(action: () => Promise<void>): OfflineAdmissionResult {
    if (typeof action !== "function") {
      return { accepted: false, code: "INVALID_ARGUMENT" };
    }
    if (
      this.offlineQueue.value.length + this.reservedQueueSlots >=
      OFFLINE_MANAGER_LIMITS.maxQueueItems
    ) {
      return {
        accepted: false,
        code: "OVERLOADED",
        scope: "offline_queue",
        retryAfterMs: 1000,
        limit: { maxQueueItems: OFFLINE_MANAGER_LIMITS.maxQueueItems },
      };
    }
    const id = `action-${Date.now()}-${Math.random()}`;
    this.offlineQueue.value.push({
      id,
      action,
      timestamp: Date.now(),
    });

    this.saveQueue();
    return { accepted: true, id };
  }

  /**
   * 处理队列
   */
  async processQueue(): Promise<void> {
    if (this.processingPromise) {
      return this.processingPromise;
    }
    this.processingPromise = this.drainQueue();
    try {
      await this.processingPromise;
    } finally {
      this.processingPromise = null;
    }
  }

  private async drainQueue(): Promise<void> {
    const initialCount = Math.min(
      this.offlineQueue.value.length,
      OFFLINE_MANAGER_LIMITS.maxQueueItems,
    );
    if (initialCount === 0) {
      return;
    }

    logger.info(`[OfflineManager] Processing ${initialCount} queued actions`);

    for (let index = 0; index < initialCount; index += 1) {
      const item = this.offlineQueue.value.shift();
      if (!item) {
        break;
      }
      const itemQueueVersion = this.queueVersion;
      this.reservedQueueSlots++;
      try {
        await item.action();
        logger.info(
          `[OfflineManager] Action ${item.id} processed successfully`,
        );
      } catch (error) {
        logger.error(`[OfflineManager] Action ${item.id} failed:`, error);
        if (
          itemQueueVersion === this.queueVersion &&
          this.offlineQueue.value.length < OFFLINE_MANAGER_LIMITS.maxQueueItems
        ) {
          this.offlineQueue.value.push(item);
        }
      } finally {
        this.reservedQueueSlots--;
      }
    }

    this.saveQueue();
  }

  /**
   * 清空队列
   */
  clearQueue(): void {
    this.queueVersion++;
    this.offlineQueue.value = [];
    this.saveQueue();
  }

  /**
   * 保存队列到本地存储
   */
  private saveQueue(): void {
    try {
      const queueData = this.offlineQueue.value.map((item) => ({
        id: item.id,
        timestamp: item.timestamp,
      }));
      localStorage.setItem("offline-queue", JSON.stringify(queueData));
    } catch (error) {
      logger.error("[OfflineManager] Save queue error:", error);
    }
  }

  /**
   * 添加监听器
   */
  addListener(listener: NetworkListener): OfflineAdmissionResult {
    if (typeof listener !== "function") {
      return { accepted: false, code: "INVALID_ARGUMENT" };
    }
    if (this.listeners.includes(listener)) {
      return { accepted: true };
    }
    if (this.listeners.length >= OFFLINE_MANAGER_LIMITS.maxListeners) {
      return {
        accepted: false,
        code: "OVERLOADED",
        scope: "offline_listeners",
        retryAfterMs: 1000,
        limit: { maxListeners: OFFLINE_MANAGER_LIMITS.maxListeners },
      };
    }
    this.listeners.push(listener);
    return { accepted: true };
  }

  /**
   * 移除监听器
   */
  removeListener(listener: NetworkListener): void {
    const index = this.listeners.indexOf(listener);
    if (index > -1) {
      this.listeners.splice(index, 1);
    }
  }

  /**
   * 通知监听器
   */
  private notifyListeners(event: "online" | "offline"): void {
    this.listeners.forEach((listener) => {
      try {
        listener(event, this.isOnline.value);
      } catch (error) {
        logger.error("[OfflineManager] Listener error:", error);
      }
    });
  }

  /**
   * 销毁
   */
  destroy(): void {
    window.removeEventListener("online", this._boundHandleOnline);
    window.removeEventListener("offline", this._boundHandleOffline);

    if (this._checkConnectionTimer) {
      clearInterval(this._checkConnectionTimer);
      this._checkConnectionTimer = null;
    }
    this.connectionAbortController?.abort();
    this.connectionAbortController = null;
    this.listeners = [];
    this.clearQueue();
  }
}

// 创建全局实例
const offlineManager = new OfflineManager();

/**
 * 组合式函数：使用离线模式
 */
export function useOffline(): UseOfflineReturn {
  return {
    isOnline: computed(() => offlineManager.isOnline.value),
    isOffline: computed(() => !offlineManager.isOnline.value),
    offlineQueue: computed(() => offlineManager.offlineQueue.value),
    addToQueue: (action: () => Promise<void>) =>
      offlineManager.addToQueue(action),
    processQueue: () => offlineManager.processQueue(),
    clearQueue: () => offlineManager.clearQueue(),
    addListener: (listener: NetworkListener) =>
      offlineManager.addListener(listener),
    removeListener: (listener: NetworkListener) =>
      offlineManager.removeListener(listener),
  };
}

export default offlineManager;
