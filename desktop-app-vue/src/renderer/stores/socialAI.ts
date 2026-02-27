import { defineStore } from 'pinia';

export interface TopicAnalysis {
  topics: string[];
  sentiment: string;
  sentimentScore: number;
  category: string;
  keywords: string[];
  summary: string;
  source: string;
}

export interface TrendingTopic {
  topic: string;
  count: number;
}

export interface GraphNode {
  id: string;
  isCenter: boolean;
}

export interface GraphEdge {
  source_did: string;
  target_did: string;
  interaction_type: string;
  interaction_count: number;
  closeness_score: number;
}

export interface SocialGraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface ClosestContact {
  did: string;
  closeness: number;
  totalInteractions: number;
  lastInteraction: number;
}

export interface Community {
  clusterId: number;
  members: string[];
  size: number;
}

export interface GraphStats {
  totalContacts: number;
  totalInteractions: number;
  avgCloseness: number;
  byType: Record<string, number>;
}

export interface ReplySuggestion {
  suggestion: string;
  style: string;
  source: string;
  confidence?: number;
  reasoning?: string;
  contextSize?: number;
}

const electronAPI = (window as any).electronAPI || (window as any).electron?.ipcRenderer;

function invoke(channel: string, ...args: any[]) {
  if (electronAPI?.invoke) return electronAPI.invoke(channel, ...args);
  return Promise.reject(new Error('IPC not available'));
}

export const useSocialAIStore = defineStore('socialAI', {
  state: () => ({
    // Topic Analysis
    currentAnalysis: null as TopicAnalysis | null,
    trendingTopics: [] as TrendingTopic[],
    batchSentiment: null as { average: number; distribution: Record<string, number>; count: number } | null,

    // Social Graph
    graph: null as SocialGraphData | null,
    closestContacts: [] as ClosestContact[],
    communities: [] as Community[],
    graphStats: null as GraphStats | null,

    // Reply Suggestions
    enhancedReply: null as ReplySuggestion | null,
    multiStyleReplies: null as Record<string, ReplySuggestion> | null,

    // UI State
    loading: false,
    error: null as string | null,
  }),

  getters: {
    topTopics: (state): string[] => {
      return state.currentAnalysis?.topics || [];
    },

    sentimentLabel: (state): string => {
      return state.currentAnalysis?.sentiment || 'neutral';
    },

    contactCount: (state): number => {
      return state.graphStats?.totalContacts || 0;
    },
  },

  actions: {
    async analyzeTopics(content: string, options?: { contentId?: string; contentType?: string }) {
      this.loading = true;
      this.error = null;
      try {
        const result = await invoke('social-ai:analyze-topics', { content, options });
        if (result && !result.error) {
          this.currentAnalysis = result;
        } else {
          this.error = result?.error || 'Analysis failed';
        }
        return result;
      } catch (err: any) {
        this.error = err.message;
        throw err;
      } finally {
        this.loading = false;
      }
    },

    async fetchTrendingTopics(options?: { limit?: number; sinceMs?: number }) {
      this.loading = true;
      this.error = null;
      try {
        const result = await invoke('social-ai:trending-topics', options || {});
        if (Array.isArray(result)) {
          this.trendingTopics = result;
        }
        return result;
      } catch (err: any) {
        this.error = err.message;
        return [];
      } finally {
        this.loading = false;
      }
    },

    async analyzeBatchSentiment(contents: string[]) {
      this.loading = true;
      this.error = null;
      try {
        const result = await invoke('social-ai:batch-sentiment', { contents });
        if (result && !result.error) {
          this.batchSentiment = result;
        }
        return result;
      } catch (err: any) {
        this.error = err.message;
        throw err;
      } finally {
        this.loading = false;
      }
    },

    async getEnhancedReply(context: Array<{ role: string; content: string }>, style?: string) {
      this.loading = true;
      this.error = null;
      try {
        const result = await invoke('social-ai:enhanced-reply', { context, style });
        if (result && !result.error) {
          this.enhancedReply = result;
        }
        return result;
      } catch (err: any) {
        this.error = err.message;
        throw err;
      } finally {
        this.loading = false;
      }
    },

    async getMultiStyleReplies(context: Array<{ role: string; content: string }>, styles?: string[]) {
      this.loading = true;
      this.error = null;
      try {
        const result = await invoke('social-ai:multi-style-replies', { context, styles });
        if (result && result.replies) {
          this.multiStyleReplies = result.replies;
        }
        return result;
      } catch (err: any) {
        this.error = err.message;
        throw err;
      } finally {
        this.loading = false;
      }
    },

    async recordInteraction(sourceDid: string, targetDid: string, interactionType: string) {
      try {
        return await invoke('social-ai:record-interaction', { sourceDid, targetDid, interactionType });
      } catch (err: any) {
        this.error = err.message;
        throw err;
      }
    },

    async fetchClosestContacts(did: string, options?: { limit?: number }) {
      this.loading = true;
      this.error = null;
      try {
        const result = await invoke('social-ai:closest-contacts', { did, options });
        if (Array.isArray(result)) {
          this.closestContacts = result;
        }
        return result;
      } catch (err: any) {
        this.error = err.message;
        return [];
      } finally {
        this.loading = false;
      }
    },

    async fetchGraph(did: string, options?: { depth?: number }) {
      this.loading = true;
      this.error = null;
      try {
        const result = await invoke('social-ai:get-graph', { did, options });
        if (result && result.success) {
          this.graph = result.graph;
          this.graphStats = result.stats;
          this.communities = result.communities || [];
        }
        return result;
      } catch (err: any) {
        this.error = err.message;
        throw err;
      } finally {
        this.loading = false;
      }
    },
  },
});
