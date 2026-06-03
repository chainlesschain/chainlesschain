/**
 * OAuthProvider - OAuth 2.0 + OpenID Connect provider implementation
 *
 * Handles OAuth 2.0 and OIDC authentication flows with PKCE support.
 * Uses Node.js built-in `https` module for HTTP requests (no external dependencies).
 *
 * Features:
 * - Authorization URL generation with PKCE
 * - Authorization code exchange with PKCE verification
 * - Access token refresh via refresh_token grant
 * - UserInfo endpoint querying
 * - ID token (JWT) basic validation
 * - Token revocation
 *
 * @module auth/oauth-provider
 * @since v0.34.0
 */

const { logger } = require('../utils/logger.js');
const crypto = require('crypto');
const https = require('https');
const http = require('http');
const { URL } = require('url');

// ─── Constants ───

const DEFAULT_TIMEOUT = 15000; // 15 seconds
const MAX_RESPONSE_SIZE = 1024 * 1024; // 1MB max response
const USER_AGENT = 'ChainlessChain-OAuth/1.0';

// ─── JWT Decode Helpers ───

/**
 * Base64url decode helper
 * @param {string} str - Base64url encoded string
 * @returns {string} Decoded string
 */
function base64UrlDecode(str) {
  // Replace base64url characters with standard base64
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  // Add padding if needed
  const padding = 4 - (base64.length % 4);
  if (padding !== 4) {
    base64 += '='.repeat(padding);
  }
  return Buffer.from(base64, 'base64').toString('utf8');
}

/**
 * Parse JWT without verification (for claim extraction)
 * @param {string} token - JWT string
 * @returns {Object} { header, payload, signature }
 */
function decodeJWT(token) {
  if (!token || typeof token !== 'string') {
    throw new Error('Invalid JWT: token must be a non-empty string');
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid JWT: must have 3 parts separated by dots');
  }

  try {
    const header = JSON.parse(base64UrlDecode(parts[0]));
    const payload = JSON.parse(base64UrlDecode(parts[1]));
    const signature = parts[2];

    return { header, payload, signature };
  } catch (parseError) {
    throw new Error(`Invalid JWT: failed to decode - ${parseError.message}`);
  }
}

// ─── Main Class ───

class OAuthProvider {
  /**
   * Create an OAuthProvider instance
   * @param {Object} options - Configuration options
   * @param {Object} options.config - Provider-specific configuration
   * @param {string} options.config.clientId - OAuth client ID
   * @param {string} [options.config.clientSecret] - OAuth client secret (optional for PKCE public clients)
   * @param {string} options.config.authorizationEndpoint - Authorization URL
   * @param {string} options.config.tokenEndpoint - Token exchange URL
   * @param {string} [options.config.userinfoEndpoint] - UserInfo URL (OIDC)
   * @param {string} [options.config.revocationEndpoint] - Token revocation URL
   * @param {string[]} [options.config.scopes] - Default scopes to request
   * @param {string} options.config.redirectUri - OAuth redirect URI
   * @param {string} [options.config.issuer] - Expected token issuer (OIDC)
   * @param {number} [options.config.timeout] - HTTP request timeout in ms
   */
  constructor({ config } = {}) {
    if (!config) {
      throw new Error('[OAuthProvider] config parameter is required');
    }

    if (!config.clientId) {
      throw new Error('[OAuthProvider] config.clientId is required');
    }

    if (!config.authorizationEndpoint) {
      throw new Error('[OAuthProvider] config.authorizationEndpoint is required');
    }

    if (!config.tokenEndpoint) {
      throw new Error('[OAuthProvider] config.tokenEndpoint is required');
    }

    if (!config.redirectUri) {
      throw new Error('[OAuthProvider] config.redirectUri is required');
    }

    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret || null;
    this.authorizationEndpoint = config.authorizationEndpoint;
    this.tokenEndpoint = config.tokenEndpoint;
    this.userinfoEndpoint = config.userinfoEndpoint || null;
    this.revocationEndpoint = config.revocationEndpoint || null;
    this.scopes = config.scopes || [];
    this.redirectUri = config.redirectUri;
    this.issuer = config.issuer || null;
    this.timeout = config.timeout || DEFAULT_TIMEOUT;

    logger.debug('[OAuthProvider] Initialized for client:', this.clientId);
  }

  // ════════════════════════════════════════════
  // Authorization
  // ════════════════════════════════════════════

  /**
   * Build the authorization URL with all required parameters
   * @param {string} state - CSRF protection state parameter
   * @param {string} codeChallenge - PKCE code challenge (S256)
   * @param {Object} [options] - Additional parameters
   * @param {string[]} [options.scopes] - Override default scopes
   * @param {string} [options.loginHint] - Hint for user's email/identity
   * @param {string} [options.prompt] - OAuth prompt parameter (login, consent, none)
   * @param {string} [options.nonce] - OIDC nonce for ID token validation
   * @param {Object} [options.additionalParams] - Extra query parameters
   * @returns {string} Complete authorization URL
   */
  getAuthorizationUrl(state, codeChallenge, options = {}) {
    if (!state) {
      throw new Error('[OAuthProvider] state parameter is required');
    }

    const params = new URLSearchParams();

    // Required OAuth 2.0 parameters
    params.set('response_type', 'code');
    params.set('client_id', this.clientId);
    params.set('redirect_uri', this.redirectUri);
    params.set('state', state);

    // PKCE parameters
    if (codeChallenge) {
      params.set('code_challenge', codeChallenge);
      params.set('code_challenge_method', 'S256');
    }

    // Scopes
    const requestScopes = options.scopes || this.scopes;
    if (requestScopes.length > 0) {
      params.set('scope', requestScopes.join(' '));
    }

    // Optional standard parameters
    if (options.loginHint) {
      params.set('login_hint', options.loginHint);
    }

    if (options.prompt) {
      params.set('prompt', options.prompt);
    }

    if (options.nonce) {
      params.set('nonce', options.nonce);
    }

    // Additional custom parameters
    if (options.additionalParams && typeof options.additionalParams === 'object') {
      for (const [key, value] of Object.entries(options.additionalParams)) {
        if (value !== undefined && value !== null) {
          params.set(key, String(value));
        }
      }
    }

    // Build final URL
    const baseUrl = this.authorizationEndpoint;
    const separator = baseUrl.includes('?') ? '&' : '?';
    const url = `${baseUrl}${separator}${params.toString()}`;

    logger.debug('[OAuthProvider] Authorization URL generated for state:', state);

    return url;
  }

  // ════════════════════════════════════════════
  // Token Exchange
  // ════════════════════════════════════════════

  /**
   * Exchange an authorization code for tokens
   * @param {string} code - Authorization code received from callback
   * @param {string} [codeVerifier] - PKCE code verifier
   * @returns {Promise<Object>} Token response with access_token, refresh_token, id_token, etc.
   */
  async exchangeCode(code, codeVerifier) {
    if (!code) {
      throw new Error('[OAuthProvider] Authorization code is required');
    }

    const params = new URLSearchParams();
    params.set('grant_type', 'authorization_code');
    params.set('code', code);
    params.set('redirect_uri', this.redirectUri);
    params.set('client_id', this.clientId);

    // Include client secret if available (confidential clients)
    if (this.clientSecret) {
      params.set('client_secret', this.clientSecret);
    }

    // Include PKCE verifier
    if (codeVerifier) {
      params.set('code_verifier', codeVerifier);
    }

    logger.debug('[OAuthProvider] Exchanging authorization code for tokens');

    const response = await this._httpPost(this.tokenEndpoint, params.toString(), {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json'
    });

    if (response.error) {
      const errorMsg = response.error_description || response.error;
      logger.error('[OAuthProvider] Code exchange failed:', errorMsg);
      throw new Error(`Token exchange failed: ${errorMsg}`);
    }

    logger.info('[OAuthProvider] Code exchange successful, received tokens');

    return {
      access_token: response.access_token,
      token_type: response.token_type || 'Bearer',
      expires_in: response.expires_in || null,
      refresh_token: response.refresh_token || null,
      id_token: response.id_token || null,
      scope: response.scope || null
    };
  }

  /**
   * Refresh an access token using a refresh token
   * @param {string} refreshToken - The refresh token
   * @returns {Promise<Object>} New token response
   */
  async refreshAccessToken(refreshToken) {
    if (!refreshToken) {
      throw new Error('[OAuthProvider] Refresh token is required');
    }

    const params = new URLSearchParams();
    params.set('grant_type', 'refresh_token');
    params.set('refresh_token', refreshToken);
    params.set('client_id', this.clientId);

    // Include client secret if available
    if (this.clientSecret) {
      params.set('client_secret', this.clientSecret);
    }

    logger.debug('[OAuthProvider] Refreshing access token');

    const response = await this._httpPost(this.tokenEndpoint, params.toString(), {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json'
    });

    if (response.error) {
      const errorMsg = response.error_description || response.error;
      logger.error('[OAuthProvider] Token refresh failed:', errorMsg);
      throw new Error(`Token refresh failed: ${errorMsg}`);
    }

    logger.info('[OAuthProvider] Token refresh successful');

    return {
      access_token: response.access_token,
      token_type: response.token_type || 'Bearer',
      expires_in: response.expires_in || null,
      refresh_token: response.refresh_token || null,
      id_token: response.id_token || null,
      scope: response.scope || null
    };
  }

  // ════════════════════════════════════════════
  // User Info
  // ════════════════════════════════════════════

  /**
   * Fetch user information from the UserInfo endpoint
   * @param {string} accessToken - Valid access token
   * @returns {Promise<Object>} User information claims
   */
  async getUserInfo(accessToken) {
    if (!accessToken) {
      throw new Error('[OAuthProvider] Access token is required');
    }

    if (!this.userinfoEndpoint) {
      throw new Error('[OAuthProvider] UserInfo endpoint is not configured');
    }

    logger.debug('[OAuthProvider] Fetching user info');

    const response = await this._httpGet(this.userinfoEndpoint, {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json'
    });

    if (response.error) {
      const errorMsg = response.error_description || response.error;
      logger.error('[OAuthProvider] UserInfo request failed:', errorMsg);
      throw new Error(`UserInfo request failed: ${errorMsg}`);
    }

    logger.info('[OAuthProvider] UserInfo fetched successfully');

    return response;
  }

  // ════════════════════════════════════════════
  // ID Token Validation
  // ════════════════════════════════════════════

  /**
   * Validate an ID token (basic JWT validation)
   *
   * Note: This performs basic structural and claim validation only.
   * For full cryptographic signature verification, use a dedicated JWT library.
   *
   * @param {string} idToken - The JWT ID token to validate
   * @param {Object} [options] - Validation options
   * @param {string} [options.nonce] - Expected nonce value
   * @param {number} [options.clockSkew] - Allowed clock skew in seconds (default: 300)
   * @returns {Object} Decoded token payload (claims)
   */
  validateIdToken(idToken, options = {}) {
    if (!idToken) {
      throw new Error('[OAuthProvider] ID token is required');
    }

    const clockSkew = options.clockSkew || 300; // 5 minutes default

    // Decode the JWT
    const decoded = decodeJWT(idToken);
    const { header, payload } = decoded;

    const validationErrors = [];

    // 1. Check algorithm (should be RS256, RS384, RS512, ES256, etc.)
    const allowedAlgorithms = ['RS256', 'RS384', 'RS512', 'ES256', 'ES384', 'ES512', 'PS256', 'PS384', 'PS512'];
    if (header.alg && !allowedAlgorithms.includes(header.alg)) {
      validationErrors.push(`Unsupported algorithm: ${header.alg}`);
    }

    // 2. Check issuer (iss)
    if (this.issuer && payload.iss) {
      const normalizedIssuer = this.issuer.replace(/\/$/, '');
      const normalizedPayloadIss = payload.iss.replace(/\/$/, '');
      if (normalizedIssuer !== normalizedPayloadIss) {
        validationErrors.push(`Issuer mismatch: expected ${this.issuer}, got ${payload.iss}`);
      }
    }

    // 3. Check audience (aud)
    if (payload.aud) {
      const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
      if (!audiences.includes(this.clientId)) {
        validationErrors.push(`Audience mismatch: token audience ${JSON.stringify(payload.aud)} does not include client ${this.clientId}`);
      }

      // If multiple audiences, azp must be present and match clientId
      if (audiences.length > 1) {
        if (payload.azp && payload.azp !== this.clientId) {
          validationErrors.push(`Authorized party mismatch: expected ${this.clientId}, got ${payload.azp}`);
        }
      }
    }

    // 4. Check expiration (exp)
    if (payload.exp) {
      const now = Math.floor(Date.now() / 1000);
      if (payload.exp + clockSkew < now) {
        validationErrors.push(`Token has expired: exp=${payload.exp}, now=${now}`);
      }
    } else {
      validationErrors.push('Token missing expiration claim (exp)');
    }

    // 5. Check issued at (iat) - should not be in the future
    if (payload.iat) {
      const now = Math.floor(Date.now() / 1000);
      if (payload.iat - clockSkew > now) {
        validationErrors.push(`Token issued in the future: iat=${payload.iat}, now=${now}`);
      }
    }

    // 6. Check not before (nbf) if present
    if (payload.nbf) {
      const now = Math.floor(Date.now() / 1000);
      if (payload.nbf - clockSkew > now) {
        validationErrors.push(`Token not yet valid: nbf=${payload.nbf}, now=${now}`);
      }
    }

    // 7. Check nonce if provided
    if (options.nonce && payload.nonce !== options.nonce) {
      validationErrors.push(`Nonce mismatch: expected ${options.nonce}, got ${payload.nonce}`);
    }

    // 8. Check subject (sub) - must be present
    if (!payload.sub) {
      validationErrors.push('Token missing subject claim (sub)');
    }

    // Log validation result
    if (validationErrors.length > 0) {
      logger.warn('[OAuthProvider] ID token validation warnings:', validationErrors);
      logger.warn('[OAuthProvider] Note: Cryptographic signature verification requires a dedicated JWT library');
    } else {
      logger.info('[OAuthProvider] ID token basic validation passed');
    }

    // Return payload with validation status
    return {
      ...payload,
      _validation: {
        valid: validationErrors.length === 0,
        errors: validationErrors,
        algorithm: header.alg,
        signatureVerified: false // We don't verify signature without external library
      }
    };
  }

  // ════════════════════════════════════════════
  // Token Revocation
  // ════════════════════════════════════════════

  /**
   * Revoke a token (access or refresh) at the provider
   * @param {string} token - The token to revoke
   * @param {string} [tokenTypeHint] - 'access_token' or 'refresh_token'
   * @returns {Promise<Object>} Revocation result
   */
  async revokeToken(token, tokenTypeHint) {
    if (!token) {
      throw new Error('[OAuthProvider] Token is required for revocation');
    }

    if (!this.revocationEndpoint) {
      logger.debug('[OAuthProvider] No revocation endpoint configured, skipping revocation');
      return { success: false, error: 'Revocation endpoint not configured' };
    }

    const params = new URLSearchParams();
    params.set('token', token);
    params.set('client_id', this.clientId);

    if (tokenTypeHint) {
      params.set('token_type_hint', tokenTypeHint);
    }

    if (this.clientSecret) {
      params.set('client_secret', this.clientSecret);
    }

    logger.debug('[OAuthProvider] Revoking token');

    try {
      const response = await this._httpPost(this.revocationEndpoint, params.toString(), {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json'
      });

      // RFC 7009: The authorization server responds with HTTP 200 for both
      // valid and invalid tokens to prevent token scanning attacks
      if (response.error) {
        logger.warn('[OAuthProvider] Token revocation returned error:', response.error);
        return { success: false, error: response.error_description || response.error };
      }

      logger.info('[OAuthProvider] Token revoked successfully');
      return { success: true };
    } catch (error) {
      logger.error('[OAuthProvider] Token revocation failed:', error.message);
      return { success: false, error: error.message };
    }
  }

  // ════════════════════════════════════════════
  // Private: HTTP Client
  // ════════════════════════════════════════════

  /**
   * Perform an HTTP POST request
   * @private
   * @param {string} url - Request URL
   * @param {string} body - Request body
   * @param {Object} headers - Request headers
   * @returns {Promise<Object>} Parsed JSON response
   */
  _httpPost(url, body, headers = {}) {
    return new Promise((resolve, reject) => {
      try {
        const parsedUrl = new URL(url);
        const protocol = parsedUrl.protocol === 'https:' ? https : http;
        const bodyBuffer = Buffer.from(body, 'utf8');

        const options = {
          hostname: parsedUrl.hostname,
          port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
          path: parsedUrl.pathname + parsedUrl.search,
          method: 'POST',
          timeout: this.timeout,
          headers: {
            'User-Agent': USER_AGENT,
            'Content-Length': bodyBuffer.length,
            ...headers
          }
        };

        // Add basic auth for confidential clients if client_secret is not in body
        if (this.clientSecret && !body.includes('client_secret=')) {
          const credentials = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
          options.headers['Authorization'] = `Basic ${credentials}`;
        }

        const req = protocol.request(options, (res) => {
          this._handleResponse(res, resolve, reject);
        });

        req.on('error', (err) => {
          logger.error('[OAuthProvider] HTTP POST error:', err.message);
          reject(new Error(`HTTP request failed: ${err.message}`));
        });

        req.on('timeout', () => {
          req.destroy();
          reject(new Error(`HTTP request timed out after ${this.timeout}ms`));
        });

        req.write(bodyBuffer);
        req.end();
      } catch (error) {
        reject(new Error(`Invalid URL or request error: ${error.message}`));
      }
    });
  }

  /**
   * Perform an HTTP GET request
   * @private
   * @param {string} url - Request URL
   * @param {Object} headers - Request headers
   * @returns {Promise<Object>} Parsed JSON response
   */
  _httpGet(url, headers = {}) {
    return new Promise((resolve, reject) => {
      try {
        const parsedUrl = new URL(url);
        const protocol = parsedUrl.protocol === 'https:' ? https : http;

        const options = {
          hostname: parsedUrl.hostname,
          port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
          path: parsedUrl.pathname + parsedUrl.search,
          method: 'GET',
          timeout: this.timeout,
          headers: {
            'User-Agent': USER_AGENT,
            ...headers
          }
        };

        const req = protocol.request(options, (res) => {
          this._handleResponse(res, resolve, reject);
        });

        req.on('error', (err) => {
          logger.error('[OAuthProvider] HTTP GET error:', err.message);
          reject(new Error(`HTTP request failed: ${err.message}`));
        });

        req.on('timeout', () => {
          req.destroy();
          reject(new Error(`HTTP request timed out after ${this.timeout}ms`));
        });

        req.end();
      } catch (error) {
        reject(new Error(`Invalid URL or request error: ${error.message}`));
      }
    });
  }

  /**
   * Handle HTTP response - collect body and parse JSON
   * @private
   * @param {http.IncomingMessage} res - HTTP response
   * @param {Function} resolve - Promise resolve
   * @param {Function} reject - Promise reject
   */
  _handleResponse(res, resolve, reject) {
    const chunks = [];
    let totalSize = 0;

    // Handle redirects (3xx)
    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
      logger.debug(`[OAuthProvider] Following redirect to: ${res.headers.location}`);
      // For simplicity, we only follow GET redirects
      this._httpGet(res.headers.location, {}).then(resolve).catch(reject);
      return;
    }

    res.on('data', (chunk) => {
      totalSize += chunk.length;
      if (totalSize > MAX_RESPONSE_SIZE) {
        res.destroy();
        reject(new Error('Response body exceeds maximum allowed size'));
        return;
      }
      chunks.push(chunk);
    });

    res.on('end', () => {
      const rawBody = Buffer.concat(chunks).toString('utf8');

      // Check for HTTP errors
      if (res.statusCode >= 400) {
        let errorBody;
        try {
          errorBody = JSON.parse(rawBody);
        } catch (parseErr) {
          errorBody = { error: 'server_error', error_description: rawBody.substring(0, 500) };
        }

        logger.error(`[OAuthProvider] HTTP ${res.statusCode}:`, errorBody);

        if (res.statusCode === 401) {
          resolve({ error: 'unauthorized', error_description: errorBody.error_description || 'Invalid or expired token' });
        } else {
          resolve({
            error: errorBody.error || `http_${res.statusCode}`,
            error_description: errorBody.error_description || errorBody.message || `HTTP ${res.statusCode}`
          });
        }
        return;
      }

      // Parse JSON response
      if (!rawBody || rawBody.trim().length === 0) {
        resolve({});
        return;
      }

      try {
        const parsed = JSON.parse(rawBody);
        resolve(parsed);
      } catch (parseError) {
        // Some providers return form-encoded responses
        try {
          const formParsed = {};
          const formParams = new URLSearchParams(rawBody);
          for (const [key, value] of formParams.entries()) {
            formParsed[key] = value;
          }

          // Convert numeric strings
          if (formParsed.expires_in) {
            formParsed.expires_in = parseInt(formParsed.expires_in, 10);
          }

          resolve(formParsed);
        } catch (formParseError) {
          logger.error('[OAuthProvider] Failed to parse response:', rawBody.substring(0, 200));
          reject(new Error('Failed to parse provider response'));
        }
      }
    });

    res.on('error', (err) => {
      reject(new Error(`Response stream error: ${err.message}`));
    });
  }
}

module.exports = { OAuthProvider };
