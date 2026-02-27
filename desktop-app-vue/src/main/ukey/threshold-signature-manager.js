'use strict';

const EventEmitter = require('events');
const crypto = require('crypto');
const { logger } = require('../utils/logger');

/**
 * Shamir 2-of-3 Threshold Signature Manager
 * Splits signing keys into shares across U-Key/SIMKey/TEE,
 * requiring any 2-of-3 to reconstruct and sign.
 *
 * @module threshold-signature-manager
 */

const SHARE_SOURCES = {
  UKEY: 'ukey',
  SIMKEY: 'simkey',
  TEE: 'tee',
};

const THRESHOLD_STATE = {
  UNINITIALIZED: 'uninitialized',
  READY: 'ready',
  SIGNING: 'signing',
  ERROR: 'error',
};

class ThresholdSignatureManager extends EventEmitter {
  constructor(database) {
    super();
    this.database = database;
    this.initialized = false;
    this._state = THRESHOLD_STATE.UNINITIALIZED;
    this._threshold = 2;
    this._totalShares = 3;
    this._prime = null;
  }

  /**
   * Initialize manager and ensure DB tables exist
   */
  async initialize() {
    if (this.initialized) return;
    this._ensureTables();
    // Use a large safe prime for Shamir arithmetic
    this._prime = BigInt('0xFFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD129024E088A67CC74020BBEA63B139B22514A08798E3404DDEF9519B3CD3A431B302B0A6DF25F14374FE1356D6D51C245E485B576625E7EC6F44C42E9A637ED6B0BFF5CB6F406B7EDEE386BFB5A899FA5AE9F24117C4B1FE649286651ECE45B3DC2007CB8A163BF0598DA48361C55D39A69163FA8FD24CF5F83655D23DCA3AD961C62F356208552BB9ED529077096966D670C354E4ABC9804F1746C08CA18217C32905E462E36CE3BE39E772C180E86039B2783A2EC07A28FB5C55DF06F4C52C9DE2BCBF6955817183995497CEA956AE515D2261898FA051015728E5A8AACAA68FFFFFFFFFFFFFFFF');
    this._state = THRESHOLD_STATE.READY;
    this.initialized = true;
    logger.info('[ThresholdSignature] Initialized');
  }

  _ensureTables() {
    if (!this.database) return;
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS threshold_key_shares (
        id TEXT PRIMARY KEY,
        key_id TEXT NOT NULL,
        share_index INTEGER NOT NULL,
        source TEXT NOT NULL,
        encrypted_share TEXT NOT NULL,
        public_key TEXT,
        created_at INTEGER DEFAULT (strftime('%s','now')),
        updated_at INTEGER DEFAULT (strftime('%s','now')),
        UNIQUE(key_id, share_index)
      );
      CREATE INDEX IF NOT EXISTS idx_threshold_shares_key ON threshold_key_shares(key_id);
      CREATE INDEX IF NOT EXISTS idx_threshold_shares_source ON threshold_key_shares(source);
    `);
  }

  /**
   * Generate a new signing key and split into 2-of-3 Shamir shares
   * @param {Object} options
   * @param {string} options.keyId - Unique identifier for the key
   * @param {string[]} [options.sources] - Share destinations (default: ukey, simkey, tee)
   * @returns {Object} Setup result with share metadata
   */
  async setupKeys({ keyId, sources } = {}) {
    if (!this.initialized) throw new Error('ThresholdSignatureManager not initialized');
    if (!keyId) throw new Error('keyId is required');

    const shareSources = sources || [SHARE_SOURCES.UKEY, SHARE_SOURCES.SIMKEY, SHARE_SOURCES.TEE];
    if (shareSources.length !== this._totalShares) {
      throw new Error(`Exactly ${this._totalShares} sources required`);
    }

    // Generate master signing key
    const masterKey = crypto.randomBytes(32);
    const publicKey = this._derivePublicKey(masterKey);

    // Split into Shamir shares
    const shares = this._splitSecret(masterKey, this._threshold, this._totalShares);

    // Encrypt and store each share
    const shareRecords = [];
    for (let i = 0; i < shares.length; i++) {
      const shareId = crypto.randomUUID();
      const encryptedShare = this._encryptShare(shares[i], shareSources[i]);

      if (this.database) {
        const stmt = this.database.prepare(`
          INSERT INTO threshold_key_shares (id, key_id, share_index, source, encrypted_share, public_key)
          VALUES (?, ?, ?, ?, ?, ?)
        `);
        stmt.run(shareId, keyId, i + 1, shareSources[i], encryptedShare, publicKey);
      }

      shareRecords.push({
        id: shareId,
        index: i + 1,
        source: shareSources[i],
      });
    }

    // Zero out master key
    masterKey.fill(0);

    this.emit('keys-setup', { keyId, shares: shareRecords });
    logger.info(`[ThresholdSignature] Key ${keyId} split into ${this._totalShares} shares`);

    return {
      success: true,
      keyId,
      publicKey,
      shares: shareRecords,
      threshold: this._threshold,
      total: this._totalShares,
    };
  }

  /**
   * Sign data using threshold reconstruction from 2+ shares
   * @param {Object} options
   * @param {string} options.keyId - Key identifier
   * @param {Buffer|string} options.data - Data to sign
   * @param {string[]} options.shareSources - Which share sources to use (min 2)
   * @returns {Object} Signature result
   */
  async sign({ keyId, data, shareSources } = {}) {
    if (!this.initialized) throw new Error('ThresholdSignatureManager not initialized');
    if (!keyId || !data) throw new Error('keyId and data are required');
    if (!shareSources || shareSources.length < this._threshold) {
      throw new Error(`At least ${this._threshold} shares required to sign`);
    }

    this._state = THRESHOLD_STATE.SIGNING;

    try {
      // Retrieve shares from DB
      const shares = [];
      for (const source of shareSources) {
        const row = this.database?.prepare(
          'SELECT * FROM threshold_key_shares WHERE key_id = ? AND source = ?'
        ).get(keyId, source);

        if (!row) throw new Error(`Share not found for source: ${source}`);

        const decryptedShare = this._decryptShare(row.encrypted_share, source);
        shares.push({ index: row.share_index, value: decryptedShare });
      }

      // Reconstruct key via Lagrange interpolation
      const reconstructedKey = this._combineShares(shares);

      // Sign with reconstructed key
      const dataBuffer = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf-8');
      const signature = crypto.sign('SHA256', dataBuffer, {
        key: reconstructedKey,
        format: 'der',
        type: 'pkcs8',
      }).toString('base64');

      // Zero out reconstructed key
      reconstructedKey.fill(0);

      this._state = THRESHOLD_STATE.READY;
      this.emit('signed', { keyId, shareSources });

      return { success: true, signature, keyId, usedShares: shareSources };
    } catch (error) {
      this._state = THRESHOLD_STATE.ERROR;
      throw error;
    }
  }

  /**
   * List all key setups
   */
  async listKeys() {
    if (!this.database) return [];
    const rows = this.database.prepare(`
      SELECT key_id, public_key, COUNT(*) as share_count, MIN(created_at) as created_at
      FROM threshold_key_shares
      GROUP BY key_id
    `).all();
    return rows;
  }

  /**
   * Get shares for a specific key
   */
  async getKeyShares(keyId) {
    if (!this.database) return [];
    return this.database.prepare(
      'SELECT id, key_id, share_index, source, public_key, created_at FROM threshold_key_shares WHERE key_id = ?'
    ).all(keyId);
  }

  /**
   * Delete a key and all its shares
   */
  async deleteKey(keyId) {
    if (!this.database) return { success: false, error: 'No database' };
    this.database.prepare('DELETE FROM threshold_key_shares WHERE key_id = ?').run(keyId);
    this.emit('key-deleted', { keyId });
    return { success: true };
  }

  // ---- Shamir Secret Sharing internals ----

  _splitSecret(secret, threshold, total) {
    const p = this._prime;
    const secretBigInt = BigInt('0x' + secret.toString('hex'));

    // Generate random polynomial coefficients (degree = threshold - 1)
    const coefficients = [secretBigInt];
    for (let i = 1; i < threshold; i++) {
      const coeff = BigInt('0x' + crypto.randomBytes(32).toString('hex')) % p;
      coefficients.push(coeff);
    }

    // Evaluate polynomial at points 1..total
    const shares = [];
    for (let x = 1; x <= total; x++) {
      let y = BigInt(0);
      const xBig = BigInt(x);
      for (let j = coefficients.length - 1; j >= 0; j--) {
        y = (y * xBig + coefficients[j]) % p;
      }
      shares.push(Buffer.from(y.toString(16).padStart(64, '0'), 'hex'));
    }

    return shares;
  }

  _combineShares(shares) {
    const p = this._prime;
    const points = shares.map(s => ({
      x: BigInt(s.index),
      y: BigInt('0x' + s.value.toString('hex')),
    }));

    // Lagrange interpolation at x=0
    let secret = BigInt(0);
    for (let i = 0; i < points.length; i++) {
      let numerator = BigInt(1);
      let denominator = BigInt(1);
      for (let j = 0; j < points.length; j++) {
        if (i === j) continue;
        numerator = (numerator * (p - points[j].x)) % p;
        denominator = (denominator * ((points[i].x - points[j].x + p) % p)) % p;
      }
      const lagrange = (numerator * this._modInverse(denominator, p)) % p;
      secret = (secret + points[i].y * lagrange) % p;
    }

    return Buffer.from(secret.toString(16).padStart(64, '0'), 'hex');
  }

  _modInverse(a, m) {
    let [old_r, r] = [a % m, m];
    let [old_s, s] = [BigInt(1), BigInt(0)];
    while (r !== BigInt(0)) {
      const q = old_r / r;
      [old_r, r] = [r, old_r - q * r];
      [old_s, s] = [s, old_s - q * s];
    }
    return ((old_s % m) + m) % m;
  }

  _derivePublicKey(privateKey) {
    try {
      const keyPair = crypto.createPublicKey({
        key: privateKey,
        format: 'der',
        type: 'pkcs8',
      });
      return keyPair.export({ format: 'pem', type: 'spki' });
    } catch {
      // Fallback: hash-based public key derivation
      return crypto.createHash('sha256').update(privateKey).digest('hex');
    }
  }

  _encryptShare(share, _source) {
    // Encrypt share with source-specific key derivation
    const key = crypto.scryptSync(_source, 'threshold-salt', 32);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(share), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, encrypted]).toString('base64');
  }

  _decryptShare(encryptedB64, _source) {
    const key = crypto.scryptSync(_source, 'threshold-salt', 32);
    const data = Buffer.from(encryptedB64, 'base64');
    const iv = data.subarray(0, 12);
    const tag = data.subarray(12, 28);
    const encrypted = data.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]);
  }

  getState() {
    return this._state;
  }
}

let _instance;
function getThresholdSignatureManager() {
  if (!_instance) _instance = new ThresholdSignatureManager();
  return _instance;
}

module.exports = { ThresholdSignatureManager, getThresholdSignatureManager, SHARE_SOURCES, THRESHOLD_STATE };
