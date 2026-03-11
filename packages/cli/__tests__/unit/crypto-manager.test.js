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
