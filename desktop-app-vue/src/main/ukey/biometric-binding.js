'use strict';

const EventEmitter = require('events');
const crypto = require('crypto');
const { logger } = require('../utils/logger');

/**
 * TEE Biometric Template Binding
 * Stores and verifies biometric template hashes bound to keys via TEE.
 *
 * @module biometric-binding
 */

const BIOMETRIC_TYPES = {
  FINGERPRINT: 'fingerprint',
  FACE: 'face',
  IRIS: 'iris',
  VOICE: 'voice',
};

const BINDING_STATUS = {
  ACTIVE: 'active',
  REVOKED: 'revoked',
  EXPIRED: 'expired',
};

class BiometricBinding extends EventEmitter {
  constructor(database) {
    super();
    this.database = database;
    this.initialized = false;
    this._bindings = new Map(); // keyId → binding info
  }

  async initialize() {
    if (this.initialized) return;
    this._ensureTables();
    this.initialized = true;
    logger.info('[BiometricBinding] Initialized');
  }

  _ensureTables() {
    if (!this.database) return;
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS biometric_bindings (
        id TEXT PRIMARY KEY,
        key_id TEXT NOT NULL,
        biometric_type TEXT NOT NULL,
        template_hash TEXT NOT NULL,
        salt TEXT NOT NULL,
        tee_attestation TEXT,
        status TEXT DEFAULT 'active',
        bound_at INTEGER DEFAULT (strftime('%s','now')),
        expires_at INTEGER,
        last_verified_at INTEGER,
        verification_count INTEGER DEFAULT 0,
        UNIQUE(key_id, biometric_type)
      );
      CREATE INDEX IF NOT EXISTS idx_biometric_key ON biometric_bindings(key_id);
      CREATE INDEX IF NOT EXISTS idx_biometric_status ON biometric_bindings(status);
    `);
  }

  /**
   * Bind a biometric template to a key
   * @param {Object} options
   * @param {string} options.keyId - Key to bind to
   * @param {string} options.biometricType - Type of biometric (fingerprint, face, etc.)
   * @param {Buffer|string} options.templateData - Raw biometric template data
   * @param {string} [options.teeAttestation] - TEE attestation proof
   * @param {number} [options.expiresInDays] - Binding expiration in days
   * @returns {Object} Binding result
   */
  async bindBiometric({ keyId, biometricType, templateData, teeAttestation, expiresInDays } = {}) {
    if (!this.initialized) throw new Error('BiometricBinding not initialized');
    if (!keyId || !biometricType || !templateData) {
      throw new Error('keyId, biometricType, and templateData are required');
    }

    if (!Object.values(BIOMETRIC_TYPES).includes(biometricType)) {
      throw new Error(`Invalid biometric type: ${biometricType}`);
    }

    // Generate salt and hash the template
    const salt = crypto.randomBytes(32).toString('hex');
    const templateHash = this._hashTemplate(templateData, salt);

    const bindingId = crypto.randomUUID();
    const expiresAt = expiresInDays
      ? Math.floor(Date.now() / 1000) + expiresInDays * 86400
      : null;

    if (this.database) {
      const stmt = this.database.prepare(`
        INSERT OR REPLACE INTO biometric_bindings
        (id, key_id, biometric_type, template_hash, salt, tee_attestation, status, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, 'active', ?)
      `);
      stmt.run(bindingId, keyId, biometricType, templateHash, salt, teeAttestation || null, expiresAt);
    }

    this._bindings.set(`${keyId}:${biometricType}`, {
      id: bindingId,
      templateHash,
      salt,
      status: BINDING_STATUS.ACTIVE,
    });

    this.emit('biometric-bound', { keyId, biometricType, bindingId });
    logger.info(`[BiometricBinding] Bound ${biometricType} to key ${keyId}`);

    return {
      success: true,
      bindingId,
      keyId,
      biometricType,
      expiresAt,
    };
  }

  /**
   * Verify a biometric template against a stored binding
   * @param {Object} options
   * @param {string} options.keyId - Key identifier
   * @param {string} options.biometricType - Biometric type
   * @param {Buffer|string} options.templateData - Template to verify
   * @returns {Object} Verification result
   */
  async verifyBiometric({ keyId, biometricType, templateData } = {}) {
    if (!this.initialized) throw new Error('BiometricBinding not initialized');
    if (!keyId || !biometricType || !templateData) {
      throw new Error('keyId, biometricType, and templateData are required');
    }

    // Retrieve stored binding
    let binding = null;
    if (this.database) {
      binding = this.database.prepare(
        'SELECT * FROM biometric_bindings WHERE key_id = ? AND biometric_type = ? AND status = ?'
      ).get(keyId, biometricType, BINDING_STATUS.ACTIVE);
    }

    if (!binding) {
      return { success: false, verified: false, error: 'No active binding found' };
    }

    // Check expiration
    if (binding.expires_at && binding.expires_at < Math.floor(Date.now() / 1000)) {
      this.database?.prepare(
        'UPDATE biometric_bindings SET status = ? WHERE id = ?'
      ).run(BINDING_STATUS.EXPIRED, binding.id);
      return { success: false, verified: false, error: 'Binding has expired' };
    }

    // Verify template hash
    const candidateHash = this._hashTemplate(templateData, binding.salt);
    const verified = crypto.timingSafeEqual(
      Buffer.from(candidateHash, 'hex'),
      Buffer.from(binding.template_hash, 'hex')
    );

    if (verified && this.database) {
      this.database.prepare(
        'UPDATE biometric_bindings SET last_verified_at = strftime(\'%s\',\'now\'), verification_count = verification_count + 1 WHERE id = ?'
      ).run(binding.id);
    }

    this.emit('biometric-verified', { keyId, biometricType, verified });

    return {
      success: true,
      verified,
      keyId,
      biometricType,
      verificationCount: (binding.verification_count || 0) + (verified ? 1 : 0),
    };
  }

  /**
   * Unbind a biometric from a key
   */
  async unbindBiometric({ keyId, biometricType } = {}) {
    if (!keyId || !biometricType) throw new Error('keyId and biometricType are required');

    if (this.database) {
      this.database.prepare(
        'UPDATE biometric_bindings SET status = ? WHERE key_id = ? AND biometric_type = ?'
      ).run(BINDING_STATUS.REVOKED, keyId, biometricType);
    }

    this._bindings.delete(`${keyId}:${biometricType}`);
    this.emit('biometric-unbound', { keyId, biometricType });

    return { success: true, keyId, biometricType };
  }

  /**
   * List all bindings for a key
   */
  async listBindings(keyId) {
    if (!this.database) return [];
    const query = keyId
      ? 'SELECT id, key_id, biometric_type, status, bound_at, expires_at, last_verified_at, verification_count FROM biometric_bindings WHERE key_id = ?'
      : 'SELECT id, key_id, biometric_type, status, bound_at, expires_at, last_verified_at, verification_count FROM biometric_bindings';
    return keyId ? this.database.prepare(query).all(keyId) : this.database.prepare(query).all();
  }

  _hashTemplate(templateData, salt) {
    const data = Buffer.isBuffer(templateData) ? templateData : Buffer.from(templateData, 'utf-8');
    return crypto.createHmac('sha512', salt).update(data).digest('hex');
  }
}

let _instance;
function getBiometricBinding() {
  if (!_instance) _instance = new BiometricBinding();
  return _instance;
}

module.exports = { BiometricBinding, getBiometricBinding, BIOMETRIC_TYPES, BINDING_STATUS };
