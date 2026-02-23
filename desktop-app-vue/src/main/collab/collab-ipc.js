/**
 * Collaboration IPC Handlers
 * ~20 IPC handlers for all collab operations
 * Event forwarding to renderer (peer joined/left, awareness, sync state)
 *
 * @module collab/collab-ipc
 * @version 2.0.0
 */

const { logger } = require("../utils/logger.js");
const { ipcMain } = require("electron");
const ipcGuard = require("../ipc/ipc-guard");

/**
 * Register all Collaboration IPC handlers
 * @param {Object} dependencies
 * @param {Object} [dependencies.yjsEngine] - YjsCRDTEngine instance
 * @param {Object} [dependencies.yjsProvider] - WebRTCYjsProvider instance
 * @param {Object} [dependencies.sessionManager] - CollabSessionManager instance
 * @param {Object} [dependencies.gitIntegration] - CollabGitIntegration instance
 * @param {Object} [dependencies.mainWindow] - Electron main window
 */
function registerCollabIPC({
  yjsEngine,
  yjsProvider,
  sessionManager,
  gitIntegration,
  mainWindow,
}) {
  if (ipcGuard.isModuleRegistered("collab-ipc")) {
    logger.info("[Collab IPC] Handlers already registered, skipping...");
    return;
  }

  logger.info("[Collab IPC] Registering Collaboration IPC handlers...");

  // ============================================================
  // Room Management
  // ============================================================

  /**
   * Create a collaboration room
   * Channel: 'collab:create-room'
   */
  ipcMain.handle(
    "collab:create-room",
    async (_event, { documentId, maxParticipants, permissions }) => {
      try {
        if (!sessionManager) {
          return { success: false, error: "Collaboration not initialized" };
        }
        const room = await sessionManager.createRoom({
          documentId,
          maxParticipants,
          permissions,
        });
        return { success: true, room };
      } catch (error) {
        logger.error("[Collab IPC] Create room error:", error.message);
        return { success: false, error: error.message };
      }
    },
  );

  /**
   * Join a collaboration room
   * Channel: 'collab:join-room'
   */
  ipcMain.handle("collab:join-room", async (_event, { roomId, documentId }) => {
    try {
      if (!sessionManager) {
        return { success: false, error: "Collaboration not initialized" };
      }
      const room = await sessionManager.joinRoom(roomId, documentId);
      return { success: true, room: sessionManager.getRoomInfo(roomId) };
    } catch (error) {
      logger.error("[Collab IPC] Join room error:", error.message);
      return { success: false, error: error.message };
    }
  });

  /**
   * Leave a collaboration room
   * Channel: 'collab:leave-room'
   */
  ipcMain.handle("collab:leave-room", async (_event, { roomId }) => {
    try {
      if (!sessionManager) {
        return { success: false, error: "Collaboration not initialized" };
      }
      await sessionManager.leaveRoom(roomId);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  /**
   * Invite user to room
   * Channel: 'collab:invite-user'
   */
  ipcMain.handle(
    "collab:invite-user",
    async (_event, { roomId, inviteeDid, role }) => {
      try {
        if (!sessionManager) {
          return { success: false, error: "Collaboration not initialized" };
        }
        await sessionManager.inviteUser(roomId, inviteeDid, role);
        return { success: true };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
  );

  /**
   * Get room info
   * Channel: 'collab:get-room-info'
   */
  ipcMain.handle("collab:get-room-info", async (_event, { roomId }) => {
    try {
      if (!sessionManager) {
        return { success: false, error: "Collaboration not initialized" };
      }
      const info = sessionManager.getRoomInfo(roomId);
      return { success: true, room: info };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  /**
   * Get active rooms
   * Channel: 'collab:get-active-rooms'
   */
  ipcMain.handle("collab:get-active-rooms", async () => {
    try {
      if (!sessionManager) {
        return { success: false, error: "Collaboration not initialized" };
      }
      const rooms = sessionManager.getActiveRooms();
      return { success: true, rooms };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // ============================================================
  // Document Operations
  // ============================================================

  /**
   * Get document content
   * Channel: 'collab:get-document'
   */
  ipcMain.handle("collab:get-document", async (_event, { documentId }) => {
    try {
      if (!yjsEngine) {
        return { success: false, error: "CRDT engine not initialized" };
      }
      const content = yjsEngine.getMarkdown(documentId);
      const metadata = yjsEngine.getMetadata(documentId);
      return { success: true, content, metadata };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  /**
   * Apply text operation
   * Channel: 'collab:apply-operation'
   */
  ipcMain.handle(
    "collab:apply-operation",
    async (_event, { documentId, operation }) => {
      try {
        if (!yjsEngine) {
          return { success: false, error: "CRDT engine not initialized" };
        }
        yjsEngine.applyOperation(documentId, operation);
        return { success: true };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
  );

  /**
   * Set document content (full replace)
   * Channel: 'collab:set-document'
   */
  ipcMain.handle(
    "collab:set-document",
    async (_event, { documentId, content }) => {
      try {
        if (!yjsEngine) {
          return { success: false, error: "CRDT engine not initialized" };
        }
        yjsEngine.setMarkdown(documentId, content);
        return { success: true };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
  );

  // ============================================================
  // Yjs Sync
  // ============================================================

  /**
   * Connect Yjs for a document
   * Channel: 'collab:yjs-connect'
   */
  ipcMain.handle("collab:yjs-connect", async (_event, { documentId }) => {
    try {
      if (!yjsEngine) {
        return { success: false, error: "CRDT engine not initialized" };
      }
      yjsEngine.getOrCreateDocument(documentId);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  /**
   * Disconnect Yjs for a document
   * Channel: 'collab:yjs-disconnect'
   */
  ipcMain.handle("collab:yjs-disconnect", async (_event, { documentId }) => {
    try {
      if (!yjsEngine) {
        return { success: false, error: "CRDT engine not initialized" };
      }
      yjsEngine.closeDocument(documentId);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  /**
   * Get Yjs sync state
   * Channel: 'collab:yjs-state'
   */
  ipcMain.handle("collab:yjs-state", async (_event, { documentId }) => {
    try {
      if (!yjsEngine) {
        return { success: false, error: "CRDT engine not initialized" };
      }
      return {
        success: true,
        size: yjsEngine.getDocumentSize(documentId),
        metadata: yjsEngine.getMetadata(documentId),
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // ============================================================
  // Awareness & Cursor
  // ============================================================

  /**
   * Update cursor position
   * Channel: 'collab:update-cursor'
   */
  ipcMain.handle("collab:update-cursor", async (_event, { roomId, cursor }) => {
    try {
      if (!yjsProvider) {
        return { success: false, error: "Provider not initialized" };
      }
      yjsProvider.updateCursor(roomId, cursor);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  /**
   * Get awareness states for a room
   * Channel: 'collab:get-awareness'
   */
  ipcMain.handle("collab:get-awareness", async (_event, { roomId }) => {
    try {
      if (!yjsProvider) {
        return { success: false, error: "Provider not initialized" };
      }
      const states = yjsProvider.getAwarenessStates(roomId);
      return { success: true, states };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // ============================================================
  // Permissions
  // ============================================================

  /**
   * Set participant role
   * Channel: 'collab:set-role'
   */
  ipcMain.handle(
    "collab:set-role",
    async (_event, { roomId, targetDid, role }) => {
      try {
        if (!sessionManager) {
          return { success: false, error: "Collaboration not initialized" };
        }
        await sessionManager.setParticipantRole(roomId, targetDid, role);
        return { success: true };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
  );

  /**
   * Get participants
   * Channel: 'collab:get-participants'
   */
  ipcMain.handle("collab:get-participants", async (_event, { roomId }) => {
    try {
      if (!sessionManager) {
        return { success: false, error: "Collaboration not initialized" };
      }
      const participants = sessionManager.getParticipants(roomId);
      return { success: true, participants };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // ============================================================
  // Git Integration
  // ============================================================

  /**
   * Create version snapshot
   * Channel: 'collab:create-snapshot'
   */
  ipcMain.handle(
    "collab:create-snapshot",
    async (_event, { documentId, message, authorDid }) => {
      try {
        if (!gitIntegration) {
          return { success: false, error: "Git integration not initialized" };
        }
        const snapshot = await gitIntegration.createVersionSnapshot(
          documentId,
          message,
          authorDid,
        );
        return { success: true, snapshot };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
  );

  /**
   * Get version snapshots
   * Channel: 'collab:get-snapshots'
   */
  ipcMain.handle("collab:get-snapshots", async (_event, { documentId }) => {
    try {
      if (!gitIntegration) {
        return { success: false, error: "Git integration not initialized" };
      }
      const snapshots = gitIntegration.getVersionSnapshots(documentId);
      return { success: true, snapshots };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  /**
   * Restore version snapshot
   * Channel: 'collab:restore-snapshot'
   */
  ipcMain.handle(
    "collab:restore-snapshot",
    async (_event, { documentId, snapshotId }) => {
      try {
        if (!gitIntegration) {
          return { success: false, error: "Git integration not initialized" };
        }
        const result = await gitIntegration.restoreSnapshot(
          documentId,
          snapshotId,
        );
        return { success: true, ...result };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
  );

  // ============================================================
  // Comments
  // ============================================================

  /**
   * Add comment to document
   * Channel: 'collab:add-comment'
   */
  ipcMain.handle(
    "collab:add-comment",
    async (_event, { documentId, comment }) => {
      try {
        if (!yjsEngine) {
          return { success: false, error: "CRDT engine not initialized" };
        }
        yjsEngine.addComment(documentId, comment);
        return { success: true };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
  );

  /**
   * Get comments for document
   * Channel: 'collab:get-comments-crdt'
   */
  ipcMain.handle("collab:get-comments-crdt", async (_event, { documentId }) => {
    try {
      if (!yjsEngine) {
        return { success: false, error: "CRDT engine not initialized" };
      }
      const comments = yjsEngine.getComments(documentId);
      return { success: true, comments };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Register module
  ipcGuard.registerModule("collab-ipc", 22);
  logger.info("[Collab IPC] Registered 22 handlers");

  // ============================================================
  // Event Forwarding to Renderer
  // ============================================================

  if (yjsProvider && mainWindow) {
    yjsProvider.on("room:synced", (data) => {
      mainWindow.webContents?.send?.("collab:room-synced", data);
    });

    yjsProvider.on("awareness:update", (data) => {
      mainWindow.webContents?.send?.("collab:awareness-update", data);
    });

    yjsProvider.on("document:remote-update", (data) => {
      mainWindow.webContents?.send?.("collab:document-updated", data);
    });

    yjsProvider.on("peer:added", (data) => {
      mainWindow.webContents?.send?.("collab:peer-joined", data);
    });

    yjsProvider.on("peer:disconnected", (data) => {
      mainWindow.webContents?.send?.("collab:peer-left", data);
    });
  }

  if (sessionManager && mainWindow) {
    sessionManager.on("room:invite-received", (data) => {
      mainWindow.webContents?.send?.("collab:invite-received", data);
    });
  }
}

module.exports = { registerCollabIPC };
