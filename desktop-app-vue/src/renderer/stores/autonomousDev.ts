import { defineStore } from 'pinia';

const electronAPI = (window as any).electronAPI || (window as any).electron?.ipcRenderer;
function invoke(channel: string, ...args: any[]) {
  if (electronAPI?.invoke) return electronAPI.invoke(channel, ...args);
  return Promise.reject(new Error('IPC not available'));
}

export const useAutonomousDevStore = defineStore('autonomousDev', {
  state: () => ({
    sessions: [] as any[],
    currentSession: null as any,
    loading: false,
    error: null as string | null,
  }),

  getters: {
    completedSessions: (state) => state.sessions.filter((s: any) => s.status === 'complete'),
    activeSessions: (state) => state.sessions.filter((s: any) => !['complete', 'failed'].includes(s.status)),
    sessionCount: (state) => state.sessions.length,
  },

  actions: {
    async startSession(intent: string, title?: string) {
      this.loading = true;
      this.error = null;
      try {
        const result = await invoke('autonomous-dev:start-session', { intent, title });
        if (result.success) {
          this.currentSession = result.session;
          await this.fetchSessions();
        } else this.error = result.error;
        return result;
      } catch (err: any) {
        this.error = err.message;
        return { success: false, error: err.message };
      } finally {
        this.loading = false;
      }
    },

    async refineSession(sessionId: string, feedback?: string) {
      this.loading = true;
      this.error = null;
      try {
        const result = await invoke('autonomous-dev:refine', { sessionId, feedback });
        if (result.success) this.currentSession = result.session;
        else this.error = result.error;
        return result;
      } catch (err: any) {
        this.error = err.message;
        return { success: false, error: err.message };
      } finally {
        this.loading = false;
      }
    },

    async generateCode(sessionId: string) {
      this.loading = true;
      this.error = null;
      try {
        const result = await invoke('autonomous-dev:generate', { sessionId });
        if (result.success) this.currentSession = result.session;
        else this.error = result.error;
        return result;
      } catch (err: any) {
        this.error = err.message;
        return { success: false, error: err.message };
      } finally {
        this.loading = false;
      }
    },

    async reviewCode(sessionId: string) {
      this.loading = true;
      try {
        const result = await invoke('autonomous-dev:review', { sessionId });
        if (!result.success) this.error = result.error;
        return result;
      } catch (err: any) {
        this.error = err.message;
        return { success: false, error: err.message };
      } finally {
        this.loading = false;
      }
    },

    async fetchSessions(filter?: { status?: string; limit?: number }) {
      try {
        const result = await invoke('autonomous-dev:list-sessions', filter);
        if (result.success) this.sessions = result.sessions || [];
        return result;
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    },
  },
});
