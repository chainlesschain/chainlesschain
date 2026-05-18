/**
 * HSM Adapter Manager
 * Unified HSM interface for Yubikey/Ledger/Trezor
 * @module ukey/hsm-adapter-manager
 * @version 3.2.0
 */
import { logger } from "../utils/logger.js";
import EventEmitter from "events";
import { v4 as uuidv4 } from "uuid";

const HSM_VENDOR = {
  YUBIKEY: "yubikey",
  LEDGER: "ledger",
  TREZOR: "trezor",
  GENERIC: "generic",
};

class HsmAdapterManager extends EventEmitter {
  constructor(database) {
    super();
    this.database = database;
    this.initialized = false;
    this._adapters = new Map();
  }

  _ensureTables() {
    if (!this.database || !this.database.db) {
      return;
    }
    this.database.db.exec(`
      CREATE TABLE IF NOT EXISTS hsm_adapters (
        id TEXT PRIMARY KEY,
        vendor TEXT NOT NULL,
        model TEXT,
        serial_number TEXT,
        firmware_version TEXT,
        status TEXT DEFAULT 'disconnected',
        fips_compliant INTEGER DEFAULT 0,
        supported_algorithms TEXT,
        last_connected INTEGER,
        created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
      );
      CREATE INDEX IF NOT EXISTS idx_hsm_adapters_vendor ON hsm_adapters(vendor);
      CREATE INDEX IF NOT EXISTS idx_hsm_adapters_status ON hsm_adapters(status);
    `);
  }

  async initialize() {
    logger.info("[HsmAdapterManager] Initializing...");
    this._ensureTables();
    if (this.database && this.database.db) {
      try {
        const adapters = this.database.db
          .prepare("SELECT * FROM hsm_adapters ORDER BY created_at DESC")
          .all();
        for (const a of adapters) {
          this._adapters.set(a.id, {
            ...a,
            supported_algorithms: a.supported_algorithms
              ? JSON.parse(a.supported_algorithms)
              : [],
          });
        }
        logger.info(`[HsmAdapterManager] Loaded ${adapters.length} adapters`);
      } catch (err) {
        logger.error("[HsmAdapterManager] Failed to load:", err);
      }
    }
    this.initialized = true;
    logger.info("[HsmAdapterManager] Initialized");
  }

  async listAdapters(filter = {}) {
    let adapters = Array.from(this._adapters.values());
    if (filter.vendor) {
      adapters = adapters.filter((a) => a.vendor === filter.vendor);
    }
    if (filter.status) {
      adapters = adapters.filter((a) => a.status === filter.status);
    }
    return adapters.slice(0, filter.limit || 50);
  }

  async connectDevice({
    vendor,
    model,
    serialNumber,
    firmwareVersion,
    supportedAlgorithms,
  } = {}) {
    if (!vendor) {
      throw new Error("Vendor is required");
    }
    const id = uuidv4();
    const now = Date.now();
    const adapter = {
      id,
      vendor,
      model: model || "unknown",
      serial_number: serialNumber || `SN_${id.slice(0, 8)}`,
      firmware_version: firmwareVersion || "1.0.0",
      status: "connected",
      fips_compliant: vendor === HSM_VENDOR.YUBIKEY ? 1 : 0,
      supported_algorithms: supportedAlgorithms || [
        "RSA-2048",
        "ECDSA-P256",
        "ML-KEM-768",
      ],
      last_connected: now,
      created_at: now,
    };
    if (this.database && this.database.db) {
      this.database.db
        .prepare(
          `INSERT INTO hsm_adapters (id,vendor,model,serial_number,firmware_version,status,fips_compliant,supported_algorithms,last_connected,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          id,
          vendor,
          adapter.model,
          adapter.serial_number,
          adapter.firmware_version,
          adapter.status,
          adapter.fips_compliant,
          JSON.stringify(adapter.supported_algorithms),
          now,
          now,
        );
    }
    this._adapters.set(id, adapter);
    this.emit("device-connected", adapter);
    logger.info(
      `[HsmAdapterManager] Device connected: ${vendor} ${adapter.model}`,
    );
    return adapter;
  }

  async executeOperation({ adapterId, operation, _params } = {}) {
    if (!adapterId) {
      throw new Error("Adapter ID is required");
    }
    if (!operation) {
      throw new Error("Operation is required");
    }
    const adapter = this._adapters.get(adapterId);
    if (!adapter) {
      throw new Error(`Adapter not found: ${adapterId}`);
    }
    if (adapter.status !== "connected") {
      throw new Error("Adapter is not connected");
    }
    logger.info(
      `[HsmAdapterManager] Executing ${operation} on ${adapter.vendor}`,
    );
    return {
      adapterId,
      operation,
      result: `${operation} completed`,
      executedAt: Date.now(),
    };
  }

  async getComplianceStatus() {
    const adapters = Array.from(this._adapters.values());
    return {
      totalAdapters: adapters.length,
      fipsCompliant: adapters.filter((a) => a.fips_compliant).length,
      connected: adapters.filter((a) => a.status === "connected").length,
      complianceLevel: adapters.every((a) => a.fips_compliant)
        ? "FIPS-140-3"
        : "partial",
    };
  }

  async close() {
    this.removeAllListeners();
    this._adapters.clear();
    this.initialized = false;
    logger.info("[HsmAdapterManager] Closed");
  }
}

let _instance = null;
function getHsmAdapterManager(database) {
  if (!_instance) {
    _instance = new HsmAdapterManager(database);
  }
  return _instance;
}

export { HsmAdapterManager, getHsmAdapterManager, HSM_VENDOR };
export default HsmAdapterManager;
