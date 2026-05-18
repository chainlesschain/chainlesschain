/**
 * Social Collaboration Engine
 *
 * Social collaboration wrapper over existing Yjs CRDT infrastructure.
 * Manages collaborative documents within the social context, including
 * document creation, invitation, visibility controls, and lifecycle.
 *
 * @module social/collab-engine
 * @version 0.41.0
 */

const { logger } = require("../utils/logger.js");
const EventEmitter = require("events");
const { v4: uuidv4 } = require("uuid");

/**
 * Content types for collaborative documents
 */
const ContentType = {
  MARKDOWN: "markdown",
  RICHTEXT: "richtext",
  TABLE: "table",
  WHITEBOARD: "whiteboard",
};

/**
 * Visibility levels for collaborative documents
 */
const Visibility = {
  PRIVATE: "private",
  FRIENDS: "friends",
  INVITED: "invited",
};

/**
 * Document status values
 */
const DocStatus = {
  ACTIVE: "active",
  ARCHIVED: "archived",
};

/**
 * Invite permission levels
 */
const InvitePermission = {
  EDITOR: "editor",
  COMMENTER: "commenter",
  VIEWER: "viewer",
};

/**
 * Invite status values
 */
const InviteStatus = {
  PENDING: "pending",
  ACCEPTED: "accepted",
  REJECTED: "rejected",
};

class SocialCollabEngine extends EventEmitter {
  /**
   * @param {Object} database - Database manager
   * @param {Object} didManager - DID identity manager
   * @param {Object} yjsCollabManager - Yjs collaboration manager (optional)
   */
  constructor(database, didManager, yjsCollabManager = null) {
    super();

    this.database = database;
    this.didManager = didManager;
    this.yjsCollabManager = yjsCollabManager;

    // Track open documents in memory
    this.openDocuments = new Map(); // docId -> { ydoc, users: Set }

    this.initialized = false;
  }

  /**
   * Initialize the collaboration engine
   */
  async initialize() {
    logger.info("[SocialCollabEngine] Initializing...");

    try {
      await this.initializeTables();
      this.initialized = true;
      logger.info("[SocialCollabEngine] Initialized successfully");
    } catch (error) {
      logger.error("[SocialCollabEngine] Initialization failed:", error);
      throw error;
    }
  }

  /**
   * Initialize database tables for social collaboration
   */
  async initializeTables() {
    const db = this.database.db || this.database.getDatabase();

    db.exec(`
      CREATE TABLE IF NOT EXISTS social_collab_documents (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        content_type TEXT DEFAULT 'markdown' CHECK(content_type IN ('markdown', 'richtext', 'table', 'whiteboard')),
        owner_did TEXT NOT NULL,
        visibility TEXT DEFAULT 'private' CHECK(visibility IN ('private', 'friends', 'invited')),
        status TEXT DEFAULT 'active' CHECK(status IN ('active', 'archived')),
        created_at INTEGER,
        updated_at INTEGER
      )
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS social_collab_invites (
        id TEXT PRIMARY KEY,
        doc_id TEXT NOT NULL,
        inviter_did TEXT NOT NULL,
        invitee_did TEXT NOT NULL,
        permission TEXT DEFAULT 'editor' CHECK(permission IN ('editor', 'commenter', 'viewer')),
        status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'accepted', 'rejected')),
        created_at INTEGER,
        UNIQUE(doc_id, invitee_did)
      )
    `);

    // Create indexes for performance
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_social_collab_docs_owner
        ON social_collab_documents(owner_did);
      CREATE INDEX IF NOT EXISTS idx_social_collab_docs_status
        ON social_collab_documents(status);
      CREATE INDEX IF NOT EXISTS idx_social_collab_invites_doc
        ON social_collab_invites(doc_id);
      CREATE INDEX IF NOT EXISTS idx_social_collab_invites_invitee
        ON social_collab_invites(invitee_did, status);
    `);

    logger.info("[SocialCollabEngine] Database tables initialized");
  }

  /**
   * Create a new collaborative document
   * @param {Object} options - Document options
   * @param {string} options.title - Document title
   * @param {string} [options.contentType='markdown'] - Content type
   * @param {string} [options.visibility='private'] - Visibility level
   * @returns {Object} Created document
   */
  async createDocument({
    title,
    contentType = ContentType.MARKDOWN,
    visibility = Visibility.PRIVATE,
  }) {
    try {
      const currentDid = this._getCurrentDid();
      if (!currentDid) {
        throw new Error("User identity not available");
      }

      if (!title || typeof title !== "string" || title.trim().length === 0) {
        throw new Error("Document title is required");
      }

      const db = this.database.db || this.database.getDatabase();
      const now = Date.now();
      const docId = uuidv4();

      db.prepare(
        `
        INSERT INTO social_collab_documents (
          id, title, content_type, owner_did, visibility, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
      `,
      ).run(docId, title.trim(), contentType, currentDid, visibility, now, now);

      const document = {
        id: docId,
        title: title.trim(),
        contentType,
        ownerDid: currentDid,
        visibility,
        status: DocStatus.ACTIVE,
        createdAt: now,
        updatedAt: now,
      };

      this.emit("document:created", document);
      logger.info(`[SocialCollabEngine] Document created: ${docId}`);

      return { success: true, document };
    } catch (error) {
      logger.error("[SocialCollabEngine] Error creating document:", error);
      throw error;
    }
  }

  /**
   * Open a document for collaborative editing
   * @param {string} docId - Document ID
   * @returns {Object} Document info and Yjs handle
   */
  async openDocument(docId) {
    try {
      if (!docId) {
        throw new Error("Document ID is required");
      }

      const currentDid = this._getCurrentDid();
      if (!currentDid) {
        throw new Error("User identity not available");
      }

      const document = await this.getDocumentById(docId);
      if (!document) {
        throw new Error("Document not found");
      }

      if (document.status === DocStatus.ARCHIVED) {
        throw new Error("Cannot open archived document");
      }

      // Check access permission
      const hasAccess = await this._checkAccess(docId, currentDid, document);
      if (!hasAccess) {
        throw new Error("Access denied");
      }

      // Track open document
      if (!this.openDocuments.has(docId)) {
        this.openDocuments.set(docId, { users: new Set() });
      }
      this.openDocuments.get(docId).users.add(currentDid);

      // Open in Yjs if manager is available
      let yjsHandle = null;
      if (this.yjsCollabManager) {
        try {
          yjsHandle = await this.yjsCollabManager.openDocument(docId);
        } catch (err) {
          logger.warn(
            "[SocialCollabEngine] Yjs open failed, continuing without CRDT:",
            err.message,
          );
        }
      }

      this.emit("document:opened", { docId, userDid: currentDid });
      logger.info(
        `[SocialCollabEngine] Document ${docId} opened by ${currentDid}`,
      );

      return {
        success: true,
        document,
        yjsHandle,
        collaborators: Array.from(this.openDocuments.get(docId).users),
      };
    } catch (error) {
      logger.error("[SocialCollabEngine] Error opening document:", error);
      throw error;
    }
  }

  /**
   * Close a document
   * @param {string} docId - Document ID
   */
  async closeDocument(docId) {
    try {
      if (!docId) {
        throw new Error("Document ID is required");
      }

      const currentDid = this._getCurrentDid();

      const entry = this.openDocuments.get(docId);
      if (entry) {
        entry.users.delete(currentDid);
        if (entry.users.size === 0) {
          this.openDocuments.delete(docId);
        }
      }

      // Close in Yjs if manager is available
      if (this.yjsCollabManager) {
        try {
          await this.yjsCollabManager.closeDocument(docId);
        } catch (err) {
          logger.warn("[SocialCollabEngine] Yjs close failed:", err.message);
        }
      }

      this.emit("document:closed", { docId, userDid: currentDid });
      logger.info(
        `[SocialCollabEngine] Document ${docId} closed by ${currentDid}`,
      );

      return { success: true };
    } catch (error) {
      logger.error("[SocialCollabEngine] Error closing document:", error);
      throw error;
    }
  }

  /**
   * Invite a collaborator to a document
   * @param {Object} options - Invitation options
   * @param {string} options.docId - Document ID
   * @param {string} options.inviteeDid - Invitee's DID
   * @param {string} [options.permission='editor'] - Permission level
   * @returns {Object} Invitation result
   */
  async inviteCollaborator({
    docId,
    inviteeDid,
    permission = InvitePermission.EDITOR,
  }) {
    try {
      const currentDid = this._getCurrentDid();
      if (!currentDid) {
        throw new Error("User identity not available");
      }

      if (!docId || !inviteeDid) {
        throw new Error("Document ID and invitee DID are required");
      }

      if (currentDid === inviteeDid) {
        throw new Error("Cannot invite yourself");
      }

      // Only the owner can invite
      const document = await this.getDocumentById(docId);
      if (!document) {
        throw new Error("Document not found");
      }

      if (document.ownerDid !== currentDid) {
        throw new Error("Only the document owner can invite collaborators");
      }

      const db = this.database.db || this.database.getDatabase();
      const now = Date.now();
      const inviteId = uuidv4();

      // Use INSERT OR REPLACE to handle the UNIQUE constraint
      db.prepare(
        `
        INSERT OR REPLACE INTO social_collab_invites (
          id, doc_id, inviter_did, invitee_did, permission, status, created_at
        ) VALUES (?, ?, ?, ?, ?, 'pending', ?)
      `,
      ).run(inviteId, docId, currentDid, inviteeDid, permission, now);

      const invite = {
        id: inviteId,
        docId,
        inviterDid: currentDid,
        inviteeDid,
        permission,
        status: InviteStatus.PENDING,
        createdAt: now,
      };

      this.emit("invite:sent", invite);
      logger.info(
        `[SocialCollabEngine] Invite sent to ${inviteeDid} for doc ${docId}`,
      );

      return { success: true, invite };
    } catch (error) {
      logger.error("[SocialCollabEngine] Error inviting collaborator:", error);
      throw error;
    }
  }

  /**
   * Get all documents owned by the current user
   * @param {Object} [options] - Filter options
   * @param {string} [options.status='active'] - Filter by status
   * @param {number} [options.limit=50] - Maximum results
   * @param {number} [options.offset=0] - Offset for pagination
   * @returns {Object} List of documents
   */
  async getMyDocuments({
    status = DocStatus.ACTIVE,
    limit = 50,
    offset = 0,
  } = {}) {
    try {
      const currentDid = this._getCurrentDid();
      if (!currentDid) {
        return { success: true, documents: [] };
      }

      const db = this.database.db || this.database.getDatabase();

      const documents = db
        .prepare(
          `
        SELECT * FROM social_collab_documents
        WHERE owner_did = ? AND status = ?
        ORDER BY updated_at DESC
        LIMIT ? OFFSET ?
      `,
        )
        .all(currentDid, status, limit, offset);

      return {
        success: true,
        documents: documents.map(this._mapDocument),
      };
    } catch (error) {
      logger.error("[SocialCollabEngine] Error getting my documents:", error);
      return { success: false, documents: [], error: error.message };
    }
  }

  /**
   * Get all documents shared with the current user (via invites)
   * @param {Object} [options] - Filter options
   * @param {number} [options.limit=50] - Maximum results
   * @param {number} [options.offset=0] - Offset for pagination
   * @returns {Object} List of shared documents
   */
  async getSharedDocuments({ limit = 50, offset = 0 } = {}) {
    try {
      const currentDid = this._getCurrentDid();
      if (!currentDid) {
        return { success: true, documents: [] };
      }

      const db = this.database.db || this.database.getDatabase();

      const documents = db
        .prepare(
          `
        SELECT d.*, i.permission as invite_permission, i.inviter_did
        FROM social_collab_documents d
        INNER JOIN social_collab_invites i ON d.id = i.doc_id
        WHERE i.invitee_did = ? AND i.status = 'accepted' AND d.status = 'active'
        ORDER BY d.updated_at DESC
        LIMIT ? OFFSET ?
      `,
        )
        .all(currentDid, limit, offset);

      return {
        success: true,
        documents: documents.map((row) => ({
          ...this._mapDocument(row),
          invitePermission: row.invite_permission,
          inviterDid: row.inviter_did,
        })),
      };
    } catch (error) {
      logger.error(
        "[SocialCollabEngine] Error getting shared documents:",
        error,
      );
      return { success: false, documents: [], error: error.message };
    }
  }

  /**
   * Archive a document (soft delete)
   * @param {string} docId - Document ID
   * @returns {Object} Result
   */
  async archiveDocument(docId) {
    try {
      const currentDid = this._getCurrentDid();
      if (!currentDid) {
        throw new Error("User identity not available");
      }

      if (!docId) {
        throw new Error("Document ID is required");
      }

      const document = await this.getDocumentById(docId);
      if (!document) {
        throw new Error("Document not found");
      }

      if (document.ownerDid !== currentDid) {
        throw new Error("Only the document owner can archive it");
      }

      const db = this.database.db || this.database.getDatabase();
      const now = Date.now();

      db.prepare(
        `
        UPDATE social_collab_documents
        SET status = 'archived', updated_at = ?
        WHERE id = ?
      `,
      ).run(now, docId);

      // Close the document if it's open
      if (this.openDocuments.has(docId)) {
        this.openDocuments.delete(docId);
      }

      this.emit("document:archived", { docId, userDid: currentDid });
      logger.info(`[SocialCollabEngine] Document ${docId} archived`);

      return { success: true };
    } catch (error) {
      logger.error("[SocialCollabEngine] Error archiving document:", error);
      throw error;
    }
  }

  /**
   * Get a single document by ID
   * @param {string} docId - Document ID
   * @returns {Object|null} Document or null
   */
  async getDocumentById(docId) {
    try {
      if (!docId) {
        return null;
      }

      const db = this.database.db || this.database.getDatabase();

      const row = db
        .prepare(
          `
        SELECT * FROM social_collab_documents WHERE id = ?
      `,
        )
        .get(docId);

      if (!row) {
        return null;
      }

      return this._mapDocument(row);
    } catch (error) {
      logger.error("[SocialCollabEngine] Error getting document:", error);
      return null;
    }
  }

  /**
   * Accept a collaboration invite
   * @param {string} inviteId - Invite ID
   * @returns {Object} Result
   */
  async acceptInvite(inviteId) {
    try {
      const currentDid = this._getCurrentDid();
      if (!currentDid) {
        throw new Error("User identity not available");
      }

      const db = this.database.db || this.database.getDatabase();

      const invite = db
        .prepare(
          `
        SELECT * FROM social_collab_invites WHERE id = ? AND invitee_did = ?
      `,
        )
        .get(inviteId, currentDid);

      if (!invite) {
        throw new Error("Invite not found");
      }

      if (invite.status !== InviteStatus.PENDING) {
        throw new Error("Invite already processed");
      }

      db.prepare(
        `
        UPDATE social_collab_invites SET status = 'accepted' WHERE id = ?
      `,
      ).run(inviteId);

      this.emit("invite:accepted", {
        inviteId,
        docId: invite.doc_id,
        userDid: currentDid,
      });
      logger.info(
        `[SocialCollabEngine] Invite ${inviteId} accepted by ${currentDid}`,
      );

      return { success: true, docId: invite.doc_id };
    } catch (error) {
      logger.error("[SocialCollabEngine] Error accepting invite:", error);
      throw error;
    }
  }

  /**
   * Reject a collaboration invite
   * @param {string} inviteId - Invite ID
   * @returns {Object} Result
   */
  async rejectInvite(inviteId) {
    try {
      const currentDid = this._getCurrentDid();
      if (!currentDid) {
        throw new Error("User identity not available");
      }

      const db = this.database.db || this.database.getDatabase();

      const invite = db
        .prepare(
          `
        SELECT * FROM social_collab_invites WHERE id = ? AND invitee_did = ?
      `,
        )
        .get(inviteId, currentDid);

      if (!invite) {
        throw new Error("Invite not found");
      }

      db.prepare(
        `
        UPDATE social_collab_invites SET status = 'rejected' WHERE id = ?
      `,
      ).run(inviteId);

      this.emit("invite:rejected", {
        inviteId,
        docId: invite.doc_id,
        userDid: currentDid,
      });
      logger.info(
        `[SocialCollabEngine] Invite ${inviteId} rejected by ${currentDid}`,
      );

      return { success: true };
    } catch (error) {
      logger.error("[SocialCollabEngine] Error rejecting invite:", error);
      throw error;
    }
  }

  /**
   * Get pending invites for the current user
   * @returns {Object} List of pending invites
   */
  async getPendingInvites() {
    try {
      const currentDid = this._getCurrentDid();
      if (!currentDid) {
        return { success: true, invites: [] };
      }

      const db = this.database.db || this.database.getDatabase();

      const invites = db
        .prepare(
          `
        SELECT i.*, d.title as doc_title, d.content_type, d.owner_did
        FROM social_collab_invites i
        INNER JOIN social_collab_documents d ON i.doc_id = d.id
        WHERE i.invitee_did = ? AND i.status = 'pending' AND d.status = 'active'
        ORDER BY i.created_at DESC
      `,
        )
        .all(currentDid);

      return {
        success: true,
        invites: invites.map((row) => ({
          id: row.id,
          docId: row.doc_id,
          docTitle: row.doc_title,
          contentType: row.content_type,
          inviterDid: row.inviter_did,
          inviteeDid: row.invitee_did,
          ownerDid: row.owner_did,
          permission: row.permission,
          status: row.status,
          createdAt: row.created_at,
        })),
      };
    } catch (error) {
      logger.error(
        "[SocialCollabEngine] Error getting pending invites:",
        error,
      );
      return { success: false, invites: [], error: error.message };
    }
  }

  // ========================================
  // Helper Methods
  // ========================================

  /**
   * Check if a user has access to a document
   */
  async _checkAccess(docId, userDid, document) {
    // Owner always has access
    if (document.ownerDid === userDid) {
      return true;
    }

    // Private documents: only owner
    if (document.visibility === Visibility.PRIVATE) {
      // Check if there's an accepted invite
      return this._hasAcceptedInvite(docId, userDid);
    }

    // Invited documents: only those with accepted invites
    if (document.visibility === Visibility.INVITED) {
      return this._hasAcceptedInvite(docId, userDid);
    }

    // Friends visibility: check friend relationship or accepted invite
    if (document.visibility === Visibility.FRIENDS) {
      if (this._isFriend(document.ownerDid, userDid)) {
        return true;
      }
      return this._hasAcceptedInvite(docId, userDid);
    }

    return false;
  }

  /**
   * Check if user has an accepted invite for a document
   */
  _hasAcceptedInvite(docId, userDid) {
    const db = this.database.db || this.database.getDatabase();

    const invite = db
      .prepare(
        `
      SELECT id FROM social_collab_invites
      WHERE doc_id = ? AND invitee_did = ? AND status = 'accepted'
    `,
      )
      .get(docId, userDid);

    return !!invite;
  }

  /**
   * Check if two users are friends (accepted friendship in either direction)
   */
  _isFriend(ownerDid, userDid) {
    try {
      const db = this.database.db || this.database.getDatabase();
      const row = db
        .prepare(
          `
        SELECT id FROM friends
        WHERE ((user_did = ? AND friend_did = ?) OR (user_did = ? AND friend_did = ?))
          AND status = 'accepted'
        LIMIT 1
      `,
        )
        .get(ownerDid, userDid, userDid, ownerDid);
      return !!row;
    } catch (_err) {
      // friends table may not exist; fall back gracefully
      return false;
    }
  }

  /**
   * Get the current user's DID
   */
  _getCurrentDid() {
    try {
      const identity = this.didManager?.getCurrentIdentity?.();
      return identity?.did || null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Map a database row to a document object
   */
  _mapDocument(row) {
    return {
      id: row.id,
      title: row.title,
      contentType: row.content_type,
      ownerDid: row.owner_did,
      visibility: row.visibility,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Clean up resources
   */
  async destroy() {
    // Close all open documents
    for (const [docId] of this.openDocuments) {
      try {
        await this.closeDocument(docId);
      } catch (err) {
        // Ignore errors during cleanup
      }
    }

    this.openDocuments.clear();
    this.removeAllListeners();
    this.initialized = false;

    logger.info("[SocialCollabEngine] Destroyed");
  }
}

module.exports = {
  SocialCollabEngine,
  ContentType,
  Visibility,
  DocStatus,
  InvitePermission,
  InviteStatus,
};
