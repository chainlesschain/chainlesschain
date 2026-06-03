import { defineStore } from 'pinia';

export interface Evidence {
  id: string;
  criteria: string;
  evidence_type: string;
  title: string;
  description: string;
  data: string;
  status: string;
  period_start: number;
  period_end: number;
  created_at: number;
}

export interface ComplianceReport {
  title: string;
  generatedAt: number;
  complianceScore: number;
  totalEvidence: number;
  summary: { totalCriteria: number; coveredCriteria: number; missingCriteria: number };
  recommendations: Array<{ criteria: string; priority: string; recommendation: string }>;
}

export interface ClassificationResult {
  category: string;
  detections: Array<{ type: string; category: string; count: number; severity: string }>;
  severity: string;
  confidence: number;
}

export interface ClassificationPolicy {
  id: string;
  name: string;
  level: string;
  triggers: string[];
  description: string;
}

const electronAPI = (window as any).electronAPI || (window as any).electron?.ipcRenderer;
function invoke(channel: string, ...args: any[]) {
  if (electronAPI?.invoke) return electronAPI.invoke(channel, ...args);
  return Promise.reject(new Error('IPC not available'));
}

export const useComplianceStore = defineStore('compliance', {
  state: () => ({
    evidence: [] as Evidence[],
    report: null as ComplianceReport | null,
    classificationResult: null as ClassificationResult | null,
    classificationHistory: [] as any[],
    policies: [] as ClassificationPolicy[],
    loading: false,
    error: null as string | null,
  }),

  getters: {
    complianceScore: (state): number => state.report?.complianceScore || 0,
    evidenceCount: (state): number => state.evidence.length,
    hasCriticalFindings: (state): boolean => {
      return state.classificationResult?.severity === 'critical';
    },
  },

  actions: {
    async collectAuditEvidence(options?: { periodStart?: number; periodEnd?: number }) {
      this.loading = true;
      this.error = null;
      try {
        const result = await invoke('compliance:collect-audit-evidence', options || {});
        if (result?.success && result.evidence) {
          this.evidence.push(result.evidence);
        }
        return result;
      } catch (err: any) {
        this.error = err.message;
        throw err;
      } finally {
        this.loading = false;
      }
    },

    async collectAccessEvidence() {
      this.loading = true;
      try {
        const result = await invoke('compliance:collect-access-evidence');
        if (result?.success && result.evidence) {
          this.evidence.push(result.evidence);
        }
        return result;
      } catch (err: any) {
        this.error = err.message;
        throw err;
      } finally {
        this.loading = false;
      }
    },

    async collectConfigEvidence() {
      this.loading = true;
      try {
        const result = await invoke('compliance:collect-config-evidence');
        if (result?.success && result.evidence) {
          this.evidence.push(result.evidence);
        }
        return result;
      } catch (err: any) {
        this.error = err.message;
        throw err;
      } finally {
        this.loading = false;
      }
    },

    async generateReport(options?: { periodStart?: number; periodEnd?: number }) {
      this.loading = true;
      this.error = null;
      try {
        const result = await invoke('compliance:generate-report', options || {});
        if (result?.success) {
          this.report = result.report;
        }
        return result;
      } catch (err: any) {
        this.error = err.message;
        throw err;
      } finally {
        this.loading = false;
      }
    },

    async classifyContent(content: string) {
      this.loading = true;
      this.error = null;
      try {
        const result = await invoke('compliance:classify-content', { content });
        if (result?.success) {
          this.classificationResult = result.result;
        }
        return result;
      } catch (err: any) {
        this.error = err.message;
        throw err;
      } finally {
        this.loading = false;
      }
    },

    async fetchClassificationHistory(options?: { limit?: number; category?: string }) {
      this.loading = true;
      try {
        const result = await invoke('compliance:get-classifications', options || {});
        if (result?.success) {
          this.classificationHistory = result.records || [];
        }
        return result;
      } catch (err: any) {
        this.error = err.message;
        return { success: false };
      } finally {
        this.loading = false;
      }
    },

    async fetchPolicies() {
      try {
        const result = await invoke('compliance:get-policies');
        if (result?.success) {
          this.policies = result.policies || [];
        }
        return result;
      } catch (err: any) {
        this.error = err.message;
        return { success: false };
      }
    },

    async getEvidenceByCriteria(criteria: string) {
      this.loading = true;
      try {
        const result = await invoke('compliance:get-evidence', { criteria });
        if (result?.success) {
          this.evidence = result.evidence || [];
        }
        return result;
      } catch (err: any) {
        this.error = err.message;
        return { success: false };
      } finally {
        this.loading = false;
      }
    },
  },
});
