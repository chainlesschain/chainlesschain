/**
 * did-keystore tests — at-rest protection for DID private-key material.
 *
 * Verifies the safeStorage wrapper's encrypt/decrypt roundtrip, the
 * tagged-ciphertext format, idempotency, legacy-plaintext passthrough, and the
 * fail-open (dev) vs fail-closed (production) behaviour when safeStorage is
 * unavailable.
 */

const didKeystore = require("../did-keystore");

/**
 * Minimal fake of Electron safeStorage. Uses a reversible base64 transform so
 * we can assert roundtrip without a real OS keychain.
 */
function makeFakeSafeStorage(available = true) {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (s) => Buffer.from("FAKE::" + s, "utf8"),
    decryptString: (buf) =>
      Buffer.from(buf)
        .toString("utf8")
        .replace(/^FAKE::/, ""),
  };
}

describe("did-keystore", () => {
  const ORIGINAL_ENV = process.env.NODE_ENV;

  afterEach(() => {
    didKeystore._setSafeStorageForTesting(undefined);
    didKeystore._setIsPackagedForTesting(undefined);
    process.env.NODE_ENV = ORIGINAL_ENV;
  });

  describe("with safeStorage available", () => {
    beforeEach(() => {
      didKeystore._setSafeStorageForTesting(makeFakeSafeStorage(true));
    });

    it("encrypts to a dks:v1: tagged string and roundtrips", () => {
      const plaintext = JSON.stringify({ sign: "abc", encrypt: "def" });
      const enc = didKeystore.encrypt(plaintext);

      expect(enc.startsWith(didKeystore.ENC_PREFIX)).toBe(true);
      expect(enc).not.toContain("abc"); // not stored verbatim
      expect(didKeystore.isEncrypted(enc)).toBe(true);
      expect(didKeystore.decrypt(enc)).toBe(plaintext);
    });

    it("is idempotent — never double-encrypts", () => {
      const enc = didKeystore.encrypt("secret-material");
      const encAgain = didKeystore.encrypt(enc);
      expect(encAgain).toBe(enc);
      expect(didKeystore.decrypt(encAgain)).toBe("secret-material");
    });

    it("passes legacy plaintext through decrypt unchanged", () => {
      const legacy = JSON.stringify({ sign: "legacy" });
      expect(didKeystore.isEncrypted(legacy)).toBe(false);
      expect(didKeystore.decrypt(legacy)).toBe(legacy);
    });

    it("reports encryption available", () => {
      expect(didKeystore.isEncryptionAvailable()).toBe(true);
    });
  });

  describe("with safeStorage unavailable", () => {
    beforeEach(() => {
      didKeystore._setSafeStorageForTesting(null);
    });

    it("reports encryption unavailable", () => {
      expect(didKeystore.isEncryptionAvailable()).toBe(false);
    });

    it("falls back to plaintext outside production (with warning)", () => {
      process.env.NODE_ENV = "test";
      const plaintext = "dev-secret";
      expect(didKeystore.encrypt(plaintext)).toBe(plaintext);
    });

    it("fails closed in production rather than writing plaintext", () => {
      process.env.NODE_ENV = "production";
      expect(() => didKeystore.encrypt("prod-secret")).toThrow(
        /fail-closed|safeStorage/,
      );
    });

    it("fails closed in a packaged build even when NODE_ENV is unset", () => {
      // Packaged Electron installs leave NODE_ENV undefined — the old guard
      // (NODE_ENV === 'production') missed them and silently wrote plaintext.
      delete process.env.NODE_ENV;
      didKeystore._setIsPackagedForTesting(true);
      expect(() => didKeystore.encrypt("prod-secret")).toThrow(
        /fail-closed|safeStorage/,
      );
    });

    it("throws when asked to decrypt ciphertext it cannot open", () => {
      const ciphertext =
        didKeystore.ENC_PREFIX + Buffer.from("x").toString("base64");
      expect(() => didKeystore.decrypt(ciphertext)).toThrow(/safeStorage/);
    });
  });

  describe("edge cases", () => {
    beforeEach(() => {
      didKeystore._setSafeStorageForTesting(makeFakeSafeStorage(true));
    });

    it("returns empty/non-string inputs unchanged on encrypt", () => {
      expect(didKeystore.encrypt("")).toBe("");
      expect(didKeystore.encrypt(null)).toBe(null);
      expect(didKeystore.encrypt(undefined)).toBe(undefined);
    });

    it("returns null/non-string inputs unchanged on decrypt", () => {
      expect(didKeystore.decrypt(null)).toBe(null);
      expect(didKeystore.decrypt(undefined)).toBe(undefined);
    });
  });
});
