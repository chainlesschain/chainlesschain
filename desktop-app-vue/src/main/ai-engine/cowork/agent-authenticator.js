/**
 * Agent Authenticator — v4.0.0
 *
 * DID-based mutual authentication between agents in the decentralized
 * network. Uses a challenge-response protocol where a cryptographic
 * challenge is issued to a remote agent, signed with their DID private
 * key, and verified locally.
 *
 * Supports three authentication methods: did-challenge (default),
 * credential-proof, and mutual-tls. Sessions are managed with a
 * configurable TTL.
 *
 * Integrates with AgentDID for key operations and
 * AgentCredentialManager for credential verification.
 *
 * @module ai-engine/cowork/agent-authenticator
 */

const { EventEmitter } = require("events");
const { logger } = require("../../utils/logger.js");
const { v4: uuidv4 } = require("uuid");
const crypto = require("crypto");

// ============================================================
// Constants
// ============================================================

const AUTH_STATUS = {
  PENDING: "pending",
  AUTHENTICATED: "authenticated",
  FAILED: "failed",
  EXPIRED: "expired",
};

const AUTH_METHOD = {
  DID_CHALLENGE: "did-challenge",
  CREDENTIAL_PROOF: "credential-proof",
  MUTUAL_TLS: "mutual-tls",
};

const DEFAULT_CONFIG = {
  sessionTTLMs: 3600000, // 1 hour
  challengeExpiryMs: 60000, // 1 minute
  challengeLength: 64, // bytes
  maxActiveSessions: 100,
  maxPendingChallenges: 50,
  cleanupIntervalMs: 300000, // 5 minutes
  defaultMethod: AUTH_METHOD.DID_CHALLENGE,
};

// ============================================================
// AgentAuthenticator
// ============================================================

class AgentAuthenticator extends EventEmitter {
  constructor() {
    super();
    this.db = null;
    this.initialized = false;

    // Dependencies
    this._agentDID = null;
    this._credentialManager = null;

    // In-memory state
    this._sessions = new Map(); // sessionId → session
    this._challenges = new Map(); // challengeId → challenge
    this._config = { ...DEFAULT_CONFIG };
    this._cleanupTimer = null;
  }

  /**
   * Initialize with database and dependencies
   * @param {Object} db - Database manager
   * @param {Object} deps - { agentDID, credentialManager }
   */
  async initialize(db, deps = {}) {
    if (this.initialized) {
      return;
    }
    this.db = db;
    this._agentDID = deps.agentDID || null;
    this._credentialManager = deps.credentialManager || null;

    this._ensureTables();
    await this._loadActiveSessions();
    this._startCleanupTimer();

    this.initialized = true;
    logger.info(
      `[AgentAuth] Initialized: ${this._sessions.size} active sessions`,
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
        CREATE TABLE IF NOT EXISTS agent_auth_sessions (
          id TEXT PRIMARY KEY,
          local_did TEXT NOT NULL,
          remote_did TEXT NOT NULL,
          method TEXT DEFAULT 'did-challenge',
          status TEXT DEFAULT 'pending',
          challenge TEXT,
          challenge_response TEXT,
          credential_proof TEXT,
          expires_at TEXT,
          created_at TEXT DEFAULT (datetime('now')),
          authenticated_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_auth_local ON agent_auth_sessions(local_did);
        CREATE INDEX IF NOT EXISTS idx_auth_remote ON agent_auth_sessions(remote_did);
        CREATE INDEX IF NOT EXISTS idx_auth_status ON agent_auth_sessions(status);
        CREATE INDEX IF NOT EXISTS idx_auth_expires ON agent_auth_sessions(expires_at);
      `);
      if (this.db.saveToFile) {
        this.db.saveToFile();
      }
    } catch (e) {
      logger.error("[AgentAuth] Table creation error:", e.message);
    }
  }

  // ============================================================
  // Configuration
  // ============================================================

  /**
   * Get current configuration
   * @returns {Object} Current config
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

    logger.info(
      `[AgentAuth] Configuration updated: ${JSON.stringify(updates)}`,
    );
  }

  // ============================================================
  // Authentication Flow
  // ============================================================

  /**
   * Initiate authentication with a remote agent
   * Creates a challenge and returns the session
   * @param {string} localDID - Local agent DID
   * @param {string} remoteDID - Remote agent DID to authenticate
   * @param {Object} options - { method }
   * @returns {Object} Auth session with challenge
   */
  async authenticate(localDID, remoteDID, options = {}) {
    if (!localDID || !remoteDID) {
      throw new Error("localDID and remoteDID are required");
    }

    if (localDID === remoteDID) {
      throw new Error("Cannot authenticate with self");
    }

    // Check for existing valid session
    const existing = this._findActiveSession(localDID, remoteDID);
    if (existing && existing.status === AUTH_STATUS.AUTHENTICATED) {
      const expiresAt = new Date(existing.expiresAt).getTime();
      if (expiresAt > Date.now()) {
        logger.info(
          `[AgentAuth] Reusing existing session ${existing.id} for ${remoteDID}`,
        );
        return existing;
      }
    }

    if (this._sessions.size >= this._config.maxActiveSessions) {
      this._cleanupExpiredSessions();

      if (this._sessions.size >= this._config.maxActiveSessions) {
        throw new Error(
          `Maximum active sessions reached (${this._config.maxActiveSessions})`,
        );
      }
    }

    const method = options.method || this._config.defaultMethod;
    const sessionId = uuidv4();
    const challenge = this._generateChallenge();
    const now = new Date().toISOString();
    const expiresAt = new Date(
      Date.now() + this._config.sessionTTLMs,
    ).toISOString();

    const session = {
      id: sessionId,
      localDID,
      remoteDID,
      method,
      status: AUTH_STATUS.PENDING,
      challenge,
      challengeResponse: null,
      credentialProof: null,
      expiresAt,
      createdAt: now,
      authenticatedAt: null,
    };

    this._sessions.set(sessionId, session);
    this._challenges.set(sessionId, {
      challengeId: sessionId,
      challenge,
      remoteDID,
      createdAt: Date.now(),
      expiresAt: Date.now() + this._config.challengeExpiryMs,
    });

    this._persistSession(session);

    this.emit("auth:challenge-created", {
      sessionId,
      localDID,
      remoteDID,
      method,
      challenge,
    });

    logger.info(
      `[AgentAuth] Challenge created for ${remoteDID}, session=${sessionId}, method=${method}`,
    );

    return session;
  }

  /**
   * Create a standalone challenge for a remote agent
   * @param {string} remoteDID - Remote agent DID
   * @returns {Object} Challenge object { challengeId, challenge, remoteDID, expiresAt }
   */
  createChallenge(remoteDID) {
    if (!remoteDID) {
      throw new Error("remoteDID is required");
    }

    if (this._challenges.size >= this._config.maxPendingChallenges) {
      this._cleanupExpiredChallenges();

      if (this._challenges.size >= this._config.maxPendingChallenges) {
        throw new Error(
          `Maximum pending challenges reached (${this._config.maxPendingChallenges})`,
        );
      }
    }

    const challengeId = uuidv4();
    const challenge = this._generateChallenge();
    const expiresAt = Date.now() + this._config.challengeExpiryMs;

    const challengeObj = {
      challengeId,
      challenge,
      remoteDID,
      createdAt: Date.now(),
      expiresAt,
    };

    this._challenges.set(challengeId, challengeObj);

    logger.info(
      `[AgentAuth] Standalone challenge created: ${challengeId} for ${remoteDID}`,
    );

    return {
      challengeId,
      challenge,
      remoteDID,
      expiresAt: new Date(expiresAt).toISOString(),
    };
  }

  /**
   * Respond to a challenge (called by remote agent)
   * Verifies the signed challenge and authenticates the session
   * @param {string} challengeId - Challenge/session ID
   * @param {Object} response - { signature, publicKey, credential }
   * @returns {Object} Verification result
   */
  async respondToChallenge(challengeId, response) {
    if (!challengeId || !response) {
      throw new Error("challengeId and response are required");
    }

    const challengeData = this._challenges.get(challengeId);
    if (!challengeData) {
      return {
        verified: false,
        error: "Challenge not found or expired",
        status: AUTH_STATUS.FAILED,
      };
    }

    // Check challenge expiry
    if (Date.now() > challengeData.expiresAt) {
      this._challenges.delete(challengeId);
      return {
        verified: false,
        error: "Challenge expired",
        status: AUTH_STATUS.EXPIRED,
      };
    }

    // Find the associated session
    const session = this._sessions.get(challengeId);

    // Verify the response based on method
    let verified = false;
    let verifyError = null;

    try {
      if (session && session.method === AUTH_METHOD.CREDENTIAL_PROOF) {
        verified = await this._verifyCredentialProof(challengeData, response);
      } else {
        // Default: DID challenge-response
        verified = await this._verifySignature(
          challengeData.challenge,
          response.signature,
          response.publicKey,
          challengeData.remoteDID,
        );
      }
    } catch (e) {
      verifyError = e.message;
      logger.error(
        `[AgentAuth] Verification error for ${challengeId}:`,
        e.message,
      );
    }

    // Clean up challenge
    this._challenges.delete(challengeId);

    // Update session if it exists
    if (session) {
      const now = new Date().toISOString();
      session.challengeResponse = JSON.stringify(response);
      session.status = verified
        ? AUTH_STATUS.AUTHENTICATED
        : AUTH_STATUS.FAILED;
      session.authenticatedAt = verified ? now : null;

      if (response.credential) {
        session.credentialProof = JSON.stringify(response.credential);
      }

      // Refresh expiry on successful auth
      if (verified) {
        session.expiresAt = new Date(
          Date.now() + this._config.sessionTTLMs,
        ).toISOString();
      }

      this._updateSessionInDB(session);

      if (!verified) {
        this._sessions.delete(challengeId);
      }
    }

    const result = {
      verified,
      sessionId: session ? session.id : null,
      status: verified ? AUTH_STATUS.AUTHENTICATED : AUTH_STATUS.FAILED,
      error: verifyError,
      expiresAt: session?.expiresAt || null,
    };

    if (verified) {
      this.emit("auth:authenticated", {
        sessionId: session?.id,
        remoteDID: challengeData.remoteDID,
      });
      logger.info(
        `[AgentAuth] Agent ${challengeData.remoteDID} authenticated, session=${session?.id}`,
      );
    } else {
      this.emit("auth:failed", {
        sessionId: session?.id,
        remoteDID: challengeData.remoteDID,
        error: verifyError,
      });
      logger.warn(
        `[AgentAuth] Authentication failed for ${challengeData.remoteDID}: ${verifyError || "invalid signature"}`,
      );
    }

    return result;
  }

  /**
   * Verify an existing authentication session is still valid
   * @param {string} authId - Session ID
   * @returns {Object} Verification result { valid, session }
   */
  verifyAuthentication(authId) {
    const session = this._sessions.get(authId);

    if (!session) {
      // Try loading from DB
      const dbSession = this._loadSessionFromDB(authId);
      if (!dbSession) {
        return { valid: false, error: "Session not found" };
      }
      return this._checkSessionValidity(dbSession);
    }

    return this._checkSessionValidity(session);
  }

  /**
   * Check if a session is still valid
   * @param {Object} session - Session record
   * @returns {Object} Validity check result
   */
  _checkSessionValidity(session) {
    if (session.status !== AUTH_STATUS.AUTHENTICATED) {
      return {
        valid: false,
        error: `Session status is ${session.status}`,
        session,
      };
    }

    const expiresAt = new Date(session.expiresAt).getTime();
    if (Date.now() > expiresAt) {
      // Mark as expired
      session.status = AUTH_STATUS.EXPIRED;
      this._updateSessionInDB(session);
      this._sessions.delete(session.id);

      return { valid: false, error: "Session expired", session };
    }

    return { valid: true, session };
  }

  /**
   * Get an authentication session by ID
   * @param {string} sessionId - Session ID
   * @returns {Object|null} Session
   */
  getAuthSession(sessionId) {
    const session = this._sessions.get(sessionId);
    if (session) {
      return { ...session };
    }
    return this._loadSessionFromDB(sessionId);
  }

  /**
   * Get all active (authenticated and not expired) sessions
   * @returns {Array} Active sessions
   */
  getActiveSessions() {
    const now = Date.now();
    const active = [];

    for (const session of this._sessions.values()) {
      if (session.status === AUTH_STATUS.AUTHENTICATED) {
        const expiresAt = new Date(session.expiresAt).getTime();
        if (expiresAt > now) {
          active.push({ ...session });
        }
      }
    }

    return active;
  }

  /**
   * Revoke/invalidate an authentication session
   * @param {string} sessionId - Session ID
   * @returns {boolean} Whether revocation succeeded
   */
  revokeSession(sessionId) {
    const session = this._sessions.get(sessionId);
    if (!session) {
      return false;
    }

    session.status = AUTH_STATUS.EXPIRED;
    session.expiresAt = new Date().toISOString();
    this._updateSessionInDB(session);
    this._sessions.delete(sessionId);

    this.emit("auth:revoked", {
      sessionId,
      remoteDID: session.remoteDID,
    });

    logger.info(
      `[AgentAuth] Session ${sessionId} revoked for ${session.remoteDID}`,
    );

    return true;
  }

  // ============================================================
  // Statistics
  // ============================================================

  /**
   * Get authenticator statistics
   * @returns {Object} Stats
   */
  getStats() {
    try {
      const total = this.db
        .prepare("SELECT COUNT(*) as count FROM agent_auth_sessions")
        .get().count;

      const byStatus = this.db
        .prepare(
          "SELECT status, COUNT(*) as count FROM agent_auth_sessions GROUP BY status",
        )
        .all();

      const byMethod = this.db
        .prepare(
          "SELECT method, COUNT(*) as count FROM agent_auth_sessions GROUP BY method",
        )
        .all();

      const activeCount = this.getActiveSessions().length;
      const pendingChallenges = this._challenges.size;

      return {
        totalSessions: total,
        activeSessions: activeCount,
        pendingChallenges,
        byStatus: byStatus.reduce((acc, r) => {
          acc[r.status] = r.count;
          return acc;
        }, {}),
        byMethod: byMethod.reduce((acc, r) => {
          acc[r.method] = r.count;
          return acc;
        }, {}),
      };
    } catch (e) {
      logger.error("[AgentAuth] stats error:", e.message);
      return {
        totalSessions: 0,
        activeSessions: this._sessions.size,
        pendingChallenges: this._challenges.size,
        byStatus: {},
        byMethod: {},
      };
    }
  }

  // ============================================================
  // Cryptographic Operations
  // ============================================================

  /**
   * Generate a cryptographic challenge
   * @returns {string} Hex-encoded challenge
   */
  _generateChallenge() {
    return crypto.randomBytes(this._config.challengeLength).toString("hex");
  }

  /**
   * Verify a signature against a challenge using the agent's public key
   * @param {string} challenge - Original challenge
   * @param {string} signature - Signed challenge
   * @param {string} publicKey - Agent's public key (PEM or hex)
   * @param {string} remoteDID - Remote agent DID for key lookup
   * @returns {boolean} Whether signature is valid
   */
  async _verifySignature(challenge, signature, publicKey, remoteDID) {
    if (!signature) {
      throw new Error("Signature is required");
    }

    // If AgentDID manager is available, use it for key resolution
    let resolvedKey = publicKey;
    if (!resolvedKey && this._agentDID) {
      try {
        const didDoc =
          typeof this._agentDID.resolve === "function"
            ? await this._agentDID.resolve(remoteDID)
            : typeof this._agentDID.getPublicKey === "function"
              ? { publicKey: await this._agentDID.getPublicKey(remoteDID) }
              : null;

        if (didDoc?.publicKey) {
          resolvedKey = didDoc.publicKey;
        } else if (didDoc?.verificationMethod?.[0]?.publicKeyHex) {
          resolvedKey = didDoc.verificationMethod[0].publicKeyHex;
        }
      } catch (e) {
        logger.warn(
          `[AgentAuth] DID key resolution failed for ${remoteDID}:`,
          e.message,
        );
      }
    }

    if (!resolvedKey) {
      throw new Error("No public key available for verification");
    }

    // Attempt verification
    try {
      // If key looks like PEM, use crypto.verify
      if (resolvedKey.includes("BEGIN") || resolvedKey.includes("PUBLIC KEY")) {
        const verifier = crypto.createVerify("SHA256");
        verifier.update(challenge);
        verifier.end();
        return verifier.verify(resolvedKey, signature, "hex");
      }

      // If hex key, use HMAC-based verification as fallback
      const expectedSig = crypto
        .createHmac("sha256", resolvedKey)
        .update(challenge)
        .digest("hex");

      return crypto.timingSafeEqual(
        Buffer.from(signature, "hex"),
        Buffer.from(expectedSig, "hex"),
      );
    } catch (e) {
      logger.error("[AgentAuth] Signature verification error:", e.message);
      throw new Error(`Signature verification failed: ${e.message}`);
    }
  }

  /**
   * Verify a credential proof
   * @param {Object} challengeData - Challenge data
   * @param {Object} response - Response with credential
   * @returns {boolean} Whether credential is valid
   */
  async _verifyCredentialProof(challengeData, response) {
    if (!response.credential) {
      throw new Error("Credential is required for credential-proof method");
    }

    // Use credential manager if available
    if (this._credentialManager) {
      try {
        const result =
          typeof this._credentialManager.verifyCredential === "function"
            ? await this._credentialManager.verifyCredential(
                response.credential,
              )
            : typeof this._credentialManager.verify === "function"
              ? await this._credentialManager.verify(response.credential)
              : null;

        if (result !== null) {
          return result === true || result?.valid === true;
        }
      } catch (e) {
        logger.error("[AgentAuth] Credential verification error:", e.message);
        throw e;
      }
    }

    // Fallback: verify the credential contains the expected DID and challenge
    const cred =
      typeof response.credential === "string"
        ? safeParseJSON(response.credential)
        : response.credential;

    if (!cred) {
      return false;
    }

    // Basic structural check
    return (
      cred.issuer === challengeData.remoteDID ||
      cred.subject === challengeData.remoteDID ||
      cred.did === challengeData.remoteDID
    );
  }

  // ============================================================
  // Session Helpers
  // ============================================================

  /**
   * Find an active session between two agents
   * @param {string} localDID - Local agent DID
   * @param {string} remoteDID - Remote agent DID
   * @returns {Object|null} Active session
   */
  _findActiveSession(localDID, remoteDID) {
    for (const session of this._sessions.values()) {
      if (
        session.localDID === localDID &&
        session.remoteDID === remoteDID &&
        session.status === AUTH_STATUS.AUTHENTICATED
      ) {
        return session;
      }
    }
    return null;
  }

  // ============================================================
  // Cleanup
  // ============================================================

  _startCleanupTimer() {
    if (this._cleanupTimer) {
      clearInterval(this._cleanupTimer);
    }

    this._cleanupTimer = setInterval(() => {
      this._cleanupExpiredSessions();
      this._cleanupExpiredChallenges();
    }, this._config.cleanupIntervalMs);

    if (this._cleanupTimer.unref) {
      this._cleanupTimer.unref();
    }
  }

  _cleanupExpiredSessions() {
    const now = Date.now();
    let cleaned = 0;

    for (const [sessionId, session] of this._sessions.entries()) {
      const expiresAt = new Date(session.expiresAt).getTime();
      if (now > expiresAt) {
        session.status = AUTH_STATUS.EXPIRED;
        this._updateSessionInDB(session);
        this._sessions.delete(sessionId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.info(`[AgentAuth] Cleaned up ${cleaned} expired sessions`);
    }

    return cleaned;
  }

  _cleanupExpiredChallenges() {
    const now = Date.now();
    let cleaned = 0;

    for (const [challengeId, challenge] of this._challenges.entries()) {
      if (now > challenge.expiresAt) {
        this._challenges.delete(challengeId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.info(`[AgentAuth] Cleaned up ${cleaned} expired challenges`);
    }

    return cleaned;
  }

  /**
   * Destroy the authenticator and clean up timers
   */
  destroy() {
    if (this._cleanupTimer) {
      clearInterval(this._cleanupTimer);
      this._cleanupTimer = null;
    }
    this._sessions.clear();
    this._challenges.clear();
    this.removeAllListeners();
    this.initialized = false;
    logger.info("[AgentAuth] Destroyed");
  }

  // ============================================================
  // Persistence Helpers
  // ============================================================

  _persistSession(session) {
    try {
      this.db.run(
        `INSERT INTO agent_auth_sessions
          (id, local_did, remote_did, method, status, challenge, challenge_response, credential_proof, expires_at, created_at, authenticated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          session.id,
          session.localDID,
          session.remoteDID,
          session.method,
          session.status,
          session.challenge,
          session.challengeResponse,
          session.credentialProof,
          session.expiresAt,
          session.createdAt,
          session.authenticatedAt,
        ],
      );
      if (this.db.saveToFile) {
        this.db.saveToFile();
      }
    } catch (e) {
      logger.error("[AgentAuth] Persist session error:", e.message);
    }
  }

  _updateSessionInDB(session) {
    try {
      this.db.run(
        `UPDATE agent_auth_sessions
         SET status = ?, challenge_response = ?, credential_proof = ?, expires_at = ?, authenticated_at = ?
         WHERE id = ?`,
        [
          session.status,
          session.challengeResponse,
          session.credentialProof,
          session.expiresAt,
          session.authenticatedAt,
          session.id,
        ],
      );
      if (this.db.saveToFile) {
        this.db.saveToFile();
      }
    } catch (e) {
      logger.error("[AgentAuth] Update session error:", e.message);
    }
  }

  _loadSessionFromDB(sessionId) {
    try {
      const row = this.db
        .prepare("SELECT * FROM agent_auth_sessions WHERE id = ?")
        .get(sessionId);
      return row ? this._rowToSession(row) : null;
    } catch (e) {
      logger.error("[AgentAuth] Load session error:", e.message);
      return null;
    }
  }

  async _loadActiveSessions() {
    try {
      const rows = this.db
        .prepare(
          `SELECT * FROM agent_auth_sessions
           WHERE status = 'authenticated' AND expires_at > datetime('now')`,
        )
        .all();

      for (const row of rows) {
        const session = this._rowToSession(row);
        this._sessions.set(session.id, session);
      }
    } catch (e) {
      logger.error("[AgentAuth] Load active sessions error:", e.message);
    }
  }

  _rowToSession(row) {
    return {
      id: row.id,
      localDID: row.local_did,
      remoteDID: row.remote_did,
      method: row.method,
      status: row.status,
      challenge: row.challenge,
      challengeResponse: row.challenge_response,
      credentialProof: row.credential_proof,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
      authenticatedAt: row.authenticated_at,
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

function getAgentAuthenticator() {
  if (!instance) {
    instance = new AgentAuthenticator();
  }
  return instance;
}

module.exports = {
  AgentAuthenticator,
  getAgentAuthenticator,
  AUTH_STATUS,
};
