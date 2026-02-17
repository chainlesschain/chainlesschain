/**
 * Crypto Toolkit Skill Handler
 *
 * Cryptographic utilities using Node.js built-in crypto module.
 * Actions: --hash, --hash-file, --hmac, --encrypt, --decrypt,
 *          --encode, --decode, --uuid, --random, --compare
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { logger } = require("../../../../../utils/logger.js");

// ── Supported Algorithms ───────────────────────────────────────────

const SUPPORTED_HASH_ALGOS = ["md5", "sha1", "sha256", "sha512"];
const SUPPORTED_ENCODE_FORMATS = ["base64", "hex", "url"];

// ── Argument Helpers ───────────────────────────────────────────────

function extractQuotedOrNextArg(input, flagPattern) {
  const after = input.replace(flagPattern, "").trim();
  // Try quoted string first
  const quotedMatch = after.match(/^["']([^"']+)["']/);
  if (quotedMatch) {
    return quotedMatch[1];
  }
  // Otherwise take until next --flag or end
  const parts = after.split(/\s+--/);
  return (parts[0] || "").trim();
}

function extractFlagValue(input, flag) {
  const pattern = new RegExp("--" + flag + "\\s+([\"']?)([^\"'\\s]+)\\1", "i");
  const match = input.match(pattern);
  return match ? match[2] : null;
}

function resolveFilePath(filePath, projectRoot) {
  if (path.isAbsolute(filePath)) {
    return filePath;
  }
  return path.resolve(projectRoot, filePath);
}

// ── AES-256-GCM Helpers ────────────────────────────────────────────

function deriveKey(password) {
  // Derive a 32-byte key from password using scrypt-like approach with pbkdf2
  return crypto.pbkdf2Sync(
    password,
    "chainlesschain-salt",
    100000,
    32,
    "sha256",
  );
}

function aesEncrypt(plaintext, password) {
  const key = deriveKey(password);
  const iv = crypto.randomBytes(12); // 96-bit IV for GCM
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  let encrypted = cipher.update(plaintext, "utf8", "base64");
  encrypted += cipher.final("base64");
  const authTag = cipher.getAuthTag();
  // Format: iv:authTag:ciphertext (all base64)
  return (
    iv.toString("base64") + ":" + authTag.toString("base64") + ":" + encrypted
  );
}

function aesDecrypt(encryptedStr, password) {
  const parts = encryptedStr.split(":");
  if (parts.length !== 3) {
    throw new Error(
      "Invalid encrypted format. Expected iv:authTag:ciphertext (base64)",
    );
  }
  const iv = Buffer.from(parts[0], "base64");
  const authTag = Buffer.from(parts[1], "base64");
  const ciphertext = parts[2];
  const key = deriveKey(password);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(ciphertext, "base64", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

// ── Handler ────────────────────────────────────────────────────────

module.exports = {
  async init(skill) {
    logger.info(
      `[crypto-toolkit] handler initialized for "${skill?.name || "crypto-toolkit"}"`,
    );
  },

  async execute(task, context, _skill) {
    const input = (
      task?.params?.input ||
      task?.input ||
      task?.action ||
      ""
    ).trim();
    const projectRoot =
      context?.projectRoot ||
      context?.workspaceRoot ||
      context?.workspacePath ||
      process.cwd();

    // No input - show usage
    if (!input) {
      return {
        success: true,
        result: { usage: true },
        message: [
          "Crypto Toolkit",
          "=".repeat(30),
          "Usage:",
          '  /crypto-toolkit --hash "text" [--algo md5|sha1|sha256|sha512]   Hash text',
          "  /crypto-toolkit --hash-file <file> [--algo sha256]              Hash file",
          '  /crypto-toolkit --hmac "text" --key <secret> [--algo sha256]    HMAC signature',
          '  /crypto-toolkit --encrypt "text" --key <password>               AES-256-GCM encrypt',
          "  /crypto-toolkit --decrypt <encrypted> --key <password>          AES-256-GCM decrypt",
          '  /crypto-toolkit --encode "text" --format base64|hex|url         Encode text',
          '  /crypto-toolkit --decode "text" --format base64|hex|url         Decode text',
          "  /crypto-toolkit --uuid                                          Generate UUID v4",
          "  /crypto-toolkit --random <length>                               Random bytes (hex)",
          "  /crypto-toolkit --compare <hash1> <hash2>                       Timing-safe compare",
        ].join("\n"),
      };
    }

    try {
      // ── --hash ─────────────────────────────────────────────
      if (/--hash\b(?!-file)/i.test(input)) {
        const text = extractQuotedOrNextArg(input, /.*--hash\s*/i);
        if (!text) {
          return {
            success: false,
            error: "Missing text to hash",
            message: 'Usage: /crypto-toolkit --hash "text" [--algo sha256]',
          };
        }
        const algo = (
          extractFlagValue(input, "algo") || "sha256"
        ).toLowerCase();
        if (!SUPPORTED_HASH_ALGOS.includes(algo)) {
          return {
            success: false,
            error: "Unsupported algorithm: " + algo,
            message: "Supported algorithms: " + SUPPORTED_HASH_ALGOS.join(", "),
          };
        }
        const hash = crypto.createHash(algo).update(text).digest("hex");
        return {
          success: true,
          result: { algorithm: algo, input: text, hash },
          message: [
            "## Hash Result",
            "Algorithm: " + algo.toUpperCase(),
            "Input: " + text,
            "Hash: `" + hash + "`",
          ].join("\n"),
        };
      }

      // ── --hash-file ────────────────────────────────────────
      if (/--hash-file\b/i.test(input)) {
        const rawPath = extractQuotedOrNextArg(input, /.*--hash-file\s*/i);
        if (!rawPath) {
          return {
            success: false,
            error: "Missing file path",
            message:
              "Usage: /crypto-toolkit --hash-file <file> [--algo sha256]",
          };
        }
        const filePath = resolveFilePath(rawPath, projectRoot);
        if (!fs.existsSync(filePath)) {
          return {
            success: false,
            error: "File not found",
            message: "File not found: " + filePath,
          };
        }
        const algo = (
          extractFlagValue(input, "algo") || "sha256"
        ).toLowerCase();
        if (!SUPPORTED_HASH_ALGOS.includes(algo)) {
          return {
            success: false,
            error: "Unsupported algorithm: " + algo,
            message: "Supported algorithms: " + SUPPORTED_HASH_ALGOS.join(", "),
          };
        }
        const fileBuffer = fs.readFileSync(filePath);
        const hash = crypto.createHash(algo).update(fileBuffer).digest("hex");
        const fileSize = fs.statSync(filePath).size;
        return {
          success: true,
          result: {
            algorithm: algo,
            file: path.basename(filePath),
            size: fileSize,
            hash,
          },
          message: [
            "## File Hash",
            "Algorithm: " + algo.toUpperCase(),
            "File: " + path.basename(filePath) + " (" + fileSize + " bytes)",
            "Hash: `" + hash + "`",
          ].join("\n"),
        };
      }

      // ── --hmac ─────────────────────────────────────────────
      if (/--hmac\b/i.test(input)) {
        const text = extractQuotedOrNextArg(input, /.*--hmac\s*/i);
        const key = extractFlagValue(input, "key");
        if (!text) {
          return {
            success: false,
            error: "Missing text for HMAC",
            message:
              'Usage: /crypto-toolkit --hmac "text" --key <secret> [--algo sha256]',
          };
        }
        if (!key) {
          return {
            success: false,
            error: "Missing --key for HMAC",
            message:
              'Usage: /crypto-toolkit --hmac "text" --key <secret> [--algo sha256]',
          };
        }
        const algo = (
          extractFlagValue(input, "algo") || "sha256"
        ).toLowerCase();
        if (!SUPPORTED_HASH_ALGOS.includes(algo)) {
          return {
            success: false,
            error: "Unsupported algorithm: " + algo,
            message: "Supported algorithms: " + SUPPORTED_HASH_ALGOS.join(", "),
          };
        }
        const hmac = crypto.createHmac(algo, key).update(text).digest("hex");
        return {
          success: true,
          result: { algorithm: algo, input: text, hmac },
          message: [
            "## HMAC Result",
            "Algorithm: HMAC-" + algo.toUpperCase(),
            "Input: " + text,
            "HMAC: `" + hmac + "`",
          ].join("\n"),
        };
      }

      // ── --encrypt ──────────────────────────────────────────
      if (/--encrypt\b/i.test(input)) {
        const text = extractQuotedOrNextArg(input, /.*--encrypt\s*/i);
        const key = extractFlagValue(input, "key");
        if (!text) {
          return {
            success: false,
            error: "Missing text to encrypt",
            message: 'Usage: /crypto-toolkit --encrypt "text" --key <password>',
          };
        }
        if (!key) {
          return {
            success: false,
            error: "Missing --key (password) for encryption",
            message: 'Usage: /crypto-toolkit --encrypt "text" --key <password>',
          };
        }
        const encrypted = aesEncrypt(text, key);
        return {
          success: true,
          result: { algorithm: "AES-256-GCM", encrypted },
          message: [
            "## Encrypted",
            "Algorithm: AES-256-GCM",
            "Format: iv:authTag:ciphertext (base64)",
            "Result: `" + encrypted + "`",
          ].join("\n"),
        };
      }

      // ── --decrypt ──────────────────────────────────────────
      if (/--decrypt\b/i.test(input)) {
        const encryptedStr = extractQuotedOrNextArg(input, /.*--decrypt\s*/i);
        const key = extractFlagValue(input, "key");
        if (!encryptedStr) {
          return {
            success: false,
            error: "Missing encrypted text",
            message:
              "Usage: /crypto-toolkit --decrypt <encrypted> --key <password>",
          };
        }
        if (!key) {
          return {
            success: false,
            error: "Missing --key (password) for decryption",
            message:
              "Usage: /crypto-toolkit --decrypt <encrypted> --key <password>",
          };
        }
        try {
          const decrypted = aesDecrypt(encryptedStr, key);
          return {
            success: true,
            result: { algorithm: "AES-256-GCM", decrypted },
            message: [
              "## Decrypted",
              "Algorithm: AES-256-GCM",
              "Result: " + decrypted,
            ].join("\n"),
          };
        } catch (decErr) {
          return {
            success: false,
            error: "Decryption failed: " + decErr.message,
            message:
              "Decryption failed. Check that the key and encrypted data are correct.",
          };
        }
      }

      // ── --encode ───────────────────────────────────────────
      if (/--encode\b/i.test(input)) {
        const text = extractQuotedOrNextArg(input, /.*--encode\s*/i);
        const format = (
          extractFlagValue(input, "format") || "base64"
        ).toLowerCase();
        if (!text) {
          return {
            success: false,
            error: "Missing text to encode",
            message:
              'Usage: /crypto-toolkit --encode "text" --format base64|hex|url',
          };
        }
        if (!SUPPORTED_ENCODE_FORMATS.includes(format)) {
          return {
            success: false,
            error: "Unsupported format: " + format,
            message:
              "Supported formats: " + SUPPORTED_ENCODE_FORMATS.join(", "),
          };
        }
        let encoded;
        if (format === "base64") {
          encoded = Buffer.from(text, "utf8").toString("base64");
        } else if (format === "hex") {
          encoded = Buffer.from(text, "utf8").toString("hex");
        } else {
          encoded = encodeURIComponent(text);
        }
        return {
          success: true,
          result: { format, input: text, encoded },
          message: [
            "## Encoded",
            "Format: " + format.toUpperCase(),
            "Input: " + text,
            "Encoded: `" + encoded + "`",
          ].join("\n"),
        };
      }

      // ── --decode ───────────────────────────────────────────
      if (/--decode\b/i.test(input)) {
        const text = extractQuotedOrNextArg(input, /.*--decode\s*/i);
        const format = (
          extractFlagValue(input, "format") || "base64"
        ).toLowerCase();
        if (!text) {
          return {
            success: false,
            error: "Missing text to decode",
            message:
              'Usage: /crypto-toolkit --decode "text" --format base64|hex|url',
          };
        }
        if (!SUPPORTED_ENCODE_FORMATS.includes(format)) {
          return {
            success: false,
            error: "Unsupported format: " + format,
            message:
              "Supported formats: " + SUPPORTED_ENCODE_FORMATS.join(", "),
          };
        }
        let decoded;
        try {
          if (format === "base64") {
            decoded = Buffer.from(text, "base64").toString("utf8");
          } else if (format === "hex") {
            decoded = Buffer.from(text, "hex").toString("utf8");
          } else {
            decoded = decodeURIComponent(text);
          }
        } catch (decodeErr) {
          return {
            success: false,
            error: "Decode failed: " + decodeErr.message,
            message:
              "Failed to decode input as " +
              format.toUpperCase() +
              ": " +
              decodeErr.message,
          };
        }
        return {
          success: true,
          result: { format, input: text, decoded },
          message: [
            "## Decoded",
            "Format: " + format.toUpperCase(),
            "Input: " + text,
            "Decoded: " + decoded,
          ].join("\n"),
        };
      }

      // ── --uuid ─────────────────────────────────────────────
      if (/--uuid\b/i.test(input)) {
        const uuid = crypto.randomUUID();
        return {
          success: true,
          result: { uuid },
          message: ["## UUID v4", "Generated: `" + uuid + "`"].join("\n"),
        };
      }

      // ── --random ───────────────────────────────────────────
      if (/--random\b/i.test(input)) {
        const lengthStr = extractQuotedOrNextArg(input, /.*--random\s*/i);
        const length = parseInt(lengthStr, 10);
        if (isNaN(length) || length < 1) {
          return {
            success: false,
            error: "Invalid length",
            message:
              "Usage: /crypto-toolkit --random <length> (positive integer, bytes)",
          };
        }
        if (length > 1024) {
          return {
            success: false,
            error: "Length too large",
            message: "Maximum random length is 1024 bytes.",
          };
        }
        const randomHex = crypto.randomBytes(length).toString("hex");
        return {
          success: true,
          result: { bytes: length, hex: randomHex },
          message: [
            "## Random Bytes",
            "Length: " + length + " bytes (" + length * 2 + " hex chars)",
            "Hex: `" + randomHex + "`",
          ].join("\n"),
        };
      }

      // ── --compare ──────────────────────────────────────────
      if (/--compare\b/i.test(input)) {
        const afterCompare = input.replace(/.*--compare\s*/i, "").trim();
        const parts = afterCompare.split(/\s+/);
        const hashes = [];
        for (const p of parts) {
          if (p.startsWith("--")) {
            break;
          }
          hashes.push(p);
        }
        if (hashes.length < 2) {
          return {
            success: false,
            error: "Two hashes required",
            message: "Usage: /crypto-toolkit --compare <hash1> <hash2>",
          };
        }
        const hash1 = hashes[0];
        const hash2 = hashes[1];
        let equal;
        try {
          const buf1 = Buffer.from(hash1, "hex");
          const buf2 = Buffer.from(hash2, "hex");
          if (buf1.length !== buf2.length) {
            equal = false;
          } else {
            equal = crypto.timingSafeEqual(buf1, buf2);
          }
        } catch {
          // Fallback: compare as strings with timing-safe approach
          const buf1 = Buffer.from(hash1, "utf8");
          const buf2 = Buffer.from(hash2, "utf8");
          if (buf1.length !== buf2.length) {
            equal = false;
          } else {
            equal = crypto.timingSafeEqual(buf1, buf2);
          }
        }
        return {
          success: true,
          result: { hash1, hash2, equal },
          message: [
            "## Hash Comparison (timing-safe)",
            "Hash 1: `" + hash1 + "`",
            "Hash 2: `" + hash2 + "`",
            "Equal: " + (equal ? "YES" : "NO"),
          ].join("\n"),
        };
      }

      // ── Unknown command ────────────────────────────────────
      return {
        success: false,
        error: "Unknown command",
        message:
          "Unrecognized command: " +
          input +
          "\nRun /crypto-toolkit without arguments to see usage.",
      };
    } catch (err) {
      logger.error("[crypto-toolkit] Error:", err);
      return {
        success: false,
        error: err.message,
        message: "Crypto operation failed: " + err.message,
      };
    }
  },
};
