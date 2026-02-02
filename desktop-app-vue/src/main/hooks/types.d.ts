/**
 * Hooks System Type Definitions
 *
 * @module hooks/types
 */

import { EventEmitter } from 'events';

// ==================== 常量类型 ====================

export const HookPriority: {
  SYSTEM: 0;
  HIGH: 100;
  NORMAL: 500;
  LOW: 900;
  MONITOR: 1000;
};

export const HookType: {
  SYNC: 'sync';
  ASYNC: 'async';
  COMMAND: 'command';
  SCRIPT: 'script';
};

export const HookResult: {
  CONTINUE: 'continue';
  PREVENT: 'prevent';
  MODIFY: 'modify';
  ERROR: 'error';
};

export type HookPriorityType = (typeof HookPriority)[keyof typeof HookPriority];
export type HookTypeType = (typeof HookType)[keyof typeof HookType];
export type HookResultType = (typeof HookResult)[keyof typeof HookResult];

// ==================== 事件类型 ====================

export type HookEventName =
  | 'PreIPCCall'
  | 'PostIPCCall'
  | 'IPCError'
  | 'PreToolUse'
  | 'PostToolUse'
  | 'ToolError'
  | 'SessionStart'
  | 'SessionEnd'
  | 'PreCompact'
  | 'PostCompact'
  | 'UserPromptSubmit'
  | 'AssistantResponse'
  | 'AgentStart'
  | 'AgentStop'
  | 'TaskAssigned'
  | 'TaskCompleted'
  | 'PreFileAccess'
  | 'PostFileAccess'
  | 'FileModified'
  | 'MemorySave'
  | 'MemoryLoad';

// ==================== 配置类型 ====================

export interface HookConfig {
  /** 钩子唯一标识 */
  id?: string;
  /** 事件名称 */
  event: HookEventName;
  /** 钩子名称 */
  name?: string;
  /** 钩子类型 */
  type?: HookTypeType;
  /** 优先级 */
  priority?: HookPriorityType | number;
  /** 处理函数 (sync/async 类型) */
  handler?: HookHandler;
  /** Shell 命令 (command 类型) */
  command?: string;
  /** 脚本路径 (script 类型) */
  script?: string;
  /** 匹配器 */
  matcher?: RegExp | MatcherFunction | string;
  /** 超时时间 (ms) */
  timeout?: number;
  /** 是否启用 */
  enabled?: boolean;
  /** 描述 */
  description?: string;
  /** 元数据 */
  metadata?: Record<string, any>;
}

export interface HookHandlerParams {
  event: {
    name: HookEventName;
    id: string;
    timestamp: number;
  };
  data: Record<string, any>;
  context: Record<string, any>;
  signal: AbortSignal;
}

export type HookHandler = (params: HookHandlerParams) => HookHandlerResult | Promise<HookHandlerResult>;

export type MatcherFunction = (context: Record<string, any>) => boolean;

export interface HookHandlerResult {
  result?: HookResultType;
  prevent?: boolean;
  blocked?: boolean;
  reason?: string;
  message?: string;
  modify?: Record<string, any>;
  data?: Record<string, any>;
}

// ==================== 钩子信息类型 ====================

export interface HookInfo {
  id: string;
  name: string;
  event: HookEventName;
  type: HookTypeType;
  priority: number;
  enabled: boolean;
  description: string;
  matcher: string | null;
  timeout: number;
  command?: string;
  script?: string;
  metadata: Record<string, any>;
  executionCount: number;
  errorCount: number;
  avgExecutionTime: number;
  lastExecutedAt: number | null;
  registeredAt: number;
}

// ==================== 执行结果类型 ====================

export interface TriggerResult {
  result: HookResultType;
  prevented: boolean;
  preventReason: string | null;
  data: Record<string, any>;
  modifications: Record<string, any>;
  hookResults: HookExecutionResult[];
  totalHooks: number;
  executedHooks: number;
  totalTime: number;
}

export interface HookExecutionResult {
  hookId: string;
  hookName: string;
  result: HookResultType;
  reason?: string;
  error?: string;
  data?: Record<string, any>;
  executionTime: number;
}

// ==================== 统计类型 ====================

export interface HookStats {
  totalRegistered: number;
  totalExecutions: number;
  totalErrors: number;
  executionsByEvent: Record<HookEventName, number>;
  hookCount: number;
  enabledCount: number;
  eventTypes: HookEventName[];
}

// ==================== 配置选项类型 ====================

export interface HookSystemOptions {
  /** 额外的配置文件路径 */
  configPaths?: string[];
  /** 是否自动加载配置 */
  autoLoadConfig?: boolean;
  /** 默认超时时间 */
  defaultTimeout?: number;
  /** 钩子出错是否继续 */
  continueOnError?: boolean;
  /** 最大并发数 */
  maxConcurrent?: number;
}

// ==================== 类定义 ====================

export declare class HookRegistry extends EventEmitter {
  hooks: Map<HookEventName, any[]>;
  hookById: Map<string, any>;
  enabled: boolean;
  stats: HookStats;

  constructor(options?: HookSystemOptions);

  register(hookConfig: HookConfig): string;
  registerMultiple(hookConfigs: HookConfig[]): string[];
  unregister(hookId: string): boolean;
  getHooks(
    eventName: HookEventName,
    options?: { enabledOnly?: boolean; matchContext?: Record<string, any> }
  ): any[];
  setEnabled(hookId: string, enabled: boolean): boolean;
  getHook(hookId: string): HookInfo | null;
  listHooks(options?: { event?: HookEventName; enabledOnly?: boolean }): HookInfo[];
  updateStats(hookId: string, stats: { executionTime: number; success: boolean }): void;
  getStats(): HookStats;
  loadFromConfig(configPath: string): Promise<boolean>;
  clear(): void;
}

export declare class HookExecutor extends EventEmitter {
  registry: HookRegistry;
  runningHooks: Map<string, AbortController>;

  constructor(registry: HookRegistry, options?: HookSystemOptions);

  trigger(
    eventName: HookEventName,
    eventData?: Record<string, any>,
    context?: Record<string, any>
  ): Promise<TriggerResult>;
  cancelHook(hookId: string): boolean;
  cancelAll(): void;
  getRunningCount(): number;
}

export declare class HookSystem extends EventEmitter {
  registry: HookRegistry;
  executor: HookExecutor;
  ipcMiddleware: IPCHookMiddleware;
  toolMiddleware: ToolHookMiddleware;
  sessionMiddleware: SessionHookMiddleware;
  fileMiddleware: FileHookMiddleware;
  agentMiddleware: AgentHookMiddleware;
  initialized: boolean;

  constructor(options?: HookSystemOptions);

  initialize(): Promise<HookSystem>;
  loadDefaultConfigs(): Promise<void>;

  register(hookConfig: HookConfig): string;
  registerMultiple(hookConfigs: HookConfig[]): string[];
  unregister(hookId: string): boolean;
  trigger(
    eventName: HookEventName,
    data?: Record<string, any>,
    context?: Record<string, any>
  ): Promise<TriggerResult>;
  listHooks(options?: { event?: HookEventName; enabledOnly?: boolean }): HookInfo[];
  getHook(hookId: string): HookInfo | null;
  getStats(): HookStats;
  setEnabled(enabled: boolean): void;
  isEnabled(): boolean;
  setHookEnabled(hookId: string, enabled: boolean): boolean;
  cancelHook(hookId: string): boolean;
  cancelAll(): void;
  clear(): void;
  reload(): Promise<void>;
  getEventTypes(): HookEventName[];
}

// ==================== 中间件类型 ====================

export interface IPCHookMiddleware {
  wrap(
    channel: string,
    handler: Function,
    options?: { skipPreHook?: boolean; skipPostHook?: boolean; contextExtractor?: Function }
  ): Function;
  wrapAll(handlers: Record<string, Function>, options?: Record<string, any>): Record<string, Function>;
  createWrappedHandle(ipcMain: any): Function;
}

export interface ToolHookMiddleware {
  wrap(
    toolName: string,
    handler: Function,
    options?: { skipPreHook?: boolean; skipPostHook?: boolean }
  ): Function;
  wrapAll(tools: Map<string, any> | Record<string, Function>, options?: Record<string, any>): any;
}

export interface SessionHookMiddleware {
  bindToSessionManager(sessionManager: any): void;
}

export interface FileHookMiddleware {
  wrapRead(readFn: Function): Function;
  wrapWrite(writeFn: Function): Function;
}

export interface AgentHookMiddleware {
  bindToOrchestrator(orchestrator: any): void;
}

// ==================== 导出函数 ====================

export function getHookSystem(options?: HookSystemOptions): HookSystem;
export function initializeHookSystem(options?: HookSystemOptions): Promise<HookSystem>;
export function destroyHookSystem(): void;

export function createIPCHookMiddleware(hookSystem: HookSystem): IPCHookMiddleware;
export function createToolHookMiddleware(hookSystem: HookSystem): ToolHookMiddleware;
export function createSessionHookMiddleware(hookSystem: HookSystem): SessionHookMiddleware;
export function createFileHookMiddleware(hookSystem: HookSystem): FileHookMiddleware;
export function createAgentHookMiddleware(hookSystem: HookSystem): AgentHookMiddleware;

// ==================== IPC 相关 ====================

export function registerHooksIPC(dependencies?: { hookSystem?: HookSystem }): void;
