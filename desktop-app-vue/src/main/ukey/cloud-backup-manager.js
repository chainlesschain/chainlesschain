"use strict";

/**
 * Cloud Backup Manager — orchestrates encrypted M-of-N shard backup
 * Integrates: shamir-split, backup-encryptor, backup-storage-adapter
 */

const EventEmitter = require("events");
const crypto = require("crypto");
const { splitSecret, reconstructSecret } = require("./shamir-split");
const { encryptBackup, decryptBackup } = require("./backup-encryptor");
const { BackupStorageAdapter } = require("./backup-storage-adapter");

const BACKUP_STRATEGY = {
  basic: { threshold: 1, total: 1, backends: ["local"] },
  standard: { threshold: 2, total: 3, backends: ["ipfs", "local", "local"] },
  advanced: {
    threshold: 3,
    total: 5,
    backends: ["ipfs", "cloud", "local", "local", "local"],
  },
  enterprise: {
    threshold: 5,
    total: 9,
    backends: [
      "ipfs",
      "ipfs",
      "cloud",
      "cloud",
      "cloud",
      "local",
      "local",
      "local",
      "local",
    ],
  },
};

class CloudBackupManager extends EventEmitter {
  constructor() {
    super();
    this._storage = new BackupStorageAdapter();
    this._metadata = [];
  }

  /**
   * Create a backup: encrypt + split + distribute shards
   * @param {Buffer|string} ukeyData - serialized key material
   * @param {string} passphrase
   * @param {{ strategy?: string }} [options]
   * @returns {Promise<{ backupId: string, shardsStored: number, strategy: string }>}
   */
  async createBackup(ukeyData, passphrase, options = {}) {
    const strategy = options.strategy || "standard";
    const { threshold, total, backends } =
      BACKUP_STRATEGY[strategy] || BACKUP_STRATEGY.standard;

    const backupId = crypto.randomUUID();
    console.log(
      `[CloudBackup] Creating backup ${backupId} with strategy: ${strategy}`,
    );

    this.emit("progress", { step: "encrypting", percent: 10 });
    const encrypted = await encryptBackup(ukeyData, passphrase);
    const encryptedBuf = Buffer.from(JSON.stringify(encrypted));

    this.emit("progress", { step: "splitting", percent: 30 });
    let shares;
    if (total === 1) {
      shares = [`1:${encryptedBuf.toString("hex")}`];
    } else {
      shares = splitSecret(encryptedBuf, total, threshold);
    }

    this.emit("progress", { step: "storing", percent: 50 });
    const storedLocations = [];
    for (let i = 0; i < shares.length; i++) {
      const backend = backends[i % backends.length];
      const loc = await this._storage.store(backupId, i, shares[i], backend);
      storedLocations.push(loc);
      this.emit("progress", {
        step: "storing",
        percent: 50 + Math.round((40 * (i + 1)) / shares.length),
      });
    }

    const meta = {
      id: backupId,
      createdAt: new Date().toISOString(),
      strategy,
      shardsTotal: total,
      shardsCollected: storedLocations.length,
      threshold,
      integrityOk: true,
      locations: storedLocations,
    };
    this._metadata.unshift(meta);

    this.emit("progress", { step: "done", percent: 100 });
    this.emit("backup-created", meta);
    console.log(
      `[CloudBackup] Backup ${backupId} created: ${storedLocations.length}/${total} shards stored`,
    );
    return { backupId, shardsStored: storedLocations.length, strategy };
  }

  /**
   * Restore backup by collecting shards and decrypting
   * @param {string} backupId
   * @param {string} passphrase
   * @param {number} [minShards] - minimum shards to collect (defaults to strategy threshold)
   * @returns {Promise<Buffer>} - original key material
   */
  async restoreBackup(backupId, passphrase, minShards) {
    console.log(`[CloudBackup] Restoring backup ${backupId}`);
    this.emit("progress", { step: "collecting", percent: 10 });

    const availableShards = await this._storage.list(backupId);
    if (availableShards.length === 0) {
      throw new Error("No shards found for backup: " + backupId);
    }

    const threshold = minShards || availableShards.length;
    const shares = [];
    for (const shard of availableShards.slice(0, threshold)) {
      const data = await this._storage.retrieve(
        backupId,
        shard.shardIndex,
        shard.backend,
      );
      shares.push(data);
    }

    this.emit("progress", { step: "reconstructing", percent: 60 });

    let encryptedBuf;
    if (shares.length === 1 && shares[0].startsWith("1:")) {
      // basic 1-of-1: shard IS the encrypted data
      encryptedBuf = Buffer.from(shares[0].slice(2), "hex");
    } else {
      encryptedBuf = reconstructSecret(shares);
    }

    this.emit("progress", { step: "decrypting", percent: 80 });
    const encrypted = JSON.parse(encryptedBuf.toString());
    const plaintext = await decryptBackup(encrypted, passphrase);

    this.emit("progress", { step: "done", percent: 100 });
    this.emit("backup-restored", { backupId });
    return plaintext;
  }

  /**
   * List all backup metadata
   * @returns {Promise<object[]>}
   */
  async listBackups() {
    return this._metadata;
  }

  /**
   * Verify backup integrity
   * @param {string} backupId
   * @returns {Promise<{ ok: boolean, shardsFound: number }>}
   */
  async verifyBackup(backupId) {
    const shards = await this._storage.list(backupId);
    const meta = this._metadata.find((m) => m.id === backupId);
    const ok = shards.length >= (meta?.threshold || 1);
    console.log(
      `[CloudBackup] Verify ${backupId}: ${shards.length} shards found, integrity: ${ok}`,
    );
    if (meta) {
      meta.integrityOk = ok;
    }
    return { ok, shardsFound: shards.length };
  }

  /**
   * Delete backup and all its shards
   * @param {string} backupId
   * @returns {Promise<void>}
   */
  async deleteBackup(backupId) {
    await this._storage.delete(backupId);
    this._metadata = this._metadata.filter((m) => m.id !== backupId);
    this.emit("backup-deleted", { backupId });
    console.log(`[CloudBackup] Deleted backup ${backupId}`);
  }
}

module.exports = { CloudBackupManager, BACKUP_STRATEGY };
