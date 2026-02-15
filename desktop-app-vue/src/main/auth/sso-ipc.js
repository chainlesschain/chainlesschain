/**
 * SSO IPC Handlers
 *
 * Registers 20 IPC handlers for SSO (Single Sign-On) operations including
 * provider configuration, authentication flows, identity linking,
 * session management, SAML, and OIDC operations.
 *
 * Handler categories:
 * - Config (5): list/add/update/delete providers, test connection
 * - Auth (4): initiate login, handle callback, logout, refresh token
 * - Identity (4): link/unlink identity, get linked identities, verify link
 * - Session (3): get sessions, invalidate session, get session info
 * - SAML (2): get metadata, parse assertion
 * - OIDC (2): get userinfo, validate ID token
 *
 * @module auth/sso-ipc
 * @version 1.0.0
 * @since 2026-02-15
 */

const { ipcMain } = require('electron');
const { logger } = require('../utils/logger.js');

/**
 * Register all SSO-related IPC handlers
 *
 * Uses lazy initialization for manager instances to avoid circular
 * dependencies and reduce startup overhead.
 *
 * @param {Object} dependencies - Required dependencies
 * @param {Object} dependencies.database - Database instance (DatabaseManager)
 */
function registerSSOIPC(dependencies) {
  const { database } = dependencies;

  let ssoManager = null;
  let ssoSessionManager = null;
  let identityBridge = null;

  /**
   * Lazy-load and cache the SSOManager instance
   * @returns {Object} SSOManager instance
   */
  function getSSOManager() {
    if (!ssoManager) {
      const { SSOManager } = require('./sso-manager');
      ssoManager = new SSOManager({ database });
    }
    return ssoManager;
  }

  /**
   * Lazy-load and cache the SSOSessionManager instance
   * @returns {Object} SSOSessionManager instance
   */
  function getSSOSessionManager() {
    if (!ssoSessionManager) {
      const { SSOSessionManager } = require('./sso-session-manager');
      ssoSessionManager = new SSOSessionManager({ database });
    }
    return ssoSessionManager;
  }

  /**
   * Lazy-load and cache the IdentityBridge instance
   * @returns {Object} IdentityBridge instance
   */
  function getIdentityBridge() {
    if (!identityBridge) {
      const { IdentityBridge } = require('./identity-bridge');
      identityBridge = new IdentityBridge({ database });
    }
    return identityBridge;
  }

  logger.info('[SSO-IPC] Registering 20 SSO IPC handlers');

  // ============================================
  // Config Handlers (5)
  // ============================================

  /**
   * sso:list-providers
   * List all configured SSO providers
   */
  ipcMain.handle('sso:list-providers', async (event) => {
    try {
      const manager = getSSOManager();
      const providers = await manager.listProviders();
      return { success: true, data: providers };
    } catch (error) {
      logger.error('[SSO-IPC] Error listing providers:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * sso:add-provider
   * Add a new SSO provider configuration
   */
  ipcMain.handle('sso:add-provider', async (event, { providerConfig }) => {
    try {
      if (!providerConfig) {
        return { success: false, error: 'providerConfig is required' };
      }
      const manager = getSSOManager();
      const result = await manager.addProvider(providerConfig);
      return { success: true, data: result };
    } catch (error) {
      logger.error('[SSO-IPC] Error adding provider:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * sso:update-provider
   * Update an existing SSO provider configuration
   */
  ipcMain.handle('sso:update-provider', async (event, { providerId, updates }) => {
    try {
      if (!providerId || !updates) {
        return { success: false, error: 'providerId and updates are required' };
      }
      const manager = getSSOManager();
      const result = await manager.updateProvider(providerId, updates);
      return { success: true, data: result };
    } catch (error) {
      logger.error('[SSO-IPC] Error updating provider:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * sso:delete-provider
   * Delete an SSO provider configuration
   */
  ipcMain.handle('sso:delete-provider', async (event, { providerId }) => {
    try {
      if (!providerId) {
        return { success: false, error: 'providerId is required' };
      }
      const manager = getSSOManager();
      const result = await manager.deleteProvider(providerId);
      return { success: true, data: result };
    } catch (error) {
      logger.error('[SSO-IPC] Error deleting provider:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * sso:test-connection
   * Test connectivity to an SSO provider
   */
  ipcMain.handle('sso:test-connection', async (event, { providerId }) => {
    try {
      if (!providerId) {
        return { success: false, error: 'providerId is required' };
      }
      const manager = getSSOManager();
      const result = await manager.testConnection(providerId);
      return { success: true, data: result };
    } catch (error) {
      logger.error('[SSO-IPC] Error testing connection:', error);
      return { success: false, error: error.message };
    }
  });

  // ============================================
  // Auth Handlers (4)
  // ============================================

  /**
   * sso:initiate-login
   * Start the SSO login flow for a provider
   */
  ipcMain.handle('sso:initiate-login', async (event, { providerId, options = {} }) => {
    try {
      if (!providerId) {
        return { success: false, error: 'providerId is required' };
      }
      const manager = getSSOManager();
      const result = await manager.initiateLogin(providerId, options);
      return { success: true, data: result };
    } catch (error) {
      logger.error('[SSO-IPC] Error initiating login:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * sso:handle-callback
   * Handle the SSO callback after provider authentication
   */
  ipcMain.handle('sso:handle-callback', async (event, { providerId, callbackData }) => {
    try {
      if (!providerId || !callbackData) {
        return { success: false, error: 'providerId and callbackData are required' };
      }
      const manager = getSSOManager();
      const authResult = await manager.handleCallback(providerId, callbackData);

      // If authentication succeeded, create a session
      if (authResult && authResult.tokens) {
        const sessionMgr = getSSOSessionManager();
        const userDid = authResult.userDid || callbackData.userDid;
        if (userDid) {
          const session = await sessionMgr.createSession(userDid, providerId, authResult.tokens);
          authResult.sessionId = session.sessionId;
        }
      }

      return { success: true, data: authResult };
    } catch (error) {
      logger.error('[SSO-IPC] Error handling callback:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * sso:logout
   * Logout from an SSO provider and invalidate session
   */
  ipcMain.handle('sso:logout', async (event, { providerId, sessionId, userDid }) => {
    try {
      if (!providerId) {
        return { success: false, error: 'providerId is required' };
      }

      const manager = getSSOManager();
      const sessionMgr = getSSOSessionManager();

      // Invalidate session(s)
      if (sessionId) {
        await sessionMgr.invalidateSession(sessionId);
      } else if (userDid) {
        await sessionMgr.invalidateAllSessions(userDid);
      }

      // Notify provider of logout
      const result = await manager.logout(providerId, { sessionId, userDid });

      return { success: true, data: result };
    } catch (error) {
      logger.error('[SSO-IPC] Error during logout:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * sso:refresh-token
   * Refresh OAuth2 tokens for a session
   */
  ipcMain.handle('sso:refresh-token', async (event, { sessionId }) => {
    try {
      if (!sessionId) {
        return { success: false, error: 'sessionId is required' };
      }

      const sessionMgr = getSSOSessionManager();
      const manager = getSSOManager();

      // Get current session
      const session = await sessionMgr.getSession(sessionId);
      if (!session) {
        return { success: false, error: 'SESSION_NOT_FOUND' };
      }

      if (!session.tokens.refreshToken) {
        return { success: false, error: 'NO_REFRESH_TOKEN' };
      }

      // Perform token refresh via provider
      const newTokens = await manager.refreshToken(
        session.providerId,
        session.tokens.refreshToken
      );

      // Update stored tokens
      const updateResult = await sessionMgr.updateTokens(sessionId, newTokens);

      return { success: true, data: updateResult };
    } catch (error) {
      logger.error('[SSO-IPC] Error refreshing token:', error);
      return { success: false, error: error.message };
    }
  });

  // ============================================
  // Identity Handlers (4)
  // ============================================

  /**
   * sso:link-identity
   * Link a DID with an SSO provider identity
   */
  ipcMain.handle('sso:link-identity', async (event, { did, providerId, ssoSubject, ssoAttributes }) => {
    try {
      if (!did || !providerId || !ssoSubject) {
        return { success: false, error: 'did, providerId, and ssoSubject are required' };
      }
      const bridge = getIdentityBridge();
      const result = await bridge.linkIdentity(did, providerId, ssoSubject, ssoAttributes || {});
      return { success: true, data: result };
    } catch (error) {
      logger.error('[SSO-IPC] Error linking identity:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * sso:unlink-identity
   * Unlink a DID from an SSO provider
   */
  ipcMain.handle('sso:unlink-identity', async (event, { did, providerId }) => {
    try {
      if (!did || !providerId) {
        return { success: false, error: 'did and providerId are required' };
      }
      const bridge = getIdentityBridge();
      const result = await bridge.unlinkIdentity(did, providerId);
      return { success: true, data: result };
    } catch (error) {
      logger.error('[SSO-IPC] Error unlinking identity:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * sso:get-linked-identities
   * Get all SSO identities linked to a DID
   */
  ipcMain.handle('sso:get-linked-identities', async (event, { did, options = {} }) => {
    try {
      if (!did) {
        return { success: false, error: 'did is required' };
      }
      const bridge = getIdentityBridge();
      const identities = await bridge.getLinkedIdentities(did, options);
      return { success: true, data: identities };
    } catch (error) {
      logger.error('[SSO-IPC] Error getting linked identities:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * sso:verify-link
   * Verify an identity mapping
   */
  ipcMain.handle('sso:verify-link', async (event, { mappingId }) => {
    try {
      if (!mappingId) {
        return { success: false, error: 'mappingId is required' };
      }
      const bridge = getIdentityBridge();
      const result = await bridge.verifyLink(mappingId);
      return { success: true, data: result };
    } catch (error) {
      logger.error('[SSO-IPC] Error verifying link:', error);
      return { success: false, error: error.message };
    }
  });

  // ============================================
  // Session Handlers (3)
  // ============================================

  /**
   * sso:get-sessions
   * Get all active SSO sessions for a user
   */
  ipcMain.handle('sso:get-sessions', async (event, { userDid }) => {
    try {
      if (!userDid) {
        return { success: false, error: 'userDid is required' };
      }
      const sessionMgr = getSSOSessionManager();
      const sessions = await sessionMgr.getSessionsByUser(userDid);

      // Strip sensitive token data for listing
      const safeSessions = sessions.map(s => ({
        id: s.id,
        userDid: s.userDid,
        providerId: s.providerId,
        tokenType: s.tokens ? s.tokens.tokenType : null,
        scope: s.tokens ? s.tokens.scope : null,
        expiresAt: s.expiresAt,
        lastActivity: s.lastActivity,
        createdAt: s.createdAt,
      }));

      return { success: true, data: safeSessions };
    } catch (error) {
      logger.error('[SSO-IPC] Error getting sessions:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * sso:invalidate-session
   * Invalidate (delete) a specific SSO session
   */
  ipcMain.handle('sso:invalidate-session', async (event, { sessionId }) => {
    try {
      if (!sessionId) {
        return { success: false, error: 'sessionId is required' };
      }
      const sessionMgr = getSSOSessionManager();
      const result = await sessionMgr.invalidateSession(sessionId);
      return { success: true, data: result };
    } catch (error) {
      logger.error('[SSO-IPC] Error invalidating session:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * sso:get-session-info
   * Get session metadata without sensitive token data
   */
  ipcMain.handle('sso:get-session-info', async (event, { sessionId }) => {
    try {
      if (!sessionId) {
        return { success: false, error: 'sessionId is required' };
      }
      const sessionMgr = getSSOSessionManager();
      const info = await sessionMgr.getSessionInfo(sessionId);
      if (!info) {
        return { success: false, error: 'SESSION_NOT_FOUND' };
      }
      return { success: true, data: info };
    } catch (error) {
      logger.error('[SSO-IPC] Error getting session info:', error);
      return { success: false, error: error.message };
    }
  });

  // ============================================
  // SAML Handlers (2)
  // ============================================

  /**
   * sso:get-saml-metadata
   * Get SAML Service Provider metadata for a provider
   */
  ipcMain.handle('sso:get-saml-metadata', async (event, { providerId }) => {
    try {
      if (!providerId) {
        return { success: false, error: 'providerId is required' };
      }
      const manager = getSSOManager();
      const metadata = await manager.getSAMLMetadata(providerId);
      return { success: true, data: metadata };
    } catch (error) {
      logger.error('[SSO-IPC] Error getting SAML metadata:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * sso:parse-assertion
   * Parse and validate a SAML assertion response
   */
  ipcMain.handle('sso:parse-assertion', async (event, { providerId, samlResponse }) => {
    try {
      if (!providerId || !samlResponse) {
        return { success: false, error: 'providerId and samlResponse are required' };
      }
      const manager = getSSOManager();
      const assertion = await manager.parseAssertion(providerId, samlResponse);
      return { success: true, data: assertion };
    } catch (error) {
      logger.error('[SSO-IPC] Error parsing SAML assertion:', error);
      return { success: false, error: error.message };
    }
  });

  // ============================================
  // OIDC Handlers (2)
  // ============================================

  /**
   * sso:get-userinfo
   * Get user info from OIDC provider using access token
   */
  ipcMain.handle('sso:get-userinfo', async (event, { sessionId }) => {
    try {
      if (!sessionId) {
        return { success: false, error: 'sessionId is required' };
      }

      const sessionMgr = getSSOSessionManager();
      const session = await sessionMgr.getSession(sessionId);
      if (!session) {
        return { success: false, error: 'SESSION_NOT_FOUND' };
      }

      const manager = getSSOManager();
      const userInfo = await manager.getUserInfo(
        session.providerId,
        session.tokens.accessToken
      );

      return { success: true, data: userInfo };
    } catch (error) {
      logger.error('[SSO-IPC] Error getting user info:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * sso:validate-id-token
   * Validate an OIDC ID token
   */
  ipcMain.handle('sso:validate-id-token', async (event, { sessionId }) => {
    try {
      if (!sessionId) {
        return { success: false, error: 'sessionId is required' };
      }

      const sessionMgr = getSSOSessionManager();
      const session = await sessionMgr.getSession(sessionId);
      if (!session) {
        return { success: false, error: 'SESSION_NOT_FOUND' };
      }

      if (!session.tokens.idToken) {
        return { success: false, error: 'NO_ID_TOKEN' };
      }

      const manager = getSSOManager();
      const validation = await manager.validateIdToken(
        session.providerId,
        session.tokens.idToken
      );

      return { success: true, data: validation };
    } catch (error) {
      logger.error('[SSO-IPC] Error validating ID token:', error);
      return { success: false, error: error.message };
    }
  });

  logger.info('[SSO-IPC] All 20 SSO IPC handlers registered successfully');
}

module.exports = { registerSSOIPC };
