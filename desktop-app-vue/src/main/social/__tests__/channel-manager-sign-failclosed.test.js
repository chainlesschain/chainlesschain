/**
 * channel-manager _signOutgoingMessage — fail-closed signing (security audit
 * 2026-06-08). Receivers accept unsigned channel messages as "legacy compat",
 * so a sign-CAPABLE identity that fails to sign must NOT silently downgrade to
 * an unsigned (unauthenticated) message under its DID — it fails closed. A
 * genuinely keyless legacy identity still sends unsigned. Kill-switch
 * CHAINLESSCHAIN_CHANNEL_ALLOW_UNSIGNED_FALLBACK=1 restores the old swallow.
 *
 * Pure method via prototype.call — `this` is a stub holding only didManager.
 * Uses the REAL signPayloadWithIdentity (throws on a malformed private_key_ref),
 * so the fail-closed path is exercised for real, no mocking.
 */

const { ChannelManager } = require("../channel-manager");

const ENV = "CHAINLESSCHAIN_CHANNEL_ALLOW_UNSIGNED_FALLBACK";

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

const sign = (identity, subset = { id: "m1", content: "hi" }) =>
  ChannelManager.prototype._signOutgoingMessage.call(
    { didManager: { getCurrentIdentity: () => identity } },
    subset,
  );

// A sign-capable shape (both fields truthy) whose private_key_ref is NOT valid
// JSON → the real signPayloadWithIdentity throws while signing.
const BROKEN_SIGNER = {
  public_key_sign: "deadbeef",
  private_key_ref: "not-valid-json",
};

describe("channel-manager _signOutgoingMessage — fail-closed", () => {
  it("returns unsigned for a genuinely keyless legacy identity (null)", () => {
    expect(sign(null)).toEqual({ sender_pubkey: null, signature: null });
  });

  it("returns unsigned when the identity has no keys (legacy compat)", () => {
    expect(sign({ did: "did:x", public_key_sign: null })).toEqual({
      sender_pubkey: null,
      signature: null,
    });
    expect(sign({ public_key_sign: "x" /* no private_key_ref */ })).toEqual({
      sender_pubkey: null,
      signature: null,
    });
  });

  it("FAILS CLOSED (throws) when a sign-capable identity cannot sign", () => {
    withEnv(undefined, () => {
      expect(() => sign(BROKEN_SIGNER)).toThrow();
    });
  });

  it("does NOT silently return an unsigned envelope on signing failure", () => {
    withEnv(undefined, () => {
      let result;
      let threw = false;
      try {
        result = sign(BROKEN_SIGNER);
      } catch {
        threw = true;
      }
      // The whole point: never reach a {null,null} unsigned result here.
      expect(threw).toBe(true);
      expect(result).toBeUndefined();
    });
  });

  it("kill-switch restores the old swallow → unsigned, no throw", () => {
    withEnv("1", () => {
      expect(sign(BROKEN_SIGNER)).toEqual({
        sender_pubkey: null,
        signature: null,
      });
    });
  });
});
