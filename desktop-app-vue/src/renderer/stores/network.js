/**
 * Network Store
 * 管理网络连接状态
 */
import { logger, createLogger } from '@/utils/logger';
import { defineStore } from 'pinia';
import { ref, onMounted, onUnmounted } from 'vue';

export const useNetworkStore = defineStore('network', () => {
  // 网络在线状态
  const isOnline = ref(navigator.onLine);

  // 更新在线状态
  const updateOnlineStatus = () => {
    isOnline.value = navigator.onLine;
    logger.info('[Network] 网络状态:', isOnline.value ? '在线' : '离线');
  };

  // 监听在线事件
  const handleOnline = () => {
    updateOnlineStatus();
  };

  // 监听离线事件
  const handleOffline = () => {
    updateOnlineStatus();
  };

  // 初始化网络监听
  const initNetworkListeners = () => {
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    logger.info('[Network] 网络监听已启动');
  };

  // 移除网络监听
  const removeNetworkListeners = () => {
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
