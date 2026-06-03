/**
 * DIDManager × did-keystore wiring test.
 *
 * Proves the at-rest invariant end-to-end against a tiny in-memory DB:
 *   1. saveIdentity() writes private_key_ref as `dks:v1:` ciphertext (never the
 *      raw secret-key JSON).
 *   2. getIdentityByDID() / getAllIdentities() return it decrypted, so existing
 *      signing consumers (channel-manager etc.) keep working unchanged.
 *   3. migrateEncryptPrivateKeys() upgrades legacy plaintext rows in place.
 */

const DIDManager = require("../did-manager");
const didKeystore = require("../did-keystore");

function makeFakeSafeStorage() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from("KC::" + s, "utf8"),
    decryptString: (buf) =>
      Buffer.from(buf).toString("utf8").replace(/^KC::/, ""),
  };
}

/**
 * Array-backed fake of the subset of the DB API DIDManager touches:
 * prepare(sql).run(...) / prepare(sql).all([...]) / saveToFile().
 */
function makeFakeDb() {
  const rows = []; // each: { did, private_key_ref, ... }
  return {
    rows,
    saveToFile: () => {},
    exec: () => {},
    prepare(sql) {
      return {
        get: () => ({ name: "identities" }),
        run: (...args) => {
          if (/INSERT OR REPLACE INTO identities/.test(sql)) {
            const [
              did,
              nickname,
              avatar_path,
              bio,
              public_key_sign,
              public_key_encrypt,
              private_key_ref,
              did_document,
              created_at,
              is_default,
            ] = args;
            const idx = rows.findIndex((r) => r.did === did);
            const row = {
              did,
              nickname,
              avatar_path,
              bio,
              public_key_sign,
              public_key_encrypt,
              private_key_ref,
              did_document,
              created_at,
              is_default,
            };
            if (idx >= 0) {
              rows[idx] = row;
            } else {
              rows.push(row);
            }
          } else if (/UPDATE identities SET private_key_ref/.test(sql)) {
            const [enc, did] = args;
            const row = rows.find((r) => r.did === did);
            if (row) {
              row.private_key_ref = enc;
            }
          }
          return { changes: 1 };
        },
        all: (params) => {
          if (/WHERE did = \?/.test(sql)) {
            const did = Array.isArray(params) ? params[0] : params;
            return rows.filter((r) => r.did === did);
          }
          // SELECT * / SELECT did, private_key_ref FROM identities
          return rows.slice();
        },
      };
    },
  };
}

describe("DIDManager × did-keystore at-rest encryption", () => {
  let db;
  let manager;

  beforeEach(() => {
    didKeystore._setSafeStorageForTesting(makeFakeSafeStorage());
    db = makeFakeDb();
    manager = new DIDManager(db);
  });

  afterEach(() => {
    didKeystore._setSafeStorageForTesting(undefined);
  });

  it("stores private_key_ref encrypted but reads it back decrypted", async () => {
    const created = await manager.createIdentity({ nickname: "Alice" });

    // 1. on-disk value is ciphertext, contains no raw key JSON
    const stored = db.rows.find((r) => r.did === created.did);
    expect(didKeystore.isEncrypted(stored.private_key_ref)).toBe(true);
    expect(stored.private_key_ref).not.toContain("sign");

    // 2. read path returns decrypted, parseable JSON with the signing key
    const read = manager.getIdentityByDID(created.did);
    const ref = JSON.parse(read.private_key_ref);
    expect(ref.sign).toBeTruthy();
    expect(ref.encrypt).toBeTruthy();
  });

  it("getAllIdentities decrypts every row", async () => {
    await manager.createIdentity({ nickname: "A" });
    await manager.createIdentity({ nickname: "B" });
    const all = manager.getAllIdentities();
    expect(all.length).toBeGreaterThanOrEqual(2);
    for (const id of all) {
      expect(didKeystore.isEncrypted(id.private_key_ref)).toBe(false);
      expect(() => JSON.parse(id.private_key_ref)).not.toThrow();
    }
  });

  it("migrateEncryptPrivateKeys upgrades a legacy plaintext row in place", async () => {
    // Simulate a pre-existing plaintext row written before this feature.
    const legacyRef = JSON.stringify({
      sign: "legacy-sign",
      encrypt: "legacy-enc",
    });
    db.rows.push({
      did: "did:chainlesschain:legacy",
      private_key_ref: legacyRef,
    });

    const result = await manager.migrateEncryptPrivateKeys();

    expect(result.migrated).toBe(1);
    const migrated = db.rows.find((r) => r.did === "did:chainlesschain:legacy");
    expect(didKeystore.isEncrypted(migrated.private_key_ref)).toBe(true);
    // and it still decrypts back to the original
    expect(didKeystore.decrypt(migrated.private_key_ref)).toBe(legacyRef);
  });
});
