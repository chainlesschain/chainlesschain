import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { MockDatabase } from "../helpers/mock-db.js";
import {
  deriveKey,
  encryptBuffer,
  decryptBuffer,
  encryptFile,
  decryptFile,
  isEncryptedFile,
  generateKey,
  hashPassword,
  verifyPassword,
  ensureCryptoTable,
  setDbEncryptionStatus,
  getDbEncryptionStatus,
  getEncryptedFileInfo,
  // V2 surface
  KEY_MATURITY_V2 as CRYPTO_KEY_MATURITY_V2,
  CRYPTO_JOB_LIFECYCLE_V2,
  CRYPTO_DEFAULT_MAX_ACTIVE_KEYS_PER_OWNER,
  CRYPTO_DEFAULT_MAX_PENDING_JOBS_PER_KEY,
  CRYPTO_DEFAULT_KEY_IDLE_MS,
  CRYPTO_DEFAULT_JOB_STUCK_MS,
  getMaxActiveKeysPerOwnerV2 as cryptoGetMaxActiveKeys,
  setMaxActiveKeysPerOwnerV2 as cryptoSetMaxActiveKeys,
  getMaxPendingJobsPerKeyV2 as cryptoGetMaxPendingJobs,
  setMaxPendingJobsPerKeyV2 as cryptoSetMaxPendingJobs,
  getKeyIdleMsV2 as cryptoGetKeyIdleMs,
  setKeyIdleMsV2 as cryptoSetKeyIdleMs,
  getJobStuckMsV2,
  setJobStuckMsV2,
  registerKeyV2 as cryptoRegisterKey,
  getKeyV2 as cryptoGetKey,
  listKeysV2 as cryptoListKeys,
  activateKeyV2 as cryptoActivateKey,
  rotateKeyV2,
  retireKeyV2,
  touchKeyV2 as cryptoTouchKey,
  createJobV2,
  getJobV2,
  listJobsV2,
  startJobV2,
  completeJobV2,
  failJobV2,
  cancelJobV2,
  getActiveKeyCountV2 as cryptoGetActiveKeyCount,
  getPendingJobCountV2,
  autoRotateIdleKeysV2,
  autoFailStuckJobsV2,
  getCryptoManagerStatsV2,
  _resetStateCryptoManagerV2,
} from "../../src/lib/crypto-manager.js";

describe("Crypto Manager", () => {
  let db;
  let tmpDir;

  beforeEach(() => {
    db = new MockDatabase();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-crypto-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ─── deriveKey ────────────────────────────────────────────

  describe("deriveKey", () => {
    it("should derive a 32-byte key from password and salt", () => {
      const salt = Buffer.from("test-salt-12345678901234567890ab", "utf8");
      const key = deriveKey("mypassword", salt);
      expect(key).toBeInstanceOf(Buffer);
      expect(key.length).toBe(32);
    });

    it("should produce consistent results for same inputs", () => {
      const salt = Buffer.from("test-salt-12345678901234567890ab", "utf8");
      const key1 = deriveKey("pass", salt);
      const key2 = deriveKey("pass", salt);
      expect(key1.equals(key2)).toBe(true);
    });

    it("should produce different keys for different passwords", () => {
      const salt = Buffer.from("test-salt-12345678901234567890ab", "utf8");
      const key1 = deriveKey("pass1", salt);
      const key2 = deriveKey("pass2", salt);
      expect(key1.equals(key2)).toBe(false);
    });
  });

  // ─── encryptBuffer / decryptBuffer ────────────────────────

  describe("encryptBuffer / decryptBuffer", () => {
    it("should encrypt and decrypt a buffer", () => {
      const plaintext = Buffer.from("Hello, World!");
      const encrypted = encryptBuffer(plaintext, "secret");
      const decrypted = decryptBuffer(encrypted, "secret");
      expect(decrypted.toString()).toBe("Hello, World!");
    });

    it("should produce different ciphertext each time (random IV)", () => {
      const plaintext = Buffer.from("Same data");
      const enc1 = encryptBuffer(plaintext, "pass");
      const enc2 = encryptBuffer(plaintext, "pass");
      expect(enc1.equals(enc2)).toBe(false);
    });

    it("should fail decryption with wrong password", () => {
      const encrypted = encryptBuffer(Buffer.from("secret data"), "right-pass");
      expect(() => decryptBuffer(encrypted, "wrong-pass")).toThrow(
        "Decryption failed",
      );
    });

    it("should fail with invalid data (too short)", () => {
      expect(() => decryptBuffer(Buffer.from("short"), "pass")).toThrow(
        "too short",
      );
    });

    it("should fail with invalid header", () => {
      const badData = Buffer.alloc(100, 0);
      expect(() => decryptBuffer(badData, "pass")).toThrow("bad header");
    });

    it("should handle empty plaintext", () => {
      const encrypted = encryptBuffer(Buffer.from(""), "pass");
      const decrypted = decryptBuffer(encrypted, "pass");
      expect(decrypted.length).toBe(0);
    });

    it("should handle large data", () => {
      const large = Buffer.alloc(1024 * 100, "A"); // 100KB
      const encrypted = encryptBuffer(large, "pass");
      const decrypted = decryptBuffer(encrypted, "pass");
      expect(decrypted.equals(large)).toBe(true);
    });
  });

  // ─── encryptFile / decryptFile ────────────────────────────

  describe("encryptFile / decryptFile", () => {
    it("should encrypt and decrypt a file", () => {
      const inputPath = path.join(tmpDir, "test.txt");
      fs.writeFileSync(inputPath, "File content here");

      const encResult = encryptFile(inputPath, "filepass");
      expect(fs.existsSync(encResult.outputPath)).toBe(true);
      expect(encResult.outputPath).toBe(`${inputPath}.enc`);

      const decResult = decryptFile(encResult.outputPath, "filepass");
      expect(fs.readFileSync(decResult.outputPath, "utf8")).toBe(
        "File content here",
      );
    });

    it("should use custom output path", () => {
      const inputPath = path.join(tmpDir, "input.txt");
      const outputPath = path.join(tmpDir, "custom.enc");
      fs.writeFileSync(inputPath, "data");

      const result = encryptFile(inputPath, "pass", outputPath);
      expect(result.outputPath).toBe(outputPath);
      expect(fs.existsSync(outputPath)).toBe(true);
    });

    it("should throw for non-existent file", () => {
      const fakePath = path.join(tmpDir, "does-not-exist.txt");
      expect(() => encryptFile(fakePath, "pass")).toThrow("File not found");
    });

    it("should report sizes correctly", () => {
      const inputPath = path.join(tmpDir, "sized.txt");
      fs.writeFileSync(inputPath, "12345");

      const result = encryptFile(inputPath, "pass");
      expect(result.originalSize).toBe(5);
      expect(result.encryptedSize).toBeGreaterThan(5); // Encrypted is larger (header + IV + tag)
    });
  });

  // ─── isEncryptedFile ──────────────────────────────────────

  describe("isEncryptedFile", () => {
    it("should detect encrypted files", () => {
      const inputPath = path.join(tmpDir, "enc.txt");
      fs.writeFileSync(inputPath, "plain");
      encryptFile(inputPath, "pass");

      expect(isEncryptedFile(`${inputPath}.enc`)).toBe(true);
    });

    it("should return false for plain files", () => {
      const inputPath = path.join(tmpDir, "plain.txt");
      fs.writeFileSync(inputPath, "just text");
      expect(isEncryptedFile(inputPath)).toBe(false);
    });

    it("should return false for non-existent files", () => {
      expect(isEncryptedFile("/nonexistent")).toBe(false);
    });
  });

  // ─── generateKey ──────────────────────────────────────────

  describe("generateKey", () => {
    it("should generate a 64-char hex key (32 bytes)", () => {
      const key = generateKey();
      expect(key).toMatch(/^[0-9a-f]{64}$/);
    });

    it("should generate different keys each time", () => {
      expect(generateKey()).not.toBe(generateKey());
    });
  });

  // ─── hashPassword / verifyPassword ────────────────────────

  describe("hashPassword / verifyPassword", () => {
    it("should hash and verify a password", () => {
      const { hash, salt } = hashPassword("mypassword");
      expect(verifyPassword("mypassword", hash, salt)).toBe(true);
    });

    it("should reject wrong password", () => {
      const { hash, salt } = hashPassword("correct");
      expect(verifyPassword("wrong", hash, salt)).toBe(false);
    });

    it("should produce different hashes for same password (random salt)", () => {
      const h1 = hashPassword("same");
      const h2 = hashPassword("same");
      expect(h1.hash).not.toBe(h2.hash);
    });
  });

  // ─── DB encryption status ─────────────────────────────────

  describe("DB encryption status", () => {
    it("should default to not encrypted", () => {
      expect(getDbEncryptionStatus(db)).toBe(false);
    });

    it("should set and get encryption status", () => {
      setDbEncryptionStatus(db, true, "hash123", "salt123");
      expect(getDbEncryptionStatus(db)).toBe(true);
    });

    it("should clear encryption status", () => {
      setDbEncryptionStatus(db, true, "hash", "salt");
      setDbEncryptionStatus(db, false);
      expect(getDbEncryptionStatus(db)).toBe(false);
    });
  });

  // ─── getEncryptedFileInfo ─────────────────────────────────

  describe("getEncryptedFileInfo", () => {
    it("should return file info", () => {
      const filePath = path.join(tmpDir, "info.txt");
      fs.writeFileSync(filePath, "some content");

      const info = getEncryptedFileInfo(filePath);
      expect(info.size).toBe(12);
      expect(info.encrypted).toBe(false);
      expect(info.extension).toBe(".txt");
    });

    it("should detect encrypted file", () => {
      const filePath = path.join(tmpDir, "to-encrypt.txt");
      fs.writeFileSync(filePath, "data");
      encryptFile(filePath, "pass");

      const info = getEncryptedFileInfo(`${filePath}.enc`);
      expect(info.encrypted).toBe(true);
    });

    it("should throw for non-existent file", () => {
      const fakePath = path.join(tmpDir, "absolutely-does-not-exist-12345.txt");
      expect(() => getEncryptedFileInfo(fakePath)).toThrow("File not found");
    });
  });
});

describe("Crypto Manager V2", () => {
  beforeEach(() => {
    _resetStateCryptoManagerV2();
  });

  describe("frozen enums + defaults", () => {
    it("freezes enums", () => {
      expect(Object.isFrozen(CRYPTO_KEY_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(CRYPTO_JOB_LIFECYCLE_V2)).toBe(true);
    });
    it("default constants", () => {
      expect(CRYPTO_DEFAULT_MAX_ACTIVE_KEYS_PER_OWNER).toBe(12);
      expect(CRYPTO_DEFAULT_MAX_PENDING_JOBS_PER_KEY).toBe(16);
      expect(CRYPTO_DEFAULT_KEY_IDLE_MS).toBe(14 * 24 * 60 * 60 * 1000);
      expect(CRYPTO_DEFAULT_JOB_STUCK_MS).toBe(5 * 60 * 1000);
    });
    it("4 maturity / 5 lifecycle states", () => {
      expect(Object.values(CRYPTO_KEY_MATURITY_V2).sort()).toEqual([
        "active",
        "pending",
        "retired",
        "rotated",
      ]);
      expect(Object.values(CRYPTO_JOB_LIFECYCLE_V2).sort()).toEqual([
        "cancelled",
        "completed",
        "failed",
        "queued",
        "running",
      ]);
    });
  });

  describe("config getters/setters", () => {
    it("default + setters store positive int + floor", () => {
      expect(cryptoGetMaxActiveKeys()).toBe(12);
      cryptoSetMaxActiveKeys(20);
      expect(cryptoGetMaxActiveKeys()).toBe(20);
      cryptoSetMaxPendingJobs(7.9);
      expect(cryptoGetMaxPendingJobs()).toBe(7);
      cryptoSetKeyIdleMs(60_000);
      expect(cryptoGetKeyIdleMs()).toBe(60_000);
      setJobStuckMsV2(1000);
      expect(getJobStuckMsV2()).toBe(1000);
    });
    it("setters reject 0/neg/non-finite/non-number", () => {
      expect(() => cryptoSetMaxActiveKeys(0)).toThrow();
      expect(() => cryptoSetMaxActiveKeys(-1)).toThrow();
      expect(() => cryptoSetMaxActiveKeys(Number.NaN)).toThrow();
      expect(() => cryptoSetMaxActiveKeys(Infinity)).toThrow();
      expect(() => cryptoSetMaxActiveKeys("8")).toThrow();
      expect(() => setJobStuckMsV2(0)).toThrow();
    });
  });

  describe("registerKeyV2 + state machine", () => {
    it("creates pending key with defaults", () => {
      const k = cryptoRegisterKey("k1", {
        ownerId: "u",
        algorithm: "AES-256-GCM",
      });
      expect(k.status).toBe(CRYPTO_KEY_MATURITY_V2.PENDING);
      expect(k.purpose).toBe("encryption");
    });
    it("rejects duplicate / missing fields", () => {
      cryptoRegisterKey("k1", { ownerId: "u", algorithm: "X" });
      expect(() =>
        cryptoRegisterKey("k1", { ownerId: "u", algorithm: "X" }),
      ).toThrow(/already exists/);
      expect(() => cryptoRegisterKey("")).toThrow(/key id/);
      expect(() => cryptoRegisterKey("k2", {})).toThrow(/ownerId/);
      expect(() => cryptoRegisterKey("k2", { ownerId: "u" })).toThrow(
        /algorithm/,
      );
    });
    it("defensive metadata copy", () => {
      const m = { tag: "x" };
      cryptoRegisterKey("k1", { ownerId: "u", algorithm: "X", metadata: m });
      m.tag = "y";
      expect(cryptoGetKey("k1").metadata.tag).toBe("x");
      const cp = cryptoGetKey("k1");
      cp.metadata.tag = "z";
      expect(cryptoGetKey("k1").metadata.tag).toBe("x");
    });
    it("pending -> active stamps activatedAt; rotated -> active preserves", () => {
      cryptoRegisterKey("k1", { ownerId: "u", algorithm: "X" });
      const a = cryptoActivateKey("k1");
      const t = a.activatedAt;
      rotateKeyV2("k1");
      const back = cryptoActivateKey("k1");
      expect(back.activatedAt).toBe(t);
    });
    it("retired terminal stamps once", () => {
      cryptoRegisterKey("k1", { ownerId: "u", algorithm: "X" });
      cryptoActivateKey("k1");
      const r = retireKeyV2("k1");
      expect(typeof r.retiredAt).toBe("number");
      expect(() => cryptoActivateKey("k1")).toThrow(/terminal/);
    });
    it("rejects invalid pending -> rotated; unknown key", () => {
      cryptoRegisterKey("k1", { ownerId: "u", algorithm: "X" });
      expect(() => rotateKeyV2("k1")).toThrow(/invalid/);
      expect(() => cryptoActivateKey("nope")).toThrow(/unknown/);
    });
  });

  describe("per-owner active-key cap + recovery exempt + scoped", () => {
    it("rejects beyond cap on pending->active", () => {
      cryptoSetMaxActiveKeys(2);
      cryptoRegisterKey("a", { ownerId: "u", algorithm: "X" });
      cryptoRegisterKey("b", { ownerId: "u", algorithm: "X" });
      cryptoRegisterKey("c", { ownerId: "u", algorithm: "X" });
      cryptoActivateKey("a");
      cryptoActivateKey("b");
      expect(() => cryptoActivateKey("c")).toThrow(/cap reached/);
    });
    it("rotated->active recovery exempt", () => {
      cryptoSetMaxActiveKeys(2);
      cryptoRegisterKey("a", { ownerId: "u", algorithm: "X" });
      cryptoRegisterKey("b", { ownerId: "u", algorithm: "X" });
      cryptoRegisterKey("c", { ownerId: "u", algorithm: "X" });
      cryptoActivateKey("a");
      cryptoActivateKey("b");
      rotateKeyV2("a");
      cryptoActivateKey("c");
      expect(() => cryptoActivateKey("a")).not.toThrow();
      expect(cryptoGetActiveKeyCount("u")).toBe(3);
    });
    it("scoped per owner", () => {
      cryptoSetMaxActiveKeys(1);
      cryptoRegisterKey("a", { ownerId: "u1", algorithm: "X" });
      cryptoRegisterKey("b", { ownerId: "u2", algorithm: "X" });
      cryptoActivateKey("a");
      expect(() => cryptoActivateKey("b")).not.toThrow();
    });
  });

  describe("listKeysV2 / touchKeyV2", () => {
    it("filters by owner/status/algorithm", () => {
      cryptoRegisterKey("a", { ownerId: "u1", algorithm: "AES" });
      cryptoRegisterKey("b", { ownerId: "u1", algorithm: "RSA" });
      cryptoRegisterKey("c", { ownerId: "u2", algorithm: "AES" });
      cryptoActivateKey("a");
      expect(cryptoListKeys({ ownerId: "u1" }).length).toBe(2);
      expect(
        cryptoListKeys({ status: CRYPTO_KEY_MATURITY_V2.ACTIVE }).length,
      ).toBe(1);
      expect(cryptoListKeys({ algorithm: "AES" }).length).toBe(2);
    });
    it("touchKeyV2 bumps lastSeenAt; rejects unknown", () => {
      const k = cryptoRegisterKey("a", { ownerId: "u", algorithm: "X" });
      const orig = Date.now;
      Date.now = () => k.lastSeenAt + 100;
      try {
        expect(cryptoTouchKey("a").lastSeenAt).toBe(k.lastSeenAt + 100);
      } finally {
        Date.now = orig;
      }
      expect(() => cryptoTouchKey("nope")).toThrow(/unknown/);
    });
  });

  describe("createJobV2 + state machine", () => {
    beforeEach(() => {
      cryptoRegisterKey("k1", { ownerId: "u", algorithm: "X" });
    });
    it("creates queued job; defaults kind to encrypt", () => {
      const j = createJobV2("j1", { keyId: "k1" });
      expect(j.status).toBe(CRYPTO_JOB_LIFECYCLE_V2.QUEUED);
      expect(j.kind).toBe("encrypt");
    });
    it("preserves provided kind", () => {
      const j = createJobV2("j1", { keyId: "k1", kind: "decrypt" });
      expect(j.kind).toBe("decrypt");
    });
    it("rejects duplicate / unknown key / missing fields", () => {
      createJobV2("j1", { keyId: "k1" });
      expect(() => createJobV2("j1", { keyId: "k1" })).toThrow(
        /already exists/,
      );
      expect(() => createJobV2("j2", { keyId: "nope" })).toThrow(/unknown key/);
      expect(() => createJobV2("j3", {})).toThrow(/keyId/);
    });
    it("per-key pending cap counts queued+running", () => {
      cryptoSetMaxPendingJobs(2);
      createJobV2("j1", { keyId: "k1" });
      createJobV2("j2", { keyId: "k1" });
      expect(() => createJobV2("j3", { keyId: "k1" })).toThrow(/cap reached/);
      startJobV2("j1");
      expect(() => createJobV2("j3", { keyId: "k1" })).toThrow(/cap reached/);
      completeJobV2("j1");
      expect(() => createJobV2("j3", { keyId: "k1" })).not.toThrow();
    });
    it("queued -> running stamps startedAt; running -> completed/failed stamp settledAt", () => {
      createJobV2("j1", { keyId: "k1" });
      const r = startJobV2("j1");
      expect(typeof r.startedAt).toBe("number");
      const c = completeJobV2("j1");
      expect(typeof c.settledAt).toBe("number");
      createJobV2("j2", { keyId: "k1" });
      startJobV2("j2");
      expect(failJobV2("j2").status).toBe(CRYPTO_JOB_LIFECYCLE_V2.FAILED);
    });
    it("queued|running -> cancelled, rejects invalid + terminal", () => {
      createJobV2("j1", { keyId: "k1" });
      cancelJobV2("j1");
      expect(() => startJobV2("j1")).toThrow(/terminal/);
      createJobV2("j2", { keyId: "k1" });
      expect(() => completeJobV2("j2")).toThrow(/invalid/);
      startJobV2("j2");
      expect(cancelJobV2("j2").status).toBe(CRYPTO_JOB_LIFECYCLE_V2.CANCELLED);
    });
  });

  describe("listJobsV2", () => {
    it("filters by key/status/kind", () => {
      cryptoRegisterKey("k1", { ownerId: "u", algorithm: "X" });
      cryptoRegisterKey("k2", { ownerId: "u", algorithm: "X" });
      createJobV2("j1", { keyId: "k1", kind: "encrypt" });
      createJobV2("j2", { keyId: "k2", kind: "decrypt" });
      startJobV2("j1");
      expect(listJobsV2({ keyId: "k1" }).length).toBe(1);
      expect(
        listJobsV2({ status: CRYPTO_JOB_LIFECYCLE_V2.RUNNING }).length,
      ).toBe(1);
      expect(listJobsV2({ kind: "decrypt" }).length).toBe(1);
    });
  });

  describe("auto-flip", () => {
    it("autoRotateIdleKeysV2 rotates idle active", () => {
      cryptoRegisterKey("a", { ownerId: "u", algorithm: "X" });
      cryptoActivateKey("a");
      const f = autoRotateIdleKeysV2({
        now: Date.now() + cryptoGetKeyIdleMs() + 1,
      });
      expect(f.length).toBe(1);
      expect(cryptoGetKey("a").status).toBe(CRYPTO_KEY_MATURITY_V2.ROTATED);
    });
    it("autoRotateIdleKeysV2 ignores non-active", () => {
      cryptoRegisterKey("a", { ownerId: "u", algorithm: "X" });
      expect(
        autoRotateIdleKeysV2({ now: Date.now() + 999_999_999 }).length,
      ).toBe(0);
    });
    it("autoFailStuckJobsV2 fails stuck running, ignores queued", () => {
      cryptoRegisterKey("k", { ownerId: "u", algorithm: "X" });
      createJobV2("j1", { keyId: "k" });
      startJobV2("j1");
      const f = autoFailStuckJobsV2({
        now: Date.now() + getJobStuckMsV2() + 1,
      });
      expect(f.length).toBe(1);
      expect(getJobV2("j1").status).toBe(CRYPTO_JOB_LIFECYCLE_V2.FAILED);
      createJobV2("j2", { keyId: "k" });
      expect(
        autoFailStuckJobsV2({ now: Date.now() + getJobStuckMsV2() + 1 }).length,
      ).toBe(0);
    });
  });

  describe("getCryptoManagerStatsV2 + counts", () => {
    it("zero state has all keys at 0", () => {
      const s = getCryptoManagerStatsV2();
      expect(s.totalKeysV2).toBe(0);
      for (const v of Object.values(CRYPTO_KEY_MATURITY_V2))
        expect(s.keysByStatus[v]).toBe(0);
      for (const v of Object.values(CRYPTO_JOB_LIFECYCLE_V2))
        expect(s.jobsByStatus[v]).toBe(0);
    });
    it("counts after operations", () => {
      cryptoRegisterKey("k", { ownerId: "u", algorithm: "X" });
      cryptoActivateKey("k");
      createJobV2("j", { keyId: "k" });
      const s = getCryptoManagerStatsV2();
      expect(s.totalKeysV2).toBe(1);
      expect(s.totalJobsV2).toBe(1);
      expect(s.keysByStatus.active).toBe(1);
      expect(s.jobsByStatus.queued).toBe(1);
    });
    it("getActiveKeyCountV2 scoped; getPendingJobCountV2 counts queued+running", () => {
      cryptoRegisterKey("a", { ownerId: "u1", algorithm: "X" });
      cryptoRegisterKey("b", { ownerId: "u2", algorithm: "X" });
      cryptoActivateKey("a");
      cryptoActivateKey("b");
      expect(cryptoGetActiveKeyCount()).toBe(2);
      expect(cryptoGetActiveKeyCount("u1")).toBe(1);
      createJobV2("j1", { keyId: "a" });
      createJobV2("j2", { keyId: "a" });
      startJobV2("j1");
      expect(getPendingJobCountV2("a")).toBe(2);
      completeJobV2("j1");
      expect(getPendingJobCountV2("a")).toBe(1);
    });
  });

  describe("_resetStateCryptoManagerV2", () => {
    it("clears state + restores defaults", () => {
      cryptoRegisterKey("a", { ownerId: "u", algorithm: "X" });
      cryptoSetMaxActiveKeys(99);
      _resetStateCryptoManagerV2();
      expect(cryptoGetKey("a")).toBeNull();
      expect(cryptoGetMaxActiveKeys()).toBe(
        CRYPTO_DEFAULT_MAX_ACTIVE_KEYS_PER_OWNER,
      );
    });
  });
});
