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
