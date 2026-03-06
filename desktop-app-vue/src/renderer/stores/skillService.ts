import { defineStore } from 'pinia';

const electronAPI = (window as any).electronAPI || (window as any).electron?.ipcRenderer;
function invoke(channel: string, ...args: any[]) {
  if (electronAPI?.invoke) return electronAPI.invoke(channel, ...args);
  return Promise.reject(new Error('IPC not available'));
}

export const useSkillServiceStore = defineStore('skillService', {
  state: () => ({
    skills: [] as any[],
    versions: [] as any[],
    loading: false,
    error: null as string | null,
  }),
  getters: {
    publishedSkills: (state) => state.skills.filter((s: any) => s.status === 'published'),
    skillCount: (state) => state.skills.length,
  },
  actions: {
    async fetchSkills(filter?: any) {
      this.loading = true; this.error = null;
      try { const r = await invoke('skill-service:list-skills', filter); if (r.success) this.skills = r.skills || []; else this.error = r.error; return r; }
      catch (e: any) { this.error = e.message; return { success: false, error: e.message }; }
      finally { this.loading = false; }
    },
    async publishSkill(params: any) {
      this.loading = true; this.error = null;
      try { const r = await invoke('skill-service:publish-skill', params); if (r.success) await this.fetchSkills(); else this.error = r.error; return r; }
      catch (e: any) { this.error = e.message; return { success: false, error: e.message }; }
      finally { this.loading = false; }
    },
    async invokeRemote(params: any) {
      try { return await invoke('skill-service:invoke-remote', params); }
      catch (e: any) { return { success: false, error: e.message }; }
    },
    async fetchVersions(skillName: string) {
      try { const r = await invoke('skill-service:get-versions', skillName); if (r.success) this.versions = r.versions || []; return r; }
      catch (e: any) { return { success: false, error: e.message }; }
    },
    async composePipeline(params: any) {
      try { return await invoke('skill-service:compose-pipeline', params); }
      catch (e: any) { return { success: false, error: e.message }; }
    },
  },
});
