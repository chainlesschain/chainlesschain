/**
 * Permission System Type Definitions
 *
 * @module permission
 * @description 企业级 RBAC 权限系统类型定义
 */

import { EventEmitter } from 'events';
import { DatabaseManager } from './database';

// ==================== 权限相关 ====================

/**
 * 权限类型
 */
export type PermissionType = 'read' | 'write' | 'delete' | 'admin' | 'custom';

/**
 * 资源类型
 */
export type ResourceType = 'knowledge' | 'project' | 'session' | 'team' | 'file' | 'custom';

/**
 * 授权者类型
 */
export type GranteeType = 'user' | 'team' | 'role';

/**
 * 权限记录
 */
export interface PermissionRecord {
  id?: number;
  org_id: number;
  grantee_type: GranteeType;
  grantee_id: string;
  resource_type: ResourceType;
  resource_id: string;
  permission: PermissionType | string;
  granted_at?: string;
  granted_by?: string;
  expires_at?: string;
  metadata?: Record<string, any>;
}

/**
 * 权限检查结果
 */
export interface PermissionCheckResult {
  granted: boolean;
  reason?: string;
  source?: 'direct' | 'inherited' | 'delegated' | 'team';
  expiresAt?: string;
}

// ==================== 权限引擎配置 ====================

/**
 * 权限引擎配置
 */
export interface PermissionEngineOptions {
  /** 数据库实例 */
  database: DatabaseManager;
  /** 是否启用继承（默认 true） */
  enableInheritance?: boolean;
  /** 是否启用委托（默认 true） */
  enableDelegation?: boolean;
  /** 是否启用缓存（默认 true） */
  enableCache?: boolean;
  /** 缓存 TTL（毫秒，默认 5 分钟） */
  cacheTTL?: number;
}

/**
 * 授予权限选项
 */
export interface GrantPermissionOptions {
  /** 授予者 ID */
  grantedBy?: string;
  /** 过期时间（毫秒或日期字符串） */
  expiresAt?: number | string;
  /** 元数据 */
  metadata?: Record<string, any>;
  /** 是否允许继承（默认 true） */
  inheritable?: boolean;
}

/**
 * 权限查询选项
 */
export interface QueryPermissionsOptions {
  /** 是否包含继承的权限（默认 true） */
  includeInherited?: boolean;
  /** 是否包含委托的权限（默认 true） */
  includeDelegated?: boolean;
  /** 是否包含过期的权限（默认 false） */
  includeExpired?: boolean;
}

// ==================== 团队管理相关 ====================

/**
 * 团队信息
 */
export interface Team {
  id?: number;
  org_id: number;
  name: string;
  description?: string;
  parent_team_id?: number;
  lead_did?: string;
  created_at?: string;
  updated_at?: string;
  metadata?: Record<string, any>;
}

/**
 * 团队成员
 */
export interface TeamMember {
  id?: number;
  team_id: number;
  member_did: string;
  role?: 'lead' | 'member';
  joined_at?: string;
}

/**
 * 创建团队选项
 */
export interface CreateTeamOptions {
  /** 组织 ID */
  org_id: number;
  /** 团队名称 */
  name: string;
  /** 描述 */
  description?: string;
  /** 父团队 ID */
  parent_team_id?: number;
  /** 团队负责人 DID */
  lead_did?: string;
  /** 元数据 */
  metadata?: Record<string, any>;
}

/**
 * 更新团队选项
 */
export interface UpdateTeamOptions {
  /** 新名称 */
  name?: string;
  /** 新描述 */
  description?: string;
  /** 新负责人 */
  lead_did?: string;
  /** 新父团队 */
  parent_team_id?: number;
  /** 元数据 */
  metadata?: Record<string, any>;
}

// ==================== 权限委托相关 ====================

/**
 * 权限委托记录
 */
export interface DelegationRecord {
  id?: number;
  delegator_id: string;
  delegate_id: string;
  resource_type: ResourceType;
  resource_id: string;
  permission: PermissionType | string;
  granted_at?: string;
  expires_at?: string;
  revocable?: boolean;
  metadata?: Record<string, any>;
}

/**
 * 委托权限选项
 */
export interface DelegatePermissionOptions {
  /** 过期时间 */
  expiresAt?: number | string;
  /** 是否可撤销（默认 true） */
  revocable?: boolean;
  /** 元数据 */
  metadata?: Record<string, any>;
}

// ==================== 审批工作流相关 ====================

/**
 * 审批请求
 */
export interface ApprovalRequest {
  id?: number;
  requester_id: string;
  resource_type: ResourceType;
  resource_id: string;
  permission: PermissionType | string;
  reason?: string;
  status: 'pending' | 'approved' | 'rejected';
  created_at?: string;
  reviewed_at?: string;
  reviewed_by?: string;
  review_notes?: string;
}

/**
 * 创建审批请求选项
 */
export interface CreateApprovalRequestOptions {
  requester_id: string;
  resource_type: ResourceType;
  resource_id: string;
  permission: PermissionType | string;
  reason?: string;
}

/**
 * 审批选项
 */
export interface ApproveOptions {
  /** 审批者 ID */
  reviewed_by: string;
  /** 审批备注 */
  review_notes?: string;
  /** 权限过期时间 */
  expiresAt?: number | string;
}

// ==================== PermissionEngine 类 ====================

/**
 * 权限引擎类
 */
export declare class PermissionEngine extends EventEmitter {
  /** 数据库实例 */
  db: DatabaseManager;
  /** 是否启用继承 */
  enableInheritance: boolean;
  /** 是否启用委托 */
  enableDelegation: boolean;
  /** 是否启用缓存 */
  enableCache: boolean;
  /** 缓存 TTL */
  cacheTTL: number;
  /** 权限缓存 */
  permissionCache: Map<string, PermissionCheckResult>;

  /**
   * 构造函数
   */
  constructor(options: PermissionEngineOptions);

  /**
   * 初始化权限引擎
   */
  initialize(): Promise<void>;

  /**
   * 检查权限
   */
  checkPermission(
    granteeType: GranteeType,
    granteeId: string,
    resourceType: ResourceType,
    resourceId: string,
    permission: PermissionType | string,
    options?: QueryPermissionsOptions
  ): Promise<PermissionCheckResult>;

  /**
   * 授予权限
   */
  grantPermission(
    granteeType: GranteeType,
    granteeId: string,
    resourceType: ResourceType,
    resourceId: string,
    permission: PermissionType | string,
    options?: GrantPermissionOptions
  ): Promise<void>;

  /**
   * 撤销权限
   */
  revokePermission(
    granteeType: GranteeType,
    granteeId: string,
    resourceType: ResourceType,
    resourceId: string,
    permission: PermissionType | string
  ): Promise<void>;

  /**
   * 列出权限
   */
  listPermissions(
    granteeType: GranteeType,
    granteeId: string,
    options?: QueryPermissionsOptions
  ): Promise<PermissionRecord[]>;

  /**
   * 清除缓存
   */
  clearCache(): void;

  /**
   * 检查继承的权限
   */
  checkInheritedPermission(
    resourceType: ResourceType,
    resourceId: string,
    granteeType: GranteeType,
    granteeId: string,
    permission: PermissionType | string
  ): Promise<PermissionCheckResult>;

  /**
   * 获取资源的所有权限
   */
  getResourcePermissions(
    resourceType: ResourceType,
    resourceId: string
  ): Promise<PermissionRecord[]>;

  // ==================== 事件 ====================

  on(event: 'permission-granted', listener: (record: PermissionRecord) => void): this;
  on(event: 'permission-revoked', listener: (record: PermissionRecord) => void): this;
  on(event: 'permission-checked', listener: (result: PermissionCheckResult) => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
}

// ==================== TeamManager 类 ====================

/**
 * 团队管理器类
 */
export declare class TeamManager extends EventEmitter {
  /** 数据库实例 */
  db: DatabaseManager;
  /** 权限引擎 */
  permissionEngine: PermissionEngine;

  /**
   * 构造函数
   */
  constructor(database: DatabaseManager, permissionEngine: PermissionEngine);

  /**
   * 创建团队
   */
  createTeam(options: CreateTeamOptions): Promise<Team>;

  /**
   * 获取团队
   */
  getTeam(teamId: number): Promise<Team | null>;

  /**
   * 更新团队
   */
  updateTeam(teamId: number, options: UpdateTeamOptions): Promise<void>;

  /**
   * 删除团队
   */
  deleteTeam(teamId: number): Promise<void>;

  /**
   * 列出团队
   */
  listTeams(orgId: number): Promise<Team[]>;

  /**
   * 添加成员
   */
  addMember(teamId: number, memberDid: string, role?: 'lead' | 'member'): Promise<void>;

  /**
   * 移除成员
   */
  removeMember(teamId: number, memberDid: string): Promise<void>;

  /**
   * 列出成员
   */
  listMembers(teamId: number): Promise<TeamMember[]>;

  /**
   * 获取用户的团队
   */
  getUserTeams(userDid: string, orgId: number): Promise<Team[]>;

  /**
   * 获取子团队
   */
  getChildTeams(teamId: number): Promise<Team[]>;

  // ==================== 事件 ====================

  on(event: 'team-created', listener: (team: Team) => void): this;
  on(event: 'team-updated', listener: (teamId: number) => void): this;
  on(event: 'team-deleted', listener: (teamId: number) => void): this;
  on(event: 'member-added', listener: (teamId: number, memberDid: string) => void): this;
  on(event: 'member-removed', listener: (teamId: number, memberDid: string) => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
}

// ==================== DelegationManager 类 ====================

/**
 * 权限委托管理器类
 */
export declare class DelegationManager extends EventEmitter {
  /** 数据库实例 */
  db: DatabaseManager;

  /**
   * 构造函数
   */
  constructor(database: DatabaseManager);

  /**
   * 委托权限
   */
  delegatePermission(
    delegatorId: string,
    delegateId: string,
    resourceType: ResourceType,
    resourceId: string,
    permission: PermissionType | string,
    options?: DelegatePermissionOptions
  ): Promise<void>;

  /**
   * 撤销委托
   */
  revokeDelegation(delegationId: number): Promise<void>;

  /**
   * 列出用户的委托
   */
  listDelegations(userId: string, type?: 'delegator' | 'delegate'): Promise<DelegationRecord[]>;

  /**
   * 检查委托的权限
   */
  checkDelegatedPermission(
    userId: string,
    resourceType: ResourceType,
    resourceId: string,
    permission: PermissionType | string
  ): Promise<PermissionCheckResult>;

  // ==================== 事件 ====================

  on(event: 'permission-delegated', listener: (record: DelegationRecord) => void): this;
  on(event: 'delegation-revoked', listener: (delegationId: number) => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
}

// ==================== ApprovalWorkflowManager 类 ====================

/**
 * 审批工作流管理器类
 */
export declare class ApprovalWorkflowManager extends EventEmitter {
  /** 数据库实例 */
  db: DatabaseManager;
  /** 权限引擎 */
  permissionEngine: PermissionEngine;

  /**
   * 构造函数
   */
  constructor(database: DatabaseManager, permissionEngine: PermissionEngine);

  /**
   * 创建审批请求
   */
  createRequest(options: CreateApprovalRequestOptions): Promise<ApprovalRequest>;

  /**
   * 批准请求
   */
  approveRequest(requestId: number, options: ApproveOptions): Promise<void>;

  /**
   * 拒绝请求
   */
  rejectRequest(requestId: number, options: Omit<ApproveOptions, 'expiresAt'>): Promise<void>;

  /**
   * 列出待审批请求
   */
  listPendingRequests(orgId: number): Promise<ApprovalRequest[]>;

  /**
   * 获取用户的请求
   */
  getUserRequests(userId: string): Promise<ApprovalRequest[]>;

  // ==================== 事件 ====================

  on(event: 'request-created', listener: (request: ApprovalRequest) => void): this;
  on(event: 'request-approved', listener: (requestId: number) => void): this;
  on(event: 'request-rejected', listener: (requestId: number) => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
}

// ==================== 导出函数 ====================

/**
 * 获取权限引擎实例（单例模式）
 */
export function getPermissionEngine(options?: PermissionEngineOptions): PermissionEngine;

/**
 * 创建新的权限引擎实例
 */
export function createPermissionEngine(options: PermissionEngineOptions): PermissionEngine;

/**
 * 创建团队管理器
 */
export function createTeamManager(
  database: DatabaseManager,
  permissionEngine: PermissionEngine
): TeamManager;

/**
 * 创建委托管理器
 */
export function createDelegationManager(database: DatabaseManager): DelegationManager;

/**
 * 创建审批工作流管理器
 */
export function createApprovalWorkflowManager(
  database: DatabaseManager,
  permissionEngine: PermissionEngine
): ApprovalWorkflowManager;
