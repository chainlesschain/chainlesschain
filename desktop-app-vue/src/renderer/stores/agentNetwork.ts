/**
 * Agent Network Store - Pinia 状态管理
 * 管理去中心化代理联邦网络：DID、代理发现、跨组织任务、信誉系统
 *
 * @module agent-network-store
 * @version 1.1.0
 */

import { defineStore } from 'pinia';

// ==================== 类型定义 ====================

export interface AgentDID {
  did: string;
  publicKey: string;
  skills: string[];
  status: 'active' | 'revoked';
  createdAt: string;
}

export interface DiscoveredAgent {
  did: string;
  name: string;
  skills: string[];
  reputation: number;
  online: boolean;
  lastSeen: string;
  organization?: string;
}

export interface AgentCredential {
  id: string;
  issuer: string;
  subject: string;
  type: string;
  claims: Record<string, any>;
  issuedAt: string;
  expiresAt?: string;
  revoked: boolean;
}

export interface RemoteTask {
  id: string;
  type: string;
  targetAgent: string;
  status: 'pending' | 'routing' | 'running' | 'completed' | 'failed' | 'cancelled';
  input: any;
  output?: any;
  sla?: { maxDuration: number; priority: string };
  createdAt: string;
  updatedAt: string;
}

export interface NetworkStats {
  totalNodes: number;
  onlineNodes: number;
  totalSkills: number;
  activeTasks: number;
  avgReputation: number;
}

export interface ReputationScore {
  did: string;
  score: number;
  taskCount: number;
  successRate: number;
  rank?: number;
}

export interface ReputationHistoryEntry {
  timestamp: string;
  score: number;
  event: string;
  details?: string;
}

interface AgentNetworkState {
  myDID: AgentDID | null;
  allDIDs: AgentDID[];
  discoveredAgents: DiscoveredAgent[];
  remoteTasks: RemoteTask[];
  networkStats: NetworkStats | null;
  reputationScores: ReputationScore[];
  loading: boolean;
  error: string | null;
}

// ==================== Store ====================

export const useAgentNetworkStore = defineStore('agentNetwork', {
  state: (): AgentNetworkState => ({
    myDID: null,
    allDIDs: [],
    discoveredAgents: [],
    remoteTasks: [],
    networkStats: null,
    reputationScores: [],
    loading: false,
    error: null,
  }),

  getters: {
    onlineAgents(): DiscoveredAgent[] {
      return this.discoveredAgents.filter((a) => a.online);
    },

    agentsBySkill(): (skill: string) => DiscoveredAgent[] {
      return (skill: string) =>
        this.discoveredAgents.filter((a) => a.skills.includes(skill));
    },

    myReputation(): number {
      if (!this.myDID) return 0;
      const score = this.reputationScores.find((r) => r.did === this.myDID!.did);
      return score?.score ?? 0;
    },

    tasksByStatus(): (status: string) => RemoteTask[] {
      return (status: string) => this.remoteTasks.filter((t) => t.status === status);
    },
  },

  actions: {
    // ==================== DID 管理 ====================

    async createDID(config?: any) {
      this.loading = true;
      this.error = null;
      try {
        const result = await (window as any).electronAPI.invoke('agent-did:create', config);
        if (result.success && result.data) {
          this.myDID = result.data;
        } else {
          this.error = result.error;
        }
        return result;
      } catch (error: any) {
        this.error = error.message;
        return { success: false, error: error.message };
      } finally {
        this.loading = false;
      }
    },

    async resolveDID(did: string) {
      try {
        const result = await (window as any).electronAPI.invoke('agent-did:resolve', did);
        return result;
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },

    async getAllDIDs() {
      try {
        const result = await (window as any).electronAPI.invoke('agent-did:get-all');
        if (result.success && result.data) {
          this.allDIDs = result.data;
        }
        return result;
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },

    async revokeDID(did: string) {
      try {
        const result = await (window as any).electronAPI.invoke('agent-did:revoke', did);
        if (result.success) {
          await this.getAllDIDs();
        }
        return result;
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },

    // ==================== 代理发现 ====================

    async discoverAgents(query?: any) {
      this.loading = true;
      this.error = null;
      try {
        const result = await (window as any).electronAPI.invoke('fed-registry:discover', query);
        if (result.success && result.data) {
          this.discoveredAgents = result.data;
        } else {
          this.error = result.error;
        }
        return result;
      } catch (error: any) {
        this.error = error.message;
        return { success: false, error: error.message };
      } finally {
        this.loading = false;
      }
    },

    async registerAgent(agentInfo: any) {
      this.loading = true;
      try {
        const result = await (window as any).electronAPI.invoke('fed-registry:register', agentInfo);
        if (result.success) {
          this.error = null;
        } else {
          this.error = result.error;
        }
        return result;
      } catch (error: any) {
        this.error = error.message;
        return { success: false, error: error.message };
      } finally {
        this.loading = false;
      }
    },

    async querySkills(skillQuery: any) {
      try {
        const result = await (window as any).electronAPI.invoke('fed-registry:query-skills', skillQuery);
        return result;
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },

    async getNetworkStats() {
      try {
        const result = await (window as any).electronAPI.invoke('fed-registry:get-network-stats');
        if (result.success && result.data) {
          this.networkStats = result.data;
        }
        return result;
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },

    // ==================== 凭证管理 ====================

    async issueCredential(data: any) {
      try {
        const result = await (window as any).electronAPI.invoke('agent-cred:issue', data);
        return result;
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },

    async verifyCredential(cred: any) {
      try {
        const result = await (window as any).electronAPI.invoke('agent-cred:verify', cred);
        return result;
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },

    async revokeCredential(id: string) {
      try {
        const result = await (window as any).electronAPI.invoke('agent-cred:revoke', id);
        return result;
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },

    // ==================== 跨组织任务 ====================

    async routeTask(task: any) {
      this.loading = true;
      try {
        const result = await (window as any).electronAPI.invoke('cross-org:route-task', task);
        if (result.success) {
          await this.getTaskLog();
        }
        return result;
      } catch (error: any) {
        return { success: false, error: error.message };
      } finally {
        this.loading = false;
      }
    },

    async getTaskStatus(id: string) {
      try {
        const result = await (window as any).electronAPI.invoke('cross-org:get-task-status', id);
        return result;
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },

    async cancelTask(id: string) {
      try {
        const result = await (window as any).electronAPI.invoke('cross-org:cancel-task', id);
        if (result.success) {
          await this.getTaskLog();
        }
        return result;
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },

    async getTaskLog() {
      try {
        const result = await (window as any).electronAPI.invoke('cross-org:get-log');
        if (result.success && result.data) {
          this.remoteTasks = result.data;
        }
        return result;
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },

    // ==================== 信誉系统 ====================

    async getReputation(did: string) {
      try {
        const result = await (window as any).electronAPI.invoke('reputation:get-score', did);
        return result;
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },

    async getRanking(options?: any) {
      try {
        const result = await (window as any).electronAPI.invoke('reputation:get-ranking', options);
        if (result.success && result.data) {
          this.reputationScores = result.data;
        }
        return result;
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },

    async updateReputation(did: string, feedback: any) {
      try {
        const result = await (window as any).electronAPI.invoke('reputation:update', did, feedback);
        return result;
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },

    async getReputationHistory(did: string) {
      try {
        const result = await (window as any).electronAPI.invoke('reputation:get-history', did);
        return result;
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },

    // ==================== 配置 ====================

    async getConfig() {
      try {
        const result = await (window as any).electronAPI.invoke('decentralized:get-config');
        return result;
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },

    // ==================== 事件监听 ====================

    initEventListeners() {
      const api = (window as any).electronAPI;
      if (api && api.on) {
        api.on('agent-network:agent-discovered', (_event: any, data: any) => {
          const exists = this.discoveredAgents.find((a) => a.did === data.did);
          if (!exists) {
            this.discoveredAgents.push(data);
          }
        });
        api.on('agent-network:task-updated', (_event: any, data: any) => {
          const idx = this.remoteTasks.findIndex((t) => t.id === data.id);
          if (idx !== -1) {
            this.remoteTasks[idx] = { ...this.remoteTasks[idx], ...data };
          }
        });
      }
    },

    reset() {
      this.myDID = null;
      this.allDIDs = [];
      this.discoveredAgents = [];
      this.remoteTasks = [];
      this.networkStats = null;
      this.reputationScores = [];
      this.loading = false;
      this.error = null;
    },
  },
});
