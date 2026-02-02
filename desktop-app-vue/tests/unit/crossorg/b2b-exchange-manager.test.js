/**
 * B2B Exchange Manager Unit Tests
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { B2BExchangeManager } from '../../../src/main/crossorg/b2b-exchange-manager.js';

// Mock database
const createMockDatabase = () => {
  const data = {
    transactions: [],
    partnerships: [
      { id: 'p-1', initiator_org_id: 'org-1', partner_org_id: 'org-2', status: 'active', trust_level: 'standard' }
    ],
    auditLogs: []
  };

  return {
    getDatabase: () => ({
      prepare: (sql) => ({
        run: vi.fn((...args) => {
          if (sql.includes('INSERT INTO b2b_data_transactions')) {
            data.transactions.push({
              id: args[0],
              sender_org_id: args[1],
              receiver_org_id: args[2],
              transaction_type: args[3],
              data_type: args[4],
              data_size: args[5],
              data_hash: args[6],
              notes: args[7],
              initiated_by_did: args[8],
              status: 'pending'
            });
            return { changes: 1 };
          }
          if (sql.includes('UPDATE b2b_data_transactions')) {
            const txId = sql.includes('WHERE id = ?') ? args[args.length - 1] : args[0];
            const tx = data.transactions.find(t => t.id === txId);
            if (tx) {
              if (sql.includes("status = 'accepted'")) tx.status = 'accepted';
              if (sql.includes("status = 'rejected'")) tx.status = 'rejected';
              if (sql.includes("status = 'completed'")) tx.status = 'completed';
            }
            return { changes: 1 };
          }
          if (sql.includes('INSERT INTO cross_org_audit_log')) {
            data.auditLogs.push({
              id: args[0],
              source_org_id: args[1],
              target_org_id: args[2],
              actor_did: args[3],
              action: args[4],
              resource_type: args[5],
              resource_id: args[6],
              details: args[7]
            });
            return { changes: 1 };
          }
          return { changes: 0 };
        }),
        get: vi.fn((...args) => {
          if (sql.includes('SELECT * FROM b2b_data_transactions WHERE id')) {
            return data.transactions.find(t => t.id === args[0]);
          }
          if (sql.includes('SELECT id FROM org_partnerships')) {
            return data.partnerships.find(p =>
              (p.initiator_org_id === args[0] && p.partner_org_id === args[1]) ||
              (p.initiator_org_id === args[2] && p.partner_org_id === args[3])
            );
          }
          if (sql.includes('SELECT') && sql.includes('COUNT')) {
            return {
              outgoingCount: data.transactions.filter(t => t.sender_org_id === args[0]).length,
              incomingCount: data.transactions.filter(t => t.receiver_org_id === args[1]).length,
              completedCount: data.transactions.filter(t => t.status === 'completed').length,
              pendingCount: data.transactions.filter(t => t.status === 'pending').length,
              totalDataSize: 1000
            };
          }
          return null;
        }),
        all: vi.fn((...args) => {
          if (sql.includes('SELECT * FROM b2b_data_transactions WHERE')) {
            return data.transactions.filter(t =>
              t.sender_org_id === args[0] || t.receiver_org_id === args[0]
            );
          }
          if (sql.includes('SELECT * FROM cross_org_audit_log')) {
            return data.auditLogs;
          }
          return [];
        })
      })
    }),
    data
  };
};

describe('B2BExchangeManager Unit Tests', () => {
  let manager;
  let mockDb;

  beforeEach(() => {
    mockDb = createMockDatabase();
    manager = new B2BExchangeManager(mockDb);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Initialization', () => {
    it('should initialize B2B exchange manager', () => {
      expect(manager).toBeDefined();
      expect(manager.database).toBe(mockDb);
    });
  });

  describe('initiateTransaction', () => {
    it('should initiate a new transaction', async () => {
      const data = {
        senderOrgId: 'org-1',
        receiverOrgId: 'org-2',
        transactionType: 'data_transfer',
        dataType: 'customer_data',
        dataSize: 1024,
        dataHash: 'sha256:abc123',
        notes: 'Test transaction',
        initiatedByDid: 'did:example:user1'
      };

      const result = await manager.initiateTransaction(data);

      expect(result.success).toBe(true);
      expect(result.transactionId).toBeDefined();
      expect(mockDb.data.transactions.length).toBe(1);
      expect(mockDb.data.transactions[0].status).toBe('pending');
    });

    it('should reject self-transaction', async () => {
      const data = {
        senderOrgId: 'org-1',
        receiverOrgId: 'org-1',
        transactionType: 'data_transfer',
        dataType: 'customer_data'
      };

      const result = await manager.initiateTransaction(data);

      expect(result.success).toBe(false);
      expect(result.error).toBe('CANNOT_TRANSACT_WITH_SELF');
    });
  });

  describe('acceptTransaction', () => {
    it('should accept a pending transaction', async () => {
      // First initiate a transaction
      const initResult = await manager.initiateTransaction({
        senderOrgId: 'org-1',
        receiverOrgId: 'org-2',
        transactionType: 'data_transfer',
        dataType: 'customer_data',
        dataSize: 1024,
        dataHash: 'sha256:abc123',
        initiatedByDid: 'did:example:user1'
      });

      const result = await manager.acceptTransaction(
        initResult.transactionId,
        'did:example:user2'
      );

      expect(result.success).toBe(true);
    });
  });

  describe('rejectTransaction', () => {
    it('should reject a pending transaction', async () => {
      // First initiate a transaction
      const initResult = await manager.initiateTransaction({
        senderOrgId: 'org-1',
        receiverOrgId: 'org-2',
        transactionType: 'data_transfer',
        dataType: 'customer_data',
        dataSize: 1024,
        dataHash: 'sha256:abc123',
        initiatedByDid: 'did:example:user1'
      });

      const result = await manager.rejectTransaction(
        initResult.transactionId,
        'did:example:user2',
        'Not needed'
      );

      expect(result.success).toBe(true);
    });
  });

  describe('getTransactions', () => {
    it('should return transactions for an organization', async () => {
      // Create some transactions
      await manager.initiateTransaction({
        senderOrgId: 'org-1',
        receiverOrgId: 'org-2',
        transactionType: 'data_transfer',
        dataType: 'customer_data',
        dataSize: 1024,
        dataHash: 'sha256:abc123',
        initiatedByDid: 'did:example:user1'
      });

      const result = await manager.getTransactions('org-1');

      expect(result.success).toBe(true);
      expect(Array.isArray(result.transactions)).toBe(true);
    });
  });

  describe('verifyDataIntegrity', () => {
    it('should verify data integrity with matching hash', async () => {
      const expectedHash = 'sha256:abc123';
      const result = await manager.verifyDataIntegrity('tx-1', expectedHash);

      expect(result.success).toBe(true);
      expect(result.verified).toBe(true);
    });
  });

  describe('getAuditLog', () => {
    it('should return audit log for an organization', async () => {
      const result = await manager.getAuditLog('org-1');

      expect(result.success).toBe(true);
      expect(Array.isArray(result.auditLogs)).toBe(true);
    });
  });

  describe('getTransactionStats', () => {
    it('should return transaction statistics', async () => {
      // Create some transactions first
      await manager.initiateTransaction({
        senderOrgId: 'org-1',
        receiverOrgId: 'org-2',
        transactionType: 'data_transfer',
        dataType: 'customer_data',
        dataSize: 1024,
        dataHash: 'sha256:abc123',
        initiatedByDid: 'did:example:user1'
      });

      const result = await manager.getTransactionStats('org-1');

      expect(result.success).toBe(true);
      expect(result.stats).toBeDefined();
      expect(typeof result.stats.outgoingCount).toBe('number');
      expect(typeof result.stats.incomingCount).toBe('number');
    });
  });
});
