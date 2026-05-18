import { defineStore } from 'pinia';

export interface Recommendation {
  id: string;
  user_id: string;
  content_id: string;
  content_type: string;
  score: number;
  reason: string;
  source: string;
  status: string;
  created_at: number;
  viewed_at: number | null;
}

export interface InterestProfile {
  user_id: string;
  topics: Record<string, number>;
  interaction_weights: Record<string, number>;
  last_updated: number;
  update_count: number;
}

const electronAPI = (window as any).electronAPI || (window as any).electron?.ipcRenderer;
function invoke(channel: string, ...args: any[]) {
  if (electronAPI?.invoke) return electronAPI.invoke(channel, ...args);
  return Promise.reject(new Error('IPC not available'));
}

export const useRecommendationStore = defineStore('recommendation', {
  state: () => ({
    recommendations: [] as Recommendation[],
    profile: null as InterestProfile | null,
    loading: false,
    error: null as string | null,
  }),

  getters: {
    unviewedCount: (state) => state.recommendations.filter(r => !r.viewed_at).length,
    topRecommendations: (state) => state.recommendations.slice(0, 10),
  },

  actions: {
    async fetchRecommendations(userId: string, limit = 20, contentType?: string) {
      this.loading = true;
      this.error = null;
      try {
        const result = await invoke('recommendation:get-recommendations', { userId, limit, contentType });
        if (result.success) this.recommendations = result.recommendations || [];
        else this.error = result.error;
        return result;
      } catch (err: any) {
        this.error = err.message;
        return { success: false, error: err.message };
      } finally {
        this.loading = false;
      }
    },

    async generate(userId: string, contentPool?: any[]) {
      this.loading = true;
      try {
        const result = await invoke('recommendation:generate', { userId, contentPool });
        if (result.success) await this.fetchRecommendations(userId);
        return result;
      } catch (err: any) {
        this.error = err.message;
        return { success: false, error: err.message };
      } finally {
        this.loading = false;
      }
    },

    async markViewed(recommendationId: string) {
      try {
        return await invoke('recommendation:mark-viewed', { id: recommendationId });
      } catch {
        // Non-critical
      }
    },

    async provideFeedback(recommendationId: string, feedback: string) {
      try {
        const result = await invoke('recommendation:feedback', { recommendationId, feedback });
        if (result.success) {
          const idx = this.recommendations.findIndex(r => r.id === recommendationId);
          if (idx >= 0) this.recommendations[idx].status = feedback;
        }
        return result;
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    },

    async fetchProfile(userId: string) {
      try {
        const result = await invoke('recommendation:get-profile', { userId });
        if (result.success) this.profile = result.profile;
        return result;
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    },

    async updateProfile(userId: string, interactions: any[]) {
      try {
        return await invoke('recommendation:update-profile', { userId, interactions });
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    },
  },
});
