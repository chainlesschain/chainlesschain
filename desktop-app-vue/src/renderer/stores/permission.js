/**
 * Permission Store - Pinia 状态管理
 * 管理组织权限和审批工作流系统的状态
 *
 * @module permission-store
 * @version 1.0.0
 */

import { defineStore } from 'pinia';

export const usePermissionStore = defineStore('permission', {
  state: () => ({
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
    hasPendingApprovals: (state) => {
      return state.pendingApprovals.length > 0;
    },

    /**
     * 待审批请求数量
     */
    pendingApprovalCount: (state) => {
      return state.pendingApprovals.length;
    },

    /**
     * 活跃的委托数量
     */
    activeDelegationCount: (state) => {
      return state.outgoingDelegations.filter((d) => d.status === 'active').length;
    },

    /**
     * 根团队列表
     */
    rootTeams: (state) => {
      return state.teams.filter((t) => !t.parentTeamId);
    },

    /**
     * 是否正在加载
     */
    isLoading: (state) => {
      return Object.values(state.loading).some((loading) => loading);
    },
  },

  actions: {
    // ==========================================
    // 权限操作
    // ==========================================

    /**
     * 授予权限
     */
    async grantPermission(permissionData) {
      this.loading.permissions = true;
      this.error = null;

      try {
        const result = await window.electronAPI.invoke('perm:grant-permission', permissionData);

        if (result.success) {
          // 刷新权限列表
          await this.loadUserPermissions(permissionData.granteeDid, permissionData.orgId);
        }

        return result;
      } catch (error) {
        console.error('[PermissionStore] 授予权限失败:', error);
        this.error = error.message;
        throw error;
      } finally {
        this.loading.permissions = false;
      }
    },

    /**
     * 撤销权限
     */
    async revokePermission(grantId, revokedBy) {
      try {
        const result = await window.electronAPI.invoke('perm:revoke-permission', {
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
    async checkPermission(checkData) {
      try {
        const result = await window.electronAPI.invoke('perm:check-permission', checkData);
        return result;
      } catch (error) {
        console.error('[PermissionStore] 检查权限失败:', error);
        throw error;
      }
    },

    /**
     * 加载用户权限
     */
    async loadUserPermissions(userDid, orgId) {
      this.loading.permissions = true;

      try {
        const result = await window.electronAPI.invoke('perm:get-user-permissions', {
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
    async loadResourcePermissions(orgId, resourceType, resourceId) {
      this.loading.permissions = true;

      try {
        const result = await window.electronAPI.invoke('perm:get-resource-permissions', {
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
    async loadEffectivePermissions(userDid, orgId, resourceType, resourceId) {
      try {
        const result = await window.electronAPI.invoke('perm:get-effective-permissions', {
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
    async bulkGrantPermissions(grants, grantedBy) {
      try {
        return await window.electronAPI.invoke('perm:bulk-grant', {
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
    async loadWorkflows(orgId, options = {}) {
      this.loading.workflows = true;

      try {
        const result = await window.electronAPI.invoke('perm:get-workflows', {
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
    async createWorkflow(workflowData) {
      this.loading.workflows = true;

      try {
        const result = await window.electronAPI.invoke('perm:create-workflow', workflowData);

        if (result.success) {
          this.workflows.push({ id: result.workflowId, ...workflowData });
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
    async updateWorkflow(workflowId, updates) {
      try {
        const result = await window.electronAPI.invoke('perm:update-workflow', {
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
    async deleteWorkflow(workflowId) {
      try {
        const result = await window.electronAPI.invoke('perm:delete-workflow', { workflowId });

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
    async submitApproval(requestData) {
      try {
        const result = await window.electronAPI.invoke('perm:submit-approval', requestData);
        return result;
      } catch (error) {
        console.error('[PermissionStore] 提交审批失败:', error);
        throw error;
      }
    },

    /**
     * 加载待审批请求
     */
    async loadPendingApprovals(approverDid, orgId) {
      this.loading.approvals = true;

      try {
        const result = await window.electronAPI.invoke('perm:get-pending-approvals', {
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
    async approveRequest(requestId, approverDid, comment = null) {
      try {
        const result = await window.electronAPI.invoke('perm:approve-request', {
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
    async rejectRequest(requestId, approverDid, comment = null) {
      try {
        const result = await window.electronAPI.invoke('perm:reject-request', {
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
    async loadApprovalHistory(orgId, options = {}) {
      this.loading.approvals = true;

      try {
        const result = await window.electronAPI.invoke('perm:get-approval-history', {
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
    async delegatePermissions(delegationData) {
      this.loading.delegations = true;

      try {
        const result = await window.electronAPI.invoke('perm:delegate-permissions', delegationData);

        if (result.success) {
          this.outgoingDelegations.push({ id: result.delegationId, ...delegationData });
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
    async revokeDelegation(delegationId, revokerDid) {
      try {
        const result = await window.electronAPI.invoke('perm:revoke-delegation', {
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
    async loadDelegations(userDid, orgId, options = {}) {
      this.loading.delegations = true;

      try {
        const result = await window.electronAPI.invoke('perm:get-delegations', {
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
    async acceptDelegation(delegationId, delegateDid) {
      try {
        const result = await window.electronAPI.invoke('perm:accept-delegation', {
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
    async loadTeams(orgId, options = {}) {
      this.loading.teams = true;

      try {
        const result = await window.electronAPI.invoke('team:get-teams', {
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
    async createTeam(teamData) {
      this.loading.teams = true;

      try {
        const result = await window.electronAPI.invoke('team:create-team', teamData);

        if (result.success) {
          this.teams.push({ id: result.teamId, ...teamData, memberCount: 0 });
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
    async updateTeam(teamId, updates) {
      try {
        const result = await window.electronAPI.invoke('team:update-team', {
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
    async deleteTeam(teamId) {
      try {
        const result = await window.electronAPI.invoke('team:delete-team', { teamId });

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
    async loadTeamMembers(teamId) {
      this.loading.teams = true;

      try {
        const result = await window.electronAPI.invoke('team:get-team-members', { teamId });

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
    async addTeamMember(teamId, memberDid, memberName, role, invitedBy) {
      try {
        const result = await window.electronAPI.invoke('team:add-member', {
          teamId,
          memberDid,
          memberName,
          role,
          invitedBy,
        });

        if (result.success) {
          this.teamMembers.push({
            id: result.memberId,
            memberDid,
            memberName,
            role,
            joinedAt: Date.now(),
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
    async removeTeamMember(teamId, memberDid) {
      try {
        const result = await window.electronAPI.invoke('team:remove-member', {
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
    async setTeamLead(teamId, leadDid, leadName) {
      try {
        const result = await window.electronAPI.invoke('team:set-lead', {
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
    reset() {
      this.$reset();
    },
  },
});
