/**
 * Cowork Store - Pinia 状态管理
 * 管理多代理协作系统的团队、任务、技能、统计等状态
 *
 * @module cowork-store
 * @version 1.0.0
 * @since 2026-01-27
 */

import { logger, createLogger } from '@/utils/logger';
import { defineStore } from "pinia";

const coworkLogger = createLogger('cowork-store');

export const useCoworkStore = defineStore("cowork", {
  state: () => ({
    // ==========================================
    // 团队管理
    // ==========================================

    // 所有团队列表
    teams: [],

    // 当前选中的团队（用于详情展示）
    currentTeam: null,

    // 选中的团队 ID 列表（用于批量操作）
    selectedTeamIds: [],

    // ==========================================
    // 任务管理
    // ==========================================

    // 所有任务列表（跨所有团队）
    tasks: [],

    // 当前选中的任务（用于详情展示）
    currentTask: null,

    // 选中的任务 ID 列表（用于批量操作）
    selectedTaskIds: [],

    // ==========================================
    // 技能管理
    // ==========================================

    // 已注册的技能列表
    skills: [],

    // 当前选中的技能（用于详情展示）
    currentSkill: null,

    // 技能执行历史
    skillExecutionHistory: [],

    // ==========================================
    // 代理管理
    // ==========================================

    // 所有代理列表
    agents: [],

    // 当前团队的成员列表
    currentTeamMembers: [],

    // ==========================================
    // 统计信息
    // ==========================================

    // 全局统计
    globalStats: {
      totalTeams: 0,
      activeTeams: 0,
      totalAgents: 0,
      totalTasks: 0,
      runningTasks: 0,
      completedTasks: 0,
      failedTasks: 0,
      totalSkills: 0,
      successRate: 0,
      averageExecutionTime: 0,
    },

    // 团队统计（按团队 ID 索引）
    teamStats: {},

    // 技能统计（按技能名称索引）
    skillStats: {},

    // ==========================================
    // 筛选和排序
    // ==========================================

    // 团队筛选条件
    teamFilters: {
      searchQuery: "",
      status: null, // null | 'active' | 'paused' | 'completed' | 'failed'
      sortBy: "created_at",
      sortOrder: "desc",
    },

    // 任务筛选条件
    taskFilters: {
      searchQuery: "",
      status: null, // null | 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled'
      teamId: null, // 按团队筛选
      sortBy: "created_at",
      sortOrder: "desc",
    },

    // ==========================================
    // 分页
    // ==========================================

    // 团队分页
    teamPagination: {
      offset: 0,
      limit: 20,
      total: 0,
    },

    // 任务分页
    taskPagination: {
      offset: 0,
      limit: 20,
      total: 0,
    },

    // ==========================================
    // 加载状态
    // ==========================================

    loading: {
      teams: false,
      teamDetail: false,
      tasks: false,
      taskDetail: false,
      skills: false,
      stats: false,
      agents: false,
    },

    // ==========================================
    // 错误状态
    // ==========================================

    error: null,

    // ==========================================
    // 事件监听器
    // ==========================================

    eventListeners: [],
  }),

  getters: {
    // ==========================================
    // 团队相关 Getters
    // ==========================================

    /**
     * 根据筛选条件过滤后的团队列表
     */
    filteredTeams: (state) => {
      let result = [...state.teams];

      // 按状态筛选
      if (state.teamFilters.status) {
        result = result.filter(
          (team) => team.status === state.teamFilters.status,
        );
      }

      // 按搜索关键词筛选
      if (state.teamFilters.searchQuery) {
        const query = state.teamFilters.searchQuery.toLowerCase();
        result = result.filter(
          (team) =>
            team.name.toLowerCase().includes(query) ||
            (team.description && team.description.toLowerCase().includes(query)),
        );
      }

      return result;
    },

    /**
     * 活跃的团队列表
     */
    activeTeams: (state) => {
      return state.teams.filter((team) => team.status === "active");
    },

    /**
     * 暂停的团队列表
     */
    pausedTeams: (state) => {
      return state.teams.filter((team) => team.status === "paused");
    },

    /**
     * 已完成的团队列表
     */
    completedTeams: (state) => {
      return state.teams.filter((team) => team.status === "completed");
    },

    /**
     * 是否有选中的团队
     */
    hasSelectedTeams: (state) => {
      return state.selectedTeamIds.length > 0;
    },

    /**
     * 选中的团队数量
     */
    selectedTeamCount: (state) => {
      return state.selectedTeamIds.length;
    },

    // ==========================================
    // 任务相关 Getters
    // ==========================================

    /**
     * 根据筛选条件过滤后的任务列表
     */
    filteredTasks: (state) => {
      let result = [...state.tasks];

      // 按状态筛选
      if (state.taskFilters.status) {
        result = result.filter(
          (task) => task.status === state.taskFilters.status,
        );
      }

      // 按团队筛选
      if (state.taskFilters.teamId) {
        result = result.filter(
          (task) => task.teamId === state.taskFilters.teamId,
        );
      }

      // 按搜索关键词筛选
      if (state.taskFilters.searchQuery) {
        const query = state.taskFilters.searchQuery.toLowerCase();
        result = result.filter(
          (task) =>
            task.name.toLowerCase().includes(query) ||
            (task.description && task.description.toLowerCase().includes(query)),
        );
      }

      return result;
    },

    /**
     * 运行中的任务列表
     */
    runningTasks: (state) => {
      return state.tasks.filter((task) => task.status === "running");
    },

    /**
     * 待处理的任务列表
     */
    pendingTasks: (state) => {
      return state.tasks.filter((task) => task.status === "pending");
    },

    /**
     * 已完成的任务列表
     */
    completedTasks: (state) => {
      return state.tasks.filter((task) => task.status === "completed");
    },

    /**
     * 失败的任务列表
     */
    failedTasks: (state) => {
      return state.tasks.filter((task) => task.status === "failed");
    },

    /**
     * 是否有选中的任务
     */
    hasSelectedTasks: (state) => {
      return state.selectedTaskIds.length > 0;
    },

    /**
     * 选中的任务数量
     */
    selectedTaskCount: (state) => {
      return state.selectedTaskIds.length;
    },

    // ==========================================
    // 技能相关 Getters
    // ==========================================

    /**
     * 按类型分组的技能
     */
    skillsByType: (state) => {
      const grouped = {};
      state.skills.forEach((skill) => {
        const type = skill.type || "other";
        if (!grouped[type]) {
          grouped[type] = [];
        }
        grouped[type].push(skill);
      });
      return grouped;
    },

    /**
     * Office 类型的技能
     */
    officeSkills: (state) => {
      return state.skills.filter((skill) => skill.type === "office");
    },

    // ==========================================
    // 加载状态 Getters
    // ==========================================

    /**
     * 是否正在加载任何内容
     */
    isLoading: (state) => {
      return Object.values(state.loading).some((loading) => loading);
    },

    /**
     * 是否正在加载团队
     */
    isLoadingTeams: (state) => {
      return state.loading.teams;
    },

    /**
     * 是否正在加载任务
     */
    isLoadingTasks: (state) => {
      return state.loading.tasks;
    },
  },

  actions: {
    // ==========================================
    // 团队管理 Actions
    // ==========================================

    /**
     * 创建团队
     */
    async createTeam(teamName, config = {}) {
      this.loading.teams = true;
      this.error = null;

      try {
        const result = await window.electronAPI.invoke("cowork:create-team", {
          teamName,
          config,
        });

        if (result.success) {
          // 添加到团队列表
          this.teams.unshift(result.team);

          // 更新统计信息
          await this.loadStats();

          coworkLogger.info(`团队创建成功: ${teamName}`, result.team);
        }

        return result;
      } catch (error) {
        coworkLogger.error("[CoworkStore] 创建团队失败:", error);
        this.error = error.message;
        throw error;
      } finally {
        this.loading.teams = false;
      }
    },

    /**
     * 加载团队列表
     */
    async loadTeams(options = {}) {
      this.loading.teams = true;
      this.error = null;

      try {
        const params = {
          status: options.status || null,
        };

        const result = await window.electronAPI.invoke(
          "cowork:discover-teams",
          params,
        );

        if (result.success) {
          this.teams = result.teams || [];

          coworkLogger.info(`加载团队列表成功: ${this.teams.length} 个团队`);
        }

        return result;
      } catch (error) {
        coworkLogger.error("[CoworkStore] 加载团队列表失败:", error);
        this.error = error.message;
        throw error;
      } finally {
        this.loading.teams = false;
      }
    },

    /**
     * 加载团队详情
     */
    async loadTeamDetail(teamId) {
      this.loading.teamDetail = true;
      this.error = null;

      try {
        const result = await window.electronAPI.invoke(
          "cowork:get-team-status",
          { teamId },
        );

        if (result.success) {
          this.currentTeam = result.status;

          // 更新团队列表中的数据
          const index = this.teams.findIndex((t) => t.id === teamId);
          if (index !== -1) {
            this.teams[index] = { ...this.teams[index], ...result.status };
          }

          coworkLogger.info(`加载团队详情成功: ${teamId}`);
        }

        return result;
      } catch (error) {
        coworkLogger.error("[CoworkStore] 加载团队详情失败:", error);
        this.error = error.message;
        throw error;
      } finally {
        this.loading.teamDetail = false;
      }
    },

    /**
     * 更新团队配置
     */
    async updateTeamConfig(teamId, config) {
      this.error = null;

      try {
        const result = await window.electronAPI.invoke(
          "cowork:update-team-config",
          { teamId, config },
        );

        if (result.success) {
          // 更新当前团队
          if (this.currentTeam && this.currentTeam.id === teamId) {
            this.currentTeam.config = { ...this.currentTeam.config, ...config };
          }

          // 更新团队列表
          const index = this.teams.findIndex((t) => t.id === teamId);
          if (index !== -1) {
            this.teams[index].config = { ...this.teams[index].config, ...config };
          }

          coworkLogger.info(`更新团队配置成功: ${teamId}`, config);
        }

        return result;
      } catch (error) {
        coworkLogger.error("[CoworkStore] 更新团队配置失败:", error);
        this.error = error.message;
        throw error;
      }
    },

    /**
     * 销毁团队
     */
    async destroyTeam(teamId, reason = "") {
      this.error = null;

      try {
        const result = await window.electronAPI.invoke("cowork:destroy-team", {
          teamId,
          reason,
        });

        if (result.success) {
          // 从列表中移除
          const index = this.teams.findIndex((t) => t.id === teamId);
          if (index !== -1) {
            this.teams.splice(index, 1);
          }

          // 清除当前团队
          if (this.currentTeam && this.currentTeam.id === teamId) {
            this.currentTeam = null;
          }

          // 更新统计信息
          await this.loadStats();

          coworkLogger.info(`销毁团队成功: ${teamId}`, reason);
        }

        return result;
      } catch (error) {
        coworkLogger.error("[CoworkStore] 销毁团队失败:", error);
        this.error = error.message;
        throw error;
      }
    },

    // ==========================================
    // 代理管理 Actions
    // ==========================================

    /**
     * 请求加入团队
     */
    async requestJoinTeam(teamId, agentId, agentInfo = {}) {
      this.error = null;

      try {
        const result = await window.electronAPI.invoke("cowork:request-join", {
          teamId,
          agentId,
          agentInfo,
        });

        if (result.success) {
          // 刷新团队详情
          await this.loadTeamDetail(teamId);

          coworkLogger.info(`代理加入团队成功: ${agentId} -> ${teamId}`);
        }

        return result;
      } catch (error) {
        coworkLogger.error("[CoworkStore] 代理加入团队失败:", error);
        this.error = error.message;
        throw error;
      }
    },

    /**
     * 列出团队成员
     */
    async listTeamMembers(teamId) {
      this.loading.agents = true;
      this.error = null;

      try {
        const result = await window.electronAPI.invoke(
          "cowork:list-team-members",
          { teamId },
        );

        if (result.success) {
          this.currentTeamMembers = result.members || [];

          coworkLogger.info(
            `列出团队成员成功: ${teamId}, ${result.members.length} 个成员`,
          );
        }

        return result;
      } catch (error) {
        coworkLogger.error("[CoworkStore] 列出团队成员失败:", error);
        this.error = error.message;
        throw error;
      } finally {
        this.loading.agents = false;
      }
    },

    /**
     * 终止代理
     */
    async terminateAgent(teamId, agentId, reason = "") {
      this.error = null;

      try {
        const result = await window.electronAPI.invoke(
          "cowork:terminate-agent",
          { teamId, agentId, reason },
        );

        if (result.success) {
          // 刷新团队成员列表
          await this.listTeamMembers(teamId);

          coworkLogger.info(`终止代理成功: ${agentId} @ ${teamId}`, reason);
        }

        return result;
      } catch (error) {
        coworkLogger.error("[CoworkStore] 终止代理失败:", error);
        this.error = error.message;
        throw error;
      }
    },

    // ==========================================
    // 任务管理 Actions
    // ==========================================

    /**
     * 分配任务
     */
    async assignTask(teamId, agentId, task) {
      this.loading.tasks = true;
      this.error = null;

      try {
        const result = await window.electronAPI.invoke("cowork:assign-task", {
          teamId,
          agentId,
          task,
        });

        if (result.success) {
          // 添加到任务列表
          if (result.task) {
            this.tasks.unshift(result.task);
          }

          // 更新统计信息
          await this.loadStats();

          coworkLogger.info(`分配任务成功: ${task.name} -> ${agentId}`);
        }

        return result;
      } catch (error) {
        coworkLogger.error("[CoworkStore] 分配任务失败:", error);
        this.error = error.message;
        throw error;
      } finally {
        this.loading.tasks = false;
      }
    },

    /**
     * 加载所有活跃任务
     */
    async loadActiveTasks() {
      this.loading.tasks = true;
      this.error = null;

      try {
        const result = await window.electronAPI.invoke(
          "cowork:task-get-all-active",
          {},
        );

        if (result.success) {
          this.tasks = result.tasks || [];

          coworkLogger.info(`加载活跃任务成功: ${this.tasks.length} 个任务`);
        }

        return result;
      } catch (error) {
        coworkLogger.error("[CoworkStore] 加载活跃任务失败:", error);
        this.error = error.message;
        throw error;
      } finally {
        this.loading.tasks = false;
      }
    },

    /**
     * 加载任务详情
     */
    async loadTaskDetail(taskId) {
      this.loading.taskDetail = true;
      this.error = null;

      try {
        const result = await window.electronAPI.invoke(
          "cowork:task-get-status",
          { taskId },
        );

        if (result.success) {
          this.currentTask = result.status;

          // 更新任务列表中的数据
          const index = this.tasks.findIndex((t) => t.id === taskId);
          if (index !== -1) {
            this.tasks[index] = { ...this.tasks[index], ...result.status };
          }

          coworkLogger.info(`加载任务详情成功: ${taskId}`);
        }

        return result;
      } catch (error) {
        coworkLogger.error("[CoworkStore] 加载任务详情失败:", error);
        this.error = error.message;
        throw error;
      } finally {
        this.loading.taskDetail = false;
      }
    },

    /**
     * 暂停任务
     */
    async pauseTask(taskId) {
      this.error = null;

      try {
        const result = await window.electronAPI.invoke("cowork:task-pause", {
          taskId,
        });

        if (result.success) {
          // 更新任务状态
          await this.loadTaskDetail(taskId);

          coworkLogger.info(`暂停任务成功: ${taskId}`);
        }

        return result;
      } catch (error) {
        coworkLogger.error("[CoworkStore] 暂停任务失败:", error);
        this.error = error.message;
        throw error;
      }
    },

    /**
     * 恢复任务
     */
    async resumeTask(taskId) {
      this.error = null;

      try {
        const result = await window.electronAPI.invoke("cowork:task-resume", {
          taskId,
        });

        if (result.success) {
          // 更新任务状态
          await this.loadTaskDetail(taskId);

          coworkLogger.info(`恢复任务成功: ${taskId}`);
        }

        return result;
      } catch (error) {
        coworkLogger.error("[CoworkStore] 恢复任务失败:", error);
        this.error = error.message;
        throw error;
      }
    },

    /**
     * 取消任务
     */
    async cancelTask(taskId, reason = "") {
      this.error = null;

      try {
        const result = await window.electronAPI.invoke("cowork:task-cancel", {
          taskId,
          reason,
        });

        if (result.success) {
          // 更新任务状态
          await this.loadTaskDetail(taskId);

          coworkLogger.info(`取消任务成功: ${taskId}`, reason);
        }

        return result;
      } catch (error) {
        coworkLogger.error("[CoworkStore] 取消任务失败:", error);
        this.error = error.message;
        throw error;
      }
    },

    // ==========================================
    // 技能管理 Actions
    // ==========================================

    /**
     * 加载已注册技能列表
     */
    async loadSkills() {
      this.loading.skills = true;
      this.error = null;

      try {
        const result = await window.electronAPI.invoke(
          "cowork:skill-list-all",
          {},
        );

        if (result.success) {
          this.skills = result.skills || [];

          coworkLogger.info(`加载技能列表成功: ${this.skills.length} 个技能`);
        }

        return result;
      } catch (error) {
        coworkLogger.error("[CoworkStore] 加载技能列表失败:", error);
        this.error = error.message;
        throw error;
      } finally {
        this.loading.skills = false;
      }
    },

    /**
     * 测试技能匹配
     */
    async testSkillMatch(task) {
      this.error = null;

      try {
        const result = await window.electronAPI.invoke(
          "cowork:skill-find-for-task",
          { task },
        );

        if (result.success) {
          coworkLogger.info(`技能匹配测试完成:`, result.skills);
        }

        return result;
      } catch (error) {
        coworkLogger.error("[CoworkStore] 技能匹配测试失败:", error);
        this.error = error.message;
        throw error;
      }
    },

    /**
     * 自动执行任务（使用最佳技能）
     */
    async autoExecuteTask(task, context = {}) {
      this.error = null;

      try {
        const result = await window.electronAPI.invoke(
          "cowork:skill-auto-execute",
          { task, context },
        );

        if (result.success) {
          // 记录执行历史
          this.skillExecutionHistory.unshift({
            task,
            result: result.result,
            skill: result.skill,
            timestamp: Date.now(),
          });

          // 限制历史记录数量
          if (this.skillExecutionHistory.length > 50) {
            this.skillExecutionHistory = this.skillExecutionHistory.slice(0, 50);
          }

          coworkLogger.info(
            `自动执行任务成功: ${task.name} (使用技能: ${result.skill})`,
          );
        }

        return result;
      } catch (error) {
        coworkLogger.error("[CoworkStore] 自动执行任务失败:", error);
        this.error = error.message;
        throw error;
      }
    },

    // ==========================================
    // 统计信息 Actions
    // ==========================================

    /**
     * 加载全局统计信息
     */
    async loadStats() {
      this.loading.stats = true;
      this.error = null;

      try {
        const result = await window.electronAPI.invoke("cowork:get-stats", {});

        if (result.success) {
          this.globalStats = result.stats || this.globalStats;

          coworkLogger.info(`加载统计信息成功:`, this.globalStats);
        }

        return result;
      } catch (error) {
        coworkLogger.error("[CoworkStore] 加载统计信息失败:", error);
        this.error = error.message;
        throw error;
      } finally {
        this.loading.stats = false;
      }
    },

    // ==========================================
    // 事件监听 Actions
    // ==========================================

    /**
     * 初始化事件监听器
     */
    initEventListeners() {
      if (!window.electronAPI || !window.electronAPI.on) {
        coworkLogger.warn("electronAPI.on 不可用，跳过事件监听");
        return;
      }

      // 监听团队更新事件
      const teamUpdatedListener = (event, data) => {
        const { team } = data;
        const index = this.teams.findIndex((t) => t.id === team.id);
        if (index !== -1) {
          // 更新现有团队
          this.teams[index] = { ...this.teams[index], ...team };
        } else {
          // 添加新团队
          this.teams.unshift(team);
        }

        // 更新当前团队
        if (this.currentTeam && this.currentTeam.id === team.id) {
          this.currentTeam = { ...this.currentTeam, ...team };
        }

        coworkLogger.info("[Event] 团队更新:", team);
      };
      window.electronAPI.on("cowork:team-updated", teamUpdatedListener);
      this.eventListeners.push({
        event: "cowork:team-updated",
        listener: teamUpdatedListener,
      });

      // 监听任务进度更新事件
      const taskProgressListener = (event, data) => {
        const { taskId, progress, message } = data;
        const index = this.tasks.findIndex((t) => t.id === taskId);
        if (index !== -1) {
          this.tasks[index].progress = progress;
          this.tasks[index].progressMessage = message;
        }

        // 更新当前任务
        if (this.currentTask && this.currentTask.id === taskId) {
          this.currentTask.progress = progress;
          this.currentTask.progressMessage = message;
        }

        coworkLogger.info(
          `[Event] 任务进度更新: ${taskId} - ${progress}% - ${message}`,
        );
      };
      window.electronAPI.on("cowork:task-progress", taskProgressListener);
      this.eventListeners.push({
        event: "cowork:task-progress",
        listener: taskProgressListener,
      });

      // 监听代理加入事件
      const agentJoinedListener = (event, data) => {
        const { teamId, agent } = data;

        // 如果是当前团队，刷新成员列表
        if (this.currentTeam && this.currentTeam.id === teamId) {
          this.listTeamMembers(teamId);
        }

        coworkLogger.info(`[Event] 代理加入: ${agent.id} -> ${teamId}`);
      };
      window.electronAPI.on("cowork:agent-joined", agentJoinedListener);
      this.eventListeners.push({
        event: "cowork:agent-joined",
        listener: agentJoinedListener,
      });

      // 监听任务完成事件
      const taskCompletedListener = (event, data) => {
        const { taskId, result } = data;
        const index = this.tasks.findIndex((t) => t.id === taskId);
        if (index !== -1) {
          this.tasks[index].status = "completed";
          this.tasks[index].result = result;
          this.tasks[index].completedAt = Date.now();
        }

        // 更新当前任务
        if (this.currentTask && this.currentTask.id === taskId) {
          this.currentTask.status = "completed";
          this.currentTask.result = result;
          this.currentTask.completedAt = Date.now();
        }

        // 刷新统计信息
        this.loadStats();

        coworkLogger.info(`[Event] 任务完成: ${taskId}`);
      };
      window.electronAPI.on("cowork:task-completed", taskCompletedListener);
      this.eventListeners.push({
        event: "cowork:task-completed",
        listener: taskCompletedListener,
      });

      coworkLogger.info("事件监听器初始化完成");
    },

    /**
     * 清理事件监听器
     */
    cleanupEventListeners() {
      if (!window.electronAPI || !window.electronAPI.off) {
        return;
      }

      this.eventListeners.forEach(({ event, listener }) => {
        window.electronAPI.off(event, listener);
      });

      this.eventListeners = [];

      coworkLogger.info("事件监听器清理完成");
    },

    // ==========================================
    // 选择管理 Actions
    // ==========================================

    /**
     * 选择/取消选择团队
     */
    toggleTeamSelection(teamId) {
      const index = this.selectedTeamIds.indexOf(teamId);
      if (index !== -1) {
        this.selectedTeamIds.splice(index, 1);
      } else {
        this.selectedTeamIds.push(teamId);
      }
    },

    /**
     * 清空团队选择
     */
    clearTeamSelection() {
      this.selectedTeamIds = [];
    },

    /**
     * 选择/取消选择任务
     */
    toggleTaskSelection(taskId) {
      const index = this.selectedTaskIds.indexOf(taskId);
      if (index !== -1) {
        this.selectedTaskIds.splice(index, 1);
      } else {
        this.selectedTaskIds.push(taskId);
      }
    },

    /**
     * 清空任务选择
     */
    clearTaskSelection() {
      this.selectedTaskIds = [];
    },

    // ==========================================
    // 筛选管理 Actions
    // ==========================================

    /**
     * 设置团队筛选条件
     */
    setTeamFilters(filters) {
      this.teamFilters = { ...this.teamFilters, ...filters };
    },

    /**
     * 清空团队筛选条件
     */
    clearTeamFilters() {
      this.teamFilters = {
        searchQuery: "",
        status: null,
        sortBy: "created_at",
        sortOrder: "desc",
      };
    },

    /**
     * 设置任务筛选条件
     */
    setTaskFilters(filters) {
      this.taskFilters = { ...this.taskFilters, ...filters };
    },

    /**
     * 清空任务筛选条件
     */
    clearTaskFilters() {
      this.taskFilters = {
        searchQuery: "",
        status: null,
        teamId: null,
        sortBy: "created_at",
        sortOrder: "desc",
      };
    },

    // ==========================================
    // 重置 Store
    // ==========================================

    /**
     * 重置所有状态（用于登出或切换用户）
     */
    reset() {
      this.cleanupEventListeners();

      this.$reset(); // Pinia 内置的重置方法

      coworkLogger.info("Store 已重置");
    },
  },
});
