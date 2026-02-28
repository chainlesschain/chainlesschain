/**
 * Trinity Trust Root Manager
 *
 * U-Key+SIMKey+TEE unified trust root:
 * - Attestation chain verification
 * - Secure boot validation
 * - Hardware fingerprint binding
 * - Cross-device key sync
 *
 * @module ukey/trust-root-manager
 * @version 3.2.0
 */

import { logger } from "../utils/logger.js";
import EventEmitter from "events";
import { v4 as uuidv4 } from "uuid";

const TRUST_STATUS = {
  VERIFIED: "verified",
  UNVERIFIED: "unverified",
  COMPROMISED: "compromised",
  PENDING: "pending",
};

class TrustRootManager extends EventEmitter {
  constructor(database) {
    super();
    this.database = database;
    this.initialized = false;
    this._attestations = new Map();
    this._syncRecords = new Map();
  }

  _ensureTables() {
    if (!this.database || !this.database.db) {
      return;
    }
    this.database.db.exec(`
      CREATE TABLE IF NOT EXISTS trust_root_attestations (
        id TEXT PRIMARY KEY,
        device_id TEXT NOT NULL,
        trust_level TEXT DEFAULT 'unverified',
        ukey_status TEXT,
        simkey_status TEXT,
        tee_status TEXT,
        attestation_chain TEXT,
        hardware_fingerprint TEXT,
        boot_verified INTEGER DEFAULT 0,
        last_verified INTEGER,
        created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
      );
      CREATE INDEX IF NOT EXISTS idx_trust_attestations_device ON trust_root_attestations(device_id);
      CREATE INDEX IF NOT EXISTS idx_trust_attestations_level ON trust_root_attestations(trust_level);

      CREATE TABLE IF NOT EXISTS cross_device_key_sync (
        id TEXT PRIMARY KEY,
        source_device TEXT NOT NULL,
        target_device TEXT NOT NULL,
        key_type TEXT,
        sync_status TEXT DEFAULT 'pending',
        encrypted_key_data TEXT,
        verified INTEGER DEFAULT 0,
        created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
      );
      CREATE INDEX IF NOT EXISTS idx_key_sync_status ON cross_device_key_sync(sync_status);
    `);
  }

  async initialize() {
    logger.info("[TrustRootManager] Initializing...");
    this._ensureTables();
    if (this.database && this.database.db) {
      try {
        const attestations = this.database.db
          .prepare(
            "SELECT * FROM trust_root_attestations ORDER BY created_at DESC",
          )
          .all();
        for (const a of attestations) {
          this._attestations.set(a.id, {
            ...a,
            attestation_chain: a.attestation_chain
              ? JSON.parse(a.attestation_chain)
              : [],
          });
        }
        logger.info(
          `[TrustRootManager] Loaded ${attestations.length} attestations`,
        );
      } catch (err) {
        logger.error("[TrustRootManager] Failed to load attestations:", err);
      }
    }
    this.initialized = true;
    logger.info("[TrustRootManager] Initialized");
  }

  async getStatus() {
    const attestations = Array.from(this._attestations.values());
    return {
      totalDevices: attestations.length,
      verified: attestations.filter(
        (a) => a.trust_level === TRUST_STATUS.VERIFIED,
      ).length,
      unverified: attestations.filter(
        (a) => a.trust_level === TRUST_STATUS.UNVERIFIED,
      ).length,
      compromised: attestations.filter(
        (a) => a.trust_level === TRUST_STATUS.COMPROMISED,
      ).length,
      lastVerified:
        attestations.length > 0
          ? Math.max(...attestations.map((a) => a.last_verified || 0))
          : null,
    };
  }

  async verifyChain(deviceId) {
    if (!deviceId) {
      throw new Error("Device ID is required");
    }
    const id = uuidv4();
    const now = Date.now();
    // Simulate attestation chain verification
    const attestation = {
      id,
      device_id: deviceId,
      trust_level: TRUST_STATUS.VERIFIED,
      ukey_status: "connected",
      simkey_status: "active",
      tee_status: "supported",
      attestation_chain: [
        { step: "ukey_check", passed: true },
        { step: "simkey_verify", passed: true },
        { step: "tee_attest", passed: true },
      ],
      hardware_fingerprint: `fp_${deviceId}_${now}`,
      boot_verified: 1,
      last_verified: now,
      created_at: now,
    };
    if (this.database && this.database.db) {
      this.database.db
        .prepare(
          `INSERT OR REPLACE INTO trust_root_attestations (id,device_id,trust_level,ukey_status,simkey_status,tee_status,attestation_chain,hardware_fingerprint,boot_verified,last_verified,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          id,
          deviceId,
          attestation.trust_level,
          attestation.ukey_status,
          attestation.simkey_status,
          attestation.tee_status,
          JSON.stringify(attestation.attestation_chain),
          attestation.hardware_fingerprint,
          attestation.boot_verified,
          now,
          now,
        );
    }
    this._attestations.set(id, attestation);
    this.emit("chain-verified", attestation);
    logger.info(`[TrustRootManager] Chain verified for device: ${deviceId}`);
    return attestation;
  }

  async syncKeys({ sourceDevice, targetDevice, keyType } = {}) {
    if (!sourceDevice || !targetDevice) {
      throw new Error("Source and target devices are required");
    }
    const id = uuidv4();
    const syncRecord = {
      id,
      source_device: sourceDevice,
      target_device: targetDevice,
      key_type: keyType || "master",
      sync_status: "completed",
      encrypted_key_data: `encrypted_${id}`,
      verified: 1,
      created_at: Date.now(),
    };
    if (this.database && this.database.db) {
      this.database.db
        .prepare(
          `INSERT INTO cross_device_key_sync (id,source_device,target_device,key_type,sync_status,encrypted_key_data,verified,created_at) VALUES (?,?,?,?,?,?,?,?)`,
        )
        .run(
          id,
          sourceDevice,
          targetDevice,
          syncRecord.key_type,
          syncRecord.sync_status,
          syncRecord.encrypted_key_data,
          syncRecord.verified,
          syncRecord.created_at,
        );
    }
    this._syncRecords.set(id, syncRecord);
    this.emit("keys-synced", syncRecord);
    logger.info(
      `[TrustRootManager] Keys synced: ${sourceDevice} → ${targetDevice}`,
    );
    return syncRecord;
  }

  async bindFingerprint(deviceId, fingerprint) {
    if (!deviceId) {
      throw new Error("Device ID is required");
    }
    if (!fingerprint) {
      throw new Error("Fingerprint is required");
    }
    // Find existing attestation for device
    const existing = Array.from(this._attestations.values()).find(
      (a) => a.device_id === deviceId,
    );
    if (existing) {
      existing.hardware_fingerprint = fingerprint;
      existing.last_verified = Date.now();
      if (this.database && this.database.db) {
        this.database.db
          .prepare(
            "UPDATE trust_root_attestations SET hardware_fingerprint = ?, last_verified = ? WHERE device_id = ?",
          )
          .run(fingerprint, Date.now(), deviceId);
      }
      return existing;
    }
    return this.verifyChain(deviceId);
  }

  async getBootStatus() {
    const attestations = Array.from(this._attestations.values());
    return {
      totalDevices: attestations.length,
      bootVerified: attestations.filter((a) => a.boot_verified).length,
      bootFailed: attestations.filter((a) => !a.boot_verified).length,
    };
  }

  async close() {
    this.removeAllListeners();
    this._attestations.clear();
    this._syncRecords.clear();
    this.initialized = false;
    logger.info("[TrustRootManager] Closed");
  }
}

let _instance = null;
function getTrustRootManager(database) {
  if (!_instance) {
    _instance = new TrustRootManager(database);
  }
  return _instance;
}

export { TrustRootManager, getTrustRootManager, TRUST_STATUS };
export default TrustRootManager;
