/**
 * WebAuthn Passkey Manager — v4.0
 *
 * Manages FIDO2/WebAuthn passkeys for passwordless authentication
 * in the ChainlessChain decentralized agent network. Supports
 * registration and authentication ceremonies with CTAP2 protocol
 * integration, DID binding, and SSO manager hooks.
 *
 * Key features:
 * - WebAuthn registration and authentication ceremony management
 * - Passkey lifecycle (create, authenticate, revoke)
 * - DID binding for decentralized identity linkage
 * - In-memory cache with DB persistence
 * - Automatic cleanup of expired ceremonies
 *
 * @module ai-engine/cowork/webauthn-passkey-manager
 */

const { EventEmitter } = require("events");
const { logger } = require("../../utils/logger.js");
const crypto = require("crypto");

// ============================================================
// Constants
// ============================================================

const PASSKEY_STATUS = {
  ACTIVE: "active",
  REVOKED: "revoked",
  SUSPENDED: "suspended",
};

const CEREMONY_TYPE = {
  REGISTRATION: "registration",
  AUTHENTICATION: "authentication",
};

const CEREMONY_STATUS = {
  PENDING: "pending",
  COMPLETED: "completed",
  FAILED: "failed",
  EXPIRED: "expired",
};

const ATTESTATION_FORMAT = {
  NONE: "none",
  PACKED: "packed",
  TPM: "tpm",
  ANDROID_KEY: "android-key",
  FIDO_U2F: "fido-u2f",
};

const DEFAULT_CONFIG = {
  challengeTimeoutMs: 60000,
  challengeLength: 32,
  rpId: "chainlesschain.local",
  rpName: "ChainlessChain",
  attestation: "none",
  authenticatorSelection: {
    authenticatorAttachment: "platform",
    residentKey: "preferred",
    userVerification: "preferred",
  },
  cleanupIntervalMs: 300000,
};

// ============================================================
// WebAuthnPasskeyManager
// ============================================================

class WebAuthnPasskeyManager extends EventEmitter {
  constructor() {
    super();
    this.db = null;
    this.initialized = false;

    // Dependencies
    this._ctap2Protocol = null;
    this._didManager = null;
    this._ssoManager = null;

    // In-memory state
    this._passkeys = new Map(); // credentialId → passkey
    this._ceremonies = new Map(); // ceremonyId → ceremony
    this._config = { ...DEFAULT_CONFIG };
    this._cleanupTimer = null;
  }

  /**
   * Initialize with database and dependencies
   * @param {Object} db - Database manager
   * @param {Object} deps - { ctap2Protocol, didManager, ssoManager }
   */
  async initialize(db, deps = {}) {
    if (this.initialized) {
      return;
    }
    this.db = db;
    this._ctap2Protocol = deps.ctap2Protocol || null;
    this._didManager = deps.didManager || null;
    this._ssoManager = deps.ssoManager || null;

    this._ensureTables();
    this._loadPasskeys();
    this._startCleanupTimer();

    this.initialized = true;
    logger.info(
      `[WebAuthn] Initialized: ${this._passkeys.size} passkeys loaded`,
    );
  }

  // ============================================================
  // Table Setup
  // ============================================================

  _ensureTables() {
    if (!this.db) {
      return;
    }
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS webauthn_passkeys (
          id TEXT PRIMARY KEY,
          credential_id TEXT UNIQUE NOT NULL,
          rp_id TEXT NOT NULL,
          rp_name TEXT,
          user_id TEXT NOT NULL,
          user_name TEXT,
          user_display_name TEXT,
          public_key TEXT NOT NULL,
          algorithm INTEGER DEFAULT -7,
          sign_count INTEGER DEFAULT 0,
          transports TEXT DEFAULT '[]',
          did_binding TEXT,
          attestation_format TEXT DEFAULT 'packed',
          discoverable INTEGER DEFAULT 1,
          status TEXT DEFAULT 'active',
          last_used_at TEXT,
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS webauthn_ceremonies (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          challenge TEXT NOT NULL,
          rp_id TEXT NOT NULL,
          user_id TEXT,
          status TEXT DEFAULT 'pending',
          credential_id TEXT,
          expires_at TEXT NOT NULL,
          created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_passkey_credential ON webauthn_passkeys(credential_id);
        CREATE INDEX IF NOT EXISTS idx_passkey_user ON webauthn_passkeys(user_id);
        CREATE INDEX IF NOT EXISTS idx_passkey_rp ON webauthn_passkeys(rp_id);
        CREATE INDEX IF NOT EXISTS idx_passkey_status ON webauthn_passkeys(status);
        CREATE INDEX IF NOT EXISTS idx_ceremony_status ON webauthn_ceremonies(status);
        CREATE INDEX IF NOT EXISTS idx_ceremony_expires ON webauthn_ceremonies(expires_at);
      `);
      if (this.db.saveToFile) {
        this.db.saveToFile();
      }
    } catch (e) {
      logger.error("[WebAuthn] Table creation error:", e.message);
    }
  }

  // ============================================================
  // Configuration
  // ============================================================

  /**
   * Get current configuration
   * @returns {Object} Current config (copy)
   */
  getConfig() {
    return { ...this._config };
  }

  /**
   * Update configuration
   * @param {Object} updates - Configuration overrides
   */
  configure(updates = {}) {
    const validKeys = Object.keys(DEFAULT_CONFIG);
    for (const key of Object.keys(updates)) {
      if (validKeys.includes(key)) {
        this._config[key] = updates[key];
      }
    }

    if (updates.cleanupIntervalMs !== undefined) {
      this._startCleanupTimer();
    }

    logger.info(`[WebAuthn] Configuration updated: ${JSON.stringify(updates)}`);
  }

  // ============================================================
  // Registration Flow
  // ============================================================

  /**
   * Begin a registration ceremony
   * @param {string} rpId - Relying party ID
   * @param {string} rpName - Relying party display name
   * @param {string} userId - User identifier
   * @param {string} userName - User name
   * @param {Object} options - { displayName, attestation, authenticatorSelection }
   * @returns {Object} Registration options for the authenticator
   */
  async beginRegistration(rpId, rpName, userId, userName, options = {}) {
    if (!rpId || !userId) {
      throw new Error("rpId and userId are required");
    }

    const ceremony = this._createCeremony(
      CEREMONY_TYPE.REGISTRATION,
      rpId,
      userId,
    );

    // Collect existing credentials for this user to exclude
    const existingCredentials = this.listPasskeys({
      rpId,
      userId,
      status: PASSKEY_STATUS.ACTIVE,
    });
    const excludeCredentials = existingCredentials.map((pk) => ({
      type: "public-key",
      id: pk.credentialId,
      transports: pk.transports || [],
    }));

    const displayName = options.displayName || userName || userId;
    const attestation = options.attestation || this._config.attestation;
    const authenticatorSelection =
      options.authenticatorSelection || this._config.authenticatorSelection;

    const result = {
      ceremonyId: ceremony.id,
      challenge: ceremony.challenge,
      rp: { id: rpId, name: rpName || this._config.rpName },
      user: { id: userId, name: userName, displayName },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 }, // ES256
        { type: "public-key", alg: -257 }, // RS256
      ],
      authenticatorSelection,
      timeout: this._config.challengeTimeoutMs,
      attestation,
      excludeCredentials,
    };

    this.emit("ceremony:started", {
      ceremonyId: ceremony.id,
      type: CEREMONY_TYPE.REGISTRATION,
      rpId,
      userId,
    });

    logger.info(
      `[WebAuthn] Registration ceremony started: ${ceremony.id} for user ${userId}`,
    );

    return result;
  }

  /**
   * Complete a registration ceremony
   * @param {string} ceremonyId - Ceremony ID
   * @param {Object} attestationResponse - { credentialId, publicKey, algorithm, transports }
   * @returns {Object} Created passkey
   */
  async completeRegistration(ceremonyId, attestationResponse) {
    const ceremony = this._getCeremony(ceremonyId);
    if (!ceremony) {
      throw new Error(`Ceremony not found: ${ceremonyId}`);
    }
    if (ceremony.status !== CEREMONY_STATUS.PENDING) {
      throw new Error(`Ceremony is not pending: ${ceremony.status}`);
    }
    if (new Date(ceremony.expiresAt).getTime() < Date.now()) {
      this._completeCeremony(ceremonyId, null);
      throw new Error("Ceremony has expired");
    }
    if (ceremony.type !== CEREMONY_TYPE.REGISTRATION) {
      throw new Error(`Invalid ceremony type: ${ceremony.type}`);
    }

    if (
      !attestationResponse ||
      !attestationResponse.credentialId ||
      !attestationResponse.publicKey
    ) {
      throw new Error(
        "Invalid attestation response: credentialId and publicKey are required",
      );
    }

    const passkeyId = crypto.randomUUID();
    const passkey = {
      id: passkeyId,
      credentialId: attestationResponse.credentialId,
      rpId: ceremony.rpId,
      rpName: ceremony.rpName || this._config.rpName,
      userId: ceremony.userId,
      userName: null,
      userDisplayName: null,
      publicKey: attestationResponse.publicKey,
      algorithm: attestationResponse.algorithm || -7,
      signCount: 0,
      transports: attestationResponse.transports || [],
      didBinding: null,
      attestationFormat: ATTESTATION_FORMAT.PACKED,
      discoverable: true,
      status: PASSKEY_STATUS.ACTIVE,
      lastUsedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this._passkeys.set(passkey.credentialId, passkey);
    this._persistPasskey(passkey);
    this._completeCeremony(ceremonyId, passkey.credentialId);

    this.emit("passkey:registered", {
      passkeyId: passkey.id,
      credentialId: passkey.credentialId,
      rpId: passkey.rpId,
      userId: passkey.userId,
    });

    logger.info(
      `[WebAuthn] Passkey registered: ${passkey.credentialId} for user ${passkey.userId}`,
    );

    return passkey;
  }

  // ============================================================
  // Authentication Flow
  // ============================================================

  /**
   * Begin an authentication ceremony
   * @param {string} rpId - Relying party ID
   * @param {Object} options - { userId, userVerification }
   * @returns {Object} Authentication options for the authenticator
   */
  async beginAuthentication(rpId, options = {}) {
    if (!rpId) {
      throw new Error("rpId is required");
    }

    const ceremony = this._createCeremony(
      CEREMONY_TYPE.AUTHENTICATION,
      rpId,
      options.userId || null,
    );

    // Collect allowed credentials for this RP
    const filter = { rpId, status: PASSKEY_STATUS.ACTIVE };
    if (options.userId) {
      filter.userId = options.userId;
    }
    const allowedPasskeys = this.listPasskeys(filter);
    const allowCredentials = allowedPasskeys.map((pk) => ({
      type: "public-key",
      id: pk.credentialId,
      transports: pk.transports || [],
    }));

    const userVerification =
      options.userVerification ||
      this._config.authenticatorSelection.userVerification;

    const result = {
      ceremonyId: ceremony.id,
      challenge: ceremony.challenge,
      rpId,
      allowCredentials,
      timeout: this._config.challengeTimeoutMs,
      userVerification,
    };

    this.emit("ceremony:started", {
      ceremonyId: ceremony.id,
      type: CEREMONY_TYPE.AUTHENTICATION,
      rpId,
    });

    logger.info(
      `[WebAuthn] Authentication ceremony started: ${ceremony.id} for rp ${rpId}`,
    );

    return result;
  }

  /**
   * Complete an authentication ceremony
   * @param {string} ceremonyId - Ceremony ID
   * @param {Object} assertionResponse - { credentialId, signCount, signature }
   * @returns {Object} { authenticated, passkey, session }
   */
  async completeAuthentication(ceremonyId, assertionResponse) {
    const ceremony = this._getCeremony(ceremonyId);
    if (!ceremony) {
      throw new Error(`Ceremony not found: ${ceremonyId}`);
    }
    if (ceremony.status !== CEREMONY_STATUS.PENDING) {
      throw new Error(`Ceremony is not pending: ${ceremony.status}`);
    }
    if (new Date(ceremony.expiresAt).getTime() < Date.now()) {
      this._completeCeremony(ceremonyId, null);
      throw new Error("Ceremony has expired");
    }
    if (ceremony.type !== CEREMONY_TYPE.AUTHENTICATION) {
      throw new Error(`Invalid ceremony type: ${ceremony.type}`);
    }

    if (!assertionResponse || !assertionResponse.credentialId) {
      throw new Error("Invalid assertion response: credentialId is required");
    }

    const passkey = this._passkeys.get(assertionResponse.credentialId);
    if (!passkey) {
      throw new Error(`Passkey not found: ${assertionResponse.credentialId}`);
    }
    if (passkey.status !== PASSKEY_STATUS.ACTIVE) {
      throw new Error(`Passkey is not active: ${passkey.status}`);
    }

    // Sign count verification — must be greater than stored value
    const newSignCount = assertionResponse.signCount || 0;
    if (newSignCount > 0 && newSignCount <= passkey.signCount) {
      logger.warn(
        `[WebAuthn] Sign count regression detected for ${passkey.credentialId}: ` +
          `stored=${passkey.signCount}, received=${newSignCount}`,
      );
      throw new Error(
        "Sign count regression detected — possible cloned authenticator",
      );
    }

    // Update passkey state
    const now = new Date().toISOString();
    passkey.signCount = newSignCount;
    passkey.lastUsedAt = now;
    passkey.updatedAt = now;
    this._updatePasskey(passkey.id, {
      sign_count: newSignCount,
      last_used_at: now,
      updated_at: now,
    });

    this._completeCeremony(ceremonyId, passkey.credentialId);

    const session = {
      id: crypto.randomUUID(),
      userId: passkey.userId,
      authenticatedAt: now,
      expiresAt: new Date(
        Date.now() + this._config.challengeTimeoutMs * 60,
      ).toISOString(),
    };

    this.emit("passkey:authenticated", {
      passkeyId: passkey.id,
      credentialId: passkey.credentialId,
      userId: passkey.userId,
      sessionId: session.id,
    });

    logger.info(
      `[WebAuthn] Authentication successful: ${passkey.credentialId} for user ${passkey.userId}`,
    );

    return { authenticated: true, passkey, session };
  }

  // ============================================================
  // Passkey Management
  // ============================================================

  /**
   * List passkeys with optional filters
   * @param {Object} filter - { rpId, userId, status }
   * @returns {Array} Matching passkeys
   */
  listPasskeys(filter = {}) {
    const results = [];
    for (const passkey of this._passkeys.values()) {
      if (filter.rpId && passkey.rpId !== filter.rpId) {
        continue;
      }
      if (filter.userId && passkey.userId !== filter.userId) {
        continue;
      }
      if (filter.status && passkey.status !== filter.status) {
        continue;
      }
      results.push({ ...passkey });
    }
    return results;
  }

  /**
   * Delete (revoke) a passkey
   * @param {string} credentialId - Credential ID to revoke
   * @returns {boolean} True if deleted
   */
  deletePasskey(credentialId) {
    const passkey = this._passkeys.get(credentialId);
    if (!passkey) {
      return false;
    }

    passkey.status = PASSKEY_STATUS.REVOKED;
    passkey.updatedAt = new Date().toISOString();
    this._updatePasskey(passkey.id, {
      status: PASSKEY_STATUS.REVOKED,
      updated_at: passkey.updatedAt,
    });
    this._passkeys.delete(credentialId);

    this.emit("passkey:deleted", {
      passkeyId: passkey.id,
      credentialId,
      userId: passkey.userId,
    });

    logger.info(`[WebAuthn] Passkey revoked: ${credentialId}`);
    return true;
  }

  /**
   * Bind a passkey to a DID
   * @param {string} credentialId - Credential ID
   * @param {string} did - DID to bind
   * @returns {boolean} True if bound
   */
  bindDID(credentialId, did) {
    const passkey = this._passkeys.get(credentialId);
    if (!passkey) {
      throw new Error(`Passkey not found: ${credentialId}`);
    }

    passkey.didBinding = did;
    passkey.updatedAt = new Date().toISOString();
    this._updatePasskey(passkey.id, {
      did_binding: did,
      updated_at: passkey.updatedAt,
    });

    this.emit("passkey:did-bound", {
      credentialId,
      did,
      userId: passkey.userId,
    });

    logger.info(`[WebAuthn] Passkey ${credentialId} bound to DID ${did}`);
    return true;
  }

  /**
   * Unbind a DID from a passkey
   * @param {string} credentialId - Credential ID
   * @returns {boolean} True if unbound
   */
  unbindDID(credentialId) {
    const passkey = this._passkeys.get(credentialId);
    if (!passkey) {
      throw new Error(`Passkey not found: ${credentialId}`);
    }

    const previousDID = passkey.didBinding;
    passkey.didBinding = null;
    passkey.updatedAt = new Date().toISOString();
    this._updatePasskey(passkey.id, {
      did_binding: null,
      updated_at: passkey.updatedAt,
    });

    this.emit("passkey:did-unbound", {
      credentialId,
      previousDID,
      userId: passkey.userId,
    });

    logger.info(`[WebAuthn] Passkey ${credentialId} DID binding removed`);
    return true;
  }

  // ============================================================
  // Stats
  // ============================================================

  /**
   * Get statistics
   * @returns {Object} Stats object
   */
  getStats() {
    let activePasskeys = 0;
    let revokedPasskeys = 0;

    for (const passkey of this._passkeys.values()) {
      if (passkey.status === PASSKEY_STATUS.ACTIVE) {
        activePasskeys++;
      } else if (passkey.status === PASSKEY_STATUS.REVOKED) {
        revokedPasskeys++;
      }
    }

    // Count ceremonies from DB (in-memory ceremonies may have been cleaned)
    let totalCeremonies = 0;
    let pendingCeremonies = 0;

    if (this.db) {
      try {
        const countRow = this.db
          .prepare("SELECT COUNT(*) AS cnt FROM webauthn_ceremonies")
          .get();
        totalCeremonies = countRow ? countRow.cnt : 0;

        const pendingRow = this.db
          .prepare(
            "SELECT COUNT(*) AS cnt FROM webauthn_ceremonies WHERE status = ?",
          )
          .get(CEREMONY_STATUS.PENDING);
        pendingCeremonies = pendingRow ? pendingRow.cnt : 0;
      } catch (_e) {
        // Counts from in-memory if DB fails
        totalCeremonies = this._ceremonies.size;
        for (const c of this._ceremonies.values()) {
          if (c.status === CEREMONY_STATUS.PENDING) {
            pendingCeremonies++;
          }
        }
      }
    }

    return {
      totalPasskeys: this._passkeys.size + revokedPasskeys,
      activePasskeys,
      revokedPasskeys,
      totalCeremonies,
      pendingCeremonies,
    };
  }

  // ============================================================
  // Cleanup & Destroy
  // ============================================================

  /**
   * Destroy the manager and clean up timers
   */
  destroy() {
    if (this._cleanupTimer) {
      clearInterval(this._cleanupTimer);
      this._cleanupTimer = null;
    }
    this._passkeys.clear();
    this._ceremonies.clear();
    this.removeAllListeners();
    this.initialized = false;
    logger.info("[WebAuthn] Destroyed");
  }

  // ============================================================
  // Private — Challenge & Ceremony
  // ============================================================

  /**
   * Generate a cryptographic challenge
   * @returns {string} Base64url-encoded challenge
   */
  _generateChallenge() {
    return crypto
      .randomBytes(this._config.challengeLength)
      .toString("base64url");
  }

  /**
   * Create a new ceremony
   * @param {string} type - Ceremony type
   * @param {string} rpId - Relying party ID
   * @param {string} userId - User ID (nullable for authentication)
   * @returns {Object} Ceremony object
   */
  _createCeremony(type, rpId, userId) {
    const ceremonyId = crypto.randomUUID();
    const challenge = this._generateChallenge();
    const expiresAt = new Date(
      Date.now() + this._config.challengeTimeoutMs,
    ).toISOString();

    const ceremony = {
      id: ceremonyId,
      type,
      challenge,
      rpId,
      userId,
      status: CEREMONY_STATUS.PENDING,
      credentialId: null,
      expiresAt,
      createdAt: new Date().toISOString(),
    };

    this._ceremonies.set(ceremonyId, ceremony);

    // Persist to DB
    if (this.db) {
      try {
        this.db
          .prepare(
            `INSERT INTO webauthn_ceremonies
              (id, type, challenge, rp_id, user_id, status, credential_id, expires_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            ceremony.id,
            ceremony.type,
            ceremony.challenge,
            ceremony.rpId,
            ceremony.userId,
            ceremony.status,
            ceremony.credentialId,
            ceremony.expiresAt,
          );
        if (this.db.saveToFile) {
          this.db.saveToFile();
        }
      } catch (e) {
        logger.error("[WebAuthn] Ceremony persist error:", e.message);
      }
    }

    return ceremony;
  }

  /**
   * Get a ceremony by ID
   * @param {string} ceremonyId - Ceremony ID
   * @returns {Object|null} Ceremony or null
   */
  _getCeremony(ceremonyId) {
    return this._ceremonies.get(ceremonyId) || null;
  }

  /**
   * Mark a ceremony as completed
   * @param {string} ceremonyId - Ceremony ID
   * @param {string|null} credentialId - Associated credential ID
   */
  _completeCeremony(ceremonyId, credentialId) {
    const ceremony = this._ceremonies.get(ceremonyId);
    if (!ceremony) {
      return;
    }

    ceremony.status = credentialId
      ? CEREMONY_STATUS.COMPLETED
      : CEREMONY_STATUS.FAILED;
    ceremony.credentialId = credentialId;

    if (this.db) {
      try {
        this.db
          .prepare(
            "UPDATE webauthn_ceremonies SET status = ?, credential_id = ? WHERE id = ?",
          )
          .run(ceremony.status, credentialId, ceremonyId);
        if (this.db.saveToFile) {
          this.db.saveToFile();
        }
      } catch (e) {
        logger.error("[WebAuthn] Ceremony update error:", e.message);
      }
    }
  }

  // ============================================================
  // Private — Passkey Persistence
  // ============================================================

  _loadPasskeys() {
    if (!this.db) {
      return;
    }
    try {
      const rows = this.db
        .prepare("SELECT * FROM webauthn_passkeys WHERE status = ?")
        .all(PASSKEY_STATUS.ACTIVE);

      for (const row of rows) {
        const passkey = this._rowToPasskey(row);
        this._passkeys.set(passkey.credentialId, passkey);
      }
    } catch (e) {
      logger.warn("[WebAuthn] Passkey load error:", e.message);
    }
  }

  _persistPasskey(passkey) {
    if (!this.db) {
      return;
    }
    try {
      this.db
        .prepare(
          `INSERT INTO webauthn_passkeys
            (id, credential_id, rp_id, rp_name, user_id, user_name, user_display_name,
             public_key, algorithm, sign_count, transports, did_binding,
             attestation_format, discoverable, status, last_used_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          passkey.id,
          passkey.credentialId,
          passkey.rpId,
          passkey.rpName,
          passkey.userId,
          passkey.userName,
          passkey.userDisplayName,
          passkey.publicKey,
          passkey.algorithm,
          passkey.signCount,
          JSON.stringify(passkey.transports),
          passkey.didBinding,
          passkey.attestationFormat,
          passkey.discoverable ? 1 : 0,
          passkey.status,
          passkey.lastUsedAt,
          passkey.createdAt,
          passkey.updatedAt,
        );
      if (this.db.saveToFile) {
        this.db.saveToFile();
      }
    } catch (e) {
      logger.error("[WebAuthn] Passkey persist error:", e.message);
    }
  }

  _updatePasskey(id, updates) {
    if (!this.db) {
      return;
    }
    try {
      const setClauses = [];
      const values = [];
      for (const [col, val] of Object.entries(updates)) {
        setClauses.push(`${col} = ?`);
        values.push(val);
      }
      values.push(id);
      this.db
        .prepare(
          `UPDATE webauthn_passkeys SET ${setClauses.join(", ")} WHERE id = ?`,
        )
        .run(...values);
      if (this.db.saveToFile) {
        this.db.saveToFile();
      }
    } catch (e) {
      logger.error("[WebAuthn] Passkey update error:", e.message);
    }
  }

  // ============================================================
  // Private — Cleanup
  // ============================================================

  _startCleanupTimer() {
    if (this._cleanupTimer) {
      clearInterval(this._cleanupTimer);
    }
    this._cleanupTimer = setInterval(() => {
      this._cleanupExpiredCeremonies();
    }, this._config.cleanupIntervalMs);

    // Avoid keeping Node process alive
    if (this._cleanupTimer.unref) {
      this._cleanupTimer.unref();
    }
  }

  _cleanupExpiredCeremonies() {
    const now = Date.now();
    let cleaned = 0;

    for (const [id, ceremony] of this._ceremonies.entries()) {
      if (
        ceremony.status === CEREMONY_STATUS.PENDING &&
        new Date(ceremony.expiresAt).getTime() < now
      ) {
        ceremony.status = CEREMONY_STATUS.EXPIRED;
        this._ceremonies.delete(id);
        cleaned++;
      }
    }

    // Also clean up in DB
    if (this.db) {
      try {
        this.db
          .prepare(
            "UPDATE webauthn_ceremonies SET status = ? WHERE status = ? AND expires_at < datetime('now')",
          )
          .run(CEREMONY_STATUS.EXPIRED, CEREMONY_STATUS.PENDING);
        if (this.db.saveToFile) {
          this.db.saveToFile();
        }
      } catch (e) {
        logger.warn("[WebAuthn] Ceremony cleanup error:", e.message);
      }
    }

    if (cleaned > 0) {
      logger.info(`[WebAuthn] Cleaned up ${cleaned} expired ceremonies`);
    }
  }

  // ============================================================
  // Private — Row Mapping
  // ============================================================

  _rowToPasskey(row) {
    return {
      id: row.id,
      credentialId: row.credential_id,
      rpId: row.rp_id,
      rpName: row.rp_name,
      userId: row.user_id,
      userName: row.user_name,
      userDisplayName: row.user_display_name,
      publicKey: row.public_key,
      algorithm: row.algorithm,
      signCount: row.sign_count,
      transports: safeParseJSON(row.transports) || [],
      didBinding: row.did_binding,
      attestationFormat: row.attestation_format,
      discoverable: !!row.discoverable,
      status: row.status,
      lastUsedAt: row.last_used_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

// ============================================================
// Utility
// ============================================================

function safeParseJSON(str) {
  if (!str) {
    return null;
  }
  if (typeof str === "object") {
    return str;
  }
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

// Singleton
let instance = null;

function getWebAuthnPasskeyManager() {
  if (!instance) {
    instance = new WebAuthnPasskeyManager();
  }
  return instance;
}

module.exports = {
  WebAuthnPasskeyManager,
  getWebAuthnPasskeyManager,
  PASSKEY_STATUS,
  CEREMONY_TYPE,
  CEREMONY_STATUS,
};
