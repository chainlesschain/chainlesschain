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
  },
});
