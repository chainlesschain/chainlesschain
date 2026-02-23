/**
 * Shared Album Manager
 *
 * Manages shared photo albums with member management and P2P sync.
 * Features:
 * - Album CRUD (create, read, update, delete)
 * - Member management (owner, editor, viewer roles)
 * - Photo management with encryption support
 * - P2P album sharing and sync
 * - Visibility controls (private, friends, public)
 */

const { logger } = require("../utils/logger.js");
const EventEmitter = require("events");
const { v4: uuidv4 } = require("uuid");

/**
 * Album visibility levels
 */
const AlbumVisibility = {
  PRIVATE: "private",
  FRIENDS: "friends",
  PUBLIC: "public",
};

/**
 * Album member roles
 */
const AlbumMemberRole = {
  OWNER: "owner",
  EDITOR: "editor",
  VIEWER: "viewer",
};

/**
 * Shared Album Manager class
 */
class SharedAlbumManager extends EventEmitter {
  constructor(database, didManager, p2pManager, friendManager) {
    super();

    this.database = database;
    this.didManager = didManager;
    this.p2pManager = p2pManager;
    this.friendManager = friendManager;

    this.initialized = false;
  }

  /**
   * Initialize shared album manager
   */
  async initialize() {
    logger.info("[SharedAlbumManager] Initializing shared album manager...");

    try {
      await this.initializeTables();
      this.setupP2PListeners();

      this.initialized = true;
      logger.info(
        "[SharedAlbumManager] Shared album manager initialized successfully",
      );
    } catch (error) {
      logger.error("[SharedAlbumManager] Initialization failed:", error);
      throw error;
    }
  }

  /**
   * Initialize database tables
   */
  async initializeTables() {
    const db = this.database.db;

    // Shared albums table
    db.exec(`
      CREATE TABLE IF NOT EXISTS shared_albums (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        cover_url TEXT,
        owner_did TEXT NOT NULL,
        visibility TEXT NOT NULL DEFAULT 'friends'
          CHECK(visibility IN ('private', 'friends', 'public')),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);

    // Album members table
    db.exec(`
      CREATE TABLE IF NOT EXISTS album_members (
        id TEXT PRIMARY KEY,
        album_id TEXT NOT NULL,
        member_did TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'viewer'
          CHECK(role IN ('owner', 'editor', 'viewer')),
        joined_at INTEGER NOT NULL,
        UNIQUE(album_id, member_did),
        FOREIGN KEY (album_id) REFERENCES shared_albums(id) ON DELETE CASCADE
      )
    `);

    // Album photos table
    db.exec(`
      CREATE TABLE IF NOT EXISTS album_photos (
        id TEXT PRIMARY KEY,
        album_id TEXT NOT NULL,
        uploader_did TEXT NOT NULL,
        file_path TEXT,
        thumbnail_path TEXT,
        caption TEXT,
        file_size INTEGER,
        mime_type TEXT,
        width INTEGER,
        height INTEGER,
        is_encrypted INTEGER DEFAULT 1,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (album_id) REFERENCES shared_albums(id) ON DELETE CASCADE
      )
    `);

    // Create indexes
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_shared_albums_owner
        ON shared_albums(owner_did);
      CREATE INDEX IF NOT EXISTS idx_album_members_album
        ON album_members(album_id);
      CREATE INDEX IF NOT EXISTS idx_album_members_member
        ON album_members(member_did);
      CREATE INDEX IF NOT EXISTS idx_album_photos_album
        ON album_photos(album_id);
      CREATE INDEX IF NOT EXISTS idx_album_photos_created
        ON album_photos(created_at DESC);
    `);

    logger.info("[SharedAlbumManager] Database tables initialized");
  }

  /**
   * Setup P2P event listeners
   */
  setupP2PListeners() {
    if (!this.p2pManager) {
      return;
    }

    // Listen for album share invitations
    this.p2pManager.on("album:share-received", async ({ album, senderDid }) => {
      await this.handleAlbumShareReceived(album, senderDid);
    });

    // Listen for photo sync requests
    this.p2pManager.on(
      "album:photo-received",
      async ({ photo, albumId, senderDid }) => {
        await this.handlePhotoReceived(photo, albumId, senderDid);
      },
    );

    logger.info("[SharedAlbumManager] P2P event listeners set up");
  }

  /**
   * Create a new shared album
   * @param {Object} options - Album options
   * @param {string} options.name - Album name
   * @param {string} options.description - Album description
   * @param {string} options.coverUrl - Cover image URL
   * @param {string} options.visibility - Album visibility
   * @returns {Object} Created album
   */
  async createAlbum({
    name,
    description = "",
    coverUrl = null,
    visibility = AlbumVisibility.FRIENDS,
  }) {
    try {
      const currentDid = this.didManager?.getCurrentIdentity()?.did;

      if (!currentDid) {
        throw new Error("Not logged in, cannot create album");
      }

      if (!name || name.trim().length === 0) {
        throw new Error("Album name cannot be empty");
      }

      if (name.length > 100) {
        throw new Error("Album name cannot exceed 100 characters");
      }

      const albumId = uuidv4();
      const now = Date.now();

      const db = this.database.db;

      // Insert album record
      db.prepare(
        `
        INSERT INTO shared_albums
        (id, name, description, cover_url, owner_did, visibility, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      ).run(
        albumId,
        name.trim(),
        description || null,
        coverUrl || null,
        currentDid,
        visibility,
        now,
        now,
      );

      // Add owner as a member
      db.prepare(
        `
        INSERT INTO album_members (id, album_id, member_did, role, joined_at)
        VALUES (?, ?, ?, ?, ?)
      `,
      ).run(uuidv4(), albumId, currentDid, AlbumMemberRole.OWNER, now);

      const album = {
        id: albumId,
        name: name.trim(),
        description: description || null,
        cover_url: coverUrl || null,
        owner_did: currentDid,
        visibility,
        created_at: now,
        updated_at: now,
      };

      logger.info("[SharedAlbumManager] Album created:", albumId);

      this.emit("album:created", { album });

      return album;
    } catch (error) {
      logger.error("[SharedAlbumManager] Failed to create album:", error);
      throw error;
    }
  }

  /**
   * Delete an album
   * @param {string} albumId - Album ID
   */
  async deleteAlbum(albumId) {
    try {
      const currentDid = this.didManager?.getCurrentIdentity()?.did;

      if (!currentDid) {
        throw new Error("Not logged in");
      }

      const db = this.database.db;
      const album = db
        .prepare("SELECT * FROM shared_albums WHERE id = ?")
        .get(albumId);

      if (!album) {
        throw new Error("Album not found");
      }

      if (album.owner_did !== currentDid) {
        throw new Error("Only the owner can delete this album");
      }

      // Delete photos, members, and album (cascade handled by FK constraints)
      db.prepare("DELETE FROM album_photos WHERE album_id = ?").run(albumId);
      db.prepare("DELETE FROM album_members WHERE album_id = ?").run(albumId);
      db.prepare("DELETE FROM shared_albums WHERE id = ?").run(albumId);

      logger.info("[SharedAlbumManager] Album deleted:", albumId);

      this.emit("album:deleted", { albumId });

      return { success: true };
    } catch (error) {
      logger.error("[SharedAlbumManager] Failed to delete album:", error);
      throw error;
    }
  }

  /**
   * Update an album
   * @param {string} albumId - Album ID
   * @param {Object} updates - Fields to update
   */
  async updateAlbum(albumId, updates) {
    try {
      const currentDid = this.didManager?.getCurrentIdentity()?.did;

      if (!currentDid) {
        throw new Error("Not logged in");
      }

      const db = this.database.db;
      const album = db
        .prepare("SELECT * FROM shared_albums WHERE id = ?")
        .get(albumId);

      if (!album) {
        throw new Error("Album not found");
      }

      // Check permissions (owner or editor)
      const member = db
        .prepare(
          "SELECT * FROM album_members WHERE album_id = ? AND member_did = ?",
        )
        .get(albumId, currentDid);

      if (
        !member ||
        (member.role !== AlbumMemberRole.OWNER &&
          member.role !== AlbumMemberRole.EDITOR)
      ) {
        throw new Error("No permission to update this album");
      }

      const now = Date.now();
      const allowedFields = ["name", "description", "cover_url", "visibility"];
      const setClauses = [];
      const params = [];

      for (const field of allowedFields) {
        if (updates[field] !== undefined) {
          setClauses.push(`${field} = ?`);
          params.push(updates[field]);
        }
      }

      if (setClauses.length === 0) {
        return album;
      }

      setClauses.push("updated_at = ?");
      params.push(now);
      params.push(albumId);

      db.prepare(
        `UPDATE shared_albums SET ${setClauses.join(", ")} WHERE id = ?`,
      ).run(...params);

      const updatedAlbum = db
        .prepare("SELECT * FROM shared_albums WHERE id = ?")
        .get(albumId);

      logger.info("[SharedAlbumManager] Album updated:", albumId);

      this.emit("album:updated", { album: updatedAlbum });

      return updatedAlbum;
    } catch (error) {
      logger.error("[SharedAlbumManager] Failed to update album:", error);
      throw error;
    }
  }

  /**
   * Get list of albums for current user
   * @param {Object} options - Query options
   * @param {number} options.limit - Limit
   * @param {number} options.offset - Offset
   * @param {string} options.visibility - Filter by visibility
   * @returns {Array} Albums list
   */
  async getAlbums({ limit = 50, offset = 0, visibility = null } = {}) {
    try {
      const currentDid = this.didManager?.getCurrentIdentity()?.did;

      if (!currentDid) {
        return [];
      }

      const db = this.database.db;

      let query = `
        SELECT DISTINCT sa.*, am.role as member_role,
          (SELECT COUNT(*) FROM album_photos WHERE album_id = sa.id) as photo_count,
          (SELECT COUNT(*) FROM album_members WHERE album_id = sa.id) as member_count
        FROM shared_albums sa
        LEFT JOIN album_members am ON sa.id = am.album_id AND am.member_did = ?
        WHERE (
          sa.owner_did = ?
          OR am.member_did = ?
          OR sa.visibility = 'public'
        )
      `;

      const params = [currentDid, currentDid, currentDid];

      if (visibility) {
        query += " AND sa.visibility = ?";
        params.push(visibility);
      }

      query += " ORDER BY sa.updated_at DESC LIMIT ? OFFSET ?";
      params.push(limit, offset);

      const albums = db.prepare(query).all(...params);

      return albums;
    } catch (error) {
      logger.error("[SharedAlbumManager] Failed to get albums:", error);
      throw error;
    }
  }

  /**
   * Get a single album by ID
   * @param {string} albumId - Album ID
   * @returns {Object|null} Album or null
   */
  async getAlbumById(albumId) {
    try {
      const currentDid = this.didManager?.getCurrentIdentity()?.did;

      const db = this.database.db;
      const album = db
        .prepare(
          `
        SELECT sa.*,
          (SELECT COUNT(*) FROM album_photos WHERE album_id = sa.id) as photo_count,
          (SELECT COUNT(*) FROM album_members WHERE album_id = sa.id) as member_count
        FROM shared_albums sa
        WHERE sa.id = ?
      `,
        )
        .get(albumId);

      if (!album) {
        return null;
      }

      // Check access permissions
      if (album.visibility === AlbumVisibility.PRIVATE) {
        if (!currentDid) {
          return null;
        }
        const member = db
          .prepare(
            "SELECT * FROM album_members WHERE album_id = ? AND member_did = ?",
          )
          .get(albumId, currentDid);
        if (!member) {
          return null;
        }
      }

      if (album.visibility === AlbumVisibility.FRIENDS && currentDid) {
        const isFriend = await this.friendManager?.isFriend(album.owner_did);
        const member = db
          .prepare(
            "SELECT * FROM album_members WHERE album_id = ? AND member_did = ?",
          )
          .get(albumId, currentDid);
        if (!isFriend && !member && album.owner_did !== currentDid) {
          return null;
        }
      }

      return album;
    } catch (error) {
      logger.error("[SharedAlbumManager] Failed to get album:", error);
      throw error;
    }
  }

  /**
   * Add a photo to an album
   * @param {Object} options - Photo options
   * @param {string} options.albumId - Album ID
   * @param {string} options.filePath - Photo file path
   * @param {string} options.thumbnailPath - Thumbnail path
   * @param {string} options.caption - Photo caption
   * @param {number} options.fileSize - File size in bytes
   * @param {string} options.mimeType - MIME type
   * @param {number} options.width - Image width
   * @param {number} options.height - Image height
   * @param {boolean} options.isEncrypted - Whether the photo is encrypted
   * @returns {Object} Created photo record
   */
  async addPhoto({
    albumId,
    filePath,
    thumbnailPath = null,
    caption = "",
    fileSize = 0,
    mimeType = "image/jpeg",
    width = 0,
    height = 0,
    isEncrypted = true,
  }) {
    try {
      const currentDid = this.didManager?.getCurrentIdentity()?.did;

      if (!currentDid) {
        throw new Error("Not logged in");
      }

      const db = this.database.db;

      // Check album exists
      const album = db
        .prepare("SELECT * FROM shared_albums WHERE id = ?")
        .get(albumId);

      if (!album) {
        throw new Error("Album not found");
      }

      // Check permissions (owner or editor)
      const member = db
        .prepare(
          "SELECT * FROM album_members WHERE album_id = ? AND member_did = ?",
        )
        .get(albumId, currentDid);

      if (
        !member ||
        (member.role !== AlbumMemberRole.OWNER &&
          member.role !== AlbumMemberRole.EDITOR)
      ) {
        throw new Error("No permission to add photos to this album");
      }

      const photoId = uuidv4();
      const now = Date.now();

      db.prepare(
        `
        INSERT INTO album_photos
        (id, album_id, uploader_did, file_path, thumbnail_path, caption,
         file_size, mime_type, width, height, is_encrypted, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      ).run(
        photoId,
        albumId,
        currentDid,
        filePath,
        thumbnailPath,
        caption || null,
        fileSize,
        mimeType,
        width,
        height,
        isEncrypted ? 1 : 0,
        now,
      );

      // Update album's updated_at timestamp
      db.prepare("UPDATE shared_albums SET updated_at = ? WHERE id = ?").run(
        now,
        albumId,
      );

      // Set cover to first photo if no cover exists
      if (!album.cover_url && thumbnailPath) {
        db.prepare(
          "UPDATE shared_albums SET cover_url = ? WHERE id = ? AND cover_url IS NULL",
        ).run(thumbnailPath, albumId);
      }

      const photo = {
        id: photoId,
        album_id: albumId,
        uploader_did: currentDid,
        file_path: filePath,
        thumbnail_path: thumbnailPath,
        caption: caption || null,
        file_size: fileSize,
        mime_type: mimeType,
        width,
        height,
        is_encrypted: isEncrypted ? 1 : 0,
        created_at: now,
      };

      logger.info("[SharedAlbumManager] Photo added:", photoId);

      this.emit("photo:added", { photo, albumId });

      return photo;
    } catch (error) {
      logger.error("[SharedAlbumManager] Failed to add photo:", error);
      throw error;
    }
  }

  /**
   * Remove a photo from an album
   * @param {string} photoId - Photo ID
   */
  async removePhoto(photoId) {
    try {
      const currentDid = this.didManager?.getCurrentIdentity()?.did;

      if (!currentDid) {
        throw new Error("Not logged in");
      }

      const db = this.database.db;
      const photo = db
        .prepare("SELECT * FROM album_photos WHERE id = ?")
        .get(photoId);

      if (!photo) {
        throw new Error("Photo not found");
      }

      // Check permissions (uploader, editor, or owner)
      const member = db
        .prepare(
          "SELECT * FROM album_members WHERE album_id = ? AND member_did = ?",
        )
        .get(photo.album_id, currentDid);

      if (photo.uploader_did !== currentDid) {
        if (
          !member ||
          (member.role !== AlbumMemberRole.OWNER &&
            member.role !== AlbumMemberRole.EDITOR)
        ) {
          throw new Error("No permission to remove this photo");
        }
      }

      db.prepare("DELETE FROM album_photos WHERE id = ?").run(photoId);

      // Update album timestamp
      const now = Date.now();
      db.prepare("UPDATE shared_albums SET updated_at = ? WHERE id = ?").run(
        now,
        photo.album_id,
      );

      logger.info("[SharedAlbumManager] Photo removed:", photoId);

      this.emit("photo:removed", { photoId, albumId: photo.album_id });

      return { success: true };
    } catch (error) {
      logger.error("[SharedAlbumManager] Failed to remove photo:", error);
      throw error;
    }
  }

  /**
   * Get photos in an album
   * @param {string} albumId - Album ID
   * @param {Object} options - Query options
   * @param {number} options.limit - Limit
   * @param {number} options.offset - Offset
   * @returns {Array} Photos list
   */
  async getPhotos(albumId, { limit = 50, offset = 0 } = {}) {
    try {
      const db = this.database.db;

      // Verify album exists
      const album = db
        .prepare("SELECT * FROM shared_albums WHERE id = ?")
        .get(albumId);

      if (!album) {
        throw new Error("Album not found");
      }

      const photos = db
        .prepare(
          `
        SELECT * FROM album_photos
        WHERE album_id = ?
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
      `,
        )
        .all(albumId, limit, offset);

      return photos;
    } catch (error) {
      logger.error("[SharedAlbumManager] Failed to get photos:", error);
      throw error;
    }
  }

  /**
   * Add a member to an album
   * @param {string} albumId - Album ID
   * @param {string} memberDid - Member DID
   * @param {string} role - Member role
   */
  async addMember(albumId, memberDid, role = AlbumMemberRole.VIEWER) {
    try {
      const currentDid = this.didManager?.getCurrentIdentity()?.did;

      if (!currentDid) {
        throw new Error("Not logged in");
      }

      const db = this.database.db;
      const album = db
        .prepare("SELECT * FROM shared_albums WHERE id = ?")
        .get(albumId);

      if (!album) {
        throw new Error("Album not found");
      }

      // Only owner can add members
      if (album.owner_did !== currentDid) {
        // Editors can also add viewers
        const myRole = db
          .prepare(
            "SELECT role FROM album_members WHERE album_id = ? AND member_did = ?",
          )
          .get(albumId, currentDid);

        if (
          !myRole ||
          myRole.role !== AlbumMemberRole.EDITOR ||
          role !== AlbumMemberRole.VIEWER
        ) {
          throw new Error("No permission to add members");
        }
      }

      // Check if already a member
      const existing = db
        .prepare(
          "SELECT * FROM album_members WHERE album_id = ? AND member_did = ?",
        )
        .get(albumId, memberDid);

      if (existing) {
        // Update role if already a member
        db.prepare(
          "UPDATE album_members SET role = ? WHERE album_id = ? AND member_did = ?",
        ).run(role, albumId, memberDid);

        logger.info(
          "[SharedAlbumManager] Member role updated:",
          memberDid,
          "->",
          role,
        );
      } else {
        const memberId = uuidv4();
        const now = Date.now();

        db.prepare(
          `
          INSERT INTO album_members (id, album_id, member_did, role, joined_at)
          VALUES (?, ?, ?, ?, ?)
        `,
        ).run(memberId, albumId, memberDid, role, now);

        logger.info("[SharedAlbumManager] Member added:", memberDid);
      }

      // Update album timestamp
      const now = Date.now();
      db.prepare("UPDATE shared_albums SET updated_at = ? WHERE id = ?").run(
        now,
        albumId,
      );

      this.emit("member:added", { albumId, memberDid, role });

      // Notify the new member via P2P
      if (this.p2pManager && memberDid !== currentDid) {
        try {
          await this.p2pManager.sendEncryptedMessage(
            memberDid,
            JSON.stringify({
              type: "album-member-added",
              albumId,
              albumName: album.name,
              role,
              inviterDid: currentDid,
              timestamp: now,
            }),
          );
        } catch (error) {
          logger.warn(
            "[SharedAlbumManager] Failed to notify member:",
            error.message,
          );
        }
      }

      return { success: true };
    } catch (error) {
      logger.error("[SharedAlbumManager] Failed to add member:", error);
      throw error;
    }
  }

  /**
   * Remove a member from an album
   * @param {string} albumId - Album ID
   * @param {string} memberDid - Member DID
   */
  async removeMember(albumId, memberDid) {
    try {
      const currentDid = this.didManager?.getCurrentIdentity()?.did;

      if (!currentDid) {
        throw new Error("Not logged in");
      }

      const db = this.database.db;
      const album = db
        .prepare("SELECT * FROM shared_albums WHERE id = ?")
        .get(albumId);

      if (!album) {
        throw new Error("Album not found");
      }

      // Cannot remove the owner
      if (memberDid === album.owner_did) {
        throw new Error("Cannot remove the album owner");
      }

      // Only owner can remove members (or member can remove themselves)
      if (album.owner_did !== currentDid && memberDid !== currentDid) {
        throw new Error("No permission to remove members");
      }

      const result = db
        .prepare(
          "DELETE FROM album_members WHERE album_id = ? AND member_did = ?",
        )
        .run(albumId, memberDid);

      if (result.changes === 0) {
        throw new Error("Member not found in this album");
      }

      logger.info("[SharedAlbumManager] Member removed:", memberDid);

      this.emit("member:removed", { albumId, memberDid });

      return { success: true };
    } catch (error) {
      logger.error("[SharedAlbumManager] Failed to remove member:", error);
      throw error;
    }
  }

  /**
   * Get members of an album
   * @param {string} albumId - Album ID
   * @returns {Array} Members list
   */
  async getMembers(albumId) {
    try {
      const db = this.database.db;

      const members = db
        .prepare(
          `
        SELECT * FROM album_members
        WHERE album_id = ?
        ORDER BY
          CASE role
            WHEN 'owner' THEN 0
            WHEN 'editor' THEN 1
            WHEN 'viewer' THEN 2
          END,
          joined_at ASC
      `,
        )
        .all(albumId);

      return members;
    } catch (error) {
      logger.error("[SharedAlbumManager] Failed to get members:", error);
      throw error;
    }
  }

  /**
   * Share an album via P2P
   * @param {string} albumId - Album ID
   * @param {Array<string>} targetDids - Target DIDs to share with
   */
  async shareAlbum(albumId, targetDids = []) {
    try {
      const currentDid = this.didManager?.getCurrentIdentity()?.did;

      if (!currentDid) {
        throw new Error("Not logged in");
      }

      const db = this.database.db;
      const album = db
        .prepare("SELECT * FROM shared_albums WHERE id = ?")
        .get(albumId);

      if (!album) {
        throw new Error("Album not found");
      }

      // Verify current user has share permissions
      const member = db
        .prepare(
          "SELECT * FROM album_members WHERE album_id = ? AND member_did = ?",
        )
        .get(albumId, currentDid);

      if (
        !member ||
        (member.role !== AlbumMemberRole.OWNER &&
          member.role !== AlbumMemberRole.EDITOR)
      ) {
        throw new Error("No permission to share this album");
      }

      // Determine share targets
      let targets = targetDids;

      if (targets.length === 0) {
        // Share based on visibility
        if (album.visibility === AlbumVisibility.PRIVATE) {
          // Only share with existing members
          const members = await this.getMembers(albumId);
          targets = members
            .map((m) => m.member_did)
            .filter((did) => did !== currentDid);
        } else if (album.visibility === AlbumVisibility.FRIENDS) {
          const friends = await this.friendManager?.getFriends();
          targets = friends ? friends.map((f) => f.friend_did) : [];
        } else if (album.visibility === AlbumVisibility.PUBLIC) {
          const connectedPeers = this.p2pManager?.getConnectedPeers() || [];
          targets = connectedPeers.map((peer) => peer.id);
        }
      }

      if (!this.p2pManager) {
        logger.warn("[SharedAlbumManager] P2P manager not available");
        return { success: true, sharedTo: 0 };
      }

      let sharedCount = 0;

      for (const targetDid of targets) {
        try {
          await this.p2pManager.sendEncryptedMessage(
            targetDid,
            JSON.stringify({
              type: "album-share",
              album: {
                id: album.id,
                name: album.name,
                description: album.description,
                cover_url: album.cover_url,
                owner_did: album.owner_did,
                visibility: album.visibility,
              },
              senderDid: currentDid,
              timestamp: Date.now(),
            }),
          );
          sharedCount++;
        } catch (error) {
          logger.warn(
            "[SharedAlbumManager] Failed to share with:",
            targetDid,
            error.message,
          );
        }
      }

      logger.info(
        "[SharedAlbumManager] Album shared to",
        sharedCount,
        "peers",
      );

      this.emit("album:shared", { albumId, sharedTo: sharedCount });

      return { success: true, sharedTo: sharedCount };
    } catch (error) {
      logger.error("[SharedAlbumManager] Failed to share album:", error);
      throw error;
    }
  }

  /**
   * Handle received album share
   * @param {Object} album - Album data
   * @param {string} senderDid - Sender DID
   */
  async handleAlbumShareReceived(album, senderDid) {
    try {
      const db = this.database.db;
      const currentDid = this.didManager?.getCurrentIdentity()?.did;

      if (!currentDid) {
        return;
      }

      // Check if album already exists locally
      const existing = db
        .prepare("SELECT id FROM shared_albums WHERE id = ?")
        .get(album.id);

      if (existing) {
        logger.info(
          "[SharedAlbumManager] Album already exists, skipping:",
          album.id,
        );
        return;
      }

      const now = Date.now();

      // Save album locally
      db.prepare(
        `
        INSERT OR IGNORE INTO shared_albums
        (id, name, description, cover_url, owner_did, visibility, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      ).run(
        album.id,
        album.name,
        album.description || null,
        album.cover_url || null,
        album.owner_did,
        album.visibility || AlbumVisibility.FRIENDS,
        now,
        now,
      );

      // Add current user as viewer
      db.prepare(
        `
        INSERT OR IGNORE INTO album_members (id, album_id, member_did, role, joined_at)
        VALUES (?, ?, ?, ?, ?)
      `,
      ).run(uuidv4(), album.id, currentDid, AlbumMemberRole.VIEWER, now);

      logger.info(
        "[SharedAlbumManager] Received shared album:",
        album.id,
        "from",
        senderDid,
      );

      this.emit("album:received", { album, senderDid });
    } catch (error) {
      logger.error(
        "[SharedAlbumManager] Failed to handle album share:",
        error,
      );
    }
  }

  /**
   * Handle received photo
   * @param {Object} photo - Photo data
   * @param {string} albumId - Album ID
   * @param {string} senderDid - Sender DID
   */
  async handlePhotoReceived(photo, albumId, senderDid) {
    try {
      const db = this.database.db;

      // Check if photo already exists
      const existing = db
        .prepare("SELECT id FROM album_photos WHERE id = ?")
        .get(photo.id);

      if (existing) {
        return;
      }

      const now = Date.now();

      db.prepare(
        `
        INSERT OR IGNORE INTO album_photos
        (id, album_id, uploader_did, file_path, thumbnail_path, caption,
         file_size, mime_type, width, height, is_encrypted, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      ).run(
        photo.id,
        albumId,
        photo.uploader_did || senderDid,
        photo.file_path || null,
        photo.thumbnail_path || null,
        photo.caption || null,
        photo.file_size || 0,
        photo.mime_type || "image/jpeg",
        photo.width || 0,
        photo.height || 0,
        photo.is_encrypted !== undefined ? photo.is_encrypted : 1,
        photo.created_at || now,
      );

      logger.info(
        "[SharedAlbumManager] Received photo:",
        photo.id,
        "for album:",
        albumId,
      );

      this.emit("photo:received", { photo, albumId, senderDid });
    } catch (error) {
      logger.error("[SharedAlbumManager] Failed to handle photo:", error);
    }
  }

  /**
   * Close shared album manager
   */
  async close() {
    logger.info("[SharedAlbumManager] Closing shared album manager");

    this.removeAllListeners();
    this.initialized = false;
  }
}

module.exports = {
  SharedAlbumManager,
  AlbumVisibility,
  AlbumMemberRole,
};
