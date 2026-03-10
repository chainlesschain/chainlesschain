const { ipcMain } = require("electron");
const { logger } = require("../../utils/logger.js");
const { ZKPProofEngine } = require("./zkp-proof-engine");
const { ZKPVerifiableCredentials } = require("./zkp-verifiable-credentials");

let proofEngine = null;
let vcEngine = null;

function registerZKPIPC(dependencies = {}) {
  logger.info("[ZKP IPC] Registering handlers...");
  const { database, mainWindow } = dependencies;

  if (!proofEngine) {
    proofEngine = new ZKPProofEngine();
  }
  if (!vcEngine) {
    vcEngine = new ZKPVerifiableCredentials();
  }

  // ============================================================
  // Proof Engine (7 channels)
  // ============================================================

  ipcMain.handle(
    "zkp:generate-identity-proof",
    async (event, { proverDid, claims, options }) => {
      try {
        if (!proofEngine.initialized) {
          await proofEngine.initialize(database, {});
        }
        const result = await proofEngine.generateIdentityProof(
          proverDid,
          claims,
          options,
        );
        return { success: true, data: result };
      } catch (error) {
        logger.error(
          "[ZKP IPC] generate-identity-proof failed:",
          error.message,
        );
        return { success: false, error: error.message };
      }
    },
  );

  ipcMain.handle(
    "zkp:generate-range-proof",
    async (event, { proverDid, value, min, max, options }) => {
      try {
        if (!proofEngine.initialized) {
          await proofEngine.initialize(database, {});
        }
        const result = await proofEngine.generateRangeProof(
          proverDid,
          value,
          min,
          max,
          options,
        );
        return { success: true, data: result };
      } catch (error) {
        logger.error("[ZKP IPC] generate-range-proof failed:", error.message);
        return { success: false, error: error.message };
      }
    },
  );

  ipcMain.handle(
    "zkp:generate-membership-proof",
    async (event, { proverDid, element, set, options }) => {
      try {
        if (!proofEngine.initialized) {
          await proofEngine.initialize(database, {});
        }
        const result = await proofEngine.generateMembershipProof(
          proverDid,
          element,
          set,
          options,
        );
        return { success: true, data: result };
      } catch (error) {
        logger.error(
          "[ZKP IPC] generate-membership-proof failed:",
          error.message,
        );
        return { success: false, error: error.message };
      }
    },
  );

  ipcMain.handle("zkp:verify-proof", async (event, { proofId }) => {
    try {
      if (!proofEngine.initialized) {
        await proofEngine.initialize(database, {});
      }
      const result = proofEngine.verifyProof(proofId);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[ZKP IPC] verify-proof failed:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("zkp:list-proofs", async (event, { filter }) => {
    try {
      if (!proofEngine.initialized) {
        await proofEngine.initialize(database, {});
      }
      const result = proofEngine.listProofs(filter);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[ZKP IPC] list-proofs failed:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("zkp:get-proof", async (event, { proofId }) => {
    try {
      if (!proofEngine.initialized) {
        await proofEngine.initialize(database, {});
      }
      const result = proofEngine.getProof(proofId);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[ZKP IPC] get-proof failed:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("zkp:get-stats", async () => {
    try {
      if (!proofEngine.initialized) {
        await proofEngine.initialize(database, {});
      }
      const result = proofEngine.getStats();
      return { success: true, data: result };
    } catch (error) {
      logger.error("[ZKP IPC] get-stats failed:", error.message);
      return { success: false, error: error.message };
    }
  });

  // ============================================================
  // Verifiable Credentials (7 channels)
  // ============================================================

  ipcMain.handle(
    "zkp-vc:issue-credential",
    async (event, { type, issuerDid, subjectDid, claims, expiresAt }) => {
      try {
        if (!vcEngine.initialized) {
          await vcEngine.initialize(database, {});
        }
        const result = vcEngine.issueCredential({
          type,
          issuerDid,
          subjectDid,
          claims,
          expiresAt,
        });
        return { success: true, data: result };
      } catch (error) {
        logger.error("[ZKP IPC] issue-credential failed:", error.message);
        return { success: false, error: error.message };
      }
    },
  );

  ipcMain.handle(
    "zkp-vc:present-credential",
    async (event, { credentialId, disclosedClaimKeys, options }) => {
      try {
        if (!vcEngine.initialized) {
          await vcEngine.initialize(database, {});
        }
        const result = vcEngine.createPresentation(
          credentialId,
          disclosedClaimKeys,
          options,
        );
        return { success: true, data: result };
      } catch (error) {
        logger.error("[ZKP IPC] present-credential failed:", error.message);
        return { success: false, error: error.message };
      }
    },
  );

  ipcMain.handle(
    "zkp-vc:verify-presentation",
    async (event, { presentation }) => {
      try {
        if (!vcEngine.initialized) {
          await vcEngine.initialize(database, {});
        }
        const result = vcEngine.verifyPresentation(presentation);
        return { success: true, data: result };
      } catch (error) {
        logger.error("[ZKP IPC] verify-presentation failed:", error.message);
        return { success: false, error: error.message };
      }
    },
  );

  ipcMain.handle(
    "zkp-vc:selective-disclose",
    async (event, { credentialId, claimKeys }) => {
      try {
        if (!vcEngine.initialized) {
          await vcEngine.initialize(database, {});
        }
        const result = vcEngine.selectiveDisclose(credentialId, claimKeys);
        return { success: true, data: result };
      } catch (error) {
        logger.error("[ZKP IPC] selective-disclose failed:", error.message);
        return { success: false, error: error.message };
      }
    },
  );

  ipcMain.handle(
    "zkp-vc:revoke-credential",
    async (event, { credentialId, revokedBy, reason }) => {
      try {
        if (!vcEngine.initialized) {
          await vcEngine.initialize(database, {});
        }
        vcEngine.revokeCredential(credentialId, revokedBy, reason);
        return { success: true, data: { credentialId, status: "revoked" } };
      } catch (error) {
        logger.error("[ZKP IPC] revoke-credential failed:", error.message);
        return { success: false, error: error.message };
      }
    },
  );

  ipcMain.handle("zkp-vc:list-credentials", async (event, { filter }) => {
    try {
      if (!vcEngine.initialized) {
        await vcEngine.initialize(database, {});
      }
      const result = vcEngine.listCredentials(filter);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[ZKP IPC] list-credentials failed:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("zkp-vc:get-stats", async () => {
    try {
      if (!vcEngine.initialized) {
        await vcEngine.initialize(database, {});
      }
      const result = vcEngine.getStats();
      return { success: true, data: result };
    } catch (error) {
      logger.error("[ZKP IPC] vc-get-stats failed:", error.message);
      return { success: false, error: error.message };
    }
  });

  // ============================================================
  // Event forwarding
  // ============================================================

  if (proofEngine) {
    proofEngine.on("proof:generated", (data) => {
      if (mainWindow) {
        mainWindow.webContents.send("zkp:proof-generated", data);
      }
    });
    proofEngine.on("proof:verified", (data) => {
      if (mainWindow) {
        mainWindow.webContents.send("zkp:proof-verified", data);
      }
    });
  }

  if (vcEngine) {
    vcEngine.on("credential:issued", (data) => {
      if (mainWindow) {
        mainWindow.webContents.send("zkp-vc:credential-issued", data);
      }
    });
    vcEngine.on("credential:revoked", (data) => {
      if (mainWindow) {
        mainWindow.webContents.send("zkp-vc:credential-revoked", data);
      }
    });
    vcEngine.on("presentation:created", (data) => {
      if (mainWindow) {
        mainWindow.webContents.send("zkp-vc:presentation-created", data);
      }
    });
  }

  logger.info("[ZKP IPC] Registered 14 handlers");
}

module.exports = {
  registerZKPIPC,
  getProofEngine: () => proofEngine,
  getVCEngine: () => vcEngine,
};
