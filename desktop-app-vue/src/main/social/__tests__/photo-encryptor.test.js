/**
 * PhotoEncryptor unit tests - covers initialize, generateAlbumKey,
 * encryptPhoto, decryptPhoto, storeEncryptedKey, getEncryptedKey, keyCache
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
vi.mock("../../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
let uuidCounter = 0;
vi.mock("uuid", () => ({
  v4: () => `test-uuid-${++uuidCounter}`,
}));
const { PhotoEncryptor, ALGORITHM, KEY_LENGTH, IV_LENGTH, AUTH_TAG_LENGTH } = require("../photo-encryptor");
function createMockPrepResult() {
  return { all: vi.fn().mockReturnValue([]), get: vi.fn().mockReturnValue(null), run: vi.fn() };
}
function createMockDatabase() {
  const prepResult = createMockPrepResult();
  return { db: { exec: vi.fn(), run: vi.fn(), prepare: vi.fn().mockReturnValue(prepResult), _prep: prepResult }, saveToFile: vi.fn() };
}
function createMockDIDManager(did = "did:test:alice") {
  return { getCurrentIdentity: vi.fn().mockReturnValue({ did }) };
}
describe("PhotoEncryptor", () => {
  let encryptor, mockDatabase, mockDIDManager;
  beforeEach(() => {
    uuidCounter = 0;
    mockDatabase = createMockDatabase();
    mockDIDManager = createMockDIDManager();
    encryptor = new PhotoEncryptor(mockDatabase, mockDIDManager);
    vi.clearAllMocks();
  });
  describe("module constants", () => {
    it("exports ALGORITHM = aes-256-gcm", () => { expect(ALGORITHM).toBe("aes-256-gcm"); });
    it("exports KEY_LENGTH = 32", () => { expect(KEY_LENGTH).toBe(32); });
    it("exports IV_LENGTH = 12", () => { expect(IV_LENGTH).toBe(12); });
    it("exports AUTH_TAG_LENGTH = 16", () => { expect(AUTH_TAG_LENGTH).toBe(16); });
  });
  describe("constructor", () => {
    it("sets initialized to false", () => { expect(encryptor.initialized).toBe(false); });
    it("initializes keyCache as an empty Map", () => {
      expect(encryptor.keyCache).toBeInstanceOf(Map);
      expect(encryptor.keyCache.size).toBe(0);
    });
    it("stores database and didManager references", () => {
      expect(encryptor.database).toBe(mockDatabase);
      expect(encryptor.didManager).toBe(mockDIDManager);
    });
  });
  describe("initialize()", () => {
    it("creates the photo_encryption_keys table via db.exec", async () => {
      await encryptor.initialize();
      const allSql = mockDatabase.db.exec.mock.calls.map((c) => c[0]).join(" ");
      expect(allSql).toContain("CREATE TABLE IF NOT EXISTS photo_encryption_keys");
      expect(allSql).toContain("album_id TEXT NOT NULL");
      expect(allSql).toContain("encrypted_key TEXT NOT NULL");
      expect(allSql).toContain("recipient_did TEXT NOT NULL");
    });
    it("creates indexes on album_id and recipient_did", async () => {
      await encryptor.initialize();
      const allSql = mockDatabase.db.exec.mock.calls.map((c) => c[0]).join(" ");
      expect(allSql).toContain("idx_photo_keys_album");
      expect(allSql).toContain("idx_photo_keys_recipient");
    });
    it("sets initialized = true after successful init", async () => {
      expect(encryptor.initialized).toBe(false);
      await encryptor.initialize();
      expect(encryptor.initialized).toBe(true);
    });
    it("db.exec is called at least twice (table + indexes)", async () => {
      await encryptor.initialize();
      expect(mockDatabase.db.exec.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
    it("propagates db.exec errors and leaves initialized = false", async () => {
      mockDatabase.db.exec.mockImplementation(() => {
        throw new Error("exec failed");
      });
      await expect(encryptor.initialize()).rejects.toThrow("exec failed");
      expect(encryptor.initialized).toBe(false);
    });
    it("can be called a second time without error", async () => {
      await encryptor.initialize();
      await expect(encryptor.initialize()).resolves.not.toThrow();
      expect(encryptor.initialized).toBe(true);
    });
  });
  describe("generateAlbumKey()", () => {
    it("returns a Buffer", () => { expect(Buffer.isBuffer(encryptor.generateAlbumKey())).toBe(true); });
    it("returns exactly 32 bytes", () => { expect(encryptor.generateAlbumKey().length).toBe(32); });
    it("returns different keys on successive calls", () => {
      const k1 = encryptor.generateAlbumKey(), k2 = encryptor.generateAlbumKey();
      expect(k1.equals(k2)).toBe(false);
    });
  });
  describe("encryptPhoto()", () => {
    let albumKey;
    beforeEach(() => { albumKey = encryptor.generateAlbumKey(); });
    it("throws when buffer is not a Buffer", () => {
      expect(() => encryptor.encryptPhoto("not a buffer", albumKey)).toThrow("Input must be a Buffer");
    });
    it("throws when albumKey is not a Buffer", () => {
      expect(() => encryptor.encryptPhoto(Buffer.from("hi"), "bad")).toThrow("Album key must be a 32-byte Buffer");
    });
    it("throws when albumKey is wrong length Buffer", () => {
      expect(() => encryptor.encryptPhoto(Buffer.from("hi"), Buffer.alloc(16))).toThrow("Album key must be a 32-byte Buffer");
    });
    it("returns a Buffer", () => {
      expect(Buffer.isBuffer(encryptor.encryptPhoto(Buffer.from("test"), albumKey))).toBe(true);
    });
    it("result length equals original + IV_LENGTH + AUTH_TAG_LENGTH", () => {
      const buf = Buffer.from("test photo data");
      expect(encryptor.encryptPhoto(buf, albumKey).length).toBe(buf.length + IV_LENGTH + AUTH_TAG_LENGTH);
    });
    it("round-trip decryption returns original data", () => {
      const original = Buffer.from("round-trip photo content for testing");
      const encrypted = encryptor.encryptPhoto(original, albumKey);
      const decrypted = encryptor.decryptPhoto(encrypted, albumKey);
      expect(decrypted.equals(original)).toBe(true);
    });
    it("round-trip works with binary (non-ASCII) data", () => {
      const original = Buffer.from([0x00, 0xff, 0xde, 0xad, 0xbe, 0xef, 0x42]);
      expect(encryptor.decryptPhoto(encryptor.encryptPhoto(original, albumKey), albumKey).equals(original)).toBe(true);
    });
    it("different encryptions of same data produce different ciphertexts (random IV)", () => {
      const buf = Buffer.from("same content");
      expect(encryptor.encryptPhoto(buf, albumKey).equals(encryptor.encryptPhoto(buf, albumKey))).toBe(false);
    });
  });
  describe("decryptPhoto()", () => {
    let albumKey, plaintext, encrypted;
    beforeEach(() => {
      albumKey = encryptor.generateAlbumKey();
      plaintext = Buffer.from("sensitive photo bytes");
      encrypted = encryptor.encryptPhoto(plaintext, albumKey);
    });
    it("throws when encryptedBuffer is not a Buffer", () => {
      expect(() => encryptor.decryptPhoto("nope", albumKey)).toThrow("Input must be a Buffer");
    });
    it("throws when albumKey is not a Buffer", () => {
      expect(() => encryptor.decryptPhoto(encrypted, "bad")).toThrow("Album key must be a 32-byte Buffer");
    });
    it("throws when albumKey is wrong length Buffer", () => {
      expect(() => encryptor.decryptPhoto(encrypted, Buffer.alloc(8))).toThrow("Album key must be a 32-byte Buffer");
    });
    it("throws when encrypted buffer is too short (iv + authTag only, no ciphertext)", () => {
      expect(() => encryptor.decryptPhoto(Buffer.alloc(IV_LENGTH + AUTH_TAG_LENGTH), albumKey))
        .toThrow("Encrypted buffer is too short");
    });
    it("returns a Buffer", () => {
      expect(Buffer.isBuffer(encryptor.decryptPhoto(encrypted, albumKey))).toBe(true);
    });
    it("decrypts to original plaintext", () => {
      expect(encryptor.decryptPhoto(encrypted, albumKey).equals(plaintext)).toBe(true);
    });
    it("throws on wrong key (auth tag mismatch)", () => {
      expect(() => encryptor.decryptPhoto(encrypted, encryptor.generateAlbumKey())).toThrow();
    });
    it("round-trip with large buffer (64 KB)", () => {
      const large = Buffer.alloc(65536, 0xab);
      expect(encryptor.decryptPhoto(encryptor.encryptPhoto(large, albumKey), albumKey).equals(large)).toBe(true);
    });
  });
  describe("storeEncryptedKey()", () => {
    it("calls db.prepare with INSERT OR REPLACE into photo_encryption_keys", async () => {
      await encryptor.storeEncryptedKey("album-001", "did:test:bob", "base64key==");
      const sql = mockDatabase.db.prepare.mock.calls[0][0];
      expect(sql).toContain("INSERT OR REPLACE");
      expect(sql).toContain("photo_encryption_keys");
    });
    it("calls .run() with correct positional args (id, album_id, key, did, timestamp)", async () => {
      await encryptor.storeEncryptedKey("album-001", "did:test:bob", "base64key==");
      const args = mockDatabase.db._prep.run.mock.calls[0];
      // id is a non-empty string (uuid or mocked uuid)
      expect(typeof args[0]).toBe("string");
      expect(args[0].length).toBeGreaterThan(0);
      expect(args[1]).toBe("album-001");
      expect(args[2]).toBe("base64key==");
      expect(args[3]).toBe("did:test:bob");
      expect(typeof args[4]).toBe("number");
      expect(args[4]).toBeGreaterThan(0);
    });
    it("stores created_at as a timestamp close to now", async () => {
      const before = Date.now();
      await encryptor.storeEncryptedKey("album-001", "did:test:bob", "key==");
      const after = Date.now();
      const ts = mockDatabase.db._prep.run.mock.calls[0][4];
      expect(ts).toBeGreaterThanOrEqual(before);
      expect(ts).toBeLessThanOrEqual(after);
    });
    it("propagates prepare errors", async () => {
      mockDatabase.db.prepare.mockImplementation(() => { throw new Error("prepare failed"); });
      await expect(encryptor.storeEncryptedKey("album-001", "did:test:bob", "k")).rejects.toThrow("prepare failed");
    });
    it("propagates run errors", async () => {
      mockDatabase.db._prep.run.mockImplementation(() => { throw new Error("run failed"); });
      await expect(encryptor.storeEncryptedKey("album-001", "did:test:bob", "k")).rejects.toThrow("run failed");
    });
  });
  describe("getEncryptedKey()", () => {
    it("calls db.prepare with SELECT from photo_encryption_keys", async () => {
      await encryptor.getEncryptedKey("album-001", "did:test:bob");
      const sql = mockDatabase.db.prepare.mock.calls[0][0];
      expect(sql).toContain("SELECT");
      expect(sql).toContain("photo_encryption_keys");
    });
    it("calls .get() with albumId and recipientDid", async () => {
      await encryptor.getEncryptedKey("album-001", "did:test:bob");
      expect(mockDatabase.db._prep.get).toHaveBeenCalledWith("album-001", "did:test:bob");
    });
    it("returns encrypted_key string when row is found", async () => {
      mockDatabase.db._prep.get.mockReturnValue({ encrypted_key: "stored-key==" });
      expect(await encryptor.getEncryptedKey("album-001", "did:test:bob")).toBe("stored-key==");
    });
    it("returns null when no row is found", async () => {
      mockDatabase.db._prep.get.mockReturnValue(null);
      expect(await encryptor.getEncryptedKey("album-999", "did:test:unknown")).toBeNull();
    });
    it("propagates database errors", async () => {
      mockDatabase.db.prepare.mockImplementation(() => { throw new Error("select failed"); });
      await expect(encryptor.getEncryptedKey("album-001", "did:test:bob")).rejects.toThrow("select failed");
    });
  });
  describe("keyCache operations", () => {
    let albumKey;
    beforeEach(() => { albumKey = encryptor.generateAlbumKey(); });
    describe("manual cache set (keyCache.set)", () => {
      it("stores a key in the in-memory cache", () => {
        encryptor.keyCache.set("album-001", albumKey);
        expect(encryptor.keyCache.has("album-001")).toBe(true);
      });
      it("stored key is retrievable with keyCache.get", () => {
        encryptor.keyCache.set("album-001", albumKey);
        expect(encryptor.keyCache.get("album-001")).toBe(albumKey);
      });
    });
    describe("getAlbumKey() cache hit", () => {
      it("returns cached key without hitting the database", async () => {
        encryptor.keyCache.set("album-cached", albumKey);
        expect(await encryptor.getAlbumKey("album-cached", "dummy")).toBe(albumKey);
        expect(mockDatabase.db.prepare).not.toHaveBeenCalled();
      });
    });
    describe("getAlbumKey() cache miss - no identity", () => {
      it("returns null when getCurrentIdentity returns null", async () => {
        mockDIDManager.getCurrentIdentity.mockReturnValue(null);
        expect(await encryptor.getAlbumKey("album-x", "key")).toBeNull();
      });
      it("returns null when identity has no did property", async () => {
        mockDIDManager.getCurrentIdentity.mockReturnValue({});
        expect(await encryptor.getAlbumKey("album-x", "key")).toBeNull();
      });
    });
    describe("getAlbumKey() cache miss - no stored key", () => {
      it("returns null when no encrypted key exists in the database", async () => {
        mockDatabase.db._prep.get.mockReturnValue(null);
        expect(await encryptor.getAlbumKey("album-nf", "key")).toBeNull();
      });
    });
    describe("clearKeyCache()", () => {
      it("empties the entire cache", () => {
        encryptor.keyCache.set("a1", albumKey);
        encryptor.keyCache.set("a2", albumKey);
        expect(encryptor.keyCache.size).toBe(2);
        encryptor.clearKeyCache();
        expect(encryptor.keyCache.size).toBe(0);
      });
      it("does not throw when cache is already empty", () => {
        expect(() => encryptor.clearKeyCache()).not.toThrow();
      });
      it("previously cached keys are gone after clear", () => {
        encryptor.keyCache.set("a1", albumKey);
        encryptor.clearKeyCache();
        expect(encryptor.keyCache.has("a1")).toBe(false);
      });
    });
    describe("per-album key deletion (keyCache.delete)", () => {
      it("removes only the targeted key, leaving others intact", () => {
        const key2 = encryptor.generateAlbumKey();
        encryptor.keyCache.set("album-A", albumKey);
        encryptor.keyCache.set("album-B", key2);
        encryptor.keyCache.delete("album-A");
        expect(encryptor.keyCache.has("album-A")).toBe(false);
        expect(encryptor.keyCache.has("album-B")).toBe(true);
        expect(encryptor.keyCache.get("album-B")).toBe(key2);
      });
      it("cache.get returns undefined for a deleted key", () => {
        encryptor.keyCache.set("d", albumKey);
        encryptor.keyCache.delete("d");
        expect(encryptor.keyCache.get("d")).toBeUndefined();
      });
    });
  });
  describe("close()", () => {
    it("clears the key cache on close", async () => {
      encryptor.keyCache.set("a", encryptor.generateAlbumKey());
      await encryptor.close();
      expect(encryptor.keyCache.size).toBe(0);
    });
    it("sets initialized = false on close", async () => {
      await encryptor.initialize();
      expect(encryptor.initialized).toBe(true);
      await encryptor.close();
      expect(encryptor.initialized).toBe(false);
    });
  });
});
