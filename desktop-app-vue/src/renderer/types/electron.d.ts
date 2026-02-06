/**
 * Electron API 类型定义
 *
 * @description 定义 window.electronAPI 的类型
 */

import type { IPCChannels, IPCResponse } from './ipc.d';

// ==================== Electron API 接口 ====================

/**
 * U-Key API
 */
export interface UKeyAPI {
  detect(): Promise<{ detected: boolean; deviceInfo?: any }>;
  verifyPIN(pin: string): Promise<{ success: boolean; error?: string }>;
  getPublicKey(): Promise<{ publicKey: string }>;
  sign(data: string): Promise<{ signature: string }>;
  encrypt(data: string): Promise<{ encrypted: string }>;
  decrypt(encrypted: string): Promise<{ decrypted: string }>;
}

/**
 * 认证 API
 */
export interface AuthAPI {
  verifyPassword(username: string, password: string): Promise<{ success: boolean; token?: string; error?: string }>;
  logout(): Promise<void>;
  getSession(): Promise<{ user?: any; isAuthenticated: boolean }>;
}

/**
 * 数据库 API
 */
export interface DatabaseAPI {
  getKnowledgeItems(): Promise<any[]>;
  getKnowledgeItemById(id: string): Promise<any>;
  addKnowledgeItem(item: any): Promise<{ id: string }>;
  updateKnowledgeItem(id: string, updates: any): Promise<void>;
  deleteKnowledgeItem(id: string): Promise<void>;
  searchKnowledgeItems(query: string): Promise<any[]>;
  query(sql: string, params?: any[]): Promise<any[]>;
  run(sql: string, params?: any[]): Promise<{ changes: number; lastInsertRowid: number }>;
}

/**
 * LLM API
 */
export interface LLMAPI {
  checkStatus(): Promise<{ available: boolean; model?: string }>;
  query(prompt: string, context?: any): Promise<{ response: string; usage?: any }>;
  chat(messages: any[], options?: any): Promise<{ response: string; usage?: any }>;
  streamChat(messages: any[], options?: any): Promise<void>;
  cancelStream(): Promise<void>;
}

/**
 * Git API
 */
export interface GitAPI {
  status(): Promise<{ files: any[]; branch: string }>;
  commit(message: string): Promise<void>;
  push(): Promise<void>;
  pull(): Promise<void>;
  log(count?: number): Promise<any[]>;
}

/**
 * 系统 API
 */
export interface SystemAPI {
  getVersion(): Promise<string>;
  minimize(): void;
  maximize(): void;
  close(): void;
  isMaximized(): Promise<boolean>;
  openExternal(url: string): Promise<void>;
  showItemInFolder(path: string): void;
  getPath(name: string): Promise<string>;
  getPlatform(): string;
}

/**
 * 文件 API
 */
export interface FileAPI {
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  mkdir(path: string): Promise<void>;
  readdir(path: string): Promise<string[]>;
  unlink(path: string): Promise<void>;
  stat(path: string): Promise<{ size: number; mtime: Date; isDirectory: boolean }>;
  selectFile(options?: { filters?: any[]; multiple?: boolean }): Promise<string | string[] | null>;
  selectDirectory(): Promise<string | null>;
  saveFile(options?: { defaultPath?: string; filters?: any[] }): Promise<string | null>;
}

/**
 * 对话框 API
 */
export interface DialogAPI {
  showMessage(options: { type?: string; title?: string; message: string; buttons?: string[] }): Promise<number>;
  showError(title: string, content: string): Promise<void>;
  showInfo(title: string, content: string): Promise<void>;
  showConfirm(title: string, message: string): Promise<boolean>;
}

/**
 * 剪贴板 API
 */
export interface ClipboardAPI {
  readText(): Promise<string>;
  writeText(text: string): Promise<void>;
  readImage(): Promise<string | null>;
  writeImage(dataUrl: string): Promise<void>;
}

/**
 * 通知 API
 */
export interface NotificationAPI {
  show(options: { title: string; body: string; icon?: string }): Promise<void>;
  getAll(): Promise<any[]>;
  markAsRead(id: string): Promise<void>;
  clearAll(): Promise<void>;
}

/**
 * 项目 API
 */
export interface ProjectAPI {
  getAll(): Promise<any[]>;
  getById(id: string): Promise<any>;
  create(project: any): Promise<{ id: string }>;
  update(id: string, updates: any): Promise<void>;
  delete(id: string): Promise<void>;
}

/**
 * 模板 API
 */
export interface TemplateAPI {
  getAll(): Promise<any[]>;
  getById(id: string): Promise<any>;
  create(template: any): Promise<{ id: string }>;
  update(id: string, updates: any): Promise<void>;
  delete(id: string): Promise<void>;
}

/**
 * 聊天 API
 */
export interface ChatAPI {
  getSessions(): Promise<any[]>;
  getSession(id: string): Promise<any>;
  createSession(options?: any): Promise<{ id: string }>;
  deleteSession(id: string): Promise<void>;
  getMessages(sessionId: string): Promise<any[]>;
  sendMessage(sessionId: string, message: string): Promise<any>;
}

/**
 * 好友 API
 */
export interface FriendAPI {
  getFriends(): Promise<any[]>;
  addFriend(did: string): Promise<void>;
  removeFriend(did: string): Promise<void>;
  sendMessage(did: string, message: string): Promise<void>;
}

/**
 * P2P API
 */
export interface P2PAPI {
  connect(peerId: string): Promise<void>;
  disconnect(peerId: string): Promise<void>;
  send(peerId: string, data: any): Promise<void>;
  broadcast(data: any): Promise<void>;
  getPeers(): Promise<string[]>;
  onMessage(callback: (peerId: string, data: any) => void): void;
}

/**
 * DID API
 */
export interface DIDAPI {
  create(): Promise<{ did: string; privateKey: string }>;
  resolve(did: string): Promise<any>;
  sign(did: string, data: string): Promise<string>;
  verify(did: string, data: string, signature: string): Promise<boolean>;
}

/**
 * RAG API
 */
export interface RAGAPI {
  search(query: string, options?: any): Promise<any[]>;
  addDocument(document: any): Promise<void>;
  deleteDocument(id: string): Promise<void>;
  reindex(): Promise<void>;
}

/**
 * MCP API
 */
export interface MCPAPI {
  listServers(): Promise<any[]>;
  connectServer(serverId: string): Promise<void>;
  disconnectServer(serverId: string): Promise<void>;
  callTool(serverId: string, toolName: string, params: any): Promise<any>;
}

/**
 * 多媒体 API
 */
export interface MultimediaAPI {
  uploadImage(path: string, options?: any): Promise<any>;
  compressImage(path: string, options?: any): Promise<any>;
  transcribeAudio(path: string, options?: any): Promise<any>;
  processVideo(path: string, options?: any): Promise<any>;
  getVideoInfo(path: string): Promise<any>;
}

/**
 * 主 Electron API 接口
 */
export interface ElectronAPI {
  // 核心 API
  invoke<T = any>(channel: string, ...args: any[]): Promise<T>;
  on(channel: string, listener: (...args: any[]) => void): void;
  once(channel: string, listener: (...args: any[]) => void): void;
  removeListener(channel: string, listener: (...args: any[]) => void): void;
  removeAllListeners(channel: string): void;

  // 模块化 API
  ukey: UKeyAPI;
  auth: AuthAPI;
  db: DatabaseAPI;
  llm: LLMAPI;
  git: GitAPI;
  system: SystemAPI;
  file: FileAPI;
  dialog: DialogAPI;
  clipboard: ClipboardAPI;
  notification: NotificationAPI;
  project: ProjectAPI;
  template: TemplateAPI;
  chat: ChatAPI;
  friend: FriendAPI;
  p2p: P2PAPI;
  did: DIDAPI;
  rag: RAGAPI;
  mcp: MCPAPI;
  multimedia: MultimediaAPI;
}

// ==================== 全局类型扩展 ====================

declare global {
  interface Window {
    electronAPI: ElectronAPI;
    // Vue 应用实例
    app?: {
      config: {
        errorHandler?: (err: Error, instance: any, info: string) => void;
        warnHandler?: (msg: string, instance: any, trace: string) => void;
      };
    };
  }
}

export {};
