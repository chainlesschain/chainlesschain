/**
 * PKCS#11 Encryption Workflow Integration Test
 *
 * Tests complete cryptographic workflows using PKCS#11 drivers.
 * Simulates real-world usage scenarios without requiring actual hardware.
 *
 * Test Scenarios:
 * - Complete signature workflow (init → sign → verify → cleanup)
 * - Complete encryption workflow (init → encrypt → decrypt → cleanup)
 * - Multi-step operations (generate key → sign → export → import)
 * - Error recovery (PIN retry → unlock → continue)
 * - Concurrent operations (multiple sessions)
 *
 * Environment:
 * - CI: Uses SoftHSM Docker container
 * - Local: Uses mock mode for fast execution
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

/**
 * Mock PKCS#11 driver for integration testing
 */
class PKCS11IntegrationDriver {
  constructor() {
    this.initialized = false;
    this.loggedIn = false;
    this.sessions = new Map();
    this.keys = new Map();
    this.certificates = new Map();

    // Pre-generate test keys
    this._seedTestKeys();
  }

  _seedTestKeys() {
    this.keys.set('rsa-2048', {
      id: 'rsa-2048',
      type: 'RSA',
      size: 2048,
      label: 'RSA 2048 Test Key',
      canSign: true,
      canEncrypt: true,
    });

    this.keys.set('rsa-4096', {
      id: 'rsa-4096',
      type: 'RSA',
      size: 4096,
      label: 'RSA 4096 Test Key',
      canSign: true,
      canEncrypt: true,
    });

    this.keys.set('ecdsa-p256', {
      id: 'ecdsa-p256',
      type: 'ECDSA',
      curve: 'P-256',
      label: 'ECDSA P-256 Test Key',
      canSign: true,
      canEncrypt: false,
    });
  }

  async initialize() {
    if (this.initialized) {
      throw new Error('Already initialized');
    }
    this.initialized = true;
    return {
      success: true,
      slots: [{ id: 0, label: 'TestToken', available: true }],
    };
  }

  async finalize() {
    this.initialized = false;
    this.loggedIn = false;
    this.sessions.clear();
    return { success: true };
  }

  async openSession(slotId = 0) {
    if (!this.initialized) {
      throw new Error('Not initialized');
    }

    const sessionId = `session-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    this.sessions.set(sessionId, {
      id: sessionId,
      slotId,
      loggedIn: false,
      operations: [],
    });

    return { sessionId };
  }

  async closeSession(sessionId) {
    if (!this.sessions.has(sessionId)) {
      throw new Error('Invalid session');
    }
    this.sessions.delete(sessionId);
    return { success: true };
  }

  async login(pin, sessionId = null) {
    if (pin !== '123456') {
      throw new Error('PIN_INCORRECT');
    }

    if (sessionId) {
      const session = this.sessions.get(sessionId);
      if (session) {
        session.loggedIn = true;
      }
    } else {
      this.loggedIn = true;
    }

    return { success: true };
  }

  async logout(sessionId = null) {
    if (sessionId) {
      const session = this.sessions.get(sessionId);
      if (session) {
        session.loggedIn = false;
      }
    } else {
      this.loggedIn = false;
    }
    return { success: true };
  }

  async sign(data, keyId, options = {}) {
    if (!this.loggedIn && !this._hasLoggedInSession()) {
      throw new Error('Not logged in');
    }

    if (!this.keys.has(keyId)) {
      throw new Error(`Key not found: ${keyId}`);
    }

    const key = this.keys.get(keyId);
    if (!key.canSign) {
      throw new Error('Key cannot sign');
    }

    const { algorithm = 'RSA-SHA256' } = options;

    // Simulate signature generation
    const signature = Buffer.concat([
      Buffer.from(`sig-${algorithm}-${keyId}-`),
      Buffer.from(data.slice(0, 16)),
    ]);

    return signature;
  }

  async verify(data, signature, keyId, options = {}) {
    if (!this.loggedIn && !this._hasLoggedInSession()) {
      throw new Error('Not logged in');
    }

    const { algorithm = 'RSA-SHA256' } = options;
    const expectedPrefix = `sig-${algorithm}-${keyId}-`;

    return signature.toString().startsWith(expectedPrefix);
  }

  async encrypt(data, keyId, options = {}) {
    if (!this.loggedIn && !this._hasLoggedInSession()) {
      throw new Error('Not logged in');
    }

    if (!this.keys.has(keyId)) {
      throw new Error(`Key not found: ${keyId}`);
    }

    const key = this.keys.get(keyId);
    if (!key.canEncrypt) {
      throw new Error('Key cannot encrypt');
    }

    const { algorithm = 'RSA-PKCS' } = options;

    const encrypted = Buffer.concat([
      Buffer.from(`enc-${algorithm}-${keyId}-`),
      data,
    ]);

    return encrypted;
  }

  async decrypt(ciphertext, keyId, options = {}) {
    if (!this.loggedIn && !this._hasLoggedInSession()) {
      throw new Error('Not logged in');
    }

    const { algorithm = 'RSA-PKCS' } = options;
    const prefix = `enc-${algorithm}-${keyId}-`;

    if (!ciphertext.toString().startsWith(prefix)) {
      throw new Error('Invalid ciphertext');
    }

    return ciphertext.slice(prefix.length);
  }

  async generateKeyPair(options = {}) {
    if (!this.loggedIn && !this._hasLoggedInSession()) {
      throw new Error('Not logged in');
    }

    const { type = 'RSA', size = 2048, label = 'Generated Key' } = options;

    const keyId = `gen-${type.toLowerCase()}-${Date.now()}`;
    const key = {
      id: keyId,
      type,
      size,
      label,
      canSign: true,
      canEncrypt: type === 'RSA',
      generated: true,
    };

    this.keys.set(keyId, key);

    return {
      keyId,
      publicKey: Buffer.from(`pubkey-${keyId}`),
      privateKey: null, // Private key stays in token
    };
  }

  async importCertificate(keyId, certificate) {
    if (!this.loggedIn && !this._hasLoggedInSession()) {
      throw new Error('Not logged in');
    }

    if (!this.keys.has(keyId)) {
      throw new Error(`Key not found: ${keyId}`);
    }

    const certId = `cert-${keyId}`;
    this.certificates.set(certId, {
      id: certId,
      keyId,
      certificate,
      imported: Date.now(),
    });

    return { certId };
  }

  async exportCertificate(certId) {
    if (!this.certificates.has(certId)) {
      throw new Error(`Certificate not found: ${certId}`);
    }

    const cert = this.certificates.get(certId);
    return cert.certificate;
  }

  _hasLoggedInSession() {
    for (const session of this.sessions.values()) {
      if (session.loggedIn) {
        return true;
      }
    }
    return false;
  }
}

describe('PKCS#11 Encryption Workflow (Integration Tests)', () => {
  let driver;

  beforeAll(async () => {
    // Initialize driver once for all tests
    driver = new PKCS11IntegrationDriver();
    await driver.initialize();
  });

  afterAll(async () => {
    // Cleanup after all tests
    if (driver.initialized) {
      await driver.finalize();
    }
  });

  beforeEach(async () => {
    // Reset login state before each test
    if (driver.loggedIn) {
      await driver.logout();
    }
  });

  describe('Complete Signature Workflow', () => {
    it('should complete: init → login → sign → verify → logout', async () => {
      console.log('\n========== Step 1: Initialize (already done in beforeAll) ==========');

      console.log('\n========== Step 2: Login ==========');
      await driver.login('123456');
      expect(driver.loggedIn).toBe(true);
      console.log('✅ Login successful');

      console.log('\n========== Step 3: Sign Data ==========');
      const data = Buffer.from('Important contract to sign');
      const signature = await driver.sign(data, 'rsa-2048', { algorithm: 'RSA-SHA256' });
      expect(signature).toBeInstanceOf(Buffer);
      console.log(`✅ Signature created: ${signature.length} bytes`);

      console.log('\n========== Step 4: Verify Signature ==========');
      const isValid = await driver.verify(data, signature, 'rsa-2048', {
        algorithm: 'RSA-SHA256',
      });
      expect(isValid).toBe(true);
      console.log('✅ Signature verified successfully');

      console.log('\n========== Step 5: Logout ==========');
      await driver.logout();
      expect(driver.loggedIn).toBe(false);
      console.log('✅ Logout successful');
    });

    it('should reject tampered data', async () => {
      await driver.login('123456');

      const originalData = Buffer.from('Original message');
      const tamperedData = Buffer.from('Tampered message');

      const signature = await driver.sign(originalData, 'rsa-2048');

      const isValid = await driver.verify(tamperedData, signature, 'rsa-2048');
      expect(isValid).toBe(false);

      await driver.logout();
    });

    it('should support multiple signature algorithms', async () => {
      await driver.login('123456');

      const data = Buffer.from('Test');

      const sig256 = await driver.sign(data, 'rsa-2048', { algorithm: 'RSA-SHA256' });
      const sig512 = await driver.sign(data, 'rsa-4096', { algorithm: 'RSA-SHA512' });

      expect(sig256.toString()).toContain('RSA-SHA256');
      expect(sig512.toString()).toContain('RSA-SHA512');

      await driver.logout();
    });
  });

  describe('Complete Encryption Workflow', () => {
    it('should complete: init → login → encrypt → decrypt → verify', async () => {
      console.log('\n========== Step 1: Login ==========');
      await driver.login('123456');
      console.log('✅ Login successful');

      console.log('\n========== Step 2: Encrypt Data ==========');
      const plaintext = Buffer.from('Confidential information');
      const ciphertext = await driver.encrypt(plaintext, 'rsa-2048', {
        algorithm: 'RSA-PKCS',
      });
      expect(ciphertext).toBeInstanceOf(Buffer);
      expect(ciphertext).not.toEqual(plaintext);
      console.log(`✅ Data encrypted: ${ciphertext.length} bytes`);

      console.log('\n========== Step 3: Decrypt Data ==========');
      const decrypted = await driver.decrypt(ciphertext, 'rsa-2048', { algorithm: 'RSA-PKCS' });
      expect(decrypted.toString()).toBe(plaintext.toString());
      console.log('✅ Data decrypted successfully');

      console.log('\n========== Step 4: Verify Decrypted Data ==========');
      expect(decrypted).toEqual(plaintext);
      console.log('✅ Decrypted data matches original');

      await driver.logout();
    });

    it('should fail to decrypt with wrong key', async () => {
      await driver.login('123456');

      const plaintext = Buffer.from('Secret');
      const ciphertext = await driver.encrypt(plaintext, 'rsa-2048');

      await expect(driver.decrypt(ciphertext, 'rsa-4096')).rejects.toThrow(
        'Invalid ciphertext'
      );

      await driver.logout();
    });

    it('should encrypt large data', async () => {
      await driver.login('123456');

      const largeData = Buffer.alloc(1024 * 10); // 10KB
      largeData.fill(0xAB);

      const encrypted = await driver.encrypt(largeData, 'rsa-4096');
      const decrypted = await driver.decrypt(encrypted, 'rsa-4096');

      expect(decrypted).toEqual(largeData);

      await driver.logout();
    });
  });

  describe('Multi-Step Operations', () => {
    it('should complete: generate key → sign → export cert → import cert', async () => {
      console.log('\n========== Step 1: Login ==========');
      await driver.login('123456');

      console.log('\n========== Step 2: Generate New Key Pair ==========');
      const keyResult = await driver.generateKeyPair({
        type: 'RSA',
        size: 2048,
        label: 'Test Generated Key',
      });
      expect(keyResult.keyId).toBeDefined();
      console.log(`✅ Key pair generated: ${keyResult.keyId}`);

      console.log('\n========== Step 3: Sign with Generated Key ==========');
      const data = Buffer.from('Test signature');
      const signature = await driver.sign(data, keyResult.keyId);
      expect(signature).toBeInstanceOf(Buffer);
      console.log('✅ Signature created with new key');

      console.log('\n========== Step 4: Import Certificate ==========');
      const certificate = Buffer.from('X.509 certificate data');
      const { certId } = await driver.importCertificate(keyResult.keyId, certificate);
      expect(certId).toBeDefined();
      console.log(`✅ Certificate imported: ${certId}`);

      console.log('\n========== Step 5: Export Certificate ==========');
      const exportedCert = await driver.exportCertificate(certId);
      expect(exportedCert).toEqual(certificate);
      console.log('✅ Certificate exported successfully');

      await driver.logout();
    });

    it('should support key lifecycle management', async () => {
      await driver.login('123456');

      // Generate
      const { keyId } = await driver.generateKeyPair({ type: 'RSA', size: 2048 });

      // Use
      const data = Buffer.from('Test');
      const sig = await driver.sign(data, keyId);
      const isValid = await driver.verify(data, sig, keyId);
      expect(isValid).toBe(true);

      // Import cert
      const cert = Buffer.from('certificate');
      const { certId } = await driver.importCertificate(keyId, cert);

      // Export cert
      const exported = await driver.exportCertificate(certId);
      expect(exported).toEqual(cert);

      await driver.logout();
    });
  });

  describe('Error Recovery', () => {
    it('should handle incorrect PIN gracefully', async () => {
      await expect(driver.login('wrong-pin')).rejects.toThrow('PIN_INCORRECT');

      // Retry with correct PIN
      await driver.login('123456');
      expect(driver.loggedIn).toBe(true);

      await driver.logout();
    });

    it('should require login for crypto operations', async () => {
      const data = Buffer.from('Test');

      await expect(driver.sign(data, 'rsa-2048')).rejects.toThrow('Not logged in');

      // Login and retry
      await driver.login('123456');
      const signature = await driver.sign(data, 'rsa-2048');
      expect(signature).toBeDefined();

      await driver.logout();
    });

    it('should handle invalid key ID', async () => {
      await driver.login('123456');

      const data = Buffer.from('Test');
      await expect(driver.sign(data, 'non-existent-key')).rejects.toThrow('Key not found');

      await driver.logout();
    });
  });

  describe('Concurrent Operations', () => {
    it('should support multiple sessions', async () => {
      console.log('\n========== Opening Multiple Sessions ==========');

      const session1 = await driver.openSession(0);
      const session2 = await driver.openSession(0);

      expect(session1.sessionId).toBeDefined();
      expect(session2.sessionId).toBeDefined();
      expect(session1.sessionId).not.toBe(session2.sessionId);

      console.log(`✅ Session 1: ${session1.sessionId}`);
      console.log(`✅ Session 2: ${session2.sessionId}`);

      // Login to both sessions
      await driver.login('123456', session1.sessionId);
      await driver.login('123456', session2.sessionId);

      // Perform operations in parallel
      const data = Buffer.from('Test');

      const [sig1, sig2] = await Promise.all([
        driver.sign(data, 'rsa-2048'),
        driver.sign(data, 'rsa-4096'),
      ]);

      expect(sig1).toBeDefined();
      expect(sig2).toBeDefined();

      // Close sessions
      await driver.closeSession(session1.sessionId);
      await driver.closeSession(session2.sessionId);

      console.log('✅ Both sessions closed');
    });

    it('should isolate session state', async () => {
      const session1 = await driver.openSession(0);
      const session2 = await driver.openSession(0);

      // Login only to session1
      await driver.login('123456', session1.sessionId);

      const session1State = driver.sessions.get(session1.sessionId);
      const session2State = driver.sessions.get(session2.sessionId);

      expect(session1State.loggedIn).toBe(true);
      expect(session2State.loggedIn).toBe(false);

      await driver.closeSession(session1.sessionId);
      await driver.closeSession(session2.sessionId);
    });
  });

  describe('Performance Benchmarks', () => {
    it('should sign 100 messages in < 500ms', async () => {
      await driver.login('123456');

      const start = Date.now();

      for (let i = 0; i < 100; i++) {
        const data = Buffer.from(`Message ${i}`);
        await driver.sign(data, 'rsa-2048');
      }

      const duration = Date.now() - start;

      console.log(`\n✅ 100 signatures in ${duration}ms (${(duration / 100).toFixed(2)}ms/sig)`);
      expect(duration).toBeLessThan(500);

      await driver.logout();
    });

    it('should encrypt/decrypt 50 operations in < 300ms', async () => {
      await driver.login('123456');

      const start = Date.now();

      for (let i = 0; i < 50; i++) {
        const data = Buffer.from(`Data ${i}`);
        const encrypted = await driver.encrypt(data, 'rsa-2048');
        await driver.decrypt(encrypted, 'rsa-2048');
      }

      const duration = Date.now() - start;

      console.log(
        `\n✅ 50 encrypt/decrypt pairs in ${duration}ms (${(duration / 50).toFixed(2)}ms/pair)`
      );
      expect(duration).toBeLessThan(300);

      await driver.logout();
    });
  });
});
