import { defineStore } from 'pinia';

export const useAppStore = defineStore('app', {
  state: () => ({
    // 用户认证状态
    isAuthenticated: false,
    ukeyStatus: { detected: true, unlocked: false }, // MVP模式：默认为true便于开发测试
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
    },
  },
});
