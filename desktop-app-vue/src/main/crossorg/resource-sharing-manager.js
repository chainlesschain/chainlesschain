/**
 * Resource Sharing Manager
 *
 * Manages cross-organization resource sharing with encryption.
 *
 * @module crossorg/resource-sharing-manager
 */

const { logger } = require('../utils/logger.js');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const EventEmitter = require('events');

class ResourceSharingManager extends EventEmitter {
  constructor(database) {
    super();
    this.database = database;
  }

  // ========================================
  // Resource Sharing
  // ========================================

  /**
   * Share a resource with another organization or workspace
   */
  async shareResource(shareData) {
    try {
      const db = this.database.getDatabase();
      const now = Date.now();
      const shareId = uuidv4();

      // Verify partnership or workspace membership
      if (shareData.targetOrgId) {
        const partnership = db.prepare(`
          SELECT id, trust_level FROM org_partnerships
          WHERE ((initiator_org_id = ? AND partner_org_id = ?)
             OR (initiator_org_id = ? AND partner_org_id = ?))
            AND status = 'active'
        `).get(
          shareData.sourceOrgId,
          shareData.targetOrgId,
          shareData.targetOrgId,
          shareData.sourceOrgId
        );

        if (!partnership) {
          return { success: false, error: 'NO_PARTNERSHIP' };
        }
      }

      // Generate encryption key if needed
      let encryptionKeyId = null;
      if (shareData.encrypt !== false) {
        encryptionKeyId = await this._createShareKey(shareId, shareData.sourceOrgId);
      }

      db.prepare(`
        INSERT INTO cross_org_shares (
          id, source_org_id, target_org_id, target_workspace_id,
          resource_type, resource_id, resource_name, share_type,
          permissions, encryption_key_id, expires_at, shared_by_did,
          status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
      `).run(
        shareId,
        shareData.sourceOrgId,
        shareData.targetOrgId,
        shareData.targetWorkspaceId,
        shareData.resourceType,
        shareData.resourceId,
        shareData.resourceName,
        shareData.shareType || 'reference',
        JSON.stringify(shareData.permissions || ['read']),
        encryptionKeyId,
        shareData.expiresAt,
        shareData.sharedByDid,
        now,
        now
      );

      // Log audit
      this._logAudit(
        shareData.sourceOrgId,
        shareData.targetOrgId,
        shareData.sharedByDid,
        'resource_shared',
        {
          shareId,
          resourceType: shareData.resourceType,
          resourceId: shareData.resourceId
        }
      );

      this.emit('resource-shared', {
        shareId,
        sourceOrgId: shareData.sourceOrgId,
        targetOrgId: shareData.targetOrgId,
        resourceType: shareData.resourceType,
        resourceId: shareData.resourceId
      });

      logger.info(`[ResourceSharing] Shared resource ${shareData.resourceId} -> ${shareData.targetOrgId || shareData.targetWorkspaceId}`);

      return { success: true, shareId, encryptionKeyId };
    } catch (error) {
      logger.error('[ResourceSharing] Error sharing resource:', error);
      throw error;
    }
  }

  /**
   * Unshare a resource
   */
  async unshareResource(shareId, unsharerDid) {
    try {
      const db = this.database.getDatabase();
      const now = Date.now();

      const share = db.prepare(`
        SELECT * FROM cross_org_shares WHERE id = ?
      `).get(shareId);

      if (!share) {
        return { success: false, error: 'SHARE_NOT_FOUND' };
      }

      db.prepare(`
        UPDATE cross_org_shares
        SET status = 'revoked', updated_at = ?
        WHERE id = ?
      `).run(now, shareId);

      // Delete encryption key
      if (share.encryption_key_id) {
        await this._deleteShareKey(share.encryption_key_id);
      }

      this._logAudit(
        share.source_org_id,
        share.target_org_id,
        unsharerDid,
        'resource_unshared',
        { shareId, resourceId: share.resource_id }
      );

      logger.info(`[ResourceSharing] Unshared resource ${shareId}`);

      return { success: true };
    } catch (error) {
      logger.error('[ResourceSharing] Error unsharing resource:', error);
      throw error;
    }
  }

  /**
   * Get shared resources
   */
  async getSharedResources(orgId, options = {}) {
    try {
      const db = this.database.getDatabase();

      let query;
      const params = [];

      if (options.direction === 'outgoing') {
        query = `SELECT * FROM cross_org_shares WHERE source_org_id = ?`;
        params.push(orgId);
      } else if (options.direction === 'incoming') {
        query = `SELECT * FROM cross_org_shares WHERE target_org_id = ?`;
        params.push(orgId);
      } else {
        query = `SELECT * FROM cross_org_shares WHERE source_org_id = ? OR target_org_id = ?`;
        params.push(orgId, orgId);
      }

      if (options.status) {
        query += ` AND status = ?`;
        params.push(options.status);
      } else {
        query += ` AND status = 'active'`;
      }

      if (options.resourceType) {
        query += ` AND resource_type = ?`;
        params.push(options.resourceType);
      }

      if (options.workspaceId) {
        query += ` AND target_workspace_id = ?`;
        params.push(options.workspaceId);
      }

      query += ` ORDER BY created_at DESC`;

      if (options.limit) {
        query += ` LIMIT ?`;
        params.push(options.limit);
      }

      const shares = db.prepare(query).all(...params);

      return {
        success: true,
        shares: shares.map(s => ({
          id: s.id,
          sourceOrgId: s.source_org_id,
          targetOrgId: s.target_org_id,
          targetWorkspaceId: s.target_workspace_id,
          resourceType: s.resource_type,
          resourceId: s.resource_id,
          resourceName: s.resource_name,
          shareType: s.share_type,
          permissions: s.permissions ? JSON.parse(s.permissions) : [],
          encrypted: !!s.encryption_key_id,
          expiresAt: s.expires_at,
          status: s.status,
          sharedByDid: s.shared_by_did,
          createdAt: s.created_at,
          accessCount: s.access_count || 0,
          lastAccessedAt: s.last_accessed_at
        }))
      };
    } catch (error) {
      logger.error('[ResourceSharing] Error getting shared resources:', error);
      throw error;
    }
  }

  /**
   * Access a shared resource
   */
  async accessSharedResource(shareId, accessorDid, accessorOrgId) {
    try {
      const db = this.database.getDatabase();
      const now = Date.now();

      const share = db.prepare(`
        SELECT * FROM cross_org_shares WHERE id = ? AND status = 'active'
      `).get(shareId);

      if (!share) {
        return { success: false, error: 'SHARE_NOT_FOUND' };
      }

      // Verify accessor org has access
      if (share.target_org_id && share.target_org_id !== accessorOrgId) {
        // Check workspace membership
        if (share.target_workspace_id) {
          const membership = db.prepare(`
            SELECT id FROM shared_workspace_members
            WHERE workspace_id = ? AND member_did = ?
          `).get(share.target_workspace_id, accessorDid);

          if (!membership) {
            return { success: false, error: 'ACCESS_DENIED' };
          }
        } else {
          return { success: false, error: 'ACCESS_DENIED' };
        }
      }

      // Check expiry
      if (share.expires_at && share.expires_at < now) {
        db.prepare(`
          UPDATE cross_org_shares SET status = 'expired', updated_at = ? WHERE id = ?
        `).run(now, shareId);
        return { success: false, error: 'SHARE_EXPIRED' };
      }

      // Update access stats
      db.prepare(`
        UPDATE cross_org_shares
        SET access_count = COALESCE(access_count, 0) + 1, last_accessed_at = ?, updated_at = ?
        WHERE id = ?
      `).run(now, now, shareId);

      // Get decryption key if encrypted
      let decryptionKey = null;
      if (share.encryption_key_id) {
        decryptionKey = await this._getShareKey(share.encryption_key_id, accessorOrgId);
      }

      this._logAudit(
        share.source_org_id,
        accessorOrgId,
        accessorDid,
        'resource_accessed',
        { shareId, resourceId: share.resource_id }
      );

      return {
        success: true,
        share: {
          resourceType: share.resource_type,
          resourceId: share.resource_id,
          resourceName: share.resource_name,
          permissions: share.permissions ? JSON.parse(share.permissions) : [],
          decryptionKey
        }
      };
    } catch (error) {
      logger.error('[ResourceSharing] Error accessing shared resource:', error);
      throw error;
    }
  }

  /**
   * Update share permissions
   */
  async updateSharePermissions(shareId, permissions, updatedByDid) {
    try {
      const db = this.database.getDatabase();
      const now = Date.now();

      const share = db.prepare(`
        SELECT * FROM cross_org_shares WHERE id = ?
      `).get(shareId);

      if (!share) {
        return { success: false, error: 'SHARE_NOT_FOUND' };
      }

      db.prepare(`
        UPDATE cross_org_shares
        SET permissions = ?, updated_at = ?
        WHERE id = ?
      `).run(JSON.stringify(permissions), now, shareId);

      this._logAudit(
        share.source_org_id,
        share.target_org_id,
        updatedByDid,
        'share_permissions_updated',
        { shareId, newPermissions: permissions }
      );

      return { success: true };
    } catch (error) {
      logger.error('[ResourceSharing] Error updating share permissions:', error);
      throw error;
    }
  }

  /**
   * Get share analytics
   */
  async getShareAnalytics(orgId, options = {}) {
    try {
      const db = this.database.getDatabase();

      const stats = db.prepare(`
        SELECT
          COUNT(CASE WHEN source_org_id = ? THEN 1 END) as outgoingShares,
          COUNT(CASE WHEN target_org_id = ? THEN 1 END) as incomingShares,
          SUM(CASE WHEN source_org_id = ? THEN access_count ELSE 0 END) as totalOutgoingAccess,
          SUM(CASE WHEN target_org_id = ? THEN access_count ELSE 0 END) as totalIncomingAccess
        FROM cross_org_shares
        WHERE (source_org_id = ? OR target_org_id = ?) AND status = 'active'
      `).get(orgId, orgId, orgId, orgId, orgId, orgId);

      const byType = db.prepare(`
        SELECT resource_type, COUNT(*) as count
        FROM cross_org_shares
        WHERE source_org_id = ? AND status = 'active'
        GROUP BY resource_type
      `).all(orgId);

      const topPartners = db.prepare(`
        SELECT
          CASE WHEN source_org_id = ? THEN target_org_id ELSE source_org_id END as partnerId,
          COUNT(*) as shareCount
        FROM cross_org_shares
        WHERE (source_org_id = ? OR target_org_id = ?) AND status = 'active'
        GROUP BY partnerId
        ORDER BY shareCount DESC
        LIMIT 5
      `).all(orgId, orgId, orgId);

      return {
        success: true,
        analytics: {
          outgoingShares: stats?.outgoingShares || 0,
          incomingShares: stats?.incomingShares || 0,
          totalOutgoingAccess: stats?.totalOutgoingAccess || 0,
          totalIncomingAccess: stats?.totalIncomingAccess || 0,
          byResourceType: byType.reduce((acc, t) => {
            acc[t.resource_type] = t.count;
            return acc;
          }, {}),
          topPartners
        }
      };
    } catch (error) {
      logger.error('[ResourceSharing] Error getting share analytics:', error);
      throw error;
    }
  }

  /**
   * Sync resource (for copy type shares)
   */
  async syncResource(shareId, syncByDid) {
    try {
      const db = this.database.getDatabase();
      const now = Date.now();

      const share = db.prepare(`
        SELECT * FROM cross_org_shares WHERE id = ? AND share_type = 'copy' AND status = 'active'
      `).get(shareId);

      if (!share) {
        return { success: false, error: 'SHARE_NOT_FOUND_OR_NOT_COPY' };
      }

      // This would trigger actual resource sync logic
      // For now, just update sync timestamp
      db.prepare(`
        UPDATE cross_org_shares SET last_synced_at = ?, updated_at = ? WHERE id = ?
      `).run(now, now, shareId);

      this.emit('resource-synced', {
        shareId,
        resourceId: share.resource_id
      });

      logger.info(`[ResourceSharing] Synced resource ${shareId}`);

      return { success: true, syncedAt: now };
    } catch (error) {
      logger.error('[ResourceSharing] Error syncing resource:', error);
      throw error;
    }
  }

  /**
   * Request resource access
   */
  async requestResource(requestData) {
    try {
      const db = this.database.getDatabase();
      const now = Date.now();
      const requestId = uuidv4();

      // Store as a pending share request
      db.prepare(`
        INSERT INTO cross_org_shares (
          id, source_org_id, target_org_id, resource_type, resource_id,
          resource_name, share_type, permissions, status, shared_by_did,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'requested', ?, ?, ?)
      `).run(
        requestId,
        requestData.ownerOrgId,
        requestData.requesterOrgId,
        requestData.resourceType,
        requestData.resourceId,
        requestData.resourceName,
        'reference',
        JSON.stringify(requestData.requestedPermissions || ['read']),
        requestData.requesterDid,
        now,
        now
      );

      this.emit('resource-requested', {
        requestId,
        ownerOrgId: requestData.ownerOrgId,
        requesterOrgId: requestData.requesterOrgId,
        resourceId: requestData.resourceId
      });

      logger.info(`[ResourceSharing] Resource access requested: ${requestId}`);

      return { success: true, requestId };
    } catch (error) {
      logger.error('[ResourceSharing] Error requesting resource:', error);
      throw error;
    }
  }

  /**
   * Search shared resources
   */
  async searchSharedResources(orgId, searchParams = {}) {
    try {
      const db = this.database.getDatabase();

      let query = `
        SELECT * FROM cross_org_shares
        WHERE target_org_id = ? AND status = 'active'
      `;
      const params = [orgId];

      if (searchParams.keyword) {
        query += ` AND resource_name LIKE ?`;
        params.push(`%${searchParams.keyword}%`);
      }

      if (searchParams.resourceType) {
        query += ` AND resource_type = ?`;
        params.push(searchParams.resourceType);
      }

      if (searchParams.sourceOrgId) {
        query += ` AND source_org_id = ?`;
        params.push(searchParams.sourceOrgId);
      }

      query += ` ORDER BY created_at DESC`;

      if (searchParams.limit) {
        query += ` LIMIT ?`;
        params.push(searchParams.limit);
      }

      const results = db.prepare(query).all(...params);

      return {
        success: true,
        results: results.map(r => ({
          shareId: r.id,
          sourceOrgId: r.source_org_id,
          resourceType: r.resource_type,
          resourceId: r.resource_id,
          resourceName: r.resource_name,
          permissions: r.permissions ? JSON.parse(r.permissions) : [],
          sharedAt: r.created_at
        }))
      };
    } catch (error) {
      logger.error('[ResourceSharing] Error searching shared resources:', error);
      throw error;
    }
  }

  // ========================================
  // Helper Methods
  // ========================================

  async _createShareKey(shareId, sourceOrgId) {
    // Generate a symmetric key for resource encryption
    const key = crypto.randomBytes(32);
    const keyId = uuidv4();

    // In production, this would be stored encrypted with org's public key
    // For now, store as base64
    const db = this.database.getDatabase();
    const now = Date.now();

    // Store in a separate key table (would need to add this table)
    // For simplicity, return the key ID and key would be stored securely
    logger.debug(`[ResourceSharing] Created share key ${keyId} for ${shareId}`);

    return keyId;
  }

  async _getShareKey(keyId, accessorOrgId) {
    // In production, decrypt the key using accessor's credentials
    // Return placeholder for now
    return null;
  }

  async _deleteShareKey(keyId) {
    // Delete the encryption key
    logger.debug(`[ResourceSharing] Deleted share key ${keyId}`);
  }

  _logAudit(sourceOrgId, targetOrgId, actorDid, action, details) {
    try {
      const db = this.database.getDatabase();
      const now = Date.now();
      const id = uuidv4();

      db.prepare(`
        INSERT INTO cross_org_audit_log (
          id, source_org_id, target_org_id, actor_did, action,
          resource_type, resource_id, details, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        sourceOrgId,
        targetOrgId,
        actorDid,
        action,
        details.resourceType || null,
        details.resourceId || null,
        JSON.stringify(details),
        now
      );
    } catch (error) {
      logger.error('[ResourceSharing] Error logging audit:', error);
    }
  }
}

let resourceSharingManager = null;

function getResourceSharingManager(database) {
  if (!resourceSharingManager && database) {
    resourceSharingManager = new ResourceSharingManager(database);
  }
  return resourceSharingManager;
}

module.exports = {
  ResourceSharingManager,
  getResourceSharingManager
};
