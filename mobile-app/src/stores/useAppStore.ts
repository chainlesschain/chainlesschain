/**
 * Global State Management using Zustand
 */

import {create} from 'zustand';
import type {
  User,
  KnowledgeItem,
  ChatMessage,
  SIMKeyStatus,
  SyncStatus,
} from '../types';

interface AppState {
  // User State
  user: User | null;
  isAuthenticated: boolean;
  simKeyStatus: SIMKeyStatus;

  // Knowledge State
  knowledgeItems: KnowledgeItem[];
  currentItem: KnowledgeItem | null;
  searchQuery: string;
  filteredItems: KnowledgeItem[];

  // Chat State
  messages: ChatMessage[];
  isAITyping: boolean;

  // Sync State
  syncStatus: SyncStatus;

  // UI State
  loading: boolean;
  error: string | null;

  // Actions
  setUser: (user: User | null) => void;
  setAuthenticated: (isAuth: boolean) => void;
  setSIMKeyStatus: (status: SIMKeyStatus) => void;

  setKnowledgeItems: (items: KnowledgeItem[]) => void;
  addKnowledgeItem: (item: KnowledgeItem) => void;
  updateKnowledgeItem: (id: string, updates: Partial<KnowledgeItem>) => void;
  deleteKnowledgeItem: (id: string) => void;
  setCurrentItem: (item: KnowledgeItem | null) => void;

  setSearchQuery: (query: string) => void;
  filterItems: () => void;

  addMessage: (message: ChatMessage) => void;
  clearMessages: () => void;
  setAITyping: (typing: boolean) => void;

  setSyncStatus: (status: SyncStatus) => void;

  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;

  logout: () => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  // Initial State
  user: null,
  isAuthenticated: false,
  simKeyStatus: {connected: false},

  knowledgeItems: [],
  currentItem: null,
  searchQuery: '',
  filteredItems: [],

  messages: [],
  isAITyping: false,

  syncStatus: {
    status: 'idle',
    pendingChanges: 0,
  },

  loading: false,
  error: null,

  // Actions
  setUser: (user) => set({user}),
  setAuthenticated: (isAuthenticated) => set({isAuthenticated}),
  setSIMKeyStatus: (simKeyStatus) => set({simKeyStatus}),

  setKnowledgeItems: (knowledgeItems) => {
    set({knowledgeItems});
    get().filterItems();
  },

  addKnowledgeItem: (item) => {
    const items = [...get().knowledgeItems, item];
    set({knowledgeItems: items});
    get().filterItems();
  },

  updateKnowledgeItem: (id, updates) => {
    const items = get().knowledgeItems.map((item) =>
      item.id === id ? {...item, ...updates, updatedAt: new Date()} : item
    );
    set({knowledgeItems: items});

    // Update current item if it's the one being edited
    const current = get().currentItem;
    if (current && current.id === id) {
      set({currentItem: {...current, ...updates, updatedAt: new Date()}});
    }

    get().filterItems();
  },

  deleteKnowledgeItem: (id) => {
    const items = get().knowledgeItems.filter((item) => item.id !== id);
    set({knowledgeItems: items});

    // Clear current item if it's the one being deleted
    if (get().currentItem?.id === id) {
      set({currentItem: null});
    }

    get().filterItems();
  },

  setCurrentItem: (currentItem) => set({currentItem}),

  setSearchQuery: (searchQuery) => {
    set({searchQuery});
    get().filterItems();
  },

  filterItems: () => {
    const {knowledgeItems, searchQuery} = get();

    if (!searchQuery.trim()) {
      set({filteredItems: knowledgeItems});
      return;
    }

    const query = searchQuery.toLowerCase();
    const filtered = knowledgeItems.filter(
      (item) =>
        item.title.toLowerCase().includes(query) ||
        item.content.toLowerCase().includes(query) ||
        item.tags.some((tag) => tag.toLowerCase().includes(query))
    );

    set({filteredItems: filtered});
  },

  addMessage: (message) => {
    set({messages: [...get().messages, message]});
  },

  clearMessages: () => set({messages: []}),

  setAITyping: (isAITyping) => set({isAITyping}),

  setSyncStatus: (syncStatus) => set({syncStatus}),

  setLoading: (loading) => set({loading}),

  setError: (error) => set({error}),

  logout: () => {
    set({
      user: null,
      isAuthenticated: false,
      knowledgeItems: [],
      currentItem: null,
      messages: [],
      searchQuery: '',
      filteredItems: [],
    });
  },
}));
