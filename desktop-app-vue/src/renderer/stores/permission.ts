/**
 * Permission Store - Pinia 状态管理
 * 管理组织权限和审批工作流系统的状态
 *
 * @module permission-store
 * @version 1.0.0
 */

import { defineStore } from 'pinia';

// ==================== 类型定义 ====================

/**
 * 权限信息
 */
export interface Permission {
  grantId: string;
  granteeDid: string;
  orgId: string;
  resourceType: string;
  resourceId: string;
  permissions: string[];
  grantedBy: string;
  grantedAt: number;
  expiresAt?: number;
  [key: string]: any;
}

/**
 * 授予权限数据
 */
export interface GrantPermissionData {
  granteeDid: string;
  orgId: string;
  resourceType: string;
  resourceId: string;
  permissions: string[];
  grantedBy: string;
  expiresAt?: number;
  [key: string]: any;
}

/**
 * 检查权限数据
 */
export interface CheckPermissionData {
  userDid: string;
  orgId: string;
  resourceType: string;
  resourceId: string;
  permission: string;
  [key: string]: any;
}

/**
 * 批量授予权限数据
 */
export interface BulkGrantData {
  granteeDid: string;
  resourceType: string;
  resourceId: string;
  permissions: string[];
  [key: string]: any;
}

/**
 * 工作流信息
 */
export interface Workflow {
  id: string;
  orgId: string;
  name: string;
  description?: string;
  steps: WorkflowStep[];
  status: 'active' | 'inactive' | 'archived';
  createdAt: number;
  updatedAt?: number;
  [key: string]: any;
}

/**
 * 工作流步骤
 */
export interface WorkflowStep {
  id: string;
  name: string;
  approverDid?: string;
  approverRole?: string;
  order: number;
  [key: string]: any;
}

/**
 * 工作流数据
 */
export interface WorkflowData {
  orgId: string;
  name: string;
  description?: string;
  steps: WorkflowStep[];
  [key: string]: any;
}

/**
 * 审批请求
 */
export interface ApprovalRequest {
  id: string;
  workflowId: string;
  requesterId: string;
  requesterName?: string;
  resourceType: string;
  resourceId: string;
  requestType: string;
  status: 'pending' | 'approved' | 'rejected';
  currentStep: number;
  comment?: string;
  createdAt: number;
  updatedAt?: number;
  [key: string]: any;
}

/**
 * 审批请求数据
 */
export interface SubmitApprovalData {
  workflowId: string;
  resourceType: string;
  resourceId: string;
  requestType: string;
  requesterId: string;
  comment?: string;
  [key: string]: any;
}

/**
 * 委托信息
 */
export interface Delegation {
  id: string;
  delegatorDid: string;
  delegateDid: string;
  orgId: string;
  permissions: string[];
  status: 'pending' | 'active' | 'expired' | 'revoked';
  startTime: number;
  endTime: number;
  createdAt: number;
  [key: string]: any;
}

/**
 * 委托数据
 */
export interface DelegationData {
  delegatorDid: string;
  delegateDid: string;
  orgId: string;
  permissions: string[];
  startTime: number;
  endTime: number;
  [key: string]: any;
}

/**
 * 团队信息
 */
export interface Team {
  id: string;
  orgId: string;
  name: string;
  description?: string;
  parentTeamId?: string | null;
  leadDid?: string;
  leadName?: string;
  memberCount: number;
  createdAt: number;
  updatedAt?: number;
  [key: string]: any;
}

/**
 * 团队数据
 */
export interface TeamData {
  orgId: string;
  name: string;
  description?: string;
  parentTeamId?: string | null;
  leadDid?: string;
  leadName?: string;
  [key: string]: any;
}

/**
 * 团队成员
 */
export interface TeamMember {
  id: string;
  teamId: string;
  memberDid: string;
  memberName: string;
  role: 'lead' | 'member' | 'admin';
  joinedAt: number;
  invitedBy?: string;
  [key: string]: any;
}

/**
 * 统计信息
 */
export interface PermissionStats {
  totalPermissions: number;
  activeWorkflows: number;
  pendingApprovalCount: number;
  activeDelegations: number;
  teamCount: number;
}

/**
 * 加载状态
 */
export interface LoadingState {
  permissions: boolean;
  workflows: boolean;
  approvals: boolean;
  delegations: boolean;
  teams: boolean;
}

/**
 * IPC 响应
 */
export interface IPCResponse<T = any> {
  success: boolean;
  message?: string;
  [key: string]: any;
}

/**
 * Permission Store 状态
 */
export interface PermissionState {
  myPermissions: Permission[];
  resourcePermissions: Permission[];
  effectivePermissions: string[];
  workflows: Workflow[];
  currentWorkflow: Workflow | null;
  pendingApprovals: ApprovalRequest[];
  approvalHistory: ApprovalRequest[];
  outgoingDelegations: Delegation[];
  incomingDelegations: Delegation[];
  teams: Team[];
  currentTeam: Team | null;
  teamMembers: TeamMember[];
  stats: PermissionStats;
  loading: LoadingState;
  error: string | null;
}

// ==================== Store ====================

export const usePermissionStore = defineStore('permission', {
  state: (): PermissionState => ({
    // ==========================================
    // 权限管理
    // ==========================================

    // 当前用户的权限列表
    myPermissions: [],

    // 当前资源的权限列表
    resourcePermissions: [],

    // 有效权限（合并后的）
    effectivePermissions: [],

    // ==========================================
    // 审批工作流
    // ==========================================

    // 工作流列表
    workflows: [],

    // 当前选中的工作流
    currentWorkflow: null,

    // 待审批请求
    pendingApprovals: [],

    // 审批历史
    approvalHistory: [],

    // ==========================================
    // 委托管理
    // ==========================================

    // 我发出的委托
    outgoingDelegations: [],

    // 我收到的委托
    incomingDelegations: [],

    // ==========================================
    // 团队管理
    // ==========================================

    // 组织的团队列表
    teams: [],

    // 当前选中的团队
    currentTeam: null,

    // 团队成员
    teamMembers: [],

    // ==========================================
    // 统计信息
    // ==========================================

    stats: {
      totalPermissions: 0,
      activeWorkflows: 0,
      pendingApprovalCount: 0,
      activeDelegations: 0,
      teamCount: 0,
    },

    // ==========================================
    // 加载状态
    // ==========================================

    loading: {
      permissions: false,
      workflows: false,
      approvals: false,
      delegations: false,
      teams: false,
    },

    // ==========================================
    // 错误状态
    // ==========================================

    error: null,
  }),

  getters: {
    /**
     * 是否有待审批请求
     */
    hasPendingApprovals(): boolean {
      return this.pendingApprovals.length > 0;
    },

    /**
     * 待审批请求数量
     */
    pendingApprovalCount(): number {
      return this.pendingApprovals.length;
    },

    /**
     * 活跃的委托数量
     */
    activeDelegationCount(): number {
      return this.outgoingDelegations.filter((d) => d.status === 'active').length;
    },

    /**
     * 根团队列表
     */
    rootTeams(): Team[] {
      return this.teams.filter((t) => !t.parentTeamId);
    },

    /**
     * 是否正在加载
     */
    isLoading(): boolean {
      return Object.values(this.loading).some((loading) => loading);
    },
  },

  actions: {
    // ==========================================
    // 权限操作
    // ==========================================

    /**
     * 授予权限
     */
    async grantPermission(permissionData: GrantPermissionData): Promise<IPCResponse> {
      this.loading.permissions = true;
      this.error = null;

      try {
        const result = await (window as any).electronAPI.invoke(
          'perm:grant-permission',
          permissionData
        );

        if (result.success) {
          // 刷新权限列表
          await this.loadUserPermissions(permissionData.granteeDid, permissionData.orgId);
        }

        return result;
      } catch (error) {
        console.error('[PermissionStore] 授予权限失败:', error);
        this.error = (error as Error).message;
        throw error;
      } finally {
        this.loading.permissions = false;
      }
    },

    /**
     * 撤销权限
     */
    async revokePermission(grantId: string, revokedBy: string): Promise<IPCResponse> {
      try {
        const result = await (window as any).electronAPI.invoke('perm:revoke-permission', {
          grantId,
          revokedBy,
        });

        if (result.success) {
          // 从本地列表移除
          this.myPermissions = this.myPermissions.filter((p) => p.grantId !== grantId);
          this.resourcePermissions = this.resourcePermissions.filter((p) => p.grantId !== grantId);
        }

        return result;
      } catch (error) {
        console.error('[PermissionStore] 撤销权限失败:', error);
        throw error;
      }
    },

    /**
     * 检查权限
     */
    async checkPermission(checkData: CheckPermissionData): Promise<IPCResponse> {
      try {
        const result = await (window as any).electronAPI.invoke('perm:check-permission', checkData);
        return result;
      } catch (error) {
        console.error('[PermissionStore] 检查权限失败:', error);
        throw error;
      }
    },

    /**
     * 加载用户权限
     */
    async loadUserPermissions(userDid: string, orgId: string): Promise<IPCResponse> {
      this.loading.permissions = true;

      try {
        const result = await (window as any).electronAPI.invoke('perm:get-user-permissions', {
          userDid,
          orgId,
        });

        if (result.success) {
          this.myPermissions = result.permissions || [];
        }

        return result;
      } catch (error) {
        console.error('[PermissionStore] 加载用户权限失败:', error);
        throw error;
      } finally {
        this.loading.permissions = false;
      }
    },

    /**
     * 加载资源权限
     */
    async loadResourcePermissions(
      orgId: string,
      resourceType: string,
      resourceId: string
    ): Promise<IPCResponse> {
      this.loading.permissions = true;

      try {
        const result = await (window as any).electronAPI.invoke('perm:get-resource-permissions', {
          orgId,
          resourceType,
          resourceId,
        });

        if (result.success) {
          this.resourcePermissions = result.permissions || [];
        }

        return result;
      } catch (error) {
        console.error('[PermissionStore] 加载资源权限失败:', error);
        throw error;
      } finally {
        this.loading.permissions = false;
      }
    },

    /**
     * 获取有效权限
     */
    async loadEffectivePermissions(
      userDid: string,
      orgId: string,
      resourceType: string,
      resourceId: string
    ): Promise<IPCResponse> {
      try {
        const result = await (window as any).electronAPI.invoke('perm:get-effective-permissions', {
          userDid,
          orgId,
          resourceType,
          resourceId,
        });

        if (result.success) {
          this.effectivePermissions = result.permissions || [];
        }

        return result;
      } catch (error) {
        console.error('[PermissionStore] 获取有效权限失败:', error);
        throw error;
      }
    },

    /**
     * 批量授予权限
     */
    async bulkGrantPermissions(grants: BulkGrantData[], grantedBy: string): Promise<IPCResponse> {
      try {
        return await (window as any).electronAPI.invoke('perm:bulk-grant', {
          grants,
          grantedBy,
        });
      } catch (error) {
        console.error('[PermissionStore] 批量授予权限失败:', error);
        throw error;
      }
    },

    // ==========================================
    // 审批工作流操作
    // ==========================================

    /**
     * 加载工作流列表
     */
    async loadWorkflows(
      orgId: string,
      options: Record<string, any> = {}
    ): Promise<IPCResponse> {
      this.loading.workflows = true;

      try {
        const result = await (window as any).electronAPI.invoke('perm:get-workflows', {
          orgId,
          ...options,
        });

        if (result.success) {
          this.workflows = result.workflows || [];
        }

        return result;
      } catch (error) {
        console.error('[PermissionStore] 加载工作流失败:', error);
        throw error;
      } finally {
        this.loading.workflows = false;
      }
    },

    /**
     * 创建工作流
     */
    async createWorkflow(workflowData: WorkflowData): Promise<IPCResponse> {
      this.loading.workflows = true;

      try {
        const result = await (window as any).electronAPI.invoke(
          'perm:create-workflow',
          workflowData
        );

        if (result.success) {
          this.workflows.push({
            id: result.workflowId,
            ...workflowData,
            status: 'active',
            createdAt: Date.now(),
          } as Workflow);
        }

        return result;
      } catch (error) {
        console.error('[PermissionStore] 创建工作流失败:', error);
        throw error;
      } finally {
        this.loading.workflows = false;
      }
    },

    /**
     * 更新工作流
     */
    async updateWorkflow(
      workflowId: string,
      updates: Partial<Workflow>
    ): Promise<IPCResponse> {
      try {
        const result = await (window as any).electronAPI.invoke('perm:update-workflow', {
          workflowId,
          updates,
        });

        if (result.success) {
          const index = this.workflows.findIndex((w) => w.id === workflowId);
          if (index !== -1) {
            this.workflows[index] = { ...this.workflows[index], ...updates };
          }
        }

        return result;
      } catch (error) {
        console.error('[PermissionStore] 更新工作流失败:', error);
        throw error;
      }
    },

    /**
     * 删除工作流
     */
    async deleteWorkflow(workflowId: string): Promise<IPCResponse> {
      try {
        const result = await (window as any).electronAPI.invoke('perm:delete-workflow', {
          workflowId,
        });

        if (result.success) {
          this.workflows = this.workflows.filter((w) => w.id !== workflowId);
        }

        return result;
      } catch (error) {
        console.error('[PermissionStore] 删除工作流失败:', error);
        throw error;
      }
    },

    /**
     * 提交审批请求
     */
    async submitApproval(requestData: SubmitApprovalData): Promise<IPCResponse> {
      try {
        const result = await (window as any).electronAPI.invoke(
          'perm:submit-approval',
          requestData
        );
        return result;
      } catch (error) {
        console.error('[PermissionStore] 提交审批失败:', error);
        throw error;
      }
    },

    /**
     * 加载待审批请求
     */
    async loadPendingApprovals(approverDid: string, orgId: string): Promise<IPCResponse> {
      this.loading.approvals = true;

      try {
        const result = await (window as any).electronAPI.invoke('perm:get-pending-approvals', {
          approverDid,
          orgId,
        });

        if (result.success) {
          this.pendingApprovals = result.requests || [];
        }

        return result;
      } catch (error) {
        console.error('[PermissionStore] 加载待审批请求失败:', error);
        throw error;
      } finally {
        this.loading.approvals = false;
      }
    },

    /**
     * 批准请求
     */
    async approveRequest(
      requestId: string,
      approverDid: string,
      comment: string | null = null
    ): Promise<IPCResponse> {
      try {
        const result = await (window as any).electronAPI.invoke('perm:approve-request', {
          requestId,
          approverDid,
          comment,
        });

        if (result.success) {
          // 从待审批列表移除
          this.pendingApprovals = this.pendingApprovals.filter((r) => r.id !== requestId);
        }

        return result;
      } catch (error) {
        console.error('[PermissionStore] 批准请求失败:', error);
        throw error;
      }
    },

    /**
     * 拒绝请求
     */
    async rejectRequest(
      requestId: string,
      approverDid: string,
      comment: string | null = null
    ): Promise<IPCResponse> {
      try {
        const result = await (window as any).electronAPI.invoke('perm:reject-request', {
          requestId,
          approverDid,
          comment,
        });

        if (result.success) {
          this.pendingApprovals = this.pendingApprovals.filter((r) => r.id !== requestId);
        }

        return result;
      } catch (error) {
        console.error('[PermissionStore] 拒绝请求失败:', error);
        throw error;
      }
    },

    /**
     * 加载审批历史
     */
    async loadApprovalHistory(
      orgId: string,
      options: Record<string, any> = {}
    ): Promise<IPCResponse> {
      this.loading.approvals = true;

      try {
        const result = await (window as any).electronAPI.invoke('perm:get-approval-history', {
          orgId,
          options,
        });

        if (result.success) {
          this.approvalHistory = result.requests || [];
        }

        return result;
      } catch (error) {
        console.error('[PermissionStore] 加载审批历史失败:', error);
        throw error;
      } finally {
        this.loading.approvals = false;
      }
    },

    // ==========================================
    // 委托操作
    // ==========================================

    /**
     * 委托权限
     */
    async delegatePermissions(delegationData: DelegationData): Promise<IPCResponse> {
      this.loading.delegations = true;

      try {
        const result = await (window as any).electronAPI.invoke(
          'perm:delegate-permissions',
          delegationData
        );

        if (result.success) {
          this.outgoingDelegations.push({
            id: result.delegationId,
            ...delegationData,
            status: 'active',
            createdAt: Date.now(),
          } as Delegation);
        }

        return result;
      } catch (error) {
        console.error('[PermissionStore] 委托权限失败:', error);
        throw error;
      } finally {
        this.loading.delegations = false;
      }
    },

    /**
     * 撤销委托
     */
    async revokeDelegation(delegationId: string, revokerDid: string): Promise<IPCResponse> {
      try {
        const result = await (window as any).electronAPI.invoke('perm:revoke-delegation', {
          delegationId,
          revokerDid,
        });

        if (result.success) {
          this.outgoingDelegations = this.outgoingDelegations.filter((d) => d.id !== delegationId);
        }

        return result;
      } catch (error) {
        console.error('[PermissionStore] 撤销委托失败:', error);
        throw error;
      }
    },

    /**
     * 加载委托
     */
    async loadDelegations(
      userDid: string,
      orgId: string,
      options: Record<string, any> = {}
    ): Promise<IPCResponse> {
      this.loading.delegations = true;

      try {
        const result = await (window as any).electronAPI.invoke('perm:get-delegations', {
          userDid,
          orgId,
          options,
        });

        if (result.success) {
          this.outgoingDelegations = result.outgoing || [];
          this.incomingDelegations = result.incoming || [];
        }

        return result;
      } catch (error) {
        console.error('[PermissionStore] 加载委托失败:', error);
        throw error;
      } finally {
        this.loading.delegations = false;
      }
    },

    /**
     * 接受委托
     */
    async acceptDelegation(delegationId: string, delegateDid: string): Promise<IPCResponse> {
      try {
        const result = await (window as any).electronAPI.invoke('perm:accept-delegation', {
          delegationId,
          delegateDid,
        });

        if (result.success) {
          const delegation = this.incomingDelegations.find((d) => d.id === delegationId);
          if (delegation) {
            delegation.status = 'active';
          }
        }

        return result;
      } catch (error) {
        console.error('[PermissionStore] 接受委托失败:', error);
        throw error;
      }
    },

    // ==========================================
    // 团队操作
    // ==========================================

    /**
     * 加载团队列表
     */
    async loadTeams(orgId: string, options: Record<string, any> = {}): Promise<IPCResponse> {
      this.loading.teams = true;

      try {
        const result = await (window as any).electronAPI.invoke('team:get-teams', {
          orgId,
          options,
        });

        if (result.success) {
          this.teams = result.teams || [];
        }

        return result;
      } catch (error) {
        console.error('[PermissionStore] 加载团队失败:', error);
        throw error;
      } finally {
        this.loading.teams = false;
      }
    },

    /**
     * 创建团队
     */
    async createTeam(teamData: TeamData): Promise<IPCResponse> {
      this.loading.teams = true;

      try {
        const result = await (window as any).electronAPI.invoke('team:create-team', teamData);

        if (result.success) {
          this.teams.push({
            id: result.teamId,
            ...teamData,
            memberCount: 0,
            createdAt: Date.now(),
          } as Team);
        }

        return result;
      } catch (error) {
        console.error('[PermissionStore] 创建团队失败:', error);
        throw error;
      } finally {
        this.loading.teams = false;
      }
    },

    /**
     * 更新团队
     */
    async updateTeam(teamId: string, updates: Partial<Team>): Promise<IPCResponse> {
      try {
        const result = await (window as any).electronAPI.invoke('team:update-team', {
          teamId,
          updates,
        });

        if (result.success) {
          const index = this.teams.findIndex((t) => t.id === teamId);
          if (index !== -1) {
            this.teams[index] = { ...this.teams[index], ...updates };
          }
        }

        return result;
      } catch (error) {
        console.error('[PermissionStore] 更新团队失败:', error);
        throw error;
      }
    },

    /**
     * 删除团队
     */
    async deleteTeam(teamId: string): Promise<IPCResponse> {
      try {
        const result = await (window as any).electronAPI.invoke('team:delete-team', { teamId });

        if (result.success) {
          this.teams = this.teams.filter((t) => t.id !== teamId);
          if (this.currentTeam?.id === teamId) {
            this.currentTeam = null;
            this.teamMembers = [];
          }
        }

        return result;
      } catch (error) {
        console.error('[PermissionStore] 删除团队失败:', error);
        throw error;
      }
    },

    /**
     * 加载团队成员
     */
    async loadTeamMembers(teamId: string): Promise<IPCResponse> {
      this.loading.teams = true;

      try {
        const result = await (window as any).electronAPI.invoke('team:get-team-members', {
          teamId,
        });

        if (result.success) {
          this.teamMembers = result.members || [];
          this.currentTeam = this.teams.find((t) => t.id === teamId) || null;
        }

        return result;
      } catch (error) {
        console.error('[PermissionStore] 加载团队成员失败:', error);
        throw error;
      } finally {
        this.loading.teams = false;
      }
    },

    /**
     * 添加团队成员
     */
    async addTeamMember(
      teamId: string,
      memberDid: string,
      memberName: string,
      role: TeamMember['role'],
      invitedBy: string
    ): Promise<IPCResponse> {
      try {
        const result = await (window as any).electronAPI.invoke('team:add-member', {
          teamId,
          memberDid,
          memberName,
          role,
          invitedBy,
        });

        if (result.success) {
          this.teamMembers.push({
            id: result.memberId,
            teamId,
            memberDid,
            memberName,
            role,
            joinedAt: Date.now(),
            invitedBy,
          });

          // 更新成员计数
          const team = this.teams.find((t) => t.id === teamId);
          if (team) {
            team.memberCount = (team.memberCount || 0) + 1;
          }
        }

        return result;
      } catch (error) {
        console.error('[PermissionStore] 添加团队成员失败:', error);
        throw error;
      }
    },

    /**
     * 移除团队成员
     */
    async removeTeamMember(teamId: string, memberDid: string): Promise<IPCResponse> {
      try {
        const result = await (window as any).electronAPI.invoke('team:remove-member', {
          teamId,
          memberDid,
        });

        if (result.success) {
          this.teamMembers = this.teamMembers.filter((m) => m.memberDid !== memberDid);

          const team = this.teams.find((t) => t.id === teamId);
          if (team && team.memberCount > 0) {
            team.memberCount--;
          }
        }

        return result;
      } catch (error) {
        console.error('[PermissionStore] 移除团队成员失败:', error);
        throw error;
      }
    },

    /**
     * 设置团队负责人
     */
    async setTeamLead(teamId: string, leadDid: string, leadName: string): Promise<IPCResponse> {
      try {
        const result = await (window as any).electronAPI.invoke('team:set-lead', {
          teamId,
          leadDid,
          leadName,
        });

        if (result.success) {
          const team = this.teams.find((t) => t.id === teamId);
          if (team) {
            team.leadDid = leadDid;
            team.leadName = leadName;
          }
        }

        return result;
      } catch (error) {
        console.error('[PermissionStore] 设置团队负责人失败:', error);
        throw error;
      }
    },

    // ==========================================
    // 重置
    // ==========================================

    /**
     * 重置所有状态
     */
    reset(): void {
      this.$reset();
    },
  },
});
