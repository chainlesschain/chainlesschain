/**
 * Encryption Store
 *
 * Pinia store for managing advanced cryptography module state:
 * Post-Quantum, Zero-Knowledge, Homomorphic Encryption, MPC, HSM, Advanced Crypto.
 *
 * Communicates with the main process via IPC channels.
 *
 * @module stores/encryption
 * @version 1.0.0
 */

import { defineStore } from 'pinia';

// ==================== Type Definitions ====================

// Post-Quantum Cryptography
export interface PQKeyPair {
  id: string;
  algorithm: string;
  securityLevel: string | number;
  publicKey: string;
  keyType: string;
  createdAt: string;
}

export interface KEMResult {
  ciphertext: string;
  sharedSecret: string;
}

export interface PQSignature {
  signature: string;
  algorithm: string;
}

export interface PQAuditResult {
  totalKeys: number;
  classicalKeys: number;
  pqcKeys: number;
  hybridKeys: number;
  recommendations: string[];
}

// Zero-Knowledge Proofs
export interface ZKProof {
  proofId: string;
  proof: string;
  publicInputs: Record<string, unknown>;
  provingTimeMs: number;
  proofSize: number;
}

export interface ZKVerification {
  valid: boolean;
  verificationTimeMs: number;
  proofType: string;
}

export interface ZKRollupBatch {
  batchId: string;
  merkleRoot: string;
  txCount: number;
  compressionRatio: number;
}

export interface ZKBenchmark {
  snark: { provingTimeMs: number; verifyTimeMs: number; proofSizeBytes: number; setupRequired: boolean };
  stark: { provingTimeMs: number; verifyTimeMs: number; proofSizeBytes: number; setupRequired: boolean };
  bulletproofs: { provingTimeMs: number; verifyTimeMs: number; proofSizeBytes: number; setupRequired: boolean };
  plonk: { provingTimeMs: number; verifyTimeMs: number; proofSizeBytes: number; setupRequired: boolean };
}

// Homomorphic Encryption
export interface PaillierKeyPair {
  publicKey: { n: string; g: string };
  privateKey: { lambda: string; mu: string };
  bitLength: number;
}

export interface HEComputation {
  result: string;
  operation: string;
  scheme: string;
}

// MPC
export interface MPCSession {
  sessionId: string;
  status: string;
  participantCount: number;
  threshold: number;
}

export interface ShamirShares {
  sessionId: string;
  shares: string[];
  threshold: number;
  totalShares: number;
}

// HSM
export interface HSMKey {
  keyId: string;
  alias: string;
  algorithm: string;
  backend: string;
  status: string;
}

export interface HSMClusterStatus {
  nodes: Array<{ id: string; status: string; latencyMs: number }>;
  healthy: boolean;
  quorum: boolean;
}

export interface ComplianceStatus {
  standards: Array<{ name: string; status: string; details: string }>;
  overallCompliant: boolean;
}

// Advanced Crypto
export interface SSEIndex {
  indexId: string;
  documentCount: number;
  tokenCount: number;
}

export interface CryptoAuditEntry {
  id: string;
  operation: string;
  category: string;
  success: boolean;
  createdAt: string;
}

// Store State
interface EncryptionState {
  // Post-Quantum
  pqKeyPairs: PQKeyPair[];
  pqAudit: PQAuditResult | null;

  // Zero-Knowledge
  zkProofs: ZKProof[];
  zkBenchmark: ZKBenchmark | null;

  // Homomorphic
  heKeyPair: PaillierKeyPair | null;
  heComputations: HEComputation[];

  // MPC
  mpcSessions: MPCSession[];
  shamirShares: ShamirShares | null;

  // HSM
  hsmKeys: HSMKey[];
  hsmCluster: HSMClusterStatus | null;
  hsmCompliance: ComplianceStatus | null;

  // Advanced
  sseIndexes: SSEIndex[];
  auditTrail: CryptoAuditEntry[];

  // UI state
  loading: boolean;
  error: string | null;
  activeModule: string;
}

// ==================== Store ====================

export const useEncryptionStore = defineStore('encryption', {
  state: (): EncryptionState => ({
    pqKeyPairs: [],
    pqAudit: null,
    zkProofs: [],
    zkBenchmark: null,
    heKeyPair: null,
    heComputations: [],
    mpcSessions: [],
    shamirShares: null,
    hsmKeys: [],
    hsmCluster: null,
    hsmCompliance: null,
    sseIndexes: [],
    auditTrail: [],
    loading: false,
    error: null,
    activeModule: 'post-quantum',
  }),

  getters: {
    pqKeyCount(): number {
      return this.pqKeyPairs.length;
    },
    zkProofCount(): number {
      return this.zkProofs.length;
    },
    hsmActiveKeys(): HSMKey[] {
      return this.hsmKeys.filter((k) => k.status === 'active');
    },
    isCompliant(): boolean {
      return this.hsmCompliance?.overallCompliant ?? false;
    },
    activeMPCSessions(): MPCSession[] {
      return this.mpcSessions.filter((s) => s.status === 'active');
    },
  },

  actions: {
    // ==========================================
    // Post-Quantum Cryptography
    // ==========================================

    async generateKyberKeyPair(securityLevel = 768): Promise<void> {
      this.loading = true;
      this.error = null;
      try {
        const result = await (window as any).electronAPI?.invoke('pq:generate-kyber-keypair', securityLevel);
        if (result?.success) {
          this.pqKeyPairs.push(result.data);
        } else {
          this.error = result?.error || 'Failed to generate Kyber key pair';
        }
      } catch (e: any) {
        this.error = e.message;
      } finally {
        this.loading = false;
      }
    },

    async generateDilithiumKeyPair(securityLevel = 3): Promise<void> {
      this.loading = true;
      this.error = null;
      try {
        const result = await (window as any).electronAPI?.invoke('pq:generate-dilithium-keypair', securityLevel);
        if (result?.success) {
          this.pqKeyPairs.push(result.data);
        } else {
          this.error = result?.error || 'Failed to generate Dilithium key pair';
        }
      } catch (e: any) {
        this.error = e.message;
      } finally {
        this.loading = false;
      }
    },

    async runPQAudit(): Promise<void> {
      this.loading = true;
      this.error = null;
      try {
        const result = await (window as any).electronAPI?.invoke('pq:audit-scan');
        if (result?.success) {
          this.pqAudit = result.data;
        } else {
          this.error = result?.error || 'Audit scan failed';
        }
      } catch (e: any) {
        this.error = e.message;
      } finally {
        this.loading = false;
      }
    },

    // ==========================================
    // Zero-Knowledge Proofs
    // ==========================================

    async generateZKProof(statement: string, witness: string): Promise<ZKProof | null> {
      this.loading = true;
      this.error = null;
      try {
        const result = await (window as any).electronAPI?.invoke('zk:generate-proof', statement, witness);
        if (result?.success) {
          this.zkProofs.push(result.data);
          return result.data;
        }
        this.error = result?.error || 'Failed to generate ZK proof';
        return null;
      } catch (e: any) {
        this.error = e.message;
        return null;
      } finally {
        this.loading = false;
      }
    },

    async verifyZKProof(proofId: string): Promise<ZKVerification | null> {
      this.loading = true;
      this.error = null;
      try {
        const result = await (window as any).electronAPI?.invoke('zk:verify-proof', proofId);
        if (result?.success) {
          return result.data;
        }
        this.error = result?.error || 'Verification failed';
        return null;
      } catch (e: any) {
        this.error = e.message;
        return null;
      } finally {
        this.loading = false;
      }
    },

    async benchmarkZKSystems(): Promise<void> {
      this.loading = true;
      this.error = null;
      try {
        const result = await (window as any).electronAPI?.invoke('zk:benchmark-systems');
        if (result?.success) {
          this.zkBenchmark = result.data;
        } else {
          this.error = result?.error || 'Benchmark failed';
        }
      } catch (e: any) {
        this.error = e.message;
      } finally {
        this.loading = false;
      }
    },

    // ==========================================
    // Homomorphic Encryption
    // ==========================================

    async generatePaillierKeys(bitLength = 2048): Promise<void> {
      this.loading = true;
      this.error = null;
      try {
        const result = await (window as any).electronAPI?.invoke('he:paillier-keygen', bitLength);
        if (result?.success) {
          this.heKeyPair = result.data;
        } else {
          this.error = result?.error || 'Key generation failed';
        }
      } catch (e: any) {
        this.error = e.message;
      } finally {
        this.loading = false;
      }
    },

    async encryptedDataAnalysis(dataset: unknown[], operation: string): Promise<HEComputation | null> {
      this.loading = true;
      this.error = null;
      try {
        const result = await (window as any).electronAPI?.invoke('he:encrypted-data-analysis', dataset, operation);
        if (result?.success) {
          this.heComputations.push(result.data);
          return result.data;
        }
        this.error = result?.error || 'Analysis failed';
        return null;
      } catch (e: any) {
        this.error = e.message;
        return null;
      } finally {
        this.loading = false;
      }
    },

    // ==========================================
    // Secure Multi-Party Computation
    // ==========================================

    async shamirSplit(secret: string, totalShares: number, threshold: number): Promise<void> {
      this.loading = true;
      this.error = null;
      try {
        const result = await (window as any).electronAPI?.invoke('mpc:shamir-split', secret, totalShares, threshold);
        if (result?.success) {
          this.shamirShares = result.data;
          this.mpcSessions.push({ sessionId: result.data.sessionId, status: 'completed', participantCount: totalShares, threshold });
        } else {
          this.error = result?.error || 'Shamir split failed';
        }
      } catch (e: any) {
        this.error = e.message;
      } finally {
        this.loading = false;
      }
    },

    async socialRecoverySetup(userId: string, guardians: string[], threshold: number): Promise<void> {
      this.loading = true;
      this.error = null;
      try {
        const result = await (window as any).electronAPI?.invoke('mpc:social-recovery-setup', userId, guardians, threshold);
        if (result?.success) {
          this.mpcSessions.push({ sessionId: result.data.sessionId, status: 'active', participantCount: guardians.length, threshold });
        } else {
          this.error = result?.error || 'Social recovery setup failed';
        }
      } catch (e: any) {
        this.error = e.message;
      } finally {
        this.loading = false;
      }
    },

    async thresholdSign(message: string, shares: string[], threshold: number): Promise<string | null> {
      this.loading = true;
      this.error = null;
      try {
        const result = await (window as any).electronAPI?.invoke('mpc:threshold-sign', message, shares, threshold);
        if (result?.success) {
          return result.data.signature;
        }
        this.error = result?.error || 'Threshold signing failed';
        return null;
      } catch (e: any) {
        this.error = e.message;
        return null;
      } finally {
        this.loading = false;
      }
    },

    // ==========================================
    // HSM Integration
    // ==========================================

    async selectHSMBackend(name: string): Promise<void> {
      this.loading = true;
      this.error = null;
      try {
        const result = await (window as any).electronAPI?.invoke('hsm:select-backend', name);
        if (!result?.success) {
          this.error = result?.error || 'Backend selection failed';
        }
      } catch (e: any) {
        this.error = e.message;
      } finally {
        this.loading = false;
      }
    },

    async generateHSMKey(alias: string, algorithm: string): Promise<void> {
      this.loading = true;
      this.error = null;
      try {
        const result = await (window as any).electronAPI?.invoke('hsm:generate-key', alias, algorithm);
        if (result?.success) {
          this.hsmKeys.push(result.data);
        } else {
          this.error = result?.error || 'Key generation failed';
        }
      } catch (e: any) {
        this.error = e.message;
      } finally {
        this.loading = false;
      }
    },

    async rotateHSMKey(alias: string): Promise<void> {
      this.loading = true;
      this.error = null;
      try {
        const result = await (window as any).electronAPI?.invoke('hsm:rotate-key', alias);
        if (result?.success) {
          const idx = this.hsmKeys.findIndex((k) => k.alias === alias);
          if (idx >= 0) {
            this.hsmKeys[idx] = { ...this.hsmKeys[idx], ...result.data };
          }
        } else {
          this.error = result?.error || 'Key rotation failed';
        }
      } catch (e: any) {
        this.error = e.message;
      } finally {
        this.loading = false;
      }
    },

    async fetchClusterStatus(): Promise<void> {
      this.loading = true;
      this.error = null;
      try {
        const result = await (window as any).electronAPI?.invoke('hsm:get-cluster-status');
        if (result?.success) {
          this.hsmCluster = result.data;
        } else {
          this.error = result?.error || 'Failed to get cluster status';
        }
      } catch (e: any) {
        this.error = e.message;
      } finally {
        this.loading = false;
      }
    },

    async fetchComplianceStatus(): Promise<void> {
      this.loading = true;
      this.error = null;
      try {
        const result = await (window as any).electronAPI?.invoke('hsm:get-compliance-status');
        if (result?.success) {
          this.hsmCompliance = result.data;
        } else {
          this.error = result?.error || 'Failed to get compliance status';
        }
      } catch (e: any) {
        this.error = e.message;
      } finally {
        this.loading = false;
      }
    },

    // ==========================================
    // Advanced Crypto
    // ==========================================

    async createSSEIndex(documents: unknown[]): Promise<void> {
      this.loading = true;
      this.error = null;
      try {
        const result = await (window as any).electronAPI?.invoke('adv-crypto:sse-create-index', documents);
        if (result?.success) {
          this.sseIndexes.push(result.data);
        } else {
          this.error = result?.error || 'SSE index creation failed';
        }
      } catch (e: any) {
        this.error = e.message;
      } finally {
        this.loading = false;
      }
    },

    async searchSSEIndex(indexId: string, keyword: string): Promise<unknown[] | null> {
      this.loading = true;
      this.error = null;
      try {
        const result = await (window as any).electronAPI?.invoke('adv-crypto:sse-search', indexId, keyword);
        if (result?.success) {
          return result.data.results;
        }
        this.error = result?.error || 'SSE search failed';
        return null;
      } catch (e: any) {
        this.error = e.message;
        return null;
      } finally {
        this.loading = false;
      }
    },

    async verifiableCompute(program: string, inputs: unknown[]): Promise<unknown | null> {
      this.loading = true;
      this.error = null;
      try {
        const result = await (window as any).electronAPI?.invoke('adv-crypto:verifiable-compute', program, inputs);
        if (result?.success) {
          return result.data;
        }
        this.error = result?.error || 'Computation failed';
        return null;
      } catch (e: any) {
        this.error = e.message;
        return null;
      } finally {
        this.loading = false;
      }
    },

    // ==========================================
    // Module Stats
    // ==========================================

    async fetchModuleStats(module: string): Promise<unknown | null> {
      const channelMap: Record<string, string> = {
        'post-quantum': 'pq:get-stats',
        'zero-knowledge': 'zk:get-stats',
        'homomorphic': 'he:get-stats',
        'mpc': 'mpc:get-stats',
        'hsm': 'hsm:get-stats',
        'advanced': 'adv-crypto:get-stats',
      };
      const channel = channelMap[module];
      if (!channel) return null;

      try {
        const result = await (window as any).electronAPI?.invoke(channel);
        return result?.success ? result.data : null;
      } catch {
        return null;
      }
    },

    setActiveModule(module: string): void {
      this.activeModule = module;
    },

    clearError(): void {
      this.error = null;
    },
  },
});
