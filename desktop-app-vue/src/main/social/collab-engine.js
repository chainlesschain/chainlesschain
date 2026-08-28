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
const {
  SocialCollabBoundaryError,
  createSocialCollabBoundaries,
  assertSocialDocumentId,
  assertSocialPeerId,
} = require("./social-collab-boundaries");

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
  constructor(database, didManager, yjsCollabManager = null, options = {}) {
    super();

    this.database = database;
    this.didManager = didManager;
    this.yjsCollabManager = yjsCollabManager;
    this.boundaries = createSocialCollabBoundaries(options.boundaries || {});
    this._now =
      typeof options.now === "function" ? options.now : () => Date.now();

    // Track open documents in memory
    this.openDocuments = new Map(); // docId -> { ydoc, users: Set }

    this.initialized = false;
    this._destroyed = false;
    this._generation = 0;
  }

  /**
   * Initialize the collaboration engine
   */
  async initialize() {
    this._assertUsable();
    if (this.initialized) {
      return;
    }
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
      this._assertUsable();
      const currentDid = this._requireCurrentDid();

      if (!title || typeof title !== "string" || title.trim().length === 0) {
        throw new Error("Document title is required");
      }
      const normalizedTitle = title.trim();
      this._assertBoundedText(
        normalizedTitle,
        this.boundaries.maxDocumentTitleBytes,
        "Document title",
      );
      const normalizedContentType = this._assertEnum(
        contentType,
        ContentType,
        "content type",
      );
      const normalizedVisibility = this._assertEnum(
        visibility,
        Visibility,
        "visibility",
      );

      const db = this.database.db || this.database.getDatabase();
      const now = this._now();
      const docId = uuidv4();

      db.prepare(
        `
        INSERT INTO social_collab_documents (
          id, title, content_type, owner_did, visibility, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
      `,
      ).run(
        docId,
        normalizedTitle,
        normalizedContentType,
        currentDid,
        normalizedVisibility,
        now,
        now,
      );

      const document = {
        id: docId,
        title: normalizedTitle,
        contentType: normalizedContentType,
        ownerDid: currentDid,
        visibility: normalizedVisibility,
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
    let normalizedDocId = null;
    let currentDid = null;
    let addedUser = false;
    let openedYjsManager = null;
    let openedInYjs = false;
    try {
      this._assertUsable();
      if (!docId) {
        throw new Error("Document ID is required");
      }
      normalizedDocId = assertSocialDocumentId(docId, this.boundaries);

      currentDid = this._requireCurrentDid();

      const generation = this._generation;
      const document = await this.getDocumentById(normalizedDocId);
      this._assertGeneration(generation);
      if (!document) {
        throw new Error("Document not found");
      }

      if (document.status === DocStatus.ARCHIVED) {
        throw new Error("Cannot open archived document");
      }

      // Check access permission
      const hasAccess = await this._checkAccess(
        normalizedDocId,
        currentDid,
        document,
      );
      this._assertGeneration(generation);
      if (!hasAccess) {
        throw new Error("Access denied");
      }

      this._assertOpenCapacity(normalizedDocId, currentDid);
      if (!this.openDocuments.has(normalizedDocId)) {
        this.openDocuments.set(normalizedDocId, { users: new Set() });
      }
      const entry = this.openDocuments.get(normalizedDocId);
      addedUser = !entry.users.has(currentDid);
      entry.users.add(currentDid);

      // Open in Yjs if manager is available
      let yjsHandle = null;
      openedYjsManager = this.yjsCollabManager;
      if (openedYjsManager) {
        try {
          yjsHandle = await openedYjsManager.openDocument(normalizedDocId);
          openedInYjs = true;
          this._assertGeneration(generation);
        } catch (err) {
          if (this._destroyed || generation !== this._generation) {
            throw this._destroyedError();
          }
          logger.warn(
            "[SocialCollabEngine] Yjs open failed, continuing without CRDT:",
            err.message,
          );
        }
      }

      const collaborators = Array.from(
        this.openDocuments.get(normalizedDocId).users,
      );
      this.emit("document:opened", {
        docId: normalizedDocId,
        userDid: currentDid,
      });
      logger.info(
        `[SocialCollabEngine] Document ${normalizedDocId} opened by ${currentDid}`,
      );

      return {
        success: true,
        document,
        yjsHandle,
        collaborators,
      };
    } catch (error) {
      if (openedInYjs && openedYjsManager && normalizedDocId) {
        openedYjsManager.closeDocument?.(normalizedDocId)?.catch?.(() => {});
      }
      if (addedUser && normalizedDocId && currentDid) {
        const entry = this.openDocuments.get(normalizedDocId);
        entry?.users.delete(currentDid);
        if (entry?.users.size === 0) {
          this.openDocuments.delete(normalizedDocId);
        }
      }
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
      this._assertUsable();
      const generation = this._generation;
      if (!docId) {
        throw new Error("Document ID is required");
      }
      const normalizedDocId = assertSocialDocumentId(docId, this.boundaries);

      const currentDid = this._getCurrentDid();

      const entry = this.openDocuments.get(normalizedDocId);
      if (entry) {
        entry.users.delete(currentDid);
        if (entry.users.size === 0) {
          this.openDocuments.delete(normalizedDocId);
        }
      }

      // Close in Yjs if manager is available
      if (this.yjsCollabManager) {
        try {
          await this.yjsCollabManager.closeDocument(normalizedDocId);
          this._assertGeneration(generation);
        } catch (err) {
          if (this._destroyed || generation !== this._generation) {
            throw this._destroyedError();
          }
          logger.warn("[SocialCollabEngine] Yjs close failed:", err.message);
        }
      }

      this._assertGeneration(generation);
      this.emit("document:closed", {
        docId: normalizedDocId,
        userDid: currentDid,
      });
      logger.info(
        `[SocialCollabEngine] Document ${normalizedDocId} closed by ${currentDid}`,
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
      this._assertUsable();
      const generation = this._generation;
      const currentDid = this._requireCurrentDid();

      if (!docId || !inviteeDid) {
        throw new Error("Document ID and invitee DID are required");
      }
      const normalizedDocId = assertSocialDocumentId(docId, this.boundaries);
      const normalizedInviteeDid = assertSocialPeerId(
        inviteeDid,
        this.boundaries,
      );
      const normalizedPermission = this._assertEnum(
        permission,
        InvitePermission,
        "invite permission",
      );

      if (currentDid === normalizedInviteeDid) {
        throw new Error("Cannot invite yourself");
      }

      // Only the owner can invite
      const document = await this.getDocumentById(normalizedDocId);
      this._assertGeneration(generation);
      if (!document) {
        throw new Error("Document not found");
      }

      if (document.ownerDid !== currentDid) {
        throw new Error("Only the document owner can invite collaborators");
      }

      const db = this.database.db || this.database.getDatabase();
      const now = this._now();
      const inviteId = uuidv4();

      // Use INSERT OR REPLACE to handle the UNIQUE constraint
      db.prepare(
        `
        INSERT OR REPLACE INTO social_collab_invites (
          id, doc_id, inviter_did, invitee_did, permission, status, created_at
        ) VALUES (?, ?, ?, ?, ?, 'pending', ?)
      `,
      ).run(
        inviteId,
        normalizedDocId,
        currentDid,
        normalizedInviteeDid,
        normalizedPermission,
        now,
      );

      const invite = {
        id: inviteId,
        docId: normalizedDocId,
        inviterDid: currentDid,
        inviteeDid: normalizedInviteeDid,
        permission: normalizedPermission,
        status: InviteStatus.PENDING,
        createdAt: now,
      };

      this.emit("invite:sent", invite);
      logger.info(
        `[SocialCollabEngine] Invite sent to ${normalizedInviteeDid} for doc ${normalizedDocId}`,
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
      this._assertUsable();
      const currentDid = this._getCurrentDid();
      if (!currentDid) {
        return { success: true, documents: [] };
      }

      const db = this.database.db || this.database.getDatabase();
      const normalizedStatus = this._assertEnum(
        status,
        DocStatus,
        "document status",
      );
      const pagination = this._normalizePagination(limit, offset);

      const documents = db
        .prepare(
          `
        SELECT * FROM social_collab_documents
        WHERE owner_did = ? AND status = ?
        ORDER BY updated_at DESC
        LIMIT ? OFFSET ?
      `,
        )
        .all(currentDid, normalizedStatus, pagination.limit, pagination.offset);

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
      this._assertUsable();
      const currentDid = this._getCurrentDid();
      if (!currentDid) {
        return { success: true, documents: [] };
      }

      const db = this.database.db || this.database.getDatabase();
      const pagination = this._normalizePagination(limit, offset);

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
        .all(currentDid, pagination.limit, pagination.offset);

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
      this._assertUsable();
      const generation = this._generation;
      const currentDid = this._requireCurrentDid();

      if (!docId) {
        throw new Error("Document ID is required");
      }
      const normalizedDocId = assertSocialDocumentId(docId, this.boundaries);

      const document = await this.getDocumentById(normalizedDocId);
      this._assertGeneration(generation);
      if (!document) {
        throw new Error("Document not found");
      }

      if (document.ownerDid !== currentDid) {
        throw new Error("Only the document owner can archive it");
      }

      const db = this.database.db || this.database.getDatabase();
      const now = this._now();

      db.prepare(
        `
        UPDATE social_collab_documents
        SET status = 'archived', updated_at = ?
        WHERE id = ?
      `,
      ).run(now, normalizedDocId);

      // Close the document if it's open
      if (this.openDocuments.has(normalizedDocId)) {
        this.openDocuments.delete(normalizedDocId);
      }

      this.emit("document:archived", {
        docId: normalizedDocId,
        userDid: currentDid,
      });
      logger.info(`[SocialCollabEngine] Document ${normalizedDocId} archived`);

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
      const normalizedDocId = assertSocialDocumentId(docId, this.boundaries);

      const db = this.database.db || this.database.getDatabase();

      const row = db
        .prepare(
          `
        SELECT * FROM social_collab_documents WHERE id = ?
      `,
        )
        .get(normalizedDocId);

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
      this._assertUsable();
      const currentDid = this._requireCurrentDid();
      const normalizedInviteId = assertSocialDocumentId(
        inviteId,
        this.boundaries,
      );

      const db = this.database.db || this.database.getDatabase();

      const invite = db
        .prepare(
          `
        SELECT * FROM social_collab_invites WHERE id = ? AND invitee_did = ?
      `,
        )
        .get(normalizedInviteId, currentDid);

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
      ).run(normalizedInviteId);

      this.emit("invite:accepted", {
        inviteId: normalizedInviteId,
        docId: invite.doc_id,
        userDid: currentDid,
      });
      logger.info(
        `[SocialCollabEngine] Invite ${normalizedInviteId} accepted by ${currentDid}`,
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
      this._assertUsable();
      const currentDid = this._requireCurrentDid();
      const normalizedInviteId = assertSocialDocumentId(
        inviteId,
        this.boundaries,
      );

      const db = this.database.db || this.database.getDatabase();

      const invite = db
        .prepare(
          `
        SELECT * FROM social_collab_invites WHERE id = ? AND invitee_did = ?
      `,
        )
        .get(normalizedInviteId, currentDid);

      if (!invite) {
        throw new Error("Invite not found");
      }

      db.prepare(
        `
        UPDATE social_collab_invites SET status = 'rejected' WHERE id = ?
      `,
      ).run(normalizedInviteId);

      this.emit("invite:rejected", {
        inviteId: normalizedInviteId,
        docId: invite.doc_id,
        userDid: currentDid,
      });
      logger.info(
        `[SocialCollabEngine] Invite ${normalizedInviteId} rejected by ${currentDid}`,
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
  async getPendingInvites({ limit = 50, offset = 0 } = {}) {
    try {
      this._assertUsable();
      const currentDid = this._getCurrentDid();
      if (!currentDid) {
        return { success: true, invites: [] };
      }

      const db = this.database.db || this.database.getDatabase();
      const pagination = this._normalizePagination(limit, offset);

      const invites = db
        .prepare(
          `
        SELECT i.*, d.title as doc_title, d.content_type, d.owner_did
        FROM social_collab_invites i
        INNER JOIN social_collab_documents d ON i.doc_id = d.id
        WHERE i.invitee_did = ? AND i.status = 'pending' AND d.status = 'active'
        ORDER BY i.created_at DESC
        LIMIT ? OFFSET ?
      `,
        )
        .all(currentDid, pagination.limit, pagination.offset);

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

  _assertUsable() {
    if (this._destroyed) {
      throw this._destroyedError();
    }
  }

  _destroyedError() {
    return new SocialCollabBoundaryError(
      "ERR_SOCIAL_COLLAB_DESTROYED",
      "Social collaboration engine has been destroyed",
    );
  }

  _assertGeneration(generation) {
    if (this._destroyed || generation !== this._generation) {
      throw this._destroyedError();
    }
  }

  _requireCurrentDid() {
    const currentDid = this._getCurrentDid();
    if (!currentDid) {
      throw new Error("User identity not available");
    }
    return assertSocialPeerId(currentDid, this.boundaries);
  }

  _assertEnum(value, enumObject, name) {
    if (!Object.values(enumObject).includes(value)) {
      throw new SocialCollabBoundaryError(
        "ERR_SOCIAL_COLLAB_VALUE_INVALID",
        `Invalid ${name}`,
        { value },
      );
    }
    return value;
  }

  _assertBoundedText(value, maxBytes, name) {
    const byteLength = Buffer.byteLength(value, "utf8");
    if (byteLength > maxBytes) {
      throw new SocialCollabBoundaryError(
        "ERR_SOCIAL_COLLAB_VALUE_TOO_LARGE",
        `${name} exceeds ${maxBytes} bytes`,
        { byteLength, limitBytes: maxBytes },
      );
    }
    return value;
  }

  _normalizePagination(limit, offset) {
    if (
      !Number.isSafeInteger(limit) ||
      limit <= 0 ||
      limit > this.boundaries.maxQueryItems
    ) {
      throw new SocialCollabBoundaryError(
        "ERR_SOCIAL_COLLAB_QUERY_INVALID",
        `Query limit must be between 1 and ${this.boundaries.maxQueryItems}`,
      );
    }
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      offset > this.boundaries.maxQueryOffset
    ) {
      throw new SocialCollabBoundaryError(
        "ERR_SOCIAL_COLLAB_QUERY_INVALID",
        `Query offset must be between 0 and ${this.boundaries.maxQueryOffset}`,
      );
    }
    return { limit, offset };
  }

  _assertOpenCapacity(docId, did) {
    const entry = this.openDocuments.get(docId);
    if (!entry) {
      if (this.openDocuments.size >= this.boundaries.maxActiveDocuments) {
        throw new SocialCollabBoundaryError(
          "ERR_SOCIAL_COLLAB_DOCUMENT_CAPACITY",
          `Social collaboration document capacity ${this.boundaries.maxActiveDocuments} reached`,
        );
      }
      return;
    }
    if (
      !entry.users.has(did) &&
      entry.users.size >= this.boundaries.maxPeersPerDocument
    ) {
      throw new SocialCollabBoundaryError(
        "ERR_SOCIAL_COLLAB_PEER_CAPACITY",
        `Social collaboration peer capacity ${this.boundaries.maxPeersPerDocument} reached for ${docId}`,
      );
    }
  }

  async _settleWithDeadline(promise, message) {
    let timer;
    try {
      return await Promise.race([
        promise,
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            reject(
              new SocialCollabBoundaryError(
                "ERR_SOCIAL_COLLAB_DEADLINE",
                message,
              ),
            );
          }, this.boundaries.streamDeadlineMs);
          timer.unref?.();
        }),
      ]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

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
    } catch (_error) {
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
    if (this._destroyed) {
      return;
    }
    this._destroyed = true;
    this._generation += 1;
    const openDocumentIds = Array.from(this.openDocuments.keys());
    const yjsCollabManager = this.yjsCollabManager;
    this.openDocuments.clear();
    this.removeAllListeners();
    this.initialized = false;
    this.yjsCollabManager = null;

    if (yjsCollabManager?.closeDocument && openDocumentIds.length > 0) {
      try {
        await this._settleWithDeadline(
          Promise.allSettled(
            openDocumentIds.map((docId) =>
              Promise.resolve().then(() =>
                yjsCollabManager.closeDocument(docId),
              ),
            ),
          ),
          "Timed out closing social collaboration documents",
        );
      } catch (error) {
        logger.warn(
          "[SocialCollabEngine] Document cleanup did not settle:",
          error.message,
        );
      }
    }

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
