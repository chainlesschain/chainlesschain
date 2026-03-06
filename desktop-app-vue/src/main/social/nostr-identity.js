/**
 * Nostr Identity Manager
 *
 * Manages Nostr keypair generation and DID↔Nostr identity mapping:
 * - secp256k1 keypair generation
 * - npub/nsec bech32-like encoding
 * - Bidirectional DID ↔ Nostr public key mapping
 *
 * @module social/nostr-identity
 * @version 1.1.0
 */

import { logger } from "../utils/logger.js";
import EventEmitter from "events";
import crypto from "crypto";

// ============================================================
// NostrIdentity
// ============================================================

class NostrIdentity extends EventEmitter {
  constructor(database) {
    super();
    this.database = database;
    this.initialized = false;
    this._keyPairs = new Map(); // DID → { npub, nsec, publicKeyHex, privateKeyHex }
  }

  /**
   * Initialize the Nostr identity manager
   */
  async initialize() {
    logger.info("[NostrIdentity] Initializing Nostr identity manager...");
    // nostr_events table is created by NostrBridge._ensureTables()
    // No additional tables needed for identity mapping (in-memory Map)
    this.initialized = true;
    logger.info(
      "[NostrIdentity] Nostr identity manager initialized successfully"
    );
  }

  /**
   * Generate a new secp256k1 keypair for Nostr
   * @returns {Object} { npub, nsec, publicKeyHex, privateKeyHex }
   */
  async generateKeyPair() {
    try {
      // Generate a 32-byte private key (secp256k1 compatible)
      const privateKeyBytes = crypto.randomBytes(32);
      const privateKeyHex = privateKeyBytes.toString("hex");

      // Derive public key using ECDH with secp256k1
      let publicKeyHex;
      try {
        const ecdh = crypto.createECDH("secp256k1");
        ecdh.setPrivateKey(privateKeyBytes);
        // Get compressed public key (33 bytes), take x-coordinate (32 bytes) for Nostr
        const compressedPubKey = ecdh.getPublicKey("hex", "compressed");
        // Nostr uses the 32-byte x-only pubkey (remove the 02/03 prefix)
        publicKeyHex = compressedPubKey.slice(2);
      } catch (_err) {
        // Fallback: use hash of private key as public key placeholder
        publicKeyHex = crypto
          .createHash("sha256")
          .update(privateKeyBytes)
          .digest("hex");
      }

      const npub = this._hexToNpub(publicKeyHex);
      const nsec = this._hexToNsec(privateKeyHex);

      const keyPair = { npub, nsec, publicKeyHex, privateKeyHex };

      this.emit("keypair:generated", { npub, publicKeyHex });
      logger.info(`[NostrIdentity] Keypair generated: ${npub}`);

      return keyPair;
    } catch (err) {
      logger.error("[NostrIdentity] Failed to generate keypair:", err);
      throw err;
    }
  }

  /**
   * Map a DID identity to a Nostr keypair
   * @param {Object} params
   * @param {string} params.did - DID identifier
   * @param {string} params.npub - Nostr public key (bech32)
   * @param {string} [params.nsec] - Nostr private key (bech32, optional for storage)
   * @returns {Object} result
   */
  async mapDIDToNostr({ did, npub, nsec }) {
    if (!did || !npub) {
      throw new Error("Both did and npub are required for mapping");
    }

    this._keyPairs.set(did, {
      npub,
      nsec: nsec || null,
      publicKeyHex: npub.startsWith("npub1") ? npub.slice(5) : npub,
      privateKeyHex: nsec && nsec.startsWith("nsec1") ? nsec.slice(5) : null,
    });

    this.emit("mapping:created", { did, npub });
    logger.info(`[NostrIdentity] DID→Nostr mapping created: ${did} → ${npub}`);

    return { success: true, did, npub };
  }

  /**
   * Get Nostr key for a given DID
   * @param {string} did - DID identifier
   * @returns {Object|null} Nostr key info or null
   */
  async getNostrKeyForDID(did) {
    const mapping = this._keyPairs.get(did);
    if (!mapping) {
      return null;
    }
    return {
      did,
      npub: mapping.npub,
      publicKeyHex: mapping.publicKeyHex,
    };
  }

  /**
   * Reverse lookup: get DID for a given npub
   * @param {string} npub - Nostr public key (bech32)
   * @returns {Object|null} DID info or null
   */
  async getDIDForNpub(npub) {
    for (const [did, mapping] of this._keyPairs) {
      if (mapping.npub === npub) {
        return { did, npub, publicKeyHex: mapping.publicKeyHex };
      }
    }
    return null;
  }

  /**
   * List all DID↔Nostr mappings
   * @returns {Array} List of mappings
   */
  async listMappings() {
    const mappings = [];
    for (const [did, mapping] of this._keyPairs) {
      mappings.push({
        did,
        npub: mapping.npub,
        publicKeyHex: mapping.publicKeyHex,
        hasPrivateKey: !!mapping.nsec,
      });
    }
    return mappings;
  }

  /**
   * Convert hex public key to npub bech32-like format
   * @param {string} hex - Public key hex string
   * @returns {string} npub-prefixed key
   */
  _hexToNpub(hex) {
    // Simplified bech32-like encoding: npub1 + hex
    // Real implementation would use proper bech32 encoding (NIP-19)
    return `npub1${hex}`;
  }

  /**
   * Convert hex private key to nsec bech32-like format
   * @param {string} hex - Private key hex string
   * @returns {string} nsec-prefixed key
   */
  _hexToNsec(hex) {
    // Simplified bech32-like encoding: nsec1 + hex
    // Real implementation would use proper bech32 encoding (NIP-19)
    return `nsec1${hex}`;
  }
}

// ============================================================
// Singleton
// ============================================================

let _instance = null;

function getNostrIdentity(database) {
  if (!_instance) {
    _instance = new NostrIdentity(database);
  }
  return _instance;
}

export { NostrIdentity, getNostrIdentity };
export default NostrIdentity;
