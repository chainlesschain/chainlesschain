/**
 * 离线模式管理器
 * 检测网络状态并提供离线功能支持
 */

import { logger, createLogger } from "@/utils/logger";
import { ref, computed } from "vue";

/**
 * 离线模式管理器
 */
class OfflineManager {
  constructor() {
    this.isOnline = ref(navigator.onLine);
    this.offlineQueue = ref([]);
    this.listeners = [];

    // 存储绑定的事件处理器引用
    this._boundHandleOnline = this.handleOnline.bind(this);
    this._boundHandleOffline = this.handleOffline.bind(this);
    this._checkConnectionTimer = null;

    this.init();
  }

  /**
   * 初始化
   */
  init() {
    if (typeof window === "undefined") {
      return;
    }

    // 监听在线状态变化
    window.addEventListener("online", this._boundHandleOnline);
    window.addEventListener("offline", this._boundHandleOffline);

    // 定期检查网络状态
    this._checkConnectionTimer = setInterval(() => {
      this.checkConnection();
    }, 30000); // 每30秒检查一次
  }

  /**
   * 处理上线
   */
  handleOnline() {
    logger.info("[OfflineManager] Network online");
    this.isOnline.value = true;
    this.notifyListeners("online");
    this.processQueue();
  }

  /**
   * 处理离线
   */
  handleOffline() {
    logger.info("[OfflineManager] Network offline");
    this.isOnline.value = false;
    this.notifyListeners("offline");
  }

  /**
   * 检查连接
   */
  async checkConnection() {
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
  addToQueue(action) {
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
  async processQueue() {
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
        // 重新加入队列
        this.offlineQueue.value.push(item);
      }
    }

    this.saveQueue();
  }

  /**
   * 清空队列
   */
  clearQueue() {
    this.offlineQueue.value = [];
    this.saveQueue();
  }

  /**
   * 保存队列到本地存储
   */
  saveQueue() {
    try {
      // 只保存队列元数据，不保存action函数
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
  addListener(listener) {
    this.listeners.push(listener);
  }

  /**
   * 移除监听器
   */
  removeListener(listener) {
    const index = this.listeners.indexOf(listener);
    if (index > -1) {
      this.listeners.splice(index, 1);
    }
  }

  /**
   * 通知监听器
   */
  notifyListeners(event) {
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
  destroy() {
    // 移除事件监听
    window.removeEventListener("online", this._boundHandleOnline);
    window.removeEventListener("offline", this._boundHandleOffline);

    // 清除定时器
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
export function useOffline() {
  return {
    isOnline: computed(() => offlineManager.isOnline.value),
    isOffline: computed(() => !offlineManager.isOnline.value),
    offlineQueue: computed(() => offlineManager.offlineQueue.value),
    addToQueue: (action) => offlineManager.addToQueue(action),
    processQueue: () => offlineManager.processQueue(),
    clearQueue: () => offlineManager.clearQueue(),
    addListener: (listener) => offlineManager.addListener(listener),
    removeListener: (listener) => offlineManager.removeListener(listener),
  };
}

export default offlineManager;
