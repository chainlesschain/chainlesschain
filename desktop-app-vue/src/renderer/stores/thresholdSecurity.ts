import { defineStore } from 'pinia';

export interface ThresholdKeyShare {
  id: string;
  index: number;
  source: string;
}

export interface ThresholdKey {
  key_id: string;
  public_key: string;
  share_count: number;
  created_at: number;
}

export interface BiometricBinding {
  id: string;
  key_id: string;
  biometric_type: string;
  status: string;
  bound_at: number;
  expires_at: number | null;
  last_verified_at: number | null;
  verification_count: number;
}

export interface ThresholdSetupResult {
  success: boolean;
  keyId: string;
  publicKey: string;
  shares: ThresholdKeyShare[];
  threshold: number;
  total: number;
  error?: string;
}

const electronAPI = (window as any).electronAPI || (window as any).electron?.ipcRenderer;
function invoke(channel: string, ...args: any[]) {
  if (electronAPI?.invoke) return electronAPI.invoke(channel, ...args);
  return Promise.reject(new Error('IPC not available'));
}

export const useThresholdSecurityStore = defineStore('thresholdSecurity', {
  state: () => ({
    keys: [] as ThresholdKey[],
    bindings: [] as BiometricBinding[],
    currentSetup: null as ThresholdSetupResult | null,
    loading: false,
    error: null as string | null,
  }),

  getters: {
    activeBindings: (state) => state.bindings.filter(b => b.status === 'active'),
    keyCount: (state) => state.keys.length,
  },

  actions: {
    async setupKeys(keyId: string, sources?: string[]) {
      this.loading = true;
      this.error = null;
      try {
        const result = await invoke('threshold-security:setup-keys', { keyId, sources });
        if (result.success) {
          this.currentSetup = result;
          await this.loadKeys();
        } else {
          this.error = result.error || 'Setup failed';
        }
        return result;
      } catch (err: any) {
        this.error = err.message;
        return { success: false, error: err.message };
      } finally {
        this.loading = false;
      }
    },

    async sign(keyId: string, data: string, shareSources: string[]) {
      this.loading = true;
      this.error = null;
      try {
        const result = await invoke('threshold-security:sign', { keyId, data, shareSources });
        if (!result.success) this.error = result.error;
        return result;
      } catch (err: any) {
        this.error = err.message;
        return { success: false, error: err.message };
      } finally {
        this.loading = false;
      }
    },

    async bindBiometric(keyId: string, biometricType: string, templateData: string, expiresInDays?: number) {
      this.loading = true;
      this.error = null;
      try {
        const result = await invoke('threshold-security:bind-biometric', { keyId, biometricType, templateData, expiresInDays });
        if (result.success) await this.loadBindings(keyId);
        else this.error = result.error;
        return result;
      } catch (err: any) {
        this.error = err.message;
        return { success: false, error: err.message };
      } finally {
        this.loading = false;
      }
    },

    async verifyBiometric(keyId: string, biometricType: string, templateData: string) {
      this.loading = true;
      this.error = null;
      try {
        const result = await invoke('threshold-security:verify-biometric', { keyId, biometricType, templateData });
        if (!result.success) this.error = result.error;
        return result;
      } catch (err: any) {
        this.error = err.message;
        return { success: false, error: err.message };
      } finally {
        this.loading = false;
      }
    },

    async loadKeys() {
      try {
        const result = await invoke('threshold-security:setup-keys', { action: 'list' });
        if (result.success) this.keys = result.keys || [];
      } catch {
        // Non-critical
      }
    },

    async loadBindings(keyId?: string) {
      try {
        const result = await invoke('threshold-security:bind-biometric', { action: 'list', keyId });
        if (result.success) this.bindings = result.bindings || [];
      } catch {
        // Non-critical
      }
    },
  },
});
