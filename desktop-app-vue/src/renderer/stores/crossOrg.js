/**
 * CrossOrg Store - Pinia 状态管理
 * 管理跨组织协作系统的状态
 *
 * @module crossOrg-store
 * @version 1.0.0
 */

import { defineStore } from 'pinia';

export const useCrossOrgStore = defineStore('crossOrg', {
  state: () => ({
    // ==========================================
    // 合作关系管理
    // ==========================================

    // 合作伙伴列表
    partnerships: [],

    // 待处理的合作请求
    pendingPartnershipRequests: [],

    // 合作伙伴组织
    partnerOrgs: [],

    // ==========================================
    // 共享工作空间
    // ==========================================

    // 工作空间列表
    workspaces: [],

    // 当前工作空间
    currentWorkspace: null,

    // 工作空间成员
    workspaceMembers: [],

    // 工作空间组织
    workspaceOrgs: [],

    // ==========================================
    // 资源共享
    // ==========================================

    // 我分享出去的资源
    outgoingShares: [],

    // 分享给我的资源
    incomingShares: [],

    // 共享分析数据
    shareAnalytics: null,

    // ==========================================
    // B2B 数据交换
    // ==========================================

    // 交易列表
    transactions: [],

    // 待处理的交易
    pendingTransactions: [],

    // 交易统计
    transactionStats: null,

    // ==========================================
    // 组织发现
    // ==========================================

    // 发现的组织
    discoveredOrgs: [],

    // 我的组织档案
    myOrgProfile: null,

    // ==========================================
    // 审计日志
    // ==========================================

    // 审计日志
    auditLogs: [],

    // ==========================================
    // 统计信息
    // ==========================================

    stats: {
      partnerCount: 0,
      workspaceCount: 0,
      outgoingShareCount: 0,
      incomingShareCount: 0,
      pendingTransactionCount: 0,
    },

    // ==========================================
    // 加载状态
    // ==========================================

    loading: {
      partnerships: false,
      workspaces: false,
      shares: false,
      transactions: false,
      discovery: false,
      audit: false,
    },

    // ==========================================
    // 错误状态
    // ==========================================

    error: null,
  }),

  getters: {
    /**
     * 活跃的合作伙伴
     */
    activePartners: (state) => {
      return state.partnerships.filter((p) => p.status === 'active');
    },

    /**
     * 待审批的合作请求数
     */
    pendingPartnershipCount: (state) => {
      return state.pendingPartnershipRequests.length;
    },

    /**
     * 活跃工作空间数
     */
    activeWorkspaceCount: (state) => {
      return state.workspaces.filter((w) => w.status !== 'archived').length;
    },

    /**
     * 待处理交易数
     */
    pendingTransactionCount: (state) => {
      return state.pendingTransactions.length;
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
    // 合作关系操作
    // ==========================================

    /**
     * 创建合作关系请求
     */
    async createPartnership(partnershipData) {
      this.loading.partnerships = true;
      this.error = null;

      try {
        const result = await window.electronAPI.invoke('crossorg:create-partnership', partnershipData);

        if (result.success) {
          // 添加到列表
          this.partnerships.push({
            id: result.partnershipId,
            ...partnershipData,
            status: 'pending',
            createdAt: Date.now(),
          });
        }

        return result;
      } catch (error) {
        console.error('[CrossOrgStore] 创建合作关系失败:', error);
        this.error = error.message;
        throw error;
      } finally {
        this.loading.partnerships = false;
      }
    },

    /**
     * 接受合作请求
     */
    async acceptPartnership(partnershipId, acceptedByDid) {
      try {
        const result = await window.electronAPI.invoke('crossorg:accept-partnership', {
          partnershipId,
          acceptedByDid,
        });

        if (result.success) {
          const partnership = this.partnerships.find((p) => p.id === partnershipId);
          if (partnership) {
            partnership.status = 'active';
            partnership.acceptedAt = Date.now();
          }

          // 从待处理移除
          this.pendingPartnershipRequests = this.pendingPartnershipRequests.filter(
            (p) => p.id !== partnershipId
          );
        }

        return result;
      } catch (error) {
        console.error('[CrossOrgStore] 接受合作请求失败:', error);
        throw error;
      }
    },

    /**
     * 拒绝合作请求
     */
    async rejectPartnership(partnershipId, rejectedByDid, reason) {
      try {
        const result = await window.electronAPI.invoke('crossorg:reject-partnership', {
          partnershipId,
          rejectedByDid,
          reason,
        });

        if (result.success) {
          this.pendingPartnershipRequests = this.pendingPartnershipRequests.filter(
            (p) => p.id !== partnershipId
          );
        }

        return result;
      } catch (error) {
        console.error('[CrossOrgStore] 拒绝合作请求失败:', error);
        throw error;
      }
    },

    /**
     * 终止合作关系
     */
    async terminatePartnership(partnershipId, terminatedByDid, reason) {
      try {
        const result = await window.electronAPI.invoke('crossorg:terminate-partnership', {
          partnershipId,
          terminatedByDid,
          reason,
        });

        if (result.success) {
          const partnership = this.partnerships.find((p) => p.id === partnershipId);
          if (partnership) {
            partnership.status = 'terminated';
          }
        }

        return result;
      } catch (error) {
        console.error('[CrossOrgStore] 终止合作关系失败:', error);
        throw error;
      }
    },

    /**
     * 加载合作关系
     */
    async loadPartnerships(orgId, options = {}) {
      this.loading.partnerships = true;

      try {
        const result = await window.electronAPI.invoke('crossorg:get-partnerships', {
          orgId,
          options,
        });

        if (result.success) {
          this.partnerships = result.partnerships || [];
          this.pendingPartnershipRequests = this.partnerships.filter((p) => p.status === 'pending');
        }

        return result;
      } catch (error) {
        console.error('[CrossOrgStore] 加载合作关系失败:', error);
        throw error;
      } finally {
        this.loading.partnerships = false;
      }
    },

    /**
     * 加载合作伙伴组织
     */
    async loadPartnerOrgs(orgId) {
      try {
        const result = await window.electronAPI.invoke('crossorg:get-partner-orgs', { orgId });

        if (result.success) {
          this.partnerOrgs = result.partners || [];
        }

        return result;
      } catch (error) {
        console.error('[CrossOrgStore] 加载合作伙伴失败:', error);
        throw error;
      }
    },

    /**
     * 更新信任级别
     */
    async updateTrustLevel(partnershipId, trustLevel, updatedByDid) {
      try {
        const result = await window.electronAPI.invoke('crossorg:update-trust-level', {
          partnershipId,
          trustLevel,
          updatedByDid,
        });

        if (result.success) {
          const partnership = this.partnerships.find((p) => p.id === partnershipId);
          if (partnership) {
            partnership.trustLevel = trustLevel;
          }
        }

        return result;
      } catch (error) {
        console.error('[CrossOrgStore] 更新信任级别失败:', error);
        throw error;
      }
    },

    // ==========================================
    // 共享工作空间操作
    // ==========================================

    /**
     * 创建共享工作空间
     */
    async createWorkspace(workspaceData) {
      this.loading.workspaces = true;

      try {
        const result = await window.electronAPI.invoke('crossorg:create-workspace', workspaceData);

        if (result.success) {
          this.workspaces.push({
            id: result.workspaceId,
            ...workspaceData,
            createdAt: Date.now(),
          });
        }

        return result;
      } catch (error) {
        console.error('[CrossOrgStore] 创建工作空间失败:', error);
        throw error;
      } finally {
        this.loading.workspaces = false;
      }
    },

    /**
     * 加载工作空间列表
     */
    async loadWorkspaces(orgId, options = {}) {
      this.loading.workspaces = true;

      try {
        const result = await window.electronAPI.invoke('crossorg:get-workspaces', {
          orgId,
          options,
        });

        if (result.success) {
          this.workspaces = result.workspaces || [];
        }

        return result;
      } catch (error) {
        console.error('[CrossOrgStore] 加载工作空间失败:', error);
        throw error;
      } finally {
        this.loading.workspaces = false;
      }
    },

    /**
     * 更新工作空间
     */
    async updateWorkspace(workspaceId, updates) {
      try {
        const result = await window.electronAPI.invoke('crossorg:update-workspace', {
          workspaceId,
          updates,
        });

        if (result.success) {
          const index = this.workspaces.findIndex((w) => w.id === workspaceId);
          if (index !== -1) {
            this.workspaces[index] = { ...this.workspaces[index], ...updates };
          }
        }

        return result;
      } catch (error) {
        console.error('[CrossOrgStore] 更新工作空间失败:', error);
        throw error;
      }
    },

    /**
     * 归档工作空间
     */
    async archiveWorkspace(workspaceId, archivedByDid) {
      try {
        const result = await window.electronAPI.invoke('crossorg:archive-workspace', {
          workspaceId,
          archivedByDid,
        });

        if (result.success) {
          const workspace = this.workspaces.find((w) => w.id === workspaceId);
          if (workspace) {
            workspace.status = 'archived';
          }
        }

        return result;
      } catch (error) {
        console.error('[CrossOrgStore] 归档工作空间失败:', error);
        throw error;
      }
    },

    /**
     * 邀请组织加入工作空间
     */
    async inviteOrgToWorkspace(workspaceId, orgData, invitedByDid) {
      try {
        const result = await window.electronAPI.invoke('crossorg:invite-org', {
          workspaceId,
          orgData,
          invitedByDid,
        });

        return result;
      } catch (error) {
        console.error('[CrossOrgStore] 邀请组织失败:', error);
        throw error;
      }
    },

    /**
     * 加载工作空间成员
     */
    async loadWorkspaceMembers(workspaceId, options = {}) {
      try {
        const result = await window.electronAPI.invoke('crossorg:get-workspace-members', {
          workspaceId,
          options,
        });

        if (result.success) {
          this.workspaceMembers = result.members || [];
          this.workspaceOrgs = result.organizations || [];
          this.currentWorkspace = this.workspaces.find((w) => w.id === workspaceId) || null;
        }

        return result;
      } catch (error) {
        console.error('[CrossOrgStore] 加载工作空间成员失败:', error);
        throw error;
      }
    },

    /**
     * 添加成员到工作空间
     */
    async addWorkspaceMember(workspaceId, memberData, addedByDid) {
      try {
        const result = await window.electronAPI.invoke('crossorg:add-member', {
          workspaceId,
          memberData,
          addedByDid,
        });

        if (result.success) {
          this.workspaceMembers.push({ id: result.memberId, ...memberData });
        }

        return result;
      } catch (error) {
        console.error('[CrossOrgStore] 添加成员失败:', error);
        throw error;
      }
    },

    // ==========================================
    // 资源共享操作
    // ==========================================

    /**
     * 共享资源
     */
    async shareResource(shareData) {
      this.loading.shares = true;

      try {
        const result = await window.electronAPI.invoke('crossorg:share-resource', shareData);

        if (result.success) {
          this.outgoingShares.push({
            id: result.shareId,
            ...shareData,
            createdAt: Date.now(),
          });
        }

        return result;
      } catch (error) {
        console.error('[CrossOrgStore] 共享资源失败:', error);
        throw error;
      } finally {
        this.loading.shares = false;
      }
    },

    /**
     * 取消共享
     */
    async unshareResource(shareId, unsharerDid) {
      try {
        const result = await window.electronAPI.invoke('crossorg:unshare-resource', {
          shareId,
          unsharerDid,
        });

        if (result.success) {
          this.outgoingShares = this.outgoingShares.filter((s) => s.id !== shareId);
        }

        return result;
      } catch (error) {
        console.error('[CrossOrgStore] 取消共享失败:', error);
        throw error;
      }
    },

    /**
     * 加载共享资源
     */
    async loadSharedResources(orgId, options = {}) {
      this.loading.shares = true;

      try {
        const result = await window.electronAPI.invoke('crossorg:get-shared-resources', {
          orgId,
          options,
        });

        if (result.success) {
          if (options.direction === 'outgoing') {
            this.outgoingShares = result.shares || [];
          } else if (options.direction === 'incoming') {
            this.incomingShares = result.shares || [];
          } else {
            // 分离出入方向
            this.outgoingShares = result.shares?.filter((s) => s.sourceOrgId === orgId) || [];
            this.incomingShares = result.shares?.filter((s) => s.targetOrgId === orgId) || [];
          }
        }

        return result;
      } catch (error) {
        console.error('[CrossOrgStore] 加载共享资源失败:', error);
        throw error;
      } finally {
        this.loading.shares = false;
      }
    },

    /**
     * 访问共享资源
     */
    async accessSharedResource(shareId, accessorDid, accessorOrgId) {
      try {
        return await window.electronAPI.invoke('crossorg:access-shared-resource', {
          shareId,
          accessorDid,
          accessorOrgId,
        });
      } catch (error) {
        console.error('[CrossOrgStore] 访问共享资源失败:', error);
        throw error;
      }
    },

    /**
     * 加载共享分析
     */
    async loadShareAnalytics(orgId, options = {}) {
      try {
        const result = await window.electronAPI.invoke('crossorg:get-share-analytics', {
          orgId,
          options,
        });

        if (result.success) {
          this.shareAnalytics = result.analytics;
        }

        return result;
      } catch (error) {
        console.error('[CrossOrgStore] 加载共享分析失败:', error);
        throw error;
      }
    },

    // ==========================================
    // B2B 交易操作
    // ==========================================

    /**
     * 发起交易
     */
    async initiateTransaction(transactionData) {
      this.loading.transactions = true;

      try {
        const result = await window.electronAPI.invoke('crossorg:initiate-transaction', transactionData);

        if (result.success) {
          this.transactions.push({
            id: result.transactionId,
            ...transactionData,
            status: 'pending',
            createdAt: Date.now(),
          });
        }

        return result;
      } catch (error) {
        console.error('[CrossOrgStore] 发起交易失败:', error);
        throw error;
      } finally {
        this.loading.transactions = false;
      }
    },

    /**
     * 接受交易
     */
    async acceptTransaction(transactionId, acceptedByDid) {
      try {
        const result = await window.electronAPI.invoke('crossorg:accept-transaction', {
          transactionId,
          acceptedByDid,
        });

        if (result.success) {
          const tx = this.transactions.find((t) => t.id === transactionId);
          if (tx) {
            tx.status = 'accepted';
          }
          this.pendingTransactions = this.pendingTransactions.filter((t) => t.id !== transactionId);
        }

        return result;
      } catch (error) {
        console.error('[CrossOrgStore] 接受交易失败:', error);
        throw error;
      }
    },

    /**
     * 拒绝交易
     */
    async rejectTransaction(transactionId, rejectedByDid, reason) {
      try {
        const result = await window.electronAPI.invoke('crossorg:reject-transaction', {
          transactionId,
          rejectedByDid,
          reason,
        });

        if (result.success) {
          const tx = this.transactions.find((t) => t.id === transactionId);
          if (tx) {
            tx.status = 'rejected';
          }
          this.pendingTransactions = this.pendingTransactions.filter((t) => t.id !== transactionId);
        }

        return result;
      } catch (error) {
        console.error('[CrossOrgStore] 拒绝交易失败:', error);
        throw error;
      }
    },

    /**
     * 加载交易
     */
    async loadTransactions(orgId, options = {}) {
      this.loading.transactions = true;

      try {
        const result = await window.electronAPI.invoke('crossorg:get-transactions', {
          orgId,
          options,
        });

        if (result.success) {
          this.transactions = result.transactions || [];
          this.pendingTransactions = this.transactions.filter((t) => t.status === 'pending');
        }

        return result;
      } catch (error) {
        console.error('[CrossOrgStore] 加载交易失败:', error);
        throw error;
      } finally {
        this.loading.transactions = false;
      }
    },

    /**
     * 验证数据完整性
     */
    async verifyDataIntegrity(transactionId, providedHash) {
      try {
        return await window.electronAPI.invoke('crossorg:verify-data-integrity', {
          transactionId,
          providedHash,
        });
      } catch (error) {
        console.error('[CrossOrgStore] 验证数据完整性失败:', error);
        throw error;
      }
    },

    // ==========================================
    // 组织发现操作
    // ==========================================

    /**
     * 发现组织
     */
    async discoverOrgs(searchParams = {}) {
      this.loading.discovery = true;

      try {
        const result = await window.electronAPI.invoke('crossorg:discover-orgs', searchParams);

        if (result.success) {
          this.discoveredOrgs = result.organizations || [];
        }

        return result;
      } catch (error) {
        console.error('[CrossOrgStore] 发现组织失败:', error);
        throw error;
      } finally {
        this.loading.discovery = false;
      }
    },

    /**
     * 获取组织档案
     */
    async getOrgProfile(orgId) {
      try {
        const result = await window.electronAPI.invoke('crossorg:get-org-profile', { orgId });

        if (result.success && orgId === this.myOrgProfile?.orgId) {
          this.myOrgProfile = result.profile;
        }

        return result;
      } catch (error) {
        console.error('[CrossOrgStore] 获取组织档案失败:', error);
        throw error;
      }
    },

    /**
     * 搜索共享资源
     */
    async searchSharedResources(orgId, searchParams = {}) {
      try {
        return await window.electronAPI.invoke('crossorg:search-shared-resources', {
          orgId,
          searchParams,
        });
      } catch (error) {
        console.error('[CrossOrgStore] 搜索共享资源失败:', error);
        throw error;
      }
    },

    // ==========================================
    // 审计日志操作
    // ==========================================

    /**
     * 加载审计日志
     */
    async loadAuditLog(orgId, options = {}) {
      this.loading.audit = true;

      try {
        const result = await window.electronAPI.invoke('crossorg:get-audit-log', {
          orgId,
          options,
        });

        if (result.success) {
          this.auditLogs = result.logs || [];
        }

        return result;
      } catch (error) {
        console.error('[CrossOrgStore] 加载审计日志失败:', error);
        throw error;
      } finally {
        this.loading.audit = false;
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
