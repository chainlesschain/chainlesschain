import { defineStore } from 'pinia';

export const useAppStore = defineStore('app', {
  state: () => ({
    // 用户认证状态
    isAuthenticated: false,
    ukeyStatus: { detected: false, unlocked: false },
    deviceId: null,

    // 知识库数据
    knowledgeItems: [],
    currentItem: null,
    searchQuery: '',
    filteredItems: [],

    // AI对话
    messages: [],
    isAITyping: false,

    // 系统状态
    gitStatus: null,
    llmStatus: { available: false, models: [] },
    appConfig: {
      theme: 'light',
      llmModel: 'qwen2:7b',
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
        key: 'home',
        title: '首页',
        path: '/', query: null,
        closable: false, // 首页不可关闭
      },
    ],
    activeTabKey: 'home',

    // 菜单收藏和快捷访问
    favoriteMenus: [], // 收藏的菜单项 [{key, title, path, icon, query}]
    recentMenus: [],   // 最近访问的菜单项 (最多10个)
    pinnedMenus: [],   // 置顶的菜单项
  }),

  getters: {
    // 过滤后的知识库项
    getFilteredItems: (state) => {
      if (!state.searchQuery.trim()) {
        return state.knowledgeItems;
      }

      const query = state.searchQuery.toLowerCase();
      return state.knowledgeItems.filter((item) =>
        item.title.toLowerCase().includes(query) ||
        (item.content && item.content.toLowerCase().includes(query))
      );
    },
  },

  actions: {
    // 认证相关
    setAuthenticated(authenticated) {
      this.isAuthenticated = authenticated;
    },

    setUKeyStatus(status) {
      this.ukeyStatus = status;
    },

    setDeviceId(deviceId) {
      this.deviceId = deviceId;
    },

    // 知识库相关
    setKnowledgeItems(items) {
      this.knowledgeItems = items;
      this.filterItems();
    },

    setCurrentItem(item) {
      this.currentItem = item;
    },

    addKnowledgeItem(item) {
      this.knowledgeItems.push(item);
      this.filterItems();
    },

    updateKnowledgeItem(id, updates) {
      const index = this.knowledgeItems.findIndex((item) => item.id === id);
      if (index !== -1) {
        this.knowledgeItems[index] = { ...this.knowledgeItems[index], ...updates };
      }

      // 更新当前项
      if (this.currentItem && this.currentItem.id === id) {
        this.currentItem = { ...this.currentItem, ...updates };
      }

      this.filterItems();
    },

    deleteKnowledgeItem(id) {
      const index = this.knowledgeItems.findIndex((item) => item.id === id);
      if (index !== -1) {
        this.knowledgeItems.splice(index, 1);
      }

      // 如果删除的是当前项，清空当前项
      if (this.currentItem && this.currentItem.id === id) {
        this.currentItem = null;
      }

      this.filterItems();
    },

    setSearchQuery(query) {
      this.searchQuery = query;
      this.filterItems();
    },

    filterItems() {
      if (!this.searchQuery.trim()) {
        this.filteredItems = this.knowledgeItems;
        return;
      }

      const query = this.searchQuery.toLowerCase();
      this.filteredItems = this.knowledgeItems.filter((item) =>
        item.title.toLowerCase().includes(query) ||
        (item.content && item.content.toLowerCase().includes(query))
      );
    },

    // AI对话相关
    addMessage(message) {
      this.messages.push(message);
    },

    clearMessages() {
      this.messages = [];
    },

    setIsAITyping(typing) {
      this.isAITyping = typing;
    },

    // 系统状态相关
    setGitStatus(status) {
      this.gitStatus = status;
    },

    setLLMStatus(status) {
      this.llmStatus = status;
    },

    setAppConfig(config) {
      this.appConfig = { ...this.appConfig, ...config };
    },

    // UI状态相关
    setSidebarCollapsed(collapsed) {
      this.sidebarCollapsed = collapsed;
    },

    setChatPanelVisible(visible) {
      this.chatPanelVisible = visible;
    },

    setLoading(loading) {
      this.loading = loading;
    },

    // 登出
    logout() {
      this.isAuthenticated = false;
      this.ukeyStatus = { detected: false, unlocked: false };
      this.deviceId = null;
      this.knowledgeItems = [];
      this.currentItem = null;
      this.messages = [];
      // 重置标签页
      this.tabs = [
        {
          key: 'home',
          title: '首页',
          path: '/', query: null,
          closable: false,
        },
      ];
      this.activeTabKey = 'home';
    },

    // 多标签页管理
    addTab(tab) {
      // 检查标签页是否已存在
      const existingTab = this.tabs.find((t) => t.key === tab.key);
      if (existingTab) {
        // 如果存在，激活该标签
        this.activeTabKey = tab.key;
        return;
      }

      // 添加新标签页
      this.tabs.push({
        key: tab.key,
        title: tab.title,
        path: tab.path, query: tab.query || null,
        closable: tab.closable !== false, // 默认可关闭
      });
      this.activeTabKey = tab.key;
    },

    removeTab(targetKey) {
      const tabs = this.tabs;
      let activeKey = this.activeTabKey;

      // 不能关闭首页
      if (targetKey === 'home') {
        return;
      }

      // 找到要删除的标签页的索引
      const targetIndex = tabs.findIndex((tab) => tab.key === targetKey);
      if (targetIndex === -1) return;

      // 如果关闭的是当前激活的标签，需要激活另一个标签
      if (targetKey === activeKey) {
        // 优先激活下一个，如果没有下一个，激活上一个
        const nextTab = tabs[targetIndex + 1] || tabs[targetIndex - 1];
        activeKey = nextTab ? nextTab.key : 'home';
      }

      // 移除标签页
      this.tabs = tabs.filter((tab) => tab.key !== targetKey);
      this.activeTabKey = activeKey;
    },

    setActiveTab(key) {
      this.activeTabKey = key;
    },

    closeAllTabs() {
      this.tabs = [
        {
          key: 'home',
          title: '首页',
          path: '/', query: null,
          closable: false,
        },
      ];
      this.activeTabKey = 'home';
    },

    closeOtherTabs(targetKey) {
      this.tabs = this.tabs.filter(
        (tab) => tab.key === targetKey || tab.key === 'home'
      );
      this.activeTabKey = targetKey;
    },

    // ==================== 菜单收藏和快捷访问 ====================

    /**
     * 添加收藏菜单
     */
    addFavoriteMenu(menu) {
      // 检查是否已收藏
      const exists = this.favoriteMenus.find(m => m.key === menu.key);
      if (exists) return;

      // 添加到收藏列表
      this.favoriteMenus.push({
        key: menu.key,
        title: menu.title,
        path: menu.path,
        icon: menu.icon,
        query: menu.query || null,
        addedAt: Date.now()
      });

      // 保存到 localStorage
      this.saveFavoritesToStorage();
    },

    /**
     * 移除收藏菜单
     */
    removeFavoriteMenu(key) {
      this.favoriteMenus = this.favoriteMenus.filter(m => m.key !== key);
      this.saveFavoritesToStorage();
    },

    /**
     * 检查菜单是否已收藏
     */
    isFavoriteMenu(key) {
      return this.favoriteMenus.some(m => m.key === key);
    },

    /**
     * 切换收藏状态
     */
    toggleFavoriteMenu(menu) {
      if (this.isFavoriteMenu(menu.key)) {
        this.removeFavoriteMenu(menu.key);
      } else {
        this.addFavoriteMenu(menu);
      }
    },

    /**
     * 添加到最近访问
     */
    addRecentMenu(menu) {
      // 移除已存在的相同项
      this.recentMenus = this.recentMenus.filter(m => m.key !== menu.key);

      // 添加到列表开头
      this.recentMenus.unshift({
        key: menu.key,
        title: menu.title,
        path: menu.path,
        icon: menu.icon,
        query: menu.query || null,
        visitedAt: Date.now()
      });

      // 限制最多10个
      if (this.recentMenus.length > 10) {
        this.recentMenus = this.recentMenus.slice(0, 10);
      }

      // 保存到 localStorage
      this.saveRecentsToStorage();
    },

    /**
     * 清空最近访问
     */
    clearRecentMenus() {
      this.recentMenus = [];
      this.saveRecentsToStorage();
    },

    /**
     * 置顶菜单
     */
    pinMenu(menu) {
      // 检查是否已置顶
      const exists = this.pinnedMenus.find(m => m.key === menu.key);
      if (exists) return;

      // 添加到置顶列表
      this.pinnedMenus.push({
        key: menu.key,
        title: menu.title,
        path: menu.path,
        icon: menu.icon,
        query: menu.query || null,
        pinnedAt: Date.now()
      });

      this.savePinnedToStorage();
    },

    /**
     * 取消置顶
     */
    unpinMenu(key) {
      this.pinnedMenus = this.pinnedMenus.filter(m => m.key !== key);
      this.savePinnedToStorage();
    },

    /**
     * 检查菜单是否已置顶
     */
    isPinnedMenu(key) {
      return this.pinnedMenus.some(m => m.key === key);
    },

    /**
     * 保存收藏到 localStorage
     */
    saveFavoritesToStorage() {
      try {
        localStorage.setItem('favoriteMenus', JSON.stringify(this.favoriteMenus));
      } catch (error) {
        console.error('[AppStore] Failed to save favorites:', error);
      }
    },

    /**
     * 保存最近访问到 localStorage
     */
    saveRecentsToStorage() {
      try {
        localStorage.setItem('recentMenus', JSON.stringify(this.recentMenus));
      } catch (error) {
        console.error('[AppStore] Failed to save recents:', error);
      }
    },

    /**
     * 保存置顶到 localStorage
     */
    savePinnedToStorage() {
      try {
        localStorage.setItem('pinnedMenus', JSON.stringify(this.pinnedMenus));
      } catch (error) {
        console.error('[AppStore] Failed to save pinned:', error);
      }
    },

    /**
     * 从 localStorage 加载收藏
     */
    loadFavoritesFromStorage() {
      try {
        const data = localStorage.getItem('favoriteMenus');
        if (data) {
          this.favoriteMenus = JSON.parse(data);
        }
      } catch (error) {
        console.error('[AppStore] Failed to load favorites:', error);
      }
    },

    /**
     * 从 localStorage 加载最近访问
     */
    loadRecentsFromStorage() {
      try {
        const data = localStorage.getItem('recentMenus');
        if (data) {
          this.recentMenus = JSON.parse(data);
        }
      } catch (error) {
        console.error('[AppStore] Failed to load recents:', error);
      }
    },

    /**
     * 从 localStorage 加载置顶
     */
    loadPinnedFromStorage() {
      try {
        const data = localStorage.getItem('pinnedMenus');
        if (data) {
          this.pinnedMenus = JSON.parse(data);
        }
      } catch (error) {
        console.error('[AppStore] Failed to load pinned:', error);
      }
    },

    /**
     * 初始化菜单数据
     */
    initMenuData() {
      this.loadFavoritesFromStorage();
      this.loadRecentsFromStorage();
      this.loadPinnedFromStorage();
    },
  },
});
