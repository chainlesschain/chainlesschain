/**
 * Crypto System — Unified IPC Handlers
 *
 * Registers all IPC handlers for:
 * - Post-Quantum Cryptography (14 handlers)
 * - Zero-Knowledge Proofs (13 handlers)
 * - Homomorphic Encryption (16 handlers)
 * - Secure Multi-Party Computation (15 handlers)
 * - HSM Integration (16 handlers)
 * - Advanced Encryption Features (18 handlers)
 *
 * Total: 92 handlers
 *
 * @module crypto/crypto-ipc
 */

const { ipcMain } = require("electron");
const { logger } = require("../utils/logger.js");

const CRYPTO_CHANNELS = [
  // Post-Quantum Cryptography (14)
  "pq:generate-kyber-keypair",
  "pq:encapsulate",
  "pq:decapsulate",
  "pq:generate-dilithium-keypair",
  "pq:dilithium-sign",
  "pq:dilithium-verify",
  "pq:generate-sphincs-keypair",
  "pq:sphincs-sign",
  "pq:sphincs-verify",
  "pq:hybrid-key-exchange",
  "pq:audit-scan",
  "pq:migration-wizard",
  "pq:hybrid-fallback",
  "pq:get-stats",

  // Zero-Knowledge Proofs (13)
  "zk:generate-proof",
  "zk:verify-proof",
  "zk:create-age-proof",
  "zk:create-balance-proof",
  "zk:sso-privacy-proof",
  "zk:create-rollup-batch",
  "zk:verify-rollup-batch",
  "zk:create-audit-key",
  "zk:create-file-integrity-proof",
  "zk:create-query-privacy-proof",
  "zk:create-sync-verification-proof",
  "zk:benchmark-systems",
  "zk:get-stats",

  // Homomorphic Encryption (16)
  "he:paillier-keygen",
  "he:paillier-encrypt",
  "he:paillier-decrypt",
  "he:paillier-add",
  "he:paillier-scalar-multiply",
  "he:tfhe-init",
  "he:tfhe-eval-gate",
  "he:encrypted-sql-query",
  "he:ai-privacy-inference",
  "he:encrypted-search",
  "he:encrypted-data-analysis",
  "he:multi-agent-secure-compute",
  "he:encrypted-backup-verify",
  "he:set-gpu-acceleration",
  "he:set-tiering-strategy",
  "he:get-stats",

  // Secure Multi-Party Computation (15)
  "mpc:shamir-split",
  "mpc:shamir-reconstruct",
  "mpc:social-recovery-setup",
  "mpc:social-recovery-recover",
  "mpc:distributed-key-generation",
  "mpc:garbled-circuit",
  "mpc:oblivious-transfer",
  "mpc:spdz-compute",
  "mpc:threshold-sign",
  "mpc:joint-authentication",
  "mpc:create-channel",
  "mpc:sealed-auction",
  "mpc:federated-learning",
  "mpc:compliance-data-sharing",
  "mpc:get-stats",

  // HSM Integration (16)
  "hsm:register-backend",
  "hsm:select-backend",
  "hsm:generate-key",
  "hsm:sign",
  "hsm:verify",
  "hsm:encrypt",
  "hsm:decrypt",
  "hsm:rotate-key",
  "hsm:destroy-key",
  "hsm:backup-key",
  "hsm:restore-key",
  "hsm:configure-cluster",
  "hsm:get-cluster-status",
  "hsm:batch-encrypt",
  "hsm:get-compliance-status",
  "hsm:get-stats",

  // Advanced Encryption Features (18)
  "adv-crypto:sse-create-index",
  "adv-crypto:sse-search",
  "adv-crypto:fuzzy-encrypted-search",
  "adv-crypto:rag-encrypted-similarity",
  "adv-crypto:generate-re-encryption-key",
  "adv-crypto:proxy-re-encrypt",
  "adv-crypto:p2p-re-encrypted-share",
  "adv-crypto:rbac-re-encryption-delegate",
  "adv-crypto:verifiable-compute",
  "adv-crypto:verify-computation",
  "adv-crypto:llm-output-verify",
  "adv-crypto:audit-proof",
  "adv-crypto:register-algorithm",
  "adv-crypto:switch-algorithm",
  "adv-crypto:key-escrow-setup",
  "adv-crypto:emergency-access",
  "adv-crypto:enhanced-random",
  "adv-crypto:get-stats",
];

/**
 * Register all crypto IPC handlers
 * @param {Object} deps - Manager instances
 */
function registerCryptoIPC(deps) {
  const {
    postQuantumManager,
    zeroKnowledgeManager,
    homomorphicManager,
    mpcManager,
    hsmManager,
    advancedCryptoManager,
  } = deps;

  // ============================================================
  // Post-Quantum Cryptography (14 handlers)
  // ============================================================

  ipcMain.handle("pq:generate-kyber-keypair", async (_event, securityLevel) => {
    try {
      if (!postQuantumManager?.initialized) {
        return { success: false, error: "PostQuantumManager not initialized" };
      }
      const result =
        await postQuantumManager.generateKyberKeyPair(securityLevel);
      return { success: true, data: result };
    } catch (error) {
      logger.error(
        "[CryptoIPC] pq:generate-kyber-keypair error:",
        error.message,
      );
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("pq:encapsulate", async (_event, publicKeyHex) => {
    try {
      if (!postQuantumManager?.initialized) {
        return { success: false, error: "PostQuantumManager not initialized" };
      }
      const result = await postQuantumManager.encapsulate(publicKeyHex);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[CryptoIPC] pq:encapsulate error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle(
    "pq:decapsulate",
    async (_event, ciphertextHex, privateKeyHex) => {
      try {
        if (!postQuantumManager?.initialized) {
          return {
            success: false,
            error: "PostQuantumManager not initialized",
          };
        }
        const result = await postQuantumManager.decapsulate(
          ciphertextHex,
          privateKeyHex,
        );
        return { success: true, data: result };
      } catch (error) {
        logger.error("[CryptoIPC] pq:decapsulate error:", error.message);
        return { success: false, error: error.message };
      }
    },
  );

  ipcMain.handle(
    "pq:generate-dilithium-keypair",
    async (_event, securityLevel) => {
      try {
        if (!postQuantumManager?.initialized) {
          return {
            success: false,
            error: "PostQuantumManager not initialized",
          };
        }
        const result =
          await postQuantumManager.generateDilithiumKeyPair(securityLevel);
        return { success: true, data: result };
      } catch (error) {
        logger.error(
          "[CryptoIPC] pq:generate-dilithium-keypair error:",
          error.message,
        );
        return { success: false, error: error.message };
      }
    },
  );

  ipcMain.handle(
    "pq:dilithium-sign",
    async (_event, message, privateKeyHex) => {
      try {
        if (!postQuantumManager?.initialized) {
          return {
            success: false,
            error: "PostQuantumManager not initialized",
          };
        }
        const result = await postQuantumManager.dilithiumSign(
          message,
          privateKeyHex,
        );
        return { success: true, data: result };
      } catch (error) {
        logger.error("[CryptoIPC] pq:dilithium-sign error:", error.message);
        return { success: false, error: error.message };
      }
    },
  );

  ipcMain.handle(
    "pq:dilithium-verify",
    async (_event, message, signature, publicKeyHex) => {
      try {
        if (!postQuantumManager?.initialized) {
          return {
            success: false,
            error: "PostQuantumManager not initialized",
          };
        }
        const result = await postQuantumManager.dilithiumVerify(
          message,
          signature,
          publicKeyHex,
        );
        return { success: true, data: result };
      } catch (error) {
        logger.error("[CryptoIPC] pq:dilithium-verify error:", error.message);
        return { success: false, error: error.message };
      }
    },
  );

  ipcMain.handle("pq:generate-sphincs-keypair", async (_event, variant) => {
    try {
      if (!postQuantumManager?.initialized) {
        return { success: false, error: "PostQuantumManager not initialized" };
      }
      const result =
        await postQuantumManager.generateSphincsPlusKeyPair(variant);
      return { success: true, data: result };
    } catch (error) {
      logger.error(
        "[CryptoIPC] pq:generate-sphincs-keypair error:",
        error.message,
      );
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("pq:sphincs-sign", async (_event, message, privateKeyHex) => {
    try {
      if (!postQuantumManager?.initialized) {
        return { success: false, error: "PostQuantumManager not initialized" };
      }
      const result = await postQuantumManager.sphincsPlusSign(
        message,
        privateKeyHex,
      );
      return { success: true, data: result };
    } catch (error) {
      logger.error("[CryptoIPC] pq:sphincs-sign error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle(
    "pq:sphincs-verify",
    async (_event, message, signature, publicKeyHex) => {
      try {
        if (!postQuantumManager?.initialized) {
          return {
            success: false,
            error: "PostQuantumManager not initialized",
          };
        }
        const result = await postQuantumManager.sphincsPlusVerify(
          message,
          signature,
          publicKeyHex,
        );
        return { success: true, data: result };
      } catch (error) {
        logger.error("[CryptoIPC] pq:sphincs-verify error:", error.message);
        return { success: false, error: error.message };
      }
    },
  );

  ipcMain.handle(
    "pq:hybrid-key-exchange",
    async (_event, localPrivateHex, remotePublicHex) => {
      try {
        if (!postQuantumManager?.initialized) {
          return {
            success: false,
            error: "PostQuantumManager not initialized",
          };
        }
        const result = await postQuantumManager.hybridKeyExchange(
          localPrivateHex,
          remotePublicHex,
        );
        return { success: true, data: result };
      } catch (error) {
        logger.error(
          "[CryptoIPC] pq:hybrid-key-exchange error:",
          error.message,
        );
        return { success: false, error: error.message };
      }
    },
  );

  ipcMain.handle("pq:audit-scan", async () => {
    try {
      if (!postQuantumManager?.initialized) {
        return { success: false, error: "PostQuantumManager not initialized" };
      }
      const result = await postQuantumManager.auditScan();
      return { success: true, data: result };
    } catch (error) {
      logger.error("[CryptoIPC] pq:audit-scan error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("pq:migration-wizard", async (_event, options) => {
    try {
      if (!postQuantumManager?.initialized) {
        return { success: false, error: "PostQuantumManager not initialized" };
      }
      const result = await postQuantumManager.migrationWizard(options);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[CryptoIPC] pq:migration-wizard error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("pq:hybrid-fallback", async (_event, options) => {
    try {
      if (!postQuantumManager?.initialized) {
        return { success: false, error: "PostQuantumManager not initialized" };
      }
      const result = await postQuantumManager.hybridFallback(options);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[CryptoIPC] pq:hybrid-fallback error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("pq:get-stats", async () => {
    try {
      if (!postQuantumManager?.initialized) {
        return { success: false, error: "PostQuantumManager not initialized" };
      }
      const stats = await postQuantumManager.getStats();
      return { success: true, data: stats };
    } catch (error) {
      logger.error("[CryptoIPC] pq:get-stats error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // ============================================================
  // Zero-Knowledge Proofs (13 handlers)
  // ============================================================

  ipcMain.handle(
    "zk:generate-proof",
    async (_event, statement, witness, options) => {
      try {
        if (!zeroKnowledgeManager?.initialized) {
          return {
            success: false,
            error: "ZeroKnowledgeManager not initialized",
          };
        }
        const result = await zeroKnowledgeManager.generateZKProof(
          statement,
          witness,
          options,
        );
        return { success: true, data: result };
      } catch (error) {
        logger.error("[CryptoIPC] zk:generate-proof error:", error.message);
        return { success: false, error: error.message };
      }
    },
  );

  ipcMain.handle("zk:verify-proof", async (_event, proofId) => {
    try {
      if (!zeroKnowledgeManager?.initialized) {
        return {
          success: false,
          error: "ZeroKnowledgeManager not initialized",
        };
      }
      const result = await zeroKnowledgeManager.verifyZKProof(proofId);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[CryptoIPC] zk:verify-proof error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle(
    "zk:create-age-proof",
    async (_event, birthDate, minimumAge) => {
      try {
        if (!zeroKnowledgeManager?.initialized) {
          return {
            success: false,
            error: "ZeroKnowledgeManager not initialized",
          };
        }
        const result = await zeroKnowledgeManager.createAgeProof(
          birthDate,
          minimumAge,
        );
        return { success: true, data: result };
      } catch (error) {
        logger.error("[CryptoIPC] zk:create-age-proof error:", error.message);
        return { success: false, error: error.message };
      }
    },
  );

  ipcMain.handle(
    "zk:create-balance-proof",
    async (_event, balance, minimumBalance) => {
      try {
        if (!zeroKnowledgeManager?.initialized) {
          return {
            success: false,
            error: "ZeroKnowledgeManager not initialized",
          };
        }
        const result = await zeroKnowledgeManager.createBalanceProof(
          balance,
          minimumBalance,
        );
        return { success: true, data: result };
      } catch (error) {
        logger.error(
          "[CryptoIPC] zk:create-balance-proof error:",
          error.message,
        );
        return { success: false, error: error.message };
      }
    },
  );

  ipcMain.handle(
    "zk:sso-privacy-proof",
    async (_event, attributes, disclosedFields) => {
      try {
        if (!zeroKnowledgeManager?.initialized) {
          return {
            success: false,
            error: "ZeroKnowledgeManager not initialized",
          };
        }
        const result = await zeroKnowledgeManager.ssoPrivacyProof(
          attributes,
          disclosedFields,
        );
        return { success: true, data: result };
      } catch (error) {
        logger.error("[CryptoIPC] zk:sso-privacy-proof error:", error.message);
        return { success: false, error: error.message };
      }
    },
  );

  ipcMain.handle("zk:create-rollup-batch", async (_event, transactions) => {
    try {
      if (!zeroKnowledgeManager?.initialized) {
        return {
          success: false,
          error: "ZeroKnowledgeManager not initialized",
        };
      }
      const result =
        await zeroKnowledgeManager.createZKRollupBatch(transactions);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[CryptoIPC] zk:create-rollup-batch error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("zk:verify-rollup-batch", async (_event, batchId) => {
    try {
      if (!zeroKnowledgeManager?.initialized) {
        return {
          success: false,
          error: "ZeroKnowledgeManager not initialized",
        };
      }
      const result = await zeroKnowledgeManager.verifyZKRollupBatch(batchId);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[CryptoIPC] zk:verify-rollup-batch error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("zk:create-audit-key", async (_event, scope, permissions) => {
    try {
      if (!zeroKnowledgeManager?.initialized) {
        return {
          success: false,
          error: "ZeroKnowledgeManager not initialized",
        };
      }
      const result = await zeroKnowledgeManager.createAuditKey(
        scope,
        permissions,
      );
      return { success: true, data: result };
    } catch (error) {
      logger.error("[CryptoIPC] zk:create-audit-key error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle(
    "zk:create-file-integrity-proof",
    async (_event, filePath, fileHash) => {
      try {
        if (!zeroKnowledgeManager?.initialized) {
          return {
            success: false,
            error: "ZeroKnowledgeManager not initialized",
          };
        }
        const result = await zeroKnowledgeManager.createFileIntegrityProof(
          filePath,
          fileHash,
        );
        return { success: true, data: result };
      } catch (error) {
        logger.error(
          "[CryptoIPC] zk:create-file-integrity-proof error:",
          error.message,
        );
        return { success: false, error: error.message };
      }
    },
  );

  ipcMain.handle(
    "zk:create-query-privacy-proof",
    async (_event, query, resultHash) => {
      try {
        if (!zeroKnowledgeManager?.initialized) {
          return {
            success: false,
            error: "ZeroKnowledgeManager not initialized",
          };
        }
        const result = await zeroKnowledgeManager.createQueryPrivacyProof(
          query,
          resultHash,
        );
        return { success: true, data: result };
      } catch (error) {
        logger.error(
          "[CryptoIPC] zk:create-query-privacy-proof error:",
          error.message,
        );
        return { success: false, error: error.message };
      }
    },
  );

  ipcMain.handle(
    "zk:create-sync-verification-proof",
    async (_event, localState, remoteStateHash) => {
      try {
        if (!zeroKnowledgeManager?.initialized) {
          return {
            success: false,
            error: "ZeroKnowledgeManager not initialized",
          };
        }
        const result = await zeroKnowledgeManager.createSyncVerificationProof(
          localState,
          remoteStateHash,
        );
        return { success: true, data: result };
      } catch (error) {
        logger.error(
          "[CryptoIPC] zk:create-sync-verification-proof error:",
          error.message,
        );
        return { success: false, error: error.message };
      }
    },
  );

  ipcMain.handle("zk:benchmark-systems", async () => {
    try {
      if (!zeroKnowledgeManager?.initialized) {
        return {
          success: false,
          error: "ZeroKnowledgeManager not initialized",
        };
      }
      const result = await zeroKnowledgeManager.benchmarkSystems();
      return { success: true, data: result };
    } catch (error) {
      logger.error("[CryptoIPC] zk:benchmark-systems error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("zk:get-stats", async () => {
    try {
      if (!zeroKnowledgeManager?.initialized) {
        return {
          success: false,
          error: "ZeroKnowledgeManager not initialized",
        };
      }
      const stats = await zeroKnowledgeManager.getStats();
      return { success: true, data: stats };
    } catch (error) {
      logger.error("[CryptoIPC] zk:get-stats error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // ============================================================
  // Homomorphic Encryption (16 handlers)
  // ============================================================

  ipcMain.handle("he:paillier-keygen", async (_event, bitLength) => {
    try {
      if (!homomorphicManager?.initialized) {
        return { success: false, error: "HomomorphicManager not initialized" };
      }
      const result = await homomorphicManager.paillierKeyGen(bitLength);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[CryptoIPC] he:paillier-keygen error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle(
    "he:paillier-encrypt",
    async (_event, plaintext, publicKey) => {
      try {
        if (!homomorphicManager?.initialized) {
          return {
            success: false,
            error: "HomomorphicManager not initialized",
          };
        }
        const result = await homomorphicManager.paillierEncrypt(
          plaintext,
          publicKey,
        );
        return { success: true, data: result };
      } catch (error) {
        logger.error("[CryptoIPC] he:paillier-encrypt error:", error.message);
        return { success: false, error: error.message };
      }
    },
  );

  ipcMain.handle(
    "he:paillier-decrypt",
    async (_event, ciphertext, privateKey) => {
      try {
        if (!homomorphicManager?.initialized) {
          return {
            success: false,
            error: "HomomorphicManager not initialized",
          };
        }
        const result = await homomorphicManager.paillierDecrypt(
          ciphertext,
          privateKey,
        );
        return { success: true, data: result };
      } catch (error) {
        logger.error("[CryptoIPC] he:paillier-decrypt error:", error.message);
        return { success: false, error: error.message };
      }
    },
  );

  ipcMain.handle(
    "he:paillier-add",
    async (_event, ciphertext1, ciphertext2, publicKey) => {
      try {
        if (!homomorphicManager?.initialized) {
          return {
            success: false,
            error: "HomomorphicManager not initialized",
          };
        }
        const result = await homomorphicManager.paillierAdd(
          ciphertext1,
          ciphertext2,
          publicKey,
        );
        return { success: true, data: result };
      } catch (error) {
        logger.error("[CryptoIPC] he:paillier-add error:", error.message);
        return { success: false, error: error.message };
      }
    },
  );

  ipcMain.handle(
    "he:paillier-scalar-multiply",
    async (_event, ciphertext, scalar, publicKey) => {
      try {
        if (!homomorphicManager?.initialized) {
          return {
            success: false,
            error: "HomomorphicManager not initialized",
          };
        }
        const result = await homomorphicManager.paillierScalarMultiply(
          ciphertext,
          scalar,
          publicKey,
        );
        return { success: true, data: result };
      } catch (error) {
        logger.error(
          "[CryptoIPC] he:paillier-scalar-multiply error:",
          error.message,
        );
        return { success: false, error: error.message };
      }
    },
  );

  ipcMain.handle("he:tfhe-init", async (_event, securityParam) => {
    try {
      if (!homomorphicManager?.initialized) {
        return { success: false, error: "HomomorphicManager not initialized" };
      }
      const result = await homomorphicManager.tfheInit(securityParam);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[CryptoIPC] he:tfhe-init error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle(
    "he:tfhe-eval-gate",
    async (_event, gate, input1, input2, contextId) => {
      try {
        if (!homomorphicManager?.initialized) {
          return {
            success: false,
            error: "HomomorphicManager not initialized",
          };
        }
        const result = await homomorphicManager.tfheEvalGate(
          gate,
          input1,
          input2,
          contextId,
        );
        return { success: true, data: result };
      } catch (error) {
        logger.error("[CryptoIPC] he:tfhe-eval-gate error:", error.message);
        return { success: false, error: error.message };
      }
    },
  );

  ipcMain.handle(
    "he:encrypted-sql-query",
    async (_event, query, encryptedData) => {
      try {
        if (!homomorphicManager?.initialized) {
          return {
            success: false,
            error: "HomomorphicManager not initialized",
          };
        }
        const result = await homomorphicManager.encryptedSQLQuery(
          query,
          encryptedData,
        );
        return { success: true, data: result };
      } catch (error) {
        logger.error(
          "[CryptoIPC] he:encrypted-sql-query error:",
          error.message,
        );
        return { success: false, error: error.message };
      }
    },
  );

  ipcMain.handle(
    "he:ai-privacy-inference",
    async (_event, modelId, encryptedInput) => {
      try {
        if (!homomorphicManager?.initialized) {
          return {
            success: false,
            error: "HomomorphicManager not initialized",
          };
        }
        const result = await homomorphicManager.aiPrivacyInference(
          modelId,
          encryptedInput,
        );
        return { success: true, data: result };
      } catch (error) {
        logger.error(
          "[CryptoIPC] he:ai-privacy-inference error:",
          error.message,
        );
        return { success: false, error: error.message };
      }
    },
  );

  ipcMain.handle(
    "he:encrypted-search",
    async (_event, searchTerm, encryptedIndex) => {
      try {
        if (!homomorphicManager?.initialized) {
          return {
            success: false,
            error: "HomomorphicManager not initialized",
          };
        }
        const result = await homomorphicManager.encryptedSearch(
          searchTerm,
          encryptedIndex,
        );
        return { success: true, data: result };
      } catch (error) {
        logger.error("[CryptoIPC] he:encrypted-search error:", error.message);
        return { success: false, error: error.message };
      }
    },
  );

  ipcMain.handle(
    "he:encrypted-data-analysis",
    async (_event, dataset, operation) => {
      try {
        if (!homomorphicManager?.initialized) {
          return {
            success: false,
            error: "HomomorphicManager not initialized",
          };
        }
        const result = await homomorphicManager.encryptedDataAnalysis(
          dataset,
          operation,
        );
        return { success: true, data: result };
      } catch (error) {
        logger.error(
          "[CryptoIPC] he:encrypted-data-analysis error:",
          error.message,
        );
        return { success: false, error: error.message };
      }
    },
  );

  ipcMain.handle(
    "he:multi-agent-secure-compute",
    async (_event, agents, computation) => {
      try {
        if (!homomorphicManager?.initialized) {
          return {
            success: false,
            error: "HomomorphicManager not initialized",
          };
        }
        const result = await homomorphicManager.multiAgentSecureCompute(
          agents,
          computation,
        );
        return { success: true, data: result };
      } catch (error) {
        logger.error(
          "[CryptoIPC] he:multi-agent-secure-compute error:",
          error.message,
        );
        return { success: false, error: error.message };
      }
    },
  );

  ipcMain.handle(
    "he:encrypted-backup-verify",
    async (_event, backupId, expectedHash) => {
      try {
        if (!homomorphicManager?.initialized) {
          return {
            success: false,
            error: "HomomorphicManager not initialized",
          };
        }
        const result = await homomorphicManager.encryptedBackupVerify(
          backupId,
          expectedHash,
        );
        return { success: true, data: result };
      } catch (error) {
        logger.error(
          "[CryptoIPC] he:encrypted-backup-verify error:",
          error.message,
        );
        return { success: false, error: error.message };
      }
    },
  );

  ipcMain.handle("he:set-gpu-acceleration", async (_event, enabled) => {
    try {
      if (!homomorphicManager?.initialized) {
        return { success: false, error: "HomomorphicManager not initialized" };
      }
      const result = await homomorphicManager.setGPUAcceleration(enabled);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[CryptoIPC] he:set-gpu-acceleration error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("he:set-tiering-strategy", async (_event, strategy) => {
    try {
      if (!homomorphicManager?.initialized) {
        return { success: false, error: "HomomorphicManager not initialized" };
      }
      const result = await homomorphicManager.setTieringStrategy(strategy);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[CryptoIPC] he:set-tiering-strategy error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("he:get-stats", async () => {
    try {
      if (!homomorphicManager?.initialized) {
        return { success: false, error: "HomomorphicManager not initialized" };
      }
      const stats = await homomorphicManager.getStats();
      return { success: true, data: stats };
    } catch (error) {
      logger.error("[CryptoIPC] he:get-stats error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // ============================================================
  // Secure Multi-Party Computation (15 handlers)
  // ============================================================

  ipcMain.handle(
    "mpc:shamir-split",
    async (_event, secret, totalShares, threshold) => {
      try {
        if (!mpcManager?.initialized) {
          return { success: false, error: "MPCManager not initialized" };
        }
        const result = await mpcManager.shamirSplit(
          secret,
          totalShares,
          threshold,
        );
        return { success: true, data: result };
      } catch (error) {
        logger.error("[CryptoIPC] mpc:shamir-split error:", error.message);
        return { success: false, error: error.message };
      }
    },
  );

  ipcMain.handle("mpc:shamir-reconstruct", async (_event, shares) => {
    try {
      if (!mpcManager?.initialized) {
        return { success: false, error: "MPCManager not initialized" };
      }
      const result = await mpcManager.shamirReconstruct(shares);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[CryptoIPC] mpc:shamir-reconstruct error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle(
    "mpc:social-recovery-setup",
    async (_event, userId, guardians, threshold) => {
      try {
        if (!mpcManager?.initialized) {
          return { success: false, error: "MPCManager not initialized" };
        }
        const result = await mpcManager.socialRecoverySetup(
          userId,
          guardians,
          threshold,
        );
        return { success: true, data: result };
      } catch (error) {
        logger.error(
          "[CryptoIPC] mpc:social-recovery-setup error:",
          error.message,
        );
        return { success: false, error: error.message };
      }
    },
  );

  ipcMain.handle(
    "mpc:social-recovery-recover",
    async (_event, guardianShares) => {
      try {
        if (!mpcManager?.initialized) {
          return { success: false, error: "MPCManager not initialized" };
        }
        const result = await mpcManager.socialRecoveryRecover(guardianShares);
        return { success: true, data: result };
      } catch (error) {
        logger.error(
          "[CryptoIPC] mpc:social-recovery-recover error:",
          error.message,
        );
        return { success: false, error: error.message };
      }
    },
  );

  ipcMain.handle(
    "mpc:distributed-key-generation",
    async (_event, participants, threshold) => {
      try {
        if (!mpcManager?.initialized) {
          return { success: false, error: "MPCManager not initialized" };
        }
        const result = await mpcManager.distributedKeyGeneration(
          participants,
          threshold,
        );
        return { success: true, data: result };
      } catch (error) {
        logger.error(
          "[CryptoIPC] mpc:distributed-key-generation error:",
          error.message,
        );
        return { success: false, error: error.message };
      }
    },
  );

  ipcMain.handle("mpc:garbled-circuit", async (_event, circuit, inputs) => {
    try {
      if (!mpcManager?.initialized) {
        return { success: false, error: "MPCManager not initialized" };
      }
      const result = await mpcManager.garbledCircuit(circuit, inputs);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[CryptoIPC] mpc:garbled-circuit error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle(
    "mpc:oblivious-transfer",
    async (_event, senderInputs, receiverChoice) => {
      try {
        if (!mpcManager?.initialized) {
          return { success: false, error: "MPCManager not initialized" };
        }
        const result = await mpcManager.obliviousTransfer(
          senderInputs,
          receiverChoice,
        );
        return { success: true, data: result };
      } catch (error) {
        logger.error(
          "[CryptoIPC] mpc:oblivious-transfer error:",
          error.message,
        );
        return { success: false, error: error.message };
      }
    },
  );

  ipcMain.handle(
    "mpc:spdz-compute",
    async (_event, expression, participantValues) => {
      try {
        if (!mpcManager?.initialized) {
          return { success: false, error: "MPCManager not initialized" };
        }
        const result = await mpcManager.spdzCompute(
          expression,
          participantValues,
        );
        return { success: true, data: result };
      } catch (error) {
        logger.error("[CryptoIPC] mpc:spdz-compute error:", error.message);
        return { success: false, error: error.message };
      }
    },
  );

  ipcMain.handle(
    "mpc:threshold-sign",
    async (_event, message, shares, threshold) => {
      try {
        if (!mpcManager?.initialized) {
          return { success: false, error: "MPCManager not initialized" };
        }
        const result = await mpcManager.thresholdSign(
          message,
          shares,
          threshold,
        );
        return { success: true, data: result };
      } catch (error) {
        logger.error("[CryptoIPC] mpc:threshold-sign error:", error.message);
        return { success: false, error: error.message };
      }
    },
  );

  ipcMain.handle(
    "mpc:joint-authentication",
    async (_event, participants, challenge) => {
      try {
        if (!mpcManager?.initialized) {
          return { success: false, error: "MPCManager not initialized" };
        }
        const result = await mpcManager.jointAuthentication(
          participants,
          challenge,
        );
        return { success: true, data: result };
      } catch (error) {
        logger.error(
          "[CryptoIPC] mpc:joint-authentication error:",
          error.message,
        );
        return { success: false, error: error.message };
      }
    },
  );

  ipcMain.handle(
    "mpc:create-channel",
    async (_event, participants, protocol) => {
      try {
        if (!mpcManager?.initialized) {
          return { success: false, error: "MPCManager not initialized" };
        }
        const result = await mpcManager.createMPCChannel(
          participants,
          protocol,
        );
        return { success: true, data: result };
      } catch (error) {
        logger.error("[CryptoIPC] mpc:create-channel error:", error.message);
        return { success: false, error: error.message };
      }
    },
  );

  ipcMain.handle("mpc:sealed-auction", async (_event, bids) => {
    try {
      if (!mpcManager?.initialized) {
        return { success: false, error: "MPCManager not initialized" };
      }
      const result = await mpcManager.sealedAuction(bids);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[CryptoIPC] mpc:sealed-auction error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle(
    "mpc:federated-learning",
    async (_event, modelId, participantUpdates) => {
      try {
        if (!mpcManager?.initialized) {
          return { success: false, error: "MPCManager not initialized" };
        }
        const result = await mpcManager.federatedLearning(
          modelId,
          participantUpdates,
        );
        return { success: true, data: result };
      } catch (error) {
        logger.error(
          "[CryptoIPC] mpc:federated-learning error:",
          error.message,
        );
        return { success: false, error: error.message };
      }
    },
  );

  ipcMain.handle(
    "mpc:compliance-data-sharing",
    async (_event, dataOwners, query, policy) => {
      try {
        if (!mpcManager?.initialized) {
          return { success: false, error: "MPCManager not initialized" };
        }
        const result = await mpcManager.complianceDataSharing(
          dataOwners,
          query,
          policy,
        );
        return { success: true, data: result };
      } catch (error) {
        logger.error(
          "[CryptoIPC] mpc:compliance-data-sharing error:",
          error.message,
        );
        return { success: false, error: error.message };
      }
    },
  );

  ipcMain.handle("mpc:get-stats", async () => {
    try {
      if (!mpcManager?.initialized) {
        return { success: false, error: "MPCManager not initialized" };
      }
      const stats = await mpcManager.getStats();
      return { success: true, data: stats };
    } catch (error) {
      logger.error("[CryptoIPC] mpc:get-stats error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // ============================================================
  // HSM Integration (16 handlers)
  // ============================================================

  ipcMain.handle("hsm:register-backend", async (_event, name, config) => {
    try {
      if (!hsmManager?.initialized) {
        return { success: false, error: "HSMManager not initialized" };
      }
      const result = await hsmManager.registerBackend(name, config);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[CryptoIPC] hsm:register-backend error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("hsm:select-backend", async (_event, name) => {
    try {
      if (!hsmManager?.initialized) {
        return { success: false, error: "HSMManager not initialized" };
      }
      const result = await hsmManager.selectBackend(name);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[CryptoIPC] hsm:select-backend error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle(
    "hsm:generate-key",
    async (_event, alias, algorithm, options) => {
      try {
        if (!hsmManager?.initialized) {
          return { success: false, error: "HSMManager not initialized" };
        }
        const result = await hsmManager.generateKey(alias, algorithm, options);
        return { success: true, data: result };
      } catch (error) {
        logger.error("[CryptoIPC] hsm:generate-key error:", error.message);
        return { success: false, error: error.message };
      }
    },
  );

  ipcMain.handle("hsm:sign", async (_event, keyAlias, data) => {
    try {
      if (!hsmManager?.initialized) {
        return { success: false, error: "HSMManager not initialized" };
      }
      const result = await hsmManager.sign(keyAlias, data);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[CryptoIPC] hsm:sign error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("hsm:verify", async (_event, keyAlias, data, signature) => {
    try {
      if (!hsmManager?.initialized) {
        return { success: false, error: "HSMManager not initialized" };
      }
      const result = await hsmManager.verify(keyAlias, data, signature);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[CryptoIPC] hsm:verify error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("hsm:encrypt", async (_event, keyAlias, plaintext) => {
    try {
      if (!hsmManager?.initialized) {
        return { success: false, error: "HSMManager not initialized" };
      }
      const result = await hsmManager.encrypt(keyAlias, plaintext);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[CryptoIPC] hsm:encrypt error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("hsm:decrypt", async (_event, keyAlias, ciphertext, iv) => {
    try {
      if (!hsmManager?.initialized) {
        return { success: false, error: "HSMManager not initialized" };
      }
      const result = await hsmManager.decrypt(keyAlias, ciphertext, iv);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[CryptoIPC] hsm:decrypt error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("hsm:rotate-key", async (_event, keyAlias) => {
    try {
      if (!hsmManager?.initialized) {
        return { success: false, error: "HSMManager not initialized" };
      }
      const result = await hsmManager.rotateKey(keyAlias);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[CryptoIPC] hsm:rotate-key error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("hsm:destroy-key", async (_event, keyAlias) => {
    try {
      if (!hsmManager?.initialized) {
        return { success: false, error: "HSMManager not initialized" };
      }
      const result = await hsmManager.destroyKey(keyAlias);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[CryptoIPC] hsm:destroy-key error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("hsm:backup-key", async (_event, keyAlias) => {
    try {
      if (!hsmManager?.initialized) {
        return { success: false, error: "HSMManager not initialized" };
      }
      const result = await hsmManager.backupKey(keyAlias);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[CryptoIPC] hsm:backup-key error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("hsm:restore-key", async (_event, backupId, backupData) => {
    try {
      if (!hsmManager?.initialized) {
        return { success: false, error: "HSMManager not initialized" };
      }
      const result = await hsmManager.restoreKey(backupId, backupData);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[CryptoIPC] hsm:restore-key error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("hsm:configure-cluster", async (_event, nodes) => {
    try {
      if (!hsmManager?.initialized) {
        return { success: false, error: "HSMManager not initialized" };
      }
      const result = await hsmManager.configureCluster(nodes);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[CryptoIPC] hsm:configure-cluster error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("hsm:get-cluster-status", async () => {
    try {
      if (!hsmManager?.initialized) {
        return { success: false, error: "HSMManager not initialized" };
      }
      const result = await hsmManager.getClusterStatus();
      return { success: true, data: result };
    } catch (error) {
      logger.error("[CryptoIPC] hsm:get-cluster-status error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("hsm:batch-encrypt", async (_event, keyAlias, items) => {
    try {
      if (!hsmManager?.initialized) {
        return { success: false, error: "HSMManager not initialized" };
      }
      const result = await hsmManager.batchEncrypt(keyAlias, items);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[CryptoIPC] hsm:batch-encrypt error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("hsm:get-compliance-status", async () => {
    try {
      if (!hsmManager?.initialized) {
        return { success: false, error: "HSMManager not initialized" };
      }
      const result = await hsmManager.getComplianceStatus();
      return { success: true, data: result };
    } catch (error) {
      logger.error(
        "[CryptoIPC] hsm:get-compliance-status error:",
        error.message,
      );
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("hsm:get-stats", async () => {
    try {
      if (!hsmManager?.initialized) {
        return { success: false, error: "HSMManager not initialized" };
      }
      const stats = await hsmManager.getStats();
      return { success: true, data: stats };
    } catch (error) {
      logger.error("[CryptoIPC] hsm:get-stats error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // ============================================================
  // Advanced Encryption Features (18 handlers)
  // ============================================================

  ipcMain.handle("adv-crypto:sse-create-index", async (_event, documents) => {
    try {
      if (!advancedCryptoManager?.initialized) {
        return {
          success: false,
          error: "AdvancedCryptoManager not initialized",
        };
      }
      const result = await advancedCryptoManager.sseCreateIndex(documents);
      return { success: true, data: result };
    } catch (error) {
      logger.error(
        "[CryptoIPC] adv-crypto:sse-create-index error:",
        error.message,
      );
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("adv-crypto:sse-search", async (_event, indexId, keyword) => {
    try {
      if (!advancedCryptoManager?.initialized) {
        return {
          success: false,
          error: "AdvancedCryptoManager not initialized",
        };
      }
      const result = await advancedCryptoManager.sseSearch(indexId, keyword);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[CryptoIPC] adv-crypto:sse-search error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle(
    "adv-crypto:fuzzy-encrypted-search",
    async (_event, indexId, keyword, threshold) => {
      try {
        if (!advancedCryptoManager?.initialized) {
          return {
            success: false,
            error: "AdvancedCryptoManager not initialized",
          };
        }
        const result = await advancedCryptoManager.fuzzyEncryptedSearch(
          indexId,
          keyword,
          threshold,
        );
        return { success: true, data: result };
      } catch (error) {
        logger.error(
          "[CryptoIPC] adv-crypto:fuzzy-encrypted-search error:",
          error.message,
        );
        return { success: false, error: error.message };
      }
    },
  );

  ipcMain.handle(
    "adv-crypto:rag-encrypted-similarity",
    async (_event, indexId, queryVector, topK) => {
      try {
        if (!advancedCryptoManager?.initialized) {
          return {
            success: false,
            error: "AdvancedCryptoManager not initialized",
          };
        }
        const result = await advancedCryptoManager.ragEncryptedSimilarity(
          indexId,
          queryVector,
          topK,
        );
        return { success: true, data: result };
      } catch (error) {
        logger.error(
          "[CryptoIPC] adv-crypto:rag-encrypted-similarity error:",
          error.message,
        );
        return { success: false, error: error.message };
      }
    },
  );

  ipcMain.handle(
    "adv-crypto:generate-re-encryption-key",
    async (_event, delegatorKey, delegateePublicKey) => {
      try {
        if (!advancedCryptoManager?.initialized) {
          return {
            success: false,
            error: "AdvancedCryptoManager not initialized",
          };
        }
        const result = await advancedCryptoManager.generateReEncryptionKey(
          delegatorKey,
          delegateePublicKey,
        );
        return { success: true, data: result };
      } catch (error) {
        logger.error(
          "[CryptoIPC] adv-crypto:generate-re-encryption-key error:",
          error.message,
        );
        return { success: false, error: error.message };
      }
    },
  );

  ipcMain.handle(
    "adv-crypto:proxy-re-encrypt",
    async (_event, ciphertext, reKeyId) => {
      try {
        if (!advancedCryptoManager?.initialized) {
          return {
            success: false,
            error: "AdvancedCryptoManager not initialized",
          };
        }
        const result = await advancedCryptoManager.proxyReEncrypt(
          ciphertext,
          reKeyId,
        );
        return { success: true, data: result };
      } catch (error) {
        logger.error(
          "[CryptoIPC] adv-crypto:proxy-re-encrypt error:",
          error.message,
        );
        return { success: false, error: error.message };
      }
    },
  );

  ipcMain.handle(
    "adv-crypto:p2p-re-encrypted-share",
    async (_event, senderId, receiverId, data) => {
      try {
        if (!advancedCryptoManager?.initialized) {
          return {
            success: false,
            error: "AdvancedCryptoManager not initialized",
          };
        }
        const result = await advancedCryptoManager.p2pReEncryptedShare(
          senderId,
          receiverId,
          data,
        );
        return { success: true, data: result };
      } catch (error) {
        logger.error(
          "[CryptoIPC] adv-crypto:p2p-re-encrypted-share error:",
          error.message,
        );
        return { success: false, error: error.message };
      }
    },
  );

  ipcMain.handle(
    "adv-crypto:rbac-re-encryption-delegate",
    async (_event, role, targetRole, permissions) => {
      try {
        if (!advancedCryptoManager?.initialized) {
          return {
            success: false,
            error: "AdvancedCryptoManager not initialized",
          };
        }
        const result = await advancedCryptoManager.rbacReEncryptionDelegate(
          role,
          targetRole,
          permissions,
        );
        return { success: true, data: result };
      } catch (error) {
        logger.error(
          "[CryptoIPC] adv-crypto:rbac-re-encryption-delegate error:",
          error.message,
        );
        return { success: false, error: error.message };
      }
    },
  );

  ipcMain.handle(
    "adv-crypto:verifiable-compute",
    async (_event, program, inputs) => {
      try {
        if (!advancedCryptoManager?.initialized) {
          return {
            success: false,
            error: "AdvancedCryptoManager not initialized",
          };
        }
        const result = await advancedCryptoManager.verifiableCompute(
          program,
          inputs,
        );
        return { success: true, data: result };
      } catch (error) {
        logger.error(
          "[CryptoIPC] adv-crypto:verifiable-compute error:",
          error.message,
        );
        return { success: false, error: error.message };
      }
    },
  );

  ipcMain.handle("adv-crypto:verify-computation", async (_event, resultId) => {
    try {
      if (!advancedCryptoManager?.initialized) {
        return {
          success: false,
          error: "AdvancedCryptoManager not initialized",
        };
      }
      const result = await advancedCryptoManager.verifyComputation(resultId);
      return { success: true, data: result };
    } catch (error) {
      logger.error(
        "[CryptoIPC] adv-crypto:verify-computation error:",
        error.message,
      );
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle(
    "adv-crypto:llm-output-verify",
    async (_event, prompt, output, modelId) => {
      try {
        if (!advancedCryptoManager?.initialized) {
          return {
            success: false,
            error: "AdvancedCryptoManager not initialized",
          };
        }
        const result = await advancedCryptoManager.llmOutputVerify(
          prompt,
          output,
          modelId,
        );
        return { success: true, data: result };
      } catch (error) {
        logger.error(
          "[CryptoIPC] adv-crypto:llm-output-verify error:",
          error.message,
        );
        return { success: false, error: error.message };
      }
    },
  );

  ipcMain.handle("adv-crypto:audit-proof", async (_event, operationId) => {
    try {
      if (!advancedCryptoManager?.initialized) {
        return {
          success: false,
          error: "AdvancedCryptoManager not initialized",
        };
      }
      const result = await advancedCryptoManager.auditProof(operationId);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[CryptoIPC] adv-crypto:audit-proof error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle(
    "adv-crypto:register-algorithm",
    async (_event, name, config) => {
      try {
        if (!advancedCryptoManager?.initialized) {
          return {
            success: false,
            error: "AdvancedCryptoManager not initialized",
          };
        }
        const result = await advancedCryptoManager.registerAlgorithm(
          name,
          config,
        );
        return { success: true, data: result };
      } catch (error) {
        logger.error(
          "[CryptoIPC] adv-crypto:register-algorithm error:",
          error.message,
        );
        return { success: false, error: error.message };
      }
    },
  );

  ipcMain.handle(
    "adv-crypto:switch-algorithm",
    async (_event, from, to, scope) => {
      try {
        if (!advancedCryptoManager?.initialized) {
          return {
            success: false,
            error: "AdvancedCryptoManager not initialized",
          };
        }
        const result = await advancedCryptoManager.switchAlgorithm(
          from,
          to,
          scope,
        );
        return { success: true, data: result };
      } catch (error) {
        logger.error(
          "[CryptoIPC] adv-crypto:switch-algorithm error:",
          error.message,
        );
        return { success: false, error: error.message };
      }
    },
  );

  ipcMain.handle(
    "adv-crypto:key-escrow-setup",
    async (_event, keyId, escrowAgents, threshold) => {
      try {
        if (!advancedCryptoManager?.initialized) {
          return {
            success: false,
            error: "AdvancedCryptoManager not initialized",
          };
        }
        const result = await advancedCryptoManager.keyEscrowSetup(
          keyId,
          escrowAgents,
          threshold,
        );
        return { success: true, data: result };
      } catch (error) {
        logger.error(
          "[CryptoIPC] adv-crypto:key-escrow-setup error:",
          error.message,
        );
        return { success: false, error: error.message };
      }
    },
  );

  ipcMain.handle(
    "adv-crypto:emergency-access",
    async (_event, escrowId, agentApprovals) => {
      try {
        if (!advancedCryptoManager?.initialized) {
          return {
            success: false,
            error: "AdvancedCryptoManager not initialized",
          };
        }
        const result = await advancedCryptoManager.emergencyAccess(
          escrowId,
          agentApprovals,
        );
        return { success: true, data: result };
      } catch (error) {
        logger.error(
          "[CryptoIPC] adv-crypto:emergency-access error:",
          error.message,
        );
        return { success: false, error: error.message };
      }
    },
  );

  ipcMain.handle(
    "adv-crypto:enhanced-random",
    async (_event, length, source) => {
      try {
        if (!advancedCryptoManager?.initialized) {
          return {
            success: false,
            error: "AdvancedCryptoManager not initialized",
          };
        }
        const result = await advancedCryptoManager.enhancedRandom(
          length,
          source,
        );
        return { success: true, data: result };
      } catch (error) {
        logger.error(
          "[CryptoIPC] adv-crypto:enhanced-random error:",
          error.message,
        );
        return { success: false, error: error.message };
      }
    },
  );

  ipcMain.handle("adv-crypto:get-stats", async () => {
    try {
      if (!advancedCryptoManager?.initialized) {
        return {
          success: false,
          error: "AdvancedCryptoManager not initialized",
        };
      }
      const stats = await advancedCryptoManager.getStats();
      return { success: true, data: stats };
    } catch (error) {
      logger.error("[CryptoIPC] adv-crypto:get-stats error:", error.message);
      return { success: false, error: error.message };
    }
  });

  logger.info(`[CryptoIPC] Registered ${CRYPTO_CHANNELS.length} IPC handlers`);

  return { handlerCount: CRYPTO_CHANNELS.length };
}

/**
 * Unregister all crypto IPC handlers
 */
function unregisterCryptoIPC() {
  for (const channel of CRYPTO_CHANNELS) {
    ipcMain.removeHandler(channel);
  }
  logger.info("[CryptoIPC] Unregistered all handlers");
}

module.exports = {
  registerCryptoIPC,
  unregisterCryptoIPC,
  CRYPTO_CHANNELS,
};
