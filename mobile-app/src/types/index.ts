/**
 * Shared TypeScript Types for ChainlessChain Mobile
 */

// Knowledge Item Types
export interface KnowledgeItem {
  id: string;
  title: string;
  content: string;
  type: 'note' | 'document' | 'link' | 'image';
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
  deviceId: string;
  encryptedContent?: string;
  syncStatus: 'synced' | 'pending' | 'conflict' | 'local';
}

// User Authentication
export interface User {
  id: string;
  deviceId: string;
  publicKey: string;
  simKeyConnected: boolean;
  lastLoginAt: Date;
}

// SIMKey Types
export interface SIMKeyStatus {
  connected: boolean;
  serialNumber?: string;
  manufacturer?: string;
  cardType?: string;
}

export interface SIMKeyCredentials {
  pin: string;
}

// AI Chat Types
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  tokens?: number;
}

export interface ChatSession {
  id: string;
  messages: ChatMessage[];
  context?: string;
  createdAt: Date;
}

// Sync Types
export interface SyncConfig {
  enabled: boolean;
  serverUrl?: string;
  lastSyncAt?: Date;
  autoSync: boolean;
}

export interface SyncStatus {
  status: 'idle' | 'syncing' | 'error';
  lastSync?: Date;
  pendingChanges: number;
  error?: string;
}

// Navigation Types
export type RootStackParamList = {
  Login: undefined;
  Main: undefined;
};

export type MainTabParamList = {
  Knowledge: undefined;
  Chat: undefined;
  Settings: undefined;
};

export type KnowledgeStackParamList = {
  KnowledgeList: undefined;
  KnowledgeEdit: {id?: string};
  KnowledgeView: {id: string};
};
