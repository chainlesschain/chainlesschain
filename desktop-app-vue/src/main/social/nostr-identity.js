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
import {
  generatePrivateKey as _genPriv,
  getPublicKey as _getPub,
  npubEncode as _npubEncode,
  nsecEncode as _nsecEncode,
  npubDecode as _npubDecode,
  nsecDecode as _nsecDecode,
} from "@chainlesschain/session-core/nostr-crypto";

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
      "[NostrIdentity] Nostr identity manager initialized successfully",
    );
  }

  /**
   * Generate a new BIP-340 keypair for Nostr (schnorr-compatible).
   * @returns {Object} { npub, nsec, publicKeyHex, privateKeyHex }
   */
  async generateKeyPair() {
    try {
      const privateKeyHex = _genPriv();
      const publicKeyHex = _getPub(privateKeyHex);
      const npub = _npubEncode(publicKeyHex);
      const nsec = _nsecEncode(privateKeyHex);

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

    let publicKeyHex = npub;
    let privateKeyHex = null;
    if (npub.startsWith("npub1")) {
      publicKeyHex = _npubDecode(npub);
    }
    if (nsec && nsec.startsWith("nsec1")) {
      privateKeyHex = _nsecDecode(nsec);
    } else if (nsec) {
      privateKeyHex = nsec;
    }

    this._keyPairs.set(did, {
      npub,
      nsec: nsec || null,
      publicKeyHex,
      privateKeyHex,
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
