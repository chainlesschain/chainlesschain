import { describe, it, expect, beforeEach } from "vitest";
import { MockDatabase } from "../helpers/mock-db.js";
import {
  SSO_PROTOCOLS,
  PROVIDER_TYPES,
  SESSION_STATUS,
  TEST_STATUS,
  listProviderTemplates,
  getProviderTemplate,
  ensureSSOTables,
  createConfiguration,
  getConfiguration,
  listConfigurations,
  updateConfiguration,
  deleteConfiguration,
  recordTestResult,
  generatePKCE,
  buildAuthorizationUrl,
  buildSamlAuthnRequest,
  encryptToken,
  decryptToken,
  createSession,
  getSession,
  listSessions,
  listActiveSessions,
  refreshSessionTokens,
  destroySession,
  expireSession,
  isSessionValid,
  linkIdentity,
  unlinkIdentity,
  getSSOIdentities,
  getDIDForSSO,
  listIdentityMappings,
  checkIdentityConflict,
  getStats,
} from "../../src/lib/sso-manager.js";

const oidcConfig = {
  clientId: "test-client",
  clientSecret: "secret",
  authorizationUrl: "https://idp.example.com/authorize",
  tokenUrl: "https://idp.example.com/token",
  userInfoUrl: "https://idp.example.com/userinfo",
  redirectUri: "https://app.example.com/callback",
  scopes: ["openid", "profile", "email"],
};

const samlConfig = {
  entityId: "https://app.example.com/metadata",
  assertionConsumerServiceUrl: "https://app.example.com/acs",
  idpMetadataUrl: "https://idp.example.com/metadata",
};

describe("sso-manager (Phase 14)", () => {
  let db;

  beforeEach(() => {
    db = new MockDatabase();
    ensureSSOTables(db);
  });

  // ─── Constants & templates ──────────────────────────────────

  describe("constants & templates", () => {
    it("exposes 3 protocols", () => {
      expect(Object.values(SSO_PROTOCOLS).sort()).toEqual([
        "oauth2",
        "oidc",
        "saml",
      ]);
    });

    it("exposes 5 provider types", () => {
      expect(PROVIDER_TYPES).toContain("azure_ad");
      expect(PROVIDER_TYPES).toContain("okta");
      expect(PROVIDER_TYPES).toContain("google");
      expect(PROVIDER_TYPES).toContain("onelogin");
      expect(PROVIDER_TYPES).toContain("custom");
    });

    it("exposes 3 session statuses", () => {
      expect(Object.values(SESSION_STATUS).sort()).toEqual([
        "active",
        "expired",
        "revoked",
      ]);
    });

    it("exposes 3 test statuses", () => {
      expect(Object.values(TEST_STATUS).sort()).toEqual([
        "failed",
        "success",
        "untested",
      ]);
    });

    it("lists 5 provider templates", () => {
      const list = listProviderTemplates();
      expect(list.length).toBe(5);
      const ids = list.map((t) => t.id);
      expect(ids).toContain("azure_ad_oidc");
      expect(ids).toContain("okta_oidc");
      expect(ids).toContain("google_oidc");
      expect(ids).toContain("okta_saml");
      expect(ids).toContain("custom_oauth2");
    });

    it("retrieves a template by id", () => {
      const t = getProviderTemplate("okta_oidc");
      expect(t.name).toBe("Okta (OIDC)");
      expect(t.protocol).toBe("oidc");
      expect(t.hints.scopes).toContain("openid");
    });

    it("returns null for unknown template", () => {
      expect(getProviderTemplate("unknown")).toBe(null);
    });

    it("returns fresh objects (not frozen references)", () => {
      const t = getProviderTemplate("okta_oidc");
      t.name = "mutated";
      const t2 = getProviderTemplate("okta_oidc");
      expect(t2.name).toBe("Okta (OIDC)");
    });
  });

  // ─── Configuration CRUD ─────────────────────────────────────

  describe("configuration CRUD", () => {
    it("creates an OIDC configuration", () => {
      const c = createConfiguration(db, {
        name: "Okta prod",
        protocol: "oidc",
        providerType: "okta",
        config: oidcConfig,
      });
      expect(c.id).toMatch(/^sso_/);
      expect(c.name).toBe("Okta prod");
      expect(c.protocol).toBe("oidc");
      expect(c.providerType).toBe("okta");
      expect(c.enabled).toBe(true);
      expect(c.testStatus).toBe("untested");
    });

    it("creates a SAML configuration", () => {
      const c = createConfiguration(db, {
        name: "Okta SAML",
        protocol: "saml",
        providerType: "okta",
        config: samlConfig,
      });
      expect(c.protocol).toBe("saml");
      expect(c.config.entityId).toBe(samlConfig.entityId);
    });

    it("rejects missing name", () => {
      expect(() =>
        createConfiguration(db, { protocol: "oidc", config: oidcConfig }),
      ).toThrow(/name is required/);
    });

    it("rejects invalid protocol", () => {
      expect(() =>
        createConfiguration(db, { name: "x", protocol: "ldap", config: {} }),
      ).toThrow(/protocol must be one of/);
    });

    it("rejects invalid providerType", () => {
      expect(() =>
        createConfiguration(db, {
          name: "x",
          protocol: "oidc",
          providerType: "aws_sso",
          config: oidcConfig,
        }),
      ).toThrow(/providerType must be one of/);
    });

    it("validates OIDC config shape", () => {
      expect(() =>
        createConfiguration(db, {
          name: "x",
          protocol: "oidc",
          config: { clientId: "c" },
        }),
      ).toThrow(/missing/);
    });

    it("validates SAML config shape", () => {
      expect(() =>
        createConfiguration(db, {
          name: "x",
          protocol: "saml",
          config: { entityId: "e" },
        }),
      ).toThrow(/SAML config missing/);
    });

    it("gets a configuration by id", () => {
      const c = createConfiguration(db, {
        name: "a",
        protocol: "oidc",
        config: oidcConfig,
      });
      const got = getConfiguration(db, c.id);
      expect(got.id).toBe(c.id);
      expect(got.name).toBe("a");
    });

    it("returns null for unknown configuration", () => {
      expect(getConfiguration(db, "sso_nope")).toBe(null);
    });

    it("lists configurations", () => {
      createConfiguration(db, {
        name: "a",
        protocol: "oidc",
        config: oidcConfig,
      });
      createConfiguration(db, {
        name: "b",
        protocol: "saml",
        providerType: "okta",
        config: samlConfig,
      });
      const list = listConfigurations(db);
      expect(list.length).toBe(2);
    });

    it("filters configurations by protocol", () => {
      createConfiguration(db, {
        name: "a",
        protocol: "oidc",
        config: oidcConfig,
      });
      createConfiguration(db, {
        name: "b",
        protocol: "saml",
        providerType: "okta",
        config: samlConfig,
      });
      const list = listConfigurations(db, { protocol: "oidc" });
      expect(list.length).toBe(1);
      expect(list[0].protocol).toBe("oidc");
    });

    it("filters configurations by enabled", () => {
      createConfiguration(db, {
        name: "a",
        protocol: "oidc",
        config: oidcConfig,
        enabled: true,
      });
      createConfiguration(db, {
        name: "b",
        protocol: "oidc",
        config: oidcConfig,
        enabled: false,
      });
      expect(listConfigurations(db, { enabled: true }).length).toBe(1);
      expect(listConfigurations(db, { enabled: false }).length).toBe(1);
    });

    it("updates a configuration", () => {
      const c = createConfiguration(db, {
        name: "a",
        protocol: "oidc",
        config: oidcConfig,
      });
      const next = updateConfiguration(db, c.id, {
        name: "a-renamed",
        enabled: false,
      });
      expect(next.name).toBe("a-renamed");
      expect(next.enabled).toBe(false);
    });

    it("rejects update on missing configuration", () => {
      expect(() => updateConfiguration(db, "nope", { name: "x" })).toThrow(
        /Configuration not found/,
      );
    });

    it("deletes a configuration", () => {
      const c = createConfiguration(db, {
        name: "a",
        protocol: "oidc",
        config: oidcConfig,
      });
      const r = deleteConfiguration(db, c.id);
      expect(r.deleted).toBe(true);
      expect(getConfiguration(db, c.id)).toBe(null);
    });

    it("delete returns deleted:false for unknown id", () => {
      expect(deleteConfiguration(db, "nope").deleted).toBe(false);
    });

    it("records test result success", () => {
      const c = createConfiguration(db, {
        name: "a",
        protocol: "oidc",
        config: oidcConfig,
      });
      const next = recordTestResult(db, c.id, true);
      expect(next.testStatus).toBe("success");
      expect(next.testError).toBe(null);
      expect(next.lastTested).toBeTruthy();
    });

    it("records test result failure with error", () => {
      const c = createConfiguration(db, {
        name: "a",
        protocol: "oidc",
        config: oidcConfig,
      });
      const next = recordTestResult(db, c.id, false, "401 Unauthorized");
      expect(next.testStatus).toBe("failed");
      expect(next.testError).toBe("401 Unauthorized");
    });
  });

  // ─── PKCE ───────────────────────────────────────────────────

  describe("PKCE helpers", () => {
    it("generates a PKCE pair", () => {
      const p = generatePKCE();
      expect(p.codeVerifier).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(p.codeChallenge).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(p.codeChallengeMethod).toBe("S256");
    });

    it("generates unique verifiers on each call", () => {
      const a = generatePKCE();
      const b = generatePKCE();
      expect(a.codeVerifier).not.toBe(b.codeVerifier);
    });
  });

  // ─── Authorization URL & SAML request ───────────────────────

  describe("authorization URL builder", () => {
    it("builds an OIDC authorization URL", () => {
      const pkce = generatePKCE();
      const url = buildAuthorizationUrl(oidcConfig, pkce);
      expect(url).toContain("https://idp.example.com/authorize");
      expect(url).toContain("response_type=code");
      expect(url).toContain("client_id=test-client");
      expect(url).toContain("code_challenge=");
      expect(url).toContain("code_challenge_method=S256");
      expect(url).toContain("scope=openid+profile+email");
    });

    it("accepts state and nonce", () => {
      const pkce = generatePKCE();
      const url = buildAuthorizationUrl(oidcConfig, pkce, {
        state: "abc123",
        nonce: "xyz",
      });
      expect(url).toContain("state=abc123");
      expect(url).toContain("nonce=xyz");
    });

    it("rejects missing config.authorizationUrl", () => {
      const pkce = generatePKCE();
      expect(() =>
        buildAuthorizationUrl({ clientId: "c", redirectUri: "r" }, pkce),
      ).toThrow(/authorizationUrl required/);
    });

    it("rejects missing pkce.codeChallenge", () => {
      expect(() => buildAuthorizationUrl(oidcConfig, {})).toThrow(
        /codeChallenge required/,
      );
    });

    it("preserves existing query string", () => {
      const cfg = {
        ...oidcConfig,
        authorizationUrl: oidcConfig.authorizationUrl + "?x=1",
      };
      const pkce = generatePKCE();
      const url = buildAuthorizationUrl(cfg, pkce);
      expect(url).toContain("?x=1&response_type=code");
    });
  });

  describe("SAML AuthnRequest builder", () => {
    it("builds a SAML AuthnRequest", () => {
      const req = buildSamlAuthnRequest(samlConfig);
      expect(req.id).toMatch(/^_[0-9a-f]+$/);
      expect(req.issueInstant).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(req.xml).toContain("<samlp:AuthnRequest");
      expect(req.xml).toContain(
        `AssertionConsumerServiceURL="${samlConfig.assertionConsumerServiceUrl}"`,
      );
      expect(req.xml).toContain(
        `<saml:Issuer>${samlConfig.entityId}</saml:Issuer>`,
      );
    });

    it("accepts custom relayState", () => {
      const req = buildSamlAuthnRequest(samlConfig, { relayState: "rs-abc" });
      expect(req.relayState).toBe("rs-abc");
    });

    it("rejects missing entityId", () => {
      expect(() =>
        buildSamlAuthnRequest({ assertionConsumerServiceUrl: "x" }),
      ).toThrow(/entityId/);
    });
  });

  // ─── Token encryption ───────────────────────────────────────

  describe("token encryption", () => {
    it("round-trips a string token", () => {
      const envelope = encryptToken("super-secret", "master-1");
      expect(envelope.alg).toBe("aes-256-gcm");
      const back = decryptToken(envelope, "master-1");
      expect(back).toBe("super-secret");
    });

    it("round-trips an object token", () => {
      const payload = { sub: "u1", email: "x@y.com" };
      const envelope = encryptToken(payload, "master-1");
      const back = decryptToken(envelope, "master-1");
      expect(back).toEqual(payload);
    });

    it("returns null for null token", () => {
      expect(encryptToken(null, "master-1")).toBe(null);
      expect(decryptToken(null, "master-1")).toBe(null);
    });

    it("rejects missing masterKey on encrypt", () => {
      expect(() => encryptToken("x", null)).toThrow(/masterKey required/);
    });

    it("fails decryption with wrong key", () => {
      const envelope = encryptToken("secret", "master-1");
      expect(() => decryptToken(envelope, "master-2")).toThrow();
    });

    it("rejects unsupported algorithm", () => {
      expect(() =>
        decryptToken(
          { alg: "rc4", salt: "x", iv: "x", tag: "x", ct: "x" },
          "m",
        ),
      ).toThrow(/Unsupported alg/);
    });
  });

  // ─── Sessions ───────────────────────────────────────────────

  describe("session lifecycle", () => {
    let cfgId;
    beforeEach(() => {
      const c = createConfiguration(db, {
        name: "a",
        protocol: "oidc",
        config: oidcConfig,
      });
      cfgId = c.id;
    });

    it("creates an active session", () => {
      const s = createSession(db, {
        configId: cfgId,
        did: "did:key:abc",
        tokens: { accessToken: "at-1", refreshToken: "rt-1", idToken: "id-1" },
        userInfo: { sub: "u1" },
        tokenExpiresAt: Date.now() + 60000,
      });
      expect(s.id).toMatch(/^sess_/);
      expect(s.configId).toBe(cfgId);
      expect(s.did).toBe("did:key:abc");
      expect(s.status).toBe("active");
      expect(s.accessToken).toBe("at-1");
      expect(s.userInfo.sub).toBe("u1");
    });

    it("encrypts tokens when masterKey is provided", () => {
      const s = createSession(db, {
        configId: cfgId,
        tokens: { accessToken: "secret-token" },
        masterKey: "k1",
      });
      expect(typeof s.accessToken).toBe("object");
      expect(s.accessToken.alg).toBe("aes-256-gcm");
      const plaintext = decryptToken(s.accessToken, "k1");
      expect(plaintext).toBe("secret-token");
    });

    it("rejects missing configId", () => {
      expect(() => createSession(db, { tokens: {} })).toThrow(/configId/);
    });

    it("rejects unknown configId", () => {
      expect(() =>
        createSession(db, { configId: "sso_nope", tokens: {} }),
      ).toThrow(/not found/);
    });

    it("gets a session by id", () => {
      const s = createSession(db, { configId: cfgId, tokens: {} });
      expect(getSession(db, s.id).id).toBe(s.id);
      expect(getSession(db, "nope")).toBe(null);
    });

    it("lists sessions", () => {
      createSession(db, { configId: cfgId, tokens: {} });
      createSession(db, { configId: cfgId, tokens: {} });
      expect(listSessions(db).length).toBe(2);
    });

    it("filters sessions by status", () => {
      const a = createSession(db, { configId: cfgId, tokens: {} });
      createSession(db, { configId: cfgId, tokens: {} });
      destroySession(db, a.id);
      expect(listActiveSessions(db).length).toBe(1);
    });

    it("filters sessions by did", () => {
      createSession(db, { configId: cfgId, did: "did:key:a", tokens: {} });
      createSession(db, { configId: cfgId, did: "did:key:b", tokens: {} });
      const list = listSessions(db, { did: "did:key:a" });
      expect(list.length).toBe(1);
    });

    it("refreshes session tokens (access only)", () => {
      const s = createSession(db, {
        configId: cfgId,
        tokens: { accessToken: "at-1", refreshToken: "rt-1" },
      });
      const next = refreshSessionTokens(
        db,
        s.id,
        { accessToken: "at-2" },
        { tokenExpiresAt: 9_999_999 },
      );
      expect(next.accessToken).toBe("at-2");
      expect(next.lastRefreshed).toBeTruthy();
      expect(next.tokenExpiresAt).toBe(9_999_999);
    });

    it("rejects refresh of missing session", () => {
      expect(() =>
        refreshSessionTokens(db, "nope", { accessToken: "x" }),
      ).toThrow(/not found/);
    });

    it("destroys (revokes) a session", () => {
      const s = createSession(db, { configId: cfgId, tokens: {} });
      expect(destroySession(db, s.id).deleted).toBe(true);
      expect(getSession(db, s.id).status).toBe("revoked");
    });

    it("destroy on unknown id returns deleted:false", () => {
      expect(destroySession(db, "nope").deleted).toBe(false);
    });

    it("expires a session", () => {
      const s = createSession(db, { configId: cfgId, tokens: {} });
      expireSession(db, s.id);
      expect(getSession(db, s.id).status).toBe("expired");
    });

    it("isSessionValid: true for active non-expired", () => {
      const s = createSession(db, {
        configId: cfgId,
        tokens: {},
        tokenExpiresAt: Date.now() + 60_000,
      });
      expect(isSessionValid(db, s.id)).toBe(true);
    });

    it("isSessionValid: false for revoked", () => {
      const s = createSession(db, { configId: cfgId, tokens: {} });
      destroySession(db, s.id);
      expect(isSessionValid(db, s.id)).toBe(false);
    });

    it("isSessionValid: false when tokenExpiresAt is in the past", () => {
      const s = createSession(db, {
        configId: cfgId,
        tokens: {},
        tokenExpiresAt: Date.now() - 60_000,
      });
      expect(isSessionValid(db, s.id)).toBe(false);
    });

    it("isSessionValid: true when tokenExpiresAt is null", () => {
      const s = createSession(db, { configId: cfgId, tokens: {} });
      expect(isSessionValid(db, s.id)).toBe(true);
    });

    it("isSessionValid: false for unknown session", () => {
      expect(isSessionValid(db, "nope")).toBe(false);
    });
  });

  // ─── Identity bridge ────────────────────────────────────────

  describe("identity bridge", () => {
    it("links a DID to an SSO identity", () => {
      const m = linkIdentity(db, {
        did: "did:key:a",
        ssoProvider: "okta",
        ssoUserId: "okta|123",
        ssoEmail: "x@y.com",
      });
      expect(m.id).toMatch(/^idmap_/);
      expect(m.did).toBe("did:key:a");
      expect(m.ssoProvider).toBe("okta");
      expect(m.ssoUserId).toBe("okta|123");
      expect(m.ssoEmail).toBe("x@y.com");
    });

    it("updates existing mapping on re-link with same DID", () => {
      linkIdentity(db, {
        did: "did:key:a",
        ssoProvider: "okta",
        ssoUserId: "okta|123",
        ssoEmail: "old@y.com",
      });
      const next = linkIdentity(db, {
        did: "did:key:a",
        ssoProvider: "okta",
        ssoUserId: "okta|123",
        ssoEmail: "new@y.com",
      });
      expect(next.ssoEmail).toBe("new@y.com");
      expect(listIdentityMappings(db).length).toBe(1);
    });

    it("rejects re-link under a different DID", () => {
      linkIdentity(db, {
        did: "did:key:a",
        ssoProvider: "okta",
        ssoUserId: "okta|123",
      });
      expect(() =>
        linkIdentity(db, {
          did: "did:key:b",
          ssoProvider: "okta",
          ssoUserId: "okta|123",
        }),
      ).toThrow(/already linked/);
    });

    it("rejects missing fields", () => {
      expect(() => linkIdentity(db, { did: "x" })).toThrow(/required/);
    });

    it("unlinks a DID ↔ provider pair", () => {
      linkIdentity(db, {
        did: "did:key:a",
        ssoProvider: "okta",
        ssoUserId: "okta|123",
      });
      const r = unlinkIdentity(db, "did:key:a", "okta");
      expect(r.unlinked).toBe(true);
      expect(r.count).toBe(1);
      expect(listIdentityMappings(db).length).toBe(0);
    });

    it("unlink returns unlinked:false when none found", () => {
      expect(unlinkIdentity(db, "did:key:a", "okta").unlinked).toBe(false);
    });

    it("getSSOIdentities returns all mappings for a DID", () => {
      linkIdentity(db, {
        did: "did:key:a",
        ssoProvider: "okta",
        ssoUserId: "okta|1",
      });
      linkIdentity(db, {
        did: "did:key:a",
        ssoProvider: "google",
        ssoUserId: "g|1",
      });
      const list = getSSOIdentities(db, "did:key:a");
      expect(list.length).toBe(2);
    });

    it("getSSOIdentities returns [] for missing DID", () => {
      expect(getSSOIdentities(db, "")).toEqual([]);
    });

    it("getDIDForSSO resolves by (provider, userId)", () => {
      linkIdentity(db, {
        did: "did:key:a",
        ssoProvider: "okta",
        ssoUserId: "u1",
      });
      const m = getDIDForSSO(db, "okta", "u1");
      expect(m.did).toBe("did:key:a");
      expect(getDIDForSSO(db, "okta", "u2")).toBe(null);
    });

    it("listIdentityMappings filters by provider", () => {
      linkIdentity(db, { did: "a", ssoProvider: "okta", ssoUserId: "1" });
      linkIdentity(db, { did: "b", ssoProvider: "google", ssoUserId: "2" });
      const list = listIdentityMappings(db, { ssoProvider: "okta" });
      expect(list.length).toBe(1);
    });

    it("checkIdentityConflict detects conflict", () => {
      linkIdentity(db, {
        did: "did:key:a",
        ssoProvider: "okta",
        ssoUserId: "u1",
      });
      const r = checkIdentityConflict(db, "okta", "u1");
      expect(r.conflict).toBe(true);
      expect(r.did).toBe("did:key:a");
    });

    it("checkIdentityConflict: no conflict for fresh identity", () => {
      expect(checkIdentityConflict(db, "okta", "u-new").conflict).toBe(false);
    });
  });

  // ─── Stats ──────────────────────────────────────────────────

  describe("stats", () => {
    it("returns zeroed stats for empty DB", () => {
      const s = getStats(db);
      expect(s.configurations.total).toBe(0);
      expect(s.sessions.total).toBe(0);
      expect(s.identities.totalMappings).toBe(0);
    });

    it("aggregates configurations by protocol and provider type", () => {
      createConfiguration(db, {
        name: "a",
        protocol: "oidc",
        providerType: "okta",
        config: oidcConfig,
      });
      createConfiguration(db, {
        name: "b",
        protocol: "saml",
        providerType: "okta",
        config: samlConfig,
      });
      createConfiguration(db, {
        name: "c",
        protocol: "oidc",
        providerType: "google",
        config: oidcConfig,
        enabled: false,
      });
      const s = getStats(db);
      expect(s.configurations.total).toBe(3);
      expect(s.configurations.enabled).toBe(2);
      expect(s.configurations.disabled).toBe(1);
      expect(s.configurations.byProtocol.oidc).toBe(2);
      expect(s.configurations.byProtocol.saml).toBe(1);
      expect(s.configurations.byProviderType.okta).toBe(2);
      expect(s.configurations.byProviderType.google).toBe(1);
    });

    it("aggregates sessions by status", () => {
      const c = createConfiguration(db, {
        name: "a",
        protocol: "oidc",
        config: oidcConfig,
      });
      const s1 = createSession(db, { configId: c.id, tokens: {} });
      const s2 = createSession(db, { configId: c.id, tokens: {} });
      createSession(db, { configId: c.id, tokens: {} });
      destroySession(db, s1.id);
      expireSession(db, s2.id);
      const stats = getStats(db);
      expect(stats.sessions.total).toBe(3);
      expect(stats.sessions.active).toBe(1);
      expect(stats.sessions.revoked).toBe(1);
      expect(stats.sessions.expired).toBe(1);
    });

    it("aggregates identity mappings by provider and counts unique DIDs", () => {
      linkIdentity(db, {
        did: "did:key:a",
        ssoProvider: "okta",
        ssoUserId: "u1",
      });
      linkIdentity(db, {
        did: "did:key:a",
        ssoProvider: "google",
        ssoUserId: "u1",
      });
      linkIdentity(db, {
        did: "did:key:b",
        ssoProvider: "okta",
        ssoUserId: "u2",
      });
      const stats = getStats(db);
      expect(stats.identities.totalMappings).toBe(3);
      expect(stats.identities.uniqueDIDs).toBe(2);
      expect(stats.identities.byProvider.okta).toBe(2);
      expect(stats.identities.byProvider.google).toBe(1);
    });
  });
});
