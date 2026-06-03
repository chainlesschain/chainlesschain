/**
 * Network Store - 网络连接状态管理
 */

import { logger } from '@/utils/logger';
import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { Ref } from 'vue';

// ==================== 类型定义 ====================

/**
 * Network Store 返回类型
 */
export interface NetworkStoreReturn {
  isOnline: Ref<boolean>;
  updateOnlineStatus: () => void;
  initNetworkListeners: () => void;
  removeNetworkListeners: () => void;
}

// ==================== Store ====================

export const useNetworkStore = defineStore('network', (): NetworkStoreReturn => {
  // 网络在线状态
  const isOnline: Ref<boolean> = ref(navigator.onLine);

  // 更新在线状态
  const updateOnlineStatus = (): void => {
    isOnline.value = navigator.onLine;
    logger.info('[Network] 网络状态:', isOnline.value ? '在线' : '离线');
  };

  // 监听在线事件
  const handleOnline = (): void => {
    updateOnlineStatus();
  };

  // 监听离线事件
  const handleOffline = (): void => {
    updateOnlineStatus();
  };

  // 初始化网络监听
  const initNetworkListeners = (): void => {
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    logger.info('[Network] 网络监听已启动');
  };

  // 移除网络监听
  const removeNetworkListeners = (): void => {
    window.removeEventListener('online', handleOnline);
    window.removeEventListener('offline', handleOffline);
    logger.info('[Network] 网络监听已移除');
  };

  return {
    isOnline,
    updateOnlineStatus,
    initNetworkListeners,
    removeNetworkListeners,
  };
});
