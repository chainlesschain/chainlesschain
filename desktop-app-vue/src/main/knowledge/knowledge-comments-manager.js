/**
 * Knowledge Comments Manager
 *
 * Manages comments and annotations for knowledge base items.
 * Supports threaded discussions, inline comments, and mentions.
 *
 * Features:
 * - Create/edit/delete comments
 * - Threaded replies
 * - Inline comments (position-based)
 * - @mentions
 * - Comment resolution
 * - Activity tracking
 */

const { logger, createLogger } = require('../utils/logger.js');
const { v4: uuidv4 } = require('uuid');
const EventEmitter = require('events');

class KnowledgeCommentsManager extends EventEmitter {
  constructor(database, p2pManager) {
    super();
    this.database = database;
    this.p2pManager = p2pManager;
  }

  /**
   * Create a new comment
   * @param {Object} params - Comment parameters
   * @returns {Object} Created comment
   */
  async createComment(params) {
    const {
      knowledgeId,
      orgId,
      authorDid,
      authorName,
      content,
      positionStart,
      positionEnd,
      threadId,
      parentCommentId
    } = params;

    const commentId = uuidv4();
    const now = Date.now();

    try {
      // Extract mentions from content
      const mentions = this._extractMentions(content);

      // Insert comment
      this.database.run(`
        INSERT INTO knowledge_comments (
          id, knowledge_id, org_id, author_did, author_name,
          content, position_start, position_end, thread_id,
          parent_comment_id, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        commentId, knowledgeId, orgId, authorDid, authorName,
        content, positionStart, positionEnd, threadId,
        parentCommentId, 'open', now, now
      ]);

      const comment = {
        id: commentId,
        knowledgeId,
        orgId,
        authorDid,
        authorName,
        content,
        positionStart,
        positionEnd,
        threadId,
        parentCommentId,
        mentions,
        status: 'open',
        createdAt: now,
        updatedAt: now
      };

      // Log activity
      await this._logActivity(orgId, knowledgeId, authorDid, 'comment', commentId);

      // Broadcast comment creation
      await this._broadcastCommentEvent(knowledgeId, {
        type: 'comment:created',
        comment
      });

      // Send notifications to mentioned users
      if (mentions.length > 0) {
        await this._notifyMentionedUsers(knowledgeId, mentions, authorName, content);
      }

      this.emit('comment:created', comment);

      logger.info(`[KnowledgeComments] Created comment ${commentId} for knowledge ${knowledgeId}`);
      return comment;

    } catch (error) {
      logger.error('[KnowledgeComments] Error creating comment:', error);
      throw error;
    }
  }

  /**
   * Get comments for a knowledge item
   * @param {string} knowledgeId - Knowledge item ID
   * @param {Object} options - Query options
   * @returns {Array} Comments
   */
  async getComments(knowledgeId, options = {}) {
    const {
      status = null,
      threadId = null,
      includeReplies = true
    } = options;

    try {
      let query = `
        SELECT * FROM knowledge_comments
        WHERE knowledge_id = ?
      `;
      const params = [knowledgeId];

      if (status) {
        query += ' AND status = ?';
        params.push(status);
      }

      if (threadId) {
        query += ' AND thread_id = ?';
        params.push(threadId);
      }

      if (!includeReplies) {
        query += ' AND parent_comment_id IS NULL';
      }

      query += ' ORDER BY created_at ASC';

      const stmt = this.database.prepare(query);
      const comments = stmt.all(...params);

      // Build comment tree if including replies
      if (includeReplies) {
        return this._buildCommentTree(comments);
      }

      return comments;

    } catch (error) {
      logger.error('[KnowledgeComments] Error getting comments:', error);
      throw error;
    }
  }

  /**
   * Update a comment
   * @param {string} commentId - Comment ID
   * @param {Object} updates - Updates to apply
   * @returns {Object} Updated comment
   */
  async updateComment(commentId, updates) {
    const { content } = updates;
    const now = Date.now();

    try {
      // Extract mentions from new content
      const mentions = content ? this._extractMentions(content) : null;

      this.database.run(`
        UPDATE knowledge_comments
        SET content = COALESCE(?, content),
            updated_at = ?
        WHERE id = ?
      `, [content, now, commentId]);

      // Get updated comment
      const comment = this.database.prepare(
        'SELECT * FROM knowledge_comments WHERE id = ?'
      ).get(commentId);

      // Broadcast update
      await this._broadcastCommentEvent(comment.knowledge_id, {
        type: 'comment:updated',
        commentId,
        updates: { content, mentions }
      });

      this.emit('comment:updated', comment);

      return comment;

    } catch (error) {
      logger.error('[KnowledgeComments] Error updating comment:', error);
      throw error;
    }
  }

  /**
   * Delete a comment
   * @param {string} commentId - Comment ID
   */
  async deleteComment(commentId) {
    try {
      // Get comment info before deletion
      const comment = this.database.prepare(
        'SELECT * FROM knowledge_comments WHERE id = ?'
      ).get(commentId);

      if (!comment) {
        throw new Error('Comment not found');
      }

      // Soft delete
      this.database.run(`
        UPDATE knowledge_comments
        SET status = 'deleted',
            updated_at = ?
        WHERE id = ?
      `, [Date.now(), commentId]);

      // Broadcast deletion
      await this._broadcastCommentEvent(comment.knowledge_id, {
        type: 'comment:deleted',
        commentId
      });

      this.emit('comment:deleted', { commentId, knowledgeId: comment.knowledge_id });

      logger.info(`[KnowledgeComments] Deleted comment ${commentId}`);

    } catch (error) {
      logger.error('[KnowledgeComments] Error deleting comment:', error);
      throw error;
    }
  }

  /**
   * Resolve a comment thread
   * @param {string} commentId - Comment ID
   * @param {string} resolvedBy - User DID who resolved
   */
  async resolveComment(commentId, resolvedBy) {
    const now = Date.now();

    try {
      this.database.run(`
        UPDATE knowledge_comments
        SET status = 'resolved',
            resolved_by = ?,
            resolved_at = ?,
            updated_at = ?
        WHERE id = ?
      `, [resolvedBy, now, now, commentId]);

      // Get comment info
      const comment = this.database.prepare(
        'SELECT * FROM knowledge_comments WHERE id = ?'
      ).get(commentId);

      // Broadcast resolution
      await this._broadcastCommentEvent(comment.knowledge_id, {
        type: 'comment:resolved',
        commentId,
        resolvedBy
      });

      this.emit('comment:resolved', { commentId, resolvedBy });

      logger.info(`[KnowledgeComments] Resolved comment ${commentId}`);

    } catch (error) {
      logger.error('[KnowledgeComments] Error resolving comment:', error);
      throw error;
    }
  }

  /**
   * Get comment statistics
   * @param {string} knowledgeId - Knowledge item ID
   * @returns {Object} Statistics
   */
  async getCommentStats(knowledgeId) {
    try {
      const stats = this.database.prepare(`
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as open,
          SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) as resolved,
          COUNT(DISTINCT author_did) as contributors
        FROM knowledge_comments
        WHERE knowledge_id = ? AND status != 'deleted'
      `).get(knowledgeId);

      return stats;

    } catch (error) {
      logger.error('[KnowledgeComments] Error getting stats:', error);
      throw error;
    }
  }

  /**
   * Extract @mentions from comment content
   * @private
   */
  _extractMentions(content) {
    const mentionRegex = /@(\w+)/g;
    const mentions = [];
    let match;

    while ((match = mentionRegex.exec(content)) !== null) {
      mentions.push(match[1]);
    }

    return mentions;
  }

  /**
   * Build comment tree structure
   * @private
   */
  _buildCommentTree(comments) {
    const commentMap = new Map();
    const rootComments = [];

    // First pass: create map
    comments.forEach(comment => {
      comment.replies = [];
      commentMap.set(comment.id, comment);
    });

    // Second pass: build tree
    comments.forEach(comment => {
      if (comment.parent_comment_id) {
        const parent = commentMap.get(comment.parent_comment_id);
        if (parent) {
          parent.replies.push(comment);
        }
      } else {
        rootComments.push(comment);
      }
    });

    return rootComments;
  }

  /**
   * Log activity
   * @private
   */
  async _logActivity(orgId, knowledgeId, userDid, activityType, resourceId) {
    if (!orgId) {return;}

    try {
      const activityId = uuidv4();
      this.database.run(`
        INSERT INTO knowledge_activities (
          id, knowledge_id, org_id, user_did, user_name,
          activity_type, metadata, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        activityId,
        knowledgeId,
        orgId,
        userDid,
        '', // user_name will be filled by caller
        activityType,
        JSON.stringify({ resourceId }),
        Date.now()
      ]);
    } catch (error) {
      logger.error('[KnowledgeComments] Error logging activity:', error);
    }
  }

  /**
   * Broadcast comment event to peers
   * @private
   */
  async _broadcastCommentEvent(knowledgeId, event) {
    if (!this.p2pManager || !this.p2pManager.pubsub) {
      return;
    }

    try {
      const topic = `comments_${knowledgeId}`;
      const message = JSON.stringify(event);
      await this.p2pManager.pubsub.publish(topic, Buffer.from(message));
    } catch (error) {
      logger.error('[KnowledgeComments] Error broadcasting event:', error);
    }
  }

  /**
   * Notify mentioned users
   * @private
   */
  async _notifyMentionedUsers(knowledgeId, mentions, authorName, content) {
    // TODO: Implement notification system integration
    logger.info(`[KnowledgeComments] Notifying mentioned users:`, mentions);
  }
}

module.exports = KnowledgeCommentsManager;
