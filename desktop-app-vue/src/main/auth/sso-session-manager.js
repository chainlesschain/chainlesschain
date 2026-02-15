/**
 * SSO Session Manager
 *
 * Manages SSO session lifecycle including token storage with AES-256-GCM
 * encryption at rest. Sessions are tied to DID identities and tracked
 * in the sso_sessions database table.
 *
 * Features:
 * - Session creation with encrypted token storage
 * - Token refresh and session invalidation
 * - Automatic cleanup of expired sessions
 * - Machine-specific encryption key derivation
 *
 * @module auth/sso-session-manager
 * @version 1.0.0
 * @since 2026-02-15
 */

const { logger } = require('../utils/logger.js');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

// Encryption constants
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 32;
const KEY_LENGTH = 32;
const ITERATIONS = 100000;

// Default session TTL: 24 hours (in milliseconds)
const DEFAULT_SESSION_TTL = 24 * 60 * 60 * 1000;

// Maximum sessions per user
const MAX_SESSIONS_PER_USER = 10;

/**
 * SSOSessionManager - Manages SSO session lifecycle and encrypted token storage
 *
 * All tokens (access_token, refresh_token, id_token) are encrypted at rest
 * using AES-256-GCM with a key derived from machine-specific data.
 */
class SSOSessionManager {
  /**
   * Create an SSO session manager
   * @param {Object} options - Configuration options
   * @param {Object} options.database - Database instance (DatabaseManager)
   */
  constructor({ database }) {
    if (!database) {
      throw new Error('[SSOSessionManager] database parameter is required');
    }

    this.database = database;

    // Cached encryption key (derived lazily)
    this._encryptionKey = null;
    this._encryptionSalt = null;

    logger.info('[SSOSessionManager] Initialized');
  }

  // ============================================
  // Session CRUD Operations
  // ============================================

  /**
   * Create a new SSO session
   *
   * Encrypts all tokens before storing them in the database.
   * Enforces a maximum number of sessions per user.
   *
   * @param {string} userDid - The user's DID identifier
   * @param {string} providerId - The SSO provider identifier
   * @param {Object} tokens - Token data from SSO provider
   * @param {string} tokens.accessToken - OAuth2 access token
   * @param {string} [tokens.refreshToken] - OAuth2 refresh token
   * @param {string} [tokens.idToken] - OIDC ID token
   * @param {number} [tokens.expiresIn] - Token expiry in seconds
   * @param {string} [tokens.tokenType] - Token type (e.g., 'Bearer')
   * @param {string} [tokens.scope] - Granted scopes
   * @returns {Promise<Object>} Session creation result with sessionId
   */
  async createSession(userDid, providerId, tokens) {
    try {
      if (!userDid || !providerId || !tokens) {
        throw new Error('userDid, providerId, and tokens are required');
      }

      if (!tokens.accessToken) {
        throw new Error('tokens.accessToken is required');
      }

      const db = this.database.getDatabase();
      const now = Date.now();
      const sessionId = uuidv4();

      // Enforce session limit per user
      const existingSessions = db.prepare(`
        SELECT COUNT(*) as count FROM sso_sessions
        WHERE user_did = ? AND provider_id = ?
      `).get(userDid, providerId);

      if (existingSessions && existingSessions.count >= MAX_SESSIONS_PER_USER) {
        // Remove oldest session to make room
        const oldest = db.prepare(`
          SELECT id FROM sso_sessions
          WHERE user_did = ? AND provider_id = ?
          ORDER BY created_at ASC
          LIMIT 1
        `).get(userDid, providerId);

        if (oldest) {
          logger.info(`[SSOSessionManager] Removing oldest session ${oldest.id} for user ${userDid} (limit reached)`);
          db.prepare(`DELETE FROM sso_sessions WHERE id = ?`).run(oldest.id);
        }
      }

      // Calculate expiry timestamp
      const expiresIn = tokens.expiresIn || (DEFAULT_SESSION_TTL / 1000);
      const expiresAt = now + (expiresIn * 1000);

      // Encrypt token data
      const tokenData = {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken || null,
        idToken: tokens.idToken || null,
        tokenType: tokens.tokenType || 'Bearer',
        scope: tokens.scope || null,
        expiresIn: expiresIn,
      };

      const encryptedTokens = this._encrypt(JSON.stringify(tokenData));

      // Store session in database
      db.prepare(`
        INSERT INTO sso_sessions (
          id, user_did, provider_id, encrypted_tokens,
          expires_at, last_activity, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        sessionId,
        userDid,
        providerId,
        encryptedTokens,
        expiresAt,
        now,
        now,
        now
      );

      logger.info(`[SSOSessionManager] Created session ${sessionId} for user ${userDid} with provider ${providerId}`);

      return {
        success: true,
        sessionId,
        expiresAt,
        tokenType: tokenData.tokenType,
      };
    } catch (error) {
      logger.error('[SSOSessionManager] Error creating session:', error);
      throw error;
    }
  }

  /**
   * Get a session by ID with decrypted tokens
   *
   * @param {string} sessionId - The session identifier
   * @returns {Promise<Object|null>} Session data with decrypted tokens, or null if not found
   */
  async getSession(sessionId) {
    try {
      if (!sessionId) {
        throw new Error('sessionId is required');
      }

      const db = this.database.getDatabase();

      const session = db.prepare(`
        SELECT * FROM sso_sessions WHERE id = ?
      `).get(sessionId);

      if (!session) {
        logger.warn(`[SSOSessionManager] Session ${sessionId} not found`);
        return null;
      }

      // Check if session has expired
      if (session.expires_at && session.expires_at < Date.now()) {
        logger.info(`[SSOSessionManager] Session ${sessionId} has expired, removing`);
        db.prepare(`DELETE FROM sso_sessions WHERE id = ?`).run(sessionId);
        return null;
      }

      // Decrypt tokens
      let tokens = null;
      try {
        tokens = JSON.parse(this._decrypt(session.encrypted_tokens));
      } catch (decryptError) {
        logger.error(`[SSOSessionManager] Failed to decrypt tokens for session ${sessionId}:`, decryptError);
        return null;
      }

      // Update last activity
      db.prepare(`
        UPDATE sso_sessions SET last_activity = ? WHERE id = ?
      `).run(Date.now(), sessionId);

      return {
        id: session.id,
        userDid: session.user_did,
        providerId: session.provider_id,
        tokens,
        expiresAt: session.expires_at,
        lastActivity: session.last_activity,
        createdAt: session.created_at,
        updatedAt: session.updated_at,
      };
    } catch (error) {
      logger.error('[SSOSessionManager] Error getting session:', error);
      throw error;
    }
  }

  /**
   * Get all active sessions for a user
   *
   * @param {string} userDid - The user's DID identifier
   * @returns {Promise<Array>} List of sessions with decrypted tokens
   */
  async getSessionsByUser(userDid) {
    try {
      if (!userDid) {
        throw new Error('userDid is required');
      }

      const db = this.database.getDatabase();
      const now = Date.now();

      // Get non-expired sessions
      const sessions = db.prepare(`
        SELECT * FROM sso_sessions
        WHERE user_did = ? AND (expires_at IS NULL OR expires_at > ?)
        ORDER BY last_activity DESC
      `).all(userDid, now);

      if (!sessions || sessions.length === 0) {
        return [];
      }

      const result = [];
      for (const session of sessions) {
        try {
          const tokens = JSON.parse(this._decrypt(session.encrypted_tokens));
          result.push({
            id: session.id,
            userDid: session.user_did,
            providerId: session.provider_id,
            tokens,
            expiresAt: session.expires_at,
            lastActivity: session.last_activity,
            createdAt: session.created_at,
            updatedAt: session.updated_at,
          });
        } catch (decryptError) {
          logger.warn(`[SSOSessionManager] Skipping session ${session.id}: decrypt failed`);
          // Skip sessions that can't be decrypted (may have been created on a different machine)
        }
      }

      return result;
    } catch (error) {
      logger.error('[SSOSessionManager] Error getting sessions by user:', error);
      throw error;
    }
  }

  /**
   * Get session info without sensitive token data
   *
   * Returns session metadata suitable for display in the UI.
   *
   * @param {string} sessionId - The session identifier
   * @returns {Promise<Object|null>} Session metadata without tokens, or null if not found
   */
  async getSessionInfo(sessionId) {
    try {
      if (!sessionId) {
        throw new Error('sessionId is required');
      }

      const db = this.database.getDatabase();

      const session = db.prepare(`
        SELECT id, user_did, provider_id, expires_at,
               last_activity, created_at, updated_at
        FROM sso_sessions WHERE id = ?
      `).get(sessionId);

      if (!session) {
        return null;
      }

      const now = Date.now();
      const isExpired = session.expires_at && session.expires_at < now;
      const remainingMs = session.expires_at ? Math.max(0, session.expires_at - now) : null;

      return {
        id: session.id,
        userDid: session.user_did,
        providerId: session.provider_id,
        expiresAt: session.expires_at,
        isExpired,
        remainingMs,
        remainingMinutes: remainingMs !== null ? Math.floor(remainingMs / 60000) : null,
        lastActivity: session.last_activity,
        createdAt: session.created_at,
        updatedAt: session.updated_at,
      };
    } catch (error) {
      logger.error('[SSOSessionManager] Error getting session info:', error);
      throw error;
    }
  }

  /**
   * Update tokens for an existing session
   *
   * Typically used after a token refresh operation. Encrypts the new tokens
   * and updates the session expiry.
   *
   * @param {string} sessionId - The session identifier
   * @param {Object} newTokens - New token data
   * @param {string} newTokens.accessToken - New access token
   * @param {string} [newTokens.refreshToken] - New refresh token
   * @param {string} [newTokens.idToken] - New ID token
   * @param {number} [newTokens.expiresIn] - New token expiry in seconds
   * @param {string} [newTokens.tokenType] - Token type
   * @param {string} [newTokens.scope] - Granted scopes
   * @returns {Promise<Object>} Update result
   */
  async updateTokens(sessionId, newTokens) {
    try {
      if (!sessionId || !newTokens) {
        throw new Error('sessionId and newTokens are required');
      }

      if (!newTokens.accessToken) {
        throw new Error('newTokens.accessToken is required');
      }

      const db = this.database.getDatabase();
      const now = Date.now();

      // Verify session exists
      const session = db.prepare(`
        SELECT id FROM sso_sessions WHERE id = ?
      `).get(sessionId);

      if (!session) {
        return { success: false, error: 'SESSION_NOT_FOUND' };
      }

      // Calculate new expiry
      const expiresIn = newTokens.expiresIn || (DEFAULT_SESSION_TTL / 1000);
      const expiresAt = now + (expiresIn * 1000);

      // Encrypt new tokens
      const tokenData = {
        accessToken: newTokens.accessToken,
        refreshToken: newTokens.refreshToken || null,
        idToken: newTokens.idToken || null,
        tokenType: newTokens.tokenType || 'Bearer',
        scope: newTokens.scope || null,
        expiresIn: expiresIn,
      };

      const encryptedTokens = this._encrypt(JSON.stringify(tokenData));

      // Update session
      db.prepare(`
        UPDATE sso_sessions
        SET encrypted_tokens = ?, expires_at = ?, last_activity = ?, updated_at = ?
        WHERE id = ?
      `).run(encryptedTokens, expiresAt, now, now, sessionId);

      logger.info(`[SSOSessionManager] Updated tokens for session ${sessionId}, new expiry: ${new Date(expiresAt).toISOString()}`);

      return {
        success: true,
        expiresAt,
        tokenType: tokenData.tokenType,
      };
    } catch (error) {
      logger.error('[SSOSessionManager] Error updating tokens:', error);
      throw error;
    }
  }

  /**
   * Invalidate (delete) a single session
   *
   * @param {string} sessionId - The session identifier
   * @returns {Promise<Object>} Invalidation result
   */
  async invalidateSession(sessionId) {
    try {
      if (!sessionId) {
        throw new Error('sessionId is required');
      }

      const db = this.database.getDatabase();

      const result = db.prepare(`
        DELETE FROM sso_sessions WHERE id = ?
      `).run(sessionId);

      const deleted = result.changes > 0;

      if (deleted) {
        logger.info(`[SSOSessionManager] Invalidated session ${sessionId}`);
      } else {
        logger.warn(`[SSOSessionManager] Session ${sessionId} not found for invalidation`);
      }

      return {
        success: true,
        deleted,
      };
    } catch (error) {
      logger.error('[SSOSessionManager] Error invalidating session:', error);
      throw error;
    }
  }

  /**
   * Invalidate all sessions for a user
   *
   * Used for global logout or account security operations.
   *
   * @param {string} userDid - The user's DID identifier
   * @returns {Promise<Object>} Result with count of deleted sessions
   */
  async invalidateAllSessions(userDid) {
    try {
      if (!userDid) {
        throw new Error('userDid is required');
      }

      const db = this.database.getDatabase();

      const result = db.prepare(`
        DELETE FROM sso_sessions WHERE user_did = ?
      `).run(userDid);

      const deletedCount = result.changes;

      logger.info(`[SSOSessionManager] Invalidated ${deletedCount} sessions for user ${userDid}`);

      return {
        success: true,
        deletedCount,
      };
    } catch (error) {
      logger.error('[SSOSessionManager] Error invalidating all sessions:', error);
      throw error;
    }
  }

  // ============================================
  // Session Validation
  // ============================================

  /**
   * Check if a session is valid (exists and not expired)
   *
   * @param {string} sessionId - The session identifier
   * @returns {Promise<boolean>} True if session is valid
   */
  async isSessionValid(sessionId) {
    try {
      if (!sessionId) {
        return false;
      }

      const db = this.database.getDatabase();
      const now = Date.now();

      const session = db.prepare(`
        SELECT id, expires_at FROM sso_sessions WHERE id = ?
      `).get(sessionId);

      if (!session) {
        return false;
      }

      // Check expiry
      if (session.expires_at && session.expires_at < now) {
        // Clean up expired session
        db.prepare(`DELETE FROM sso_sessions WHERE id = ?`).run(sessionId);
        logger.info(`[SSOSessionManager] Cleaned up expired session ${sessionId} during validation`);
        return false;
      }

      return true;
    } catch (error) {
      logger.error('[SSOSessionManager] Error validating session:', error);
      return false;
    }
  }

  // ============================================
  // Maintenance Operations
  // ============================================

  /**
   * Clean up all expired sessions from the database
   *
   * Should be called periodically (e.g., on app startup or via a timer).
   *
   * @returns {Promise<Object>} Cleanup result with count of removed sessions
   */
  async cleanExpiredSessions() {
    try {
      const db = this.database.getDatabase();
      const now = Date.now();

      const result = db.prepare(`
        DELETE FROM sso_sessions WHERE expires_at IS NOT NULL AND expires_at < ?
      `).run(now);

      const cleanedCount = result.changes;

      if (cleanedCount > 0) {
        logger.info(`[SSOSessionManager] Cleaned ${cleanedCount} expired sessions`);
      }

      return {
        success: true,
        cleanedCount,
      };
    } catch (error) {
      logger.error('[SSOSessionManager] Error cleaning expired sessions:', error);
      throw error;
    }
  }

  /**
   * Get count of active (non-expired) sessions
   *
   * @returns {Promise<Object>} Session count statistics
   */
  async getSessionCount() {
    try {
      const db = this.database.getDatabase();
      const now = Date.now();

      const totalResult = db.prepare(`
        SELECT COUNT(*) as count FROM sso_sessions
      `).get();

      const activeResult = db.prepare(`
        SELECT COUNT(*) as count FROM sso_sessions
        WHERE expires_at IS NULL OR expires_at > ?
      `).get(now);

      const expiredResult = db.prepare(`
        SELECT COUNT(*) as count FROM sso_sessions
        WHERE expires_at IS NOT NULL AND expires_at < ?
      `).get(now);

      const byProviderResults = db.prepare(`
        SELECT provider_id, COUNT(*) as count
        FROM sso_sessions
        WHERE expires_at IS NULL OR expires_at > ?
        GROUP BY provider_id
        ORDER BY count DESC
      `).all(now);

      const byProvider = {};
      if (byProviderResults) {
        for (const row of byProviderResults) {
          byProvider[row.provider_id] = row.count;
        }
      }

      return {
        total: totalResult ? totalResult.count : 0,
        active: activeResult ? activeResult.count : 0,
        expired: expiredResult ? expiredResult.count : 0,
        byProvider,
      };
    } catch (error) {
      logger.error('[SSOSessionManager] Error getting session count:', error);
      throw error;
    }
  }

  // ============================================
  // Encryption Methods (Private)
  // ============================================

  /**
   * Get or derive the encryption key from machine-specific data
   *
   * Uses PBKDF2 with machine characteristics (hostname, platform, architecture,
   * home directory, CPU model) as the key seed. The derived key is cached
   * in memory for the lifetime of the process.
   *
   * @private
   * @returns {{ key: Buffer, salt: Buffer }} Encryption key and salt
   */
  _getEncryptionKey() {
    if (this._encryptionKey && this._encryptionSalt) {
      return { key: this._encryptionKey, salt: this._encryptionSalt };
    }

    const os = require('os');

    // Build machine-specific seed from multiple hardware/OS characteristics
    const components = [
      os.hostname(),
      os.platform(),
      os.arch(),
      os.homedir(),
      JSON.stringify(os.cpus().map(c => c.model).slice(0, 1)),
      'chainlesschain-sso-session-v1',
    ];
    const seed = components.join('|');

    // Generate a deterministic salt from the seed
    // This ensures the same machine always derives the same key
    this._encryptionSalt = crypto
      .createHash('sha256')
      .update(seed + '-salt')
      .digest()
      .subarray(0, SALT_LENGTH);

    // Derive the key using PBKDF2
    this._encryptionKey = crypto.pbkdf2Sync(
      seed,
      this._encryptionSalt,
      ITERATIONS,
      KEY_LENGTH,
      'sha256'
    );

    return { key: this._encryptionKey, salt: this._encryptionSalt };
  }

  /**
   * Encrypt text using AES-256-GCM
   *
   * Output format: base64(iv + authTag + ciphertext)
   *
   * @private
   * @param {string} text - Plaintext to encrypt
   * @returns {string} Base64-encoded encrypted data
   */
  _encrypt(text) {
    try {
      const { key } = this._getEncryptionKey();
      const iv = crypto.randomBytes(IV_LENGTH);

      const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
      const encrypted = Buffer.concat([
        cipher.update(text, 'utf8'),
        cipher.final(),
      ]);
      const authTag = cipher.getAuthTag();

      // Concatenate: iv + authTag + encrypted
      const combined = Buffer.concat([iv, authTag, encrypted]);
      return combined.toString('base64');
    } catch (error) {
      logger.error('[SSOSessionManager] Encryption failed:', error);
      throw new Error('Failed to encrypt token data');
    }
  }

  /**
   * Decrypt AES-256-GCM encrypted data
   *
   * Expects base64(iv + authTag + ciphertext) format.
   *
   * @private
   * @param {string} encryptedData - Base64-encoded encrypted data
   * @returns {string} Decrypted plaintext
   */
  _decrypt(encryptedData) {
    try {
      const { key } = this._getEncryptionKey();
      const combined = Buffer.from(encryptedData, 'base64');

      // Extract components
      const iv = combined.subarray(0, IV_LENGTH);
      const authTag = combined.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
      const encrypted = combined.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

      const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
      decipher.setAuthTag(authTag);

      const decrypted = Buffer.concat([
        decipher.update(encrypted),
        decipher.final(),
      ]);

      return decrypted.toString('utf8');
    } catch (error) {
      logger.error('[SSOSessionManager] Decryption failed:', error);
      throw new Error('Failed to decrypt token data');
    }
  }
}

module.exports = { SSOSessionManager };
