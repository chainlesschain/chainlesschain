/**
 * AI Engine Type Definitions
 *
 * @module ai-engine
 * @description AI 引擎类型定义 - Plan Mode、Skills 系统、Cowork 多智能体
 */

import { EventEmitter } from 'events';

// ==================== Plan Mode 相关 ====================

/**
 * 计划模式状态
 */
export type PlanModeState = 'inactive' | 'planning' | 'awaiting_approval' | 'executing';

/**
 * 计划操作
 */
export interface PlanOperation {
  /** 操作类型 */
  type: 'file_read' | 'file_write' | 'file_delete' | 'tool_use' | 'network_request' | 'custom';
  /** 操作描述 */
  description: string;
  /** 操作参数 */
  params?: Record<string, any>;
  /** 风险级别 */
  risk?: 'low' | 'medium' | 'high';
  /** 是否需要审批 */
  requiresApproval?: boolean;
}

/**
 * 计划定义
 */
export interface Plan {
  /** 计划 ID */
  id: string;
  /** 计划标题 */
  title: string;
  /** 计划描述 */
  description: string;
  /** 计划步骤 */
  steps: PlanOperation[];
  /** 预估耗时（秒） */
  estimatedDuration?: number;
  /** 风险评估 */
  riskAssessment?: string;
  /** 创建时间 */
  created_at: string;
  /** 状态 */
  status: 'pending' | 'approved' | 'rejected' | 'executing' | 'completed' | 'failed';
}

/**
 * 计划审批选项
 */
export interface PlanApprovalOptions {
  /** 批准的步骤 ID（部分批准） */
  approvedSteps?: string[];
  /** 拒绝的步骤 ID */
  rejectedSteps?: string[];
  /** 审批备注 */
  notes?: string;
}

/**
 * Plan Mode 配置
 */
export interface PlanModeOptions {
  /** 是否启用安全模式（默认 true） */
  safeMode?: boolean;
  /** 允许的工具列表（安全模式下） */
  allowedTools?: string[];
  /** 自动批准的操作类型 */
  autoApprove?: string[];
  /** 风险阈值 */
  riskThreshold?: 'low' | 'medium' | 'high';
}

// ==================== Skills 系统相关 ====================

/**
 * 技能类型
 */
export type SkillType = 'bundled' | 'managed' | 'workspace';

/**
 * 技能门控条件
 */
export interface SkillGateCondition {
  /** 条件类型 */
  type: 'platform' | 'binary' | 'env' | 'permission' | 'custom';
  /** 条件值 */
  value: string;
  /** 是否必需 */
  required?: boolean;
  /** 错误消息 */
  errorMessage?: string;
}

/**
 * 技能参数
 */
export interface SkillParameter {
  /** 参数名 */
  name: string;
  /** 参数类型 */
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  /** 参数描述 */
  description?: string;
  /** 是否必需 */
  required?: boolean;
  /** 默认值 */
  default?: any;
  /** 示例值 */
  example?: any;
}

/**
 * 技能定义
 */
export interface SkillDefinition {
  /** 技能 ID */
  id: string;
  /** 技能名称 */
  name: string;
  /** 技能描述 */
  description: string;
  /** 技能版本 */
  version?: string;
  /** 技能类型 */
  type: SkillType;
  /** 门控条件 */
  gates?: SkillGateCondition[];
  /** 参数定义 */
  parameters?: SkillParameter[];
  /** Prompt 模板 */
  promptTemplate: string;
  /** 示例用法 */
  examples?: string[];
  /** 元数据 */
  metadata?: Record<string, any>;
}

/**
 * 技能执行选项
 */
export interface SkillExecuteOptions {
  /** 参数 */
  params?: Record<string, any>;
  /** 是否跳过门控检查（默认 false） */
  skipGates?: boolean;
  /** 超时时间（毫秒） */
  timeout?: number;
}

/**
 * 技能执行结果
 */
export interface SkillExecuteResult {
  /** 是否成功 */
  success: boolean;
  /** 结果数据 */
  data?: any;
  /** 生成的 Prompt */
  prompt?: string;
  /** 错误信息 */
  error?: string;
  /** 执行时间（毫秒） */
  duration: number;
}

// ==================== Cowork 多智能体相关 ====================

/**
 * 智能体角色
 */
export type AgentRole = 'orchestrator' | 'researcher' | 'coder' | 'reviewer' | 'tester' | 'custom';

/**
 * 智能体状态
 */
export type AgentState = 'idle' | 'active' | 'busy' | 'paused' | 'stopped';

/**
 * 智能体定义
 */
export interface Agent {
  /** 智能体 ID */
  id: string;
  /** 智能体名称 */
  name: string;
  /** 智能体角色 */
  role: AgentRole;
  /** 系统提示 */
  systemPrompt: string;
  /** 可用工具 */
  tools?: string[];
  /** 可用技能 */
  skills?: string[];
  /** 当前状态 */
  state: AgentState;
  /** 元数据 */
  metadata?: Record<string, any>;
}

/**
 * 智能体通信消息
 */
export interface AgentMessage {
  /** 消息 ID */
  id: string;
  /** 发送者 ID */
  from: string;
  /** 接收者 ID */
  to: string;
  /** 消息类型 */
  type: 'request' | 'response' | 'notification' | 'error';
  /** 消息内容 */
  content: any;
  /** 时间戳 */
  timestamp: number;
}

/**
 * 任务定义
 */
export interface Task {
  /** 任务 ID */
  id: string;
  /** 任务标题 */
  title: string;
  /** 任务描述 */
  description: string;
  /** 分配的智能体 ID */
  assignedTo?: string;
  /** 任务状态 */
  status: 'pending' | 'in_progress' | 'blocked' | 'completed' | 'failed';
  /** 优先级 */
  priority?: 'low' | 'medium' | 'high';
  /** 依赖任务 */
  dependencies?: string[];
  /** 创建时间 */
  created_at: string;
  /** 完成时间 */
  completed_at?: string;
  /** 结果 */
  result?: any;
}

/**
 * Cowork 配置
 */
export interface CoworkOptions {
  /** 最大并发智能体数 */
  maxConcurrentAgents?: number;
  /** 是否启用长时间运行任务管理 */
  enableLongRunning?: boolean;
  /** 检查点间隔（毫秒） */
  checkpointInterval?: number;
  /** 文件沙箱配置 */
  fileSandbox?: {
    enabled?: boolean;
    rootPath?: string;
    maxFileSize?: number;
  };
}

// ==================== PlanModeManager 类 ====================

/**
 * 计划模式管理器类
 */
export declare class PlanModeManager extends EventEmitter {
  /** 配置选项 */
  options: PlanModeOptions;
  /** 当前状态 */
  state: PlanModeState;
  /** 当前计划 */
  currentPlan: Plan | null;

  /**
   * 构造函数
   */
  constructor(options?: PlanModeOptions);

  /**
   * 进入计划模式
   */
  enterPlanMode(): void;

  /**
   * 退出计划模式
   */
  exitPlanMode(): void;

  /**
   * 创建计划
   */
  createPlan(title: string, description: string, steps: PlanOperation[]): Plan;

  /**
   * 提交计划审批
   */
  submitForApproval(plan: Plan): Promise<void>;

  /**
   * 批准计划
   */
  approvePlan(planId: string, options?: PlanApprovalOptions): Promise<void>;

  /**
   * 拒绝计划
   */
  rejectPlan(planId: string, reason: string): Promise<void>;

  /**
   * 执行计划
   */
  executePlan(planId: string): Promise<any>;

  /**
   * 获取当前计划
   */
  getCurrentPlan(): Plan | null;

  /**
   * 检查操作是否允许
   */
  isOperationAllowed(operation: PlanOperation): boolean;

  // ==================== 事件 ====================

  on(event: 'mode-entered', listener: () => void): this;
  on(event: 'mode-exited', listener: () => void): this;
  on(event: 'plan-created', listener: (plan: Plan) => void): this;
  on(event: 'plan-approved', listener: (planId: string) => void): this;
  on(event: 'plan-rejected', listener: (planId: string, reason: string) => void): this;
  on(event: 'plan-executing', listener: (planId: string) => void): this;
  on(event: 'plan-completed', listener: (planId: string, result: any) => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
}

// ==================== SkillManager 类 ====================

/**
 * 技能管理器类
 */
export declare class SkillManager extends EventEmitter {
  /** 已加载的技能 */
  skills: Map<string, SkillDefinition>;

  /**
   * 构造函数
   */
  constructor();

  /**
   * 初始化技能管理器
   */
  initialize(): Promise<void>;

  /**
   * 加载技能
   */
  loadSkill(skillPath: string): Promise<SkillDefinition>;

  /**
   * 卸载技能
   */
  unloadSkill(skillId: string): void;

  /**
   * 列出所有技能
   */
  listSkills(type?: SkillType): SkillDefinition[];

  /**
   * 获取技能
   */
  getSkill(skillId: string): SkillDefinition | null;

  /**
   * 执行技能
   */
  executeSkill(skillId: string, options?: SkillExecuteOptions): Promise<SkillExecuteResult>;

  /**
   * 检查技能门控
   */
  checkGates(skill: SkillDefinition): Promise<{ passed: boolean; failed?: SkillGateCondition[] }>;

  /**
   * 解析技能参数
   */
  parseSkillArgs(skill: SkillDefinition, args: string): Record<string, any>;

  /**
   * 渲染 Prompt 模板
   */
  renderPrompt(template: string, params: Record<string, any>): string;

  // ==================== 事件 ====================

  on(event: 'skill-loaded', listener: (skill: SkillDefinition) => void): this;
  on(event: 'skill-unloaded', listener: (skillId: string) => void): this;
  on(event: 'skill-executed', listener: (result: SkillExecuteResult) => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
}

// ==================== CoworkOrchestrator 类 ====================

/**
 * Cowork 编排器类
 */
export declare class CoworkOrchestrator extends EventEmitter {
  /** 配置选项 */
  options: CoworkOptions;
  /** 智能体池 */
  agents: Map<string, Agent>;
  /** 任务队列 */
  tasks: Map<string, Task>;
  /** 消息队列 */
  messageQueue: AgentMessage[];

  /**
   * 构造函数
   */
  constructor(options?: CoworkOptions);

  /**
   * 初始化编排器
   */
  initialize(): Promise<void>;

  /**
   * 创建智能体
   */
  createAgent(config: Partial<Agent>): Agent;

  /**
   * 删除智能体
   */
  removeAgent(agentId: string): void;

  /**
   * 创建任务
   */
  createTask(config: Partial<Task>): Task;

  /**
   * 分配任务
   */
  assignTask(taskId: string, agentId: string): Promise<void>;

  /**
   * 发送消息
   */
  sendMessage(message: AgentMessage): Promise<void>;

  /**
   * 广播消息
   */
  broadcast(message: Omit<AgentMessage, 'to'>): void;

  /**
   * 执行任务
   */
  executeTask(taskId: string): Promise<any>;

  /**
   * 获取任务状态
   */
  getTaskStatus(taskId: string): Task | null;

  /**
   * 列出所有智能体
   */
  listAgents(): Agent[];

  /**
   * 列出所有任务
   */
  listTasks(status?: Task['status']): Task[];

  /**
   * 关闭编排器
   */
  close(): Promise<void>;

  // ==================== 事件 ====================

  on(event: 'agent-created', listener: (agent: Agent) => void): this;
  on(event: 'agent-removed', listener: (agentId: string) => void): this;
  on(event: 'task-created', listener: (task: Task) => void): this;
  on(event: 'task-assigned', listener: (taskId: string, agentId: string) => void): this;
  on(event: 'task-completed', listener: (taskId: string, result: any) => void): this;
  on(event: 'message-sent', listener: (message: AgentMessage) => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
}

// ==================== 导出函数 ====================

/**
 * 获取计划模式管理器实例（单例模式）
 */
export function getPlanModeManager(options?: PlanModeOptions): PlanModeManager;

/**
 * 创建新的计划模式管理器实例
 */
export function createPlanModeManager(options?: PlanModeOptions): PlanModeManager;

/**
 * 获取技能管理器实例（单例模式）
 */
export function getSkillManager(): SkillManager;

/**
 * 创建新的技能管理器实例
 */
export function createSkillManager(): SkillManager;

/**
 * 获取 Cowork 编排器实例（单例模式）
 */
export function getCoworkOrchestrator(options?: CoworkOptions): CoworkOrchestrator;

/**
 * 创建新的 Cowork 编排器实例
 */
export function createCoworkOrchestrator(options?: CoworkOptions): CoworkOrchestrator;
