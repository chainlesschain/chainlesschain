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

/**
 * 网络状态监听器
 */
export type NetworkListener = (event: 'online' | 'offline', isOnline: boolean) => void;

/**
 * useOffline 返回类型
 */
export interface UseOfflineReturn {
  isOnline: ComputedRef<boolean>;
  isOffline: ComputedRef<boolean>;
  offlineQueue: ComputedRef<OfflineQueueItem[]>;
  addToQueue: (action: () => Promise<void>) => void;
  processQueue: () => Promise<void>;
  clearQueue: () => void;
  addListener: (listener: NetworkListener) => void;
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

  constructor() {
    this.isOnline = ref(typeof navigator !== 'undefined' ? navigator.onLine : true);
    this.offlineQueue = ref([]);
    this.listeners = [];

    this._boundHandleOnline = this.handleOnline.bind(this);
    this._boundHandleOffline = this.handleOffline.bind(this);
    this._checkConnectionTimer = null;

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
    try {
      const response = await fetch("/api/ping", {
        method: "HEAD",
        cache: "no-cache",
      });
      const online = response.ok;

      if (online !== this.isOnline.value) {
        this.isOnline.value = online;
        this.notifyListeners(online ? "online" : "offline");

        if (online) {
          this.processQueue();
        }
      }
    } catch (error) {
      if (this.isOnline.value) {
        this.isOnline.value = false;
        this.notifyListeners("offline");
      }
    }
  }

  /**
   * 添加到离线队列
   */
  addToQueue(action: () => Promise<void>): void {
    this.offlineQueue.value.push({
      id: `action-${Date.now()}-${Math.random()}`,
      action,
      timestamp: Date.now(),
    });

    this.saveQueue();
  }

  /**
   * 处理队列
   */
  async processQueue(): Promise<void> {
    if (this.offlineQueue.value.length === 0) {
      return;
    }

    logger.info(
      `[OfflineManager] Processing ${this.offlineQueue.value.length} queued actions`,
    );

    const queue = [...this.offlineQueue.value];
    this.offlineQueue.value = [];

    for (const item of queue) {
      try {
        await item.action();
        logger.info(
          `[OfflineManager] Action ${item.id} processed successfully`,
        );
      } catch (error) {
        logger.error(`[OfflineManager] Action ${item.id} failed:`, error);
        this.offlineQueue.value.push(item);
      }
    }

    this.saveQueue();
  }

  /**
   * 清空队列
   */
  clearQueue(): void {
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
  addListener(listener: NetworkListener): void {
    this.listeners.push(listener);
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
  private notifyListeners(event: 'online' | 'offline'): void {
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
    addToQueue: (action: () => Promise<void>) => offlineManager.addToQueue(action),
    processQueue: () => offlineManager.processQueue(),
    clearQueue: () => offlineManager.clearQueue(),
    addListener: (listener: NetworkListener) => offlineManager.addListener(listener),
    removeListener: (listener: NetworkListener) => offlineManager.removeListener(listener),
  };
}

export default offlineManager;
