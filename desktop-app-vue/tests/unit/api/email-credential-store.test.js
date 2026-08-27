import { describe, expect, it, vi } from "vitest";

const {
  EMAIL_CREDENTIAL_REF_PREFIX,
  EmailCredentialStore,
} = require("../../../src/main/api/email-credential-store.js");

function createStorage(initial = {}) {
  let data = structuredClone(initial);
  return {
    exists: vi.fn(() => Object.keys(data).length > 0),
    load: vi.fn(() => structuredClone(data)),
    save: vi.fn((next) => {
      data = structuredClone(next);
      return true;
    }),
    snapshot: () => structuredClone(data),
  };
}

describe("EmailCredentialStore", () => {
  it("stores passwords only in encrypted config and resolves opaque refs", () => {
    const storage = createStorage();
    const store = new EmailCredentialStore({ storage });

    const reference = store.setPassword("account-1", "secret-value");
    const key = store.credentialKey("account-1");

    expect(reference).toBe(`${EMAIL_CREDENTIAL_REF_PREFIX}${key}`);
    expect(store.getPassword("account-1", reference)).toBe("secret-value");
    expect(storage.snapshot()).toEqual({
      emailAccounts: { [key]: { password: "secret-value" } },
    });
  });

  it("migrates legacy database plaintext only after encrypted save succeeds", () => {
    const storage = createStorage();
    const updates = [];
    const db = {
      prepare: vi.fn((query) => {
        if (query.startsWith("SELECT id, password")) {
          return {
            all: vi.fn(() => [{ id: "account-1", password: "legacy-secret" }]),
          };
        }
        if (query.startsWith("UPDATE email_accounts")) {
          return { run: vi.fn((params) => updates.push(params)) };
        }
        throw new Error(`unexpected query: ${query}`);
      }),
      transaction: vi.fn((fn) => fn),
    };
    const store = new EmailCredentialStore({ storage });

    expect(store.migrateDatabase({ db })).toEqual({ migrated: 1 });
    expect(storage.save).toHaveBeenCalledTimes(1);
    expect(updates).toHaveLength(1);
    expect(updates[0][0]).toBe(
      `${EMAIL_CREDENTIAL_REF_PREFIX}${store.credentialKey("account-1")}`,
    );
    expect(updates[0]).not.toContain("legacy-secret");
  });

  it("fails closed when encrypted persistence refuses the write", () => {
    const storage = createStorage();
    storage.save.mockReturnValue(false);
    const store = new EmailCredentialStore({ storage });

    expect(() => store.setPassword("account-1", "secret-value")).toThrow(
      /Unable to save encrypted email credentials/,
    );
  });

  it("fails closed instead of overwriting an unreadable credential file", () => {
    const storage = {
      exists: vi.fn(() => true),
      load: vi.fn(() => null),
      save: vi.fn(() => true),
    };
    const store = new EmailCredentialStore({ storage });

    expect(() => store.setPassword("account-1", "secret-value")).toThrow(
      /Unable to read encrypted email credentials/,
    );
    expect(storage.save).not.toHaveBeenCalled();
  });
});
