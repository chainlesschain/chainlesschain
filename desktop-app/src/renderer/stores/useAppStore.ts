import { create } from 'zustand';
import type {
  KnowledgeItem,
  UKeyStatus,
  GitStatus,
  LLMServiceStatus,
  AppConfig,
  Message,
} from '@shared/types';

interface AppState {
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
  messages: Message[];
  isAITyping: boolean;

  // 系统状态
  gitStatus: GitStatus | null;
  llmStatus: LLMServiceStatus;
  appConfig: AppConfig;

  // UI状态
  sidebarCollapsed: boolean;
  chatPanelVisible: boolean;
  loading: boolean;

  // Actions
  setAuthenticated: (authenticated: boolean) => void;
  setUKeyStatus: (status: UKeyStatus) => void;
  setDeviceId: (deviceId: string | null) => void;

  setKnowledgeItems: (items: KnowledgeItem[]) => void;
  setCurrentItem: (item: KnowledgeItem | null) => void;
  addKnowledgeItem: (item: KnowledgeItem) => void;
  updateKnowledgeItem: (id: string, updates: Partial<KnowledgeItem>) => void;
  deleteKnowledgeItem: (id: string) => void;

  setSearchQuery: (query: string) => void;
  filterItems: () => void;

  addMessage: (message: Message) => void;
  clearMessages: () => void;
  setIsAITyping: (typing: boolean) => void;

  setGitStatus: (status: GitStatus | null) => void;
  setLLMStatus: (status: LLMServiceStatus) => void;
  setAppConfig: (config: Partial<AppConfig>) => void;

  setSidebarCollapsed: (collapsed: boolean) => void;
  setChatPanelVisible: (visible: boolean) => void;
  setLoading: (loading: boolean) => void;

  logout: () => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  // 初始状态
  isAuthenticated: false,
  ukeyStatus: { detected: true, unlocked: false }, // MVP模式：默认为true便于开发测试
  deviceId: null,

  knowledgeItems: [],
  currentItem: null,
  searchQuery: '',
  filteredItems: [],

  messages: [],
  isAITyping: false,

  gitStatus: null,
  llmStatus: { available: false, models: [] },
  appConfig: {
    theme: 'light',
    llmModel: 'qwen2:7b',
    gitRemote: null,
    autoSync: false,
    syncInterval: 30,
  },

  sidebarCollapsed: false,
  chatPanelVisible: false,
  loading: false,

  // Actions
  setAuthenticated: (authenticated) => set({ isAuthenticated: authenticated }),

  setUKeyStatus: (status) => set({ ukeyStatus: status }),

  setDeviceId: (deviceId) => set({ deviceId }),

  setKnowledgeItems: (items) => {
    set({ knowledgeItems: items });
    get().filterItems();
  },

  setCurrentItem: (item) => set({ currentItem: item }),

  addKnowledgeItem: (item) => {
    const items = [...get().knowledgeItems, item];
    set({ knowledgeItems: items });
    get().filterItems();
  },

  updateKnowledgeItem: (id, updates) => {
    const items = get().knowledgeItems.map((item) =>
      item.id === id ? { ...item, ...updates } : item
    );
    set({ knowledgeItems: items });

    // 更新当前项
    const currentItem = get().currentItem;
    if (currentItem && currentItem.id === id) {
      set({ currentItem: { ...currentItem, ...updates } });
    }

    get().filterItems();
  },

  deleteKnowledgeItem: (id) => {
    const items = get().knowledgeItems.filter((item) => item.id !== id);
    set({ knowledgeItems: items });

    // 如果删除的是当前项，清空当前项
    const currentItem = get().currentItem;
    if (currentItem && currentItem.id === id) {
      set({ currentItem: null });
    }

    get().filterItems();
  },

  setSearchQuery: (query) => {
    set({ searchQuery: query });
    get().filterItems();
  },

  filterItems: () => {
    const { knowledgeItems, searchQuery } = get();

    if (!searchQuery.trim()) {
      set({ filteredItems: knowledgeItems });
      return;
    }

    const query = searchQuery.toLowerCase();
    const filtered = knowledgeItems.filter((item) =>
      item.title.toLowerCase().includes(query) ||
      item.content?.toLowerCase().includes(query)
    );

    set({ filteredItems: filtered });
  },

  addMessage: (message) => {
    const messages = [...get().messages, message];
    set({ messages });
  },

  clearMessages: () => set({ messages: [] }),

  setIsAITyping: (typing) => set({ isAITyping: typing }),

  setGitStatus: (status) => set({ gitStatus: status }),

  setLLMStatus: (status) => set({ llmStatus: status }),

  setAppConfig: (config) => {
    const appConfig = { ...get().appConfig, ...config };
    set({ appConfig });
  },

  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),

  setChatPanelVisible: (visible) => set({ chatPanelVisible: visible }),

  setLoading: (loading) => set({ loading }),

  logout: () => {
    set({
      isAuthenticated: false,
      ukeyStatus: { detected: false, unlocked: false },
      deviceId: null,
      knowledgeItems: [],
      currentItem: null,
      messages: [],
    });
  },
}));
