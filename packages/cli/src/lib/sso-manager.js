/**
 * SSO Manager — CLI port of Phase 14 SSO Enterprise Authentication.
 *
 * Scope note: the CLI can't open a browser and isn't a redirect target,
 * so it covers configuration, PKCE helpers, authorization-URL / SAML
 * AuthnRequest builders, token storage (AES-256-GCM), session lifecycle
 * and the DID ↔ SSO identity bridge. The actual IdP browser round-trip
 * is driven by an external tool; callers feed the resulting tokens back
 * in via `completeLogin()`.
 */

import crypto from "crypto";

/* ── Constants ─────────────────────────────────────────────── */

export const SSO_PROTOCOLS = Object.freeze({
  SAML: "saml",
  OAUTH2: "oauth2",
  OIDC: "oidc",
});

const SUPPORTED_PROTOCOLS = new Set(Object.values(SSO_PROTOCOLS));

export const PROVIDER_TYPES = Object.freeze([
  "azure_ad",
  "okta",
  "google",
  "onelogin",
  "custom",
]);

export const SESSION_STATUS = Object.freeze({
  ACTIVE: "active",
  EXPIRED: "expired",
  REVOKED: "revoked",
});

export const TEST_STATUS = Object.freeze({
  UNTESTED: "untested",
  SUCCESS: "success",
  FAILED: "failed",
});

/* ── Provider templates (static snapshot) ──────────────────── */

const PROVIDER_TEMPLATES = Object.freeze([
  Object.freeze({
    id: "azure_ad_oidc",
    name: "Azure AD (OIDC)",
    providerType: "azure_ad",
    protocol: SSO_PROTOCOLS.OIDC,
    hints: Object.freeze({
      authorizationUrl:
        "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize",
      tokenUrl: "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token",
      userInfoUrl: "https://graph.microsoft.com/oidc/userinfo",
      scopes: Object.freeze(["openid", "profile", "email", "offline_access"]),
      codeChallengeMethod: "S256",
    }),
  }),
  Object.freeze({
    id: "okta_oidc",
    name: "Okta (OIDC)",
    providerType: "okta",
    protocol: SSO_PROTOCOLS.OIDC,
    hints: Object.freeze({
      authorizationUrl: "https://{domain}/oauth2/default/v1/authorize",
      tokenUrl: "https://{domain}/oauth2/default/v1/token",
      userInfoUrl: "https://{domain}/oauth2/default/v1/userinfo",
      scopes: Object.freeze(["openid", "profile", "email", "offline_access"]),
      codeChallengeMethod: "S256",
    }),
  }),
  Object.freeze({
    id: "google_oidc",
    name: "Google Workspace (OIDC)",
    providerType: "google",
    protocol: SSO_PROTOCOLS.OIDC,
    hints: Object.freeze({
      authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      userInfoUrl: "https://openidconnect.googleapis.com/v1/userinfo",
      scopes: Object.freeze(["openid", "profile", "email"]),
      codeChallengeMethod: "S256",
    }),
  }),
  Object.freeze({
    id: "okta_saml",
    name: "Okta (SAML 2.0)",
    providerType: "okta",
    protocol: SSO_PROTOCOLS.SAML,
    hints: Object.freeze({
      nameIdFormat: "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress",
      signRequests: true,
      wantAssertionsSigned: true,
    }),
  }),
  Object.freeze({
    id: "custom_oauth2",
    name: "Generic OAuth 2.0",
    providerType: "custom",
    protocol: SSO_PROTOCOLS.OAUTH2,
    hints: Object.freeze({
      codeChallengeMethod: "S256",
    }),
  }),
]);

export function listProviderTemplates() {
  return PROVIDER_TEMPLATES.map((t) => ({
    ...t,
    hints: {
      ...t.hints,
      scopes: t.hints.scopes ? [...t.hints.scopes] : undefined,
    },
  }));
}

export function getProviderTemplate(id) {
  const t = PROVIDER_TEMPLATES.find((x) => x.id === id);
  return t
    ? {
        ...t,
        hints: {
          ...t.hints,
          scopes: t.hints.scopes ? [...t.hints.scopes] : undefined,
        },
      }
    : null;
}

/* ── Schema ────────────────────────────────────────────────── */

export function ensureSSOTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sso_configurations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      protocol TEXT NOT NULL,
      provider_type TEXT NOT NULL,
      config TEXT NOT NULL,
      enabled INTEGER DEFAULT 1,
      metadata TEXT,
      last_tested INTEGER,
      test_status TEXT DEFAULT 'untested',
      test_error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS sso_sessions (
      id TEXT PRIMARY KEY,
      config_id TEXT NOT NULL,
      did TEXT,
      access_token TEXT,
      refresh_token TEXT,
      id_token TEXT,
      token_expires_at INTEGER,
      user_info TEXT,
      status TEXT DEFAULT 'active',
      created_at INTEGER NOT NULL,
      last_refreshed INTEGER
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS sso_identity_mappings (
      id TEXT PRIMARY KEY,
      did TEXT NOT NULL,
      sso_provider TEXT NOT NULL,
      sso_user_id TEXT NOT NULL,
      sso_email TEXT,
      sso_display_name TEXT,
      attributes TEXT,
      linked_at INTEGER NOT NULL,
      last_login INTEGER,
      UNIQUE(sso_provider, sso_user_id)
    )
  `);
}

/* ── ID + helpers ──────────────────────────────────────────── */

function _id(prefix) {
  return `${prefix}_${crypto.randomBytes(6).toString("hex")}`;
}

function _now() {
  return Date.now();
}

function _parseJSON(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function _mapConfigRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    protocol: row.protocol,
    providerType: row.provider_type,
    config: _parseJSON(row.config, {}),
    enabled: !!row.enabled,
    metadata: _parseJSON(row.metadata, {}),
    lastTested: row.last_tested || null,
    testStatus: row.test_status || TEST_STATUS.UNTESTED,
    testError: row.test_error || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function _mapSessionRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    configId: row.config_id,
    did: row.did || null,
    accessToken: _parseJSON(row.access_token, null),
    refreshToken: _parseJSON(row.refresh_token, null),
    idToken: _parseJSON(row.id_token, null),
    tokenExpiresAt: row.token_expires_at || null,
    userInfo: _parseJSON(row.user_info, {}),
    status: row.status,
    createdAt: row.created_at,
    lastRefreshed: row.last_refreshed || null,
  };
}

function _mapMappingRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    did: row.did,
    ssoProvider: row.sso_provider,
    ssoUserId: row.sso_user_id,
    ssoEmail: row.sso_email || null,
    ssoDisplayName: row.sso_display_name || null,
    attributes: _parseJSON(row.attributes, {}),
    linkedAt: row.linked_at,
    lastLogin: row.last_login || null,
  };
}

/* ── Configuration CRUD ────────────────────────────────────── */

export function createConfiguration(db, input = {}) {
  const {
    name,
    protocol,
    providerType = "custom",
    config = {},
    metadata = {},
    enabled = true,
  } = input;
  if (!name || typeof name !== "string") throw new Error("name is required");
  if (!SUPPORTED_PROTOCOLS.has(protocol)) {
    throw new Error(
      `protocol must be one of ${[...SUPPORTED_PROTOCOLS].join(", ")}`,
    );
  }
  if (!PROVIDER_TYPES.includes(providerType)) {
    throw new Error(`providerType must be one of ${PROVIDER_TYPES.join(", ")}`);
  }
  _validateConfigShape(protocol, config);

  const id = _id("sso");
  const now = _now();
  db.prepare(
    `
    INSERT INTO sso_configurations (id, name, protocol, provider_type, config, enabled, metadata, test_status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    id,
    name,
    protocol,
    providerType,
    JSON.stringify(config),
    enabled ? 1 : 0,
    JSON.stringify(metadata),
    TEST_STATUS.UNTESTED,
    now,
    now,
  );
  return getConfiguration(db, id);
}

function _validateConfigShape(protocol, config) {
  if (!config || typeof config !== "object")
    throw new Error("config must be an object");
  if (protocol === SSO_PROTOCOLS.SAML) {
    const required = [
      "entityId",
      "assertionConsumerServiceUrl",
      "idpMetadataUrl",
    ];
    for (const k of required) {
      if (!config[k] || typeof config[k] !== "string") {
        throw new Error(`SAML config missing ${k}`);
      }
    }
  } else {
    const required = [
      "clientId",
      "authorizationUrl",
      "tokenUrl",
      "redirectUri",
    ];
    for (const k of required) {
      if (!config[k] || typeof config[k] !== "string") {
        throw new Error(`${protocol} config missing ${k}`);
      }
    }
  }
}

export function getConfiguration(db, configId) {
  const row = db
    .prepare(`SELECT * FROM sso_configurations WHERE id = ?`)
    .get(configId);
  return _mapConfigRow(row);
}

export function listConfigurations(db, filter = {}) {
  const rows = db
    .prepare(`SELECT * FROM sso_configurations ORDER BY created_at DESC`)
    .all();
  let out = rows.map(_mapConfigRow);
  if (filter.protocol) out = out.filter((c) => c.protocol === filter.protocol);
  if (filter.providerType)
    out = out.filter((c) => c.providerType === filter.providerType);
  if (filter.enabled !== undefined)
    out = out.filter((c) => c.enabled === !!filter.enabled);
  if (Number.isInteger(filter.limit) && filter.limit > 0)
    out = out.slice(0, filter.limit);
  return out;
}

export function updateConfiguration(db, configId, updates = {}) {
  const current = getConfiguration(db, configId);
  if (!current) throw new Error(`Configuration not found: ${configId}`);

  const next = {
    name: updates.name ?? current.name,
    protocol: updates.protocol ?? current.protocol,
    providerType: updates.providerType ?? current.providerType,
    config: updates.config ?? current.config,
    enabled:
      updates.enabled === undefined ? current.enabled : !!updates.enabled,
    metadata: updates.metadata ?? current.metadata,
  };
  if (!SUPPORTED_PROTOCOLS.has(next.protocol))
    throw new Error(`Invalid protocol`);
  if (!PROVIDER_TYPES.includes(next.providerType))
    throw new Error(`Invalid providerType`);
  _validateConfigShape(next.protocol, next.config);

  db.prepare(
    `
    UPDATE sso_configurations
    SET name = ?, protocol = ?, provider_type = ?, config = ?, enabled = ?, metadata = ?, updated_at = ?
    WHERE id = ?
  `,
  ).run(
    next.name,
    next.protocol,
    next.providerType,
    JSON.stringify(next.config),
    next.enabled ? 1 : 0,
    JSON.stringify(next.metadata),
    _now(),
    configId,
  );
  return getConfiguration(db, configId);
}

export function deleteConfiguration(db, configId) {
  const existed = !!getConfiguration(db, configId);
  db.prepare(`DELETE FROM sso_configurations WHERE id = ?`).run(configId);
  db.prepare(`DELETE FROM sso_sessions WHERE config_id = ?`).run(configId);
  return { deleted: existed };
}

export function recordTestResult(db, configId, success, error = null) {
  const current = getConfiguration(db, configId);
  if (!current) throw new Error(`Configuration not found: ${configId}`);
  db.prepare(
    `
    UPDATE sso_configurations
    SET last_tested = ?, test_status = ?, test_error = ?, updated_at = ?
    WHERE id = ?
  `,
  ).run(
    _now(),
    success ? TEST_STATUS.SUCCESS : TEST_STATUS.FAILED,
    error,
    _now(),
    configId,
  );
  return getConfiguration(db, configId);
}

/* ── PKCE helpers ──────────────────────────────────────────── */

export function generatePKCE() {
  const codeVerifier = crypto.randomBytes(32).toString("base64url");
  const codeChallenge = crypto
    .createHash("sha256")
    .update(codeVerifier)
    .digest("base64url");
  return { codeVerifier, codeChallenge, codeChallengeMethod: "S256" };
}

/* ── Authorization URL / AuthnRequest builders ─────────────── */

export function buildAuthorizationUrl(config, pkce, opts = {}) {
  if (!config || !config.authorizationUrl)
    throw new Error("config.authorizationUrl required");
  if (!config.clientId) throw new Error("config.clientId required");
  if (!config.redirectUri) throw new Error("config.redirectUri required");
  if (!pkce || !pkce.codeChallenge)
    throw new Error("pkce.codeChallenge required");

  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: (config.scopes || ["openid", "profile", "email"]).join(" "),
    state: opts.state || crypto.randomBytes(16).toString("base64url"),
    code_challenge: pkce.codeChallenge,
    code_challenge_method: pkce.codeChallengeMethod || "S256",
  });
  if (opts.nonce) params.set("nonce", opts.nonce);
  if (opts.prompt) params.set("prompt", opts.prompt);
  const sep = config.authorizationUrl.includes("?") ? "&" : "?";
  return `${config.authorizationUrl}${sep}${params.toString()}`;
}

export function buildSamlAuthnRequest(config, opts = {}) {
  if (!config || !config.entityId || !config.assertionConsumerServiceUrl) {
    throw new Error(
      "SAML config missing entityId or assertionConsumerServiceUrl",
    );
  }
  const id = `_${crypto.randomBytes(16).toString("hex")}`;
  const issueInstant = new Date().toISOString();
  const nameIdFormat =
    config.nameIdFormat ||
    "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress";
  const relayState =
    opts.relayState || crypto.randomBytes(8).toString("base64url");
  const xml = [
    `<samlp:AuthnRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol"`,
    ` xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion"`,
    ` ID="${id}" Version="2.0" IssueInstant="${issueInstant}"`,
    ` AssertionConsumerServiceURL="${config.assertionConsumerServiceUrl}"`,
    ` ProtocolBinding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST">`,
    `<saml:Issuer>${config.entityId}</saml:Issuer>`,
    `<samlp:NameIDPolicy Format="${nameIdFormat}" AllowCreate="true"/>`,
    `</samlp:AuthnRequest>`,
  ].join("");
  return { id, issueInstant, relayState, xml };
}

/* ── Token encryption (AES-256-GCM) ────────────────────────── */

function _deriveKey(masterKey, salt) {
  return crypto.pbkdf2Sync(String(masterKey), salt, 100000, 32, "sha512");
}

export function encryptToken(token, masterKey) {
  if (token === null || token === undefined) return null;
  if (!masterKey) throw new Error("masterKey required for token encryption");
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = _deriveKey(masterKey, salt);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const plaintext = typeof token === "string" ? token : JSON.stringify(token);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    alg: "aes-256-gcm",
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    tag: authTag.toString("base64"),
    ct: enc.toString("base64"),
  };
}

export function decryptToken(envelope, masterKey) {
  if (!envelope) return null;
  if (!masterKey) throw new Error("masterKey required for token decryption");
  if (envelope.alg !== "aes-256-gcm")
    throw new Error(`Unsupported alg: ${envelope.alg}`);
  const salt = Buffer.from(envelope.salt, "base64");
  const iv = Buffer.from(envelope.iv, "base64");
  const tag = Buffer.from(envelope.tag, "base64");
  const ct = Buffer.from(envelope.ct, "base64");
  const key = _deriveKey(masterKey, salt);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(ct), decipher.final()]);
  const s = dec.toString("utf8");
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

/* ── Session lifecycle ────────────────────────────────────── */

export function createSession(db, input = {}) {
  const {
    configId,
    did = null,
    tokens = {},
    userInfo = {},
    masterKey = null,
    tokenExpiresAt = null,
  } = input;
  if (!configId) throw new Error("configId is required");
  const config = getConfiguration(db, configId);
  if (!config) throw new Error(`Configuration not found: ${configId}`);
  const id = _id("sess");
  const now = _now();
  const access = masterKey
    ? encryptToken(tokens.accessToken, masterKey)
    : tokens.accessToken || null;
  const refresh = masterKey
    ? encryptToken(tokens.refreshToken, masterKey)
    : tokens.refreshToken || null;
  const idtok = masterKey
    ? encryptToken(tokens.idToken, masterKey)
    : tokens.idToken || null;
  db.prepare(
    `
    INSERT INTO sso_sessions (id, config_id, did, access_token, refresh_token, id_token, token_expires_at, user_info, status, created_at, last_refreshed)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    id,
    configId,
    did,
    access === null ? null : JSON.stringify(access),
    refresh === null ? null : JSON.stringify(refresh),
    idtok === null ? null : JSON.stringify(idtok),
    tokenExpiresAt,
    JSON.stringify(userInfo),
    SESSION_STATUS.ACTIVE,
    now,
    null,
  );
  return getSession(db, id);
}

export function getSession(db, sessionId) {
  const row = db
    .prepare(`SELECT * FROM sso_sessions WHERE id = ?`)
    .get(sessionId);
  return _mapSessionRow(row);
}

export function listSessions(db, filter = {}) {
  const rows = db
    .prepare(`SELECT * FROM sso_sessions ORDER BY created_at DESC`)
    .all();
  let out = rows.map(_mapSessionRow);
  if (filter.configId) out = out.filter((s) => s.configId === filter.configId);
  if (filter.status) out = out.filter((s) => s.status === filter.status);
  if (filter.did) out = out.filter((s) => s.did === filter.did);
  if (Number.isInteger(filter.limit) && filter.limit > 0)
    out = out.slice(0, filter.limit);
  return out;
}

export function listActiveSessions(db, filter = {}) {
  return listSessions(db, { ...filter, status: SESSION_STATUS.ACTIVE });
}

export function refreshSessionTokens(db, sessionId, tokens = {}, opts = {}) {
  const current = getSession(db, sessionId);
  if (!current) throw new Error(`Session not found: ${sessionId}`);
  const { masterKey = null, tokenExpiresAt = null } = opts;
  const access = masterKey
    ? encryptToken(tokens.accessToken, masterKey)
    : tokens.accessToken || null;
  const refresh =
    tokens.refreshToken === undefined
      ? null
      : masterKey
        ? encryptToken(tokens.refreshToken, masterKey)
        : tokens.refreshToken;
  const idtok =
    tokens.idToken === undefined
      ? null
      : masterKey
        ? encryptToken(tokens.idToken, masterKey)
        : tokens.idToken;
  const now = _now();

  const accessJson = access === null ? null : JSON.stringify(access);
  const refreshJson =
    refresh === null
      ? tokens.refreshToken === undefined
        ? null
        : null
      : JSON.stringify(refresh);
  const idJson =
    idtok === null
      ? tokens.idToken === undefined
        ? null
        : null
      : JSON.stringify(idtok);

  if (tokens.refreshToken === undefined && tokens.idToken === undefined) {
    db.prepare(
      `
      UPDATE sso_sessions
      SET access_token = ?, token_expires_at = ?, last_refreshed = ?, status = ?
      WHERE id = ?
    `,
    ).run(accessJson, tokenExpiresAt, now, SESSION_STATUS.ACTIVE, sessionId);
  } else {
    db.prepare(
      `
      UPDATE sso_sessions
      SET access_token = ?, refresh_token = ?, id_token = ?, token_expires_at = ?, last_refreshed = ?, status = ?
      WHERE id = ?
    `,
    ).run(
      accessJson,
      refreshJson,
      idJson,
      tokenExpiresAt,
      now,
      SESSION_STATUS.ACTIVE,
      sessionId,
    );
  }
  return getSession(db, sessionId);
}

export function destroySession(db, sessionId) {
  const current = getSession(db, sessionId);
  if (!current) return { deleted: false };
  db.prepare(`UPDATE sso_sessions SET status = ? WHERE id = ?`).run(
    SESSION_STATUS.REVOKED,
    sessionId,
  );
  return { deleted: true };
}

export function expireSession(db, sessionId) {
  db.prepare(`UPDATE sso_sessions SET status = ? WHERE id = ?`).run(
    SESSION_STATUS.EXPIRED,
    sessionId,
  );
  return getSession(db, sessionId);
}

export function isSessionValid(db, sessionId, now = _now()) {
  const s = getSession(db, sessionId);
  if (!s) return false;
  if (s.status !== SESSION_STATUS.ACTIVE) return false;
  if (s.tokenExpiresAt && s.tokenExpiresAt < now) return false;
  return true;
}

/* ── Identity bridge (DID ↔ SSO) ───────────────────────────── */

export function linkIdentity(db, input = {}) {
  const {
    did,
    ssoProvider,
    ssoUserId,
    ssoEmail = null,
    ssoDisplayName = null,
    attributes = {},
  } = input;
  if (!did || !ssoProvider || !ssoUserId) {
    throw new Error("did, ssoProvider, ssoUserId are required");
  }
  const existing = db
    .prepare(
      `SELECT * FROM sso_identity_mappings WHERE sso_provider = ? AND sso_user_id = ?`,
    )
    .get(ssoProvider, ssoUserId);
  if (existing && existing.did !== did) {
    throw new Error(`SSO identity already linked to DID ${existing.did}`);
  }
  if (existing) {
    db.prepare(
      `
      UPDATE sso_identity_mappings
      SET sso_email = ?, sso_display_name = ?, attributes = ?, last_login = ?
      WHERE id = ?
    `,
    ).run(
      ssoEmail,
      ssoDisplayName,
      JSON.stringify(attributes),
      _now(),
      existing.id,
    );
    return _mapMappingRow(
      db
        .prepare(`SELECT * FROM sso_identity_mappings WHERE id = ?`)
        .get(existing.id),
    );
  }
  const id = _id("idmap");
  db.prepare(
    `
    INSERT INTO sso_identity_mappings (id, did, sso_provider, sso_user_id, sso_email, sso_display_name, attributes, linked_at, last_login)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    id,
    did,
    ssoProvider,
    ssoUserId,
    ssoEmail,
    ssoDisplayName,
    JSON.stringify(attributes),
    _now(),
    _now(),
  );
  return _mapMappingRow(
    db.prepare(`SELECT * FROM sso_identity_mappings WHERE id = ?`).get(id),
  );
}

export function unlinkIdentity(db, did, ssoProvider) {
  if (!did || !ssoProvider) throw new Error("did and ssoProvider are required");
  const rows = db
    .prepare(
      `SELECT id FROM sso_identity_mappings WHERE did = ? AND sso_provider = ?`,
    )
    .all(did, ssoProvider);
  if (rows.length === 0) return { unlinked: false };
  db.prepare(
    `DELETE FROM sso_identity_mappings WHERE did = ? AND sso_provider = ?`,
  ).run(did, ssoProvider);
  return { unlinked: true, count: rows.length };
}

export function getSSOIdentities(db, did) {
  if (!did) return [];
  const rows = db
    .prepare(
      `SELECT * FROM sso_identity_mappings WHERE did = ? ORDER BY linked_at DESC`,
    )
    .all(did);
  return rows.map(_mapMappingRow);
}

export function getDIDForSSO(db, ssoProvider, ssoUserId) {
  if (!ssoProvider || !ssoUserId) return null;
  const row = db
    .prepare(
      `SELECT * FROM sso_identity_mappings WHERE sso_provider = ? AND sso_user_id = ?`,
    )
    .get(ssoProvider, ssoUserId);
  return row ? _mapMappingRow(row) : null;
}

export function listIdentityMappings(db, filter = {}) {
  const rows = db
    .prepare(`SELECT * FROM sso_identity_mappings ORDER BY linked_at DESC`)
    .all();
  let out = rows.map(_mapMappingRow);
  if (filter.ssoProvider)
    out = out.filter((m) => m.ssoProvider === filter.ssoProvider);
  if (filter.did) out = out.filter((m) => m.did === filter.did);
  if (Number.isInteger(filter.limit) && filter.limit > 0)
    out = out.slice(0, filter.limit);
  return out;
}

export function checkIdentityConflict(db, ssoProvider, ssoUserId) {
  const existing = getDIDForSSO(db, ssoProvider, ssoUserId);
  return existing
    ? { conflict: true, did: existing.did, mapping: existing }
    : { conflict: false };
}

/* ── Stats ─────────────────────────────────────────────────── */

export function getStats(db) {
  const configs = listConfigurations(db);
  const sessions = listSessions(db);
  const mappings = listIdentityMappings(db);

  const byProtocol = {};
  const byProviderType = {};
  for (const c of configs) {
    byProtocol[c.protocol] = (byProtocol[c.protocol] || 0) + 1;
    byProviderType[c.providerType] = (byProviderType[c.providerType] || 0) + 1;
  }

  const sessionStatus = { active: 0, expired: 0, revoked: 0 };
  for (const s of sessions) {
    if (sessionStatus[s.status] !== undefined) sessionStatus[s.status]++;
  }

  const mappingsByProvider = {};
  const didsWithSSO = new Set();
  for (const m of mappings) {
    mappingsByProvider[m.ssoProvider] =
      (mappingsByProvider[m.ssoProvider] || 0) + 1;
    didsWithSSO.add(m.did);
  }

  return {
    configurations: {
      total: configs.length,
      enabled: configs.filter((c) => c.enabled).length,
      disabled: configs.filter((c) => !c.enabled).length,
      byProtocol,
      byProviderType,
    },
    sessions: {
      total: sessions.length,
      ...sessionStatus,
    },
    identities: {
      totalMappings: mappings.length,
      uniqueDIDs: didsWithSSO.size,
      byProvider: mappingsByProvider,
    },
  };
}

// ===== V2 Surface (cli 0.130.0) — in-memory governance =====
export const PROVIDER_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  DEPRECATED: "deprecated",
  RETIRED: "retired",
});
export const LOGIN_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  AUTHENTICATING: "authenticating",
  AUTHENTICATED: "authenticated",
  FAILED: "failed",
  CANCELLED: "cancelled",
});

const _PM_V2 = PROVIDER_MATURITY_V2;
const _LL_V2 = LOGIN_LIFECYCLE_V2;
const _PM_TRANS_V2 = new Map([
  [_PM_V2.PENDING, new Set([_PM_V2.ACTIVE, _PM_V2.RETIRED])],
  [_PM_V2.ACTIVE, new Set([_PM_V2.DEPRECATED, _PM_V2.RETIRED])],
  [_PM_V2.DEPRECATED, new Set([_PM_V2.ACTIVE, _PM_V2.RETIRED])],
  [_PM_V2.RETIRED, new Set()],
]);
const _LL_TRANS_V2 = new Map([
  [_LL_V2.QUEUED, new Set([_LL_V2.AUTHENTICATING, _LL_V2.CANCELLED])],
  [
    _LL_V2.AUTHENTICATING,
    new Set([_LL_V2.AUTHENTICATED, _LL_V2.FAILED, _LL_V2.CANCELLED]),
  ],
  [_LL_V2.AUTHENTICATED, new Set()],
  [_LL_V2.FAILED, new Set()],
  [_LL_V2.CANCELLED, new Set()],
]);
const _LL_TERM_V2 = new Set([
  _LL_V2.AUTHENTICATED,
  _LL_V2.FAILED,
  _LL_V2.CANCELLED,
]);

const SSO_DEFAULT_MAX_ACTIVE_PROVIDERS_PER_OWNER = 8;
const SSO_DEFAULT_MAX_PENDING_LOGINS_PER_PROVIDER = 16;
const SSO_DEFAULT_PROVIDER_IDLE_MS = 30 * 24 * 60 * 60 * 1000;
const SSO_DEFAULT_LOGIN_STUCK_MS = 5 * 60 * 1000;

const _ssoProvidersV2 = new Map();
const _ssoLoginsV2 = new Map();
let _ssoConfigV2 = {
  maxActiveProvidersPerOwner: SSO_DEFAULT_MAX_ACTIVE_PROVIDERS_PER_OWNER,
  maxPendingLoginsPerProvider: SSO_DEFAULT_MAX_PENDING_LOGINS_PER_PROVIDER,
  providerIdleMs: SSO_DEFAULT_PROVIDER_IDLE_MS,
  loginStuckMs: SSO_DEFAULT_LOGIN_STUCK_MS,
};

function _ssoPosIntV2(n, label) {
  if (typeof n !== "number" || !isFinite(n) || isNaN(n))
    throw new Error(`${label} must be positive integer`);
  const v = Math.floor(n);
  if (v <= 0) throw new Error(`${label} must be positive integer`);
  return v;
}

export function _resetStateSsoManagerV2() {
  _ssoProvidersV2.clear();
  _ssoLoginsV2.clear();
  _ssoConfigV2 = {
    maxActiveProvidersPerOwner: SSO_DEFAULT_MAX_ACTIVE_PROVIDERS_PER_OWNER,
    maxPendingLoginsPerProvider: SSO_DEFAULT_MAX_PENDING_LOGINS_PER_PROVIDER,
    providerIdleMs: SSO_DEFAULT_PROVIDER_IDLE_MS,
    loginStuckMs: SSO_DEFAULT_LOGIN_STUCK_MS,
  };
}

export function setMaxActiveProvidersPerOwnerV2(n) {
  _ssoConfigV2.maxActiveProvidersPerOwner = _ssoPosIntV2(
    n,
    "maxActiveProvidersPerOwner",
  );
}
export function setMaxPendingLoginsPerProviderV2(n) {
  _ssoConfigV2.maxPendingLoginsPerProvider = _ssoPosIntV2(
    n,
    "maxPendingLoginsPerProvider",
  );
}
export function setProviderIdleMsV2(n) {
  _ssoConfigV2.providerIdleMs = _ssoPosIntV2(n, "providerIdleMs");
}
export function setLoginStuckMsV2(n) {
  _ssoConfigV2.loginStuckMs = _ssoPosIntV2(n, "loginStuckMs");
}
export function getMaxActiveProvidersPerOwnerV2() {
  return _ssoConfigV2.maxActiveProvidersPerOwner;
}
export function getMaxPendingLoginsPerProviderV2() {
  return _ssoConfigV2.maxPendingLoginsPerProvider;
}
export function getProviderIdleMsV2() {
  return _ssoConfigV2.providerIdleMs;
}
export function getLoginStuckMsV2() {
  return _ssoConfigV2.loginStuckMs;
}

function _copyProviderV2(p) {
  return { ...p, metadata: { ...(p.metadata || {}) } };
}
function _copyLoginV2(l) {
  return { ...l, metadata: { ...(l.metadata || {}) } };
}

export function registerProviderV2({
  id,
  owner,
  protocol,
  displayName,
  metadata,
} = {}) {
  if (!id || typeof id !== "string") throw new Error("id required");
  if (!owner || typeof owner !== "string") throw new Error("owner required");
  if (!protocol || typeof protocol !== "string")
    throw new Error("protocol required");
  if (_ssoProvidersV2.has(id))
    throw new Error(`provider ${id} already registered`);
  const now = Date.now();
  const p = {
    id,
    owner,
    protocol,
    displayName: displayName || id,
    status: _PM_V2.PENDING,
    activatedAt: null,
    retiredAt: null,
    lastSeenAt: now,
    createdAt: now,
    metadata: metadata && typeof metadata === "object" ? { ...metadata } : {},
  };
  _ssoProvidersV2.set(id, p);
  return _copyProviderV2(p);
}

function _activeProviderCountForOwnerV2(owner) {
  let c = 0;
  for (const p of _ssoProvidersV2.values())
    if (p.owner === owner && p.status === _PM_V2.ACTIVE) c++;
  return c;
}

function _transitionProviderV2(id, next) {
  const p = _ssoProvidersV2.get(id);
  if (!p) throw new Error(`provider ${id} not found`);
  const allowed = _PM_TRANS_V2.get(p.status);
  if (!allowed || !allowed.has(next))
    throw new Error(`invalid transition ${p.status} -> ${next}`);
  if (next === _PM_V2.ACTIVE && p.status === _PM_V2.PENDING) {
    if (
      _activeProviderCountForOwnerV2(p.owner) >=
      _ssoConfigV2.maxActiveProvidersPerOwner
    ) {
      throw new Error(
        `owner ${p.owner} active-provider cap reached (${_ssoConfigV2.maxActiveProvidersPerOwner})`,
      );
    }
  }
  const now = Date.now();
  p.status = next;
  if (next === _PM_V2.ACTIVE && !p.activatedAt) p.activatedAt = now;
  if (next === _PM_V2.RETIRED && !p.retiredAt) p.retiredAt = now;
  p.lastSeenAt = now;
  return _copyProviderV2(p);
}

export function activateProviderV2(id) {
  return _transitionProviderV2(id, _PM_V2.ACTIVE);
}
export function deprecateProviderV2(id) {
  return _transitionProviderV2(id, _PM_V2.DEPRECATED);
}
export function retireProviderV2(id) {
  return _transitionProviderV2(id, _PM_V2.RETIRED);
}
export function touchProviderV2(id) {
  const p = _ssoProvidersV2.get(id);
  if (!p) throw new Error(`provider ${id} not found`);
  p.lastSeenAt = Date.now();
  return _copyProviderV2(p);
}
export function getProviderV2(id) {
  const p = _ssoProvidersV2.get(id);
  return p ? _copyProviderV2(p) : null;
}
export function listProvidersV2({ owner, status, protocol } = {}) {
  const out = [];
  for (const p of _ssoProvidersV2.values()) {
    if (owner && p.owner !== owner) continue;
    if (status && p.status !== status) continue;
    if (protocol && p.protocol !== protocol) continue;
    out.push(_copyProviderV2(p));
  }
  return out;
}

function _pendingLoginCountForProviderV2(providerId) {
  let c = 0;
  for (const l of _ssoLoginsV2.values()) {
    if (l.providerId !== providerId) continue;
    if (l.status === _LL_V2.QUEUED || l.status === _LL_V2.AUTHENTICATING) c++;
  }
  return c;
}

export function createLoginV2({ id, providerId, subject, metadata } = {}) {
  if (!id || typeof id !== "string") throw new Error("id required");
  if (!providerId || typeof providerId !== "string")
    throw new Error("providerId required");
  if (_ssoLoginsV2.has(id)) throw new Error(`login ${id} already exists`);
  const provider = _ssoProvidersV2.get(providerId);
  if (!provider) throw new Error(`provider ${providerId} not found`);
  if (provider.status === _PM_V2.RETIRED)
    throw new Error(`provider ${providerId} retired`);
  if (
    _pendingLoginCountForProviderV2(providerId) >=
    _ssoConfigV2.maxPendingLoginsPerProvider
  ) {
    throw new Error(
      `provider ${providerId} pending-login cap reached (${_ssoConfigV2.maxPendingLoginsPerProvider})`,
    );
  }
  const now = Date.now();
  const l = {
    id,
    providerId,
    subject: subject || "anonymous",
    status: _LL_V2.QUEUED,
    startedAt: null,
    settledAt: null,
    createdAt: now,
    metadata: metadata && typeof metadata === "object" ? { ...metadata } : {},
  };
  _ssoLoginsV2.set(id, l);
  return _copyLoginV2(l);
}

function _transitionLoginV2(id, next, extra = {}) {
  const l = _ssoLoginsV2.get(id);
  if (!l) throw new Error(`login ${id} not found`);
  const allowed = _LL_TRANS_V2.get(l.status);
  if (!allowed || !allowed.has(next))
    throw new Error(`invalid transition ${l.status} -> ${next}`);
  const now = Date.now();
  l.status = next;
  if (next === _LL_V2.AUTHENTICATING && !l.startedAt) l.startedAt = now;
  if (_LL_TERM_V2.has(next) && !l.settledAt) l.settledAt = now;
  if (extra.error) l.metadata.error = extra.error;
  return _copyLoginV2(l);
}

export function startLoginV2(id) {
  return _transitionLoginV2(id, _LL_V2.AUTHENTICATING);
}
export function completeLoginV2(id) {
  return _transitionLoginV2(id, _LL_V2.AUTHENTICATED);
}
export function failLoginV2(id, error) {
  return _transitionLoginV2(id, _LL_V2.FAILED, { error });
}
export function cancelLoginV2(id) {
  return _transitionLoginV2(id, _LL_V2.CANCELLED);
}

export function getLoginV2(id) {
  const l = _ssoLoginsV2.get(id);
  return l ? _copyLoginV2(l) : null;
}
export function listLoginsV2({ providerId, status, subject } = {}) {
  const out = [];
  for (const l of _ssoLoginsV2.values()) {
    if (providerId && l.providerId !== providerId) continue;
    if (status && l.status !== status) continue;
    if (subject && l.subject !== subject) continue;
    out.push(_copyLoginV2(l));
  }
  return out;
}

export function autoDeprecateIdleProvidersV2({ now } = {}) {
  const t = typeof now === "number" ? now : Date.now();
  const flipped = [];
  for (const p of _ssoProvidersV2.values()) {
    if (p.status !== _PM_V2.ACTIVE) continue;
    if (t - p.lastSeenAt > _ssoConfigV2.providerIdleMs) {
      p.status = _PM_V2.DEPRECATED;
      p.lastSeenAt = t;
      flipped.push(_copyProviderV2(p));
    }
  }
  return flipped;
}

export function autoFailStuckLoginsV2({ now } = {}) {
  const t = typeof now === "number" ? now : Date.now();
  const flipped = [];
  for (const l of _ssoLoginsV2.values()) {
    if (l.status !== _LL_V2.AUTHENTICATING) continue;
    if (l.startedAt && t - l.startedAt > _ssoConfigV2.loginStuckMs) {
      l.status = _LL_V2.FAILED;
      l.settledAt = t;
      l.metadata.error = "stuck-timeout";
      flipped.push(_copyLoginV2(l));
    }
  }
  return flipped;
}

export function getSsoManagerStatsV2() {
  const providersByStatus = {};
  for (const s of Object.values(_PM_V2)) providersByStatus[s] = 0;
  for (const p of _ssoProvidersV2.values()) providersByStatus[p.status]++;
  const loginsByStatus = {};
  for (const s of Object.values(_LL_V2)) loginsByStatus[s] = 0;
  for (const l of _ssoLoginsV2.values()) loginsByStatus[l.status]++;
  return {
    totalProvidersV2: _ssoProvidersV2.size,
    totalLoginsV2: _ssoLoginsV2.size,
    maxActiveProvidersPerOwner: _ssoConfigV2.maxActiveProvidersPerOwner,
    maxPendingLoginsPerProvider: _ssoConfigV2.maxPendingLoginsPerProvider,
    providerIdleMs: _ssoConfigV2.providerIdleMs,
    loginStuckMs: _ssoConfigV2.loginStuckMs,
    providersByStatus,
    loginsByStatus,
  };
}
