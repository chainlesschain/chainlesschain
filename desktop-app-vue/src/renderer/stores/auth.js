import { defineStore } from 'pinia';

import { useAppStore } from './app';

export const useAuthStore = defineStore('auth', {
  getters: {
    currentUser: () => {
      const appStore = useAppStore();
      if (!appStore.isAuthenticated || !appStore.deviceId) {
        return null;
      }

      return {
        id: appStore.deviceId,
        name: '用户', // 默认用户名
        avatar: '', // 默认头像为空
      };
    },
  },

  actions: {
    logout() {
      const appStore = useAppStore();
      appStore.setAuthenticated(false);
      appStore.setDeviceId(null);
    },
  },
});
