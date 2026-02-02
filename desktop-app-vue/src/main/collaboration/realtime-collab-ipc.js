/**
 * Real-time Collaboration IPC Handlers
 *
 * Provides 18 IPC handlers for real-time collaborative editing:
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
 *
 * @module collaboration/realtime-collab-ipc
 */

const { ipcMain } = require('electron');
const { logger } = require('../utils/logger.js');

/**
 * Register all real-time collaboration IPC handlers
 */
function registerRealtimeCollabIPC(database) {
  logger.info('[IPC] 注册实时协作IPC处理器 (18个handlers)');

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
        const { BrowserWindow } = require('electron');
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

  logger.info('[IPC] 实时协作IPC处理器注册完成 (18个handlers)');
}

module.exports = {
  registerRealtimeCollabIPC
};
