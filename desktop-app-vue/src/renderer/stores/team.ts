/**
 * Team Store - Pinia 状态管理
 * 管理组织内团队系统的状态（与 permission.ts 中的团队功能配合使用）
 *
 * @module team-store
 * @version 1.0.0
 */

import { defineStore } from 'pinia';

// ==================== 类型定义 ====================

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
 * 团队层级节点
 */
export interface TeamHierarchyNode extends Team {
  children: TeamHierarchyNode[];
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
  invitedBy?: string | null;
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
 * 筛选条件
 */
export interface TeamFilters {
  searchQuery: string;
  parentTeamId: string | null;
}

/**
 * 视图模式
 */
export type ViewMode = 'list' | 'tree' | 'card';

/**
 * 加载状态
 */
export interface LoadingState {
  teams: boolean;
  members: boolean;
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
 * Team Store 状态
 */
export interface TeamState {
  teams: Team[];
  currentTeam: Team | null;
  members: TeamMember[];
  teamHierarchy: TeamHierarchyNode[];
  viewMode: ViewMode;
  filters: TeamFilters;
  loading: LoadingState;
  error: string | null;
}

// ==================== Store ====================

export const useTeamStore = defineStore('team', {
  state: (): TeamState => ({
    // ==========================================
    // 团队管理
    // ==========================================

    // 所有团队列表
    teams: [],

    // 当前选中的团队
    currentTeam: null,

    // 团队成员
    members: [],

    // 团队层级结构
    teamHierarchy: [],

    // ==========================================
    // 视图设置
    // ==========================================

    // 视图模式: 'list' | 'tree' | 'card'
    viewMode: 'list',

    // 筛选条件
    filters: {
      searchQuery: '',
      parentTeamId: null,
    },

    // ==========================================
    // 加载状态
    // ==========================================

    loading: {
      teams: false,
      members: false,
    },

    // ==========================================
    // 错误状态
    // ==========================================

    error: null,
  }),

  getters: {
    /**
     * 根团队列表（没有父团队的团队）
     */
    rootTeams(): Team[] {
      return this.teams.filter((t) => !t.parentTeamId);
    },

    /**
     * 根据筛选条件过滤后的团队
     */
    filteredTeams(): Team[] {
      let result = [...this.teams];

      if (this.filters.parentTeamId !== null) {
        result = result.filter((t) => t.parentTeamId === this.filters.parentTeamId);
      }

      if (this.filters.searchQuery) {
        const query = this.filters.searchQuery.toLowerCase();
        result = result.filter(
          (t) =>
            t.name.toLowerCase().includes(query) ||
            (t.description && t.description.toLowerCase().includes(query))
        );
      }

      return result;
    },

    /**
     * 获取子团队
     */
    getChildTeams(): (parentId: string) => Team[] {
      return (parentId: string) => {
        return this.teams.filter((t) => t.parentTeamId === parentId);
      };
    },

    /**
     * 团队总数
     */
    totalTeamCount(): number {
      return this.teams.length;
    },

    /**
     * 总成员数
     */
    totalMemberCount(): number {
      return this.teams.reduce((sum, t) => sum + (t.memberCount || 0), 0);
    },

    /**
     * 当前团队是否有子团队
     */
    hasChildTeams(): boolean {
      if (!this.currentTeam) return false;
      return this.teams.some((t) => t.parentTeamId === this.currentTeam!.id);
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
    // 团队操作
    // ==========================================

    /**
     * 加载团队列表
     */
    async loadTeams(orgId: string, options: Record<string, any> = {}): Promise<IPCResponse> {
      this.loading.teams = true;
      this.error = null;

      try {
        const result = await (window as any).electronAPI.invoke('team:get-teams', {
          orgId,
          options,
        });

        if (result.success) {
          this.teams = result.teams || [];
          this._buildHierarchy();
        }

        return result;
      } catch (error) {
        console.error('[TeamStore] 加载团队列表失败:', error);
        this.error = (error as Error).message;
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
      this.error = null;

      try {
        const result = await (window as any).electronAPI.invoke('team:create-team', teamData);

        if (result.success) {
          const newTeam: Team = {
            id: result.teamId,
            ...teamData,
            memberCount: teamData.leadDid ? 1 : 0,
            createdAt: Date.now(),
          };
          this.teams.push(newTeam);
          this._buildHierarchy();
        }

        return result;
      } catch (error) {
        console.error('[TeamStore] 创建团队失败:', error);
        this.error = (error as Error).message;
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

          if (this.currentTeam?.id === teamId) {
            this.currentTeam = { ...this.currentTeam, ...updates };
          }

          this._buildHierarchy();
        }

        return result;
      } catch (error) {
        console.error('[TeamStore] 更新团队失败:', error);
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
            this.members = [];
          }

          this._buildHierarchy();
        }

        return result;
      } catch (error) {
        console.error('[TeamStore] 删除团队失败:', error);
        throw error;
      }
    },

    /**
     * 选择团队
     */
    async selectTeam(teamId: string): Promise<IPCResponse> {
      this.loading.members = true;

      try {
        const team = this.teams.find((t) => t.id === teamId);
        this.currentTeam = team || null;

        if (team) {
          await this.loadMembers(teamId);
        }

        return { success: true };
      } finally {
        this.loading.members = false;
      }
    },

    // ==========================================
    // 成员操作
    // ==========================================

    /**
     * 加载团队成员
     */
    async loadMembers(teamId: string): Promise<IPCResponse> {
      this.loading.members = true;

      try {
        const result = await (window as any).electronAPI.invoke('team:get-team-members', {
          teamId,
        });

        if (result.success) {
          this.members = result.members || [];
        }

        return result;
      } catch (error) {
        console.error('[TeamStore] 加载团队成员失败:', error);
        throw error;
      } finally {
        this.loading.members = false;
      }
    },

    /**
     * 添加成员
     */
    async addMember(
      teamId: string,
      memberDid: string,
      memberName: string,
      role: TeamMember['role'] = 'member',
      invitedBy: string | null = null
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
          this.members.push({
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
        console.error('[TeamStore] 添加成员失败:', error);
        throw error;
      }
    },

    /**
     * 移除成员
     */
    async removeMember(teamId: string, memberDid: string): Promise<IPCResponse> {
      try {
        const result = await (window as any).electronAPI.invoke('team:remove-member', {
          teamId,
          memberDid,
        });

        if (result.success) {
          this.members = this.members.filter((m) => m.memberDid !== memberDid);

          // 更新成员计数
          const team = this.teams.find((t) => t.id === teamId);
          if (team && team.memberCount > 0) {
            team.memberCount--;
          }
        }

        return result;
      } catch (error) {
        console.error('[TeamStore] 移除成员失败:', error);
        throw error;
      }
    },

    /**
     * 设置团队负责人
     */
    async setLead(teamId: string, leadDid: string, leadName: string): Promise<IPCResponse> {
      try {
        const result = await (window as any).electronAPI.invoke('team:set-lead', {
          teamId,
          leadDid,
          leadName,
        });

        if (result.success) {
          // 更新团队信息
          const team = this.teams.find((t) => t.id === teamId);
          if (team) {
            team.leadDid = leadDid;
            team.leadName = leadName;
          }

          if (this.currentTeam?.id === teamId) {
            this.currentTeam.leadDid = leadDid;
            this.currentTeam.leadName = leadName;
          }

          // 更新成员角色
          this.members.forEach((m) => {
            if (m.role === 'lead') {
              m.role = 'member';
            }
            if (m.memberDid === leadDid) {
              m.role = 'lead';
            }
          });
        }

        return result;
      } catch (error) {
        console.error('[TeamStore] 设置负责人失败:', error);
        throw error;
      }
    },

    // ==========================================
    // 视图和筛选
    // ==========================================

    /**
     * 设置视图模式
     */
    setViewMode(mode: ViewMode): void {
      this.viewMode = mode;
    },

    /**
     * 设置筛选条件
     */
    setFilters(filters: Partial<TeamFilters>): void {
      this.filters = { ...this.filters, ...filters };
    },

    /**
     * 清空筛选条件
     */
    clearFilters(): void {
      this.filters = {
        searchQuery: '',
        parentTeamId: null,
      };
    },

    // ==========================================
    // 内部方法
    // ==========================================

    /**
     * 构建团队层级结构
     */
    _buildHierarchy(): void {
      const buildNode = (parentId: string | null): TeamHierarchyNode[] => {
        const children = this.teams.filter((t) => t.parentTeamId === parentId);
        return children.map((team) => ({
          ...team,
          children: buildNode(team.id),
        }));
      };

      this.teamHierarchy = buildNode(null);
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
