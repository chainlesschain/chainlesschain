/**
 * Identity Bridge
 *
 * Links DID (Decentralized Identity) identities with SSO provider identities.
 * Enables bidirectional lookup between DIDs and SSO subjects, supporting
 * multi-provider identity federation.
 *
 * Features:
 * - DID to SSO identity linking with attribute storage
 * - Verification workflow for identity mappings
 * - Reverse lookup: find DID from SSO provider subject
 * - Mapping statistics and analytics
 *
 * @module auth/identity-bridge
 * @version 1.0.0
 * @since 2026-02-15
 */

const { logger } = require('../utils/logger.js');
const { v4: uuidv4 } = require('uuid');

// Maximum number of linked providers per DID
const MAX_LINKED_PROVIDERS = 20;

// Mapping status constants
const MAPPING_STATUS = {
  PENDING: 'pending',
  VERIFIED: 'verified',
  SUSPENDED: 'suspended',
  REVOKED: 'revoked',
};

/**
 * IdentityBridge - Links DID identities with SSO provider identities
 *
 * Manages the identity_mappings table which stores the association between
 * a user's DID and their identity at various SSO providers (e.g., Google,
 * Microsoft, corporate SAML IdPs).
 */
class IdentityBridge {
  /**
   * Create an identity bridge instance
   * @param {Object} options - Configuration options
   * @param {Object} options.database - Database instance (DatabaseManager)
   */
  constructor({ database }) {
    if (!database) {
      throw new Error('[IdentityBridge] database parameter is required');
    }

    this.database = database;

    logger.info('[IdentityBridge] Initialized');
  }

  // ============================================
  // Identity Linking Operations
  // ============================================

  /**
   * Link a DID identity with an SSO provider identity
   *
   * Creates a mapping between a DID and an SSO subject (the unique identifier
   * for the user at the SSO provider). Optionally stores SSO attributes like
   * email, display name, groups, etc.
   *
   * @param {string} did - The user's DID identifier
   * @param {string} providerId - The SSO provider identifier
   * @param {string} ssoSubject - The subject identifier at the SSO provider
   * @param {Object} [ssoAttributes={}] - Additional SSO attributes to store
   * @param {string} [ssoAttributes.email] - User email from SSO
   * @param {string} [ssoAttributes.displayName] - Display name from SSO
   * @param {Array<string>} [ssoAttributes.groups] - Group memberships from SSO
   * @param {string} [ssoAttributes.avatarUrl] - Avatar URL from SSO
   * @param {Object} [ssoAttributes.raw] - Raw SSO claims/attributes
   * @returns {Promise<Object>} Linking result with mappingId
   */
  async linkIdentity(did, providerId, ssoSubject, ssoAttributes = {}) {
    try {
      if (!did || !providerId || !ssoSubject) {
        throw new Error('did, providerId, and ssoSubject are required');
      }

      const db = this.database.getDatabase();
      const now = Date.now();

      // Check if this exact link already exists
      const existing = db.prepare(`
        SELECT id, status FROM identity_mappings
        WHERE did = ? AND provider_id = ? AND sso_subject = ?
      `).get(did, providerId, ssoSubject);

      if (existing) {
        // If the mapping exists but was revoked, reactivate it
        if (existing.status === MAPPING_STATUS.REVOKED || existing.status === MAPPING_STATUS.SUSPENDED) {
          db.prepare(`
            UPDATE identity_mappings
            SET status = ?, sso_attributes = ?, updated_at = ?
            WHERE id = ?
          `).run(
            MAPPING_STATUS.PENDING,
            JSON.stringify(ssoAttributes),
            now,
            existing.id
          );

          logger.info(`[IdentityBridge] Reactivated mapping ${existing.id} for DID ${did} <-> ${providerId}:${ssoSubject}`);

          return {
            success: true,
            mappingId: existing.id,
            reactivated: true,
          };
        }

        // Already linked and active
        return {
          success: true,
          mappingId: existing.id,
          alreadyLinked: true,
        };
      }

      // Check if DID already has a different subject linked to this provider
      const existingProvider = db.prepare(`
        SELECT id, sso_subject FROM identity_mappings
        WHERE did = ? AND provider_id = ? AND status != ?
      `).get(did, providerId, MAPPING_STATUS.REVOKED);

      if (existingProvider) {
        return {
          success: false,
          error: 'PROVIDER_ALREADY_LINKED',
          message: `DID ${did} is already linked to a different subject at provider ${providerId}`,
          existingMappingId: existingProvider.id,
        };
      }

      // Check if this SSO subject is already linked to a different DID
      const existingSubject = db.prepare(`
        SELECT id, did FROM identity_mappings
        WHERE provider_id = ? AND sso_subject = ? AND status != ?
      `).get(providerId, ssoSubject, MAPPING_STATUS.REVOKED);

      if (existingSubject) {
        return {
          success: false,
          error: 'SUBJECT_ALREADY_LINKED',
          message: `SSO subject ${ssoSubject} at provider ${providerId} is already linked to DID ${existingSubject.did}`,
          existingDid: existingSubject.did,
        };
      }

      // Enforce maximum linked providers per DID
      const linkCount = db.prepare(`
        SELECT COUNT(*) as count FROM identity_mappings
        WHERE did = ? AND status != ?
      `).get(did, MAPPING_STATUS.REVOKED);

      if (linkCount && linkCount.count >= MAX_LINKED_PROVIDERS) {
        return {
          success: false,
          error: 'MAX_LINKS_REACHED',
          message: `DID ${did} has reached the maximum of ${MAX_LINKED_PROVIDERS} linked providers`,
        };
      }

      // Create the mapping
      const mappingId = uuidv4();

      db.prepare(`
        INSERT INTO identity_mappings (
          id, did, provider_id, sso_subject, sso_attributes,
          status, verified_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        mappingId,
        did,
        providerId,
        ssoSubject,
        JSON.stringify(ssoAttributes),
        MAPPING_STATUS.PENDING,
        null,
        now,
        now
      );

      logger.info(`[IdentityBridge] Created mapping ${mappingId}: DID ${did} <-> ${providerId}:${ssoSubject}`);

      return {
        success: true,
        mappingId,
        status: MAPPING_STATUS.PENDING,
      };
    } catch (error) {
      logger.error('[IdentityBridge] Error linking identity:', error);
      throw error;
    }
  }

  /**
   * Unlink a DID from an SSO provider
   *
   * Sets the mapping status to 'revoked' rather than deleting the record,
   * preserving audit history.
   *
   * @param {string} did - The user's DID identifier
   * @param {string} providerId - The SSO provider identifier
   * @returns {Promise<Object>} Unlink result
   */
  async unlinkIdentity(did, providerId) {
    try {
      if (!did || !providerId) {
        throw new Error('did and providerId are required');
      }

      const db = this.database.getDatabase();
      const now = Date.now();

      // Find active mapping
      const mapping = db.prepare(`
        SELECT id, status FROM identity_mappings
        WHERE did = ? AND provider_id = ? AND status != ?
      `).get(did, providerId, MAPPING_STATUS.REVOKED);

      if (!mapping) {
        return {
          success: false,
          error: 'MAPPING_NOT_FOUND',
          message: `No active mapping found for DID ${did} with provider ${providerId}`,
        };
      }

      // Revoke the mapping (soft delete)
      db.prepare(`
        UPDATE identity_mappings
        SET status = ?, updated_at = ?
        WHERE id = ?
      `).run(MAPPING_STATUS.REVOKED, now, mapping.id);

      logger.info(`[IdentityBridge] Unlinked identity mapping ${mapping.id}: DID ${did} from provider ${providerId}`);

      return {
        success: true,
        mappingId: mapping.id,
      };
    } catch (error) {
      logger.error('[IdentityBridge] Error unlinking identity:', error);
      throw error;
    }
  }

  // ============================================
  // Identity Lookup Operations
  // ============================================

  /**
   * Get all SSO identities linked to a DID
   *
   * @param {string} did - The user's DID identifier
   * @param {Object} [options={}] - Query options
   * @param {boolean} [options.includeRevoked=false] - Include revoked mappings
   * @returns {Promise<Array>} List of linked SSO identities
   */
  async getLinkedIdentities(did, options = {}) {
    try {
      if (!did) {
        throw new Error('did is required');
      }

      const db = this.database.getDatabase();
      const includeRevoked = options.includeRevoked === true;

      let query = `
        SELECT * FROM identity_mappings
        WHERE did = ?
      `;
      const params = [did];

      if (!includeRevoked) {
        query += ` AND status != ?`;
        params.push(MAPPING_STATUS.REVOKED);
      }

      query += ` ORDER BY created_at DESC`;

      const mappings = db.prepare(query).all(...params);

      if (!mappings || mappings.length === 0) {
        return [];
      }

      return mappings.map(mapping => this._formatMapping(mapping));
    } catch (error) {
      logger.error('[IdentityBridge] Error getting linked identities:', error);
      throw error;
    }
  }

  /**
   * Verify an identity mapping
   *
   * Marks the mapping as verified, typically after the user has confirmed
   * ownership of both the DID and the SSO identity.
   *
   * @param {string} mappingId - The mapping identifier
   * @returns {Promise<Object>} Verification result
   */
  async verifyLink(mappingId) {
    try {
      if (!mappingId) {
        throw new Error('mappingId is required');
      }

      const db = this.database.getDatabase();
      const now = Date.now();

      // Check mapping exists and is in pending state
      const mapping = db.prepare(`
        SELECT id, status FROM identity_mappings WHERE id = ?
      `).get(mappingId);

      if (!mapping) {
        return {
          success: false,
          error: 'MAPPING_NOT_FOUND',
        };
      }

      if (mapping.status === MAPPING_STATUS.VERIFIED) {
        return {
          success: true,
          alreadyVerified: true,
        };
      }

      if (mapping.status === MAPPING_STATUS.REVOKED) {
        return {
          success: false,
          error: 'MAPPING_REVOKED',
          message: 'Cannot verify a revoked mapping',
        };
      }

      // Mark as verified
      db.prepare(`
        UPDATE identity_mappings
        SET status = ?, verified_at = ?, updated_at = ?
        WHERE id = ?
      `).run(MAPPING_STATUS.VERIFIED, now, now, mappingId);

      logger.info(`[IdentityBridge] Verified identity mapping ${mappingId}`);

      return {
        success: true,
        verifiedAt: now,
      };
    } catch (error) {
      logger.error('[IdentityBridge] Error verifying link:', error);
      throw error;
    }
  }

  /**
   * Find a DID by SSO provider and subject (reverse lookup)
   *
   * Given an SSO provider and subject identifier, find the associated DID.
   * Only returns verified or pending mappings.
   *
   * @param {string} providerId - The SSO provider identifier
   * @param {string} ssoSubject - The subject identifier at the SSO provider
   * @returns {Promise<Object|null>} Mapping with DID, or null if not found
   */
  async findDIDBySSOSubject(providerId, ssoSubject) {
    try {
      if (!providerId || !ssoSubject) {
        throw new Error('providerId and ssoSubject are required');
      }

      const db = this.database.getDatabase();

      const mapping = db.prepare(`
        SELECT * FROM identity_mappings
        WHERE provider_id = ? AND sso_subject = ? AND status != ?
        ORDER BY
          CASE status
            WHEN 'verified' THEN 1
            WHEN 'pending' THEN 2
            WHEN 'suspended' THEN 3
          END
        LIMIT 1
      `).get(providerId, ssoSubject, MAPPING_STATUS.REVOKED);

      if (!mapping) {
        logger.info(`[IdentityBridge] No DID found for SSO subject ${ssoSubject} at provider ${providerId}`);
        return null;
      }

      return this._formatMapping(mapping);
    } catch (error) {
      logger.error('[IdentityBridge] Error finding DID by SSO subject:', error);
      throw error;
    }
  }

  /**
   * Get a single mapping by ID
   *
   * @param {string} id - The mapping identifier
   * @returns {Promise<Object|null>} Mapping data, or null if not found
   */
  async getMapping(id) {
    try {
      if (!id) {
        throw new Error('id is required');
      }

      const db = this.database.getDatabase();

      const mapping = db.prepare(`
        SELECT * FROM identity_mappings WHERE id = ?
      `).get(id);

      if (!mapping) {
        return null;
      }

      return this._formatMapping(mapping);
    } catch (error) {
      logger.error('[IdentityBridge] Error getting mapping:', error);
      throw error;
    }
  }

  /**
   * Check if a DID is linked to a specific SSO provider
   *
   * @param {string} did - The user's DID identifier
   * @param {string} providerId - The SSO provider identifier
   * @returns {Promise<boolean>} True if linked (non-revoked)
   */
  async isLinked(did, providerId) {
    try {
      if (!did || !providerId) {
        return false;
      }

      const db = this.database.getDatabase();

      const mapping = db.prepare(`
        SELECT id FROM identity_mappings
        WHERE did = ? AND provider_id = ? AND status != ?
        LIMIT 1
      `).get(did, providerId, MAPPING_STATUS.REVOKED);

      return !!mapping;
    } catch (error) {
      logger.error('[IdentityBridge] Error checking link:', error);
      return false;
    }
  }

  // ============================================
  // Statistics
  // ============================================

  /**
   * Get statistics about identity mappings
   *
   * Returns counts by status, by provider, and overall totals.
   *
   * @returns {Promise<Object>} Mapping statistics
   */
  async getMappingStats() {
    try {
      const db = this.database.getDatabase();

      // Total mappings
      const totalResult = db.prepare(`
        SELECT COUNT(*) as count FROM identity_mappings
      `).get();

      // Count by status
      const byStatusResults = db.prepare(`
        SELECT status, COUNT(*) as count
        FROM identity_mappings
        GROUP BY status
        ORDER BY count DESC
      `).all();

      const byStatus = {};
      if (byStatusResults) {
        for (const row of byStatusResults) {
          byStatus[row.status] = row.count;
        }
      }

      // Count by provider (non-revoked only)
      const byProviderResults = db.prepare(`
        SELECT provider_id, COUNT(*) as count
        FROM identity_mappings
        WHERE status != ?
        GROUP BY provider_id
        ORDER BY count DESC
      `).all(MAPPING_STATUS.REVOKED);

      const byProvider = {};
      if (byProviderResults) {
        for (const row of byProviderResults) {
          byProvider[row.provider_id] = row.count;
        }
      }

      // Unique DIDs with at least one active mapping
      const uniqueDidsResult = db.prepare(`
        SELECT COUNT(DISTINCT did) as count
        FROM identity_mappings
        WHERE status != ?
      `).get(MAPPING_STATUS.REVOKED);

      // Verified vs unverified
      const verifiedResult = db.prepare(`
        SELECT COUNT(*) as count FROM identity_mappings
        WHERE status = ?
      `).get(MAPPING_STATUS.VERIFIED);

      const pendingResult = db.prepare(`
        SELECT COUNT(*) as count FROM identity_mappings
        WHERE status = ?
      `).get(MAPPING_STATUS.PENDING);

      // Recent mappings (last 24 hours)
      const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
      const recentResult = db.prepare(`
        SELECT COUNT(*) as count FROM identity_mappings
        WHERE created_at > ?
      `).get(oneDayAgo);

      return {
        total: totalResult ? totalResult.count : 0,
        byStatus,
        byProvider,
        uniqueDids: uniqueDidsResult ? uniqueDidsResult.count : 0,
        verified: verifiedResult ? verifiedResult.count : 0,
        pending: pendingResult ? pendingResult.count : 0,
        recentCount: recentResult ? recentResult.count : 0,
      };
    } catch (error) {
      logger.error('[IdentityBridge] Error getting mapping stats:', error);
      throw error;
    }
  }

  // ============================================
  // Private Helpers
  // ============================================

  /**
   * Format a raw database mapping row into a clean object
   *
   * @private
   * @param {Object} mapping - Raw database row
   * @returns {Object} Formatted mapping object
   */
  _formatMapping(mapping) {
    let ssoAttributes = {};
    try {
      if (mapping.sso_attributes) {
        ssoAttributes = JSON.parse(mapping.sso_attributes);
      }
    } catch (parseError) {
      logger.warn(`[IdentityBridge] Failed to parse sso_attributes for mapping ${mapping.id}`);
    }

    return {
      id: mapping.id,
      did: mapping.did,
      providerId: mapping.provider_id,
      ssoSubject: mapping.sso_subject,
      ssoAttributes,
      status: mapping.status,
      verifiedAt: mapping.verified_at,
      createdAt: mapping.created_at,
      updatedAt: mapping.updated_at,
    };
  }
}

module.exports = { IdentityBridge };
