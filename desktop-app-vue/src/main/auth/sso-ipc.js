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

const { ipcMain } = require("electron");
const { logger } = require("../utils/logger.js");

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
  // Test seams (same pattern as browser-ipc): ipcMain + manager instances can
  // be injected; production callers pass only { database }.
  const _ipcMain = dependencies.ipcMain || ipcMain;

  let ssoManager = dependencies.ssoManager || null;
  let ssoSessionManager = dependencies.ssoSessionManager || null;
  let identityBridge = dependencies.identityBridge || null;

  /**
   * Lazy-load and cache the SSOManager instance
   * @returns {Object} SSOManager instance
   */
  function getSSOManager() {
    if (!ssoManager) {
      const { SSOManager } = require("./sso-manager");
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
      const { SSOSessionManager } = require("./sso-session-manager");
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
      const { IdentityBridge } = require("./identity-bridge");
      identityBridge = new IdentityBridge({ database });
    }
    return identityBridge;
  }

  logger.info("[SSO-IPC] Registering 20 SSO IPC handlers");

  // ============================================
  // Config Handlers (5)
  // ============================================

  /**
   * sso:list-providers
   * List all configured SSO providers
   */
  _ipcMain.handle("sso:list-providers", async (event) => {
    try {
      const manager = getSSOManager();
      const providers = await manager.listProviders();
      return { success: true, data: providers };
    } catch (error) {
      logger.error("[SSO-IPC] Error listing providers:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * sso:add-provider
   * Add a new SSO provider configuration
   */
  _ipcMain.handle("sso:add-provider", async (event, { providerConfig }) => {
    try {
      if (!providerConfig) {
        return { success: false, error: "providerConfig is required" };
      }
      const manager = getSSOManager();
      const result = await manager.addProvider(providerConfig);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[SSO-IPC] Error adding provider:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * sso:update-provider
   * Update an existing SSO provider configuration
   */
  _ipcMain.handle(
    "sso:update-provider",
    async (event, { providerId, updates }) => {
      try {
        if (!providerId || !updates) {
          return {
            success: false,
            error: "providerId and updates are required",
          };
        }
        const manager = getSSOManager();
        const result = await manager.updateProvider(providerId, updates);
        return { success: true, data: result };
      } catch (error) {
        logger.error("[SSO-IPC] Error updating provider:", error);
        return { success: false, error: error.message };
      }
    },
  );

  /**
   * sso:delete-provider
   * Delete an SSO provider configuration
   */
  _ipcMain.handle("sso:delete-provider", async (event, { providerId }) => {
    try {
      if (!providerId) {
        return { success: false, error: "providerId is required" };
      }
      const manager = getSSOManager();
      const result = await manager.deleteProvider(providerId);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[SSO-IPC] Error deleting provider:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * sso:test-connection
   * Test connectivity to an SSO provider
   */
  _ipcMain.handle("sso:test-connection", async (event, { providerId }) => {
    try {
      if (!providerId) {
        return { success: false, error: "providerId is required" };
      }
      const manager = getSSOManager();
      const result = await manager.testConnection(providerId);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[SSO-IPC] Error testing connection:", error);
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
  _ipcMain.handle(
    "sso:initiate-login",
    async (event, { providerId, options = {} }) => {
      try {
        if (!providerId) {
          return { success: false, error: "providerId is required" };
        }
        const manager = getSSOManager();
        const result = await manager.initiateLogin(providerId, options);
        return { success: true, data: result };
      } catch (error) {
        logger.error("[SSO-IPC] Error initiating login:", error);
        return { success: false, error: error.message };
      }
    },
  );

  /**
   * sso:handle-callback
   * Handle the SSO callback after provider authentication
   */
  _ipcMain.handle(
    "sso:handle-callback",
    async (event, { providerId, callbackData }) => {
      try {
        if (!providerId || !callbackData) {
          return {
            success: false,
            error: "providerId and callbackData are required",
          };
        }
        const manager = getSSOManager();
        const authResult = await manager.handleCallback(
          providerId,
          callbackData,
        );

        // SSOManager is the authoritative session store: handleCallback already
        // created + persisted the session (sso_sessions, tokens encrypted) and
        // returns it as `session`. The old code here waited for
        // `authResult.tokens` — a field the manager never returns — so its
        // session-manager branch was dead and the renderer never learned the
        // sessionId. Surface manager failures as failures (the renderer treated
        // a wrapped {success:false} payload as success), and flatten `session`
        // top-level (the renderer store reads `result.session`).
        if (!authResult || authResult.success === false) {
          return {
            success: false,
            error: authResult?.error || "SSO callback failed",
          };
        }
        return {
          success: true,
          data: authResult,
          session: authResult.session || null,
        };
      } catch (error) {
        logger.error("[SSO-IPC] Error handling callback:", error);
        return { success: false, error: error.message };
      }
    },
  );

  /**
   * sso:logout
   * Logout from an SSO provider and invalidate session
   */
  _ipcMain.handle("sso:logout", async (event, { sessionId, userDid }) => {
    try {
      // The renderer store sends only { sessionId }; the old contract required
      // providerId and then passed it as the FIRST argument to
      // manager.logout(sessionId) — so renderer logouts always failed
      // ("providerId is required") and provider-side token revocation never
      // ran even when providerId was supplied.
      if (!sessionId && !userDid) {
        return { success: false, error: "sessionId or userDid is required" };
      }

      const manager = getSSOManager();
      const sessionMgr = getSSOSessionManager();

      if (sessionId) {
        // Authoritative logout: revokes provider tokens + marks the
        // sso_sessions row REVOKED. Best-effort invalidate any parallel
        // session-manager record too (different id space; may not exist).
        const result = await manager.logout(sessionId);
        try {
          await sessionMgr.invalidateSession(sessionId);
        } catch (_e) {
          /* the parallel store may not know this id */
        }
        if (!result || result.success === false) {
          return { success: false, error: result?.error || "Logout failed" };
        }
        return { success: true, data: result };
      }

      // userDid-only: revoke every active manager session for the user.
      const sessions = await manager.getActiveSessions(userDid);
      let revoked = 0;
      for (const s of sessions) {
        const r = await manager.logout(s.id);
        if (r && r.success !== false) {
          revoked++;
        }
      }
      try {
        await sessionMgr.invalidateAllSessions(userDid);
      } catch (_e) {
        /* best-effort */
      }
      return { success: true, data: { revoked, total: sessions.length } };
    } catch (error) {
      logger.error("[SSO-IPC] Error during logout:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * sso:refresh-token
   * Refresh OAuth2 tokens for a session
   */
  _ipcMain.handle("sso:refresh-token", async (event, { sessionId }) => {
    try {
      if (!sessionId) {
        return { success: false, error: "sessionId is required" };
      }

      // SSOManager owns the session/token lifecycle: refreshToken(sessionId)
      // decrypts the stored refresh token, exchanges it at the provider,
      // persists the new tokens and reschedules auto-refresh. The old code
      // read the PARALLEL sso-session-manager store (never populated on the
      // SSO login path → always SESSION_NOT_FOUND) and then called
      // refreshToken(providerId, refreshToken) against a (sessionId)
      // signature, feeding the resulting failure object into updateTokens,
      // which threw — the whole IPC was unusable end to end.
      const manager = getSSOManager();
      const result = await manager.refreshToken(sessionId);
      if (!result || result.success === false) {
        return {
          success: false,
          error: result?.error || "Token refresh failed",
        };
      }
      return { success: true, data: result };
    } catch (error) {
      logger.error("[SSO-IPC] Error refreshing token:", error);
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
  _ipcMain.handle(
    "sso:link-identity",
    async (event, { did, providerId, ssoSubject, ssoAttributes }) => {
      try {
        if (!did || !providerId || !ssoSubject) {
          return {
            success: false,
            error: "did, providerId, and ssoSubject are required",
          };
        }
        const bridge = getIdentityBridge();
        const result = await bridge.linkIdentity(
          did,
          providerId,
          ssoSubject,
          ssoAttributes || {},
        );
        return { success: true, data: result };
      } catch (error) {
        logger.error("[SSO-IPC] Error linking identity:", error);
        return { success: false, error: error.message };
      }
    },
  );

  /**
   * sso:unlink-identity
   * Unlink a DID from an SSO provider
   */
  _ipcMain.handle("sso:unlink-identity", async (event, { did, providerId }) => {
    try {
      if (!did || !providerId) {
        return { success: false, error: "did and providerId are required" };
      }
      const bridge = getIdentityBridge();
      const result = await bridge.unlinkIdentity(did, providerId);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[SSO-IPC] Error unlinking identity:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * sso:get-linked-identities
   * Get all SSO identities linked to a DID
   */
  _ipcMain.handle(
    "sso:get-linked-identities",
    async (event, { did, options = {} }) => {
      try {
        if (!did) {
          return { success: false, error: "did is required" };
        }
        const bridge = getIdentityBridge();
        const identities = await bridge.getLinkedIdentities(did, options);
        return { success: true, data: identities };
      } catch (error) {
        logger.error("[SSO-IPC] Error getting linked identities:", error);
        return { success: false, error: error.message };
      }
    },
  );

  /**
   * sso:verify-link
   * Verify an identity mapping
   */
  _ipcMain.handle("sso:verify-link", async (event, { mappingId }) => {
    try {
      if (!mappingId) {
        return { success: false, error: "mappingId is required" };
      }
      const bridge = getIdentityBridge();
      const result = await bridge.verifyLink(mappingId);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[SSO-IPC] Error verifying link:", error);
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
  _ipcMain.handle("sso:get-sessions", async (event, { userDid }) => {
    try {
      if (!userDid) {
        return { success: false, error: "userDid is required" };
      }
      // Authoritative store: SSOManager's sso_sessions (where handleCallback
      // records logins). The old code listed the parallel session-manager
      // store, which the SSO login path never populates → always []. The
      // mapped shape carries no token material. `sessions` is flattened
      // top-level because the renderer store reads `result.sessions`.
      const manager = getSSOManager();
      const sessions = await manager.getActiveSessions(userDid);

      return { success: true, data: sessions, sessions };
    } catch (error) {
      logger.error("[SSO-IPC] Error getting sessions:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * sso:invalidate-session
   * Invalidate (delete) a specific SSO session
   */
  _ipcMain.handle("sso:invalidate-session", async (event, { sessionId }) => {
    try {
      if (!sessionId) {
        return { success: false, error: "sessionId is required" };
      }
      // Authoritative store is SSOManager's sso_sessions (the parallel
      // session-manager is never populated by the login path, so the old
      // lookup always missed real sessions). logout() revokes provider
      // tokens + marks the row REVOKED; mirror to the parallel store
      // best-effort, same as sso:logout.
      const manager = getSSOManager();
      const result = await manager.logout(sessionId);
      try {
        await getSSOSessionManager().invalidateSession(sessionId);
      } catch (_e) {
        /* the parallel store may not know this id */
      }
      if (!result || result.success === false) {
        return {
          success: false,
          error: result?.error || "Failed to invalidate session",
        };
      }
      return { success: true, data: result };
    } catch (error) {
      logger.error("[SSO-IPC] Error invalidating session:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * sso:get-session-info
   * Get session metadata without sensitive token data
   */
  _ipcMain.handle("sso:get-session-info", async (event, { sessionId }) => {
    try {
      if (!sessionId) {
        return { success: false, error: "sessionId is required" };
      }
      // Authoritative sso_sessions lookup (metadata only, no token
      // material) — the parallel session-manager never sees real logins.
      const manager = getSSOManager();
      const info = await manager.getSessionInfo(sessionId);
      if (!info) {
        return { success: false, error: "SESSION_NOT_FOUND" };
      }
      return { success: true, data: info };
    } catch (error) {
      logger.error("[SSO-IPC] Error getting session info:", error);
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
  _ipcMain.handle("sso:get-saml-metadata", async (event, { providerId }) => {
    try {
      if (!providerId) {
        return { success: false, error: "providerId is required" };
      }
      const manager = getSSOManager();
      const metadata = await manager.getSAMLMetadata(providerId);
      return { success: true, data: metadata };
    } catch (error) {
      logger.error("[SSO-IPC] Error getting SAML metadata:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * sso:parse-assertion
   * Parse and validate a SAML assertion response
   */
  _ipcMain.handle(
    "sso:parse-assertion",
    async (event, { providerId, samlResponse }) => {
      try {
        if (!providerId || !samlResponse) {
          return {
            success: false,
            error: "providerId and samlResponse are required",
          };
        }
        const manager = getSSOManager();
        const assertion = await manager.parseAssertion(
          providerId,
          samlResponse,
        );
        return { success: true, data: assertion };
      } catch (error) {
        logger.error("[SSO-IPC] Error parsing SAML assertion:", error);
        return { success: false, error: error.message };
      }
    },
  );

  // ============================================
  // OIDC Handlers (2)
  // ============================================

  /**
   * sso:get-userinfo
   * Get user info from OIDC provider using access token
   */
  _ipcMain.handle("sso:get-userinfo", async (event, { sessionId }) => {
    try {
      if (!sessionId) {
        return { success: false, error: "sessionId is required" };
      }

      // Delegate wholesale to the authoritative manager: the old path read
      // the never-populated parallel session store (always SESSION_NOT_FOUND
      // for real logins) and then called manager.getUserInfo(), which does
      // not exist. Token decryption stays inside the manager.
      const manager = getSSOManager();
      const result = await manager.getSessionUserInfo(sessionId);
      if (!result.success) {
        return { success: false, error: result.error };
      }
      return { success: true, data: result.userInfo };
    } catch (error) {
      logger.error("[SSO-IPC] Error getting user info:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * sso:validate-id-token
   * Validate an OIDC ID token
   */
  _ipcMain.handle("sso:validate-id-token", async (event, { sessionId }) => {
    try {
      if (!sessionId) {
        return { success: false, error: "sessionId is required" };
      }

      // Same migration as sso:get-userinfo: authoritative store + validation
      // inside the manager (fail-closed), instead of the never-populated
      // parallel store + a manager.validateIdToken() that does not exist.
      const manager = getSSOManager();
      const result = await manager.validateSessionIdToken(sessionId);
      if (!result.success) {
        return { success: false, error: result.error };
      }
      return { success: true, data: result.claims };
    } catch (error) {
      logger.error("[SSO-IPC] Error validating ID token:", error);
      return { success: false, error: error.message };
    }
  });

  logger.info("[SSO-IPC] All 20 SSO IPC handlers registered successfully");
}

module.exports = { registerSSOIPC };
