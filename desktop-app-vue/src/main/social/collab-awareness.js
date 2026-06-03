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
  constructor() {
    super();

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
  }

  /**
   * Initialize the awareness module
   */
  async initialize() {
    logger.info("[CollabAwareness] Initializing...");

    // Start periodic cleanup of stale cursors
    this.cleanupTimer = setInterval(() => {
      this._cleanupStaleCursors();
    }, CLEANUP_INTERVAL);

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
      if (!docId || !position) {
        throw new Error("Document ID and position are required");
      }

      const localProfile = this._getLocalProfile();
      if (!localProfile) {
        throw new Error("Local user profile not set");
      }

      // Initialize document cursor map if needed
      if (!this.cursors.has(docId)) {
        this.cursors.set(docId, new Map());
      }

      const docCursors = this.cursors.get(docId);

      const cursorState = {
        did: localProfile.did,
        name: localProfile.name,
        color: localProfile.color,
        position: {
          line: position.line || 0,
          column: position.column || 0,
          offset: position.offset || 0,
        },
        selection: selection
          ? {
              start: {
                line: selection.start?.line || 0,
                column: selection.start?.column || 0,
                offset: selection.start?.offset || 0,
              },
              end: {
                line: selection.end?.line || 0,
                column: selection.end?.column || 0,
                offset: selection.end?.offset || 0,
              },
            }
          : null,
        lastActivity: Date.now(),
        isLocal: true,
      };

      docCursors.set(localProfile.did, cursorState);

      this.emit("cursor:updated", { docId, cursor: cursorState });

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
      if (!docId || !cursorData || !cursorData.did) {
        return;
      }

      if (!this.cursors.has(docId)) {
        this.cursors.set(docId, new Map());
      }

      const docCursors = this.cursors.get(docId);

      // Ensure the user has a profile/color
      const profile = this._ensureProfile(cursorData.did, cursorData.name);

      const cursorState = {
        did: cursorData.did,
        name: cursorData.name || profile.name,
        color: profile.color,
        position: cursorData.position || { line: 0, column: 0, offset: 0 },
        selection: cursorData.selection || null,
        lastActivity: Date.now(),
        isLocal: false,
      };

      const isNewUser = !docCursors.has(cursorData.did);
      docCursors.set(cursorData.did, cursorState);

      if (isNewUser) {
        this.emit("user:joined", { docId, user: cursorState });
        logger.info(`[CollabAwareness] User ${cursorData.did} joined doc ${docId}`);
      }

      this.emit("cursor:updated", { docId, cursor: cursorState });
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
      if (!docId) {
        throw new Error("Document ID is required");
      }

      const docCursors = this.cursors.get(docId);
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
        docId,
        did: localProfile.did,
        name: localProfile.name,
        color: localProfile.color,
        position: localCursor.position,
        selection: localCursor.selection,
        timestamp: Date.now(),
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

      const docCursors = this.cursors.get(docId);
      if (!docCursors) {
        return [];
      }

      const localProfile = this._getLocalProfile();
      const localDid = localProfile?.did;
      const now = Date.now();
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

      const docCursors = this.cursors.get(docId);
      if (!docCursors) {
        return [];
      }

      const now = Date.now();
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

    const assignedColor = color || this._assignColor(did);

    this.userProfiles.set(did, {
      did,
      name: name || did.substring(0, 12) + "...",
      color: assignedColor,
    });

    logger.info(`[CollabAwareness] User profile set for ${did}: ${name} (${assignedColor})`);
  }

  /**
   * Remove a user from a document's awareness
   * @param {string} docId - Document ID
   * @param {string} did - User DID
   */
  removeUser(docId, did) {
    const docCursors = this.cursors.get(docId);
    if (docCursors && docCursors.has(did)) {
      const cursor = docCursors.get(did);
      docCursors.delete(did);

      this.emit("user:left", { docId, user: cursor });
      logger.info(`[CollabAwareness] User ${did} left doc ${docId}`);

      if (docCursors.size === 0) {
        this.cursors.delete(docId);
      }
    }
  }

  /**
   * Clear all awareness data for a document
   * @param {string} docId - Document ID
   */
  clearDocument(docId) {
    if (this.cursors.has(docId)) {
      const docCursors = this.cursors.get(docId);
      for (const [did, cursor] of docCursors) {
        this.emit("user:left", { docId, user: cursor });
      }
      this.cursors.delete(docId);
    }
  }

  /**
   * Get the count of active users in a document
   * @param {string} docId - Document ID
   * @returns {number} Active user count
   */
  getActiveUserCount(docId) {
    const docCursors = this.cursors.get(docId);
    if (!docCursors) {
      return 0;
    }

    const now = Date.now();
    let count = 0;
    for (const [, cursor] of docCursors) {
      if (now - cursor.lastActivity <= PRESENCE_TIMEOUT) {
        count++;
      }
    }
    return count;
  }

  // ========================================
  // Internal Methods
  // ========================================

  /**
   * Get the local user's profile
   */
  _getLocalProfile() {
    // Find the profile marked as local, or the first one with "local" flag
    for (const [did, profile] of this.userProfiles) {
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
    const assignedColor = color || this._assignColor(did);
    this.userProfiles.set(did, {
      did,
      name: name || did.substring(0, 12) + "...",
      color: assignedColor,
      isLocal: true,
    });
  }

  /**
   * Ensure a user has a profile, create one if missing
   */
  _ensureProfile(did, name) {
    if (!this.userProfiles.has(did)) {
      this.setUserProfile(did, name);
    }
    return this.userProfiles.get(did);
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
    const now = Date.now();

    for (const [docId, docCursors] of this.cursors) {
      for (const [did, cursor] of docCursors) {
        if (now - cursor.lastActivity > PRESENCE_TIMEOUT && !cursor.isLocal) {
          docCursors.delete(did);
          this.emit("user:left", { docId, user: cursor });
          logger.info(`[CollabAwareness] Stale cursor removed for ${did} in doc ${docId}`);
        }
      }

      if (docCursors.size === 0) {
        this.cursors.delete(docId);
      }
    }
  }

  /**
   * Clean up resources
   */
  async destroy() {
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
