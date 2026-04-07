/**
 * Phase 4 (2027 Q1): WebAuthn, ZKP, Federated Learning,
 * IPFS Cluster, GraphQL API
 *
 * Five thin IPC registrations from the cowork module group.
 * Total: 58 handlers.
 *
 * Extracted from ipc-registry.js as part of H2 file split.
 */

function registerPhaseQ12027({ safeRegister, logger, deps }) {
  const { database, mainWindow } = deps;

  // 🔐 WebAuthn / Passkey Manager (10 handlers)
  safeRegister("WebAuthn IPC", {
    register: () => {
      const {
        registerWebAuthnIPC,
      } = require("../../ai-engine/cowork/webauthn-ipc");
      registerWebAuthnIPC({
        database: database || null,
        mainWindow: mainWindow || null,
      });
    },
    handlers: 10,
  });

  // 🔒 Zero-Knowledge Proof (14 handlers)
  safeRegister("ZKP IPC", {
    register: () => {
      const { registerZKPIPC } = require("../../ai-engine/cowork/zkp-ipc");
      registerZKPIPC({
        database: database || null,
        mainWindow: mainWindow || null,
      });
    },
    handlers: 14,
  });

  // 🧠 Federated Learning (14 handlers)
  safeRegister("Federated Learning IPC", {
    register: () => {
      const {
        registerFederatedLearningIPC,
      } = require("../../ai-engine/cowork/federated-learning-ipc");
      registerFederatedLearningIPC({
        database: database || null,
        mainWindow: mainWindow || null,
      });
    },
    handlers: 14,
  });

  // 📦 IPFS Cluster (12 handlers)
  safeRegister("IPFS Cluster IPC", {
    register: () => {
      const {
        registerIPFSClusterIPC,
      } = require("../../ai-engine/cowork/ipfs-cluster-ipc");
      registerIPFSClusterIPC({
        database: database || null,
        mainWindow: mainWindow || null,
      });
    },
    handlers: 12,
  });

  // 🔗 GraphQL API (8 handlers)
  safeRegister("GraphQL API IPC", {
    register: () => {
      const {
        registerGraphQLIPC,
      } = require("../../ai-engine/cowork/graphql-ipc");
      registerGraphQLIPC({
        database: database || null,
        mainWindow: mainWindow || null,
      });
    },
    handlers: 8,
  });

  logger.info("[IPC Registry] ========================================");
  logger.info(
    "[IPC Registry] 2027 Q1 Complete: WebAuthn + ZKP + FL + IPFS Cluster + GraphQL (58 handlers)!",
  );
  logger.info("[IPC Registry] ========================================");
}

module.exports = { registerPhaseQ12027 };
