/**
 * Organization Knowledge Sync Manager
 *
 * Manages knowledge base synchronization across organization members using P2P network.
 * Integrates with Yjs CRDT for real-time collaboration and conflict-free merging.
 *
 * Features:
 * - P2P knowledge base synchronization
 * - Folder-based permissions
 * - Real-time knowledge updates
 * - Conflict resolution
 * - Activity tracking
 * - Offline support with sync queue
 */

const { logger, createLogger } = require('../utils/logger.js');
const EventEmitter = require('events');
const { v4: uuidv4 } = require('uuid');

class OrgKnowledgeSyncManager extends EventEmitter {
  constructor(orgP2PNetwork, yjsCollabManager, database, didManager) {
    super();

    this.orgP2PNetwork = orgP2PNetwork;
    this.yjsCollabManager = yjsCollabManager;
    this.database = database;
    this.didManager = didManager;

    // Sync state per organization
    this.syncState = new Map();

    // Pending sync operations
    this.syncQueue = new Map();

    // Message types for knowledge sync
    this.MESSAGE_TYPES = {
      KNOWLEDGE_CREATE: 'knowledge_create',
      KNOWLEDGE_UPDATE: 'knowledge_update',
      KNOWLEDGE_DELETE: 'knowledge_delete',
      KNOWLEDGE_MOVE: 'knowledge_move',
      FOLDER_CREATE: 'folder_create',
      FOLDER_UPDATE: 'folder_update',
      FOLDER_DELETE: 'folder_delete',
      SYNC_REQUEST: 'sync_request',
      SYNC_RESPONSE: 'sync_response',
      YJS_UPDATE: 'yjs_update',
      YJS_AWARENESS: 'yjs_awareness'
    };

    // Initialize message handlers
    this._initializeMessageHandlers();
  }

  /**
   * Initialize message handlers for knowledge sync
   */
  _initializeMessageHandlers() {
    if (!this.orgP2PNetwork) {
      logger.warn('[OrgKnowledgeSync] P2P network not available');
      return;
    }

    // Listen for organization messages
    this.orgP2PNetwork.on('message', async (data) => {
      try {
        const { orgId, type, payload, from } = data;

        switch (type) {
          case this.MESSAGE_TYPES.KNOWLEDGE_CREATE:
            await this._handleKnowledgeCreate(orgId, payload, from);
            break;

          case this.MESSAGE_TYPES.KNOWLEDGE_UPDATE:
            await this._handleKnowledgeUpdate(orgId, payload, from);
            break;

          case this.MESSAGE_TYPES.KNOWLEDGE_DELETE:
            await this._handleKnowledgeDelete(orgId, payload, from);
            break;

          case this.MESSAGE_TYPES.KNOWLEDGE_MOVE:
            await this._handleKnowledgeMove(orgId, payload, from);
            break;

          case this.MESSAGE_TYPES.FOLDER_CREATE:
            await this._handleFolderCreate(orgId, payload, from);
            break;

          case this.MESSAGE_TYPES.FOLDER_UPDATE:
            await this._handleFolderUpdate(orgId, payload, from);
            break;

          case this.MESSAGE_TYPES.FOLDER_DELETE:
            await this._handleFolderDelete(orgId, payload, from);
            break;

          case this.MESSAGE_TYPES.SYNC_REQUEST:
            await this._handleSyncRequest(orgId, payload, from);
            break;

          case this.MESSAGE_TYPES.YJS_UPDATE:
            await this._handleYjsUpdate(orgId, payload, from);
            break;

          case this.MESSAGE_TYPES.YJS_AWARENESS:
            await this._handleYjsAwareness(orgId, payload, from);
            break;
        }

      } catch (error) {
        logger.error('[OrgKnowledgeSync] Error handling message:', error);
      }
    });
  }

  /**
   * Initialize knowledge sync for an organization
   */
  async initialize(orgId) {
    try {
      logger.info(`[OrgKnowledgeSync] Initializing for organization ${orgId}`);

      // Initialize sync state
      this.syncState.set(orgId, {
        lastSyncTime: Date.now(),
        pendingOperations: [],
        syncInProgress: false
      });

      // Request initial sync from peers
      await this._requestInitialSync(orgId);

      logger.info(`[OrgKnowledgeSync] Initialized for organization ${orgId}`);

    } catch (error) {
      logger.error('[OrgKnowledgeSync] Error initializing:', error);
      throw error;
    }
  }

  /**
   * Create a shared folder in the organization
   */
  async createFolder(orgId, folderData) {
    try {
      const userDID = await this._getUserDID();
      const folderId = uuidv4();

      const folder = {
        id: folderId,
        org_id: orgId,
        name: folderData.name,
        parent_folder_id: folderData.parentFolderId || null,
        description: folderData.description || null,
        icon: folderData.icon || null,
        color: folderData.color || null,
        permissions: JSON.stringify(folderData.permissions || { view: ['member'], edit: ['admin', 'owner'] }),
        created_by: userDID,
        created_at: Date.now(),
        updated_at: Date.now()
      };

      // Save to database
      const db = this.database.getDatabase();
      const stmt = db.prepare(`
        INSERT INTO org_knowledge_folders (
          id, org_id, name, parent_folder_id, description,
          icon, color, permissions, created_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        folder.id, folder.org_id, folder.name, folder.parent_folder_id,
        folder.description, folder.icon, folder.color, folder.permissions,
        folder.created_by, folder.created_at, folder.updated_at
      );

      // Broadcast to organization
      await this.orgP2PNetwork.broadcast(orgId, {
        type: this.MESSAGE_TYPES.FOLDER_CREATE,
        payload: folder
      });

      // Log activity
      await this._logActivity(orgId, null, 'create', { folderName: folder.name });

      return folder;

    } catch (error) {
      logger.error('[OrgKnowledgeSync] Error creating folder:', error);
      throw error;
    }
  }

  /**
   * Share a knowledge item with the organization
   */
  async shareKnowledge(orgId, knowledgeId, options = {}) {
    try {
      const userDID = await this._getUserDID();
      const userName = await this._getUserName();

      // Check if knowledge exists
      const db = this.database.getDatabase();
      const knowledge = db.prepare('SELECT * FROM knowledge_items WHERE id = ?').get(knowledgeId);

      if (!knowledge) {
        throw new Error('Knowledge item not found');
      }

      // Create organization knowledge entry
      const orgKnowledge = {
        id: uuidv4(),
        knowledge_id: knowledgeId,
        org_id: orgId,
        folder_id: options.folderId || null,
        permissions: JSON.stringify(options.permissions || { view: ['member'], edit: ['admin', 'owner'] }),
        is_public: options.isPublic || 0,
        created_by: userDID,
        last_edited_by: userDID,
        created_at: Date.now(),
        updated_at: Date.now()
      };

      const stmt = db.prepare(`
        INSERT INTO org_knowledge_items (
          id, knowledge_id, org_id, folder_id, permissions,
          is_public, created_by, last_edited_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        orgKnowledge.id, orgKnowledge.knowledge_id, orgKnowledge.org_id,
        orgKnowledge.folder_id, orgKnowledge.permissions, orgKnowledge.is_public,
        orgKnowledge.created_by, orgKnowledge.last_edited_by,
        orgKnowledge.created_at, orgKnowledge.updated_at
      );

      // Broadcast to organization
      await this.orgP2PNetwork.broadcast(orgId, {
        type: this.MESSAGE_TYPES.KNOWLEDGE_CREATE,
        payload: {
          knowledge,
          orgKnowledge,
          author: { did: userDID, name: userName }
        }
      });

      // Log activity
      await this._logActivity(orgId, knowledgeId, 'share', { title: knowledge.title });

      return orgKnowledge;

    } catch (error) {
      logger.error('[OrgKnowledgeSync] Error sharing knowledge:', error);
      throw error;
    }
  }

  /**
   * Update shared knowledge
   */
  async updateKnowledge(orgId, knowledgeId, updates) {
    try {
      const userDID = await this._getUserDID();
      const userName = await this._getUserName();

      // Check permissions
      const hasPermission = await this._checkPermission(orgId, knowledgeId, 'edit');
      if (!hasPermission) {
        throw new Error('No permission to edit this knowledge item');
      }

      // Update knowledge item
      const db = this.database.getDatabase();
      const updateFields = [];
      const updateValues = [];

      if (updates.title !== undefined) {
        updateFields.push('title = ?');
        updateValues.push(updates.title);
      }

      if (updates.content !== undefined) {
        updateFields.push('content = ?');
        updateValues.push(updates.content);
      }

      updateFields.push('updated_at = ?');
      updateValues.push(Date.now());

      updateValues.push(knowledgeId);

      const stmt = db.prepare(`
        UPDATE knowledge_items
        SET ${updateFields.join(', ')}
        WHERE id = ?
      `);

      stmt.run(...updateValues);

      // Update org knowledge metadata
      db.prepare(`
        UPDATE org_knowledge_items
        SET last_edited_by = ?, updated_at = ?
        WHERE knowledge_id = ? AND org_id = ?
      `).run(userDID, Date.now(), knowledgeId, orgId);

      // Broadcast update
      await this.orgP2PNetwork.broadcast(orgId, {
        type: this.MESSAGE_TYPES.KNOWLEDGE_UPDATE,
        payload: {
          knowledgeId,
          updates,
          author: { did: userDID, name: userName },
          timestamp: Date.now()
        }
      });

      // Log activity
      await this._logActivity(orgId, knowledgeId, 'edit', updates);

      return true;

    } catch (error) {
      logger.error('[OrgKnowledgeSync] Error updating knowledge:', error);
      throw error;
    }
  }

  /**
   * Delete shared knowledge
   */
  async deleteKnowledge(orgId, knowledgeId) {
    try {
      const userDID = await this._getUserDID();

      // Check permissions
      const hasPermission = await this._checkPermission(orgId, knowledgeId, 'delete');
      if (!hasPermission) {
        throw new Error('No permission to delete this knowledge item');
      }

      // Delete from org knowledge
      const db = this.database.getDatabase();
      db.prepare(`
        DELETE FROM org_knowledge_items
        WHERE knowledge_id = ? AND org_id = ?
      `).run(knowledgeId, orgId);

      // Broadcast deletion
      await this.orgP2PNetwork.broadcast(orgId, {
        type: this.MESSAGE_TYPES.KNOWLEDGE_DELETE,
        payload: {
          knowledgeId,
          deletedBy: userDID,
          timestamp: Date.now()
        }
      });

      // Log activity
      await this._logActivity(orgId, knowledgeId, 'delete');

      return true;

    } catch (error) {
      logger.error('[OrgKnowledgeSync] Error deleting knowledge:', error);
      throw error;
    }
  }

  /**
   * Get all shared knowledge in organization
   */
  async getOrganizationKnowledge(orgId, options = {}) {
    try {
      const db = this.database.getDatabase();

      let query = `
        SELECT
          k.*,
          ok.folder_id,
          ok.permissions,
          ok.is_public,
          ok.created_by,
          ok.last_edited_by,
          ok.created_at as shared_at
        FROM knowledge_items k
        INNER JOIN org_knowledge_items ok ON k.id = ok.knowledge_id
        WHERE ok.org_id = ?
      `;

      const params = [orgId];

      if (options.folderId) {
        query += ' AND ok.folder_id = ?';
        params.push(options.folderId);
      }

      if (options.type) {
        query += ' AND k.type = ?';
        params.push(options.type);
      }

      query += ' ORDER BY k.updated_at DESC';

      if (options.limit) {
        query += ' LIMIT ?';
        params.push(options.limit);
      }

      const knowledge = db.prepare(query).all(...params);

      return knowledge.map(k => ({
        ...k,
        permissions: JSON.parse(k.permissions)
      }));

    } catch (error) {
      logger.error('[OrgKnowledgeSync] Error getting organization knowledge:', error);
      return [];
    }
  }

  /**
   * Get organization folders
   */
  async getOrganizationFolders(orgId, parentFolderId = null) {
    try {
      const db = this.database.getDatabase();

      const folders = db.prepare(`
        SELECT * FROM org_knowledge_folders
        WHERE org_id = ? AND parent_folder_id ${parentFolderId ? '= ?' : 'IS NULL'}
        ORDER BY name ASC
      `).all(parentFolderId ? [orgId, parentFolderId] : [orgId]);

      return folders.map(f => ({
        ...f,
        permissions: JSON.parse(f.permissions)
      }));

    } catch (error) {
      logger.error('[OrgKnowledgeSync] Error getting folders:', error);
      return [];
    }
  }

  /**
   * Get knowledge activity log
   */
  async getActivityLog(orgId, options = {}) {
    try {
      const db = this.database.getDatabase();

      let query = `
        SELECT * FROM knowledge_activities
        WHERE org_id = ?
      `;

      const params = [orgId];

      if (options.knowledgeId) {
        query += ' AND knowledge_id = ?';
        params.push(options.knowledgeId);
      }

      if (options.userDID) {
        query += ' AND user_did = ?';
        params.push(options.userDID);
      }

      if (options.activityType) {
        query += ' AND activity_type = ?';
        params.push(options.activityType);
      }

      query += ' ORDER BY created_at DESC LIMIT ?';
      params.push(options.limit || 100);

      const activities = db.prepare(query).all(...params);

      return activities.map(a => ({
        ...a,
        metadata: a.metadata ? JSON.parse(a.metadata) : null
      }));

    } catch (error) {
      logger.error('[OrgKnowledgeSync] Error getting activity log:', error);
      return [];
    }
  }

  /**
   * Handle incoming knowledge create message
   */
  async _handleKnowledgeCreate(orgId, payload, from) {
    try {
      const { knowledge, orgKnowledge, author } = payload;

      // Check if already exists
      const db = this.database.getDatabase();
      const existing = db.prepare('SELECT id FROM knowledge_items WHERE id = ?').get(knowledge.id);

      if (existing) {
        logger.info(`[OrgKnowledgeSync] Knowledge ${knowledge.id} already exists`);
        return;
      }

      // Insert knowledge item
      const kStmt = db.prepare(`
        INSERT INTO knowledge_items (
          id, title, type, content, content_path, embedding_path,
          created_at, updated_at, git_commit_hash, device_id, sync_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      kStmt.run(
        knowledge.id, knowledge.title, knowledge.type, knowledge.content,
        knowledge.content_path, knowledge.embedding_path, knowledge.created_at,
        knowledge.updated_at, knowledge.git_commit_hash, knowledge.device_id,
        'synced'
      );

      // Insert org knowledge entry
      const okStmt = db.prepare(`
        INSERT INTO org_knowledge_items (
          id, knowledge_id, org_id, folder_id, permissions,
          is_public, created_by, last_edited_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      okStmt.run(
        orgKnowledge.id, orgKnowledge.knowledge_id, orgKnowledge.org_id,
        orgKnowledge.folder_id, orgKnowledge.permissions, orgKnowledge.is_public,
        orgKnowledge.created_by, orgKnowledge.last_edited_by,
        orgKnowledge.created_at, orgKnowledge.updated_at
      );

      this.emit('knowledge-created', { orgId, knowledge, author });

    } catch (error) {
      logger.error('[OrgKnowledgeSync] Error handling knowledge create:', error);
    }
  }

  /**
   * Handle incoming knowledge update message
   */
  async _handleKnowledgeUpdate(orgId, payload, from) {
    try {
      const { knowledgeId, updates, author, timestamp } = payload;

      const db = this.database.getDatabase();

      // Check if update is newer than local version
      const local = db.prepare('SELECT updated_at FROM knowledge_items WHERE id = ?').get(knowledgeId);

      if (local && local.updated_at >= timestamp) {
        logger.info(`[OrgKnowledgeSync] Local version is newer, skipping update`);
        return;
      }

      // Apply updates
      const updateFields = [];
      const updateValues = [];

      if (updates.title !== undefined) {
        updateFields.push('title = ?');
        updateValues.push(updates.title);
      }

      if (updates.content !== undefined) {
        updateFields.push('content = ?');
        updateValues.push(updates.content);
      }

      updateFields.push('updated_at = ?');
      updateValues.push(timestamp);

      updateValues.push(knowledgeId);

      db.prepare(`
        UPDATE knowledge_items
        SET ${updateFields.join(', ')}
        WHERE id = ?
      `).run(...updateValues);

      this.emit('knowledge-updated', { orgId, knowledgeId, updates, author });

    } catch (error) {
      logger.error('[OrgKnowledgeSync] Error handling knowledge update:', error);
    }
  }

  /**
   * Handle incoming knowledge delete message
   */
  async _handleKnowledgeDelete(orgId, payload, from) {
    try {
      const { knowledgeId, deletedBy, timestamp } = payload;

      const db = this.database.getDatabase();

      // Delete from org knowledge
      db.prepare(`
        DELETE FROM org_knowledge_items
        WHERE knowledge_id = ? AND org_id = ?
      `).run(knowledgeId, orgId);

      this.emit('knowledge-deleted', { orgId, knowledgeId, deletedBy });

    } catch (error) {
      logger.error('[OrgKnowledgeSync] Error handling knowledge delete:', error);
    }
  }

  /**
   * Handle incoming folder create message
   */
  async _handleFolderCreate(orgId, payload, from) {
    try {
      const db = this.database.getDatabase();

      // Check if already exists
      const existing = db.prepare('SELECT id FROM org_knowledge_folders WHERE id = ?').get(payload.id);

      if (existing) {
        logger.info(`[OrgKnowledgeSync] Folder ${payload.id} already exists`);
        return;
      }

      // Insert folder
      const stmt = db.prepare(`
        INSERT INTO org_knowledge_folders (
          id, org_id, name, parent_folder_id, description,
          icon, color, permissions, created_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        payload.id, payload.org_id, payload.name, payload.parent_folder_id,
        payload.description, payload.icon, payload.color, payload.permissions,
        payload.created_by, payload.created_at, payload.updated_at
      );

      this.emit('folder-created', { orgId, folder: payload });

    } catch (error) {
      logger.error('[OrgKnowledgeSync] Error handling folder create:', error);
    }
  }

  /**
   * Handle Yjs update message
   */
  async _handleYjsUpdate(orgId, payload, from) {
    try {
      const { docId, update } = payload;

      // Apply Yjs update
      if (this.yjsCollabManager) {
        const ydoc = this.yjsCollabManager.getDocument(docId);
        const Y = require('yjs');
        Y.applyUpdate(ydoc, new Uint8Array(update), 'network');
      }

    } catch (error) {
      logger.error('[OrgKnowledgeSync] Error handling Yjs update:', error);
    }
  }

  /**
   * Handle Yjs awareness message
   */
  async _handleYjsAwareness(orgId, payload, from) {
    try {
      const { docId, awareness } = payload;

      // Apply awareness update
      if (this.yjsCollabManager) {
        const awarenessState = this.yjsCollabManager.getAwareness(docId);
        this.yjsCollabManager._applyAwarenessUpdate(awarenessState, new Uint8Array(awareness), from);
      }

    } catch (error) {
      logger.error('[OrgKnowledgeSync] Error handling Yjs awareness:', error);
    }
  }

  /**
   * Request initial sync from peers
   */
  async _requestInitialSync(orgId) {
    try {
      await this.orgP2PNetwork.broadcast(orgId, {
        type: this.MESSAGE_TYPES.SYNC_REQUEST,
        payload: {
          lastSyncTime: 0,
          requestedBy: await this._getUserDID()
        }
      });

    } catch (error) {
      logger.error('[OrgKnowledgeSync] Error requesting initial sync:', error);
    }
  }

  /**
   * Handle sync request from peer
   */
  async _handleSyncRequest(orgId, payload, from) {
    try {
      const { lastSyncTime } = payload;

      // Get all knowledge items updated after lastSyncTime
      const db = this.database.getDatabase();
      const knowledge = db.prepare(`
        SELECT k.*, ok.*
        FROM knowledge_items k
        INNER JOIN org_knowledge_items ok ON k.id = ok.knowledge_id
        WHERE ok.org_id = ? AND k.updated_at > ?
      `).all(orgId, lastSyncTime);

      // Send sync response
      await this.orgP2PNetwork.sendDirect(orgId, from, {
        type: this.MESSAGE_TYPES.SYNC_RESPONSE,
        payload: { knowledge }
      });

    } catch (error) {
      logger.error('[OrgKnowledgeSync] Error handling sync request:', error);
    }
  }

  /**
   * Check if user has permission for an action
   */
  async _checkPermission(orgId, knowledgeId, action) {
    try {
      const db = this.database.getDatabase();
      const userDID = await this._getUserDID();

      // Get user's role in organization
      const member = db.prepare(`
        SELECT role FROM organization_members
        WHERE org_id = ? AND member_did = ?
      `).get(orgId, userDID);

      if (!member) {return false;}

      // Get knowledge permissions
      const orgKnowledge = db.prepare(`
        SELECT permissions FROM org_knowledge_items
        WHERE knowledge_id = ? AND org_id = ?
      `).get(knowledgeId, orgId);

      if (!orgKnowledge) {return false;}

      const permissions = JSON.parse(orgKnowledge.permissions);

      // Check if user's role has permission
      const actionPermissions = permissions[action] || permissions.edit || [];
      return actionPermissions.includes(member.role) || member.role === 'owner';

    } catch (error) {
      logger.error('[OrgKnowledgeSync] Error checking permission:', error);
      return false;
    }
  }

  /**
   * Log activity
   */
  async _logActivity(orgId, knowledgeId, activityType, metadata = {}) {
    try {
      const db = this.database.getDatabase();
      const userDID = await this._getUserDID();
      const userName = await this._getUserName();

      db.prepare(`
        INSERT INTO knowledge_activities (
          knowledge_id, org_id, user_did, user_name,
          activity_type, metadata, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        knowledgeId,
        orgId,
        userDID,
        userName,
        activityType,
        JSON.stringify(metadata),
        Date.now()
      );

    } catch (error) {
      logger.error('[OrgKnowledgeSync] Error logging activity:', error);
    }
  }

  /**
   * Get current user's DID
   */
  async _getUserDID() {
    try {
      if (this.didManager) {
        const identity = await this.didManager.getDefaultIdentity();
        return identity?.did || 'unknown';
      }

      const db = this.database.getDatabase();
      const identity = db.prepare('SELECT did FROM did_identities WHERE is_default = 1 LIMIT 1').get();
      return identity?.did || 'unknown';

    } catch (error) {
      return 'unknown';
    }
  }

  /**
   * Get current user's name
   */
  async _getUserName() {
    try {
      const db = this.database.getDatabase();
      const user = db.prepare('SELECT name FROM user_profile LIMIT 1').get();
      return user?.name || 'Anonymous';
    } catch (error) {
      return 'Anonymous';
    }
  }

  /**
   * Clean up resources
   */
  destroy() {
    this.syncState.clear();
    this.syncQueue.clear();
    this.removeAllListeners();
  }
}

module.exports = OrgKnowledgeSyncManager;
