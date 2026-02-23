/**
 * BackupEncryptor unit tests
 * Tests encryptBackup / decryptBackup (scrypt + AES-256-GCM)
 *
 * Note: scrypt N=32768 is slow. Tests use a shared beforeAll-encrypted result
 * to minimize total KDF invocations.
 */

import { describe, it, expect, beforeAll } from "vitest";

const { encryptBackup, decryptBackup } = require("../backup-encryptor");

// Shared encrypted payload — avoids running scrypt for every test
let sharedEncrypted;

beforeAll(async () => {
  sharedEncrypted = await encryptBackup(
    "shared test plaintext",
    "shared-passphrase",
  );
});

describe("encryptBackup", () => {
  it("returns object with all required hex-string fields", () => {
    expect(sharedEncrypted).toHaveProperty("ciphertext");
    expect(sharedEncrypted).toHaveProperty("salt");
    expect(sharedEncrypted).toHaveProperty("iv");
    expect(sharedEncrypted).toHaveProperty("tag");
    expect(sharedEncrypted).toHaveProperty("kdfParams");
    expect(/^[0-9a-f]+$/.test(sharedEncrypted.ciphertext)).toBe(true);
    expect(/^[0-9a-f]+$/.test(sharedEncrypted.salt)).toBe(true);
    expect(/^[0-9a-f]+$/.test(sharedEncrypted.iv)).toBe(true);
    expect(/^[0-9a-f]+$/.test(sharedEncrypted.tag)).toBe(true);
  });

  it("kdfParams has expected scrypt parameters (N=32768, r=8, p=1)", () => {
    expect(sharedEncrypted.kdfParams.N).toBe(32768);
    expect(sharedEncrypted.kdfParams.r).toBe(8);
    expect(sharedEncrypted.kdfParams.p).toBe(1);
  });

  it("different calls produce different salt and iv (random)", async () => {
    const [e1, e2] = await Promise.all([
      encryptBackup("same plaintext", "same pass"),
      encryptBackup("same plaintext", "same pass"),
    ]);
    expect(e1.salt).not.toBe(e2.salt);
    expect(e1.iv).not.toBe(e2.iv);
  });

  it("accepts Buffer plaintext", async () => {
    const buf = Buffer.from([0xde, 0xad, 0xbe, 0xef]);
    const result = await encryptBackup(buf, "bufpass");
    expect(result.ciphertext).toBeTruthy();
  });
});

describe("decryptBackup", () => {
  it("round-trip: decrypt(encrypt(plaintext, pass), pass) === original", async () => {
    const plaintext = "hello, encrypted world!";
    const encrypted = await encryptBackup(plaintext, "strongpassphrase");
    const decrypted = await decryptBackup(encrypted, "strongpassphrase");
    expect(decrypted.toString("utf8")).toBe(plaintext);
  });

  it("round-trip with Buffer input", async () => {
    const buf = Buffer.from([1, 2, 3, 4, 5]);
    const encrypted = await encryptBackup(buf, "mypass");
    const decrypted = await decryptBackup(encrypted, "mypass");
    expect(decrypted.equals(buf)).toBe(true);
  });

  it('wrong passphrase → throws "Decryption failed"', async () => {
    await expect(decryptBackup(sharedEncrypted, "wrongpass")).rejects.toThrow(
      "Decryption failed",
    );
  });

  it("corrupted ciphertext → throws", async () => {
    const corrupted = { ...sharedEncrypted, ciphertext: "deadbeefdeadbeef" };
    await expect(
      decryptBackup(corrupted, "shared-passphrase"),
    ).rejects.toThrow();
  });

  it("missing required field (no salt) → throws before scrypt", async () => {
    // Construct incomplete object directly — no scrypt needed
    const noSalt = {
      ciphertext: "aabbccdd",
      iv: "223344556677aabb",
      tag: "eeff00112233445566778899aabbccdd",
    };
    await expect(decryptBackup(noSalt, "y")).rejects.toThrow();
  });

  it("missing required field (no tag) → throws before scrypt", async () => {
    const noTag = {
      ciphertext: "aabbccdd",
      salt: "eeff001122334455",
      iv: "556677889900aabb",
    };
    await expect(decryptBackup(noTag, "y")).rejects.toThrow();
  });
});
