/**
 * SSOManager - Multi-provider SSO coordinator
 *
 * Enterprise Single Sign-On manager supporting SAML 2.0, OAuth 2.0, and OpenID Connect.
 * Coordinates authentication flows across multiple identity providers with secure
 * token storage, session management, and PKCE support.
 *
 * Features:
 * - Multi-provider SSO configuration (SAML, OAuth 2.0, OIDC)
 * - PKCE (Proof Key for Code Exchange) for OAuth/OIDC flows
 * - Secure token encryption with AES-256-GCM
 * - Session lifecycle management (create, refresh, revoke)
 * - Provider connectivity testing
 * - Automatic token refresh for active sessions
 *
 * Database tables:
 * - sso_configurations: Provider configuration storage
 * - sso_sessions: Active SSO session tracking
 *
 * @module auth/sso-manager
 * @since v0.34.0
 */

const { logger } = require('../utils/logger.js');
const { v4: uuidv4 } = require('uuid');
const { EventEmitter } = require('events');
const crypto = require('crypto');

// ─── Provider Types ───

const ProviderType = {
  SAML: 'saml',
  OAUTH2: 'oauth2',
  OIDC: 'oidc'
};

const VALID_PROVIDER_TYPES = Object.values(ProviderType);

// ─── Session States ───

const SessionState = {
  ACTIVE: 'active',
  EXPIRED: 'expired',
  REVOKED: 'revoked',
  REFRESHING: 'refreshing'
};

// ─── Encryption Constants ───

const ENCRYPTION_ALGORITHM = 'aes-256-gcm';
const ENCRYPTION_KEY_LENGTH = 32;
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const ENCODING = 'hex';

// ─── Default Configuration ───

const DEFAULT_CONFIG = {
  sessionTimeout: 3600000,           // 1 hour
  tokenRefreshThreshold: 300000,     // 5 minutes before expiry
  maxSessionsPerUser: 5,
  enableAutoRefresh: true,
  encryptionKeyEnvVar: 'SSO_ENCRYPTION_KEY'
};

// ─── Required Fields Per Provider Type ───

const REQUIRED_FIELDS = {
  [ProviderType.OAUTH2]: ['clientId', 'authorizationEndpoint', 'tokenEndpoint', 'redirectUri'],
  [ProviderType.OIDC]: ['clientId', 'authorizationEndpoint', 'tokenEndpoint', 'redirectUri', 'userinfoEndpoint'],
  [ProviderType.SAML]: ['entityId', 'idpEntityId', 'ssoUrl', 'certificate', 'assertionConsumerUrl']
};

// ─── Main Class ───

class SSOManager extends EventEmitter {
  /**
   * Create an SSOManager instance
   * @param {Object} options - Configuration options
   * @param {Object} options.database - Database instance for persistence
   * @param {Object} [options.config] - Additional configuration overrides
   */
  constructor({ database, config = {} } = {}) {
    super();

    if (!database) {
      throw new Error('[SSOManager] database parameter is required');
    }

    this.database = database;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this._tableInitialized = false;
    this._encryptionKey = null;
    this._providerCache = new Map();
    this._sessionCache = new Map();
    this._refreshTimers = new Map();
    this._pendingStates = new Map(); // state -> { providerId, codeVerifier, timestamp }

    // Lazy-load provider implementations
    this._oauthProviderClass = null;
    this._samlProviderClass = null;

    // Initialize database tables
    this._initTables().catch(err => {
      logger.error('[SSOManager] Failed to initialize tables:', err);
    });

    // Derive encryption key
    this._initEncryptionKey();

    logger.info('[SSOManager] Initialized with config:', {
      sessionTimeout: this.config.sessionTimeout,
      maxSessionsPerUser: this.config.maxSessionsPerUser,
      enableAutoRefresh: this.config.enableAutoRefresh
    });
  }

  // ════════════════════════════════════════════
  // Database Initialization
  // ════════════════════════════════════════════

  /**
   * Initialize database tables for SSO
   * @private
   */
  async _initTables() {
    try {
      // SSO provider configurations table
      await this.database.run(`
        CREATE TABLE IF NOT EXISTS sso_configurations (
          id TEXT PRIMARY KEY,
          provider_type TEXT NOT NULL,
          provider_name TEXT NOT NULL,
          config TEXT NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 1,
          metadata TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )
      `);

      // SSO sessions table
      await this.database.run(`
        CREATE TABLE IF NOT EXISTS sso_sessions (
          id TEXT PRIMARY KEY,
          provider_id TEXT NOT NULL,
          user_did TEXT,
          external_user_id TEXT,
          access_token TEXT,
          refresh_token TEXT,
          id_token TEXT,
          token_type TEXT DEFAULT 'Bearer',
          expires_at INTEGER,
          refresh_expires_at INTEGER,
          scopes TEXT,
          user_info TEXT,
          state TEXT NOT NULL DEFAULT 'active',
          saml_session_index TEXT,
          saml_name_id TEXT,
          ip_address TEXT,
          user_agent TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          FOREIGN KEY (provider_id) REFERENCES sso_configurations(id)
        )
      `);

      // Create indexes
      const indexes = [
        { name: 'idx_sso_config_type', table: 'sso_configurations', column: 'provider_type' },
        { name: 'idx_sso_config_enabled', table: 'sso_configurations', column: 'enabled' },
        { name: 'idx_sso_session_provider', table: 'sso_sessions', column: 'provider_id' },
        { name: 'idx_sso_session_user', table: 'sso_sessions', column: 'user_did' },
        { name: 'idx_sso_session_state', table: 'sso_sessions', column: 'state' },
        { name: 'idx_sso_session_expires', table: 'sso_sessions', column: 'expires_at' }
      ];

      for (const idx of indexes) {
        await this.database.run(
          `CREATE INDEX IF NOT EXISTS ${idx.name} ON ${idx.table}(${idx.column})`
        );
      }

      this._tableInitialized = true;
      logger.info('[SSOManager] Database tables initialized');
    } catch (error) {
      logger.error('[SSOManager] Table initialization failed:', error);
      throw error;
    }
  }

  /**
   * Initialize encryption key from environment or generate one
   * @private
   */
  _initEncryptionKey() {
    const envKey = process.env[this.config.encryptionKeyEnvVar];

    if (envKey) {
      // Use provided key (must be 64 hex chars = 32 bytes)
      if (envKey.length === 64 && /^[0-9a-fA-F]+$/.test(envKey)) {
        this._encryptionKey = Buffer.from(envKey, 'hex');
      } else {
        // Derive key from arbitrary string using SHA-256
        this._encryptionKey = crypto.createHash('sha256').update(envKey).digest();
      }
      logger.info('[SSOManager] Encryption key loaded from environment variable');
    } else {
      // Generate a random key (will be different each app restart)
      // In production, this should be persisted securely
      this._encryptionKey = crypto.randomBytes(ENCRYPTION_KEY_LENGTH);
      logger.warn('[SSOManager] Generated ephemeral encryption key. Set SSO_ENCRYPTION_KEY env var for persistent key.');
    }
  }

  // ════════════════════════════════════════════
  // Provider Management
  // ════════════════════════════════════════════

  /**
   * List all SSO provider configurations
   * @param {Object} [options] - Filter options
   * @param {string} [options.providerType] - Filter by provider type
   * @param {boolean} [options.enabledOnly] - Only return enabled providers
   * @returns {Promise<Array>} Array of provider configurations
   */
  async listProviders(options = {}) {
    try {
      let query = 'SELECT * FROM sso_configurations';
      const conditions = [];
      const params = [];

      if (options.providerType) {
        conditions.push('provider_type = ?');
        params.push(options.providerType);
      }

      if (options.enabledOnly) {
        conditions.push('enabled = 1');
      }

      if (conditions.length > 0) {
        query += ' WHERE ' + conditions.join(' AND ');
      }

      query += ' ORDER BY created_at DESC';

      const rows = await this.database.all(query, params);

      return rows.map(row => this._deserializeProvider(row));
    } catch (error) {
      logger.error('[SSOManager] Error listing providers:', error);
      return [];
    }
  }

  /**
   * Add a new SSO provider configuration
   * @param {Object} providerData - Provider configuration
   * @param {string} providerData.provider_type - Type: 'saml', 'oauth2', or 'oidc'
   * @param {string} providerData.provider_name - Display name for the provider
   * @param {Object} providerData.config - Provider-specific configuration
   * @returns {Promise<Object>} Result with provider id
   */
  async addProvider(providerData) {
    try {
      // Validate provider type
      if (!providerData.provider_type || !VALID_PROVIDER_TYPES.includes(providerData.provider_type)) {
        return {
          success: false,
          error: `Invalid provider_type. Must be one of: ${VALID_PROVIDER_TYPES.join(', ')}`
        };
      }

      // Validate provider name
      if (!providerData.provider_name || typeof providerData.provider_name !== 'string') {
        return { success: false, error: 'provider_name is required and must be a string' };
      }

      // Validate required config fields
      if (!providerData.config || typeof providerData.config !== 'object') {
        return { success: false, error: 'config object is required' };
      }

      const requiredFields = REQUIRED_FIELDS[providerData.provider_type] || [];
      const missingFields = requiredFields.filter(field => !providerData.config[field]);

      if (missingFields.length > 0) {
        return {
          success: false,
          error: `Missing required config fields for ${providerData.provider_type}: ${missingFields.join(', ')}`
        };
      }

      const id = uuidv4();
      const now = Date.now();

      // Encrypt sensitive fields in config before storage
      const securedConfig = this._secureSensitiveConfig(providerData.config);

      await this.database.run(
        `INSERT INTO sso_configurations (id, provider_type, provider_name, config, enabled, metadata, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          providerData.provider_type,
          providerData.provider_name,
          JSON.stringify(securedConfig),
          providerData.enabled !== false ? 1 : 0,
          providerData.metadata ? JSON.stringify(providerData.metadata) : null,
          now,
          now
        ]
      );

      // Invalidate cache
      this._providerCache.clear();

      this.emit('provider:added', { id, type: providerData.provider_type, name: providerData.provider_name });
      logger.info(`[SSOManager] Added provider: ${providerData.provider_name} (${providerData.provider_type})`);

      return { success: true, id };
    } catch (error) {
      logger.error('[SSOManager] Error adding provider:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Update an existing SSO provider configuration
   * @param {string} id - Provider ID
   * @param {Object} updates - Fields to update
   * @returns {Promise<Object>} Result
   */
  async updateProvider(id, updates) {
    try {
      if (!id) {
        return { success: false, error: 'Provider ID is required' };
      }

      // Verify provider exists
      const existing = await this.getProvider(id);
      if (!existing) {
        return { success: false, error: 'Provider not found' };
      }

      const setClauses = [];
      const params = [];

      if (updates.provider_name !== undefined) {
        setClauses.push('provider_name = ?');
        params.push(updates.provider_name);
      }

      if (updates.provider_type !== undefined) {
        if (!VALID_PROVIDER_TYPES.includes(updates.provider_type)) {
          return {
            success: false,
            error: `Invalid provider_type. Must be one of: ${VALID_PROVIDER_TYPES.join(', ')}`
          };
        }
        setClauses.push('provider_type = ?');
        params.push(updates.provider_type);
      }

      if (updates.config !== undefined) {
        if (typeof updates.config !== 'object') {
          return { success: false, error: 'config must be an object' };
        }
        // Merge with existing config
        const mergedConfig = { ...existing.config, ...updates.config };
        const securedConfig = this._secureSensitiveConfig(mergedConfig);
        setClauses.push('config = ?');
        params.push(JSON.stringify(securedConfig));
      }

      if (updates.enabled !== undefined) {
        setClauses.push('enabled = ?');
        params.push(updates.enabled ? 1 : 0);
      }

      if (updates.metadata !== undefined) {
        setClauses.push('metadata = ?');
        params.push(updates.metadata ? JSON.stringify(updates.metadata) : null);
      }

      if (setClauses.length === 0) {
        return { success: false, error: 'No valid update fields provided' };
      }

      setClauses.push('updated_at = ?');
      params.push(Date.now());
      params.push(id);

      await this.database.run(
        `UPDATE sso_configurations SET ${setClauses.join(', ')} WHERE id = ?`,
        params
      );

      // Invalidate cache
      this._providerCache.delete(id);

      this.emit('provider:updated', { id, updates: Object.keys(updates) });
      logger.info(`[SSOManager] Updated provider: ${id}`);

      return { success: true };
    } catch (error) {
      logger.error('[SSOManager] Error updating provider:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Delete an SSO provider and all related sessions
   * @param {string} id - Provider ID
   * @returns {Promise<Object>} Result
   */
  async deleteProvider(id) {
    try {
      if (!id) {
        return { success: false, error: 'Provider ID is required' };
      }

      // Verify provider exists
      const existing = await this.getProvider(id);
      if (!existing) {
        return { success: false, error: 'Provider not found' };
      }

      // Delete related sessions first
      const sessionResult = await this.database.run(
        'DELETE FROM sso_sessions WHERE provider_id = ?',
        [id]
      );

      const deletedSessions = sessionResult?.changes || 0;

      // Delete provider configuration
      await this.database.run(
        'DELETE FROM sso_configurations WHERE id = ?',
        [id]
      );

      // Clear any refresh timers for sessions of this provider
      for (const [sessionId, timer] of this._refreshTimers.entries()) {
        clearTimeout(timer);
        this._refreshTimers.delete(sessionId);
      }

      // Invalidate caches
      this._providerCache.delete(id);
      this._sessionCache.clear();

      this.emit('provider:deleted', { id, name: existing.provider_name, deletedSessions });
      logger.info(`[SSOManager] Deleted provider: ${existing.provider_name} (${deletedSessions} sessions removed)`);

      return { success: true, deletedSessions };
    } catch (error) {
      logger.error('[SSOManager] Error deleting provider:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get a single SSO provider by ID
   * @param {string} id - Provider ID
   * @returns {Promise<Object|null>} Provider configuration or null
   */
  async getProvider(id) {
    try {
      if (!id) return null;

      // Check cache
      if (this._providerCache.has(id)) {
        return this._providerCache.get(id);
      }

      const row = await this.database.get(
        'SELECT * FROM sso_configurations WHERE id = ?',
        [id]
      );

      if (!row) return null;

      const provider = this._deserializeProvider(row);
      this._providerCache.set(id, provider);

      return provider;
    } catch (error) {
      logger.error('[SSOManager] Error getting provider:', error);
      return null;
    }
  }

  /**
   * Test connectivity to an SSO provider
   * @param {string} id - Provider ID
   * @returns {Promise<Object>} Connection test result
   */
  async testConnection(id) {
    try {
      const provider = await this.getProvider(id);
      if (!provider) {
        return { success: false, error: 'Provider not found' };
      }

      const startTime = Date.now();
      const config = provider.config;
      const results = {
        provider: provider.provider_name,
        type: provider.provider_type,
        checks: []
      };

      if (provider.provider_type === ProviderType.OAUTH2 || provider.provider_type === ProviderType.OIDC) {
        // Test authorization endpoint
        const authCheck = await this._testEndpoint(config.authorizationEndpoint, 'Authorization Endpoint');
        results.checks.push(authCheck);

        // Test token endpoint
        const tokenCheck = await this._testEndpoint(config.tokenEndpoint, 'Token Endpoint');
        results.checks.push(tokenCheck);

        // Test userinfo endpoint (OIDC)
        if (config.userinfoEndpoint) {
          const userinfoCheck = await this._testEndpoint(config.userinfoEndpoint, 'UserInfo Endpoint');
          results.checks.push(userinfoCheck);
        }

        // Test OIDC discovery endpoint
        if (provider.provider_type === ProviderType.OIDC && config.issuer) {
          const discoveryUrl = config.issuer.replace(/\/$/, '') + '/.well-known/openid-configuration';
          const discoveryCheck = await this._testEndpoint(discoveryUrl, 'OIDC Discovery');
          results.checks.push(discoveryCheck);
        }
      } else if (provider.provider_type === ProviderType.SAML) {
        // Test SSO URL
        const ssoCheck = await this._testEndpoint(config.ssoUrl, 'SSO URL');
        results.checks.push(ssoCheck);

        // Test SLO URL if available
        if (config.sloUrl) {
          const sloCheck = await this._testEndpoint(config.sloUrl, 'SLO URL');
          results.checks.push(sloCheck);
        }

        // Validate certificate format
        const certCheck = this._validateCertificate(config.certificate);
        results.checks.push(certCheck);
      }

      const elapsed = Date.now() - startTime;
      const allPassed = results.checks.every(c => c.status === 'ok');

      results.duration = elapsed;
      results.success = allPassed;
      results.summary = allPassed
        ? `All ${results.checks.length} checks passed in ${elapsed}ms`
        : `${results.checks.filter(c => c.status !== 'ok').length} of ${results.checks.length} checks failed`;

      this.emit('provider:tested', { id, success: allPassed, duration: elapsed });
      logger.info(`[SSOManager] Connection test for ${provider.provider_name}: ${results.summary}`);

      return results;
    } catch (error) {
      logger.error('[SSOManager] Error testing connection:', error);
      return { success: false, error: error.message, checks: [] };
    }
  }

  // ════════════════════════════════════════════
  // Authentication Flows
  // ════════════════════════════════════════════

  /**
   * Initiate SSO login flow
   *
   * For OAuth/OIDC: Generates authorization URL with PKCE
   * For SAML: Generates SAML AuthnRequest
   *
   * @param {string} providerId - Provider ID
   * @param {Object} [options] - Additional options
   * @param {string} [options.loginHint] - Email hint for the IdP
   * @param {string} [options.prompt] - OAuth prompt parameter
   * @param {string[]} [options.scopes] - Override default scopes
   * @returns {Promise<Object>} Login initiation result with authUrl, state, codeVerifier
   */
  async initiateLogin(providerId, options = {}) {
    try {
      const provider = await this.getProvider(providerId);
      if (!provider) {
        return { success: false, error: 'Provider not found' };
      }

      if (!provider.enabled) {
        return { success: false, error: 'Provider is disabled' };
      }

      const state = uuidv4();
      const config = provider.config;

      let result;

      if (provider.provider_type === ProviderType.SAML) {
        // SAML flow
        result = await this._initiateSAMLLogin(config, state, options);
      } else {
        // OAuth 2.0 / OIDC flow
        result = await this._initiateOAuthLogin(config, state, provider.provider_type, options);
      }

      if (!result.success) {
        return result;
      }

      // Store pending state for callback verification
      this._pendingStates.set(state, {
        providerId,
        providerType: provider.provider_type,
        codeVerifier: result.codeVerifier || null,
        timestamp: Date.now(),
        options
      });

      // Clean up old pending states (older than 10 minutes)
      this._cleanupPendingStates();

      this.emit('login:initiated', {
        providerId,
        providerType: provider.provider_type,
        state
      });

      logger.info(`[SSOManager] Login initiated for provider: ${provider.provider_name}`);

      return {
        success: true,
        authUrl: result.authUrl,
        state,
        codeVerifier: result.codeVerifier || null,
        providerType: provider.provider_type,
        providerName: provider.provider_name
      };
    } catch (error) {
      logger.error('[SSOManager] Error initiating login:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Handle SSO callback after user authentication
   *
   * For OAuth: Exchange authorization code for tokens
   * For SAML: Parse SAML assertion
   *
   * @param {string} providerId - Provider ID
   * @param {Object} callbackData - Callback parameters
   * @param {string} [callbackData.code] - Authorization code (OAuth/OIDC)
   * @param {string} [callbackData.state] - State parameter for verification
   * @param {string} [callbackData.samlResponse] - SAML Response (SAML)
   * @param {string} [callbackData.relayState] - Relay state (SAML)
   * @param {string} [callbackData.codeVerifier] - PKCE code verifier (OAuth/OIDC)
   * @param {string} [callbackData.userDid] - User's DID for session association
   * @param {string} [callbackData.ipAddress] - Client IP address
   * @param {string} [callbackData.userAgent] - Client user agent
   * @returns {Promise<Object>} Result with session and userInfo
   */
  async handleCallback(providerId, callbackData) {
    try {
      const provider = await this.getProvider(providerId);
      if (!provider) {
        return { success: false, error: 'Provider not found' };
      }

      // Verify state parameter
      if (callbackData.state) {
        const pendingState = this._pendingStates.get(callbackData.state);
        if (!pendingState) {
          return { success: false, error: 'Invalid or expired state parameter' };
        }

        if (pendingState.providerId !== providerId) {
          return { success: false, error: 'State parameter does not match provider' };
        }

        // Use stored code verifier if not provided
        if (!callbackData.codeVerifier && pendingState.codeVerifier) {
          callbackData.codeVerifier = pendingState.codeVerifier;
        }

        // Clean up used state
        this._pendingStates.delete(callbackData.state);
      }

      let tokenData;
      let userInfo;

      if (provider.provider_type === ProviderType.SAML) {
        // Handle SAML assertion
        const samlResult = await this._handleSAMLCallback(provider.config, callbackData);
        if (!samlResult.success) {
          return samlResult;
        }
        tokenData = samlResult.tokenData;
        userInfo = samlResult.userInfo;
      } else {
        // Handle OAuth/OIDC code exchange
        const oauthResult = await this._handleOAuthCallback(provider.config, callbackData);
        if (!oauthResult.success) {
          return oauthResult;
        }
        tokenData = oauthResult.tokenData;
        userInfo = oauthResult.userInfo;
      }

      // Create SSO session
      const session = await this._createSession(providerId, {
        userDid: callbackData.userDid || null,
        externalUserId: userInfo.sub || userInfo.nameId || userInfo.email || null,
        tokenData,
        userInfo,
        ipAddress: callbackData.ipAddress || null,
        userAgent: callbackData.userAgent || null,
        samlSessionIndex: userInfo.sessionIndex || null,
        samlNameId: userInfo.nameId || null
      });

      // Schedule token refresh if enabled
      if (this.config.enableAutoRefresh && tokenData.refreshToken && tokenData.expiresIn) {
        this._scheduleTokenRefresh(session.id, tokenData.expiresIn);
      }

      this.emit('login:completed', {
        sessionId: session.id,
        providerId,
        userDid: callbackData.userDid,
        externalUserId: session.externalUserId
      });

      logger.info(`[SSOManager] Login completed. Session: ${session.id}`);

      return {
        success: true,
        session: {
          id: session.id,
          providerId: session.providerId,
          userDid: session.userDid,
          externalUserId: session.externalUserId,
          state: session.state,
          expiresAt: session.expiresAt,
          createdAt: session.createdAt
        },
        userInfo
      };
    } catch (error) {
      logger.error('[SSOManager] Error handling callback:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * End an SSO session and revoke tokens if possible
   * @param {string} sessionId - Session ID
   * @returns {Promise<Object>} Result
   */
  async logout(sessionId) {
    try {
      if (!sessionId) {
        return { success: false, error: 'Session ID is required' };
      }

      const session = await this._getSession(sessionId);
      if (!session) {
        return { success: false, error: 'Session not found' };
      }

      if (session.state === SessionState.REVOKED) {
        return { success: true, message: 'Session already revoked' };
      }

      const provider = await this.getProvider(session.providerId);

      // Try to revoke tokens at the provider level
      let tokenRevoked = false;
      if (provider && session.accessToken) {
        try {
          if (provider.provider_type === ProviderType.OAUTH2 || provider.provider_type === ProviderType.OIDC) {
            tokenRevoked = await this._revokeOAuthTokens(provider.config, session);
          }
          // SAML logout would typically use SLO (Single Logout)
        } catch (revokeError) {
          logger.warn(`[SSOManager] Token revocation failed for session ${sessionId}:`, revokeError.message);
        }
      }

      // Update session state
      await this.database.run(
        `UPDATE sso_sessions SET state = ?, updated_at = ? WHERE id = ?`,
        [SessionState.REVOKED, Date.now(), sessionId]
      );

      // Cancel refresh timer
      if (this._refreshTimers.has(sessionId)) {
        clearTimeout(this._refreshTimers.get(sessionId));
        this._refreshTimers.delete(sessionId);
      }

      // Clear session cache
      this._sessionCache.delete(sessionId);

      this.emit('logout:completed', {
        sessionId,
        providerId: session.providerId,
        userDid: session.userDid,
        tokenRevoked
      });

      logger.info(`[SSOManager] Logout completed. Session: ${sessionId}, token revoked: ${tokenRevoked}`);

      return { success: true, tokenRevoked };
    } catch (error) {
      logger.error('[SSOManager] Error during logout:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Refresh an expired access token
   * @param {string} sessionId - Session ID
   * @returns {Promise<Object>} Result with updated token info
   */
  async refreshToken(sessionId) {
    try {
      if (!sessionId) {
        return { success: false, error: 'Session ID is required' };
      }

      const session = await this._getSession(sessionId);
      if (!session) {
        return { success: false, error: 'Session not found' };
      }

      if (session.state === SessionState.REVOKED) {
        return { success: false, error: 'Session has been revoked' };
      }

      if (!session.refreshToken) {
        return { success: false, error: 'No refresh token available' };
      }

      const provider = await this.getProvider(session.providerId);
      if (!provider) {
        return { success: false, error: 'Provider not found for session' };
      }

      if (provider.provider_type === ProviderType.SAML) {
        return { success: false, error: 'Token refresh is not supported for SAML providers' };
      }

      // Mark session as refreshing
      await this.database.run(
        `UPDATE sso_sessions SET state = ?, updated_at = ? WHERE id = ?`,
        [SessionState.REFRESHING, Date.now(), sessionId]
      );

      // Decrypt refresh token
      const decryptedRefreshToken = this._decryptToken(session.refreshToken);

      // Exchange refresh token for new access token
      const oauthProvider = this._getOAuthProvider(provider.config);
      let tokenResponse;

      try {
        tokenResponse = await oauthProvider.refreshAccessToken(decryptedRefreshToken);
      } catch (refreshError) {
        // Mark session as expired on refresh failure
        await this.database.run(
          `UPDATE sso_sessions SET state = ?, updated_at = ? WHERE id = ?`,
          [SessionState.EXPIRED, Date.now(), sessionId]
        );
        this._sessionCache.delete(sessionId);

        return { success: false, error: `Token refresh failed: ${refreshError.message}` };
      }

      // Update session with new tokens
      const now = Date.now();
      const expiresAt = tokenResponse.expires_in
        ? now + (tokenResponse.expires_in * 1000)
        : now + this.config.sessionTimeout;

      const encryptedAccessToken = this._encryptToken(tokenResponse.access_token);
      const encryptedRefreshToken = tokenResponse.refresh_token
        ? this._encryptToken(tokenResponse.refresh_token)
        : session.refreshToken; // Keep existing refresh token if not rotated

      await this.database.run(
        `UPDATE sso_sessions
         SET access_token = ?, refresh_token = ?, expires_at = ?,
             state = ?, updated_at = ?
         WHERE id = ?`,
        [encryptedAccessToken, encryptedRefreshToken, expiresAt, SessionState.ACTIVE, now, sessionId]
      );

      // Invalidate session cache
      this._sessionCache.delete(sessionId);

      // Reschedule refresh
      if (this.config.enableAutoRefresh && tokenResponse.expires_in) {
        this._scheduleTokenRefresh(sessionId, tokenResponse.expires_in);
      }

      this.emit('token:refreshed', {
        sessionId,
        providerId: session.providerId,
        expiresAt
      });

      logger.info(`[SSOManager] Token refreshed for session: ${sessionId}`);

      return {
        success: true,
        expiresAt,
        tokenType: tokenResponse.token_type || 'Bearer'
      };
    } catch (error) {
      logger.error('[SSOManager] Error refreshing token:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get active SSO sessions for a user
   * @param {string} userDid - User's DID
   * @param {Object} [options] - Query options
   * @param {boolean} [options.includeExpired] - Include expired sessions
   * @returns {Promise<Array>} Array of sessions
   */
  async getActiveSessions(userDid, options = {}) {
    try {
      if (!userDid) {
        return [];
      }

      let query = `
        SELECT s.*, c.provider_name, c.provider_type
        FROM sso_sessions s
        JOIN sso_configurations c ON s.provider_id = c.id
        WHERE s.user_did = ?
      `;

      const params = [userDid];

      if (!options.includeExpired) {
        query += ` AND s.state = ?`;
        params.push(SessionState.ACTIVE);
      }

      query += ' ORDER BY s.created_at DESC';

      const rows = await this.database.all(query, params);

      return rows.map(row => ({
        id: row.id,
        providerId: row.provider_id,
        providerName: row.provider_name,
        providerType: row.provider_type,
        externalUserId: row.external_user_id,
        state: row.state,
        expiresAt: row.expires_at,
        userInfo: row.user_info ? JSON.parse(row.user_info) : null,
        ipAddress: row.ip_address,
        userAgent: row.user_agent,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }));
    } catch (error) {
      logger.error('[SSOManager] Error getting active sessions:', error);
      return [];
    }
  }

  // ════════════════════════════════════════════
  // Private: OAuth/OIDC Flow Helpers
  // ════════════════════════════════════════════

  /**
   * Initiate OAuth/OIDC login flow with PKCE
   * @private
   */
  async _initiateOAuthLogin(config, state, providerType, options = {}) {
    try {
      // Generate PKCE challenge
      const pkce = this._generatePKCE();

      // Build authorization URL
      const authUrl = this._buildAuthUrl(config, state, pkce.codeChallenge, providerType, options);

      return {
        success: true,
        authUrl,
        codeVerifier: pkce.codeVerifier
      };
    } catch (error) {
      logger.error('[SSOManager] Error initiating OAuth login:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Handle OAuth/OIDC callback
   * @private
   */
  async _handleOAuthCallback(config, callbackData) {
    try {
      if (!callbackData.code) {
        return { success: false, error: 'Authorization code is required' };
      }

      // Exchange code for tokens
      const tokenData = await this._exchangeCode(config, callbackData.code, callbackData.codeVerifier);

      if (!tokenData || !tokenData.access_token) {
        return { success: false, error: 'Failed to exchange code for tokens' };
      }

      // Get user info
      let userInfo = {};
      if (config.userinfoEndpoint && tokenData.access_token) {
        try {
          const oauthProvider = this._getOAuthProvider(config);
          userInfo = await oauthProvider.getUserInfo(tokenData.access_token);
        } catch (userinfoError) {
          logger.warn('[SSOManager] Failed to fetch user info:', userinfoError.message);
        }
      }

      // If we have an id_token, extract claims
      if (tokenData.id_token) {
        try {
          const oauthProvider = this._getOAuthProvider(config);
          const idTokenClaims = await oauthProvider.validateIdToken(tokenData.id_token);
          userInfo = { ...idTokenClaims, ...userInfo };
        } catch (idTokenError) {
          logger.warn('[SSOManager] Failed to validate id_token:', idTokenError.message);
        }
      }

      return {
        success: true,
        tokenData: {
          accessToken: tokenData.access_token,
          refreshToken: tokenData.refresh_token || null,
          idToken: tokenData.id_token || null,
          tokenType: tokenData.token_type || 'Bearer',
          expiresIn: tokenData.expires_in || null,
          scope: tokenData.scope || null
        },
        userInfo
      };
    } catch (error) {
      logger.error('[SSOManager] Error handling OAuth callback:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Revoke OAuth tokens at the provider
   * @private
   */
  async _revokeOAuthTokens(config, session) {
    try {
      if (!config.revocationEndpoint) {
        logger.debug('[SSOManager] No revocation endpoint configured');
        return false;
      }

      const oauthProvider = this._getOAuthProvider(config);
      const decryptedToken = this._decryptToken(session.accessToken);
      await oauthProvider.revokeToken(decryptedToken);

      // Also revoke refresh token if available
      if (session.refreshToken) {
        try {
          const decryptedRefresh = this._decryptToken(session.refreshToken);
          await oauthProvider.revokeToken(decryptedRefresh);
        } catch (refreshRevokeErr) {
          logger.debug('[SSOManager] Refresh token revocation failed:', refreshRevokeErr.message);
        }
      }

      return true;
    } catch (error) {
      logger.warn('[SSOManager] Token revocation error:', error.message);
      return false;
    }
  }

  // ════════════════════════════════════════════
  // Private: SAML Flow Helpers
  // ════════════════════════════════════════════

  /**
   * Initiate SAML login flow
   * @private
   */
  async _initiateSAMLLogin(config, state, options = {}) {
    try {
      const samlProvider = this._getSAMLProvider(config);
      const requestId = '_' + uuidv4().replace(/-/g, '');

      const authnRequest = samlProvider.generateAuthnRequest(requestId, state);

      // Build SSO URL with SAMLRequest parameter
      const samlRequestBase64 = Buffer.from(authnRequest).toString('base64');
      const encodedRequest = encodeURIComponent(samlRequestBase64);
      const encodedState = encodeURIComponent(state);

      let authUrl = config.ssoUrl;
      const separator = authUrl.includes('?') ? '&' : '?';
      authUrl += `${separator}SAMLRequest=${encodedRequest}&RelayState=${encodedState}`;

      return {
        success: true,
        authUrl,
        codeVerifier: null // SAML doesn't use PKCE
      };
    } catch (error) {
      logger.error('[SSOManager] Error initiating SAML login:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Handle SAML callback (assertion parsing)
   * @private
   */
  async _handleSAMLCallback(config, callbackData) {
    try {
      if (!callbackData.samlResponse) {
        return { success: false, error: 'SAML Response is required' };
      }

      const samlProvider = this._getSAMLProvider(config);
      const assertion = samlProvider.parseAssertion(callbackData.samlResponse);

      if (!assertion || !assertion.nameId) {
        return { success: false, error: 'Failed to parse SAML assertion' };
      }

      // Check assertion conditions
      if (assertion.conditions) {
        const now = new Date();
        if (assertion.conditions.notBefore && now < new Date(assertion.conditions.notBefore)) {
          return { success: false, error: 'SAML assertion is not yet valid' };
        }
        if (assertion.conditions.notOnOrAfter && now >= new Date(assertion.conditions.notOnOrAfter)) {
          return { success: false, error: 'SAML assertion has expired' };
        }
      }

      const userInfo = {
        nameId: assertion.nameId,
        sessionIndex: assertion.sessionIndex || null,
        email: assertion.attributes?.email || assertion.attributes?.Email || null,
        displayName: assertion.attributes?.displayName || assertion.attributes?.DisplayName || null,
        firstName: assertion.attributes?.firstName || assertion.attributes?.FirstName || null,
        lastName: assertion.attributes?.lastName || assertion.attributes?.LastName || null,
        groups: assertion.attributes?.groups || assertion.attributes?.Groups || [],
        ...assertion.attributes
      };

      return {
        success: true,
        tokenData: {
          accessToken: null, // SAML doesn't issue access tokens
          refreshToken: null,
          idToken: null,
          tokenType: 'saml',
          expiresIn: assertion.conditions?.notOnOrAfter
            ? Math.floor((new Date(assertion.conditions.notOnOrAfter).getTime() - Date.now()) / 1000)
            : 3600,
          scope: null
        },
        userInfo
      };
    } catch (error) {
      logger.error('[SSOManager] Error handling SAML callback:', error);
      return { success: false, error: error.message };
    }
  }

  // ════════════════════════════════════════════
  // Private: PKCE Helpers
  // ════════════════════════════════════════════

  /**
   * Generate PKCE code_verifier and code_challenge
   * @private
   * @returns {Object} { codeVerifier, codeChallenge, codeChallengeMethod }
   */
  _generatePKCE() {
    // Generate a cryptographically random code verifier (43-128 characters)
    // Using base64url-safe characters: [A-Z], [a-z], [0-9], '-', '.', '_', '~'
    const verifierLength = 64;
    const randomBytes = crypto.randomBytes(verifierLength);
    const codeVerifier = randomBytes
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '')
      .substring(0, 128);

    // Generate code challenge using S256 method
    const codeChallenge = crypto
      .createHash('sha256')
      .update(codeVerifier)
      .digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');

    return {
      codeVerifier,
      codeChallenge,
      codeChallengeMethod: 'S256'
    };
  }

  /**
   * Build OAuth authorization URL
   * @private
   */
  _buildAuthUrl(config, state, codeChallenge, providerType, options = {}) {
    const params = new URLSearchParams();

    params.set('response_type', 'code');
    params.set('client_id', config.clientId);
    params.set('redirect_uri', config.redirectUri);
    params.set('state', state);

    // PKCE parameters
    params.set('code_challenge', codeChallenge);
    params.set('code_challenge_method', 'S256');

    // Scopes
    const scopes = options.scopes || config.scopes || [];
    const defaultScopes = providerType === ProviderType.OIDC
      ? ['openid', 'profile', 'email']
      : ['read'];

    const allScopes = [...new Set([...defaultScopes, ...scopes])];
    params.set('scope', allScopes.join(' '));

    // Optional parameters
    if (options.loginHint) {
      params.set('login_hint', options.loginHint);
    }

    if (options.prompt) {
      params.set('prompt', options.prompt);
    }

    if (providerType === ProviderType.OIDC) {
      // Add nonce for OIDC
      params.set('nonce', uuidv4());
    }

    const baseUrl = config.authorizationEndpoint;
    const separator = baseUrl.includes('?') ? '&' : '?';
    return `${baseUrl}${separator}${params.toString()}`;
  }

  /**
   * Exchange authorization code for tokens
   * @private
   */
  async _exchangeCode(config, code, codeVerifier) {
    try {
      const oauthProvider = this._getOAuthProvider(config);
      return await oauthProvider.exchangeCode(code, codeVerifier);
    } catch (error) {
      logger.error('[SSOManager] Code exchange failed:', error);
      throw error;
    }
  }

  // ════════════════════════════════════════════
  // Private: Token Encryption
  // ════════════════════════════════════════════

  /**
   * Encrypt a token for secure storage using AES-256-GCM
   * @private
   * @param {string} token - Token to encrypt
   * @returns {string} Encrypted token as hex string (iv:authTag:encrypted)
   */
  _encryptToken(token) {
    if (!token) return null;

    try {
      const iv = crypto.randomBytes(IV_LENGTH);
      const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, this._encryptionKey, iv);

      let encrypted = cipher.update(token, 'utf8', ENCODING);
      encrypted += cipher.final(ENCODING);

      const authTag = cipher.getAuthTag();

      // Format: iv:authTag:encrypted (all hex)
      return `${iv.toString(ENCODING)}:${authTag.toString(ENCODING)}:${encrypted}`;
    } catch (error) {
      logger.error('[SSOManager] Token encryption failed:', error);
      throw new Error('Token encryption failed');
    }
  }

  /**
   * Decrypt a stored token
   * @private
   * @param {string} encrypted - Encrypted token string (iv:authTag:encrypted)
   * @returns {string} Decrypted token
   */
  _decryptToken(encrypted) {
    if (!encrypted) return null;

    try {
      const parts = encrypted.split(':');
      if (parts.length !== 3) {
        throw new Error('Invalid encrypted token format');
      }

      const [ivHex, authTagHex, encryptedData] = parts;
      const iv = Buffer.from(ivHex, ENCODING);
      const authTag = Buffer.from(authTagHex, ENCODING);

      const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, this._encryptionKey, iv);
      decipher.setAuthTag(authTag);

      let decrypted = decipher.update(encryptedData, ENCODING, 'utf8');
      decrypted += decipher.final('utf8');

      return decrypted;
    } catch (error) {
      logger.error('[SSOManager] Token decryption failed:', error);
      throw new Error('Token decryption failed');
    }
  }

  // ════════════════════════════════════════════
  // Private: Session Management
  // ════════════════════════════════════════════

  /**
   * Create a new SSO session
   * @private
   */
  async _createSession(providerId, data) {
    const id = uuidv4();
    const now = Date.now();
    const expiresAt = data.tokenData?.expiresIn
      ? now + (data.tokenData.expiresIn * 1000)
      : now + this.config.sessionTimeout;

    // Enforce max sessions per user
    if (data.userDid) {
      const activeSessions = await this.getActiveSessions(data.userDid);
      if (activeSessions.length >= this.config.maxSessionsPerUser) {
        // Revoke the oldest session
        const oldest = activeSessions[activeSessions.length - 1];
        logger.info(`[SSOManager] Max sessions reached, revoking oldest: ${oldest.id}`);
        await this.logout(oldest.id);
      }
    }

    // Encrypt tokens before storage
    const encryptedAccessToken = data.tokenData?.accessToken
      ? this._encryptToken(data.tokenData.accessToken)
      : null;
    const encryptedRefreshToken = data.tokenData?.refreshToken
      ? this._encryptToken(data.tokenData.refreshToken)
      : null;
    const encryptedIdToken = data.tokenData?.idToken
      ? this._encryptToken(data.tokenData.idToken)
      : null;

    await this.database.run(
      `INSERT INTO sso_sessions (
        id, provider_id, user_did, external_user_id,
        access_token, refresh_token, id_token, token_type,
        expires_at, scopes, user_info, state,
        saml_session_index, saml_name_id,
        ip_address, user_agent,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, providerId, data.userDid, data.externalUserId,
        encryptedAccessToken, encryptedRefreshToken, encryptedIdToken,
        data.tokenData?.tokenType || 'Bearer',
        expiresAt,
        data.tokenData?.scope || null,
        data.userInfo ? JSON.stringify(data.userInfo) : null,
        SessionState.ACTIVE,
        data.samlSessionIndex, data.samlNameId,
        data.ipAddress, data.userAgent,
        now, now
      ]
    );

    logger.info(`[SSOManager] Session created: ${id} for provider: ${providerId}`);

    return {
      id,
      providerId,
      userDid: data.userDid,
      externalUserId: data.externalUserId,
      state: SessionState.ACTIVE,
      expiresAt,
      createdAt: now
    };
  }

  /**
   * Get a session by ID
   * @private
   */
  async _getSession(sessionId) {
    try {
      if (this._sessionCache.has(sessionId)) {
        return this._sessionCache.get(sessionId);
      }

      const row = await this.database.get(
        'SELECT * FROM sso_sessions WHERE id = ?',
        [sessionId]
      );

      if (!row) return null;

      const session = {
        id: row.id,
        providerId: row.provider_id,
        userDid: row.user_did,
        externalUserId: row.external_user_id,
        accessToken: row.access_token,
        refreshToken: row.refresh_token,
        idToken: row.id_token,
        tokenType: row.token_type,
        expiresAt: row.expires_at,
        scopes: row.scopes,
        userInfo: row.user_info ? JSON.parse(row.user_info) : null,
        state: row.state,
        samlSessionIndex: row.saml_session_index,
        samlNameId: row.saml_name_id,
        ipAddress: row.ip_address,
        userAgent: row.user_agent,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      };

      // Check if session has expired
      if (session.state === SessionState.ACTIVE && session.expiresAt && Date.now() >= session.expiresAt) {
        session.state = SessionState.EXPIRED;
        await this.database.run(
          `UPDATE sso_sessions SET state = ?, updated_at = ? WHERE id = ?`,
          [SessionState.EXPIRED, Date.now(), sessionId]
        );
      }

      this._sessionCache.set(sessionId, session);
      return session;
    } catch (error) {
      logger.error('[SSOManager] Error getting session:', error);
      return null;
    }
  }

  /**
   * Schedule automatic token refresh
   * @private
   */
  _scheduleTokenRefresh(sessionId, expiresInSeconds) {
    // Cancel existing timer
    if (this._refreshTimers.has(sessionId)) {
      clearTimeout(this._refreshTimers.get(sessionId));
    }

    // Refresh before expiry (configurable threshold)
    const refreshDelay = Math.max(
      (expiresInSeconds * 1000) - this.config.tokenRefreshThreshold,
      0
    );

    const timer = setTimeout(async () => {
      try {
        logger.info(`[SSOManager] Auto-refreshing token for session: ${sessionId}`);
        const result = await this.refreshToken(sessionId);
        if (!result.success) {
          logger.warn(`[SSOManager] Auto-refresh failed for session ${sessionId}: ${result.error}`);
          this.emit('token:refresh-failed', { sessionId, error: result.error });
        }
      } catch (error) {
        logger.error(`[SSOManager] Auto-refresh error for session ${sessionId}:`, error);
      }
    }, refreshDelay);

    this._refreshTimers.set(sessionId, timer);
    logger.debug(`[SSOManager] Token refresh scheduled for session ${sessionId} in ${Math.round(refreshDelay / 1000)}s`);
  }

  // ════════════════════════════════════════════
  // Private: Provider Instance Helpers
  // ════════════════════════════════════════════

  /**
   * Get or create OAuthProvider instance
   * @private
   */
  _getOAuthProvider(config) {
    if (!this._oauthProviderClass) {
      try {
        const { OAuthProvider } = require('./oauth-provider.js');
        this._oauthProviderClass = OAuthProvider;
      } catch (loadError) {
        logger.error('[SSOManager] Failed to load OAuthProvider:', loadError);
        throw new Error('OAuthProvider module not available');
      }
    }

    return new this._oauthProviderClass({ config });
  }

  /**
   * Get or create SAMLProvider instance
   * @private
   */
  _getSAMLProvider(config) {
    if (!this._samlProviderClass) {
      try {
        const { SAMLProvider } = require('./saml-provider.js');
        this._samlProviderClass = SAMLProvider;
      } catch (loadError) {
        logger.error('[SSOManager] Failed to load SAMLProvider:', loadError);
        throw new Error('SAMLProvider module not available');
      }
    }

    return new this._samlProviderClass({ config });
  }

  // ════════════════════════════════════════════
  // Private: Utility Methods
  // ════════════════════════════════════════════

  /**
   * Test an HTTP endpoint for connectivity
   * @private
   */
  async _testEndpoint(url, name) {
    return new Promise((resolve) => {
      try {
        const parsedUrl = new URL(url);
        const protocol = parsedUrl.protocol === 'https:' ? require('https') : require('http');
        const startTime = Date.now();

        const options = {
          hostname: parsedUrl.hostname,
          port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
          path: parsedUrl.pathname + parsedUrl.search,
          method: 'HEAD',
          timeout: 10000,
          headers: {
            'User-Agent': 'ChainlessChain-SSO/1.0'
          }
        };

        const req = protocol.request(options, (res) => {
          const elapsed = Date.now() - startTime;
          resolve({
            name,
            url,
            status: 'ok',
            statusCode: res.statusCode,
            latency: elapsed,
            message: `${name} reachable (${res.statusCode}) in ${elapsed}ms`
          });
        });

        req.on('error', (err) => {
          resolve({
            name,
            url,
            status: 'error',
            error: err.message,
            message: `${name} unreachable: ${err.message}`
          });
        });

        req.on('timeout', () => {
          req.destroy();
          resolve({
            name,
            url,
            status: 'timeout',
            message: `${name} timed out after 10s`
          });
        });

        req.end();
      } catch (error) {
        resolve({
          name,
          url,
          status: 'error',
          error: error.message,
          message: `${name} invalid URL: ${error.message}`
        });
      }
    });
  }

  /**
   * Validate certificate format
   * @private
   */
  _validateCertificate(certificate) {
    if (!certificate) {
      return {
        name: 'Certificate',
        status: 'error',
        message: 'Certificate is missing'
      };
    }

    // Check for PEM format
    const isPEM = certificate.includes('BEGIN CERTIFICATE') && certificate.includes('END CERTIFICATE');

    // Try base64 decode if not PEM
    const isBase64 = !isPEM && /^[A-Za-z0-9+/\r\n]+={0,2}$/.test(certificate.replace(/\s/g, ''));

    if (!isPEM && !isBase64) {
      return {
        name: 'Certificate',
        status: 'error',
        message: 'Certificate is not in valid PEM or base64 format'
      };
    }

    // Extract the base64 content and try to determine certificate info
    let certBase64;
    if (isPEM) {
      certBase64 = certificate
        .replace(/-----BEGIN CERTIFICATE-----/g, '')
        .replace(/-----END CERTIFICATE-----/g, '')
        .replace(/[\r\n\s]/g, '');
    } else {
      certBase64 = certificate.replace(/[\r\n\s]/g, '');
    }

    try {
      const certDer = Buffer.from(certBase64, 'base64');
      if (certDer.length < 100) {
        return {
          name: 'Certificate',
          status: 'warning',
          message: 'Certificate appears too short to be valid'
        };
      }

      return {
        name: 'Certificate',
        status: 'ok',
        format: isPEM ? 'PEM' : 'Base64/DER',
        size: certDer.length,
        message: `Certificate valid (${isPEM ? 'PEM' : 'Base64'} format, ${certDer.length} bytes)`
      };
    } catch (decodeError) {
      return {
        name: 'Certificate',
        status: 'error',
        message: `Certificate decode error: ${decodeError.message}`
      };
    }
  }

  /**
   * Serialize provider config, encrypting sensitive fields
   * @private
   */
  _secureSensitiveConfig(config) {
    const sensitiveKeys = ['clientSecret', 'client_secret', 'privateKey', 'private_key'];
    const secured = { ...config };

    for (const key of sensitiveKeys) {
      if (secured[key] && typeof secured[key] === 'string') {
        secured[key] = this._encryptToken(secured[key]);
        secured[`${key}__encrypted`] = true;
      }
    }

    return secured;
  }

  /**
   * Deserialize provider from database row
   * @private
   */
  _deserializeProvider(row) {
    let config = {};
    try {
      config = JSON.parse(row.config);

      // Decrypt sensitive fields
      const sensitiveKeys = ['clientSecret', 'client_secret', 'privateKey', 'private_key'];
      for (const key of sensitiveKeys) {
        if (config[`${key}__encrypted`] && config[key]) {
          try {
            config[key] = this._decryptToken(config[key]);
            delete config[`${key}__encrypted`];
          } catch (decryptErr) {
            logger.warn(`[SSOManager] Failed to decrypt ${key} for provider ${row.id}`);
            config[key] = null;
          }
        }
      }
    } catch (parseError) {
      logger.error(`[SSOManager] Failed to parse config for provider ${row.id}:`, parseError);
    }

    let metadata = null;
    if (row.metadata) {
      try {
        metadata = JSON.parse(row.metadata);
      } catch (metaError) {
        logger.warn(`[SSOManager] Failed to parse metadata for provider ${row.id}`);
      }
    }

    return {
      id: row.id,
      provider_type: row.provider_type,
      provider_name: row.provider_name,
      config,
      enabled: row.enabled === 1,
      metadata,
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  }

  /**
   * Clean up expired pending states
   * @private
   */
  _cleanupPendingStates() {
    const maxAge = 10 * 60 * 1000; // 10 minutes
    const now = Date.now();

    for (const [state, data] of this._pendingStates.entries()) {
      if (now - data.timestamp > maxAge) {
        this._pendingStates.delete(state);
      }
    }
  }

  // ════════════════════════════════════════════
  // Cleanup
  // ════════════════════════════════════════════

  /**
   * Clean up resources (timers, caches)
   */
  destroy() {
    // Clear all refresh timers
    for (const [sessionId, timer] of this._refreshTimers.entries()) {
      clearTimeout(timer);
    }
    this._refreshTimers.clear();

    // Clear caches
    this._providerCache.clear();
    this._sessionCache.clear();
    this._pendingStates.clear();

    this.removeAllListeners();
    logger.info('[SSOManager] Destroyed and cleaned up');
  }
}

module.exports = { SSOManager };
