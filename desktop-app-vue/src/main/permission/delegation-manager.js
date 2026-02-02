/**
 * Permission Delegation Manager
 *
 * Manages temporary permission delegations between users.
 *
 * @module permission/delegation-manager
 */

const { logger } = require('../utils/logger.js');
const { v4: uuidv4 } = require('uuid');

class DelegationManager {
  constructor(database) {
    this.database = database;
  }

  /**
   * Delegate permissions to another user
   */
  async delegatePermissions(params) {
    try {
      const db = this.database.getDatabase();
      const now = Date.now();
      const delegationId = uuidv4();

      db.prepare(`
        INSERT INTO permission_delegations (
          id, org_id, delegator_did, delegate_did, delegate_name,
          permissions, resource_scope, reason, start_date, end_date,
          status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
      `).run(
        delegationId,
        params.orgId,
        params.delegatorDid,
        params.delegateDid,
        params.delegateName,
        JSON.stringify(params.permissions),
        params.resourceScope ? JSON.stringify(params.resourceScope) : null,
        params.reason,
        params.startDate,
        params.endDate,
        now,
        now
      );

      logger.info(`[Delegation] Created delegation ${delegationId} from ${params.delegatorDid} to ${params.delegateDid}`);

      return { success: true, delegationId };
    } catch (error) {
      logger.error('[Delegation] Error creating delegation:', error);
      throw error;
    }
  }

  /**
   * Revoke a delegation
   */
  async revokeDelegation(delegationId, revokerDid) {
    try {
      const db = this.database.getDatabase();
      const now = Date.now();

      const delegation = db.prepare(`
        SELECT * FROM permission_delegations WHERE id = ?
      `).get(delegationId);

      if (!delegation) {
        return { success: false, error: 'DELEGATION_NOT_FOUND' };
      }

      if (delegation.delegator_did !== revokerDid) {
        return { success: false, error: 'NOT_DELEGATOR' };
      }

      db.prepare(`
        UPDATE permission_delegations
        SET status = 'revoked', updated_at = ?
        WHERE id = ?
      `).run(now, delegationId);

      logger.info(`[Delegation] Revoked delegation ${delegationId}`);

      return { success: true };
    } catch (error) {
      logger.error('[Delegation] Error revoking delegation:', error);
      throw error;
    }
  }

  /**
   * Get delegations for a user
   */
  async getDelegations(userDid, orgId, options = {}) {
    try {
      const db = this.database.getDatabase();

      let query = `SELECT * FROM permission_delegations WHERE org_id = ?`;
      const params = [orgId];

      if (options.type === 'delegated') {
        query += ` AND delegator_did = ?`;
        params.push(userDid);
      } else if (options.type === 'received') {
        query += ` AND delegate_did = ?`;
        params.push(userDid);
      } else {
        query += ` AND (delegator_did = ? OR delegate_did = ?)`;
        params.push(userDid, userDid);
      }

      if (options.status) {
        query += ` AND status = ?`;
        params.push(options.status);
      }

      query += ` ORDER BY created_at DESC`;

      const delegations = db.prepare(query).all(...params);

      return {
        success: true,
        delegations: delegations.map(d => ({
          id: d.id,
          delegatorDid: d.delegator_did,
          delegateDid: d.delegate_did,
          delegateName: d.delegate_name,
          permissions: d.permissions ? JSON.parse(d.permissions) : [],
          resourceScope: d.resource_scope ? JSON.parse(d.resource_scope) : null,
          reason: d.reason,
          startDate: d.start_date,
          endDate: d.end_date,
          status: d.status,
          createdAt: d.created_at
        }))
      };
    } catch (error) {
      logger.error('[Delegation] Error getting delegations:', error);
      throw error;
    }
  }

  /**
   * Accept a delegation
   */
  async acceptDelegation(delegationId, delegateDid) {
    try {
      const db = this.database.getDatabase();
      const now = Date.now();

      const delegation = db.prepare(`
        SELECT * FROM permission_delegations
        WHERE id = ? AND delegate_did = ? AND status = 'pending'
      `).get(delegationId, delegateDid);

      if (!delegation) {
        return { success: false, error: 'DELEGATION_NOT_FOUND' };
      }

      db.prepare(`
        UPDATE permission_delegations
        SET status = 'active', updated_at = ?
        WHERE id = ?
      `).run(now, delegationId);

      logger.info(`[Delegation] Accepted delegation ${delegationId}`);

      return { success: true };
    } catch (error) {
      logger.error('[Delegation] Error accepting delegation:', error);
      throw error;
    }
  }
}

let delegationManager = null;

function getDelegationManager(database) {
  if (!delegationManager && database) {
    delegationManager = new DelegationManager(database);
  }
  return delegationManager;
}

module.exports = {
  DelegationManager,
  getDelegationManager
};
