/**
 * Pinia Store 类型定义
 *
 * @description 定义 Pinia stores 的状态、getters 和 actions 类型
 */

import type { Ref, ComputedRef } from 'vue';

// ==================== App Store ====================

/**
 * 主题类型
 */
export type ThemeMode = 'light' | 'dark' | 'system';

/**
 * 语言类型
 */
export type Locale = 'zh-CN' | 'en-US';

/**
 * App Store 状态
 */
export interface AppState {
  isLoading: boolean;
  isInitialized: boolean;
  theme: ThemeMode;
  locale: Locale;
  sidebarCollapsed: boolean;
  version: string;
  updateAvailable: boolean;
  error: string | null;
}

/**
 * App Store Getters
 */
export interface AppGetters {
  isDarkMode: boolean;
  isLightMode: boolean;
  currentTheme: ThemeMode;
}

/**
 * App Store Actions
 */
export interface AppActions {
  initialize(): Promise<void>;
  setTheme(theme: ThemeMode): void;
  setLocale(locale: Locale): void;
  toggleSidebar(): void;
  setLoading(loading: boolean): void;
  setError(error: string | null): void;
  checkUpdate(): Promise<boolean>;
}

// ==================== Auth Store ====================

/**
 * 用户信息
 */
export interface UserInfo {
  id: string;
  username: string;
  email?: string;
  avatar?: string;
  did?: string;
  roles?: string[];
  permissions?: string[];
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Auth Store 状态
 */
export interface AuthState {
  isAuthenticated: boolean;
  user: UserInfo | null;
  token: string | null;
  refreshToken: string | null;
  loginTime: number | null;
  ukeyDetected: boolean;
  ukeyVerified: boolean;
}

/**
 * 登录凭证
 */
export interface LoginCredentials {
  username: string;
  password: string;
  rememberMe?: boolean;
}

/**
 * Auth Store Actions
 */
export interface AuthActions {
  login(credentials: LoginCredentials): Promise<boolean>;
  logout(): Promise<void>;
  refreshSession(): Promise<boolean>;
  checkAuth(): Promise<boolean>;
  verifyUKey(pin: string): Promise<boolean>;
  detectUKey(): Promise<boolean>;
}

// ==================== Session Store ====================

/**
 * 聊天消息
 */
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  tokens?: number;
  metadata?: Record<string, any>;
}

/**
 * 聊天会话
 */
export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
  tags?: string[];
  summary?: string;
  compressed?: boolean;
  tokenCount?: number;
}

/**
 * Session Store 状态
 */
export interface SessionState {
  sessions: ChatSession[];
  currentSessionId: string | null;
  isLoading: boolean;
  isSending: boolean;
  error: string | null;
}

/**
 * Session Store Actions
 */
export interface SessionActions {
  loadSessions(): Promise<void>;
  createSession(title?: string): Promise<string>;
  deleteSession(id: string): Promise<void>;
  setCurrentSession(id: string): void;
  sendMessage(content: string): Promise<void>;
  compressSession(id: string): Promise<void>;
  searchSessions(query: string): Promise<ChatSession[]>;
  exportSession(id: string): Promise<string>;
  importSession(data: string): Promise<void>;
}

// ==================== Conversation Store ====================

/**
 * Conversation Store 状态
 */
export interface ConversationState {
  conversations: ChatSession[];
  activeConversationId: string | null;
  isStreaming: boolean;
  streamContent: string;
}

/**
 * Conversation Store Actions
 */
export interface ConversationActions {
  loadConversations(): Promise<void>;
  createConversation(title?: string): Promise<string>;
  deleteConversation(id: string): Promise<void>;
  setActiveConversation(id: string): void;
  sendMessage(content: string, options?: any): Promise<void>;
  stopStreaming(): void;
  clearConversation(id: string): Promise<void>;
}

// ==================== Project Store ====================

/**
 * 项目信息
 */
export interface ProjectInfo {
  id: string;
  name: string;
  description?: string;
  path?: string;
  type?: string;
  status?: 'active' | 'archived' | 'deleted';
  tags?: string[];
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, any>;
}

/**
 * Project Store 状态
 */
export interface ProjectState {
  projects: ProjectInfo[];
  currentProjectId: string | null;
  isLoading: boolean;
  error: string | null;
}

/**
 * Project Store Actions
 */
export interface ProjectActions {
  loadProjects(): Promise<void>;
  createProject(project: Partial<ProjectInfo>): Promise<string>;
  updateProject(id: string, updates: Partial<ProjectInfo>): Promise<void>;
  deleteProject(id: string): Promise<void>;
  setCurrentProject(id: string): void;
  archiveProject(id: string): Promise<void>;
}

// ==================== LLM Store ====================

/**
 * LLM 模型信息
 */
export interface LLMModelInfo {
  id: string;
  name: string;
  provider: string;
  contextLength: number;
  pricing?: {
    input: number;
    output: number;
  };
}

/**
 * LLM 使用统计
 */
export interface LLMUsageStats {
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  totalCost: number;
  requestCount: number;
  avgLatency: number;
}

/**
 * LLM Store 状态
 */
export interface LLMState {
  isAvailable: boolean;
  currentModel: string | null;
  models: LLMModelInfo[];
  usage: LLMUsageStats;
  isLoading: boolean;
  error: string | null;
}

/**
 * LLM Store Actions
 */
export interface LLMActions {
  checkStatus(): Promise<boolean>;
  setModel(modelId: string): void;
  loadModels(): Promise<void>;
  resetUsage(): void;
  getUsageReport(): LLMUsageStats;
}

// ==================== Memory Store ====================

/**
 * 记忆条目
 */
export interface MemoryEntry {
  id: string;
  type: 'daily' | 'insight' | 'note';
  content: string;
  date: string;
  tags?: string[];
  metadata?: Record<string, any>;
}

/**
 * Memory Store 状态
 */
export interface MemoryState {
  entries: MemoryEntry[];
  insights: string[];
  isLoading: boolean;
  error: string | null;
}

/**
 * Memory Store Actions
 */
export interface MemoryActions {
  loadMemories(): Promise<void>;
  saveDailyNote(content: string): Promise<void>;
  searchMemories(query: string): Promise<MemoryEntry[]>;
  getInsights(): Promise<string[]>;
}

// ==================== Permission Store ====================

/**
 * 权限信息
 */
export interface Permission {
  id: string;
  name: string;
  description?: string;
  resource: string;
  actions: string[];
}

/**
 * 角色信息
 */
export interface Role {
  id: string;
  name: string;
  description?: string;
  permissions: string[];
}

/**
 * Permission Store 状态
 */
export interface PermissionState {
  permissions: Permission[];
  roles: Role[];
  userPermissions: string[];
  isLoading: boolean;
}

/**
 * Permission Store Actions
 */
export interface PermissionActions {
  loadPermissions(): Promise<void>;
  checkPermission(permission: string): boolean;
  hasRole(role: string): boolean;
}

// ==================== Team Store ====================

/**
 * 团队成员
 */
export interface TeamMember {
  id: string;
  userId: string;
  username: string;
  role: 'owner' | 'admin' | 'member';
  joinedAt: string;
}

/**
 * 团队信息
 */
export interface TeamInfo {
  id: string;
  name: string;
  description?: string;
  members: TeamMember[];
  parentId?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Team Store 状态
 */
export interface TeamState {
  teams: TeamInfo[];
  currentTeamId: string | null;
  isLoading: boolean;
  error: string | null;
}

/**
 * Team Store Actions
 */
export interface TeamActions {
  loadTeams(): Promise<void>;
  createTeam(team: Partial<TeamInfo>): Promise<string>;
  updateTeam(id: string, updates: Partial<TeamInfo>): Promise<void>;
  deleteTeam(id: string): Promise<void>;
  addMember(teamId: string, userId: string, role?: string): Promise<void>;
  removeMember(teamId: string, userId: string): Promise<void>;
}

// ==================== Workflow Store ====================

/**
 * 工作流节点
 */
export interface WorkflowNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: Record<string, any>;
}

/**
 * 工作流边
 */
export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  type?: string;
}

/**
 * 工作流信息
 */
export interface WorkflowInfo {
  id: string;
  name: string;
  description?: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  status: 'draft' | 'active' | 'paused' | 'completed';
  createdAt: string;
  updatedAt: string;
}

/**
 * Workflow Store 状态
 */
export interface WorkflowState {
  workflows: WorkflowInfo[];
  currentWorkflowId: string | null;
  isExecuting: boolean;
  executionLog: string[];
  error: string | null;
}

/**
 * Workflow Store Actions
 */
export interface WorkflowActions {
  loadWorkflows(): Promise<void>;
  createWorkflow(workflow: Partial<WorkflowInfo>): Promise<string>;
  updateWorkflow(id: string, updates: Partial<WorkflowInfo>): Promise<void>;
  deleteWorkflow(id: string): Promise<void>;
  executeWorkflow(id: string): Promise<void>;
  stopWorkflow(id: string): Promise<void>;
}

// ==================== 通用 Store 类型 ====================

/**
 * Store 状态基类
 */
export interface BaseState {
  isLoading: boolean;
  error: string | null;
}

/**
 * CRUD Store Actions
 */
export interface CRUDActions<T> {
  load(): Promise<void>;
  create(item: Partial<T>): Promise<string>;
  update(id: string, updates: Partial<T>): Promise<void>;
  delete(id: string): Promise<void>;
  getById(id: string): T | undefined;
}
