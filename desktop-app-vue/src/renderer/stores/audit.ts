/**
 * Audit Store - Pinia 状态管理
 * 管理企业审计日志、合规策略和数据主体请求（DSR）
 *
 * @module audit-store
 * @version 1.0.0
 */

import { defineStore } from 'pinia';

// ==================== 类型定义 ====================

/**
 * 审计日志条目
 */
export interface AuditLogEntry {
  id: string;
  timestamp: number;
  event_type: string;
  actor_did: string;
  operation: string;
  resource_type?: string;
  resource_id?: string;
  details?: string;
  risk_level: 'low' | 'medium' | 'high' | 'critical';
  compliance_tags?: string;
  outcome: 'success' | 'failure' | 'blocked';
  retention_until?: number;
  session_id?: string;
}

/**
 * 审计日志筛选条件
 */
export interface AuditFilters {
  eventType?: string;
  actorDid?: string;
  riskLevel?: string;
  startTime?: number;
  endTime?: number;
  page?: number;
  pageSize?: number;
}

/**
 * 合规策略
 */
export interface CompliancePolicy {
  id: string;
  policy_type: string;
  framework: string;
  rules: string;
  enabled: boolean;
  created_at: number;
  updated_at?: number;
}

/**
 * 合规检查结果
 */
export interface ComplianceCheckResult {
  framework: string;
  score: number;
  passed: number;
  failed: number;
  checks: Array<{ name: string; passed: boolean; details: string }>;
  recommendations: string[];
}

/**
 * 数据主体请求（DSR）
 */
export interface DataSubjectRequest {
  id: string;
  request_type: 'access' | 'deletion' | 'rectification' | 'portability';
  subject_did: string;
  status: 'pending' | 'in_progress' | 'completed' | 'rejected';
  request_data?: string;
  response_data?: string;
  created_at: number;
  completed_at?: number;
  deadline: number;
}

/**
 * 审计统计信息
 */
export interface AuditStatistics {
  totalLogs: number;
  byEventType: Record<string, number>;
  byRiskLevel: Record<string, number>;
  byOutcome: Record<string, number>;
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
 * Audit Store 状态
 */
interface AuditState {
  // 审计日志
  logs: AuditLogEntry[];
  totalLogs: number;
  currentPage: number;
  pageSize: number;
  filters: AuditFilters;
  statistics: AuditStatistics | null;

  // 合规
  policies: CompliancePolicy[];
  complianceResult: ComplianceCheckResult | null;
  complianceReport: any | null;

  // 数据主体请求
  dsrRequests: DataSubjectRequest[];

  // UI 状态
  loading: boolean;
  error: string | null;
}

// ==================== Store ====================

export const useAuditStore = defineStore('audit', {
  state: (): AuditState => ({
    // ==========================================
    // 审计日志
    // ==========================================

    // 审计日志列表
    logs: [],

    // 日志总数
    totalLogs: 0,

    // 当前页码
    currentPage: 1,

    // 每页条数
    pageSize: 20,

    // 筛选条件
    filters: {},

    // 统计信息
    statistics: null,

    // ==========================================
    // 合规管理
    // ==========================================

    // 合规策略列表
    policies: [],

    // 合规检查结果
    complianceResult: null,

    // 合规报告
    complianceReport: null,

    // ==========================================
    // 数据主体请求
    // ==========================================

    // DSR 请求列表
    dsrRequests: [],

    // ==========================================
    // UI 状态
    // ==========================================

    // 加载状态
    loading: false,

    // 错误信息
    error: null,
  }),

  getters: {
    /**
     * 高风险日志
     */
    highRiskLogs(): AuditLogEntry[] {
      return this.logs.filter(
        (log) => log.risk_level === 'high' || log.risk_level === 'critical'
      );
    },

    /**
     * 失败操作日志
     */
    failedLogs(): AuditLogEntry[] {
      return this.logs.filter((log) => log.outcome === 'failure' || log.outcome === 'blocked');
    },

    /**
     * 启用的合规策略
     */
    enabledPolicies(): CompliancePolicy[] {
      return this.policies.filter((p) => p.enabled);
    },

    /**
     * 待处理的 DSR 请求
     */
    pendingDSRRequests(): DataSubjectRequest[] {
      return this.dsrRequests.filter(
        (r) => r.status === 'pending' || r.status === 'in_progress'
      );
    },

    /**
     * 已逾期的 DSR 请求
     */
    overdueDSRRequests(): DataSubjectRequest[] {
      const now = Date.now();
      return this.dsrRequests.filter(
        (r) => r.deadline < now && r.status !== 'completed' && r.status !== 'rejected'
      );
    },

    /**
     * 合规分数
     */
    complianceScore(): number | null {
      return this.complianceResult?.score ?? null;
    },

    /**
     * 总页数
     */
    totalPages(): number {
      return Math.ceil(this.totalLogs / this.pageSize) || 1;
    },

    /**
     * 是否有更多页
     */
    hasMorePages(): boolean {
      return this.currentPage < this.totalPages;
    },
  },

  actions: {
    // ==========================================
    // 审计日志操作
    // ==========================================

    /**
     * 查询审计日志
     */
    async fetchLogs(filters?: AuditFilters): Promise<IPCResponse> {
      this.loading = true;
      this.error = null;

      try {
        const queryFilters = filters || this.filters;
        const result = await (window as any).electronAPI.invoke('audit:query-logs', {
          ...queryFilters,
          page: queryFilters.page || this.currentPage,
          pageSize: queryFilters.pageSize || this.pageSize,
        });

        if (result.success) {
          this.logs = result.logs || [];
          this.totalLogs = result.total || 0;
          if (queryFilters.page) {
            this.currentPage = queryFilters.page;
          }
        }

        return result;
      } catch (error) {
        console.error('[AuditStore] 查询审计日志失败:', error);
        this.error = (error as Error).message;
        throw error;
      } finally {
        this.loading = false;
      }
    },

    /**
     * 获取审计日志详情
     */
    async getLogDetail(logId: string): Promise<IPCResponse> {
      this.loading = true;
      this.error = null;

      try {
        const result = await (window as any).electronAPI.invoke('audit:get-log-detail', {
          logId,
        });

        return result;
      } catch (error) {
        console.error('[AuditStore] 获取审计日志详情失败:', error);
        this.error = (error as Error).message;
        throw error;
      } finally {
        this.loading = false;
      }
    },

    /**
     * 导出审计日志
     */
    async exportLogs(filters?: AuditFilters): Promise<IPCResponse> {
      this.loading = true;
      this.error = null;

      try {
        const result = await (window as any).electronAPI.invoke('audit:export-logs', {
          ...filters,
        });

        return result;
      } catch (error) {
        console.error('[AuditStore] 导出审计日志失败:', error);
        this.error = (error as Error).message;
        throw error;
      } finally {
        this.loading = false;
      }
    },

    /**
     * 获取审计统计信息
     */
    async fetchStatistics(filters?: { startTime?: number; endTime?: number }): Promise<IPCResponse> {
      this.loading = true;
      this.error = null;

      try {
        const result = await (window as any).electronAPI.invoke('audit:get-statistics', {
          ...filters,
        });

        if (result.success) {
          this.statistics = result.statistics || null;
        }

        return result;
      } catch (error) {
        console.error('[AuditStore] 获取审计统计失败:', error);
        this.error = (error as Error).message;
        throw error;
      } finally {
        this.loading = false;
      }
    },

    // ==========================================
    // 合规策略操作
    // ==========================================

    /**
     * 获取合规策略列表
     */
    async fetchPolicies(): Promise<IPCResponse> {
      this.loading = true;
      this.error = null;

      try {
        const result = await (window as any).electronAPI.invoke('compliance:get-policies');

        if (result.success) {
          this.policies = result.policies || [];
        }

        return result;
      } catch (error) {
        console.error('[AuditStore] 获取合规策略失败:', error);
        this.error = (error as Error).message;
        throw error;
      } finally {
        this.loading = false;
      }
    },

    /**
     * 创建合规策略
     */
    async createPolicy(policyData: Omit<CompliancePolicy, 'id' | 'created_at' | 'updated_at'>): Promise<IPCResponse> {
      this.loading = true;
      this.error = null;

      try {
        const result = await (window as any).electronAPI.invoke(
          'compliance:create-policy',
          policyData
        );

        if (result.success) {
          // 刷新策略列表
          await this.fetchPolicies();
        }

        return result;
      } catch (error) {
        console.error('[AuditStore] 创建合规策略失败:', error);
        this.error = (error as Error).message;
        throw error;
      } finally {
        this.loading = false;
      }
    },

    /**
     * 更新合规策略
     */
    async updatePolicy(policyId: string, updates: Partial<CompliancePolicy>): Promise<IPCResponse> {
      this.loading = true;
      this.error = null;

      try {
        const result = await (window as any).electronAPI.invoke('compliance:update-policy', {
          policyId,
          updates,
        });

        if (result.success) {
          const index = this.policies.findIndex((p) => p.id === policyId);
          if (index !== -1) {
            this.policies[index] = { ...this.policies[index], ...updates, updated_at: Date.now() };
          }
        }

        return result;
      } catch (error) {
        console.error('[AuditStore] 更新合规策略失败:', error);
        this.error = (error as Error).message;
        throw error;
      } finally {
        this.loading = false;
      }
    },

    /**
     * 删除合规策略
     */
    async deletePolicy(policyId: string): Promise<IPCResponse> {
      this.loading = true;
      this.error = null;

      try {
        const result = await (window as any).electronAPI.invoke('compliance:delete-policy', {
          policyId,
        });

        if (result.success) {
          this.policies = this.policies.filter((p) => p.id !== policyId);
        }

        return result;
      } catch (error) {
        console.error('[AuditStore] 删除合规策略失败:', error);
        this.error = (error as Error).message;
        throw error;
      } finally {
        this.loading = false;
      }
    },

    /**
     * 执行合规检查
     */
    async checkCompliance(framework: string): Promise<IPCResponse> {
      this.loading = true;
      this.error = null;

      try {
        const result = await (window as any).electronAPI.invoke('compliance:check-compliance', {
          framework,
        });

        if (result.success) {
          this.complianceResult = result.result || null;
        }

        return result;
      } catch (error) {
        console.error('[AuditStore] 执行合规检查失败:', error);
        this.error = (error as Error).message;
        throw error;
      } finally {
        this.loading = false;
      }
    },

    /**
     * 生成合规报告
     */
    async generateReport(framework: string, options?: Record<string, any>): Promise<IPCResponse> {
      this.loading = true;
      this.error = null;

      try {
        const result = await (window as any).electronAPI.invoke('compliance:generate-report', {
          framework,
          ...options,
        });

        if (result.success) {
          this.complianceReport = result.report || null;
        }

        return result;
      } catch (error) {
        console.error('[AuditStore] 生成合规报告失败:', error);
        this.error = (error as Error).message;
        throw error;
      } finally {
        this.loading = false;
      }
    },

    // ==========================================
    // 数据主体请求（DSR）操作
    // ==========================================

    /**
     * 获取 DSR 请求列表
     */
    async fetchDSRRequests(filters?: { status?: string; subjectDid?: string }): Promise<IPCResponse> {
      this.loading = true;
      this.error = null;

      try {
        const result = await (window as any).electronAPI.invoke('dsr:list-requests', {
          ...filters,
        });

        if (result.success) {
          this.dsrRequests = result.requests || [];
        }

        return result;
      } catch (error) {
        console.error('[AuditStore] 获取 DSR 请求列表失败:', error);
        this.error = (error as Error).message;
        throw error;
      } finally {
        this.loading = false;
      }
    },

    /**
     * 创建 DSR 请求
     */
    async createDSR(requestData: {
      request_type: DataSubjectRequest['request_type'];
      subject_did: string;
      request_data?: string;
      deadline: number;
    }): Promise<IPCResponse> {
      this.loading = true;
      this.error = null;

      try {
        const result = await (window as any).electronAPI.invoke(
          'dsr:create-request',
          requestData
        );

        if (result.success) {
          // 刷新请求列表
          await this.fetchDSRRequests();
        }

        return result;
      } catch (error) {
        console.error('[AuditStore] 创建 DSR 请求失败:', error);
        this.error = (error as Error).message;
        throw error;
      } finally {
        this.loading = false;
      }
    },

    /**
     * 获取 DSR 请求详情
     */
    async getDSRDetail(requestId: string): Promise<IPCResponse> {
      this.loading = true;
      this.error = null;

      try {
        const result = await (window as any).electronAPI.invoke('dsr:get-request-detail', {
          requestId,
        });

        return result;
      } catch (error) {
        console.error('[AuditStore] 获取 DSR 请求详情失败:', error);
        this.error = (error as Error).message;
        throw error;
      } finally {
        this.loading = false;
      }
    },

    /**
     * 处理 DSR 请求
     */
    async processDSR(requestId: string, action: string, data?: Record<string, any>): Promise<IPCResponse> {
      this.loading = true;
      this.error = null;

      try {
        const result = await (window as any).electronAPI.invoke('dsr:process-request', {
          requestId,
          action,
          ...data,
        });

        if (result.success) {
          const index = this.dsrRequests.findIndex((r) => r.id === requestId);
          if (index !== -1) {
            this.dsrRequests[index] = {
              ...this.dsrRequests[index],
              status: 'in_progress',
            };
          }
        }

        return result;
      } catch (error) {
        console.error('[AuditStore] 处理 DSR 请求失败:', error);
        this.error = (error as Error).message;
        throw error;
      } finally {
        this.loading = false;
      }
    },

    /**
     * 审批 DSR 请求
     */
    async approveDSR(requestId: string, approverDid: string, comment?: string): Promise<IPCResponse> {
      this.loading = true;
      this.error = null;

      try {
        const result = await (window as any).electronAPI.invoke('dsr:approve-request', {
          requestId,
          approverDid,
          comment,
        });

        if (result.success) {
          const index = this.dsrRequests.findIndex((r) => r.id === requestId);
          if (index !== -1) {
            this.dsrRequests[index] = {
              ...this.dsrRequests[index],
              status: 'completed',
              completed_at: Date.now(),
            };
          }
        }

        return result;
      } catch (error) {
        console.error('[AuditStore] 审批 DSR 请求失败:', error);
        this.error = (error as Error).message;
        throw error;
      } finally {
        this.loading = false;
      }
    },

    /**
     * 导出数据主体数据
     */
    async exportSubjectData(subjectDid: string, format?: string): Promise<IPCResponse> {
      this.loading = true;
      this.error = null;

      try {
        const result = await (window as any).electronAPI.invoke('dsr:export-subject-data', {
          subjectDid,
          format,
        });

        return result;
      } catch (error) {
        console.error('[AuditStore] 导出数据主体数据失败:', error);
        this.error = (error as Error).message;
        throw error;
      } finally {
        this.loading = false;
      }
    },

    // ==========================================
    // 数据保留操作
    // ==========================================

    /**
     * 应用数据保留策略
     */
    async applyRetention(policyId?: string): Promise<IPCResponse> {
      this.loading = true;
      this.error = null;

      try {
        const result = await (window as any).electronAPI.invoke('retention:apply-policy', {
          policyId,
        });

        return result;
      } catch (error) {
        console.error('[AuditStore] 应用数据保留策略失败:', error);
        this.error = (error as Error).message;
        throw error;
      } finally {
        this.loading = false;
      }
    },

    /**
     * 预览数据删除
     */
    async previewDeletion(policyId?: string): Promise<IPCResponse> {
      this.loading = true;
      this.error = null;

      try {
        const result = await (window as any).electronAPI.invoke('retention:preview-deletion', {
          policyId,
        });

        return result;
      } catch (error) {
        console.error('[AuditStore] 预览数据删除失败:', error);
        this.error = (error as Error).message;
        throw error;
      } finally {
        this.loading = false;
      }
    },

    // ==========================================
    // 工具方法
    // ==========================================

    /**
     * 更新筛选条件并重新查询
     */
    async updateFilters(newFilters: Partial<AuditFilters>): Promise<void> {
      this.filters = { ...this.filters, ...newFilters };
      this.currentPage = 1;
      await this.fetchLogs();
    },

    /**
     * 清除筛选条件
     */
    async clearFilters(): Promise<void> {
      this.filters = {};
      this.currentPage = 1;
      await this.fetchLogs();
    },

    /**
     * 翻页
     */
    async goToPage(page: number): Promise<void> {
      this.currentPage = page;
      await this.fetchLogs({ ...this.filters, page });
    },

    /**
     * 清除错误
     */
    clearError(): void {
      this.error = null;
    },

    /**
     * 重置所有状态
     */
    reset(): void {
      this.$reset();
    },
  },
});
