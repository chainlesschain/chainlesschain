/**
 * Community Manager
 * Manages community CRUD operations, membership, and role management.
 * Supports decentralized communities with DID-based identity.
 *
 * @module community-manager
 * @version 0.42.0
 */

const { logger } = require("../utils/logger.js");
const EventEmitter = require("events");
const { v4: uuidv4 } = require("uuid");

/**
 * Community status constants
 */
const CommunityStatus = {
  ACTIVE: "active",
  ARCHIVED: "archived",
  BANNED: "banned",
};

/**
 * Member role constants
 */
const MemberRole = {
  OWNER: "owner",
  ADMIN: "admin",
  MODERATOR: "moderator",
  MEMBER: "member",
};

/**
 * Member status constants
 */
const MemberStatus = {
  ACTIVE: "active",
  BANNED: "banned",
  LEFT: "left",
};

class CommunityManager extends EventEmitter {
  constructor(database, didManager, p2pManager) {
    super();

    this.database = database;
    this.didManager = didManager;
    this.p2pManager = p2pManager;

    this.initialized = false;
  }

  /**
   * Initialize the community manager
   */
  async initialize() {
    logger.info("[CommunityManager] Initializing community manager...");

    try {
      await this.initializeTables();
      this.setupP2PListeners();

      this.initialized = true;
      logger.info("[CommunityManager] Community manager initialized successfully");
    } catch (error) {
      logger.error("[CommunityManager] Initialization failed:", error);
      throw error;
    }
  }

  /**
   * Initialize database tables
   */
  async initializeTables() {
    const db = this.database.db;

    db.exec(`
      CREATE TABLE IF NOT EXISTS communities (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        icon_url TEXT,
        rules_md TEXT,
        creator_did TEXT NOT NULL,
        member_limit INTEGER DEFAULT 1000,
        member_count INTEGER DEFAULT 0,
        status TEXT DEFAULT 'active' CHECK(status IN ('active', 'archived', 'banned')),
        created_at INTEGER,
        updated_at INTEGER
      )
    `);

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_communities_creator ON communities(creator_did);
      CREATE INDEX IF NOT EXISTS idx_communities_status ON communities(status);
      CREATE INDEX IF NOT EXISTS idx_communities_name ON communities(name);
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS community_members (
        id TEXT PRIMARY KEY,
        community_id TEXT NOT NULL,
        member_did TEXT NOT NULL,
        role TEXT DEFAULT 'member' CHECK(role IN ('owner', 'admin', 'moderator', 'member')),
        nickname TEXT,
        status TEXT DEFAULT 'active' CHECK(status IN ('active', 'banned', 'left')),
        joined_at INTEGER,
        updated_at INTEGER,
        UNIQUE(community_id, member_did)
      )
    `);

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_community_members_community ON community_members(community_id);
      CREATE INDEX IF NOT EXISTS idx_community_members_did ON community_members(member_did);
    `);

    logger.info("[CommunityManager] Database tables initialized");
  }

  /**
   * Setup P2P event listeners for community sync
   */
  setupP2PListeners() {
    if (!this.p2pManager) {
      return;
    }

    this.p2pManager.on("community:join-request", async ({ communityId, memberDid }) => {
      try {
        await this.joinCommunity(communityId, memberDid);
      } catch (error) {
        logger.warn("[CommunityManager] P2P join request failed:", error.message);
      }
    });

    this.p2pManager.on("community:sync", async ({ community }) => {
      try {
        await this.handleCommunitySync(community);
      } catch (error) {
        logger.warn("[CommunityManager] P2P community sync failed:", error.message);
      }
    });

    logger.info("[CommunityManager] P2P listeners set up");
  }

  /**
   * Get the current user DID
   */
  getCurrentDid() {
    return this.didManager?.getCurrentIdentity()?.did || null;
  }

  /**
   * Create a new community
   * @param {Object} options - Community options
   * @param {string} options.name - Community name
   * @param {string} options.description - Community description
   * @param {string} options.iconUrl - Community icon URL
   * @param {string} options.rulesMd - Community rules in Markdown
   * @param {number} options.memberLimit - Maximum number of members
   */
  async createCommunity({ name, description = "", iconUrl = "", rulesMd = "", memberLimit = 1000 }) {
    const currentDid = this.getCurrentDid();
    if (!currentDid) {
      throw new Error("User not logged in");
    }

    if (!name || name.trim().length === 0) {
      throw new Error("Community name cannot be empty");
    }

    if (name.trim().length > 100) {
      throw new Error("Community name cannot exceed 100 characters");
    }

    try {
      const communityId = uuidv4();
      const now = Date.now();

      const db = this.database.db;

      // Insert community record
      const insertStmt = db.prepare(`
        INSERT INTO communities (
          id, name, description, icon_url, rules_md, creator_did,
          member_limit, member_count, status, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      insertStmt.run(
        communityId,
        name.trim(),
        description,
        iconUrl,
        rulesMd,
        currentDid,
        memberLimit,
        1, // Creator counts as first member
        CommunityStatus.ACTIVE,
        now,
        now,
      );

      // Add creator as owner
      const memberStmt = db.prepare(`
        INSERT INTO community_members (
          id, community_id, member_did, role, nickname, status, joined_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      memberStmt.run(
        uuidv4(),
        communityId,
        currentDid,
        MemberRole.OWNER,
        null,
        MemberStatus.ACTIVE,
        now,
        now,
      );

      this.database.saveToFile();

      const community = {
        id: communityId,
        name: name.trim(),
        description,
        icon_url: iconUrl,
        rules_md: rulesMd,
        creator_did: currentDid,
        member_limit: memberLimit,
        member_count: 1,
        status: CommunityStatus.ACTIVE,
        created_at: now,
        updated_at: now,
      };

      logger.info("[CommunityManager] Community created:", communityId);
      this.emit("community:created", { community });

      return community;
    } catch (error) {
      logger.error("[CommunityManager] Failed to create community:", error);
      throw error;
    }
  }

  /**
   * Delete a community (owner only)
   * @param {string} communityId - Community ID
   */
  async deleteCommunity(communityId) {
    const currentDid = this.getCurrentDid();
    if (!currentDid) {
      throw new Error("User not logged in");
    }

    try {
      const db = this.database.db;

      // Check ownership
      const community = db.prepare("SELECT * FROM communities WHERE id = ?").get(communityId);
      if (!community) {
        throw new Error("Community not found");
      }

      if (community.creator_did !== currentDid) {
        throw new Error("Only the community creator can delete it");
      }

      // Delete members first
      db.prepare("DELETE FROM community_members WHERE community_id = ?").run(communityId);

      // Delete community
      db.prepare("DELETE FROM communities WHERE id = ?").run(communityId);

      this.database.saveToFile();

      logger.info("[CommunityManager] Community deleted:", communityId);
      this.emit("community:deleted", { communityId });

      return { success: true };
    } catch (error) {
      logger.error("[CommunityManager] Failed to delete community:", error);
      throw error;
    }
  }

  /**
   * Update community information
   * @param {string} communityId - Community ID
   * @param {Object} updates - Fields to update
   */
  async updateCommunity(communityId, updates) {
    const currentDid = this.getCurrentDid();
    if (!currentDid) {
      throw new Error("User not logged in");
    }

    try {
      const db = this.database.db;

      // Check admin/owner role
      const member = db.prepare(
        "SELECT * FROM community_members WHERE community_id = ? AND member_did = ? AND status = 'active'",
      ).get(communityId, currentDid);

      if (!member || (member.role !== MemberRole.OWNER && member.role !== MemberRole.ADMIN)) {
        throw new Error("Insufficient permissions to update community");
      }

      const { name, description, iconUrl, rulesMd, memberLimit, status } = updates;
      const fields = [];
      const values = [];

      if (name !== undefined) {
        fields.push("name = ?");
        values.push(name.trim());
      }
      if (description !== undefined) {
        fields.push("description = ?");
        values.push(description);
      }
      if (iconUrl !== undefined) {
        fields.push("icon_url = ?");
        values.push(iconUrl);
      }
      if (rulesMd !== undefined) {
        fields.push("rules_md = ?");
        values.push(rulesMd);
      }
      if (memberLimit !== undefined) {
        fields.push("member_limit = ?");
        values.push(memberLimit);
      }
      if (status !== undefined && member.role === MemberRole.OWNER) {
        fields.push("status = ?");
        values.push(status);
      }

      if (fields.length === 0) {
        return { success: true };
      }

      fields.push("updated_at = ?");
      values.push(Date.now());
      values.push(communityId);

      db.prepare(`UPDATE communities SET ${fields.join(", ")} WHERE id = ?`).run(...values);

      this.database.saveToFile();

      logger.info("[CommunityManager] Community updated:", communityId);
      this.emit("community:updated", { communityId, updates });

      return { success: true };
    } catch (error) {
      logger.error("[CommunityManager] Failed to update community:", error);
      throw error;
    }
  }

  /**
   * Get a list of communities (those the current user is a member of)
   * @param {Object} options - Query options
   * @param {number} options.limit - Limit
   * @param {number} options.offset - Offset
   */
  async getCommunities({ limit = 50, offset = 0 } = {}) {
    const currentDid = this.getCurrentDid();
    if (!currentDid) {
      return [];
    }

    try {
      const db = this.database.db;

      const stmt = db.prepare(`
        SELECT c.*, cm.role as my_role
        FROM communities c
        INNER JOIN community_members cm ON c.id = cm.community_id
        WHERE cm.member_did = ? AND cm.status = 'active' AND c.status = 'active'
        ORDER BY c.updated_at DESC
        LIMIT ? OFFSET ?
      `);

      const communities = stmt.all(currentDid, limit, offset);
      return communities || [];
    } catch (error) {
      logger.error("[CommunityManager] Failed to get communities:", error);
      return [];
    }
  }

  /**
   * Get a community by ID
   * @param {string} communityId - Community ID
   */
  async getCommunityById(communityId) {
    try {
      const db = this.database.db;
      const community = db.prepare("SELECT * FROM communities WHERE id = ?").get(communityId);

      if (!community) {
        return null;
      }

      // Get current user's role in this community
      const currentDid = this.getCurrentDid();
      if (currentDid) {
        const member = db.prepare(
          "SELECT role FROM community_members WHERE community_id = ? AND member_did = ? AND status = 'active'",
        ).get(communityId, currentDid);
        community.my_role = member ? member.role : null;
      }

      return community;
    } catch (error) {
      logger.error("[CommunityManager] Failed to get community:", error);
      return null;
    }
  }

  /**
   * Join a community
   * @param {string} communityId - Community ID
   * @param {string} memberDid - Member DID (optional, defaults to current user)
   */
  async joinCommunity(communityId, memberDid) {
    const did = memberDid || this.getCurrentDid();
    if (!did) {
      throw new Error("User not logged in");
    }

    try {
      const db = this.database.db;

      const community = db.prepare("SELECT * FROM communities WHERE id = ?").get(communityId);
      if (!community) {
        throw new Error("Community not found");
      }

      if (community.status !== CommunityStatus.ACTIVE) {
        throw new Error("Community is not active");
      }

      if (community.member_count >= community.member_limit) {
        throw new Error("Community has reached its member limit");
      }

      // Check if already a member
      const existing = db.prepare(
        "SELECT * FROM community_members WHERE community_id = ? AND member_did = ?",
      ).get(communityId, did);

      if (existing) {
        if (existing.status === MemberStatus.ACTIVE) {
          throw new Error("Already a member of this community");
        }
        if (existing.status === MemberStatus.BANNED) {
          throw new Error("You are banned from this community");
        }
        // Re-join if previously left
        const now = Date.now();
        db.prepare(
          "UPDATE community_members SET status = ?, role = ?, joined_at = ?, updated_at = ? WHERE id = ?",
        ).run(MemberStatus.ACTIVE, MemberRole.MEMBER, now, now, existing.id);
      } else {
        const now = Date.now();
        db.prepare(`
          INSERT INTO community_members (
            id, community_id, member_did, role, nickname, status, joined_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          uuidv4(),
          communityId,
          did,
          MemberRole.MEMBER,
          null,
          MemberStatus.ACTIVE,
          now,
          now,
        );
      }

      // Update member count
      db.prepare(
        "UPDATE communities SET member_count = member_count + 1, updated_at = ? WHERE id = ?",
      ).run(Date.now(), communityId);

      this.database.saveToFile();

      logger.info("[CommunityManager] Member joined community:", did, communityId);
      this.emit("community:member-joined", { communityId, memberDid: did });

      return { success: true };
    } catch (error) {
      logger.error("[CommunityManager] Failed to join community:", error);
      throw error;
    }
  }

  /**
   * Leave a community
   * @param {string} communityId - Community ID
   */
  async leaveCommunity(communityId) {
    const currentDid = this.getCurrentDid();
    if (!currentDid) {
      throw new Error("User not logged in");
    }

    try {
      const db = this.database.db;

      const member = db.prepare(
        "SELECT * FROM community_members WHERE community_id = ? AND member_did = ? AND status = 'active'",
      ).get(communityId, currentDid);

      if (!member) {
        throw new Error("You are not a member of this community");
      }

      if (member.role === MemberRole.OWNER) {
        throw new Error("Owner cannot leave the community. Transfer ownership or delete the community.");
      }

      const now = Date.now();
      db.prepare(
        "UPDATE community_members SET status = ?, updated_at = ? WHERE id = ?",
      ).run(MemberStatus.LEFT, now, member.id);

      db.prepare(
        "UPDATE communities SET member_count = MAX(member_count - 1, 0), updated_at = ? WHERE id = ?",
      ).run(now, communityId);

      this.database.saveToFile();

      logger.info("[CommunityManager] Member left community:", currentDid, communityId);
      this.emit("community:member-left", { communityId, memberDid: currentDid });

      return { success: true };
    } catch (error) {
      logger.error("[CommunityManager] Failed to leave community:", error);
      throw error;
    }
  }

  /**
   * Get members of a community
   * @param {string} communityId - Community ID
   * @param {Object} options - Query options
   */
  async getMembers(communityId, { limit = 100, offset = 0 } = {}) {
    try {
      const db = this.database.db;

      const stmt = db.prepare(`
        SELECT cm.*, c.nickname as contact_nickname
        FROM community_members cm
        LEFT JOIN contacts c ON cm.member_did = c.did
        WHERE cm.community_id = ? AND cm.status = 'active'
        ORDER BY
          CASE cm.role
            WHEN 'owner' THEN 0
            WHEN 'admin' THEN 1
            WHEN 'moderator' THEN 2
            WHEN 'member' THEN 3
          END ASC,
          cm.joined_at ASC
        LIMIT ? OFFSET ?
      `);

      const members = stmt.all(communityId, limit, offset);
      return members || [];
    } catch (error) {
      logger.error("[CommunityManager] Failed to get members:", error);
      return [];
    }
  }

  /**
   * Promote a member to a higher role
   * @param {string} communityId - Community ID
   * @param {string} memberDid - Member to promote
   * @param {string} newRole - New role
   */
  async promoteMember(communityId, memberDid, newRole) {
    const currentDid = this.getCurrentDid();
    if (!currentDid) {
      throw new Error("User not logged in");
    }

    try {
      const db = this.database.db;

      // Check requester permissions
      const requester = db.prepare(
        "SELECT * FROM community_members WHERE community_id = ? AND member_did = ? AND status = 'active'",
      ).get(communityId, currentDid);

      if (!requester || (requester.role !== MemberRole.OWNER && requester.role !== MemberRole.ADMIN)) {
        throw new Error("Insufficient permissions to promote members");
      }

      // Only owner can promote to admin
      if (newRole === MemberRole.ADMIN && requester.role !== MemberRole.OWNER) {
        throw new Error("Only the owner can promote to admin");
      }

      const target = db.prepare(
        "SELECT * FROM community_members WHERE community_id = ? AND member_did = ? AND status = 'active'",
      ).get(communityId, memberDid);

      if (!target) {
        throw new Error("Target member not found");
      }

      const validRoles = [MemberRole.ADMIN, MemberRole.MODERATOR];
      if (!validRoles.includes(newRole)) {
        throw new Error("Invalid role for promotion");
      }

      const now = Date.now();
      db.prepare(
        "UPDATE community_members SET role = ?, updated_at = ? WHERE id = ?",
      ).run(newRole, now, target.id);

      this.database.saveToFile();

      logger.info("[CommunityManager] Member promoted:", memberDid, "to", newRole);
      this.emit("community:member-promoted", { communityId, memberDid, newRole });

      return { success: true };
    } catch (error) {
      logger.error("[CommunityManager] Failed to promote member:", error);
      throw error;
    }
  }

  /**
   * Demote a member to a lower role
   * @param {string} communityId - Community ID
   * @param {string} memberDid - Member to demote
   */
  async demoteMember(communityId, memberDid) {
    const currentDid = this.getCurrentDid();
    if (!currentDid) {
      throw new Error("User not logged in");
    }

    try {
      const db = this.database.db;

      const requester = db.prepare(
        "SELECT * FROM community_members WHERE community_id = ? AND member_did = ? AND status = 'active'",
      ).get(communityId, currentDid);

      if (!requester || requester.role !== MemberRole.OWNER) {
        throw new Error("Only the owner can demote members");
      }

      const target = db.prepare(
        "SELECT * FROM community_members WHERE community_id = ? AND member_did = ? AND status = 'active'",
      ).get(communityId, memberDid);

      if (!target) {
        throw new Error("Target member not found");
      }

      if (target.role === MemberRole.OWNER) {
        throw new Error("Cannot demote the owner");
      }

      const now = Date.now();
      db.prepare(
        "UPDATE community_members SET role = ?, updated_at = ? WHERE id = ?",
      ).run(MemberRole.MEMBER, now, target.id);

      this.database.saveToFile();

      logger.info("[CommunityManager] Member demoted:", memberDid, "to member");
      this.emit("community:member-demoted", { communityId, memberDid });

      return { success: true };
    } catch (error) {
      logger.error("[CommunityManager] Failed to demote member:", error);
      throw error;
    }
  }

  /**
   * Ban a member from the community
   * @param {string} communityId - Community ID
   * @param {string} memberDid - Member to ban
   */
  async banMember(communityId, memberDid) {
    const currentDid = this.getCurrentDid();
    if (!currentDid) {
      throw new Error("User not logged in");
    }

    try {
      const db = this.database.db;

      const requester = db.prepare(
        "SELECT * FROM community_members WHERE community_id = ? AND member_did = ? AND status = 'active'",
      ).get(communityId, currentDid);

      if (!requester ||
        (requester.role !== MemberRole.OWNER &&
          requester.role !== MemberRole.ADMIN &&
          requester.role !== MemberRole.MODERATOR)) {
        throw new Error("Insufficient permissions to ban members");
      }

      const target = db.prepare(
        "SELECT * FROM community_members WHERE community_id = ? AND member_did = ? AND status = 'active'",
      ).get(communityId, memberDid);

      if (!target) {
        throw new Error("Target member not found");
      }

      // Cannot ban owner or members of equal/higher role
      const rolePriority = { owner: 0, admin: 1, moderator: 2, member: 3 };
      if (rolePriority[target.role] <= rolePriority[requester.role]) {
        throw new Error("Cannot ban a member with equal or higher role");
      }

      const now = Date.now();
      db.prepare(
        "UPDATE community_members SET status = ?, updated_at = ? WHERE id = ?",
      ).run(MemberStatus.BANNED, now, target.id);

      db.prepare(
        "UPDATE communities SET member_count = MAX(member_count - 1, 0), updated_at = ? WHERE id = ?",
      ).run(now, communityId);

      this.database.saveToFile();

      logger.info("[CommunityManager] Member banned:", memberDid, "from", communityId);
      this.emit("community:member-banned", { communityId, memberDid });

      return { success: true };
    } catch (error) {
      logger.error("[CommunityManager] Failed to ban member:", error);
      throw error;
    }
  }

  /**
   * Unban a member from the community
   * @param {string} communityId - Community ID
   * @param {string} memberDid - Member to unban
   */
  async unbanMember(communityId, memberDid) {
    const currentDid = this.getCurrentDid();
    if (!currentDid) {
      throw new Error("User not logged in");
    }

    try {
      const db = this.database.db;

      const requester = db.prepare(
        "SELECT * FROM community_members WHERE community_id = ? AND member_did = ? AND status = 'active'",
      ).get(communityId, currentDid);

      if (!requester ||
        (requester.role !== MemberRole.OWNER &&
          requester.role !== MemberRole.ADMIN &&
          requester.role !== MemberRole.MODERATOR)) {
        throw new Error("Insufficient permissions to unban members");
      }

      const target = db.prepare(
        "SELECT * FROM community_members WHERE community_id = ? AND member_did = ? AND status = 'banned'",
      ).get(communityId, memberDid);

      if (!target) {
        throw new Error("Banned member not found");
      }

      const now = Date.now();
      db.prepare(
        "UPDATE community_members SET status = ?, role = ?, updated_at = ? WHERE id = ?",
      ).run(MemberStatus.ACTIVE, MemberRole.MEMBER, now, target.id);

      db.prepare(
        "UPDATE communities SET member_count = member_count + 1, updated_at = ? WHERE id = ?",
      ).run(now, communityId);

      this.database.saveToFile();

      logger.info("[CommunityManager] Member unbanned:", memberDid, "from", communityId);
      this.emit("community:member-unbanned", { communityId, memberDid });

      return { success: true };
    } catch (error) {
      logger.error("[CommunityManager] Failed to unban member:", error);
      throw error;
    }
  }

  /**
   * Search communities by name or description
   * @param {string} query - Search query
   * @param {Object} options - Query options
   */
  async searchCommunities(query, { limit = 20, offset = 0 } = {}) {
    try {
      const db = this.database.db;

      if (!query || query.trim().length === 0) {
        // Return all active communities if no query
        const stmt = db.prepare(`
          SELECT * FROM communities
          WHERE status = 'active'
          ORDER BY member_count DESC, created_at DESC
          LIMIT ? OFFSET ?
        `);
        return stmt.all(limit, offset) || [];
      }

      const searchPattern = `%${query.trim()}%`;

      const stmt = db.prepare(`
        SELECT * FROM communities
        WHERE status = 'active'
          AND (name LIKE ? OR description LIKE ?)
        ORDER BY member_count DESC, created_at DESC
        LIMIT ? OFFSET ?
      `);

      const results = stmt.all(searchPattern, searchPattern, limit, offset);
      return results || [];
    } catch (error) {
      logger.error("[CommunityManager] Failed to search communities:", error);
      return [];
    }
  }

  /**
   * Handle community data sync from P2P
   * @param {Object} community - Community data to sync
   */
  async handleCommunitySync(community) {
    try {
      const db = this.database.db;
      const existing = db.prepare("SELECT id FROM communities WHERE id = ?").get(community.id);

      if (existing) {
        logger.info("[CommunityManager] Community already exists, skipping sync:", community.id);
        return;
      }

      db.prepare(`
        INSERT OR IGNORE INTO communities (
          id, name, description, icon_url, rules_md, creator_did,
          member_limit, member_count, status, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        community.id,
        community.name,
        community.description || "",
        community.icon_url || "",
        community.rules_md || "",
        community.creator_did,
        community.member_limit || 1000,
        community.member_count || 0,
        community.status || CommunityStatus.ACTIVE,
        community.created_at,
        community.updated_at,
      );

      this.database.saveToFile();
      logger.info("[CommunityManager] Community synced:", community.id);
    } catch (error) {
      logger.error("[CommunityManager] Failed to sync community:", error);
    }
  }

  /**
   * Clean up resources
   */
  async close() {
    logger.info("[CommunityManager] Closing community manager");
    this.removeAllListeners();
    this.initialized = false;
  }
}

module.exports = {
  CommunityManager,
  CommunityStatus,
  MemberRole,
  MemberStatus,
};
