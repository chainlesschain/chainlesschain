/**
 * B2B Exchange Manager
 *
 * Manages B2B data transactions between organizations.
 *
 * @module crossorg/b2b-exchange-manager
 */

const { logger } = require('../utils/logger.js');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const EventEmitter = require('events');

class B2BExchangeManager extends EventEmitter {
  constructor(database) {
    super();
    this.database = database;
  }

  // ========================================
  // Transaction Management
  // ========================================

  /**
   * Initiate a B2B data transaction
   */
  async initiateTransaction(transactionData) {
    try {
      const db = this.database.getDatabase();
      const now = Date.now();
      const transactionId = uuidv4();

      // Verify partnership
      const partnership = db.prepare(`
        SELECT id, trust_level FROM org_partnerships
        WHERE ((initiator_org_id = ? AND partner_org_id = ?)
           OR (initiator_org_id = ? AND partner_org_id = ?))
          AND status = 'active'
      `).get(
        transactionData.senderOrgId,
        transactionData.receiverOrgId,
        transactionData.receiverOrgId,
        transactionData.senderOrgId
      );

      if (!partnership) {
        return { success: false, error: 'NO_PARTNERSHIP' };
      }

      // Compute data hash for integrity verification
      const dataHash = this._computeHash(transactionData.data || transactionData.dataReference);

      db.prepare(`
        INSERT INTO b2b_data_transactions (
          id, sender_org_id, receiver_org_id, transaction_type, data_type,
          data_hash, data_size, encryption_method, status, metadata,
          initiated_by_did, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)
      `).run(
        transactionId,
        transactionData.senderOrgId,
        transactionData.receiverOrgId,
        transactionData.transactionType || 'data_transfer',
        transactionData.dataType,
        dataHash,
        transactionData.dataSize || 0,
        transactionData.encryptionMethod || 'AES-256-GCM',
        transactionData.metadata ? JSON.stringify(transactionData.metadata) : null,
        transactionData.initiatedByDid,
        now,
        now
      );

      // Log audit
      this._logAudit(
        transactionData.senderOrgId,
        transactionData.receiverOrgId,
        transactionData.initiatedByDid,
        'transaction_initiated',
        {
          transactionId,
          transactionType: transactionData.transactionType,
          dataType: transactionData.dataType
        }
      );

      this.emit('transaction-initiated', {
        transactionId,
        senderOrgId: transactionData.senderOrgId,
        receiverOrgId: transactionData.receiverOrgId
      });

      logger.info(`[B2BExchange] Initiated transaction ${transactionId}`);

      return { success: true, transactionId, dataHash };
    } catch (error) {
      logger.error('[B2BExchange] Error initiating transaction:', error);
      throw error;
    }
  }

  /**
   * Accept a transaction
   */
  async acceptTransaction(transactionId, acceptedByDid) {
    try {
      const db = this.database.getDatabase();
      const now = Date.now();

      const transaction = db.prepare(`
        SELECT * FROM b2b_data_transactions WHERE id = ? AND status = 'pending'
      `).get(transactionId);

      if (!transaction) {
        return { success: false, error: 'TRANSACTION_NOT_FOUND' };
      }

      db.prepare(`
        UPDATE b2b_data_transactions
        SET status = 'accepted', accepted_at = ?, accepted_by_did = ?, updated_at = ?
        WHERE id = ?
      `).run(now, acceptedByDid, now, transactionId);

      this._logAudit(
        transaction.sender_org_id,
        transaction.receiver_org_id,
        acceptedByDid,
        'transaction_accepted',
        { transactionId }
      );

      this.emit('transaction-accepted', {
        transactionId,
        senderOrgId: transaction.sender_org_id,
        receiverOrgId: transaction.receiver_org_id
      });

      logger.info(`[B2BExchange] Accepted transaction ${transactionId}`);

      return { success: true };
    } catch (error) {
      logger.error('[B2BExchange] Error accepting transaction:', error);
      throw error;
    }
  }

  /**
   * Reject a transaction
   */
  async rejectTransaction(transactionId, rejectedByDid, reason = null) {
    try {
      const db = this.database.getDatabase();
      const now = Date.now();

      const transaction = db.prepare(`
        SELECT * FROM b2b_data_transactions WHERE id = ? AND status = 'pending'
      `).get(transactionId);

      if (!transaction) {
        return { success: false, error: 'TRANSACTION_NOT_FOUND' };
      }

      db.prepare(`
        UPDATE b2b_data_transactions
        SET status = 'rejected', rejected_at = ?, rejected_by_did = ?,
            rejection_reason = ?, updated_at = ?
        WHERE id = ?
      `).run(now, rejectedByDid, reason, now, transactionId);

      this._logAudit(
        transaction.sender_org_id,
        transaction.receiver_org_id,
        rejectedByDid,
        'transaction_rejected',
        { transactionId, reason }
      );

      this.emit('transaction-rejected', {
        transactionId,
        reason
      });

      logger.info(`[B2BExchange] Rejected transaction ${transactionId}`);

      return { success: true };
    } catch (error) {
      logger.error('[B2BExchange] Error rejecting transaction:', error);
      throw error;
    }
  }

  /**
   * Complete a transaction (after data transfer)
   */
  async completeTransaction(transactionId, completedByDid, verificationData = null) {
    try {
      const db = this.database.getDatabase();
      const now = Date.now();

      const transaction = db.prepare(`
        SELECT * FROM b2b_data_transactions WHERE id = ? AND status = 'accepted'
      `).get(transactionId);

      if (!transaction) {
        return { success: false, error: 'TRANSACTION_NOT_FOUND' };
      }

      // Verify data integrity if verification data provided
      if (verificationData?.receivedHash) {
        if (verificationData.receivedHash !== transaction.data_hash) {
          db.prepare(`
            UPDATE b2b_data_transactions
            SET status = 'failed', failure_reason = 'DATA_INTEGRITY_MISMATCH', updated_at = ?
            WHERE id = ?
          `).run(now, transactionId);

          return { success: false, error: 'DATA_INTEGRITY_MISMATCH' };
        }
      }

      db.prepare(`
        UPDATE b2b_data_transactions
        SET status = 'completed', completed_at = ?, updated_at = ?
        WHERE id = ?
      `).run(now, now, transactionId);

      this._logAudit(
        transaction.sender_org_id,
        transaction.receiver_org_id,
        completedByDid,
        'transaction_completed',
        { transactionId }
      );

      this.emit('transaction-completed', {
        transactionId,
        senderOrgId: transaction.sender_org_id,
        receiverOrgId: transaction.receiver_org_id
      });

      logger.info(`[B2BExchange] Completed transaction ${transactionId}`);

      return { success: true };
    } catch (error) {
      logger.error('[B2BExchange] Error completing transaction:', error);
      throw error;
    }
  }

  // ========================================
  // Query Operations
  // ========================================

  /**
   * Get transactions for an organization
   */
  async getTransactions(orgId, options = {}) {
    try {
      const db = this.database.getDatabase();

      let query;
      const params = [];

      if (options.direction === 'outgoing') {
        query = `SELECT * FROM b2b_data_transactions WHERE sender_org_id = ?`;
        params.push(orgId);
      } else if (options.direction === 'incoming') {
        query = `SELECT * FROM b2b_data_transactions WHERE receiver_org_id = ?`;
        params.push(orgId);
      } else {
        query = `SELECT * FROM b2b_data_transactions WHERE sender_org_id = ? OR receiver_org_id = ?`;
        params.push(orgId, orgId);
      }

      if (options.status) {
        query += ` AND status = ?`;
        params.push(options.status);
      }

      if (options.transactionType) {
        query += ` AND transaction_type = ?`;
        params.push(options.transactionType);
      }

      if (options.dataType) {
        query += ` AND data_type = ?`;
        params.push(options.dataType);
      }

      if (options.partnerOrgId) {
        query += ` AND (sender_org_id = ? OR receiver_org_id = ?)`;
        params.push(options.partnerOrgId, options.partnerOrgId);
      }

      query += ` ORDER BY created_at DESC`;

      if (options.limit) {
        query += ` LIMIT ?`;
        params.push(options.limit);
      }

      const transactions = db.prepare(query).all(...params);

      return {
        success: true,
        transactions: transactions.map(t => ({
          id: t.id,
          senderOrgId: t.sender_org_id,
          receiverOrgId: t.receiver_org_id,
          transactionType: t.transaction_type,
          dataType: t.data_type,
          dataHash: t.data_hash,
          dataSize: t.data_size,
          encryptionMethod: t.encryption_method,
          status: t.status,
          metadata: t.metadata ? JSON.parse(t.metadata) : null,
          initiatedByDid: t.initiated_by_did,
          createdAt: t.created_at,
          acceptedAt: t.accepted_at,
          completedAt: t.completed_at,
          rejectedAt: t.rejected_at,
          rejectionReason: t.rejection_reason
        }))
      };
    } catch (error) {
      logger.error('[B2BExchange] Error getting transactions:', error);
      throw error;
    }
  }

  /**
   * Verify data integrity
   */
  async verifyDataIntegrity(transactionId, providedHash) {
    try {
      const db = this.database.getDatabase();

      const transaction = db.prepare(`
        SELECT data_hash FROM b2b_data_transactions WHERE id = ?
      `).get(transactionId);

      if (!transaction) {
        return { success: false, error: 'TRANSACTION_NOT_FOUND' };
      }

      const isValid = transaction.data_hash === providedHash;

      return {
        success: true,
        isValid,
        expectedHash: transaction.data_hash,
        providedHash
      };
    } catch (error) {
      logger.error('[B2BExchange] Error verifying data integrity:', error);
      throw error;
    }
  }

  /**
   * Get audit log
   */
  async getAuditLog(orgId, options = {}) {
    try {
      const db = this.database.getDatabase();

      let query = `
        SELECT * FROM cross_org_audit_log
        WHERE source_org_id = ? OR target_org_id = ?
      `;
      const params = [orgId, orgId];

      if (options.action) {
        query += ` AND action = ?`;
        params.push(options.action);
      }

      if (options.partnerOrgId) {
        query += ` AND (source_org_id = ? OR target_org_id = ?)`;
        params.push(options.partnerOrgId, options.partnerOrgId);
      }

      if (options.dateFrom) {
        query += ` AND created_at >= ?`;
        params.push(options.dateFrom);
      }

      if (options.dateTo) {
        query += ` AND created_at <= ?`;
        params.push(options.dateTo);
      }

      query += ` ORDER BY created_at DESC`;

      if (options.limit) {
        query += ` LIMIT ?`;
        params.push(options.limit);
      }

      const logs = db.prepare(query).all(...params);

      return {
        success: true,
        logs: logs.map(l => ({
          id: l.id,
          sourceOrgId: l.source_org_id,
          targetOrgId: l.target_org_id,
          actorDid: l.actor_did,
          action: l.action,
          resourceType: l.resource_type,
          resourceId: l.resource_id,
          details: l.details ? JSON.parse(l.details) : null,
          ipAddress: l.ip_address,
          createdAt: l.created_at
        }))
      };
    } catch (error) {
      logger.error('[B2BExchange] Error getting audit log:', error);
      throw error;
    }
  }

  /**
   * Get transaction statistics
   */
  async getTransactionStats(orgId, _options = {}) {
    try {
      const db = this.database.getDatabase();

      const stats = db.prepare(`
        SELECT
          COUNT(CASE WHEN sender_org_id = ? THEN 1 END) as outgoingCount,
          COUNT(CASE WHEN receiver_org_id = ? THEN 1 END) as incomingCount,
          COUNT(CASE WHEN status = 'completed' THEN 1 END) as completedCount,
          COUNT(CASE WHEN status = 'pending' THEN 1 END) as pendingCount,
          COUNT(CASE WHEN status = 'rejected' THEN 1 END) as rejectedCount,
          SUM(CASE WHEN status = 'completed' THEN data_size ELSE 0 END) as totalDataTransferred
        FROM b2b_data_transactions
        WHERE sender_org_id = ? OR receiver_org_id = ?
      `).get(orgId, orgId, orgId, orgId);

      const byType = db.prepare(`
        SELECT transaction_type, COUNT(*) as count
        FROM b2b_data_transactions
        WHERE sender_org_id = ? OR receiver_org_id = ?
        GROUP BY transaction_type
      `).all(orgId, orgId);

      const byDataType = db.prepare(`
        SELECT data_type, COUNT(*) as count
        FROM b2b_data_transactions
        WHERE sender_org_id = ? OR receiver_org_id = ?
        GROUP BY data_type
      `).all(orgId, orgId);

      return {
        success: true,
        stats: {
          outgoingCount: stats?.outgoingCount || 0,
          incomingCount: stats?.incomingCount || 0,
          completedCount: stats?.completedCount || 0,
          pendingCount: stats?.pendingCount || 0,
          rejectedCount: stats?.rejectedCount || 0,
          totalDataTransferred: stats?.totalDataTransferred || 0,
          byTransactionType: byType.reduce((acc, t) => {
            acc[t.transaction_type] = t.count;
            return acc;
          }, {}),
          byDataType: byDataType.reduce((acc, t) => {
            acc[t.data_type] = t.count;
            return acc;
          }, {})
        }
      };
    } catch (error) {
      logger.error('[B2BExchange] Error getting transaction stats:', error);
      throw error;
    }
  }

  // ========================================
  // Helper Methods
  // ========================================

  _computeHash(data) {
    if (typeof data === 'string') {
      return crypto.createHash('sha256').update(data).digest('hex');
    }
    return crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
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
        'transaction',
        details.transactionId || null,
        JSON.stringify(details),
        now
      );
    } catch (error) {
      logger.error('[B2BExchange] Error logging audit:', error);
    }
  }
}

let b2bExchangeManager = null;

function getB2BExchangeManager(database) {
  if (!b2bExchangeManager && database) {
    b2bExchangeManager = new B2BExchangeManager(database);
  }
  return b2bExchangeManager;
}

module.exports = {
  B2BExchangeManager,
  getB2BExchangeManager
};
