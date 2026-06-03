/**
 * db-encryption-flag tests — Phase 1 master opt-in switch (default OFF).
 */

const { isDbEncryptionOptIn } = require("../db-encryption-flag");

describe("db-encryption-flag", () => {
  const ORIGINAL = process.env.CHAINLESSCHAIN_ENABLE_DB_ENCRYPTION;

  afterEach(() => {
    if (ORIGINAL === undefined) {
      delete process.env.CHAINLESSCHAIN_ENABLE_DB_ENCRYPTION;
    } else {
      process.env.CHAINLESSCHAIN_ENABLE_DB_ENCRYPTION = ORIGINAL;
    }
  });

  it("defaults to OFF when the env var is unset", () => {
    delete process.env.CHAINLESSCHAIN_ENABLE_DB_ENCRYPTION;
    expect(isDbEncryptionOptIn()).toBe(false);
  });

  it('is ON for "1" and "true"', () => {
    process.env.CHAINLESSCHAIN_ENABLE_DB_ENCRYPTION = "1";
    expect(isDbEncryptionOptIn()).toBe(true);
    process.env.CHAINLESSCHAIN_ENABLE_DB_ENCRYPTION = "true";
    expect(isDbEncryptionOptIn()).toBe(true);
  });

  it("is OFF for other values", () => {
    for (const v of ["0", "false", "yes", "", "TRUE"]) {
      process.env.CHAINLESSCHAIN_ENABLE_DB_ENCRYPTION = v;
      expect(isDbEncryptionOptIn()).toBe(false);
    }
  });
});
