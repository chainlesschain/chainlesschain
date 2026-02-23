"use strict";

/**
 * Backup encryption using scrypt KDF + AES-256-GCM
 * (scrypt used as Argon2id fallback — pure Node.js crypto)
 */

const crypto = require("crypto");

const KDF_N = 32768;
const KDF_R = 8;
const KDF_P = 1;
const KEY_LEN = 32;
const SALT_LEN = 32;
const IV_LEN = 12;
const TAG_LEN = 16;

/**
 * Derive a 256-bit key from passphrase using scrypt
 * @param {string|Buffer} passphrase
 * @param {Buffer} salt
 * @returns {Promise<Buffer>}
 */
async function deriveKey(passphrase, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(
      Buffer.isBuffer(passphrase)
        ? passphrase
        : Buffer.from(passphrase, "utf8"),
      salt,
      KEY_LEN,
      { N: KDF_N, r: KDF_R, p: KDF_P },
      (err, key) => {
        if (err) {
          reject(err);
        } else {
          resolve(key);
        }
      },
    );
  });
}

/**
 * Encrypt backup data with scrypt + AES-256-GCM
 * @param {Buffer|string} plaintext
 * @param {string} passphrase
 * @returns {Promise<{ ciphertext: string, salt: string, iv: string, tag: string, kdfParams: object }>}
 */
async function encryptBackup(plaintext, passphrase) {
  const plaintextBuf = Buffer.isBuffer(plaintext)
    ? plaintext
    : Buffer.from(plaintext);
  const salt = crypto.randomBytes(SALT_LEN);
  const iv = crypto.randomBytes(IV_LEN);

  const key = await deriveKey(passphrase, salt);

  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintextBuf),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return {
    ciphertext: encrypted.toString("hex"),
    salt: salt.toString("hex"),
    iv: iv.toString("hex"),
    tag: tag.toString("hex"),
    kdfParams: {
      algorithm: "scrypt",
      N: KDF_N,
      r: KDF_R,
      p: KDF_P,
      keyLen: KEY_LEN,
    },
  };
}

/**
 * Decrypt backup data
 * @param {{ ciphertext: string, salt: string, iv: string, tag: string }} encryptedData
 * @param {string} passphrase
 * @returns {Promise<Buffer>}
 */
async function decryptBackup(encryptedData, passphrase) {
  const { ciphertext, salt, iv, tag } = encryptedData;

  if (!ciphertext || !salt || !iv || !tag) {
    throw new Error("Invalid encrypted data: missing required fields");
  }

  const saltBuf = Buffer.from(salt, "hex");
  const ivBuf = Buffer.from(iv, "hex");
  const tagBuf = Buffer.from(tag, "hex");
  const ciphertextBuf = Buffer.from(ciphertext, "hex");

  const key = await deriveKey(passphrase, saltBuf);

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, ivBuf);
  decipher.setAuthTag(tagBuf);

  try {
    return Buffer.concat([decipher.update(ciphertextBuf), decipher.final()]);
  } catch (err) {
    throw new Error("Decryption failed: wrong passphrase or corrupted data");
  }
}

module.exports = { encryptBackup, decryptBackup };
