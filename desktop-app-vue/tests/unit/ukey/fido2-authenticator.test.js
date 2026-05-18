/**
 * FIDO2Authenticator Unit Tests
 * Target: src/main/ukey/fido2-authenticator.js
 * Coverage: makeCredential, getAssertion, listCredentials, deleteCredential, constants
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ============================================================
// Mocks
// ============================================================

vi.mock('../../../src/main/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}));

vi.mock('uuid', () => ({
  v4: vi.fn(() => 'test-uuid-' + Math.random().toString(36).substr(2, 9))
}));

describe('FIDO2Authenticator', () => {
  let FIDO2Authenticator, ATTESTATION_TYPES, AUTHENTICATOR_FLAGS;
  let auth;
  let mockDb;
  let mockRunStmt;

  beforeEach(async () => {
    vi.clearAllMocks();

    mockRunStmt = { run: vi.fn() };

    mockDb = {
      db: {
        exec: vi.fn(),
        prepare: vi.fn((sql) => {
          if (sql.includes('INSERT')) return mockRunStmt;
          if (sql.includes('DELETE')) return mockRunStmt;
          if (sql.includes('UPDATE')) return mockRunStmt;
          if (sql.includes('SELECT')) return { get: vi.fn(() => null), all: vi.fn(() => []), run: vi.fn() };
          return { run: vi.fn(), get: vi.fn(() => null), all: vi.fn(() => []) };
        })
      },
      saveToFile: vi.fn()
    };

    const mod = await import('../../../src/main/ukey/fido2-authenticator.js');
    FIDO2Authenticator = mod.FIDO2Authenticator;
    ATTESTATION_TYPES = mod.ATTESTATION_TYPES;
    AUTHENTICATOR_FLAGS = mod.AUTHENTICATOR_FLAGS;

    auth = new FIDO2Authenticator(mockDb);
  });

  afterEach(async () => {
    if (auth) await auth.close();
  });

  // ============================================================
  // Constructor & Init
  // ============================================================

  describe('constructor', () => {
    it('should create instance with database', () => {
      expect(auth.database).toBe(mockDb);
      expect(auth.initialized).toBe(false);
      expect(auth._signCounter).toBe(0);
    });
  });

  describe('initialize()', () => {
    it('should call _ensureTables and set initialized', async () => {
      await auth.initialize();
      expect(auth.initialized).toBe(true);
      expect(mockDb.db.exec).toHaveBeenCalled();
    });
  });

  describe('_ensureTables()', () => {
    it('should create fido2_credentials table', () => {
      auth._ensureTables();
      const execCall = mockDb.db.exec.mock.calls[0][0];
      expect(execCall).toContain('CREATE TABLE IF NOT EXISTS fido2_credentials');
      expect(execCall).toContain('idx_fido2_rp');
      expect(execCall).toContain('idx_fido2_user');
    });

    it('should not throw when database.db is missing', () => {
      const a = new FIDO2Authenticator({});
      a._ensureTables(); // should not throw
    });
  });

  // ============================================================
  // makeCredential
  // ============================================================

  describe('makeCredential()', () => {
    it('should throw on missing rp.id', async () => {
      await expect(auth.makeCredential({ rp: {}, user: { id: 'u1' } }))
        .rejects.toThrow('Relying party ID required');
    });

    it('should throw on missing user.id', async () => {
      await expect(auth.makeCredential({ rp: { id: 'example.com' }, user: {} }))
        .rejects.toThrow('User ID required');
    });

    it('should throw when rp is missing', async () => {
      await expect(auth.makeCredential({ user: { id: 'u1' } }))
        .rejects.toThrow();
    });

    it('should generate EC P-256 key pair and store credential', async () => {
      const result = await auth.makeCredential({
        rp: { id: 'example.com', name: 'Example' },
        user: { id: 'user1', name: 'alice', displayName: 'Alice' },
        challenge: 'test-challenge'
      });

      expect(result.type).toBe('public-key');
      expect(result.id).toBeDefined();
      expect(result.rawId).toBe(result.id);
      expect(result.response.clientDataJSON).toBeDefined();
      expect(result.response.attestationObject).toBeDefined();
      expect(result.authenticatorAttachment).toBe('platform');
      expect(mockRunStmt.run).toHaveBeenCalled();
      expect(mockDb.saveToFile).toHaveBeenCalled();
    });

    it('should return proper attestation response with clientDataJSON', async () => {
      const result = await auth.makeCredential({
        rp: { id: 'example.com' },
        user: { id: 'user1', name: 'alice' },
        challenge: 'abc123'
      });

      const clientData = JSON.parse(Buffer.from(result.response.clientDataJSON, 'base64url').toString());
      expect(clientData.type).toBe('webauthn.create');
      expect(clientData.challenge).toBe('abc123');
      expect(clientData.origin).toBe('https://example.com');
    });

    it('should emit credential:created event', async () => {
      const spy = vi.fn();
      auth.on('credential:created', spy);

      await auth.makeCredential({
        rp: { id: 'example.com' },
        user: { id: 'user1' }
      });

      expect(spy).toHaveBeenCalledWith(expect.objectContaining({
        rpId: 'example.com',
        credentialId: expect.any(String)
      }));
    });
  });

  // ============================================================
  // getAssertion
  // ============================================================

  describe('getAssertion()', () => {
    // Generate a real EC P-256 key pair for signing
    let testPrivateKeyPem;

    beforeEach(async () => {
      const crypto = await import('crypto');
      const { privateKey } = crypto.generateKeyPairSync('ec', {
        namedCurve: 'P-256',
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
      });
      testPrivateKeyPem = privateKey;
    });

    it('should throw on missing rpId', async () => {
      await expect(auth.getAssertion({})).rejects.toThrow('Relying party ID required');
    });

    it('should throw when no matching credential found', async () => {
      mockDb.db.prepare = vi.fn(() => ({
        get: vi.fn(() => null), all: vi.fn(() => []), run: vi.fn()
      }));

      await expect(auth.getAssertion({ rpId: 'example.com' }))
        .rejects.toThrow('No matching credential found');
    });

    it('should increment sign counter', async () => {
      const credRow = {
        id: 'c1', credential_id: 'cred-abc', rp_id: 'example.com',
        user_id: 'user1', sign_count: 5, private_key: testPrivateKeyPem
      };

      const updateRun = vi.fn();
      mockDb.db.prepare = vi.fn((sql) => {
        if (sql.includes('UPDATE')) return { run: updateRun };
        return { get: vi.fn(() => credRow), all: vi.fn(() => []), run: vi.fn() };
      });

      await auth.getAssertion({ rpId: 'example.com' });
      expect(updateRun).toHaveBeenCalledWith(6, expect.any(Number), 'c1');
    });

    it('should return proper assertion with signature', async () => {
      const credRow = {
        id: 'c1', credential_id: 'cred-abc', rp_id: 'example.com',
        user_id: 'user1', sign_count: 0, private_key: testPrivateKeyPem
      };

      mockDb.db.prepare = vi.fn((sql) => {
        if (sql.includes('UPDATE')) return { run: vi.fn() };
        return { get: vi.fn(() => credRow), all: vi.fn(() => []), run: vi.fn() };
      });

      const result = await auth.getAssertion({
        rpId: 'example.com',
        challenge: 'test-challenge'
      });

      expect(result.type).toBe('public-key');
      expect(result.id).toBe('cred-abc');
      expect(result.response.authenticatorData).toBeDefined();
      expect(result.response.signature).toBeDefined();
      expect(result.response.userHandle).toBe('user1');

      // Verify clientDataJSON
      const clientData = JSON.parse(Buffer.from(result.response.clientDataJSON, 'base64url').toString());
      expect(clientData.type).toBe('webauthn.get');
    });

    it('should emit assertion:created event', async () => {
      const credRow = {
        id: 'c1', credential_id: 'cred-abc', rp_id: 'example.com',
        user_id: 'user1', sign_count: 0, private_key: testPrivateKeyPem
      };

      mockDb.db.prepare = vi.fn((sql) => {
        if (sql.includes('UPDATE')) return { run: vi.fn() };
        return { get: vi.fn(() => credRow), all: vi.fn(() => []), run: vi.fn() };
      });

      const spy = vi.fn();
      auth.on('assertion:created', spy);

      await auth.getAssertion({ rpId: 'example.com' });
      expect(spy).toHaveBeenCalledWith(expect.objectContaining({
        credentialId: 'cred-abc',
        rpId: 'example.com'
      }));
    });
  });

  // ============================================================
  // listCredentials
  // ============================================================

  describe('listCredentials()', () => {
    it('should return all credentials', async () => {
      const mockCreds = [{ id: 'c1', credential_id: 'cred-1' }];
      mockDb.db.prepare = vi.fn(() => ({
        all: vi.fn(() => mockCreds), get: vi.fn(() => null), run: vi.fn()
      }));

      const result = await auth.listCredentials();
      expect(result).toEqual(mockCreds);
    });

    it('should filter by rpId when specified', async () => {
      mockDb.db.prepare = vi.fn(() => ({
        all: vi.fn(() => []), get: vi.fn(() => null), run: vi.fn()
      }));

      await auth.listCredentials({ rpId: 'example.com' });
      expect(mockDb.db.prepare).toHaveBeenCalledWith(expect.stringContaining('WHERE rp_id = ?'));
    });

    it('should return empty array when no database', async () => {
      const a = new FIDO2Authenticator(null);
      const result = await a.listCredentials();
      expect(result).toEqual([]);
    });
  });

  // ============================================================
  // deleteCredential
  // ============================================================

  describe('deleteCredential()', () => {
    it('should remove credential from DB', async () => {
      const result = await auth.deleteCredential('cred-abc');
      expect(result.success).toBe(true);
      expect(mockDb.saveToFile).toHaveBeenCalled();
    });
  });

  // ============================================================
  // Constants
  // ============================================================

  describe('constants', () => {
    it('ATTESTATION_TYPES should have NONE, SELF, PACKED', () => {
      expect(ATTESTATION_TYPES.NONE).toBe('none');
      expect(ATTESTATION_TYPES.SELF).toBe('self');
      expect(ATTESTATION_TYPES.PACKED).toBe('packed');
    });

    it('AUTHENTICATOR_FLAGS should have UP, UV, AT, ED', () => {
      expect(AUTHENTICATOR_FLAGS.UP).toBe(0x01);
      expect(AUTHENTICATOR_FLAGS.UV).toBe(0x04);
      expect(AUTHENTICATOR_FLAGS.AT).toBe(0x40);
      expect(AUTHENTICATOR_FLAGS.ED).toBe(0x80);
    });
  });
});
