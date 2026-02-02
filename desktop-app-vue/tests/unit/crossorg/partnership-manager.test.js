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
            data.partnerships.push({
              id: args[0],
              initiator_org_id: args[1],
              initiator_org_name: args[2],
              partner_org_id: args[3],
              partner_org_name: args[4],
              partnership_type: args[5],
              trust_level: args[6],
              status: args[7]
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

    it('should reject self-partnership', async () => {
      const data = {
        initiatorOrgId: 'org-1',
        initiatorOrgName: 'Org One',
        partnerOrgId: 'org-1',
        partnerOrgName: 'Org One',
        partnershipType: 'collaboration'
      };

      const result = await manager.createPartnership(data);

      expect(result.success).toBe(false);
      expect(result.error).toBe('CANNOT_PARTNER_WITH_SELF');
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
    it('should validate trust levels', () => {
      const validLevels = ['minimal', 'standard', 'elevated', 'full'];
      validLevels.forEach(level => {
        expect(manager._isValidTrustLevel(level)).toBe(true);
      });
      expect(manager._isValidTrustLevel('invalid')).toBe(false);
    });
  });
});
