/**
 * Auth fail-closed hardening (security audit 2026-06-08).
 *
 * - SAMLProvider._verifySignature: a missing / unverifiable / invalid signature
 *   is REJECTED when signing is required (was warn-only fail-open). Kill-switch
 *   CHAINLESSCHAIN_SSO_ALLOW_UNVERIFIED=1 reverts to warn-only.
 * - SSOManager._enforceIdTokenClaims: claims from an id_token that failed basic
 *   validation are rejected (throws) so they never enter a session; the internal
 *   _validation metadata is stripped from trusted claims.
 *
 * Both are pure methods invoked via prototype.call — no provider construction,
 * network, or electron needed. NOTE: xml-crypto is intentionally NOT installed,
 * so the SAML "cannot verify" path is exercised for real.
 */

const { SAMLProvider } = require("../saml-provider");
const { SSOManager } = require("../sso-manager");

const ENV = "CHAINLESSCHAIN_SSO_ALLOW_UNVERIFIED";

function withEnv(value, fn) {
  const prev = process.env[ENV];
  if (value === undefined) {
    delete process.env[ENV];
  } else {
    process.env[ENV] = value;
  }
  try {
    return fn();
  } finally {
    if (prev === undefined) {
      delete process.env[ENV];
    } else {
      process.env[ENV] = prev;
    }
  }
}

const verify = (ctx, xml) =>
  SAMLProvider.prototype._verifySignature.call(ctx, xml, {});

describe("SAMLProvider._verifySignature — fail-closed", () => {
  it("throws when signing is required but the assertion is unsigned", () => {
    withEnv(undefined, () => {
      expect(() =>
        verify({ wantAssertionsSigned: true }, "<saml:Response/>"),
      ).toThrow(/fail-closed/);
    });
  });

  it("throws when signing is required but xml-crypto cannot verify (not installed)", () => {
    withEnv(undefined, () => {
      // signature present, but xml-crypto is absent → cannot verify → reject.
      expect(() =>
        verify(
          { wantResponseSigned: true, certificate: "CERT" },
          "<saml:Response><ds:Signature>x</ds:Signature></saml:Response>",
        ),
      ).toThrow(/fail-closed/);
    });
  });

  it("does NOT throw in explicit unsigned mode (signing not required)", () => {
    withEnv(undefined, () => {
      expect(() =>
        verify(
          { wantAssertionsSigned: false, wantResponseSigned: false },
          "<saml:Response/>",
        ),
      ).not.toThrow();
    });
  });

  it("kill-switch reverts required-but-unsigned to warn-only (no throw)", () => {
    withEnv("1", () => {
      expect(() =>
        verify({ wantAssertionsSigned: true }, "<saml:Response/>"),
      ).not.toThrow();
    });
  });
});

describe("SSOManager._enforceIdTokenClaims — fail-closed", () => {
  const enforce = (claims) =>
    SSOManager.prototype._enforceIdTokenClaims.call({}, claims);

  it("returns claims (without _validation) when the token is valid", () => {
    withEnv(undefined, () => {
      const out = enforce({
        sub: "u1",
        email: "a@b.c",
        _validation: { valid: true, errors: [] },
      });
      expect(out).toEqual({ sub: "u1", email: "a@b.c" });
      expect(out._validation).toBeUndefined();
    });
  });

  it("throws when the token failed validation (invalid claims rejected)", () => {
    withEnv(undefined, () => {
      expect(() =>
        enforce({
          sub: "u1",
          _validation: {
            valid: false,
            errors: ["Token expired", "Issuer mismatch"],
          },
        }),
      ).toThrow(/fail-closed/);
    });
  });

  it("kill-switch reverts to trusting the invalid token's claims", () => {
    withEnv("1", () => {
      const out = enforce({
        sub: "u1",
        _validation: { valid: false, errors: ["Token expired"] },
      });
      expect(out).toEqual({ sub: "u1" });
    });
  });

  it("tolerates claims without a _validation block (returns as-is)", () => {
    withEnv(undefined, () => {
      expect(enforce({ sub: "u1" })).toEqual({ sub: "u1" });
      expect(enforce(null)).toEqual({});
    });
  });
});

// ─── Session-scoped OIDC methods (shadow-store migration 2026-07-10) ───
//
// sso:get-userinfo / sso:validate-id-token / sso:get-session-info used to
// read the never-populated parallel SSOSessionManager store, then call
// manager methods that did not exist. These prototype-level tests pin the
// replacement methods: authoritative _getSession + in-manager decryption,
// fail-closed on every miss.

describe("SSOManager.getSessionUserInfo / validateSessionIdToken / getSessionInfo", () => {
  const baseSession = {
    id: "sess-1",
    providerId: "p1",
    userDid: "did:example:1",
    externalUserId: "ext-1",
    accessToken: "enc:at",
    idToken: "enc:idt",
    state: "active",
    scopes: "openid",
    userInfo: { sub: "u1" },
    expiresAt: 9999999999999,
    createdAt: 1,
    updatedAt: 2,
  };

  function ctx(overrides = {}) {
    return {
      _getSession: vi.fn(async () => baseSession),
      getProvider: vi.fn(async () => ({
        provider_type: "oidc",
        config: { clientId: "c" },
      })),
      _getOAuthProvider: vi.fn(() => ({
        getUserInfo: vi.fn(async (token) => ({ sub: "u1", via: token })),
        validateIdToken: vi.fn(async () => ({
          sub: "u1",
          _validation: { valid: true, errors: [] },
        })),
      })),
      _decryptToken: vi.fn((v) => v.replace(/^enc:/, "")),
      _enforceIdTokenClaims: SSOManager.prototype._enforceIdTokenClaims,
      ...overrides,
    };
  }

  const userInfoOf = (c, id = "sess-1") =>
    SSOManager.prototype.getSessionUserInfo.call(c, id);
  const validateOf = (c, id = "sess-1") =>
    SSOManager.prototype.validateSessionIdToken.call(c, id);
  const infoOf = (c, id = "sess-1") =>
    SSOManager.prototype.getSessionInfo.call(c, id);

  it("getSessionUserInfo decrypts inside the manager and calls the provider", async () => {
    const c = ctx();
    const res = await userInfoOf(c);
    expect(res.success).toBe(true);
    expect(res.userInfo).toEqual({ sub: "u1", via: "at" }); // decrypted token
    expect(c._decryptToken).toHaveBeenCalledWith("enc:at");
  });

  it("getSessionUserInfo fails closed on unknown / inactive / SAML sessions", async () => {
    expect(
      await userInfoOf(ctx({ _getSession: vi.fn(async () => null) })),
    ).toEqual({ success: false, error: "SESSION_NOT_FOUND" });
    expect(
      await userInfoOf(
        ctx({
          _getSession: vi.fn(async () => ({
            ...baseSession,
            state: "revoked",
          })),
        }),
      ),
    ).toEqual({ success: false, error: "SESSION_NOT_ACTIVE" });
    const saml = await userInfoOf(
      ctx({
        getProvider: vi.fn(async () => ({
          provider_type: "saml",
          config: {},
        })),
      }),
    );
    expect(saml.success).toBe(false);
  });

  it("validateSessionIdToken returns enforced claims and strips _validation", async () => {
    const res = await validateOf(ctx());
    expect(res.success).toBe(true);
    expect(res.claims).toEqual({ sub: "u1" });
  });

  it("validateSessionIdToken fails closed when the token fails validation", async () => {
    const res = await validateOf(
      ctx({
        _getOAuthProvider: vi.fn(() => ({
          validateIdToken: vi.fn(async () => ({
            sub: "u1",
            _validation: { valid: false, errors: ["Token expired"] },
          })),
        })),
      }),
    );
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/fail-closed|expired/i);
  });

  it("validateSessionIdToken reports NO_ID_TOKEN when the session has none", async () => {
    const res = await validateOf(
      ctx({
        _getSession: vi.fn(async () => ({ ...baseSession, idToken: null })),
      }),
    );
    expect(res).toEqual({ success: false, error: "NO_ID_TOKEN" });
  });

  it("getSessionInfo returns metadata WITHOUT token material", async () => {
    const info = await infoOf(ctx());
    expect(info).toMatchObject({ id: "sess-1", providerId: "p1" });
    expect(info.accessToken).toBeUndefined();
    expect(info.idToken).toBeUndefined();
    expect(JSON.stringify(info)).not.toContain("enc:");
    expect(await infoOf(ctx({ _getSession: vi.fn(async () => null) }))).toBe(
      null,
    );
  });
});
