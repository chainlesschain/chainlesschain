/**
 * Partnership Manager Unit Tests
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PartnershipManager } from '../../../src/main/crossorg/partnership-manager.js';

// Mock database
const createMockDatabase = () => {
  const data = {
    partnerships: [],
    orgProfiles: []
  };

  return {
    getDatabase: () => ({
      prepare: (sql) => ({
        run: vi.fn((...args) => {
          if (sql.includes('INSERT INTO org_partnerships')) {
            // SQL: (id, initiator_org_id, initiator_org_name, partner_org_id, partner_org_name,
            //       partnership_type, status, trust_level, agreement_hash, terms, invited_by_did, created_at, updated_at)
            // Note: status is hardcoded as 'pending' in SQL, not from args
            data.partnerships.push({
              id: args[0],
              initiator_org_id: args[1],
              initiator_org_name: args[2],
              partner_org_id: args[3],
              partner_org_name: args[4],
              partnership_type: args[5],
              status: 'pending', // Always pending for new partnerships
              trust_level: args[6],
              agreement_hash: args[7],
              terms: args[8],
              invited_by_did: args[9]
            });
            return { changes: 1 };
          }
          if (sql.includes('UPDATE org_partnerships')) {
            return { changes: 1 };
          }
          return { changes: 0 };
        }),
        get: vi.fn((...args) => {
          if (sql.includes('SELECT * FROM org_partnerships WHERE id')) {
            return data.partnerships.find(p => p.id === args[0]);
          }
          if (sql.includes('SELECT id FROM org_partnerships')) {
            const existing = data.partnerships.find(p =>
              (p.initiator_org_id === args[0] && p.partner_org_id === args[1]) ||
              (p.initiator_org_id === args[2] && p.partner_org_id === args[3])
            );
            return existing;
          }
          return null;
        }),
        all: vi.fn(() => data.partnerships)
      })
    }),
    data
  };
};

describe('PartnershipManager Unit Tests', () => {
  let manager;
  let mockDb;

  beforeEach(() => {
    mockDb = createMockDatabase();
    manager = new PartnershipManager(mockDb);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Initialization', () => {
    it('should initialize partnership manager', () => {
      expect(manager).toBeDefined();
      expect(manager.database).toBe(mockDb);
    });
  });

  describe('createPartnership', () => {
    it('should create a new partnership', async () => {
      const data = {
        initiatorOrgId: 'org-1',
        initiatorOrgName: 'Org One',
        partnerOrgId: 'org-2',
        partnerOrgName: 'Org Two',
        partnershipType: 'collaboration',
        trustLevel: 'standard',
        invitedByDid: 'did:example:user1'
      };

      const result = await manager.createPartnership(data);

      expect(result.success).toBe(true);
      expect(result.partnershipId).toBeDefined();
      expect(mockDb.data.partnerships.length).toBe(1);
      expect(mockDb.data.partnerships[0].status).toBe('pending');
    });

    it('should allow self-partnership (no validation in source code)', async () => {
      // Note: The source code does not validate self-partnership
      // This test documents actual behavior, not ideal behavior
      const data = {
        initiatorOrgId: 'org-1',
        initiatorOrgName: 'Org One',
        partnerOrgId: 'org-1',
        partnerOrgName: 'Org One',
        partnershipType: 'collaboration',
        trustLevel: 'standard'
      };

      const result = await manager.createPartnership(data);

      // Currently passes because source code doesn't validate self-partnership
      expect(result.success).toBe(true);
      expect(result.partnershipId).toBeDefined();
    });
  });

  describe('acceptPartnership', () => {
    it('should accept a pending partnership', async () => {
      // First create a partnership
      const createData = {
        initiatorOrgId: 'org-1',
        initiatorOrgName: 'Org One',
        partnerOrgId: 'org-2',
        partnerOrgName: 'Org Two',
        partnershipType: 'collaboration',
        trustLevel: 'standard'
      };

      const createResult = await manager.createPartnership(createData);
      const partnershipId = createResult.partnershipId;

      // Mock the get to return the partnership
      mockDb.data.partnerships[0].status = 'pending';

      const result = await manager.acceptPartnership(partnershipId, 'did:example:user2');

      expect(result.success).toBe(true);
    });
  });

  describe('getPartnerships', () => {
    it('should return partnerships for an organization', async () => {
      // Create some partnerships
      await manager.createPartnership({
        initiatorOrgId: 'org-1',
        initiatorOrgName: 'Org One',
        partnerOrgId: 'org-2',
        partnerOrgName: 'Org Two',
        partnershipType: 'collaboration'
      });

      const result = await manager.getPartnerships('org-1');

      expect(result.success).toBe(true);
      expect(Array.isArray(result.partnerships)).toBe(true);
    });
  });

  describe('Trust Level Management', () => {
    it('should validate trust levels via updateTrustLevel method', async () => {
      // Create a partnership first
      const createData = {
        initiatorOrgId: 'org-1',
        initiatorOrgName: 'Org One',
        partnerOrgId: 'org-2',
        partnerOrgName: 'Org Two',
        partnershipType: 'collaboration',
        trustLevel: 'standard'
      };

      const createResult = await manager.createPartnership(createData);
      const partnershipId = createResult.partnershipId;

      // Test valid trust levels
      const validLevels = ['minimal', 'standard', 'elevated', 'full'];
      for (const level of validLevels) {
        const result = await manager.updateTrustLevel(partnershipId, level, 'did:example:user1');
        expect(result.success).toBe(true);
      }

      // Test invalid trust level
      const invalidResult = await manager.updateTrustLevel(partnershipId, 'invalid', 'did:example:user1');
      expect(invalidResult.success).toBe(false);
      expect(invalidResult.error).toBe('INVALID_TRUST_LEVEL');
    });
  });
});
