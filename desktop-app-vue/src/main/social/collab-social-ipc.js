/**
 * Social Collaboration IPC Handlers
 *
 * Registers all IPC handlers for the social collaborative editing system.
 * Provides channels for document management, sync, awareness, and versioning.
 *
 * @module social/collab-social-ipc
 * @version 0.41.0
 */

const { logger } = require("../utils/logger.js");
const { ipcMain } = require("electron");

/**
 * Register all Social Collaboration IPC handlers
 * @param {Object} dependencies - Service dependencies
 * @param {Object} dependencies.collabEngine - SocialCollabEngine instance
 * @param {Object} dependencies.collabSync - CollabSync instance
 * @param {Object} dependencies.collabAwareness - CollabAwareness instance
 * @param {Object} dependencies.docVersionManager - DocVersionManager instance
 */
function registerCollabSocialIPC({
  collabEngine,
  collabSync,
  collabAwareness,
  docVersionManager,
}) {
  logger.info("[CollabSocial IPC] Registering handlers...");

  // ============================================================
  // Document Management (8 handlers)
  // ============================================================

  /**
   * Create a new collaborative document
   * Channel: 'social-collab:create-doc'
   */
  ipcMain.handle("social-collab:create-doc", async (_event, options) => {
    try {
      if (!collabEngine) {
        throw new Error("Social collaboration engine not initialized");
      }

      return await collabEngine.createDocument(options || {});
    } catch (error) {
      logger.error("[CollabSocial IPC] Create doc failed:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Open a collaborative document for editing
   * Channel: 'social-collab:open-doc'
   */
  ipcMain.handle("social-collab:open-doc", async (_event, docId) => {
    try {
      if (!collabEngine) {
        throw new Error("Social collaboration engine not initialized");
      }

      return await collabEngine.openDocument(docId);
    } catch (error) {
      logger.error("[CollabSocial IPC] Open doc failed:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Close a collaborative document
   * Channel: 'social-collab:close-doc'
   */
  ipcMain.handle("social-collab:close-doc", async (_event, docId) => {
    try {
      if (!collabEngine) {
        throw new Error("Social collaboration engine not initialized");
      }

      return await collabEngine.closeDocument(docId);
    } catch (error) {
      logger.error("[CollabSocial IPC] Close doc failed:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Invite a collaborator to a document
   * Channel: 'social-collab:invite'
   */
  ipcMain.handle("social-collab:invite", async (_event, options) => {
    try {
      if (!collabEngine) {
        throw new Error("Social collaboration engine not initialized");
      }

      return await collabEngine.inviteCollaborator(options || {});
    } catch (error) {
      logger.error("[CollabSocial IPC] Invite failed:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Get documents owned by the current user
   * Channel: 'social-collab:get-my-docs'
   */
  ipcMain.handle("social-collab:get-my-docs", async (_event, options) => {
    try {
      if (!collabEngine) {
        return { success: true, documents: [] };
      }

      return await collabEngine.getMyDocuments(options || {});
    } catch (error) {
      logger.error("[CollabSocial IPC] Get my docs failed:", error);
      return { success: false, documents: [], error: error.message };
    }
  });

  /**
   * Get documents shared with the current user
   * Channel: 'social-collab:get-shared-docs'
   */
  ipcMain.handle("social-collab:get-shared-docs", async (_event, options) => {
    try {
      if (!collabEngine) {
        return { success: true, documents: [] };
      }

      return await collabEngine.getSharedDocuments(options || {});
    } catch (error) {
      logger.error("[CollabSocial IPC] Get shared docs failed:", error);
      return { success: false, documents: [], error: error.message };
    }
  });

  /**
   * Get a single document by ID
   * Channel: 'social-collab:get-doc'
   */
  ipcMain.handle("social-collab:get-doc", async (_event, docId) => {
    try {
      if (!collabEngine) {
        return { success: false, error: "Engine not initialized" };
      }

      const document = await collabEngine.getDocumentById(docId);
      if (!document) {
        return { success: false, error: "Document not found" };
      }

      return { success: true, document };
    } catch (error) {
      logger.error("[CollabSocial IPC] Get doc failed:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Archive a collaborative document
   * Channel: 'social-collab:archive-doc'
   */
  ipcMain.handle("social-collab:archive-doc", async (_event, docId) => {
    try {
      if (!collabEngine) {
        throw new Error("Social collaboration engine not initialized");
      }

      return await collabEngine.archiveDocument(docId);
    } catch (error) {
      logger.error("[CollabSocial IPC] Archive doc failed:", error);
      return { success: false, error: error.message };
    }
  });

  // ============================================================
  // Invite Management (3 handlers)
  // ============================================================

  /**
   * Accept a collaboration invite
   * Channel: 'social-collab:accept-invite'
   */
  ipcMain.handle("social-collab:accept-invite", async (_event, inviteId) => {
    try {
      if (!collabEngine) {
        throw new Error("Social collaboration engine not initialized");
      }

      return await collabEngine.acceptInvite(inviteId);
    } catch (error) {
      logger.error("[CollabSocial IPC] Accept invite failed:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Reject a collaboration invite
   * Channel: 'social-collab:reject-invite'
   */
  ipcMain.handle("social-collab:reject-invite", async (_event, inviteId) => {
    try {
      if (!collabEngine) {
        throw new Error("Social collaboration engine not initialized");
      }

      return await collabEngine.rejectInvite(inviteId);
    } catch (error) {
      logger.error("[CollabSocial IPC] Reject invite failed:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Get pending invites for the current user
   * Channel: 'social-collab:get-pending-invites'
   */
  ipcMain.handle("social-collab:get-pending-invites", async () => {
    try {
      if (!collabEngine) {
        return { success: true, invites: [] };
      }

      return await collabEngine.getPendingInvites();
    } catch (error) {
      logger.error("[CollabSocial IPC] Get pending invites failed:", error);
      return { success: false, invites: [], error: error.message };
    }
  });

  // ============================================================
  // Version Management (4 handlers)
  // ============================================================

  /**
   * Create a version snapshot
   * Channel: 'social-collab:create-version'
   */
  ipcMain.handle("social-collab:create-version", async (_event, options) => {
    try {
      if (!docVersionManager) {
        throw new Error("Version manager not initialized");
      }

      return await docVersionManager.createSnapshot(options || {});
    } catch (error) {
      logger.error("[CollabSocial IPC] Create version failed:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Get version history for a document
   * Channel: 'social-collab:get-versions'
   */
  ipcMain.handle("social-collab:get-versions", async (_event, options) => {
    try {
      if (!docVersionManager) {
        return { success: true, versions: [], total: 0 };
      }

      return await docVersionManager.getVersions(options || {});
    } catch (error) {
      logger.error("[CollabSocial IPC] Get versions failed:", error);
      return { success: false, versions: [], total: 0, error: error.message };
    }
  });

  /**
   * Rollback to a specific version
   * Channel: 'social-collab:rollback'
   */
  ipcMain.handle("social-collab:rollback", async (_event, options) => {
    try {
      if (!docVersionManager) {
        throw new Error("Version manager not initialized");
      }

      return await docVersionManager.rollback(options || {});
    } catch (error) {
      logger.error("[CollabSocial IPC] Rollback failed:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Diff two versions
   * Channel: 'social-collab:diff-versions'
   */
  ipcMain.handle("social-collab:diff-versions", async (_event, options) => {
    try {
      if (!docVersionManager) {
        throw new Error("Version manager not initialized");
      }

      return await docVersionManager.diffVersions(options || {});
    } catch (error) {
      logger.error("[CollabSocial IPC] Diff versions failed:", error);
      return { success: false, error: error.message };
    }
  });

  // ============================================================
  // Awareness / Cursors (3 handlers)
  // ============================================================

  /**
   * Get remote cursors for a document
   * Channel: 'social-collab:get-cursors'
   */
  ipcMain.handle("social-collab:get-cursors", async (_event, docId) => {
    try {
      if (!collabAwareness) {
        return { success: true, cursors: [] };
      }

      const cursors = collabAwareness.getRemoteCursors(docId);
      return { success: true, cursors };
    } catch (error) {
      logger.error("[CollabSocial IPC] Get cursors failed:", error);
      return { success: false, cursors: [], error: error.message };
    }
  });

  /**
   * Update local cursor position
   * Channel: 'social-collab:update-cursor'
   */
  ipcMain.handle("social-collab:update-cursor", async (_event, { docId, position, selection }) => {
    try {
      if (!collabAwareness) {
        return { success: false, error: "Awareness not initialized" };
      }

      return collabAwareness.setLocalCursor(docId, position, selection);
    } catch (error) {
      logger.error("[CollabSocial IPC] Update cursor failed:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Broadcast awareness state
   * Channel: 'social-collab:broadcast-awareness'
   */
  ipcMain.handle("social-collab:broadcast-awareness", async (_event, docId) => {
    try {
      if (!collabAwareness) {
        return { success: false, error: "Awareness not initialized" };
      }

      const result = collabAwareness.broadcastAwareness(docId);

      // If sync is available, broadcast to peers
      if (result.success && result.data && collabSync) {
        try {
          await collabSync.broadcastUpdate(docId, Buffer.from(JSON.stringify({
            type: "awareness",
            ...result.data,
          })));
        } catch (err) {
          logger.warn("[CollabSocial IPC] Awareness broadcast to peers failed:", err.message);
        }
      }

      return result;
    } catch (error) {
      logger.error("[CollabSocial IPC] Broadcast awareness failed:", error);
      return { success: false, error: error.message };
    }
  });

  // ============================================================
  // Sync Management (2 handlers)
  // ============================================================

  /**
   * Start syncing a document with a peer
   * Channel: 'social-collab:start-sync'
   */
  ipcMain.handle("social-collab:start-sync", async (_event, { docId, peerId }) => {
    try {
      if (!collabSync) {
        return { success: false, error: "Sync not initialized" };
      }

      return await collabSync.startSync(docId, peerId);
    } catch (error) {
      logger.error("[CollabSocial IPC] Start sync failed:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Stop syncing a document
   * Channel: 'social-collab:stop-sync'
   */
  ipcMain.handle("social-collab:stop-sync", async (_event, { docId, peerId }) => {
    try {
      if (!collabSync) {
        return { success: true };
      }

      return await collabSync.stopSync(docId, peerId);
    } catch (error) {
      logger.error("[CollabSocial IPC] Stop sync failed:", error);
      return { success: false, error: error.message };
    }
  });

  logger.info(
    "[CollabSocial IPC] All handlers registered successfully (20 handlers)",
  );
}

module.exports = {
  registerCollabSocialIPC,
};
