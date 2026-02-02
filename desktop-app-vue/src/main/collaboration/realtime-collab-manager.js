/**
 * Real-time Collaboration Manager (Extended)
 *
 * Extends the base YjsCollabManager with enterprise features:
 * - Section locking for concurrent editing
 * - Conflict resolution UI integration
 * - Inline comments with threading
 * - Version history management
 * - Collaboration statistics
 *
 * @module collaboration/realtime-collab-manager
 */

const { logger } = require('../utils/logger.js');
const EventEmitter = require('events');
const { v4: uuidv4 } = require('uuid');

class RealtimeCollabManager extends EventEmitter {
  constructor(database, yjsCollabManager = null) {
    super();
    this.database = database;
    this.yjsCollabManager = yjsCollabManager;
    this.activeLocks = new Map(); // docId -> [locks]
    this.documentSubscribers = new Map(); // docId -> Set<callback>
    this.lockExpiryTimers = new Map(); // lockId -> timer
  }

  /**
   * Set the Yjs collaboration manager
   */
  setYjsManager(yjsManager) {
    this.yjsCollabManager = yjsManager;
  }

  // ========================================
  // Document Open/Close Operations
  // ========================================

  /**
   * Open a document for collaborative editing
   */
  async openDocument(docId, userDid, userName, orgId = null) {
    try {
      const db = this.database.getDatabase();
      const now = Date.now();

      // Record collaboration session
      const sessionId = uuidv4();
      const userColor = this._generateUserColor(userDid);

      db.prepare(`
        INSERT INTO collaboration_sessions (
          id, knowledge_id, org_id, user_did, user_name, user_color,
          peer_id, last_activity, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)
      `).run(sessionId, docId, orgId, userDid, userName, userColor, userDid, now, now);

      // Update cursor position
      db.prepare(`
        INSERT OR REPLACE INTO collab_cursor_positions (
          id, knowledge_id, user_did, user_name, user_color,
          last_activity, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(uuidv4(), docId, userDid, userName, userColor, now, now);

      // Update collaboration stats
      await this._updateCollabStats(docId, orgId, { sessionOpened: true });

      // Get active locks for this document
      const locks = await this.getDocumentLocks(docId);

      // Get active users
      const activeUsers = await this.getActiveUsers(docId);

      // Notify subscribers
      this._notifySubscribers(docId, {
        type: 'user_joined',
        user: { did: userDid, name: userName, color: userColor },
        timestamp: now
      });

      logger.info(`[RealtimeCollab] User ${userDid} opened document ${docId}`);

      return {
        success: true,
        sessionId,
        userColor,
        locks,
        activeUsers,
        docId
      };
    } catch (error) {
      logger.error('[RealtimeCollab] Error opening document:', error);
      throw error;
    }
  }

  /**
   * Close a document
   */
  async closeDocument(docId, userDid) {
    try {
      const db = this.database.getDatabase();
      const now = Date.now();

      // Update session status
      db.prepare(`
        UPDATE collaboration_sessions
        SET status = 'disconnected', last_activity = ?
        WHERE knowledge_id = ? AND user_did = ? AND status = 'active'
      `).run(now, docId, userDid);

      // Remove cursor position
      db.prepare(`
        DELETE FROM collab_cursor_positions
        WHERE knowledge_id = ? AND user_did = ?
      `).run(docId, userDid);

      // Release any locks held by this user
      await this.releaseUserLocks(docId, userDid);

      // Notify subscribers
      this._notifySubscribers(docId, {
        type: 'user_left',
        userDid,
        timestamp: now
      });

      logger.info(`[RealtimeCollab] User ${userDid} closed document ${docId}`);

      return { success: true };
    } catch (error) {
      logger.error('[RealtimeCollab] Error closing document:', error);
      throw error;
    }
  }

  // ========================================
  // Sync Operations
  // ========================================

  /**
   * Sync document update (Yjs integration)
   */
  async syncUpdate(docId, update, userDid, version) {
    try {
      const db = this.database.getDatabase();
      const now = Date.now();

      // Store the update
      db.prepare(`
        INSERT INTO knowledge_yjs_updates (
          knowledge_id, update_data, created_at
        ) VALUES (?, ?, ?)
      `).run(docId, update, now);

      // Update last activity
      db.prepare(`
        UPDATE collaboration_sessions
        SET last_activity = ?
        WHERE knowledge_id = ? AND user_did = ? AND status = 'active'
      `).run(now, docId, userDid);

      // Update collab stats
      await this._updateCollabStats(docId, null, { editCount: 1 });

      // Notify subscribers of update
      this._notifySubscribers(docId, {
        type: 'document_updated',
        userDid,
        version,
        timestamp: now
      });

      return { success: true, timestamp: now };
    } catch (error) {
      logger.error('[RealtimeCollab] Error syncing update:', error);
      throw error;
    }
  }

  /**
   * Receive updates from other users
   */
  async receiveUpdate(docId, fromVersion) {
    try {
      const db = this.database.getDatabase();

      // Get all updates since the given version
      const updates = db.prepare(`
        SELECT update_data, created_at
        FROM knowledge_yjs_updates
        WHERE knowledge_id = ? AND id > ?
        ORDER BY id ASC
      `).all(docId, fromVersion || 0);

      return {
        success: true,
        updates: updates.map(u => ({
          data: u.update_data,
          timestamp: u.created_at
        }))
      };
    } catch (error) {
      logger.error('[RealtimeCollab] Error receiving updates:', error);
      throw error;
    }
  }

  // ========================================
  // Awareness (Cursor/Selection) Operations
  // ========================================

  /**
   * Get awareness state (active users and cursors)
   */
  async getAwareness(docId) {
    try {
      const db = this.database.getDatabase();

      const cursors = db.prepare(`
        SELECT user_did, user_name, user_color,
               cursor_line, cursor_column,
               selection_start_line, selection_start_column,
               selection_end_line, selection_end_column,
               last_activity
        FROM collab_cursor_positions
        WHERE knowledge_id = ? AND last_activity > ?
        ORDER BY last_activity DESC
      `).all(docId, Date.now() - 60000); // Active in last minute

      return {
        success: true,
        users: cursors.map(c => ({
          did: c.user_did,
          name: c.user_name,
          color: c.user_color,
          cursor: c.cursor_line !== null ? {
            line: c.cursor_line,
            column: c.cursor_column
          } : null,
          selection: c.selection_start_line !== null ? {
            start: { line: c.selection_start_line, column: c.selection_start_column },
            end: { line: c.selection_end_line, column: c.selection_end_column }
          } : null,
          lastActivity: c.last_activity
        }))
      };
    } catch (error) {
      logger.error('[RealtimeCollab] Error getting awareness:', error);
      throw error;
    }
  }

  /**
   * Update cursor position
   */
  async updateCursor(docId, userDid, userName, cursor, selection = null) {
    try {
      const db = this.database.getDatabase();
      const now = Date.now();

      db.prepare(`
        UPDATE collab_cursor_positions
        SET cursor_line = ?, cursor_column = ?,
            selection_start_line = ?, selection_start_column = ?,
            selection_end_line = ?, selection_end_column = ?,
            last_activity = ?
        WHERE knowledge_id = ? AND user_did = ?
      `).run(
        cursor?.line, cursor?.column,
        selection?.start?.line, selection?.start?.column,
        selection?.end?.line, selection?.end?.column,
        now, docId, userDid
      );

      // Notify subscribers
      this._notifySubscribers(docId, {
        type: 'cursor_moved',
        userDid,
        userName,
        cursor,
        selection,
        timestamp: now
      });

      return { success: true };
    } catch (error) {
      logger.error('[RealtimeCollab] Error updating cursor:', error);
      throw error;
    }
  }

  // ========================================
  // Section Locking Operations
  // ========================================

  /**
   * Acquire a lock on a section of the document
   */
  async acquireLock(docId, userDid, userName, lockType = 'section', sectionStart = null, sectionEnd = null, durationMs = 300000) {
    try {
      const db = this.database.getDatabase();
      const now = Date.now();
      const expiresAt = now + durationMs;

      // Check for conflicting locks
      const existingLocks = db.prepare(`
        SELECT * FROM collab_document_locks
        WHERE knowledge_id = ? AND expires_at > ?
          AND (lock_type = 'full'
               OR (? IS NULL)
               OR (section_start <= ? AND section_end >= ?)
               OR (section_start >= ? AND section_start <= ?))
      `).all(docId, now, sectionStart, sectionEnd, sectionStart, sectionStart, sectionEnd);

      // Filter out own locks
      const conflictingLocks = existingLocks.filter(l => l.locked_by_did !== userDid);

      if (conflictingLocks.length > 0) {
        return {
          success: false,
          error: 'LOCK_CONFLICT',
          conflictingLocks: conflictingLocks.map(l => ({
            id: l.id,
            lockedBy: l.locked_by_did,
            lockedByName: l.locked_by_name,
            lockType: l.lock_type,
            sectionStart: l.section_start,
            sectionEnd: l.section_end,
            expiresAt: l.expires_at
          }))
        };
      }

      // Create the lock
      const lockId = uuidv4();
      db.prepare(`
        INSERT INTO collab_document_locks (
          id, knowledge_id, locked_by_did, locked_by_name,
          lock_type, section_start, section_end, expires_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(lockId, docId, userDid, userName, lockType, sectionStart, sectionEnd, expiresAt, now);

      // Set expiry timer
      const timer = setTimeout(() => {
        this._expireLock(lockId, docId);
      }, durationMs);
      this.lockExpiryTimers.set(lockId, timer);

      // Notify subscribers
      this._notifySubscribers(docId, {
        type: 'lock_acquired',
        lockId,
        userDid,
        userName,
        lockType,
        sectionStart,
        sectionEnd,
        expiresAt,
        timestamp: now
      });

      logger.info(`[RealtimeCollab] Lock ${lockId} acquired by ${userDid} on document ${docId}`);

      return {
        success: true,
        lockId,
        expiresAt
      };
    } catch (error) {
      logger.error('[RealtimeCollab] Error acquiring lock:', error);
      throw error;
    }
  }

  /**
   * Release a lock
   */
  async releaseLock(lockId, userDid) {
    try {
      const db = this.database.getDatabase();

      // Verify lock ownership
      const lock = db.prepare(`
        SELECT * FROM collab_document_locks WHERE id = ?
      `).get(lockId);

      if (!lock) {
        return { success: false, error: 'LOCK_NOT_FOUND' };
      }

      if (lock.locked_by_did !== userDid) {
        return { success: false, error: 'NOT_LOCK_OWNER' };
      }

      // Delete the lock
      db.prepare(`DELETE FROM collab_document_locks WHERE id = ?`).run(lockId);

      // Clear expiry timer
      const timer = this.lockExpiryTimers.get(lockId);
      if (timer) {
        clearTimeout(timer);
        this.lockExpiryTimers.delete(lockId);
      }

      // Notify subscribers
      this._notifySubscribers(lock.knowledge_id, {
        type: 'lock_released',
        lockId,
        userDid,
        timestamp: Date.now()
      });

      logger.info(`[RealtimeCollab] Lock ${lockId} released by ${userDid}`);

      return { success: true };
    } catch (error) {
      logger.error('[RealtimeCollab] Error releasing lock:', error);
      throw error;
    }
  }

  /**
   * Release all locks for a user on a document
   */
  async releaseUserLocks(docId, userDid) {
    try {
      const db = this.database.getDatabase();

      const locks = db.prepare(`
        SELECT id FROM collab_document_locks
        WHERE knowledge_id = ? AND locked_by_did = ?
      `).all(docId, userDid);

      for (const lock of locks) {
        await this.releaseLock(lock.id, userDid);
      }

      return { success: true, releasedCount: locks.length };
    } catch (error) {
      logger.error('[RealtimeCollab] Error releasing user locks:', error);
      throw error;
    }
  }

  /**
   * Get all locks for a document
   */
  async getDocumentLocks(docId) {
    try {
      const db = this.database.getDatabase();
      const now = Date.now();

      const locks = db.prepare(`
        SELECT * FROM collab_document_locks
        WHERE knowledge_id = ? AND expires_at > ?
        ORDER BY created_at ASC
      `).all(docId, now);

      return locks.map(l => ({
        id: l.id,
        lockedBy: l.locked_by_did,
        lockedByName: l.locked_by_name,
        lockType: l.lock_type,
        sectionStart: l.section_start,
        sectionEnd: l.section_end,
        expiresAt: l.expires_at,
        createdAt: l.created_at
      }));
    } catch (error) {
      logger.error('[RealtimeCollab] Error getting document locks:', error);
      throw error;
    }
  }

  // ========================================
  // Conflict Resolution Operations
  // ========================================

  /**
   * Request conflict resolution
   */
  async requestConflictResolution(docId, conflictData) {
    try {
      const db = this.database.getDatabase();
      const now = Date.now();
      const conflictId = uuidv4();

      db.prepare(`
        INSERT INTO collab_conflict_history (
          id, knowledge_id, org_id, conflict_type,
          local_version, remote_version,
          local_content, remote_content,
          local_user_did, remote_user_did,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        conflictId, docId, conflictData.orgId,
        conflictData.conflictType || 'concurrent_edit',
        conflictData.localVersion, conflictData.remoteVersion,
        conflictData.localContent, conflictData.remoteContent,
        conflictData.localUserDid, conflictData.remoteUserDid,
        now
      );

      // Update conflict stats
      await this._updateCollabStats(docId, conflictData.orgId, { conflictCount: 1 });

      // Notify subscribers
      this._notifySubscribers(docId, {
        type: 'conflict_detected',
        conflictId,
        conflictData,
        timestamp: now
      });

      logger.info(`[RealtimeCollab] Conflict ${conflictId} detected in document ${docId}`);

      return {
        success: true,
        conflictId
      };
    } catch (error) {
      logger.error('[RealtimeCollab] Error requesting conflict resolution:', error);
      throw error;
    }
  }

  /**
   * Resolve a conflict
   */
  async resolveConflict(conflictId, resolverDid, resolution) {
    try {
      const db = this.database.getDatabase();
      const now = Date.now();

      // Get the conflict
      const conflict = db.prepare(`
        SELECT * FROM collab_conflict_history WHERE id = ?
      `).get(conflictId);

      if (!conflict) {
        return { success: false, error: 'CONFLICT_NOT_FOUND' };
      }

      // Update the conflict record
      db.prepare(`
        UPDATE collab_conflict_history
        SET resolved_by_did = ?, resolution_strategy = ?,
            merged_content = ?, resolved_at = ?
        WHERE id = ?
      `).run(
        resolverDid,
        resolution.strategy,
        resolution.mergedContent,
        now,
        conflictId
      );

      // Notify subscribers
      this._notifySubscribers(conflict.knowledge_id, {
        type: 'conflict_resolved',
        conflictId,
        resolverDid,
        resolution,
        timestamp: now
      });

      logger.info(`[RealtimeCollab] Conflict ${conflictId} resolved by ${resolverDid}`);

      return { success: true };
    } catch (error) {
      logger.error('[RealtimeCollab] Error resolving conflict:', error);
      throw error;
    }
  }

  // ========================================
  // Inline Comments Operations
  // ========================================

  /**
   * Add an inline comment
   */
  async addInlineComment(docId, comment) {
    try {
      const db = this.database.getDatabase();
      const now = Date.now();
      const commentId = uuidv4();
      const threadId = comment.threadId || commentId;

      db.prepare(`
        INSERT INTO knowledge_comments (
          id, knowledge_id, org_id, author_did, author_name,
          content, position_start, position_end,
          thread_id, parent_comment_id, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)
      `).run(
        commentId, docId, comment.orgId,
        comment.authorDid, comment.authorName,
        comment.content,
        comment.positionStart, comment.positionEnd,
        threadId, comment.parentCommentId,
        now, now
      );

      // Update comment stats
      await this._updateCollabStats(docId, comment.orgId, { commentCount: 1 });

      // Notify subscribers
      this._notifySubscribers(docId, {
        type: 'comment_added',
        commentId,
        threadId,
        comment: {
          ...comment,
          id: commentId,
          createdAt: now
        },
        timestamp: now
      });

      logger.info(`[RealtimeCollab] Comment ${commentId} added to document ${docId}`);

      return {
        success: true,
        commentId,
        threadId
      };
    } catch (error) {
      logger.error('[RealtimeCollab] Error adding inline comment:', error);
      throw error;
    }
  }

  /**
   * Resolve an inline comment
   */
  async resolveComment(commentId, resolverDid) {
    try {
      const db = this.database.getDatabase();
      const now = Date.now();

      const comment = db.prepare(`
        SELECT * FROM knowledge_comments WHERE id = ?
      `).get(commentId);

      if (!comment) {
        return { success: false, error: 'COMMENT_NOT_FOUND' };
      }

      db.prepare(`
        UPDATE knowledge_comments
        SET status = 'resolved', resolved_by = ?, resolved_at = ?, updated_at = ?
        WHERE id = ?
      `).run(resolverDid, now, now, commentId);

      // Notify subscribers
      this._notifySubscribers(comment.knowledge_id, {
        type: 'comment_resolved',
        commentId,
        threadId: comment.thread_id,
        resolverDid,
        timestamp: now
      });

      logger.info(`[RealtimeCollab] Comment ${commentId} resolved by ${resolverDid}`);

      return { success: true };
    } catch (error) {
      logger.error('[RealtimeCollab] Error resolving comment:', error);
      throw error;
    }
  }

  /**
   * Get comments for a document
   */
  async getComments(docId, options = {}) {
    try {
      const db = this.database.getDatabase();

      let query = `
        SELECT * FROM knowledge_comments
        WHERE knowledge_id = ?
      `;
      const params = [docId];

      if (options.status) {
        query += ` AND status = ?`;
        params.push(options.status);
      }

      if (options.threadId) {
        query += ` AND thread_id = ?`;
        params.push(options.threadId);
      }

      query += ` ORDER BY created_at ${options.order || 'ASC'}`;

      if (options.limit) {
        query += ` LIMIT ?`;
        params.push(options.limit);
      }

      const comments = db.prepare(query).all(...params);

      return {
        success: true,
        comments: comments.map(c => ({
          id: c.id,
          authorDid: c.author_did,
          authorName: c.author_name,
          content: c.content,
          positionStart: c.position_start,
          positionEnd: c.position_end,
          threadId: c.thread_id,
          parentCommentId: c.parent_comment_id,
          status: c.status,
          resolvedBy: c.resolved_by,
          resolvedAt: c.resolved_at,
          createdAt: c.created_at,
          updatedAt: c.updated_at
        }))
      };
    } catch (error) {
      logger.error('[RealtimeCollab] Error getting comments:', error);
      throw error;
    }
  }

  // ========================================
  // Version History Operations
  // ========================================

  /**
   * Get document version history
   */
  async getDocumentHistory(docId, options = {}) {
    try {
      const db = this.database.getDatabase();

      const snapshots = db.prepare(`
        SELECT id, snapshot_data, state_vector, metadata, created_at
        FROM knowledge_snapshots
        WHERE knowledge_id = ?
        ORDER BY created_at DESC
        LIMIT ?
      `).all(docId, options.limit || 50);

      return {
        success: true,
        versions: snapshots.map((s, index) => ({
          id: s.id,
          version: snapshots.length - index,
          metadata: s.metadata ? JSON.parse(s.metadata) : {},
          createdAt: s.created_at
        }))
      };
    } catch (error) {
      logger.error('[RealtimeCollab] Error getting document history:', error);
      throw error;
    }
  }

  /**
   * Restore a document version
   */
  async restoreVersion(docId, versionId, userDid) {
    try {
      const db = this.database.getDatabase();
      const now = Date.now();

      const snapshot = db.prepare(`
        SELECT * FROM knowledge_snapshots WHERE id = ?
      `).get(versionId);

      if (!snapshot) {
        return { success: false, error: 'VERSION_NOT_FOUND' };
      }

      // Create a new snapshot from current state before restoring
      // This allows undoing the restore
      await this._createAutoSnapshot(docId, 'pre_restore');

      // The actual restore is handled by Yjs in the frontend
      // Here we just record the intent and notify

      // Notify subscribers
      this._notifySubscribers(docId, {
        type: 'version_restored',
        versionId,
        restoredBy: userDid,
        timestamp: now
      });

      logger.info(`[RealtimeCollab] Version ${versionId} restored by ${userDid}`);

      return {
        success: true,
        snapshotData: snapshot.snapshot_data,
        stateVector: snapshot.state_vector
      };
    } catch (error) {
      logger.error('[RealtimeCollab] Error restoring version:', error);
      throw error;
    }
  }

  // ========================================
  // Statistics Operations
  // ========================================

  /**
   * Get collaboration statistics
   */
  async getStats(docId) {
    try {
      const db = this.database.getDatabase();

      let stats = db.prepare(`
        SELECT * FROM collab_stats WHERE knowledge_id = ?
      `).get(docId);

      if (!stats) {
        return {
          success: true,
          stats: {
            totalEdits: 0,
            totalCollaborators: 0,
            totalConflicts: 0,
            totalComments: 0,
            totalSessions: 0,
            lastEditAt: null,
            lastConflictAt: null
          }
        };
      }

      return {
        success: true,
        stats: {
          totalEdits: stats.total_edits,
          totalCollaborators: stats.total_collaborators,
          totalConflicts: stats.total_conflicts,
          totalComments: stats.total_comments,
          totalSessions: stats.total_sessions,
          lastEditAt: stats.last_edit_at,
          lastConflictAt: stats.last_conflict_at
        }
      };
    } catch (error) {
      logger.error('[RealtimeCollab] Error getting stats:', error);
      throw error;
    }
  }

  // ========================================
  // Subscription Operations
  // ========================================

  /**
   * Subscribe to document changes
   */
  subscribeToChanges(docId, callback) {
    if (!this.documentSubscribers.has(docId)) {
      this.documentSubscribers.set(docId, new Set());
    }
    this.documentSubscribers.get(docId).add(callback);

    return () => {
      const subscribers = this.documentSubscribers.get(docId);
      if (subscribers) {
        subscribers.delete(callback);
      }
    };
  }

  // ========================================
  // Export Operations
  // ========================================

  /**
   * Export document with comments
   */
  async exportWithComments(docId, format = 'markdown') {
    try {
      const db = this.database.getDatabase();

      // Get document content
      const doc = db.prepare(`
        SELECT content, title FROM knowledge_items WHERE id = ?
      `).get(docId);

      if (!doc) {
        return { success: false, error: 'DOCUMENT_NOT_FOUND' };
      }

      // Get all comments
      const comments = db.prepare(`
        SELECT * FROM knowledge_comments
        WHERE knowledge_id = ?
        ORDER BY position_start ASC
      `).all(docId);

      let exportContent = doc.content || '';

      if (format === 'markdown') {
        // Insert comment markers
        const sortedComments = [...comments].sort((a, b) => b.position_start - a.position_start);
        for (const comment of sortedComments) {
          if (comment.position_end !== null) {
            const marker = `[^${comment.id.substring(0, 8)}]`;
            exportContent = exportContent.slice(0, comment.position_end) +
                            marker +
                            exportContent.slice(comment.position_end);
          }
        }

        // Append footnotes
        if (comments.length > 0) {
          exportContent += '\n\n---\n\n## Comments\n\n';
          for (const comment of comments) {
            exportContent += `[^${comment.id.substring(0, 8)}]: **${comment.author_name}** (${new Date(comment.created_at).toLocaleDateString()}): ${comment.content}\n\n`;
          }
        }
      }

      return {
        success: true,
        title: doc.title,
        content: exportContent,
        format,
        commentCount: comments.length
      };
    } catch (error) {
      logger.error('[RealtimeCollab] Error exporting with comments:', error);
      throw error;
    }
  }

  // ========================================
  // Helper Methods
  // ========================================

  /**
   * Get active users for a document
   */
  async getActiveUsers(docId) {
    try {
      const db = this.database.getDatabase();
      const cutoff = Date.now() - 60000; // Active in last minute

      const users = db.prepare(`
        SELECT DISTINCT cs.user_did, cs.user_name, cs.user_color, cs.last_activity
        FROM collaboration_sessions cs
        WHERE cs.knowledge_id = ? AND cs.status = 'active' AND cs.last_activity > ?
      `).all(docId, cutoff);

      return users.map(u => ({
        did: u.user_did,
        name: u.user_name,
        color: u.user_color,
        lastActivity: u.last_activity
      }));
    } catch (error) {
      logger.error('[RealtimeCollab] Error getting active users:', error);
      return [];
    }
  }

  /**
   * Update collaboration statistics
   */
  async _updateCollabStats(docId, orgId, updates) {
    try {
      const db = this.database.getDatabase();
      const now = Date.now();

      // Get or create stats record
      let stats = db.prepare(`
        SELECT * FROM collab_stats WHERE knowledge_id = ?
      `).get(docId);

      if (!stats) {
        const id = uuidv4();
        db.prepare(`
          INSERT INTO collab_stats (
            id, knowledge_id, org_id, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?)
        `).run(id, docId, orgId, now, now);

        stats = { total_edits: 0, total_collaborators: 0, total_conflicts: 0, total_comments: 0, total_sessions: 0 };
      }

      // Update stats
      const updateFields = [];
      const updateValues = [];

      if (updates.editCount) {
        updateFields.push('total_edits = total_edits + ?');
        updateValues.push(updates.editCount);
        updateFields.push('last_edit_at = ?');
        updateValues.push(now);
      }

      if (updates.conflictCount) {
        updateFields.push('total_conflicts = total_conflicts + ?');
        updateValues.push(updates.conflictCount);
        updateFields.push('last_conflict_at = ?');
        updateValues.push(now);
      }

      if (updates.commentCount) {
        updateFields.push('total_comments = total_comments + ?');
        updateValues.push(updates.commentCount);
      }

      if (updates.sessionOpened) {
        updateFields.push('total_sessions = total_sessions + 1');

        // Count unique collaborators
        const uniqueUsers = db.prepare(`
          SELECT COUNT(DISTINCT user_did) as count
          FROM collaboration_sessions
          WHERE knowledge_id = ?
        `).get(docId);
        updateFields.push('total_collaborators = ?');
        updateValues.push(uniqueUsers.count);
      }

      if (updateFields.length > 0) {
        updateFields.push('updated_at = ?');
        updateValues.push(now);
        updateValues.push(docId);

        db.prepare(`
          UPDATE collab_stats SET ${updateFields.join(', ')} WHERE knowledge_id = ?
        `).run(...updateValues);
      }
    } catch (error) {
      logger.warn('[RealtimeCollab] Error updating collab stats:', error);
    }
  }

  /**
   * Expire a lock
   */
  _expireLock(lockId, docId) {
    try {
      const db = this.database.getDatabase();
      db.prepare(`DELETE FROM collab_document_locks WHERE id = ?`).run(lockId);
      this.lockExpiryTimers.delete(lockId);

      this._notifySubscribers(docId, {
        type: 'lock_expired',
        lockId,
        timestamp: Date.now()
      });

      logger.info(`[RealtimeCollab] Lock ${lockId} expired`);
    } catch (error) {
      logger.warn('[RealtimeCollab] Error expiring lock:', error);
    }
  }

  /**
   * Create an automatic snapshot
   */
  async _createAutoSnapshot(docId, reason) {
    // This would integrate with YjsCollabManager if available
    if (this.yjsCollabManager) {
      await this.yjsCollabManager.createSnapshot(docId, { reason, auto: true });
    }
  }

  /**
   * Notify document subscribers
   */
  _notifySubscribers(docId, event) {
    const subscribers = this.documentSubscribers.get(docId);
    if (subscribers) {
      for (const callback of subscribers) {
        try {
          callback(event);
        } catch (error) {
          logger.warn('[RealtimeCollab] Error in subscriber callback:', error);
        }
      }
    }

    // Also emit as event
    this.emit('document-event', { docId, ...event });
  }

  /**
   * Generate a consistent color for a user
   */
  _generateUserColor(userDid) {
    const colors = [
      '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4',
      '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7DC6F',
      '#BB8FCE', '#85C1E9', '#F8B500', '#00CED1'
    ];

    // Hash the DID to get consistent color
    let hash = 0;
    for (let i = 0; i < (userDid || '').length; i++) {
      hash = ((hash << 5) - hash) + userDid.charCodeAt(i);
      hash = hash & hash;
    }

    return colors[Math.abs(hash) % colors.length];
  }
}

// Singleton instance
let realtimeCollabManager = null;

function getRealtimeCollabManager(database) {
  if (!realtimeCollabManager && database) {
    realtimeCollabManager = new RealtimeCollabManager(database);
  }
  return realtimeCollabManager;
}

function setRealtimeCollabManager(manager) {
  realtimeCollabManager = manager;
}

module.exports = {
  RealtimeCollabManager,
  getRealtimeCollabManager,
  setRealtimeCollabManager
};
