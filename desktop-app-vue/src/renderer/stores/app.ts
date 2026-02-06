/**
 * App Store - 应用全局状态管理
 */

import { logger } from '@/utils/logger';
import { defineStore } from "pinia";

// ==================== 类型定义 ====================

/**
 * U-Key 状态
 */
export interface UKeyStatus {
  detected: boolean;
  unlocked: boolean;
}

/**
 * 知识库项
 */
export interface KnowledgeItem {
  id: string;
  title: string;
  content?: string;
  [key: string]: any;
}

/**
 * 聊天消息
 */
export interface ChatMessage {
  id?: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: number;
}

/**
 * Git 状态
 */
export interface GitStatus {
  branch?: string;
  ahead?: number;
  behind?: number;
  files?: any[];
  [key: string]: any;
}

/**
 * LLM 状态
 */
export interface LLMStatus {
  available: boolean;
  models: string[];
}

/**
 * 应用配置
 */
export interface AppConfig {
  theme: 'light' | 'dark';
  llmModel: string;
  gitRemote: string | null;
  autoSync: boolean;
  syncInterval: number;
}

/**
 * 标签页
 */
export interface Tab {
  key: string;
  title: string;
  path: string;
  query?: Record<string, any> | null;
  closable: boolean;
}

/**
 * 菜单项
 */
export interface MenuInfo {
  key: string;
  title: string;
  path: string;
  icon?: string;
  query?: Record<string, any> | null;
  addedAt?: number;
  visitedAt?: number;
  pinnedAt?: number;
}

/**
 * App State
 */
export interface AppState {
  // 用户认证状态
  isAuthenticated: boolean;
  ukeyStatus: UKeyStatus;
  deviceId: string | null;

  // 知识库数据
  knowledgeItems: KnowledgeItem[];
  currentItem: KnowledgeItem | null;
  searchQuery: string;
  filteredItems: KnowledgeItem[];

  // AI对话
  messages: ChatMessage[];
  isAITyping: boolean;

  // 系统状态
  gitStatus: GitStatus | null;
  llmStatus: LLMStatus;
  appConfig: AppConfig;

  // UI状态
  sidebarCollapsed: boolean;
  chatPanelVisible: boolean;
  loading: boolean;

  // 多标签页管理
  tabs: Tab[];
  activeTabKey: string;

  // 菜单收藏和快捷访问
  favoriteMenus: MenuInfo[];
  recentMenus: MenuInfo[];
  pinnedMenus: MenuInfo[];
}

// ==================== Store ====================

export const useAppStore = defineStore("app", {
  state: (): AppState => ({
    // 用户认证状态
    isAuthenticated: false,
    ukeyStatus: { detected: false, unlocked: false },
    deviceId: null,

    // 知识库数据
    knowledgeItems: [],
    currentItem: null,
    searchQuery: "",
    filteredItems: [],

    // AI对话
    messages: [],
    isAITyping: false,

    // 系统状态
    gitStatus: null,
    llmStatus: { available: false, models: [] },
    appConfig: {
      theme: "light",
      llmModel: "qwen2:7b",
      gitRemote: null,
      autoSync: false,
      syncInterval: 30,
    },

    // UI状态
    sidebarCollapsed: false,
    chatPanelVisible: false,
    loading: false,

    // 多标签页管理
    tabs: [
      {
        key: "home",
        title: "首页",
        path: "/",
        query: null,
        closable: false,
      },
    ],
    activeTabKey: "home",

    // 菜单收藏和快捷访问
    favoriteMenus: [],
    recentMenus: [],
    pinnedMenus: [],
  }),

  getters: {
    // 过滤后的知识库项
    getFilteredItems: (state): KnowledgeItem[] => {
      if (!state.searchQuery.trim()) {
        return state.knowledgeItems;
      }

      const query = state.searchQuery.toLowerCase();
      return state.knowledgeItems.filter(
        (item) =>
          item.title.toLowerCase().includes(query) ||
          (item.content && item.content.toLowerCase().includes(query)),
      );
    },
  },

  actions: {
    // 认证相关
    setAuthenticated(authenticated: boolean): void {
      this.isAuthenticated = authenticated;
    },

    setUKeyStatus(status: UKeyStatus): void {
      this.ukeyStatus = status;
    },

    setDeviceId(deviceId: string | null): void {
      this.deviceId = deviceId;
    },

    // 知识库相关
    setKnowledgeItems(items: KnowledgeItem[]): void {
      this.knowledgeItems = items;
      this.filterItems();
    },

    setCurrentItem(item: KnowledgeItem | null): void {
      this.currentItem = item;
    },

    addKnowledgeItem(item: KnowledgeItem): void {
      this.knowledgeItems.push(item);
      this.filterItems();
    },

    updateKnowledgeItem(id: string, updates: Partial<KnowledgeItem>): void {
      const index = this.knowledgeItems.findIndex((item) => item.id === id);
      if (index !== -1) {
        this.knowledgeItems[index] = {
          ...this.knowledgeItems[index],
          ...updates,
        };
      }

      if (this.currentItem && this.currentItem.id === id) {
        this.currentItem = { ...this.currentItem, ...updates };
      }

      this.filterItems();
    },

    deleteKnowledgeItem(id: string): void {
      const index = this.knowledgeItems.findIndex((item) => item.id === id);
      if (index !== -1) {
        this.knowledgeItems.splice(index, 1);
      }

      if (this.currentItem && this.currentItem.id === id) {
        this.currentItem = null;
      }

      this.filterItems();
    },

    setSearchQuery(query: string): void {
      this.searchQuery = query;
      this.filterItems();
    },

    filterItems(): void {
      if (!this.searchQuery.trim()) {
        this.filteredItems = this.knowledgeItems;
        return;
      }

      const query = this.searchQuery.toLowerCase();
      this.filteredItems = this.knowledgeItems.filter(
        (item) =>
          item.title.toLowerCase().includes(query) ||
          (item.content && item.content.toLowerCase().includes(query)),
      );
    },

    // AI对话相关
    addMessage(message: ChatMessage): void {
      this.messages.push(message);
    },

    clearMessages(): void {
      this.messages = [];
    },

    setIsAITyping(typing: boolean): void {
      this.isAITyping = typing;
    },

    // 系统状态相关
    setGitStatus(status: GitStatus | null): void {
      this.gitStatus = status;
    },

    setLLMStatus(status: LLMStatus): void {
      this.llmStatus = status;
    },

    setAppConfig(config: Partial<AppConfig>): void {
      this.appConfig = { ...this.appConfig, ...config };
    },

    // UI状态相关
    setSidebarCollapsed(collapsed: boolean): void {
      this.sidebarCollapsed = collapsed;
    },

    setChatPanelVisible(visible: boolean): void {
      this.chatPanelVisible = visible;
    },

    setLoading(loading: boolean): void {
      this.loading = loading;
    },

    // 登出
    logout(): void {
      this.isAuthenticated = false;
      this.ukeyStatus = { detected: false, unlocked: false };
      this.deviceId = null;
      this.knowledgeItems = [];
      this.currentItem = null;
      this.messages = [];
      this.tabs = [
        {
          key: "home",
          title: "首页",
          path: "/",
          query: null,
          closable: false,
        },
      ];
      this.activeTabKey = "home";
    },

    // 多标签页管理
    addTab(tab: Omit<Tab, 'closable'> & { closable?: boolean }): void {
      const existingTab = this.tabs.find((t) => t.key === tab.key);
      if (existingTab) {
        this.activeTabKey = tab.key;
        return;
      }

      this.tabs.push({
        key: tab.key,
        title: tab.title,
        path: tab.path,
        query: tab.query || null,
        closable: tab.closable !== false,
      });
      this.activeTabKey = tab.key;
    },

    removeTab(targetKey: string): void {
      if (targetKey === "home") {
        return;
      }

      const targetIndex = this.tabs.findIndex((tab) => tab.key === targetKey);
      if (targetIndex === -1) { return; }

      let activeKey = this.activeTabKey;
      if (targetKey === activeKey) {
        const nextTab = this.tabs[targetIndex + 1] || this.tabs[targetIndex - 1];
        activeKey = nextTab ? nextTab.key : "home";
      }

      this.tabs = this.tabs.filter((tab) => tab.key !== targetKey);
      this.activeTabKey = activeKey;
    },

    setActiveTab(key: string): void {
      this.activeTabKey = key;
    },

    closeAllTabs(): void {
      this.tabs = [
        {
          key: "home",
          title: "首页",
          path: "/",
          query: null,
          closable: false,
        },
      ];
      this.activeTabKey = "home";
    },

    closeOtherTabs(targetKey: string): void {
      this.tabs = this.tabs.filter(
        (tab) => tab.key === targetKey || tab.key === "home",
      );
      this.activeTabKey = targetKey;
    },

    // 菜单收藏功能
    addFavoriteMenu(menu: Omit<MenuInfo, 'addedAt'>): void {
      const exists = this.favoriteMenus.find((m) => m.key === menu.key);
      if (exists) { return; }

      this.favoriteMenus.push({
        ...menu,
        addedAt: Date.now(),
      });

      this.saveFavoritesToStorage();
    },

    removeFavoriteMenu(key: string): void {
      this.favoriteMenus = this.favoriteMenus.filter((m) => m.key !== key);
      this.saveFavoritesToStorage();
    },

    isFavoriteMenu(key: string): boolean {
      return this.favoriteMenus.some((m) => m.key === key);
    },

    toggleFavoriteMenu(menu: Omit<MenuInfo, 'addedAt'>): void {
      if (this.isFavoriteMenu(menu.key)) {
        this.removeFavoriteMenu(menu.key);
      } else {
        this.addFavoriteMenu(menu);
      }
    },

    addRecentMenu(menu: Omit<MenuInfo, 'visitedAt'>): void {
      this.recentMenus = this.recentMenus.filter((m) => m.key !== menu.key);

      this.recentMenus.unshift({
        ...menu,
        visitedAt: Date.now(),
      });

      if (this.recentMenus.length > 10) {
        this.recentMenus = this.recentMenus.slice(0, 10);
      }

      this.saveRecentsToStorage();
    },

    clearRecentMenus(): void {
      this.recentMenus = [];
      this.saveRecentsToStorage();
    },

    pinMenu(menu: Omit<MenuInfo, 'pinnedAt'>): void {
      const exists = this.pinnedMenus.find((m) => m.key === menu.key);
      if (exists) { return; }

      this.pinnedMenus.push({
        ...menu,
        pinnedAt: Date.now(),
      });

      this.savePinnedToStorage();
    },

    unpinMenu(key: string): void {
      this.pinnedMenus = this.pinnedMenus.filter((m) => m.key !== key);
      this.savePinnedToStorage();
    },

    isPinnedMenu(key: string): boolean {
      return this.pinnedMenus.some((m) => m.key === key);
    },

    // 存储操作
    async saveFavoritesToStorage(): Promise<void> {
      try {
        if ((window as any).electronAPI?.invoke) {
          await (window as any).electronAPI.invoke(
            "preference:set",
            "ui",
            "favoriteMenus",
            this.favoriteMenus,
          );
          return;
        }
      } catch (error) {
        logger.warn(
          "[AppStore] PreferenceManager not available, using localStorage",
        );
      }
      try {
        localStorage.setItem(
          "favoriteMenus",
          JSON.stringify(this.favoriteMenus),
        );
      } catch (error) {
        logger.error("[AppStore] Failed to save favorites:", error as any);
      }
    },

    async saveRecentsToStorage(): Promise<void> {
      try {
        if ((window as any).electronAPI?.invoke) {
          await (window as any).electronAPI.invoke(
            "preference:set",
            "ui",
            "recentMenus",
            this.recentMenus,
          );
          return;
        }
      } catch (error) {
        logger.warn(
          "[AppStore] PreferenceManager not available, using localStorage",
        );
      }
      try {
        localStorage.setItem("recentMenus", JSON.stringify(this.recentMenus));
      } catch (error) {
        logger.error("[AppStore] Failed to save recents:", error as any);
      }
    },

    async savePinnedToStorage(): Promise<void> {
      try {
        if ((window as any).electronAPI?.invoke) {
          await (window as any).electronAPI.invoke(
            "preference:set",
            "ui",
            "pinnedMenus",
            this.pinnedMenus,
          );
          return;
        }
      } catch (error) {
        logger.warn(
          "[AppStore] PreferenceManager not available, using localStorage",
        );
      }
      try {
        localStorage.setItem("pinnedMenus", JSON.stringify(this.pinnedMenus));
      } catch (error) {
        logger.error("[AppStore] Failed to save pinned:", error as any);
      }
    },

    async loadFavoritesFromStorage(): Promise<void> {
      try {
        if ((window as any).electronAPI?.invoke) {
          const favorites = await (window as any).electronAPI.invoke(
            "preference:get",
            "ui",
            "favoriteMenus",
            [],
          );
          if (favorites && Array.isArray(favorites)) {
            this.favoriteMenus = favorites;
            return;
          }
        }
      } catch (error) {
        logger.warn(
          "[AppStore] PreferenceManager not available, using localStorage",
        );
      }
      try {
        const data = localStorage.getItem("favoriteMenus");
        if (data) {
          this.favoriteMenus = JSON.parse(data);
        }
      } catch (error) {
        logger.error("[AppStore] Failed to load favorites:", error as any);
      }
    },

    async loadRecentsFromStorage(): Promise<void> {
      try {
        if ((window as any).electronAPI?.invoke) {
          const recents = await (window as any).electronAPI.invoke(
            "preference:get",
            "ui",
            "recentMenus",
            [],
          );
          if (recents && Array.isArray(recents)) {
            this.recentMenus = recents;
            return;
          }
        }
      } catch (error) {
        logger.warn(
          "[AppStore] PreferenceManager not available, using localStorage",
        );
      }
      try {
        const data = localStorage.getItem("recentMenus");
        if (data) {
          this.recentMenus = JSON.parse(data);
        }
      } catch (error) {
        logger.error("[AppStore] Failed to load recents:", error as any);
      }
    },

    async loadPinnedFromStorage(): Promise<void> {
      try {
        if ((window as any).electronAPI?.invoke) {
          const pinned = await (window as any).electronAPI.invoke(
            "preference:get",
            "ui",
            "pinnedMenus",
            [],
          );
          if (pinned && Array.isArray(pinned)) {
            this.pinnedMenus = pinned;
            return;
          }
        }
      } catch (error) {
        logger.warn(
          "[AppStore] PreferenceManager not available, using localStorage",
        );
      }
      try {
        const data = localStorage.getItem("pinnedMenus");
        if (data) {
          this.pinnedMenus = JSON.parse(data);
        }
      } catch (error) {
        logger.error("[AppStore] Failed to load pinned:", error as any);
      }
    },

    async initMenuData(): Promise<void> {
      await Promise.all([
        this.loadFavoritesFromStorage(),
        this.loadRecentsFromStorage(),
        this.loadPinnedFromStorage(),
      ]);
    },

    async migrateFromLocalStorage(): Promise<void> {
      try {
        if (!(window as any).electronAPI?.invoke) { return; }

        const migrated = await (window as any).electronAPI.invoke(
          "preference:get",
          "system",
          "localStorageMigrated",
          false,
        );
        if (migrated) { return; }

        logger.info(
          "[AppStore] Migrating data from localStorage to PreferenceManager...",
        );

        const favoritesData = localStorage.getItem("favoriteMenus");
        if (favoritesData) {
          const favorites = JSON.parse(favoritesData);
          await (window as any).electronAPI.invoke(
            "preference:set",
            "ui",
            "favoriteMenus",
            favorites,
          );
          localStorage.removeItem("favoriteMenus");
        }

        const recentsData = localStorage.getItem("recentMenus");
        if (recentsData) {
          const recents = JSON.parse(recentsData);
          await (window as any).electronAPI.invoke(
            "preference:set",
            "ui",
            "recentMenus",
            recents,
          );
          localStorage.removeItem("recentMenus");
        }

        const pinnedData = localStorage.getItem("pinnedMenus");
        if (pinnedData) {
          const pinned = JSON.parse(pinnedData);
          await (window as any).electronAPI.invoke(
            "preference:set",
            "ui",
            "pinnedMenus",
            pinned,
          );
          localStorage.removeItem("pinnedMenus");
        }

        await (window as any).electronAPI.invoke(
          "preference:set",
          "system",
          "localStorageMigrated",
          true,
        );
        logger.info("[AppStore] Migration complete");
      } catch (error) {
        logger.error("[AppStore] Migration failed:", error as any);
      }
    },
  },
});
