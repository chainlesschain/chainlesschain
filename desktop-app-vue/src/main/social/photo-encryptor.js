/**
 * Photo Encryptor
 *
 * Provides AES-256-GCM encryption/decryption for photos in shared albums.
 * Features:
 * - Per-album key generation
 * - AES-256-GCM photo encryption and decryption
 * - Key encryption for recipients using asymmetric cryptography
 * - Album key rotation
 * - Encryption key storage and management
 */

const { logger } = require("../utils/logger.js");
const EventEmitter = require("events");
const { v4: uuidv4 } = require("uuid");
const crypto = require("crypto");

/**
 * Encryption algorithm constants
 */
const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 12; // 96 bits for GCM
const AUTH_TAG_LENGTH = 16; // 128 bits

/**
 * Photo Encryptor class
 */
class PhotoEncryptor extends EventEmitter {
  constructor(database, didManager) {
    super();

    this.database = database;
    this.didManager = didManager;

    this.initialized = false;

    // In-memory cache for album keys (albumId -> key Buffer)
    this.keyCache = new Map();
  }

  /**
   * Initialize photo encryptor
   */
  async initialize() {
    logger.info("[PhotoEncryptor] Initializing photo encryptor...");

    try {
      await this.initializeTables();

      this.initialized = true;
      logger.info("[PhotoEncryptor] Photo encryptor initialized successfully");
    } catch (error) {
      logger.error("[PhotoEncryptor] Initialization failed:", error);
      throw error;
    }
  }

  /**
   * Initialize database tables
   */
  async initializeTables() {
    const db = this.database.db;

    db.exec(`
      CREATE TABLE IF NOT EXISTS photo_encryption_keys (
        id TEXT PRIMARY KEY,
        album_id TEXT NOT NULL,
        encrypted_key TEXT NOT NULL,
        recipient_did TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE(album_id, recipient_did)
      )
    `);

    // Create indexes
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_photo_keys_album
        ON photo_encryption_keys(album_id);
      CREATE INDEX IF NOT EXISTS idx_photo_keys_recipient
        ON photo_encryption_keys(recipient_did);
    `);

    logger.info("[PhotoEncryptor] Database tables initialized");
  }

  /**
   * Generate a new random album encryption key
   * @returns {Buffer} 256-bit random key
   */
  generateAlbumKey() {
    const key = crypto.randomBytes(KEY_LENGTH);
    logger.info("[PhotoEncryptor] Generated new album key");
    return key;
  }

  /**
   * Encrypt a photo buffer using AES-256-GCM
   * @param {Buffer} buffer - Raw photo buffer
   * @param {Buffer} albumKey - Album encryption key
   * @returns {Buffer} Encrypted buffer (iv + authTag + ciphertext)
   */
  encryptPhoto(buffer, albumKey) {
    try {
      if (!Buffer.isBuffer(buffer)) {
        throw new Error("Input must be a Buffer");
      }

      if (!Buffer.isBuffer(albumKey) || albumKey.length !== KEY_LENGTH) {
        throw new Error("Album key must be a 32-byte Buffer");
      }

      // Generate random IV for each encryption
      const iv = crypto.randomBytes(IV_LENGTH);

      const cipher = crypto.createCipheriv(ALGORITHM, albumKey, iv, {
        authTagLength: AUTH_TAG_LENGTH,
      });

      const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);

      const authTag = cipher.getAuthTag();

      // Combine: iv (12 bytes) + authTag (16 bytes) + ciphertext
      const result = Buffer.concat([iv, authTag, encrypted]);

      logger.info(
        "[PhotoEncryptor] Photo encrypted, size:",
        buffer.length,
        "->",
        result.length,
      );

      return result;
    } catch (error) {
      logger.error("[PhotoEncryptor] Failed to encrypt photo:", error);
      throw error;
    }
  }

  /**
   * Decrypt a photo buffer using AES-256-GCM
   * @param {Buffer} encryptedBuffer - Encrypted buffer (iv + authTag + ciphertext)
   * @param {Buffer} albumKey - Album encryption key
   * @returns {Buffer} Decrypted photo buffer
   */
  decryptPhoto(encryptedBuffer, albumKey) {
    try {
      if (!Buffer.isBuffer(encryptedBuffer)) {
        throw new Error("Input must be a Buffer");
      }

      if (!Buffer.isBuffer(albumKey) || albumKey.length !== KEY_LENGTH) {
        throw new Error("Album key must be a 32-byte Buffer");
      }

      const minLength = IV_LENGTH + AUTH_TAG_LENGTH + 1;
      if (encryptedBuffer.length < minLength) {
        throw new Error("Encrypted buffer is too short");
      }

      // Extract iv, authTag, and ciphertext
      const iv = encryptedBuffer.subarray(0, IV_LENGTH);
      const authTag = encryptedBuffer.subarray(
        IV_LENGTH,
        IV_LENGTH + AUTH_TAG_LENGTH,
      );
      const ciphertext = encryptedBuffer.subarray(
        IV_LENGTH + AUTH_TAG_LENGTH,
      );

      const decipher = crypto.createDecipheriv(ALGORITHM, albumKey, iv, {
        authTagLength: AUTH_TAG_LENGTH,
      });

      decipher.setAuthTag(authTag);

      const decrypted = Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]);

      logger.info(
        "[PhotoEncryptor] Photo decrypted, size:",
        encryptedBuffer.length,
        "->",
        decrypted.length,
      );

      return decrypted;
    } catch (error) {
      logger.error("[PhotoEncryptor] Failed to decrypt photo:", error);
      throw error;
    }
  }

  /**
   * Encrypt an album key for a specific recipient using their public key
   * Uses RSA-OAEP with SHA-256 for key wrapping
   * @param {Buffer} albumKey - Album encryption key
   * @param {string|Buffer} recipientPublicKey - Recipient's public key (PEM or Buffer)
   * @returns {string} Base64-encoded encrypted key
   */
  encryptKeyForRecipient(albumKey, recipientPublicKey) {
    try {
      if (!Buffer.isBuffer(albumKey) || albumKey.length !== KEY_LENGTH) {
        throw new Error("Album key must be a 32-byte Buffer");
      }

      const encrypted = crypto.publicEncrypt(
        {
          key: recipientPublicKey,
          padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
          oaepHash: "sha256",
        },
        albumKey,
      );

      const result = encrypted.toString("base64");

      logger.info("[PhotoEncryptor] Album key encrypted for recipient");

      return result;
    } catch (error) {
      logger.error(
        "[PhotoEncryptor] Failed to encrypt key for recipient:",
        error,
      );
      throw error;
    }
  }

  /**
   * Decrypt an album key using private key
   * @param {string} encryptedKey - Base64-encoded encrypted key
   * @param {string|Buffer} privateKey - Private key (PEM or Buffer)
   * @returns {Buffer} Decrypted album key
   */
  decryptKeyWithPrivateKey(encryptedKey, privateKey) {
    try {
      const encryptedBuffer = Buffer.from(encryptedKey, "base64");

      const decrypted = crypto.privateDecrypt(
        {
          key: privateKey,
          padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
          oaepHash: "sha256",
        },
        encryptedBuffer,
      );

      if (decrypted.length !== KEY_LENGTH) {
        throw new Error("Decrypted key has unexpected length");
      }

      logger.info("[PhotoEncryptor] Album key decrypted successfully");

      return decrypted;
    } catch (error) {
      logger.error(
        "[PhotoEncryptor] Failed to decrypt key with private key:",
        error,
      );
      throw error;
    }
  }

  /**
   * Store an encrypted key for a recipient
   * @param {string} albumId - Album ID
   * @param {string} recipientDid - Recipient DID
   * @param {string} encryptedKey - Base64-encoded encrypted key
   */
  async storeEncryptedKey(albumId, recipientDid, encryptedKey) {
    try {
      const db = this.database.db;
      const now = Date.now();

      db.prepare(
        `
        INSERT OR REPLACE INTO photo_encryption_keys
        (id, album_id, encrypted_key, recipient_did, created_at)
        VALUES (?, ?, ?, ?, ?)
      `,
      ).run(uuidv4(), albumId, encryptedKey, recipientDid, now);

      logger.info(
        "[PhotoEncryptor] Encrypted key stored for:",
        recipientDid,
        "album:",
        albumId,
      );
    } catch (error) {
      logger.error("[PhotoEncryptor] Failed to store encrypted key:", error);
      throw error;
    }
  }

  /**
   * Retrieve an encrypted key for a recipient
   * @param {string} albumId - Album ID
   * @param {string} recipientDid - Recipient DID
   * @returns {string|null} Base64-encoded encrypted key or null
   */
  async getEncryptedKey(albumId, recipientDid) {
    try {
      const db = this.database.db;

      const row = db
        .prepare(
          `
        SELECT encrypted_key FROM photo_encryption_keys
        WHERE album_id = ? AND recipient_did = ?
      `,
        )
        .get(albumId, recipientDid);

      return row ? row.encrypted_key : null;
    } catch (error) {
      logger.error("[PhotoEncryptor] Failed to get encrypted key:", error);
      throw error;
    }
  }

  /**
   * Rotate the album key - generates a new key and re-encrypts for all recipients
   * @param {string} albumId - Album ID
   * @param {Object} recipientPublicKeys - Map of recipientDid -> publicKey
   * @returns {Buffer} New album key
   */
  async rotateAlbumKey(albumId, recipientPublicKeys = {}) {
    try {
      const newKey = this.generateAlbumKey();

      const db = this.database.db;

      // Remove old keys for this album
      db.prepare("DELETE FROM photo_encryption_keys WHERE album_id = ?").run(
        albumId,
      );

      // Encrypt new key for each recipient
      const now = Date.now();

      for (const [recipientDid, publicKey] of Object.entries(
        recipientPublicKeys,
      )) {
        try {
          const encryptedKey = this.encryptKeyForRecipient(newKey, publicKey);

          db.prepare(
            `
            INSERT INTO photo_encryption_keys
            (id, album_id, encrypted_key, recipient_did, created_at)
            VALUES (?, ?, ?, ?, ?)
          `,
          ).run(uuidv4(), albumId, encryptedKey, recipientDid, now);
        } catch (error) {
          logger.warn(
            "[PhotoEncryptor] Failed to encrypt key for:",
            recipientDid,
            error.message,
          );
        }
      }

      // Update cache
      this.keyCache.set(albumId, newKey);

      logger.info(
        "[PhotoEncryptor] Album key rotated for:",
        albumId,
        "recipients:",
        Object.keys(recipientPublicKeys).length,
      );

      this.emit("key:rotated", {
        albumId,
        recipientCount: Object.keys(recipientPublicKeys).length,
      });

      return newKey;
    } catch (error) {
      logger.error("[PhotoEncryptor] Failed to rotate album key:", error);
      throw error;
    }
  }

  /**
   * Get the cached album key or retrieve and decrypt it
   * @param {string} albumId - Album ID
   * @param {string|Buffer} privateKey - User's private key for decryption
   * @returns {Buffer|null} Album key or null
   */
  async getAlbumKey(albumId, privateKey) {
    // Check cache first
    if (this.keyCache.has(albumId)) {
      return this.keyCache.get(albumId);
    }

    const currentDid = this.didManager?.getCurrentIdentity()?.did;

    if (!currentDid) {
      return null;
    }

    const encryptedKey = await this.getEncryptedKey(albumId, currentDid);

    if (!encryptedKey) {
      return null;
    }

    try {
      const key = this.decryptKeyWithPrivateKey(encryptedKey, privateKey);
      this.keyCache.set(albumId, key);
      return key;
    } catch (error) {
      logger.error(
        "[PhotoEncryptor] Failed to decrypt album key:",
        error,
      );
      return null;
    }
  }

  /**
   * Clear the key cache
   */
  clearKeyCache() {
    this.keyCache.clear();
    logger.info("[PhotoEncryptor] Key cache cleared");
  }

  /**
   * Close photo encryptor
   */
  async close() {
    logger.info("[PhotoEncryptor] Closing photo encryptor");

    this.clearKeyCache();
    this.removeAllListeners();
    this.initialized = false;
  }
}

module.exports = {
  PhotoEncryptor,
  ALGORITHM,
  KEY_LENGTH,
  IV_LENGTH,
  AUTH_TAG_LENGTH,
};
