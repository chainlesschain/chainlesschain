/**
 * Real-time Collaboration IPC Handlers
 *
 * Provides 21 IPC handlers for real-time collaborative editing:
 * - Document open/close
 * - Sync update/receive
 * - Awareness (cursor/selection)
 * - Lock acquire/release
 * - Conflict resolution
 * - Inline comments
 * - Version history
 * - Statistics
 * - Subscriptions
 * - Export
 * - Yjs IPC bridge (connect/update/disconnect)
 *
 * @module collaboration/realtime-collab-ipc
 */

const { logger } = require('../utils/logger.js');

/**
 * Register all real-time collaboration IPC handlers
 * @param {object} database - SQLite database instance
 * @param {object} [_deps={}] - Optional dependency overrides for testing
 * @param {object} [_deps.ipcMain] - ipcMain instance (injected in tests)
 * @param {object} [_deps.BrowserWindow] - BrowserWindow class (injected in tests)
 */
function registerRealtimeCollabIPC(database, _deps = {}) {
  // In production (Electron runtime), require('electron') returns the real APIs.
  // In tests we inject mocks via _deps to avoid resolving the npm electron stub.
  // yjs is ESM-only, so require('yjs') fails in CJS test environments; inject via _deps.Y.
  const _electron = (_deps.ipcMain !== undefined) ? null : require('electron');
  const ipcMain = _deps.ipcMain !== undefined ? _deps.ipcMain : _electron.ipcMain;
  const BrowserWindow = _deps.BrowserWindow !== undefined ? _deps.BrowserWindow : _electron.BrowserWindow;
  const getY = () => _deps.Y !== undefined ? _deps.Y : require('yjs');
  logger.info('[IPC] 注册实时协作IPC处理器 (21个handlers)');

  // ========================================
  // 1. Document Open/Close
  // ========================================

  /**
   * Open a document for collaborative editing
   * @channel collab:open-document
   */
  ipcMain.handle('collab:open-document', async (_event, params) => {
    try {
      const { getRealtimeCollabManager } = require('./realtime-collab-manager');
      const manager = getRealtimeCollabManager(database);

      const { docId, userDid, userName, orgId } = params;

      if (!docId || !userDid || !userName) {
        throw new Error('Missing required parameters: docId, userDid, userName');
      }

      const result = await manager.openDocument(docId, userDid, userName, orgId);
      return result;
    } catch (error) {
      logger.error('[IPC] collab:open-document failed:', error);
      throw error;
    }
  });

  /**
   * Close a document
   * @channel collab:close-document
   */
  ipcMain.handle('collab:close-document', async (_event, params) => {
    try {
      const { getRealtimeCollabManager } = require('./realtime-collab-manager');
      const manager = getRealtimeCollabManager(database);

      const { docId, userDid } = params;

      if (!docId || !userDid) {
        throw new Error('Missing required parameters: docId, userDid');
      }

      const result = await manager.closeDocument(docId, userDid);
      return result;
    } catch (error) {
      logger.error('[IPC] collab:close-document failed:', error);
      throw error;
    }
  });

  // ========================================
  // 2. Sync Operations
  // ========================================

  /**
   * Sync document update (Yjs)
   * @channel collab:sync-update
   */
  ipcMain.handle('collab:sync-update', async (_event, params) => {
    try {
      const { getRealtimeCollabManager } = require('./realtime-collab-manager');
      const manager = getRealtimeCollabManager(database);

      const { docId, update, userDid, version } = params;

      if (!docId || !update || !userDid) {
        throw new Error('Missing required parameters: docId, update, userDid');
      }

      const result = await manager.syncUpdate(docId, update, userDid, version);
      return result;
    } catch (error) {
      logger.error('[IPC] collab:sync-update failed:', error);
      throw error;
    }
  });

  /**
   * Receive updates from other users
   * @channel collab:receive-update
   */
  ipcMain.handle('collab:receive-update', async (_event, params) => {
    try {
      const { getRealtimeCollabManager } = require('./realtime-collab-manager');
      const manager = getRealtimeCollabManager(database);

      const { docId, fromVersion } = params;

      if (!docId) {
        throw new Error('Missing required parameter: docId');
      }

      const result = await manager.receiveUpdate(docId, fromVersion);
      return result;
    } catch (error) {
      logger.error('[IPC] collab:receive-update failed:', error);
      throw error;
    }
  });

  // ========================================
  // 3. Awareness (Cursor/Selection)
  // ========================================

  /**
   * Get awareness state (active users and cursors)
   * @channel collab:get-awareness
   */
  ipcMain.handle('collab:get-awareness', async (_event, params) => {
    try {
      const { getRealtimeCollabManager } = require('./realtime-collab-manager');
      const manager = getRealtimeCollabManager(database);

      const { docId } = params;

      if (!docId) {
        throw new Error('Missing required parameter: docId');
      }

      const result = await manager.getAwareness(docId);
      return result;
    } catch (error) {
      logger.error('[IPC] collab:get-awareness failed:', error);
      throw error;
    }
  });

  /**
   * Update cursor position
   * @channel collab:update-cursor
   */
  ipcMain.handle('collab:update-cursor', async (_event, params) => {
    try {
      const { getRealtimeCollabManager } = require('./realtime-collab-manager');
      const manager = getRealtimeCollabManager(database);

      const { docId, userDid, userName, cursor, selection } = params;

      if (!docId || !userDid) {
        throw new Error('Missing required parameters: docId, userDid');
      }

      const result = await manager.updateCursor(docId, userDid, userName, cursor, selection);
      return result;
    } catch (error) {
      logger.error('[IPC] collab:update-cursor failed:', error);
      throw error;
    }
  });

  // ========================================
  // 4. Lock Management
  // ========================================

  /**
   * Acquire a lock on document section
   * @channel collab:acquire-lock
   */
  ipcMain.handle('collab:acquire-lock', async (_event, params) => {
    try {
      const { getRealtimeCollabManager } = require('./realtime-collab-manager');
      const manager = getRealtimeCollabManager(database);

      const { docId, userDid, userName, lockType, sectionStart, sectionEnd, durationMs } = params;

      if (!docId || !userDid || !userName) {
        throw new Error('Missing required parameters: docId, userDid, userName');
      }

      const result = await manager.acquireLock(
        docId, userDid, userName, lockType, sectionStart, sectionEnd, durationMs
      );
      return result;
    } catch (error) {
      logger.error('[IPC] collab:acquire-lock failed:', error);
      throw error;
    }
  });

  /**
   * Release a lock
   * @channel collab:release-lock
   */
  ipcMain.handle('collab:release-lock', async (_event, params) => {
    try {
      const { getRealtimeCollabManager } = require('./realtime-collab-manager');
      const manager = getRealtimeCollabManager(database);

      const { lockId, userDid } = params;

      if (!lockId || !userDid) {
        throw new Error('Missing required parameters: lockId, userDid');
      }

      const result = await manager.releaseLock(lockId, userDid);
      return result;
    } catch (error) {
      logger.error('[IPC] collab:release-lock failed:', error);
      throw error;
    }
  });

  // ========================================
  // 5. Conflict Resolution
  // ========================================

  /**
   * Request conflict resolution
   * @channel collab:request-conflict-resolution
   */
  ipcMain.handle('collab:request-conflict-resolution', async (_event, params) => {
    try {
      const { getRealtimeCollabManager } = require('./realtime-collab-manager');
      const manager = getRealtimeCollabManager(database);

      const { docId, conflictData } = params;

      if (!docId || !conflictData) {
        throw new Error('Missing required parameters: docId, conflictData');
      }

      const result = await manager.requestConflictResolution(docId, conflictData);
      return result;
    } catch (error) {
      logger.error('[IPC] collab:request-conflict-resolution failed:', error);
      throw error;
    }
  });

  /**
   * Resolve a conflict
   * @channel collab:resolve-conflict
   */
  ipcMain.handle('collab:resolve-conflict', async (_event, params) => {
    try {
      const { getRealtimeCollabManager } = require('./realtime-collab-manager');
      const manager = getRealtimeCollabManager(database);

      const { conflictId, resolverDid, resolution } = params;

      if (!conflictId || !resolverDid || !resolution) {
        throw new Error('Missing required parameters: conflictId, resolverDid, resolution');
      }

      const result = await manager.resolveConflict(conflictId, resolverDid, resolution);
      return result;
    } catch (error) {
      logger.error('[IPC] collab:resolve-conflict failed:', error);
      throw error;
    }
  });

  // ========================================
  // 6. Inline Comments
  // ========================================

  /**
   * Add an inline comment
   * @channel collab:add-inline-comment
   */
  ipcMain.handle('collab:add-inline-comment', async (_event, params) => {
    try {
      const { getRealtimeCollabManager } = require('./realtime-collab-manager');
      const manager = getRealtimeCollabManager(database);

      const { docId, comment } = params;

      if (!docId || !comment || !comment.content || !comment.authorDid) {
        throw new Error('Missing required parameters: docId, comment.content, comment.authorDid');
      }

      const result = await manager.addInlineComment(docId, comment);
      return result;
    } catch (error) {
      logger.error('[IPC] collab:add-inline-comment failed:', error);
      throw error;
    }
  });

  /**
   * Resolve an inline comment
   * @channel collab:resolve-comment
   */
  ipcMain.handle('collab:resolve-comment', async (_event, params) => {
    try {
      const { getRealtimeCollabManager } = require('./realtime-collab-manager');
      const manager = getRealtimeCollabManager(database);

      const { commentId, resolverDid } = params;

      if (!commentId || !resolverDid) {
        throw new Error('Missing required parameters: commentId, resolverDid');
      }

      const result = await manager.resolveComment(commentId, resolverDid);
      return result;
    } catch (error) {
      logger.error('[IPC] collab:resolve-comment failed:', error);
      throw error;
    }
  });

  /**
   * Get comments for a document
   * @channel collab:get-comments
   */
  ipcMain.handle('collab:get-comments', async (_event, params) => {
    try {
      const { getRealtimeCollabManager } = require('./realtime-collab-manager');
      const manager = getRealtimeCollabManager(database);

      const { docId, options } = params;

      if (!docId) {
        throw new Error('Missing required parameter: docId');
      }

      const result = await manager.getComments(docId, options || {});
      return result;
    } catch (error) {
      logger.error('[IPC] collab:get-comments failed:', error);
      throw error;
    }
  });

  // ========================================
  // 7. Version History
  // ========================================

  /**
   * Get document version history
   * @channel collab:get-document-history
   */
  ipcMain.handle('collab:get-document-history', async (_event, params) => {
    try {
      const { getRealtimeCollabManager } = require('./realtime-collab-manager');
      const manager = getRealtimeCollabManager(database);

      const { docId, options } = params;

      if (!docId) {
        throw new Error('Missing required parameter: docId');
      }

      const result = await manager.getDocumentHistory(docId, options || {});
      return result;
    } catch (error) {
      logger.error('[IPC] collab:get-document-history failed:', error);
      throw error;
    }
  });

  /**
   * Restore a document version
   * @channel collab:restore-version
   */
  ipcMain.handle('collab:restore-version', async (_event, params) => {
    try {
      const { getRealtimeCollabManager } = require('./realtime-collab-manager');
      const manager = getRealtimeCollabManager(database);

      const { docId, versionId, userDid } = params;

      if (!docId || !versionId || !userDid) {
        throw new Error('Missing required parameters: docId, versionId, userDid');
      }

      const result = await manager.restoreVersion(docId, versionId, userDid);
      return result;
    } catch (error) {
      logger.error('[IPC] collab:restore-version failed:', error);
      throw error;
    }
  });

  // ========================================
  // 8. Statistics
  // ========================================

  /**
   * Get collaboration statistics
   * @channel collab:get-stats
   */
  ipcMain.handle('collab:get-stats', async (_event, params) => {
    try {
      const { getRealtimeCollabManager } = require('./realtime-collab-manager');
      const manager = getRealtimeCollabManager(database);

      const { docId } = params;

      if (!docId) {
        throw new Error('Missing required parameter: docId');
      }

      const result = await manager.getStats(docId);
      return result;
    } catch (error) {
      logger.error('[IPC] collab:get-stats failed:', error);
      throw error;
    }
  });

  // ========================================
  // 9. Subscriptions
  // ========================================

  /**
   * Subscribe to document changes
   * Note: This is handled via IPC events, not request-response
   * @channel collab:subscribe-changes
   */
  ipcMain.handle('collab:subscribe-changes', async (_event, params) => {
    try {
      const { getRealtimeCollabManager } = require('./realtime-collab-manager');
      const manager = getRealtimeCollabManager(database);

      const { docId } = params;

      if (!docId) {
        throw new Error('Missing required parameter: docId');
      }

      // Set up subscription that sends events to renderer
      const unsubscribe = manager.subscribeToChanges(docId, (event) => {
        // Send event to all renderer windows
        for (const win of BrowserWindow.getAllWindows()) {
          win.webContents.send('collab:document-event', { docId, event });
        }
      });

      // Store unsubscribe function for cleanup
      // In production, you'd want to manage this more robustly
      return { success: true, subscribed: true };
    } catch (error) {
      logger.error('[IPC] collab:subscribe-changes failed:', error);
      throw error;
    }
  });

  // ========================================
  // 10. Export
  // ========================================

  /**
   * Export document with comments
   * @channel collab:export-with-comments
   */
  ipcMain.handle('collab:export-with-comments', async (_event, params) => {
    try {
      const { getRealtimeCollabManager } = require('./realtime-collab-manager');
      const manager = getRealtimeCollabManager(database);

      const { docId, format } = params;

      if (!docId) {
        throw new Error('Missing required parameter: docId');
      }

      const result = await manager.exportWithComments(docId, format || 'markdown');
      return result;
    } catch (error) {
      logger.error('[IPC] collab:export-with-comments failed:', error);
      throw error;
    }
  });

  // ========================================
  // 11. Yjs IPC Bridge Handlers
  // ========================================

  /**
   * Connect renderer Y.Doc to main process document session
   * Returns initial document state for syncing
   * @channel collab:yjs-connect
   */
  ipcMain.handle('collab:yjs-connect', async (_event, params) => {
    try {
      const { documentId } = params;

      if (!documentId) {
        throw new Error('Missing required parameter: documentId');
      }

      // Get or create Y.Doc via yjs-collab-manager
      let initialState = null;
      try {
        const YjsCollabManager = require('./yjs-collab-manager');
        const { getRealtimeCollabManager } = require('./realtime-collab-manager');
        const realtimeManager = getRealtimeCollabManager(database);
        const yjsManager = realtimeManager?.yjsCollabManager;

        if (yjsManager) {
          // Use getDocument to get or create the Y.Doc
          const doc = yjsManager.getDocument
            ? yjsManager.getDocument(documentId)
            : yjsManager.documents?.get(documentId);

          if (doc) {
            const Y = getY();
            initialState = Array.from(Y.encodeStateAsUpdate(doc));
          }
        }
      } catch (e) {
        logger.warn('[IPC] collab:yjs-connect - Could not get initial state:', e.message);
      }

      logger.info(`[IPC] Yjs connect: ${documentId}`);

      return {
        success: true,
        data: {
          documentId,
          initialState,
        },
      };
    } catch (error) {
      logger.error('[IPC] collab:yjs-connect failed:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Receive a Y.Doc update from renderer and apply to main process doc.
   * Persists the update to the database and broadcasts to other windows/peers.
   * @channel collab:yjs-update
   */
  ipcMain.handle('collab:yjs-update', async (_event, params) => {
    try {
      const { documentId, update } = params;

      if (!documentId || !update) {
        throw new Error('Missing required parameters: documentId, update');
      }

      // Apply update to main process Y.Doc
      const Y = getY();
      const updateArray = new Uint8Array(update);

      try {
        const { getRealtimeCollabManager } = require('./realtime-collab-manager');
        const realtimeManager = getRealtimeCollabManager(database);
        const yjsManager = realtimeManager?.yjsCollabManager;

        if (yjsManager) {
          const doc = yjsManager.getDocument
            ? yjsManager.getDocument(documentId)
            : yjsManager.documents?.get(documentId);

          if (doc) {
            Y.applyUpdate(doc, updateArray, 'renderer');
          }
        }
      } catch (e) {
        logger.warn('[IPC] collab:yjs-update - Could not apply to main doc:', e.message);
      }

      // Persist update to database
      if (database) {
        try {
          const { v4: uuidv4 } = require('uuid');
          const db = database.getDatabase ? database.getDatabase() : database;
          db.prepare(
            `INSERT INTO collab_yjs_updates (id, knowledge_id, update_data, origin, created_at)
             VALUES (?, ?, ?, ?, datetime('now'))`
          ).run(uuidv4(), documentId, Buffer.from(update), 'local');
        } catch (dbErr) {
          // Database table may not exist yet - log but do not fail
          logger.warn('[IPC] collab:yjs-update - DB persist failed:', dbErr.message);
        }
      }

      // Broadcast to other renderer windows (multi-window support)
      try {
        const senderWebContentsId = _event?.sender?.id;

        for (const win of BrowserWindow.getAllWindows()) {
          // Avoid echoing back to the sender window
          if (win.webContents.id !== senderWebContentsId) {
            win.webContents.send('collab:yjs-remote-update', {
              documentId,
              update: Array.from(updateArray),
              origin: 'peer',
            });
          }
        }
      } catch (e) {
        logger.warn('[IPC] collab:yjs-update - Broadcast failed:', e.message);
      }

      return { success: true };
    } catch (error) {
      logger.error('[IPC] collab:yjs-update failed:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Disconnect a renderer from a document session
   * @channel collab:yjs-disconnect
   */
  ipcMain.handle('collab:yjs-disconnect', async (_event, params) => {
    try {
      const { documentId } = params;

      if (!documentId) {
        throw new Error('Missing required parameter: documentId');
      }

      logger.info(`[IPC] Yjs disconnect: ${documentId}`);

      return { success: true };
    } catch (error) {
      logger.error('[IPC] collab:yjs-disconnect failed:', error);
      return { success: false, error: error.message };
    }
  });

  logger.info('[IPC] 实时协作IPC处理器注册完成 (21个handlers)');
}

module.exports = {
  registerRealtimeCollabIPC
};
