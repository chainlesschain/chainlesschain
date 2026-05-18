/**
 * Partnership Manager
 *
 * Manages organization partnerships and trust relationships.
 *
 * @module crossorg/partnership-manager
 */

const { logger } = require('../utils/logger.js');
const { v4: uuidv4 } = require('uuid');
const EventEmitter = require('events');

class PartnershipManager extends EventEmitter {
  constructor(database) {
    super();
    this.database = database;
  }

  // ========================================
  // Partnership CRUD
  // ========================================

  /**
   * Create a partnership request
   */
  async createPartnership(partnershipData) {
    try {
      const db = this.database.getDatabase();
      const now = Date.now();
      const partnershipId = uuidv4();

      // Check if partnership already exists
      const existing = db.prepare(`
        SELECT id FROM org_partnerships
        WHERE (initiator_org_id = ? AND partner_org_id = ?)
           OR (initiator_org_id = ? AND partner_org_id = ?)
      `).get(
        partnershipData.initiatorOrgId,
        partnershipData.partnerOrgId,
        partnershipData.partnerOrgId,
        partnershipData.initiatorOrgId
      );

      if (existing) {
        return { success: false, error: 'PARTNERSHIP_EXISTS' };
      }

      db.prepare(`
        INSERT INTO org_partnerships (
          id, initiator_org_id, initiator_org_name, partner_org_id, partner_org_name,
          partnership_type, status, trust_level, agreement_hash, terms,
          invited_by_did, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)
      `).run(
        partnershipId,
        partnershipData.initiatorOrgId,
        partnershipData.initiatorOrgName,
        partnershipData.partnerOrgId,
        partnershipData.partnerOrgName,
        partnershipData.partnershipType || 'collaboration',
        partnershipData.trustLevel || 'standard',
        partnershipData.agreementHash,
        partnershipData.terms ? JSON.stringify(partnershipData.terms) : null,
        partnershipData.invitedByDid,
        now,
        now
      );

      // Emit event for notification
      this.emit('partnership-requested', {
        partnershipId,
        initiatorOrgId: partnershipData.initiatorOrgId,
        partnerOrgId: partnershipData.partnerOrgId
      });

      logger.info(`[Partnership] Created partnership request ${partnershipId}`);

      return { success: true, partnershipId };
    } catch (error) {
      logger.error('[Partnership] Error creating partnership:', error);
      throw error;
    }
  }

  /**
   * Accept a partnership request
   */
  async acceptPartnership(partnershipId, acceptedByDid) {
    try {
      const db = this.database.getDatabase();
      const now = Date.now();

      const partnership = db.prepare(`
        SELECT * FROM org_partnerships WHERE id = ? AND status = 'pending'
      `).get(partnershipId);

      if (!partnership) {
        return { success: false, error: 'PARTNERSHIP_NOT_FOUND' };
      }

      db.prepare(`
        UPDATE org_partnerships
        SET status = 'active', accepted_by_did = ?, accepted_at = ?, updated_at = ?
        WHERE id = ?
      `).run(acceptedByDid, now, now, partnershipId);

      this.emit('partnership-accepted', {
        partnershipId,
        initiatorOrgId: partnership.initiator_org_id,
        partnerOrgId: partnership.partner_org_id
      });

      logger.info(`[Partnership] Accepted partnership ${partnershipId}`);

      return { success: true };
    } catch (error) {
      logger.error('[Partnership] Error accepting partnership:', error);
      throw error;
    }
  }

  /**
   * Reject a partnership request
   */
  async rejectPartnership(partnershipId, rejectedByDid, reason = null) {
    try {
      const db = this.database.getDatabase();
      const now = Date.now();

      const partnership = db.prepare(`
        SELECT * FROM org_partnerships WHERE id = ? AND status = 'pending'
      `).get(partnershipId);

      if (!partnership) {
        return { success: false, error: 'PARTNERSHIP_NOT_FOUND' };
      }

      db.prepare(`
        UPDATE org_partnerships
        SET status = 'rejected', updated_at = ?
        WHERE id = ?
      `).run(now, partnershipId);

      // Log rejection
      this._logAudit(
        partnership.initiator_org_id,
        partnership.partner_org_id,
        rejectedByDid,
        'partnership_rejected',
        { partnershipId, reason }
      );

      this.emit('partnership-rejected', { partnershipId, reason });

      logger.info(`[Partnership] Rejected partnership ${partnershipId}`);

      return { success: true };
    } catch (error) {
      logger.error('[Partnership] Error rejecting partnership:', error);
      throw error;
    }
  }

  /**
   * Update partnership settings
   */
  async updatePartnership(partnershipId, updates) {
    try {
      const db = this.database.getDatabase();
      const now = Date.now();

      const allowedFields = ['partnership_type', 'trust_level', 'agreement_hash', 'terms'];
      const updateParts = [];
      const values = [];

      for (const [key, value] of Object.entries(updates)) {
        const dbKey = key.replace(/([A-Z])/g, '_$1').toLowerCase();
        if (allowedFields.includes(dbKey)) {
          updateParts.push(`${dbKey} = ?`);
          values.push(key === 'terms' ? JSON.stringify(value) : value);
        }
      }

      if (updateParts.length === 0) {
        return { success: true };
      }

      updateParts.push('updated_at = ?');
      values.push(now);
      values.push(partnershipId);

      db.prepare(`
        UPDATE org_partnerships SET ${updateParts.join(', ')} WHERE id = ?
      `).run(...values);

      return { success: true };
    } catch (error) {
      logger.error('[Partnership] Error updating partnership:', error);
      throw error;
    }
  }

  /**
   * Terminate a partnership
   */
  async terminatePartnership(partnershipId, terminatedByDid, reason = null) {
    try {
      const db = this.database.getDatabase();
      const now = Date.now();

      const partnership = db.prepare(`
        SELECT * FROM org_partnerships WHERE id = ? AND status = 'active'
      `).get(partnershipId);

      if (!partnership) {
        return { success: false, error: 'PARTNERSHIP_NOT_FOUND' };
      }

      db.prepare(`
        UPDATE org_partnerships
        SET status = 'terminated', terminated_at = ?, updated_at = ?
        WHERE id = ?
      `).run(now, now, partnershipId);

      // Revoke all shared resources
      db.prepare(`
        UPDATE cross_org_shares
        SET status = 'revoked', updated_at = ?
        WHERE (source_org_id = ? AND target_org_id = ?)
           OR (source_org_id = ? AND target_org_id = ?)
      `).run(
        now,
        partnership.initiator_org_id,
        partnership.partner_org_id,
        partnership.partner_org_id,
        partnership.initiator_org_id
      );

      this._logAudit(
        partnership.initiator_org_id,
        partnership.partner_org_id,
        terminatedByDid,
        'partnership_terminated',
        { partnershipId, reason }
      );

      this.emit('partnership-terminated', { partnershipId, reason });

      logger.info(`[Partnership] Terminated partnership ${partnershipId}`);

      return { success: true };
    } catch (error) {
      logger.error('[Partnership] Error terminating partnership:', error);
      throw error;
    }
  }

  // ========================================
  // Query Operations
  // ========================================

  /**
   * Get partnerships for an organization
   */
  async getPartnerships(orgId, options = {}) {
    try {
      const db = this.database.getDatabase();

      let query = `
        SELECT * FROM org_partnerships
        WHERE (initiator_org_id = ? OR partner_org_id = ?)
      `;
      const params = [orgId, orgId];

      if (options.status) {
        query += ` AND status = ?`;
        params.push(options.status);
      }

      if (options.partnershipType) {
        query += ` AND partnership_type = ?`;
        params.push(options.partnershipType);
      }

      query += ` ORDER BY created_at DESC`;

      if (options.limit) {
        query += ` LIMIT ?`;
        params.push(options.limit);
      }

      const partnerships = db.prepare(query).all(...params);

      return {
        success: true,
        partnerships: partnerships.map(p => ({
          id: p.id,
          initiatorOrgId: p.initiator_org_id,
          initiatorOrgName: p.initiator_org_name,
          partnerOrgId: p.partner_org_id,
          partnerOrgName: p.partner_org_name,
          partnershipType: p.partnership_type,
          status: p.status,
          trustLevel: p.trust_level,
          terms: p.terms ? JSON.parse(p.terms) : null,
          createdAt: p.created_at,
          acceptedAt: p.accepted_at
        }))
      };
    } catch (error) {
      logger.error('[Partnership] Error getting partnerships:', error);
      throw error;
    }
  }

  /**
   * Get partner organizations
   */
  async getPartnerOrgs(orgId) {
    try {
      const db = this.database.getDatabase();

      const partnerships = db.prepare(`
        SELECT * FROM org_partnerships
        WHERE (initiator_org_id = ? OR partner_org_id = ?) AND status = 'active'
      `).all(orgId, orgId);

      const partners = partnerships.map(p => {
        const isInitiator = p.initiator_org_id === orgId;
        return {
          orgId: isInitiator ? p.partner_org_id : p.initiator_org_id,
          orgName: isInitiator ? p.partner_org_name : p.initiator_org_name,
          partnershipId: p.id,
          partnershipType: p.partnership_type,
          trustLevel: p.trust_level,
          since: p.accepted_at
        };
      });

      return { success: true, partners };
    } catch (error) {
      logger.error('[Partnership] Error getting partner orgs:', error);
      throw error;
    }
  }

  /**
   * Update trust level
   */
  async updateTrustLevel(partnershipId, trustLevel, updatedByDid) {
    try {
      const db = this.database.getDatabase();
      const now = Date.now();

      const validLevels = ['minimal', 'standard', 'elevated', 'full'];
      if (!validLevels.includes(trustLevel)) {
        return { success: false, error: 'INVALID_TRUST_LEVEL' };
      }

      const partnership = db.prepare(`
        SELECT * FROM org_partnerships WHERE id = ?
      `).get(partnershipId);

      if (!partnership) {
        return { success: false, error: 'PARTNERSHIP_NOT_FOUND' };
      }

      const oldLevel = partnership.trust_level;

      db.prepare(`
        UPDATE org_partnerships SET trust_level = ?, updated_at = ? WHERE id = ?
      `).run(trustLevel, now, partnershipId);

      this._logAudit(
        partnership.initiator_org_id,
        partnership.partner_org_id,
        updatedByDid,
        'trust_level_changed',
        { partnershipId, oldLevel, newLevel: trustLevel }
      );

      logger.info(`[Partnership] Updated trust level for ${partnershipId}: ${oldLevel} -> ${trustLevel}`);

      return { success: true };
    } catch (error) {
      logger.error('[Partnership] Error updating trust level:', error);
      throw error;
    }
  }

  // ========================================
  // Discovery
  // ========================================

  /**
   * Discover organizations
   */
  async discoverOrgs(searchParams = {}) {
    try {
      const db = this.database.getDatabase();

      let query = `
        SELECT * FROM cross_org_discovery
        WHERE visibility = 'public'
      `;
      const params = [];

      if (searchParams.industry) {
        query += ` AND industry = ?`;
        params.push(searchParams.industry);
      }

      if (searchParams.region) {
        query += ` AND region = ?`;
        params.push(searchParams.region);
      }

      if (searchParams.keyword) {
        query += ` AND (name LIKE ? OR description LIKE ?)`;
        params.push(`%${searchParams.keyword}%`, `%${searchParams.keyword}%`);
      }

      query += ` ORDER BY name ASC`;

      if (searchParams.limit) {
        query += ` LIMIT ?`;
        params.push(searchParams.limit);
      }

      const orgs = db.prepare(query).all(...params);

      return {
        success: true,
        organizations: orgs.map(o => ({
          orgId: o.org_id,
          name: o.name,
          description: o.description,
          industry: o.industry,
          region: o.region,
          website: o.website,
          contactEmail: o.contact_email,
          capabilities: o.capabilities ? JSON.parse(o.capabilities) : [],
          certifications: o.certifications ? JSON.parse(o.certifications) : []
        }))
      };
    } catch (error) {
      logger.error('[Partnership] Error discovering orgs:', error);
      throw error;
    }
  }

  /**
   * Get organization profile
   */
  async getOrgProfile(orgId) {
    try {
      const db = this.database.getDatabase();

      const profile = db.prepare(`
        SELECT * FROM cross_org_discovery WHERE org_id = ?
      `).get(orgId);

      if (!profile) {
        return { success: false, error: 'ORG_NOT_FOUND' };
      }

      return {
        success: true,
        profile: {
          orgId: profile.org_id,
          name: profile.name,
          description: profile.description,
          industry: profile.industry,
          region: profile.region,
          website: profile.website,
          contactEmail: profile.contact_email,
          capabilities: profile.capabilities ? JSON.parse(profile.capabilities) : [],
          certifications: profile.certifications ? JSON.parse(profile.certifications) : [],
          visibility: profile.visibility
        }
      };
    } catch (error) {
      logger.error('[Partnership] Error getting org profile:', error);
      throw error;
    }
  }

  /**
   * Update organization discovery profile
   */
  async updateOrgProfile(orgId, profileData) {
    try {
      const db = this.database.getDatabase();
      const now = Date.now();

      const existing = db.prepare(`
        SELECT id FROM cross_org_discovery WHERE org_id = ?
      `).get(orgId);

      if (existing) {
        db.prepare(`
          UPDATE cross_org_discovery
          SET name = ?, description = ?, industry = ?, region = ?,
              website = ?, contact_email = ?, capabilities = ?,
              certifications = ?, visibility = ?, updated_at = ?
          WHERE org_id = ?
        `).run(
          profileData.name,
          profileData.description,
          profileData.industry,
          profileData.region,
          profileData.website,
          profileData.contactEmail,
          profileData.capabilities ? JSON.stringify(profileData.capabilities) : null,
          profileData.certifications ? JSON.stringify(profileData.certifications) : null,
          profileData.visibility || 'public',
          now,
          orgId
        );
      } else {
        const id = uuidv4();
        db.prepare(`
          INSERT INTO cross_org_discovery (
            id, org_id, name, description, industry, region,
            website, contact_email, capabilities, certifications,
            visibility, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          id,
          orgId,
          profileData.name,
          profileData.description,
          profileData.industry,
          profileData.region,
          profileData.website,
          profileData.contactEmail,
          profileData.capabilities ? JSON.stringify(profileData.capabilities) : null,
          profileData.certifications ? JSON.stringify(profileData.certifications) : null,
          profileData.visibility || 'public',
          now,
          now
        );
      }

      return { success: true };
    } catch (error) {
      logger.error('[Partnership] Error updating org profile:', error);
      throw error;
    }
  }

  // ========================================
  // Helper Methods
  // ========================================

  _logAudit(sourceOrgId, targetOrgId, actorDid, action, details) {
    try {
      const db = this.database.getDatabase();
      const now = Date.now();
      const id = uuidv4();

      db.prepare(`
        INSERT INTO cross_org_audit_log (
          id, source_org_id, target_org_id, actor_did, action, resource_type,
          resource_id, details, ip_address, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        sourceOrgId,
        targetOrgId,
        actorDid,
        action,
        details.resourceType || null,
        details.resourceId || null,
        JSON.stringify(details),
        null,
        now
      );
    } catch (error) {
      logger.error('[Partnership] Error logging audit:', error);
    }
  }
}

let partnershipManager = null;

function getPartnershipManager(database) {
  if (!partnershipManager && database) {
    partnershipManager = new PartnershipManager(database);
  }
  return partnershipManager;
}

module.exports = {
  PartnershipManager,
  getPartnershipManager
};
