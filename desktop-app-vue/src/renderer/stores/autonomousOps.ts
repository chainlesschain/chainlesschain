/**
 * Autonomous Ops Store - Pinia 状态管理
 * 管理自主运维：事故管理、Playbook、告警、基线、事故报告
 *
 * @module autonomous-ops-store
 * @version 1.1.0
 */

import { defineStore } from 'pinia';

// ==================== 类型定义 ====================

export interface Incident {
  id: string;
  title: string;
  description: string;
  priority: 'P0' | 'P1' | 'P2' | 'P3';
  status: 'open' | 'acknowledged' | 'resolving' | 'resolved' | 'closed';
  source: string;
  assignee?: string;
  rootCause?: string;
  resolution?: string;
  createdAt: string;
  acknowledgedAt?: string;
  resolvedAt?: string;
  mttr?: number;
}

export interface Playbook {
  id: string;
  name: string;
  description: string;
  triggerConditions: string[];
  steps: PlaybookStep[];
  enabled: boolean;
  successRate: number;
  lastTriggered?: string;
  createdAt: string;
}

export interface PlaybookStep {
  id: string;
  name: string;
  type: 'check' | 'action' | 'notification' | 'rollback';
  config: any;
  timeout?: number;
}

export interface Alert {
  id: string;
  type: string;
  severity: 'critical' | 'warning' | 'info';
  message: string;
  source: string;
  acknowledged: boolean;
  createdAt: string;
}

export interface Baseline {
  cpu: { avg: number; p95: number };
  memory: { avg: number; p95: number };
  responseTime: { avg: number; p95: number };
  errorRate: { avg: number; threshold: number };
  updatedAt: string;
}

export interface Postmortem {
  id: string;
  incidentId: string;
  rootCause: string;
  impact: string;
  timeline: { time: string; event: string }[];
  improvements: string[];
  slaMetrics: { targetMTTR: number; actualMTTR: number; met: boolean };
  createdAt: string;
}

interface AutonomousOpsState {
  incidents: Incident[];
  playbooks: Playbook[];
  alerts: Alert[];
  baseline: Baseline | null;
  postmortems: Postmortem[];
  loading: boolean;
  error: string | null;
}

// ==================== Store ====================

export const useAutonomousOpsStore = defineStore('autonomousOps', {
  state: (): AutonomousOpsState => ({
    incidents: [],
    playbooks: [],
    alerts: [],
    baseline: null,
    postmortems: [],
    loading: false,
    error: null,
  }),

  getters: {
    activeIncidents(): Incident[] {
      return this.incidents.filter(
        (i) => i.status !== 'resolved' && i.status !== 'closed',
      );
    },

    incidentsByPriority(): (priority: string) => Incident[] {
      return (priority: string) =>
        this.incidents.filter((i) => i.priority === priority);
    },

    alertCount(): number {
      return this.alerts.filter((a) => !a.acknowledged).length;
    },
  },

  actions: {
    // ==================== 事故管理 ====================

    async getIncidents() {
      this.loading = true;
      try {
        const result = await (window as any).electronAPI.invoke('ops:get-incidents');
        if (result.success && result.data) {
          this.incidents = result.data;
        }
        return result;
      } catch (error: any) {
        return { success: false, error: error.message };
      } finally {
        this.loading = false;
      }
    },

    async getIncidentDetail(id: string) {
      try {
        const result = await (window as any).electronAPI.invoke('ops:get-incident-detail', id);
        return result;
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },

    async acknowledge(id: string) {
      try {
        const result = await (window as any).electronAPI.invoke('ops:acknowledge', id);
        if (result.success) {
          await this.getIncidents();
        }
        return result;
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },

    async resolve(id: string, resolution: string) {
      try {
        const result = await (window as any).electronAPI.invoke('ops:resolve', id, resolution);
        if (result.success) {
          await this.getIncidents();
        }
        return result;
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },

    // ==================== Playbook ====================

    async getPlaybooks() {
      try {
        const result = await (window as any).electronAPI.invoke('ops:get-playbooks');
        if (result.success && result.data) {
          this.playbooks = result.data;
        }
        return result;
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },

    async createPlaybook(data: any) {
      this.loading = true;
      try {
        const result = await (window as any).electronAPI.invoke('ops:create-playbook', data);
        if (result.success) {
          await this.getPlaybooks();
        }
        return result;
      } catch (error: any) {
        return { success: false, error: error.message };
      } finally {
        this.loading = false;
      }
    },

    async triggerRemediation(incidentId: string, playbookId: string) {
      this.loading = true;
      try {
        const result = await (window as any).electronAPI.invoke(
          'ops:trigger-remediation',
          incidentId,
          playbookId,
        );
        if (result.success) {
          await this.getIncidents();
        }
        return result;
      } catch (error: any) {
        return { success: false, error: error.message };
      } finally {
        this.loading = false;
      }
    },

    async rollback(incidentId: string) {
      this.loading = true;
      try {
        const result = await (window as any).electronAPI.invoke('ops:rollback', incidentId);
        if (result.success) {
          await this.getIncidents();
        }
        return result;
      } catch (error: any) {
        return { success: false, error: error.message };
      } finally {
        this.loading = false;
      }
    },

    // ==================== 告警 ====================

    async getAlerts() {
      try {
        const result = await (window as any).electronAPI.invoke('ops:get-alerts');
        if (result.success && result.data) {
          this.alerts = result.data;
        }
        return result;
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },

    async configureAlerts(config: any) {
      try {
        const result = await (window as any).electronAPI.invoke('ops:configure-alerts', config);
        return result;
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },

    // ==================== 事故报告 ====================

    async generatePostmortem(incidentId: string) {
      this.loading = true;
      try {
        const result = await (window as any).electronAPI.invoke('ops:generate-postmortem', incidentId);
        if (result.success && result.data) {
          this.postmortems.push(result.data);
        }
        return result;
      } catch (error: any) {
        return { success: false, error: error.message };
      } finally {
        this.loading = false;
      }
    },

    // ==================== 基线 ====================

    async getBaseline() {
      try {
        const result = await (window as any).electronAPI.invoke('ops:get-baseline');
        if (result.success && result.data) {
          this.baseline = result.data;
        }
        return result;
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },

    async updateBaseline(data: any) {
      try {
        const result = await (window as any).electronAPI.invoke('ops:update-baseline', data);
        if (result.success && result.data) {
          this.baseline = result.data;
        }
        return result;
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },

    reset() {
      this.incidents = [];
      this.playbooks = [];
      this.alerts = [];
      this.baseline = null;
      this.postmortems = [];
      this.loading = false;
      this.error = null;
    },
  },
});
