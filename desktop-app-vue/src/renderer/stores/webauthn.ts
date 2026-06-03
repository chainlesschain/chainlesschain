import { defineStore } from "pinia";

const electronAPI =
  (window as any).electronAPI || (window as any).electron?.ipcRenderer;
function invoke(channel: string, ...args: any[]) {
  if (electronAPI?.invoke) return electronAPI.invoke(channel, ...args);
  return Promise.reject(new Error("IPC not available"));
}

export interface Passkey {
  id: string;
  credentialId: string;
  rpId: string;
  rpName?: string;
  userId: string;
  userName?: string;
  userDisplayName?: string;
  publicKey: string;
  algorithm: number;
  signCount: number;
  transports: string[];
  didBinding?: string;
  status: string;
  lastUsedAt?: string;
  createdAt: string;
}

export interface WebAuthnStats {
  totalPasskeys: number;
  activePasskeys: number;
  revokedPasskeys: number;
  totalCeremonies: number;
  pendingCeremonies: number;
}

export const useWebAuthnStore = defineStore("webauthn", {
  state: () => ({
    passkeys: [] as Passkey[],
    stats: null as WebAuthnStats | null,
    loading: false,
    error: null as string | null,
  }),
  getters: {
    activePasskeys: (state) =>
      state.passkeys.filter((p) => p.status === "active"),
    passkeysByRp: (state) => (rpId: string) =>
      state.passkeys.filter((p) => p.rpId === rpId),
  },
  actions: {
    async loadPasskeys() {
      this.loading = true;
      try {
        const result = await invoke("webauthn:list-passkeys", {});
        if (result.success) this.passkeys = result.data;
        else this.error = result.error;
      } catch (error: unknown) {
        this.error = (error as Error).message;
      } finally {
        this.loading = false;
      }
    },
    async registerPasskey(
      rpId: string,
      rpName: string,
      userId: string,
      userName: string,
    ) {
      try {
        const beginResult = await invoke("webauthn:register-begin", {
          rpId,
          rpName,
          userId,
          userName,
        });
        if (!beginResult.success) throw new Error(beginResult.error);
        return beginResult.data;
      } catch (error: unknown) {
        this.error = (error as Error).message;
        throw error;
      }
    },
    async completeRegistration(
      ceremonyId: string,
      attestationResponse: Record<string, unknown>,
    ) {
      try {
        const result = await invoke("webauthn:register-complete", {
          ceremonyId,
          attestationResponse,
        });
        if (result.success) {
          await this.loadPasskeys();
          return result.data;
        }
        throw new Error(result.error);
      } catch (error: unknown) {
        this.error = (error as Error).message;
        throw error;
      }
    },
    async deletePasskey(credentialId: string) {
      try {
        const result = await invoke("webauthn:delete-passkey", {
          credentialId,
        });
        if (result.success) await this.loadPasskeys();
        else this.error = result.error;
      } catch (error: unknown) {
        this.error = (error as Error).message;
      }
    },
    async bindDID(credentialId: string, did: string) {
      try {
        const result = await invoke("webauthn:bind-did", {
          credentialId,
          did,
        });
        if (result.success) await this.loadPasskeys();
        else this.error = result.error;
      } catch (error: unknown) {
        this.error = (error as Error).message;
      }
    },
    async loadStats() {
      try {
        const result = await invoke("webauthn:get-stats", {});
        if (result.success) this.stats = result.data;
      } catch (error: unknown) {
        this.error = (error as Error).message;
      }
    },
    clearError() {
      this.error = null;
    },
  },
});
