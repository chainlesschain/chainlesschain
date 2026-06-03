import { defineStore } from "pinia";

const electronAPI =
  (window as any).electronAPI || (window as any).electron?.ipcRenderer;
function invoke(channel: string, ...args: any[]) {
  if (electronAPI?.invoke) return electronAPI.invoke(channel, ...args);
  return Promise.reject(new Error("IPC not available"));
}

export interface ZKPCredential {
  id: string;
  type: string;
  issuerDid: string;
  subjectDid: string;
  claims: Record<string, unknown>;
  disclosedClaims: string[];
  proof: {
    scheme: string;
    signature: string;
    nonce: string;
    issuerPublicKey: string;
  };
  proofScheme: string;
  revocationId: string;
  status: string;
  expiresAt: string;
  issuedAt: string;
  createdAt: string;
}

export interface ZKPProof {
  id: string;
  proofType: string;
  scheme: string;
  proverDid: string;
  verifierDid: string | null;
  proofData: Record<string, unknown>;
  publicInputs: Record<string, unknown>;
  status: string;
  verifiedAt: string | null;
  expiresAt: string;
  createdAt: string;
}

export interface ZKPStats {
  totalCredentials: number;
  activeCredentials: number;
  revokedCredentials: number;
  byType: Record<string, number>;
  totalRevocations: number;
  totalPresentations: number;
  totalProofs: number;
  validProofs: number;
  invalidProofs: number;
}

export const useZKPCredentialsStore = defineStore("zkpCredentials", {
  state: () => ({
    credentials: [] as ZKPCredential[],
    proofs: [] as ZKPProof[],
    stats: null as ZKPStats | null,
    loading: false,
    error: null as string | null,
  }),
  getters: {
    activeCredentials: (state) =>
      state.credentials.filter((c) => c.status === "active"),
    revokedCredentials: (state) =>
      state.credentials.filter((c) => c.status === "revoked"),
  },
  actions: {
    async loadCredentials(filter: Record<string, unknown> = {}) {
      this.loading = true;
      try {
        const result = await invoke("zkp-vc:list-credentials", {
          filter,
        });
        if (result.success) this.credentials = result.data;
        else this.error = result.error;
      } catch (error: unknown) {
        this.error = (error as Error).message;
      } finally {
        this.loading = false;
      }
    },
    async issueCredential(
      type: string,
      issuerDid: string,
      subjectDid: string,
      claims: Record<string, unknown>,
    ) {
      try {
        const result = await invoke("zkp-vc:issue-credential", {
          type,
          issuerDid,
          subjectDid,
          claims,
        });
        if (result.success) {
          await this.loadCredentials();
          return result.data;
        }
        throw new Error(result.error);
      } catch (error: unknown) {
        this.error = (error as Error).message;
        throw error;
      }
    },
    async revokeCredential(
      credentialId: string,
      revokedBy: string,
      reason: string,
    ) {
      try {
        const result = await invoke("zkp-vc:revoke-credential", {
          credentialId,
          revokedBy,
          reason,
        });
        if (result.success) await this.loadCredentials();
        else this.error = result.error;
      } catch (error: unknown) {
        this.error = (error as Error).message;
      }
    },
    async createPresentation(
      credentialId: string,
      disclosedClaimKeys: string[] = [],
    ) {
      try {
        const result = await invoke("zkp-vc:present-credential", {
          credentialId,
          disclosedClaimKeys,
        });
        if (result.success) return result.data;
        throw new Error(result.error);
      } catch (error: unknown) {
        this.error = (error as Error).message;
        throw error;
      }
    },
    async loadProofs(filter: Record<string, unknown> = {}) {
      this.loading = true;
      try {
        const result = await invoke("zkp:list-proofs", { filter });
        if (result.success) this.proofs = result.data;
        else this.error = result.error;
      } catch (error: unknown) {
        this.error = (error as Error).message;
      } finally {
        this.loading = false;
      }
    },
    async generateIdentityProof(
      proverDid: string,
      claims: Record<string, unknown>,
    ) {
      try {
        const result = await invoke("zkp:generate-identity-proof", {
          proverDid,
          claims,
        });
        if (result.success) {
          await this.loadProofs();
          return result.data;
        }
        throw new Error(result.error);
      } catch (error: unknown) {
        this.error = (error as Error).message;
        throw error;
      }
    },
    async loadStats() {
      try {
        const [proofStats, vcStats] = await Promise.all([
          invoke("zkp:get-stats", {}),
          invoke("zkp-vc:get-stats", {}),
        ]);
        if (proofStats.success && vcStats.success) {
          this.stats = { ...vcStats.data, ...proofStats.data };
        }
      } catch (error: unknown) {
        this.error = (error as Error).message;
      }
    },
    clearError() {
      this.error = null;
    },
  },
});
