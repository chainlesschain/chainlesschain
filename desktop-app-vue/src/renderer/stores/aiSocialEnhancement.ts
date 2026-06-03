import { defineStore } from 'pinia';

const electronAPI = (window as any).electronAPI || (window as any).electron?.ipcRenderer;
function invoke(channel: string, ...args: any[]) {
  if (electronAPI?.invoke) return electronAPI.invoke(channel, ...args);
  return Promise.reject(new Error('IPC not available'));
}

export const useAISocialEnhancementStore = defineStore('aiSocialEnhancement', {
  state: () => ({ qualityReport: null as any, translationStats: null as any, loading: false, error: null as string | null }),
  actions: {
    async translateMessage(params: any) { try { return await invoke('ai-social:translate-message', params); } catch (e: any) { return { success: false, error: e.message }; } },
    async detectLanguage(text: string) { try { return await invoke('ai-social:detect-language', text); } catch (e: any) { return { success: false, error: e.message }; } },
    async assessQuality(params: any) { try { return await invoke('ai-social:assess-quality', params); } catch (e: any) { return { success: false, error: e.message }; } },
    async fetchQualityReport(filter?: any) {
      try { const r = await invoke('ai-social:get-quality-report', filter); if (r.success) this.qualityReport = r.report; return r; }
      catch (e: any) { return { success: false, error: e.message }; }
    },
    async fetchTranslationStats() {
      try { const r = await invoke('ai-social:get-translation-stats'); if (r.success) this.translationStats = r.stats; return r; }
      catch (e: any) { return { success: false, error: e.message }; }
    },
  },
});
