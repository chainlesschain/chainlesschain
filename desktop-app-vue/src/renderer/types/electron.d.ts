/**
 * Electron API 类型定义
 *
 * @description 定义 window.electronAPI 的类型
 */

import type { IPCChannels, IPCResponse } from "./ipc.d";

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
  verifyPassword(
    username: string,
    password: string,
  ): Promise<{ success: boolean; token?: string; error?: string }>;
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
  run(
    sql: string,
    params?: any[],
  ): Promise<{ changes: number; lastInsertRowid: number }>;
}

/**
 * LLM API
 */
export interface LLMAPI {
  checkStatus(): Promise<{ available: boolean; model?: string }>;
  query(
    prompt: string,
    context?: any,
  ): Promise<{ response: string; usage?: any }>;
  chat(
    messages: any[],
    options?: any,
  ): Promise<{ response: string; usage?: any }>;
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
  stat(
    path: string,
  ): Promise<{ size: number; mtime: Date; isDirectory: boolean }>;
  selectFile(options?: {
    filters?: any[];
    multiple?: boolean;
  }): Promise<string | string[] | null>;
  selectDirectory(): Promise<string | null>;
  saveFile(options?: {
    defaultPath?: string;
    filters?: any[];
  }): Promise<string | null>;
}

/**
 * 对话框 API
 */
export interface DialogAPI {
  showMessage(options: {
    type?: string;
    title?: string;
    message: string;
    buttons?: string[];
  }): Promise<number>;
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
  getAll(userId?: string): Promise<any[] | { projects: any[]; total: number }>;
  getById(id: string): Promise<any>;
  create(project: any): Promise<{ id: string }>;
  update(id: string, updates: any): Promise<void>;
  delete(id: string): Promise<void>;
  sync(userId: string): Promise<void>;
  getFiles(projectId: string): Promise<any[] | { files: any[] }>;
  createStream(data: any, callbacks: any): Promise<any>;
}

/**
 * 模板 API
 */
export interface TemplateAPI {
  getAll(
    filters?: any,
  ): Promise<{ success: boolean; templates?: any[]; error?: string }>;
  getById(
    id: string,
  ): Promise<{ success: boolean; template?: any; error?: string }>;
  create(
    template: any,
  ): Promise<{ success: boolean; template?: any; id?: string; error?: string }>;
  update(
    id: string,
    updates: any,
  ): Promise<{ success: boolean; template?: any; error?: string }>;
  delete(id: string): Promise<{ success: boolean; error?: string }>;
  recordUsage(
    templateId: string,
    userId?: string,
    projectId?: string,
    variables?: any,
  ): Promise<{ success: boolean; error?: string }>;
  search(
    query: string,
    filters?: any,
  ): Promise<{ success: boolean; templates?: any[]; error?: string }>;
  renderPrompt(
    id: string,
    vars: any,
  ): Promise<{ success: boolean; renderedPrompt?: string; error?: string }>;
  duplicate(
    id: string,
    newName?: string,
  ): Promise<{ success: boolean; template?: any; error?: string }>;
  getStats(): Promise<any>;
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

export interface ConversationAPI {
  create(conversationData: any): Promise<any>;
  get(conversationId: string): Promise<any>;
  getByProject(projectId: string): Promise<any>;
  getRecent(options?: any): Promise<any>;
  getAll(options?: any): Promise<any>;
  update(conversationId: string, updates: any): Promise<any>;
  delete(conversationId: string): Promise<any>;
  createMessage(messageData: any): Promise<any>;
  addMessage(conversationId: string, messageData: any): Promise<any>;
  updateMessage(updateData: any): Promise<any>;
  getMessages(conversationId: string, options?: any): Promise<any>;
  deleteMessage(messageId: string): Promise<any>;
  clearMessages(conversationId: string): Promise<any>;
  agentChat(chatData: any): Promise<any>;
}

export interface CodingAgentEvent {
  id: string;
  type: string;
  timestamp: string;
  sessionId?: string | null;
  requestId?: string | null;
  payload: any;
}

export interface CodingAgentToolDescriptor {
  name: string;
  description: string;
  inputSchema?: any;
  isReadOnly: boolean;
  riskLevel: "low" | "medium" | "high";
  source: string;
  managedMetadata?: any;
}

export interface CodingAgentToolSummary {
  totalTools: number;
  toolsByRisk: {
    low: string[];
    medium: string[];
    high: string[];
  };
  toolsBySource?: Record<string, string[]>;
  managedToolSupport: boolean;
}

export interface CodingAgentPermissionPolicy {
  planModeRules: {
    low: string;
    medium: string;
    high: string;
  };
  toolsByRisk: {
    low: string[];
    medium: string[];
    high: string[];
  };
  toolsBySource?: Record<string, string[]>;
}

export interface CodingAgentSessionState {
  sessionId: string;
  status: string;
  provider?: string | null;
  model?: string | null;
  projectRoot?: string | null;
  baseProjectRoot?: string | null;
  createdAt?: string;
  updatedAt?: string;
  history?: Array<{ role: string; content: string }>;
  pendingRequests?: string[];
  lastPlanSummary?: string | null;
  lastPlanItems?: any[];
  planModeState?: string | null;
  requiresHighRiskConfirmation?: boolean;
  highRiskConfirmationGranted?: boolean;
  highRiskToolNames?: string[];
  worktreeIsolation?: boolean;
  worktree?: {
    branch?: string | null;
    path?: string | null;
    baseBranch?: string | null;
    hasChanges?: boolean | null;
    summary?: any;
    conflicts?: any[];
    previewEntrypoints?: any[];
    meta?: any;
  } | null;
}

export interface CodingAgentWorktreeRecord {
  branch?: string | null;
  path?: string | null;
  baseBranch?: string | null;
  hasChanges?: boolean | null;
  summary?: any;
  conflicts?: any[];
  previewEntrypoints?: any[];
  meta?: any;
}

export interface CodingAgentStatus {
  connected: boolean;
  host?: string;
  port?: number | null;
  tools?: CodingAgentToolDescriptor[];
  toolSummary?: CodingAgentToolSummary | null;
  permissionPolicy?: CodingAgentPermissionPolicy | null;
  harness?: CodingAgentHarnessStatus | null;
}

export interface CodingAgentBackgroundTask {
  id: string;
  type?: string;
  command?: string;
  cwd?: string;
  description?: string;
  status?: string;
  createdAt?: number;
  startedAt?: number | null;
  completedAt?: number | null;
  lastHeartbeat?: number | null;
  result?: any;
  error?: string | null;
  outputSummary?: any;
  history?: any[];
}

export interface CodingAgentHarnessStatus {
  sessions: {
    total: number;
    running: number;
    waitingApproval: number;
    active: number;
  };
  worktrees: {
    tracked: number;
    isolated: number;
    dirty: number;
  };
  backgroundTasks: {
    total: number;
    pending: number;
    running: number;
    completed: number;
    failed: number;
    timeout: number;
  };
}

export interface CodingAgentAPI {
  createSession(options?: any): Promise<any>;
  startSession(options?: any): Promise<any>;
  resumeSession(sessionId: string): Promise<any>;
  listSessions(): Promise<any>;
  sendMessage(payload: { sessionId: string; content: string }): Promise<any>;
  enterPlanMode(sessionId: string): Promise<any>;
  showPlan(sessionId: string): Promise<any>;
  approvePlan(sessionId: string): Promise<any>;
  respondApproval(payload: {
    sessionId: string;
    approvalType?: string;
    decision: string;
    status?: string;
    action?: string;
  }): Promise<any>;
  confirmHighRiskExecution(sessionId: string): Promise<any>;
  rejectPlan(sessionId: string): Promise<any>;
  closeSession(sessionId: string): Promise<any>;
  cancelSession(sessionId: string): Promise<any>;
  interrupt(sessionId: string): Promise<any>;
  getSessionState(sessionId: string): Promise<{
    success: boolean;
    session?: CodingAgentSessionState;
    error?: string;
  }>;
  getSessionEvents(
    sessionId: string,
  ): Promise<{ success: boolean; events?: CodingAgentEvent[]; error?: string }>;
  getHarnessStatus(): Promise<{
    success: boolean;
    harness?: CodingAgentHarnessStatus;
    error?: string;
  }>;
  listBackgroundTasks(payload?: { status?: string }): Promise<{
    success: boolean;
    tasks?: CodingAgentBackgroundTask[];
    error?: string;
  }>;
  getBackgroundTask(taskId: string): Promise<{
    success: boolean;
    task?: CodingAgentBackgroundTask | null;
    error?: string;
  }>;
  getBackgroundTaskHistory(payload: {
    taskId: string;
    limit?: number;
    offset?: number;
  }): Promise<{
    success: boolean;
    taskId?: string;
    history?: any;
    error?: string;
  }>;
  stopBackgroundTask(taskId: string): Promise<{
    success: boolean;
    taskId?: string;
    error?: string;
  }>;
  listWorktrees(): Promise<{
    success: boolean;
    worktrees?: CodingAgentWorktreeRecord[];
    error?: string;
  }>;
  getWorktreeDiff(payload: {
    sessionId: string;
    branch?: string;
    baseBranch?: string | null;
    filePath?: string | null;
  }): Promise<{
    success: boolean;
    sessionId?: string;
    branch?: string;
    filePath?: string | null;
    files?: any[];
    summary?: any;
    diff?: string | null;
    record?: CodingAgentWorktreeRecord | null;
    error?: string;
  }>;
  mergeWorktree(payload: {
    sessionId: string;
    branch?: string;
    strategy?: string;
    commitMessage?: string | null;
  }): Promise<{
    success: boolean;
    sessionId?: string;
    branch?: string;
    strategy?: string;
    message?: string | null;
    summary?: any;
    conflicts?: any[];
    suggestions?: string[];
    previewEntrypoints?: any[];
    record?: CodingAgentWorktreeRecord | null;
    error?: string;
  }>;
  previewWorktreeMerge(payload: {
    sessionId: string;
    branch?: string;
    baseBranch?: string | null;
    strategy?: string;
  }): Promise<{
    success: boolean;
    previewOnly?: boolean;
    sessionId?: string;
    branch?: string;
    baseBranch?: string | null;
    strategy?: string;
    message?: string | null;
    summary?: any;
    conflicts?: any[];
    suggestions?: string[];
    previewEntrypoints?: any[];
    record?: CodingAgentWorktreeRecord | null;
    error?: string;
  }>;
  applyWorktreeAutomation(payload: {
    sessionId: string;
    branch?: string;
    baseBranch?: string | null;
    filePath: string;
    candidateId: string;
    conflictType?: string | null;
  }): Promise<{
    success: boolean;
    sessionId?: string;
    branch?: string;
    baseBranch?: string | null;
    filePath?: string | null;
    candidateId?: string | null;
    message?: string | null;
    files?: any[];
    summary?: any;
    diff?: string | null;
    record?: CodingAgentWorktreeRecord | null;
    error?: string;
  }>;
  listSubAgents(sessionId?: string | null): Promise<{
    success: boolean;
    sessionId?: string | null;
    active?: CodingAgentSubAgentSnapshot[];
    history?: CodingAgentSubAgentSnapshot[];
    stats?: {
      active?: number;
      completed?: number;
      historySize?: number;
      totalTokens?: number;
      avgDurationMs?: number;
    } | null;
    error?: string;
  }>;
  getSubAgent(payload: {
    subAgentId: string;
    sessionId?: string | null;
  }): Promise<{
    success: boolean;
    subAgent?: CodingAgentSubAgentSnapshot | null;
    error?: string;
  }>;
  enterReview(payload: {
    sessionId: string;
    reason?: string | null;
    requestedBy?: string;
    checklist?: Array<{ id?: string; title: string; note?: string }>;
    blocking?: boolean;
  }): Promise<{
    success: boolean;
    sessionId?: string;
    reviewState?: CodingAgentReviewState | null;
    error?: string;
  }>;
  submitReviewComment(payload: {
    sessionId: string;
    comment?: { author?: string; content: string } | null;
    checklistItemId?: string | null;
    checklistItemDone?: boolean;
    checklistItemNote?: string;
  }): Promise<{
    success: boolean;
    sessionId?: string;
    reviewState?: CodingAgentReviewState | null;
    error?: string;
  }>;
  resolveReview(payload: {
    sessionId: string;
    decision: "approved" | "rejected";
    resolvedBy?: string;
    summary?: string | null;
  }): Promise<{
    success: boolean;
    sessionId?: string;
    reviewState?: CodingAgentReviewState | null;
    error?: string;
  }>;
  getReviewState(payload: { sessionId: string } | string): Promise<{
    success: boolean;
    sessionId?: string;
    reviewState?: CodingAgentReviewState | null;
    error?: string;
  }>;
  proposePatch(payload: {
    sessionId: string;
    files: CodingAgentPatchFileInput[];
    origin?: string;
    reason?: string | null;
    requestId?: string | null;
  }): Promise<{
    success: boolean;
    sessionId?: string;
    patch?: CodingAgentPatch | null;
    error?: string;
  }>;
  applyPatch(payload: {
    sessionId: string;
    patchId: string;
    resolvedBy?: string;
    note?: string | null;
  }): Promise<{
    success: boolean;
    sessionId?: string;
    patch?: CodingAgentPatch | null;
    error?: string;
  }>;
  rejectPatch(payload: {
    sessionId: string;
    patchId: string;
    resolvedBy?: string;
    reason?: string | null;
  }): Promise<{
    success: boolean;
    sessionId?: string;
    patch?: CodingAgentPatch | null;
    error?: string;
  }>;
  getPatchSummary(payload: { sessionId: string } | string): Promise<{
    success: boolean;
    sessionId?: string;
    summary?: CodingAgentPatchSummary | null;
    error?: string;
  }>;
  createTaskGraph(payload: {
    sessionId: string;
    graphId?: string | null;
    title?: string | null;
    description?: string | null;
    nodes: CodingAgentTaskNodeInput[];
  }): Promise<{
    success: boolean;
    sessionId?: string;
    graph?: CodingAgentTaskGraph | null;
    error?: string;
  }>;
  addTaskNode(payload: {
    sessionId: string;
    node: CodingAgentTaskNodeInput;
  }): Promise<{
    success: boolean;
    sessionId?: string;
    graph?: CodingAgentTaskGraph | null;
    nodeId?: string;
    error?: string;
  }>;
  updateTaskNode(payload: {
    sessionId: string;
    nodeId: string;
    updates: Partial<{
      status: CodingAgentTaskNode["status"];
      result: any;
      error: any;
      title: string;
      description: string | null;
      metadata: Record<string, any>;
    }>;
  }): Promise<{
    success: boolean;
    sessionId?: string;
    graph?: CodingAgentTaskGraph | null;
    nodeId?: string;
    error?: string;
  }>;
  advanceTaskGraph(payload: { sessionId: string } | string): Promise<{
    success: boolean;
    sessionId?: string;
    graph?: CodingAgentTaskGraph | null;
    becameReady?: string[];
    error?: string;
  }>;
  getTaskGraph(payload: { sessionId: string } | string): Promise<{
    success: boolean;
    sessionId?: string;
    graph?: CodingAgentTaskGraph | null;
    error?: string;
  }>;
  getStatus(): Promise<{
    success: boolean;
    server?: { connected?: boolean; host?: string; port?: number | null };
    sessionCount?: number;
    tools?: CodingAgentToolDescriptor[];
    toolSummary?: CodingAgentToolSummary | null;
    permissionPolicy?: CodingAgentPermissionPolicy | null;
  }>;
  // Canonical workflow commands ($deep-interview / $ralplan / $ralph / $team)
  checkWorkflowCommand(text: string): Promise<{
    matched: boolean;
    error?: string;
  }>;
  runWorkflowCommand(payload: {
    text: string;
    sessionId?: string;
    projectRoot?: string;
  }): Promise<{
    success: boolean;
    matched: boolean;
    skill?: "deep-interview" | "ralplan" | "ralph" | "team";
    result?: Record<string, unknown>;
    message?: string;
    guidance?: string;
    error?: string;
  }>;
  onEvent(callback: (event: CodingAgentEvent) => void): () => void;
  subscribeEvents(callback: (event: CodingAgentEvent) => void): () => void;
}

/**
 * Sub-agent snapshot returned by listSubAgents / getSubAgent. Mirrors the
 * SubAgentContext.toJSON() shape produced by the CLI runtime. `status` is
 * "active" for running children and "completed" for finished entries pulled
 * from the ring-buffer history.
 */
export interface CodingAgentSubAgentSnapshot {
  id: string;
  parentId?: string | null;
  role: string;
  task: string;
  status: "active" | "completed" | "failed";
  messageCount?: number;
  toolsUsed?: string[];
  tokenCount?: number;
  iterationCount?: number;
  createdAt?: string;
  completedAt?: string | null;
  summary?: string;
  durationMs?: number;
  worktree?: { path: string; branch: string } | null;
}

/**
 * Review mode snapshot produced by the CLI runtime. Mirrors the
 * `session.reviewState` shape returned by `ws-session-manager.js` — a session
 * is considered blocked for new sendMessage calls while `status === "pending"`
 * and `blocking === true`.
 */
export interface CodingAgentReviewComment {
  id: string;
  author: string;
  content: string;
  timestamp: string;
}

export interface CodingAgentReviewChecklistItem {
  id: string;
  title: string;
  note?: string | null;
  done: boolean;
}

export interface CodingAgentReviewState {
  reviewId: string;
  status: "pending" | "approved" | "rejected";
  reason: string | null;
  requestedBy: string;
  requestedAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  decision: "approved" | "rejected" | null;
  blocking: boolean;
  comments: CodingAgentReviewComment[];
  checklist: CodingAgentReviewChecklistItem[];
  summary?: string;
}

/**
 * Patch preview snapshot produced by the CLI runtime. Each patch batches
 * one or more file edits that the agent proposed via a tool call but should
 * be previewed before they land on disk. The renderer surfaces these as a
 * "diff summary" strip with per-file stats.
 */
export interface CodingAgentPatchFileInput {
  path: string;
  op?: "create" | "modify" | "delete";
  before?: string | null;
  after?: string | null;
  diff?: string | null;
  stats?: { added?: number; removed?: number };
}

export interface CodingAgentPatchFile {
  index: number;
  path: string;
  op: "create" | "modify" | "delete";
  before: string | null;
  after: string | null;
  diff: string | null;
  stats: { added: number; removed: number };
}

export interface CodingAgentPatch {
  patchId: string;
  status: "pending" | "applied" | "rejected";
  origin: string;
  reason: string | null;
  requestId: string | null;
  proposedAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  files: CodingAgentPatchFile[];
  stats: { fileCount: number; added: number; removed: number };
  note?: string;
  rejectionReason?: string;
}

export interface CodingAgentPatchSummary {
  pending: CodingAgentPatch[];
  history: CodingAgentPatch[];
  totals: { fileCount: number; added: number; removed: number };
}

/**
 * Persistent task graph snapshot produced by the CLI runtime. Each session can
 * own a single DAG of task nodes — the orchestrator promotes pending nodes whose
 * dependencies have all completed/skipped to "ready", and auto-completes the
 * graph when every node reaches a terminal status.
 */
export interface CodingAgentTaskNodeInput {
  id: string;
  title?: string;
  description?: string | null;
  status?: "pending" | "ready" | "running" | "completed" | "failed" | "skipped";
  dependsOn?: string[];
  metadata?: Record<string, any>;
}

export interface CodingAgentTaskNode {
  id: string;
  title: string;
  description: string | null;
  status: "pending" | "ready" | "running" | "completed" | "failed" | "skipped";
  dependsOn: string[];
  metadata: Record<string, any>;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  result: any;
  error: any;
}

export interface CodingAgentTaskGraph {
  graphId: string;
  title: string | null;
  description: string | null;
  status: "active" | "completed" | "failed";
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  order: string[];
  nodes: Record<string, CodingAgentTaskNode>;
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
  conversation: ConversationAPI;
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
  codingAgent: CodingAgentAPI;
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
