import { defineStore } from 'pinia';

const electronAPI = (window as any).electronAPI || (window as any).electron?.ipcRenderer;
function invoke(channel: string, ...args: any[]) {
  if (electronAPI?.invoke) return electronAPI.invoke(channel, ...args);
  return Promise.reject(new Error('IPC not available'));
}

export const useTechLearningStore = defineStore('techLearning', {
  state: () => ({
    profiles: [] as any[],
    practices: [] as any[],
    loading: false,
    error: null as string | null,
  }),

  getters: {
    promotedPractices: (state) => state.practices.filter((p: any) => p.status === 'promoted'),
    profileCount: (state) => state.profiles.length,
  },

  actions: {
    async detectStack(projectPath: string) {
      this.loading = true;
      this.error = null;
      try {
        const result = await invoke('tech-learning:detect-stack', { projectPath });
        if (result.success) await this.fetchProfiles();
        else this.error = result.error;
        return result;
      } catch (err: any) {
        this.error = err.message;
        return { success: false, error: err.message };
      } finally {
        this.loading = false;
      }
    },

    async fetchProfiles(filter?: { limit?: number }) {
      try {
        const result = await invoke('tech-learning:get-profiles', filter);
        if (result.success) this.profiles = result.profiles || [];
        return result;
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    },

    async extractPractices(profileId: string, source?: string) {
      this.loading = true;
      this.error = null;
      try {
        const result = await invoke('tech-learning:extract-practices', { profileId, source });
        if (result.success) await this.fetchPractices({ profileId });
        else this.error = result.error;
        return result;
      } catch (err: any) {
        this.error = err.message;
        return { success: false, error: err.message };
      } finally {
        this.loading = false;
      }
    },

    async fetchPractices(filter?: { profileId?: string; status?: string; limit?: number }) {
      try {
        const result = await invoke('tech-learning:get-practices', filter);
        if (result.success) this.practices = result.practices || [];
        return result;
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    },

    async synthesizeSkill(practiceId: string) {
      this.loading = true;
      try {
        const result = await invoke('tech-learning:synthesize-skill', { practiceId });
        if (!result.success) this.error = result.error;
        return result;
      } catch (err: any) {
        this.error = err.message;
        return { success: false, error: err.message };
      } finally {
        this.loading = false;
      }
    },
  },
});
