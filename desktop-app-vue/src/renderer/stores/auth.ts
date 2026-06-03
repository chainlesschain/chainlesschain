/**
 * Auth Store - 认证状态管理
 */

import { defineStore } from 'pinia';
import { useAppStore } from './app';

// ==================== 类型定义 ====================

/**
 * 当前用户信息
 */
export interface CurrentUser {
  id: string;
  name: string;
  avatar: string;
}

// ==================== Store ====================

export const useAuthStore = defineStore('auth', {
  getters: {
    currentUser(): CurrentUser | null {
      const appStore = useAppStore();
      if (!appStore.isAuthenticated || !appStore.deviceId) {
        return null;
      }

      return {
        id: appStore.deviceId,
        name: '用户',
        avatar: '',
      };
    },
  },

  actions: {
    logout(): void {
      const appStore = useAppStore();
      appStore.setAuthenticated(false);
      appStore.setDeviceId(null);
    },
  },
});
