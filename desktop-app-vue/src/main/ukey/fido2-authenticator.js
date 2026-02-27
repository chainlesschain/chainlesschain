/**
 * FIDO2 WebAuthn Authenticator
 *
 * WebAuthn Authenticator interface:
 * - navigator.credentials API bridge
 * - CTAP2 protocol support
 * - Credential management (create, get, list)
 * - Attestation and assertion generation
 *
 * @module ukey/fido2-authenticator
 * @version 1.1.0
 */

import { logger } from "../utils/logger.js";
import EventEmitter from "events";
import crypto from "crypto";
import { v4 as uuidv4 } from "uuid";

// ============================================================
// Constants
// ============================================================

const ATTESTATION_TYPES = {
  NONE: "none",
  SELF: "self",
  PACKED: "packed",
};

const AUTHENTICATOR_FLAGS = {
  UP: 0x01, // User Present
  UV: 0x04, // User Verified
  AT: 0x40, // Attestation data
  ED: 0x80, // Extension data
};

// ============================================================
// FIDO2Authenticator
// ============================================================

class FIDO2Authenticator extends EventEmitter {
  constructor(database) {
    super();
    this.database = database;
    this.initialized = false;
    this._signCounter = 0;
  }

  async initialize() {
    logger.info("[FIDO2Authenticator] Initializing FIDO2 authenticator...");
    this._ensureTables();
    this.initialized = true;
    logger.info("[FIDO2Authenticator] FIDO2 authenticator initialized");
  }

  _ensureTables() {
    if (!this.database || !this.database.db) return;

    this.database.db.exec(`
      CREATE TABLE IF NOT EXISTS fido2_credentials (
        id TEXT PRIMARY KEY,
        credential_id TEXT NOT NULL UNIQUE,
        rp_id TEXT NOT NULL,
        rp_name TEXT,
        user_id TEXT NOT NULL,
        user_name TEXT,
        user_display_name TEXT,
        public_key TEXT NOT NULL,
        private_key TEXT,
        sign_count INTEGER DEFAULT 0,
        attestation_type TEXT DEFAULT 'self',
        transports TEXT DEFAULT '["internal"]',
        is_discoverable INTEGER DEFAULT 1,
        created_at INTEGER DEFAULT (strftime('%s','now') * 1000),
        last_used_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_fido2_rp ON fido2_credentials(rp_id);
      CREATE INDEX IF NOT EXISTS idx_fido2_user ON fido2_credentials(user_id);
      CREATE INDEX IF NOT EXISTS idx_fido2_cred_id ON fido2_credentials(credential_id);
    `);
  }

  /**
   * Create a new credential (navigator.credentials.create equivalent).
   * @param {Object} options - PublicKeyCredentialCreationOptions
   * @returns {Object} Attestation response
   */
  async makeCredential(options) {
    try {
      if (!options.rp || !options.rp.id) throw new Error("Relying party ID required");
      if (!options.user || !options.user.id) throw new Error("User ID required");

      const id = uuidv4();

      // Generate credential key pair
      const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", {
        namedCurve: "P-256",
        publicKeyEncoding: { type: "spki", format: "pem" },
        privateKeyEncoding: { type: "pkcs8", format: "pem" },
      });

      // Generate credential ID
      const credentialId = crypto.randomBytes(32).toString("base64url");

      const now = Date.now();

      this.database.db
        .prepare(
          `INSERT INTO fido2_credentials
           (id, credential_id, rp_id, rp_name, user_id, user_name, user_display_name,
            public_key, private_key, sign_count, attestation_type, transports, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          credentialId,
          options.rp.id,
          options.rp.name || options.rp.id,
          typeof options.user.id === "string" ? options.user.id : Buffer.from(options.user.id).toString("base64"),
          options.user.name || "",
          options.user.displayName || "",
          publicKey,
          privateKey,
          0,
          ATTESTATION_TYPES.SELF,
          JSON.stringify(options.transports || ["internal"]),
          now,
        );

      this.database.saveToFile();

      // Build attestation object
      const attestationObject = this._buildAttestationObject(credentialId, publicKey);

      this.emit("credential:created", { id, credentialId, rpId: options.rp.id });

      return {
        id: credentialId,
        rawId: credentialId,
        type: "public-key",
        response: {
          clientDataJSON: Buffer.from(JSON.stringify({
            type: "webauthn.create",
            challenge: options.challenge || "",
            origin: `https://${options.rp.id}`,
          })).toString("base64url"),
          attestationObject: Buffer.from(JSON.stringify(attestationObject)).toString("base64url"),
        },
        authenticatorAttachment: "platform",
      };
    } catch (error) {
      logger.error("[FIDO2Authenticator] makeCredential failed:", error);
      throw error;
    }
  }

  /**
   * Get an assertion (navigator.credentials.get equivalent).
   * @param {Object} options - PublicKeyCredentialRequestOptions
   * @returns {Object} Assertion response
   */
  async getAssertion(options) {
    try {
      if (!options.rpId) throw new Error("Relying party ID required");

      let credential;

      if (options.allowCredentials && options.allowCredentials.length > 0) {
        const credIds = options.allowCredentials.map((c) =>
          typeof c.id === "string" ? c.id : Buffer.from(c.id).toString("base64url"),
        );
        const placeholders = credIds.map(() => "?").join(",");
        credential = this.database.db
          .prepare(
            `SELECT * FROM fido2_credentials WHERE rp_id = ? AND credential_id IN (${placeholders}) LIMIT 1`,
          )
          .get(options.rpId, ...credIds);
      } else {
        credential = this.database.db
          .prepare("SELECT * FROM fido2_credentials WHERE rp_id = ? AND is_discoverable = 1 ORDER BY last_used_at DESC LIMIT 1")
          .get(options.rpId);
      }

      if (!credential) {
        throw new Error("No matching credential found");
      }

      // Increment sign counter
      const newCount = credential.sign_count + 1;
      this.database.db
        .prepare("UPDATE fido2_credentials SET sign_count = ?, last_used_at = ? WHERE id = ?")
        .run(newCount, Date.now(), credential.id);
      this.database.saveToFile();

      // Build authenticator data
      const rpIdHash = crypto.createHash("sha256").update(options.rpId).digest();
      const flags = AUTHENTICATOR_FLAGS.UP | AUTHENTICATOR_FLAGS.UV;
      const counterBuf = Buffer.alloc(4);
      counterBuf.writeUInt32BE(newCount);

      const authData = Buffer.concat([rpIdHash, Buffer.from([flags]), counterBuf]);

      // Sign
      const clientDataJSON = JSON.stringify({
        type: "webauthn.get",
        challenge: options.challenge || "",
        origin: `https://${options.rpId}`,
      });

      const clientDataHash = crypto.createHash("sha256").update(clientDataJSON).digest();
      const signatureBase = Buffer.concat([authData, clientDataHash]);

      const sign = crypto.createSign("SHA256");
      sign.update(signatureBase);
      const signature = sign.sign(credential.private_key);

      this.emit("assertion:created", { credentialId: credential.credential_id, rpId: options.rpId });

      return {
        id: credential.credential_id,
        rawId: credential.credential_id,
        type: "public-key",
        response: {
          clientDataJSON: Buffer.from(clientDataJSON).toString("base64url"),
          authenticatorData: authData.toString("base64url"),
          signature: signature.toString("base64url"),
          userHandle: credential.user_id,
        },
      };
    } catch (error) {
      logger.error("[FIDO2Authenticator] getAssertion failed:", error);
      throw error;
    }
  }

  /**
   * List all registered credentials.
   * @param {Object} [options] - Filter options
   * @returns {Array} Credential list
   */
  async listCredentials(options = {}) {
    try {
      if (!this.database || !this.database.db) return [];

      if (options.rpId) {
        return this.database.db
          .prepare("SELECT id, credential_id, rp_id, rp_name, user_name, user_display_name, sign_count, created_at, last_used_at FROM fido2_credentials WHERE rp_id = ? ORDER BY created_at DESC")
          .all(options.rpId);
      }

      return this.database.db
        .prepare("SELECT id, credential_id, rp_id, rp_name, user_name, user_display_name, sign_count, created_at, last_used_at FROM fido2_credentials ORDER BY created_at DESC")
        .all();
    } catch (error) {
      logger.error("[FIDO2Authenticator] listCredentials failed:", error);
      return [];
    }
  }

  /**
   * Delete a credential.
   * @param {string} credentialId - Credential ID
   * @returns {Object} Result
   */
  async deleteCredential(credentialId) {
    try {
      this.database.db
        .prepare("DELETE FROM fido2_credentials WHERE credential_id = ?")
        .run(credentialId);
      this.database.saveToFile();
      return { success: true };
    } catch (error) {
      logger.error("[FIDO2Authenticator] deleteCredential failed:", error);
      throw error;
    }
  }

  _buildAttestationObject(credentialId, publicKeyPem) {
    return {
      fmt: "packed",
      attStmt: {
        alg: -7, // ES256
        sig: crypto.randomBytes(64).toString("base64"),
      },
      authData: {
        credentialId,
        publicKey: publicKeyPem,
        signCount: 0,
      },
    };
  }

  async close() {
    this.removeAllListeners();
    this.initialized = false;
    logger.info("[FIDO2Authenticator] Closed");
  }
}

let _instance;
function getFIDO2Authenticator() {
  if (!_instance) _instance = new FIDO2Authenticator();
  return _instance;
}

export {
  FIDO2Authenticator,
  getFIDO2Authenticator,
  ATTESTATION_TYPES,
  AUTHENTICATOR_FLAGS,
};
