/**
 * Crypto Manager — file encryption/decryption using AES-256-GCM.
 * Uses Node.js built-in crypto module, no external dependencies.
 */

import crypto from "crypto";
import fs from "fs";
import path from "path";

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 12; // 96 bits for GCM
const SALT_LENGTH = 32;
const TAG_LENGTH = 16;
const PBKDF2_ITERATIONS = 100000;
const MAGIC_HEADER = Buffer.from("CCLC01"); // ChainLessChain v01

/**
 * Derive a key from a password using PBKDF2.
 */
export function deriveKey(password, salt) {
  return crypto.pbkdf2Sync(
    password,
    salt,
    PBKDF2_ITERATIONS,
    KEY_LENGTH,
    "sha512",
  );
}

/**
 * Encrypt a buffer with AES-256-GCM.
 * Returns: MAGIC(6) + SALT(32) + IV(12) + TAG(16) + CIPHERTEXT
 */
export function encryptBuffer(plaintext, password) {
  const salt = crypto.randomBytes(SALT_LENGTH);
  const key = deriveKey(password, salt);
  const iv = crypto.randomBytes(IV_LENGTH);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  return Buffer.concat([MAGIC_HEADER, salt, iv, tag, encrypted]);
}

/**
 * Decrypt a buffer encrypted with encryptBuffer.
 */
export function decryptBuffer(data, password) {
  // Validate magic header
  if (
    data.length <
    MAGIC_HEADER.length + SALT_LENGTH + IV_LENGTH + TAG_LENGTH
  ) {
    throw new Error("Invalid encrypted data: too short");
  }

  const magic = data.subarray(0, MAGIC_HEADER.length);
  if (!magic.equals(MAGIC_HEADER)) {
    throw new Error(
      "Invalid encrypted data: bad header (not a ChainlessChain encrypted file)",
    );
  }

  let offset = MAGIC_HEADER.length;
  const salt = data.subarray(offset, offset + SALT_LENGTH);
  offset += SALT_LENGTH;
  const iv = data.subarray(offset, offset + IV_LENGTH);
  offset += IV_LENGTH;
  const tag = data.subarray(offset, offset + TAG_LENGTH);
  offset += TAG_LENGTH;
  const ciphertext = data.subarray(offset);

  const key = deriveKey(password, salt);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch (_err) {
    throw new Error("Decryption failed: wrong password or corrupted data");
  }
}

/**
 * Encrypt a file to a .enc output file.
 */
export function encryptFile(inputPath, password, outputPath) {
  if (!fs.existsSync(inputPath)) {
    throw new Error(`File not found: ${inputPath}`);
  }

  const plaintext = fs.readFileSync(inputPath);
  const encrypted = encryptBuffer(plaintext, password);

  const outPath = outputPath || `${inputPath}.enc`;
  fs.writeFileSync(outPath, encrypted);

  return {
    inputPath,
    outputPath: outPath,
    originalSize: plaintext.length,
    encryptedSize: encrypted.length,
  };
}

/**
 * Decrypt a .enc file.
 */
export function decryptFile(inputPath, password, outputPath) {
  if (!fs.existsSync(inputPath)) {
    throw new Error(`File not found: ${inputPath}`);
  }

  const data = fs.readFileSync(inputPath);
  const plaintext = decryptBuffer(data, password);

  // Default output: remove .enc extension, or add .dec
  const outPath =
    outputPath ||
    (inputPath.endsWith(".enc") ? inputPath.slice(0, -4) : `${inputPath}.dec`);

  fs.writeFileSync(outPath, plaintext);

  return {
    inputPath,
    outputPath: outPath,
    encryptedSize: data.length,
    decryptedSize: plaintext.length,
  };
}

/**
 * Check if a file is encrypted with our format.
 */
export function isEncryptedFile(filePath) {
  try {
    const fd = fs.openSync(filePath, "r");
    const buf = Buffer.alloc(MAGIC_HEADER.length);
    fs.readSync(fd, buf, 0, MAGIC_HEADER.length, 0);
    fs.closeSync(fd);
    return buf.equals(MAGIC_HEADER);
  } catch (_err) {
    return false;
  }
}

/**
 * Generate a random encryption key (hex string).
 */
export function generateKey() {
  return crypto.randomBytes(KEY_LENGTH).toString("hex");
}

/**
 * Hash a password for storage (SHA-256 + salt).
 * Returns { hash, salt } as hex strings.
 */
export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto
    .createHash("sha256")
    .update(password + salt)
    .digest("hex");
  return { hash, salt };
}

/**
 * Verify a password against a stored hash+salt.
 */
export function verifyPassword(password, hash, salt) {
  const computed = crypto
    .createHash("sha256")
    .update(password + salt)
    .digest("hex");
  return crypto.timingSafeEqual(
    Buffer.from(computed, "hex"),
    Buffer.from(hash, "hex"),
  );
}

/**
 * Ensure crypto metadata table exists.
 */
export function ensureCryptoTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS crypto_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
}

/**
 * Set database encryption status.
 */
export function setDbEncryptionStatus(
  db,
  encrypted,
  passwordHash,
  passwordSalt,
) {
  ensureCryptoTable(db);
  const stmt = db.prepare(
    "INSERT OR REPLACE INTO crypto_metadata (key, value) VALUES (?, ?)",
  );
  stmt.run("db_encrypted", encrypted ? "true" : "false");
  if (passwordHash) {
    stmt.run("db_password_hash", passwordHash);
    stmt.run("db_password_salt", passwordSalt);
  }
}

/**
 * Get database encryption status.
 */
export function getDbEncryptionStatus(db) {
  ensureCryptoTable(db);
  const row = db
    .prepare("SELECT value FROM crypto_metadata WHERE key = ?")
    .get("db_encrypted");
  return row?.value === "true";
}

/**
 * Get file info for encrypted file.
 */
export function getEncryptedFileInfo(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const stats = fs.statSync(filePath);
  const encrypted = isEncryptedFile(filePath);

  return {
    path: path.resolve(filePath),
    size: stats.size,
    encrypted,
    extension: path.extname(filePath),
    modified: stats.mtime.toISOString(),
  };
}
