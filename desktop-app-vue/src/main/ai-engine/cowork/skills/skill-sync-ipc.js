/**
 * Skill Sync IPC Handlers
 *
 * 7 IPC handlers for cross-device skill synchronization and migration.
 *
 * @module ai-engine/cowork/skills/skill-sync-ipc
 * @version 1.0.0
 */

const { logger } = require("../../../utils/logger.js");
const {
  EVOLVABLE_ARTIFACT_PERSISTENCE_RECEIPT_SCHEMA,
} = require("@chainlesschain/session-core/evolvable-artifact");

const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;

function ipcError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function assertIpcArgs(args, requiredFields) {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    throw ipcError(
      "CC_SKILL_SYNC_IPC_INVALID_ARGUMENT",
      "Skill sync IPC arguments must be an object",
    );
  }
  for (const field of requiredFields) {
    const descriptor = Object.getOwnPropertyDescriptor(args, field);
    if (!descriptor || !("value" in descriptor)) {
      throw ipcError(
        "CC_SKILL_SYNC_IPC_INVALID_ARGUMENT",
        `Skill sync IPC argument ${field} is required`,
      );
    }
  }
  return args;
}

function failureResponse(error) {
  const response = {
    success: false,
    error:
      error && typeof error.message === "string"
        ? error.message
        : "Skill sync operation failed",
  };
  if (error && typeof error.code === "string" && error.code.length > 0) {
    response.code = error.code;
  }
  return response;
}

function isSafeImportResult(result) {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return false;
  }
  if (result.action === "skipped") {
    return (
      result.candidateOnly === true &&
      result.persisted === false &&
      result.activeMutation === false &&
      result.hotLoaded === false &&
      result.reloadRequired === false
    );
  }
  return (
    result.action === "candidate-staged" &&
    typeof result.skillId === "string" &&
    typeof result.candidateId === "string" &&
    DIGEST_PATTERN.test(result.candidateId) &&
    typeof result.sourceDigest === "string" &&
    DIGEST_PATTERN.test(result.sourceDigest) &&
    typeof result.artifactDigest === "string" &&
    DIGEST_PATTERN.test(result.artifactDigest) &&
    result.persistenceReceipt?.schema ===
      EVOLVABLE_ARTIFACT_PERSISTENCE_RECEIPT_SCHEMA &&
    result.persistenceReceipt.type === "skill" &&
    result.persistenceReceipt.candidateId === result.candidateId &&
    result.persistenceReceipt.contentDigest === result.sourceDigest &&
    result.persistenceReceipt.artifactDigest === result.artifactDigest &&
    result.persistenceReceipt.status === "candidate" &&
    result.persistenceReceipt.persisted === true &&
    result.candidateOnly === true &&
    result.persisted === true &&
    result.trust === "untrusted" &&
    result.quarantined === true &&
    result.activeMutation === false &&
    result.hotLoaded === false &&
    result.reloadRequired === false
  );
}

function assertSafeImportResult(result) {
  if (!isSafeImportResult(result)) {
    throw ipcError(
      "CC_SKILL_SYNC_IMPORT_RESULT_INVALID",
      "Skill sync import did not produce a verified candidate-only outcome",
    );
  }
  return result;
}

/**
 * Register skill sync IPC handlers
 * @param {Object} options
 * @param {import('./skill-sync-manager').SkillSyncManager} options.syncManager
 * @param {Electron.IpcMain} [options.ipcMain] - Injectable test/runtime port
 */
function registerSkillSyncIPC(options = {}) {
  const syncManager = options.syncManager || null;
  const ipcMain = options.ipcMain || require("electron").ipcMain;
  if (!ipcMain || typeof ipcMain.handle !== "function") {
    throw new TypeError("ipcMain.handle is required");
  }
  if (!syncManager || typeof syncManager.importSkill !== "function") {
    throw new TypeError("syncManager.importSkill is required");
  }

  logger.info("[SkillSyncIPC] Registering 7 handlers...");

  // 1. Export skill to transferable package
  ipcMain.handle("skills:sync:export", async (_event, args) => {
    try {
      const { skillId } = assertIpcArgs(args, ["skillId"]);
      const pkg = syncManager.exportSkill(skillId);
      return { success: true, data: pkg };
    } catch (error) {
      logger.error("[SkillSyncIPC] export error:", error.message);
      return failureResponse(error);
    }
  });

  // 2. Import skill package
  ipcMain.handle("skills:sync:import", async (_event, args) => {
    try {
      const { package: pkg } = assertIpcArgs(args, ["package"]);
      const result = assertSafeImportResult(await syncManager.importSkill(pkg));
      return { success: true, data: result };
    } catch (error) {
      logger.error("[SkillSyncIPC] import error:", error.message);
      return failureResponse(error);
    }
  });

  // 3. Get skills from connected peer
  ipcMain.handle("skills:sync:get-peer-catalog", async (_event, args) => {
    try {
      const { peerId } = assertIpcArgs(args, ["peerId"]);
      await syncManager.requestPeerCatalog(peerId);
      return { success: true, message: "Catalog request sent" };
    } catch (error) {
      logger.error("[SkillSyncIPC] get-peer-catalog error:", error.message);
      return failureResponse(error);
    }
  });

  // 4. Download specific skill from peer
  ipcMain.handle("skills:sync:download-from-peer", async (_event, args) => {
    try {
      const { peerId, skillId } = assertIpcArgs(args, ["peerId", "skillId"]);
      await syncManager.downloadFromPeer(peerId, skillId);
      return { success: true, message: "Download request sent" };
    } catch (error) {
      logger.error("[SkillSyncIPC] download-from-peer error:", error.message);
      return failureResponse(error);
    }
  });

  // 5. Broadcast local catalog to all peers
  ipcMain.handle("skills:sync:broadcast-catalog", async () => {
    try {
      if (!syncManager) {
        return { success: false, error: "SyncManager not initialized" };
      }
      const result = await syncManager.broadcastCatalog();
      return { success: true, data: result };
    } catch (error) {
      logger.error("[SkillSyncIPC] broadcast-catalog error:", error.message);
      return failureResponse(error);
    }
  });

  // 6. Get sync status
  ipcMain.handle("skills:sync:get-sync-status", async () => {
    try {
      if (!syncManager) {
        return { success: false, error: "SyncManager not initialized" };
      }
      const status = syncManager.getSyncStatus();
      return { success: true, data: status };
    } catch (error) {
      logger.error("[SkillSyncIPC] get-sync-status error:", error.message);
      return failureResponse(error);
    }
  });

  // 7. Manual conflict resolution
  ipcMain.handle("skills:sync:resolve-conflict", async (_event, args) => {
    try {
      const { skillId, resolution } = assertIpcArgs(args, [
        "skillId",
        "resolution",
      ]);
      const remotePkg = Object.prototype.hasOwnProperty.call(args, "remotePkg")
        ? args.remotePkg
        : null;
      const result = await syncManager.resolveConflict(
        skillId,
        resolution,
        remotePkg,
      );
      return { success: true, data: result };
    } catch (error) {
      logger.error("[SkillSyncIPC] resolve-conflict error:", error.message);
      return failureResponse(error);
    }
  });

  logger.info("[SkillSyncIPC] ✓ 7 handlers registered");
}

module.exports = { registerSkillSyncIPC };
