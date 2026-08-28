/**
 * Social Collaboration Awareness
 *
 * Manages cursor positions, text selections, and user presence
 * for collaborative editing. Provides real-time awareness of
 * what other collaborators are doing in a shared document.
 *
 * @module social/collab-awareness
 * @version 0.41.0
 */

const { logger } = require("../utils/logger.js");
const EventEmitter = require("events");
const {
  SocialCollabBoundaryError,
  createSocialCollabBoundaries,
  assertSocialDocumentId,
  assertSocialPeerId,
} = require("./social-collab-boundaries");

/**
 * Default cursor colors for collaborators
 */
const CURSOR_COLORS = [
  "#FF6B6B", // Red
  "#4ECDC4", // Teal
  "#45B7D1", // Sky blue
  "#96CEB4", // Sage green
  "#FFEAA7", // Pale yellow
  "#DDA0DD", // Plum
  "#98D8C8", // Mint
  "#F7DC6F", // Gold
  "#BB8FCE", // Lavender
  "#85C1E9", // Light blue
  "#F8B500", // Amber
  "#00CED1", // Dark turquoise
  "#FF7675", // Coral
  "#74B9FF", // Periwinkle
  "#A29BFE", // Soft purple
  "#FD79A8", // Pink
];

/**
 * How long a user is considered "present" without activity (ms)
 */
const PRESENCE_TIMEOUT = 60000; // 1 minute

/**
 * How often to clean up stale cursors (ms)
 */
const CLEANUP_INTERVAL = 30000; // 30 seconds

class CollabAwareness extends EventEmitter {
  constructor(_p2pManager = null, options = {}) {
    super();
    this.boundaries = createSocialCollabBoundaries(options.boundaries || {});
    this._now =
      typeof options.now === "function" ? options.now : () => Date.now();

    /**
     * Cursor positions by document
     * Map<docId, Map<userDid, CursorState>>
     *
     * CursorState: {
     *   did: string,
     *   name: string,
     *   color: string,
     *   position: { line: number, column: number, offset: number },
     *   selection: { start: {...}, end: {...} } | null,
     *   lastActivity: number
     * }
     */
    this.cursors = new Map();

    /**
     * User profiles
     * Map<did, { name: string, color: string }>
     */
    this.userProfiles = new Map();

    /**
     * Color assignment counter (for consistent but varied colors)
     */
    this.colorIndex = 0;

    /**
     * Cleanup timer reference
     */
    this.cleanupTimer = null;

    this.initialized = false;
    this._destroyed = false;
  }

  /**
   * Initialize the awareness module
   */
  async initialize() {
    if (this._destroyed) {
      throw new SocialCollabBoundaryError(
        "ERR_SOCIAL_COLLAB_DESTROYED",
        "Social collaboration awareness has been destroyed",
      );
    }
    if (this.initialized) {
      return;
    }
    logger.info("[CollabAwareness] Initializing...");

    // Start periodic cleanup of stale cursors
    this.cleanupTimer = setInterval(() => {
      this._cleanupStaleCursors();
    }, CLEANUP_INTERVAL);
    this.cleanupTimer.unref?.();

    this.initialized = true;
    logger.info("[CollabAwareness] Initialized successfully");
  }

  /**
   * Set the local user's cursor position in a document
   * @param {string} docId - Document ID
   * @param {Object} position - Cursor position
   * @param {number} position.line - Line number (0-based)
   * @param {number} position.column - Column number (0-based)
   * @param {number} [position.offset] - Character offset from start
   * @param {Object} [selection] - Text selection range
   * @param {Object} [selection.start] - Selection start position
   * @param {Object} [selection.end] - Selection end position
   * @returns {Object} Result
   */
  setLocalCursor(docId, position, selection = null) {
    try {
      this._assertUsable();
      if (!docId || !position) {
        throw new Error("Document ID and position are required");
      }
      const normalizedDocId = assertSocialDocumentId(docId, this.boundaries);

      const localProfile = this._getLocalProfile();
      if (!localProfile) {
        throw new Error("Local user profile not set");
      }

      const normalizedPosition = this._normalizePosition(position);
      const normalizedSelection = this._normalizeSelection(selection);
      this._assertCursorCapacity(normalizedDocId, localProfile.did);
      const docCursors = this._ensureDocumentCursors(normalizedDocId);

      const cursorState = {
        did: localProfile.did,
        name: localProfile.name,
        color: localProfile.color,
        position: normalizedPosition,
        selection: normalizedSelection,
        lastActivity: this._now(),
        isLocal: true,
      };

      this._retainCursor(
        normalizedDocId,
        docCursors,
        localProfile.did,
        cursorState,
      );

      this.emit("cursor:updated", {
        docId: normalizedDocId,
        cursor: cursorState,
      });

      return { success: true, cursor: cursorState };
    } catch (error) {
      logger.error("[CollabAwareness] Error setting local cursor:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Update a remote user's cursor position
   * @param {string} docId - Document ID
   * @param {Object} cursorData - Remote cursor data
   */
  updateRemoteCursor(docId, cursorData) {
    try {
      this._assertUsable();
      if (!docId || !cursorData || !cursorData.did) {
        return;
      }
      const normalizedDocId = assertSocialDocumentId(docId, this.boundaries);
      const normalizedDid = assertSocialPeerId(cursorData.did, this.boundaries);
      const normalizedName = this._normalizeName(
        cursorData.name,
        normalizedDid,
        this.userProfiles.get(normalizedDid)?.name,
      );
      const normalizedPosition = this._normalizePosition(cursorData.position);
      const normalizedSelection = this._normalizeSelection(
        cursorData.selection,
      );
      this._assertCursorCapacity(normalizedDocId, normalizedDid);

      // Ensure the user has a profile/color
      const profile = this._ensureProfile(normalizedDid, normalizedName);
      const docCursors = this._ensureDocumentCursors(normalizedDocId);

      const cursorState = {
        did: normalizedDid,
        name: normalizedName,
        color: profile.color,
        position: normalizedPosition,
        selection: normalizedSelection,
        lastActivity: this._now(),
        isLocal: false,
      };

      const isNewUser = !docCursors.has(normalizedDid);
      this._retainCursor(
        normalizedDocId,
        docCursors,
        normalizedDid,
        cursorState,
      );

      if (isNewUser) {
        this.emit("user:joined", {
          docId: normalizedDocId,
          user: cursorState,
        });
        logger.info(
          `[CollabAwareness] User ${normalizedDid} joined doc ${normalizedDocId}`,
        );
      }

      this.emit("cursor:updated", {
        docId: normalizedDocId,
        cursor: cursorState,
      });
    } catch (error) {
      logger.error("[CollabAwareness] Error updating remote cursor:", error);
    }
  }

  /**
   * Broadcast awareness state for a document to all listeners
   * @param {string} docId - Document ID
   * @returns {Object} Awareness data to send to peers
   */
  broadcastAwareness(docId) {
    try {
      this._assertUsable();
      if (!docId) {
        throw new Error("Document ID is required");
      }
      const normalizedDocId = assertSocialDocumentId(docId, this.boundaries);

      const docCursors = this.cursors.get(normalizedDocId);
      if (!docCursors) {
        return { success: true, cursors: [] };
      }

      const localProfile = this._getLocalProfile();
      if (!localProfile) {
        return { success: true, cursors: [] };
      }

      const localCursor = docCursors.get(localProfile.did);
      if (!localCursor) {
        return { success: true, cursors: [] };
      }

      // Return the local cursor data for broadcasting to peers
      const broadcastData = {
        docId: normalizedDocId,
        did: localProfile.did,
        name: localProfile.name,
        color: localProfile.color,
        position: localCursor.position,
        selection: localCursor.selection,
        timestamp: this._now(),
      };

      return { success: true, data: broadcastData };
    } catch (error) {
      logger.error("[CollabAwareness] Error broadcasting awareness:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get all remote cursors for a document (excludes local user)
   * @param {string} docId - Document ID
   * @returns {Object[]} List of remote cursor states
   */
  getRemoteCursors(docId) {
    try {
      if (!docId) {
        return [];
      }

      const normalizedDocId = assertSocialDocumentId(docId, this.boundaries);
      const docCursors = this.cursors.get(normalizedDocId);
      if (!docCursors) {
        return [];
      }

      const localProfile = this._getLocalProfile();
      const localDid = localProfile?.did;
      const now = this._now();
      const result = [];

      for (const [did, cursor] of docCursors) {
        // Skip local user and stale cursors
        if (did === localDid) {
          continue;
        }

        if (now - cursor.lastActivity > PRESENCE_TIMEOUT) {
          continue;
        }

        result.push({
          did: cursor.did,
          name: cursor.name,
          color: cursor.color,
          position: cursor.position,
          selection: cursor.selection,
          lastActivity: cursor.lastActivity,
        });
      }

      return result;
    } catch (error) {
      logger.error("[CollabAwareness] Error getting remote cursors:", error);
      return [];
    }
  }

  /**
   * Get all cursors for a document (including local)
   * @param {string} docId - Document ID
   * @returns {Object[]} List of all cursor states
   */
  getAllCursors(docId) {
    try {
      if (!docId) {
        return [];
      }

      const normalizedDocId = assertSocialDocumentId(docId, this.boundaries);
      const docCursors = this.cursors.get(normalizedDocId);
      if (!docCursors) {
        return [];
      }

      const now = this._now();
      const result = [];

      for (const [, cursor] of docCursors) {
        if (now - cursor.lastActivity > PRESENCE_TIMEOUT) {
          continue;
        }

        result.push({
          did: cursor.did,
          name: cursor.name,
          color: cursor.color,
          position: cursor.position,
          selection: cursor.selection,
          lastActivity: cursor.lastActivity,
          isLocal: cursor.isLocal || false,
        });
      }

      return result;
    } catch (error) {
      logger.error("[CollabAwareness] Error getting all cursors:", error);
      return [];
    }
  }

  /**
   * Set a user profile (name and color)
   * @param {string} did - User DID
   * @param {string} name - Display name
   * @param {string} [color] - Cursor color (auto-assigned if not provided)
   */
  setUserProfile(did, name, color = null) {
    if (!did) {
      return;
    }
    this._assertUsable();
    const normalizedDid = assertSocialPeerId(did, this.boundaries);
    const existing = this.userProfiles.get(normalizedDid);
    this._assertProfileCapacity(normalizedDid);
    const assignedColor = this._normalizeColor(
      color ?? existing?.color,
      normalizedDid,
    );
    const profile = {
      did: normalizedDid,
      name: this._normalizeName(name, normalizedDid, existing?.name),
      color: assignedColor,
      lastActivity: this._now(),
      ...(existing?.isLocal ? { isLocal: true } : {}),
    };
    this.userProfiles.set(normalizedDid, profile);

    logger.info(
      `[CollabAwareness] User profile set for ${normalizedDid}: ${profile.name} (${assignedColor})`,
    );
    return profile;
  }

  /**
   * Remove a user from a document's awareness
   * @param {string} docId - Document ID
   * @param {string} did - User DID
   */
  removeUser(docId, did) {
    try {
      const normalizedDocId = assertSocialDocumentId(docId, this.boundaries);
      const normalizedDid = assertSocialPeerId(did, this.boundaries);
      const docCursors = this.cursors.get(normalizedDocId);
      if (!docCursors || !docCursors.has(normalizedDid)) {
        return;
      }
      const cursor = docCursors.get(normalizedDid);
      docCursors.delete(normalizedDid);

      this.emit("user:left", { docId: normalizedDocId, user: cursor });
      logger.info(
        `[CollabAwareness] User ${normalizedDid} left doc ${normalizedDocId}`,
      );

      if (docCursors.size === 0) {
        this.cursors.delete(normalizedDocId);
      }
    } catch (error) {
      logger.error("[CollabAwareness] Error removing user:", error);
    }
  }

  /**
   * Clear all awareness data for a document
   * @param {string} docId - Document ID
   */
  clearDocument(docId) {
    try {
      const normalizedDocId = assertSocialDocumentId(docId, this.boundaries);
      if (!this.cursors.has(normalizedDocId)) {
        return;
      }
      const docCursors = this.cursors.get(normalizedDocId);
      for (const [, cursor] of docCursors) {
        this.emit("user:left", { docId: normalizedDocId, user: cursor });
      }
      this.cursors.delete(normalizedDocId);
    } catch (error) {
      logger.error("[CollabAwareness] Error clearing document:", error);
    }
  }

  /**
   * Get the count of active users in a document
   * @param {string} docId - Document ID
   * @returns {number} Active user count
   */
  getActiveUserCount(docId) {
    try {
      if (!docId) {
        return 0;
      }
      const normalizedDocId = assertSocialDocumentId(docId, this.boundaries);
      const docCursors = this.cursors.get(normalizedDocId);
      if (!docCursors) {
        return 0;
      }

      const now = this._now();
      let count = 0;
      for (const [, cursor] of docCursors) {
        if (now - cursor.lastActivity <= PRESENCE_TIMEOUT) {
          count++;
        }
      }
      return count;
    } catch (error) {
      logger.error("[CollabAwareness] Error counting active users:", error);
      return 0;
    }
  }

  // ========================================
  // Internal Methods
  // ========================================

  /**
   * Get the local user's profile
   */
  _getLocalProfile() {
    // Find the profile marked as local, or the first one with "local" flag
    for (const [, profile] of this.userProfiles) {
      if (profile.isLocal) {
        return profile;
      }
    }

    // Fallback: return the first profile
    if (this.userProfiles.size > 0) {
      const first = this.userProfiles.values().next().value;
      return first;
    }

    return null;
  }

  /**
   * Set the local user profile
   * @param {string} did - User DID
   * @param {string} name - Display name
   * @param {string} [color] - Optional color
   */
  setLocalProfile(did, name, color = null) {
    this._assertUsable();
    const normalizedDid = assertSocialPeerId(did, this.boundaries);
    const existing = this.userProfiles.get(normalizedDid);
    this._assertProfileCapacity(normalizedDid);
    const assignedColor = this._normalizeColor(
      color ?? existing?.color,
      normalizedDid,
    );
    const profile = {
      did: normalizedDid,
      name: this._normalizeName(name, normalizedDid, existing?.name),
      color: assignedColor,
      isLocal: true,
      lastActivity: this._now(),
    };
    this.userProfiles.set(normalizedDid, profile);
    return profile;
  }

  /**
   * Ensure a user has a profile, create one if missing
   */
  _ensureProfile(did, name) {
    if (!this.userProfiles.has(did)) {
      this.setUserProfile(did, name);
    } else {
      const profile = this.userProfiles.get(did);
      profile.lastActivity = this._now();
    }
    return this.userProfiles.get(did);
  }

  _assertUsable() {
    if (this._destroyed) {
      throw new SocialCollabBoundaryError(
        "ERR_SOCIAL_COLLAB_DESTROYED",
        "Social collaboration awareness has been destroyed",
      );
    }
  }

  _assertProfileCapacity(did) {
    if (
      !this.userProfiles.has(did) &&
      this.userProfiles.size >= this.boundaries.maxProfiles
    ) {
      throw new SocialCollabBoundaryError(
        "ERR_SOCIAL_COLLAB_PROFILE_CAPACITY",
        `Social collaboration profile capacity ${this.boundaries.maxProfiles} reached`,
      );
    }
  }

  _assertCursorCapacity(docId, did) {
    const docCursors = this.cursors.get(docId);
    if (!docCursors) {
      if (this.cursors.size >= this.boundaries.maxActiveDocuments) {
        throw new SocialCollabBoundaryError(
          "ERR_SOCIAL_COLLAB_DOCUMENT_CAPACITY",
          `Social collaboration document capacity ${this.boundaries.maxActiveDocuments} reached`,
        );
      }
      return;
    }
    if (
      !docCursors.has(did) &&
      docCursors.size >= this.boundaries.maxPeersPerDocument
    ) {
      throw new SocialCollabBoundaryError(
        "ERR_SOCIAL_COLLAB_PEER_CAPACITY",
        `Social collaboration peer capacity ${this.boundaries.maxPeersPerDocument} reached for ${docId}`,
      );
    }
  }

  _ensureDocumentCursors(docId) {
    if (!this.cursors.has(docId)) {
      this.cursors.set(docId, new Map());
    }
    return this.cursors.get(docId);
  }

  _retainCursor(docId, docCursors, did, cursorState) {
    if (
      !docCursors.has(did) &&
      docCursors.size >= this.boundaries.maxPeersPerDocument
    ) {
      throw new SocialCollabBoundaryError(
        "ERR_SOCIAL_COLLAB_PEER_CAPACITY",
        `Social collaboration peer capacity ${this.boundaries.maxPeersPerDocument} reached for ${docId}`,
      );
    }
    docCursors.set(did, cursorState);
  }

  _normalizePosition(position = {}) {
    if (
      position === null ||
      typeof position !== "object" ||
      Array.isArray(position)
    ) {
      throw new SocialCollabBoundaryError(
        "ERR_SOCIAL_COLLAB_CURSOR_INVALID",
        "Cursor position must be an object",
      );
    }
    const normalized = {};
    for (const key of ["line", "column", "offset"]) {
      const value = position[key] ?? 0;
      if (!Number.isSafeInteger(value) || value < 0) {
        throw new SocialCollabBoundaryError(
          "ERR_SOCIAL_COLLAB_CURSOR_INVALID",
          `Cursor ${key} must be a non-negative safe integer`,
        );
      }
      normalized[key] = value;
    }
    return normalized;
  }

  _normalizeSelection(selection) {
    if (selection === undefined || selection === null) {
      return null;
    }
    if (typeof selection !== "object" || Array.isArray(selection)) {
      throw new SocialCollabBoundaryError(
        "ERR_SOCIAL_COLLAB_CURSOR_INVALID",
        "Cursor selection must be an object",
      );
    }
    return {
      start: this._normalizePosition(selection.start),
      end: this._normalizePosition(selection.end),
    };
  }

  _normalizeName(name, did, fallbackName) {
    const normalized =
      name === undefined || name === null || name === ""
        ? fallbackName || `${did.substring(0, 12)}...`
        : name;
    if (typeof normalized !== "string") {
      throw new SocialCollabBoundaryError(
        "ERR_SOCIAL_COLLAB_PROFILE_INVALID",
        "Display name must be a string",
      );
    }
    const byteLength = Buffer.byteLength(normalized, "utf8");
    if (byteLength > this.boundaries.maxDisplayNameBytes) {
      throw new SocialCollabBoundaryError(
        "ERR_SOCIAL_COLLAB_PROFILE_INVALID",
        `Display name exceeds ${this.boundaries.maxDisplayNameBytes} bytes`,
      );
    }
    return normalized;
  }

  _normalizeColor(color, did) {
    const normalized = color || this._assignColor(did);
    if (typeof normalized !== "string" || !/^#[0-9a-f]{6}$/i.test(normalized)) {
      throw new SocialCollabBoundaryError(
        "ERR_SOCIAL_COLLAB_PROFILE_INVALID",
        "Cursor color must be a six-digit hexadecimal color",
      );
    }
    return normalized;
  }

  /**
   * Assign a consistent color to a user based on their DID
   */
  _assignColor(did) {
    if (!did) {
      return CURSOR_COLORS[0];
    }

    // Hash the DID to get a consistent color
    let hash = 0;
    for (let i = 0; i < did.length; i++) {
      hash = ((hash << 5) - hash + did.charCodeAt(i)) | 0;
    }

    return CURSOR_COLORS[Math.abs(hash) % CURSOR_COLORS.length];
  }

  /**
   * Clean up stale cursors that have timed out
   */
  _cleanupStaleCursors() {
    const now = this._now();

    for (const [docId, docCursors] of this.cursors) {
      for (const [did, cursor] of docCursors) {
        if (now - cursor.lastActivity > PRESENCE_TIMEOUT && !cursor.isLocal) {
          docCursors.delete(did);
          this.emit("user:left", { docId, user: cursor });
          logger.info(
            `[CollabAwareness] Stale cursor removed for ${did} in doc ${docId}`,
          );
        }
      }

      if (docCursors.size === 0) {
        this.cursors.delete(docId);
      }
    }

    for (const [did, profile] of this.userProfiles) {
      if (
        !profile.isLocal &&
        now - profile.lastActivity > PRESENCE_TIMEOUT &&
        !this._profileIsReferenced(did)
      ) {
        this.userProfiles.delete(did);
      }
    }
  }

  _profileIsReferenced(did) {
    for (const docCursors of this.cursors.values()) {
      if (docCursors.has(did)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Clean up resources
   */
  async destroy() {
    if (this._destroyed) {
      return;
    }
    this._destroyed = true;
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    this.cursors.clear();
    this.userProfiles.clear();
    this.removeAllListeners();
    this.initialized = false;

    logger.info("[CollabAwareness] Destroyed");
  }
}

module.exports = {
  CollabAwareness,
  CURSOR_COLORS,
  PRESENCE_TIMEOUT,
};
