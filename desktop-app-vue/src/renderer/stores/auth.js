import { defineStore } from 'pinia';

import { useAppStore } from './app';

export const useAuthStore = defineStore('auth', {
  getters: {
    currentUser: () => {
      const appStore = useAppStore();
      if (!appStore.isAuthenticated || !appStore.deviceId) {
        return null;
      }

      return { id: appStore.deviceId };
    },
  },
});
