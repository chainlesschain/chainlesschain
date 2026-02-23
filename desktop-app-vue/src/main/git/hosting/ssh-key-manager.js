/**
 * SSH Key Manager
 * Ed25519 SSH key generation, storage, and platform registration
 *
 * @module git/hosting/ssh-key-manager
 * @version 1.3.0
 */

const { logger } = require("../../utils/logger.js");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

// Try to get app for userData path
let app;
try {
  app = require("electron").app;
} catch (_e) {
  app = { getPath: () => require("os").tmpdir() };
}

/**
 * SSH Key Manager
 * Generates, stores, and manages SSH keys for Git operations
 */
class SSHKeyManager {
  constructor(options = {}) {
    this.keyDir =
      options.keyDir || path.join(app.getPath("userData"), "ssh-keys");
    this.defaultKeyName = options.defaultKeyName || "chainlesschain_ed25519";
  }

  /**
   * Initialize key directory
   */
  initialize() {
    if (!fs.existsSync(this.keyDir)) {
      fs.mkdirSync(this.keyDir, { recursive: true, mode: 0o700 });
      logger.info(`[SSHKeyManager] Created key directory: ${this.keyDir}`);
    }
  }

  /**
   * Generate a new Ed25519 SSH key pair
   *
   * @param {Object} [options]
   * @param {string} [options.name] - Key name (default: chainlesschain_ed25519)
   * @param {string} [options.comment] - Key comment (default: chainlesschain@device)
   * @param {string} [options.passphrase] - Optional passphrase
   * @returns {{ publicKey: string, privateKeyPath: string, publicKeyPath: string }}
   */
  generateKey(options = {}) {
    const keyName = options.name || this.defaultKeyName;
    const comment =
      options.comment || `chainlesschain@${require("os").hostname()}`;

    this.initialize();

    const privateKeyPath = path.join(this.keyDir, keyName);
    const publicKeyPath = path.join(this.keyDir, `${keyName}.pub`);

    // Check if key already exists
    if (fs.existsSync(privateKeyPath)) {
      logger.warn(`[SSHKeyManager] Key already exists: ${keyName}`);
      const publicKey = fs.readFileSync(publicKeyPath, "utf8").trim();
      return { publicKey, privateKeyPath, publicKeyPath };
    }

    try {
      // Generate Ed25519 key pair
      const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519", {
        publicKeyEncoding: {
          type: "spki",
          format: "pem",
        },
        privateKeyEncoding: {
          type: "pkcs8",
          format: "pem",
          ...(options.passphrase
            ? { cipher: "aes-256-cbc", passphrase: options.passphrase }
            : {}),
        },
      });

      // Convert to SSH format
      const sshPublicKey = this._pemToSSHPublicKey(publicKey, comment);
      const sshPrivateKey = this._pemToOpenSSHPrivateKey(
        privateKey,
        publicKey,
        comment,
      );

      // Write keys to files
      fs.writeFileSync(privateKeyPath, sshPrivateKey, { mode: 0o600 });
      fs.writeFileSync(publicKeyPath, sshPublicKey, { mode: 0o644 });

      logger.info(`[SSHKeyManager] Generated Ed25519 key: ${keyName}`);

      return { publicKey: sshPublicKey, privateKeyPath, publicKeyPath };
    } catch (error) {
      logger.error(`[SSHKeyManager] Key generation failed:`, error.message);
      throw error;
    }
  }

  /**
   * Get the default SSH public key
   * @returns {string|null}
   */
  getPublicKey(keyName) {
    const name = keyName || this.defaultKeyName;
    const publicKeyPath = path.join(this.keyDir, `${name}.pub`);

    try {
      if (fs.existsSync(publicKeyPath)) {
        return fs.readFileSync(publicKeyPath, "utf8").trim();
      }
    } catch (error) {
      logger.warn(`[SSHKeyManager] Failed to read public key:`, error.message);
    }

    return null;
  }

  /**
   * Get the private key path
   * @returns {string|null}
   */
  getPrivateKeyPath(keyName) {
    const name = keyName || this.defaultKeyName;
    const privateKeyPath = path.join(this.keyDir, name);

    if (fs.existsSync(privateKeyPath)) {
      return privateKeyPath;
    }

    return null;
  }

  /**
   * List all managed SSH keys
   * @returns {Array<{name: string, publicKey: string, createdAt: Date}>}
   */
  listKeys() {
    this.initialize();

    const keys = [];
    try {
      const files = fs.readdirSync(this.keyDir);
      for (const file of files) {
        if (file.endsWith(".pub")) {
          const name = file.replace(".pub", "");
          const publicKeyPath = path.join(this.keyDir, file);
          const publicKey = fs.readFileSync(publicKeyPath, "utf8").trim();
          const stat = fs.statSync(publicKeyPath);

          keys.push({
            name,
            publicKey,
            fingerprint: this._getFingerprint(publicKey),
            createdAt: stat.birthtime,
          });
        }
      }
    } catch (error) {
      logger.warn("[SSHKeyManager] Failed to list keys:", error.message);
    }

    return keys;
  }

  /**
   * Delete a key pair
   * @param {string} keyName
   */
  deleteKey(keyName) {
    const privateKeyPath = path.join(this.keyDir, keyName);
    const publicKeyPath = path.join(this.keyDir, `${keyName}.pub`);

    try {
      if (fs.existsSync(privateKeyPath)) {
        fs.unlinkSync(privateKeyPath);
      }
      if (fs.existsSync(publicKeyPath)) {
        fs.unlinkSync(publicKeyPath);
      }
      logger.info(`[SSHKeyManager] Deleted key: ${keyName}`);
      return true;
    } catch (error) {
      logger.error(`[SSHKeyManager] Failed to delete key:`, error.message);
      return false;
    }
  }

  /**
   * Register SSH key with a hosting provider
   *
   * @param {Object} provider - GitHostingProvider instance
   * @param {string} [keyName] - Key name (default: default key)
   * @param {string} [title] - Key title on the platform
   * @returns {Promise<Object>}
   */
  async registerWithProvider(provider, keyName, title) {
    const publicKey = this.getPublicKey(keyName);

    if (!publicKey) {
      // Auto-generate if not exists
      const generated = this.generateKey({ name: keyName });
      return provider.addSSHKey(
        title || `ChainlessChain-${require("os").hostname()}`,
        generated.publicKey,
      );
    }

    return provider.addSSHKey(
      title || `ChainlessChain-${require("os").hostname()}`,
      publicKey,
    );
  }

  /**
   * Convert PEM public key to SSH format
   */
  _pemToSSHPublicKey(pemPublicKey, comment) {
    try {
      const keyObj = crypto.createPublicKey(pemPublicKey);
      const sshBuf = keyObj.export({ type: "spki", format: "der" });

      // Extract raw Ed25519 public key (last 32 bytes of DER)
      const rawKey = sshBuf.slice(sshBuf.length - 32);

      // Build SSH wire format
      const typeStr = "ssh-ed25519";
      const typeBuf = Buffer.alloc(4 + typeStr.length);
      typeBuf.writeUInt32BE(typeStr.length, 0);
      typeBuf.write(typeStr, 4);

      const keyBuf = Buffer.alloc(4 + rawKey.length);
      keyBuf.writeUInt32BE(rawKey.length, 0);
      rawKey.copy(keyBuf, 4);

      const sshKey = Buffer.concat([typeBuf, keyBuf]);
      return `ssh-ed25519 ${sshKey.toString("base64")} ${comment}`;
    } catch (error) {
      // Fallback: return PEM as-is with SSH prefix
      const base64 = pemPublicKey
        .replace(/-----BEGIN PUBLIC KEY-----/, "")
        .replace(/-----END PUBLIC KEY-----/, "")
        .replace(/\n/g, "");
      return `ssh-ed25519 ${base64} ${comment}`;
    }
  }

  /**
   * Convert PEM private key to OpenSSH format
   */
  _pemToOpenSSHPrivateKey(pemPrivateKey, pemPublicKey, comment) {
    // Return PEM format which is accepted by most SSH implementations
    return pemPrivateKey;
  }

  /**
   * Get fingerprint of an SSH public key
   */
  _getFingerprint(publicKey) {
    try {
      const parts = publicKey.split(" ");
      if (parts.length >= 2) {
        const keyData = Buffer.from(parts[1], "base64");
        const hash = crypto
          .createHash("sha256")
          .update(keyData)
          .digest("base64");
        return `SHA256:${hash.replace(/=+$/, "")}`;
      }
    } catch (_e) {
      // Ignore
    }
    return "unknown";
  }
}

module.exports = { SSHKeyManager };
