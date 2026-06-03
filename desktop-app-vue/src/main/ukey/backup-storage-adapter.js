"use strict";

/**
 * Multi-backend storage adapter for backup shards
 * Supports: local filesystem, IPFS (simulated), cloud (simulated)
 */

const fs = require("fs");
const path = require("path");
const os = require("os");

const LOCAL_BASE = path.join(os.homedir(), ".chainlesschain", "backup");

class BackupStorageAdapter {
  constructor() {
    this._ensureLocalDir();
  }

  _ensureLocalDir() {
    try {
      fs.mkdirSync(LOCAL_BASE, { recursive: true });
    } catch (e) {
      console.warn(
        "[BackupStorage] Cannot create local backup dir:",
        e.message,
      );
    }
  }

  _localPath(backupId, shardIndex) {
    return path.join(LOCAL_BASE, `${backupId}_shard_${shardIndex}.bin`);
  }

  /**
   * Store a shard to the specified backend
   * @param {string} backupId
   * @param {number} shardIndex
   * @param {string} shardData - hex-encoded shard string "index:hexData"
   * @param {'local'|'ipfs'|'cloud'} backend
   * @returns {Promise<{ backend: string, location: string }>}
   */
  async store(backupId, shardIndex, shardData, backend = "local") {
    switch (backend) {
      case "local": {
        const filePath = this._localPath(backupId, shardIndex);
        fs.writeFileSync(filePath, shardData, "utf8");
        console.log(
          `[BackupStorage] Stored shard ${shardIndex} locally: ${filePath}`,
        );
        return { backend: "local", location: filePath };
      }
      case "ipfs": {
        // Simulated IPFS storage
        const cid = `Qm${Buffer.from(`${backupId}-${shardIndex}`).toString("base64").slice(0, 44)}`;
        console.log(
          `[BackupStorage] IPFS store shard ${shardIndex} → CID: ${cid}`,
        );
        // Also write locally as fallback
        fs.writeFileSync(
          this._localPath(backupId, shardIndex) + ".ipfs",
          JSON.stringify({ cid, data: shardData }),
          "utf8",
        );
        return { backend: "ipfs", location: `ipfs://${cid}` };
      }
      case "cloud": {
        // Simulated cloud storage
        const url = `https://backup.chainlesschain.com/${backupId}/shard_${shardIndex}`;
        console.log(`[BackupStorage] Cloud store shard ${shardIndex} → ${url}`);
        fs.writeFileSync(
          this._localPath(backupId, shardIndex) + ".cloud",
          JSON.stringify({ url, data: shardData }),
          "utf8",
        );
        return { backend: "cloud", location: url };
      }
      default:
        throw new Error(`Unknown backup backend: ${backend}`);
    }
  }

  /**
   * Retrieve a shard from the specified backend
   * @param {string} backupId
   * @param {number} shardIndex
   * @param {'local'|'ipfs'|'cloud'} backend
   * @returns {Promise<string>} shard data
   */
  async retrieve(backupId, shardIndex, backend = "local") {
    switch (backend) {
      case "local": {
        const filePath = this._localPath(backupId, shardIndex);
        if (!fs.existsSync(filePath)) {
          throw new Error(`Local shard not found: ${filePath}`);
        }
        return fs.readFileSync(filePath, "utf8");
      }
      case "ipfs": {
        const ipfsFile = this._localPath(backupId, shardIndex) + ".ipfs";
        if (!fs.existsSync(ipfsFile)) {
          throw new Error(
            `IPFS shard not found for backup ${backupId}/${shardIndex}`,
          );
        }
        const { data } = JSON.parse(fs.readFileSync(ipfsFile, "utf8"));
        return data;
      }
      case "cloud": {
        const cloudFile = this._localPath(backupId, shardIndex) + ".cloud";
        if (!fs.existsSync(cloudFile)) {
          throw new Error(
            `Cloud shard not found for backup ${backupId}/${shardIndex}`,
          );
        }
        const { data } = JSON.parse(fs.readFileSync(cloudFile, "utf8"));
        return data;
      }
      default:
        throw new Error(`Unknown backup backend: ${backend}`);
    }
  }

  /**
   * List all available shards for a backup
   * @param {string} backupId
   * @returns {Promise<Array<{ shardIndex: number, backend: string, location: string }>>}
   */
  async list(backupId) {
    const results = [];
    try {
      const files = fs.readdirSync(LOCAL_BASE);
      for (const file of files) {
        const match = file.match(
          new RegExp(`^${backupId}_shard_(\\d+)\\.bin$`),
        );
        if (match) {
          results.push({
            shardIndex: parseInt(match[1]),
            backend: "local",
            location: path.join(LOCAL_BASE, file),
          });
        }
      }
    } catch (e) {
      console.warn("[BackupStorage] Error listing shards:", e.message);
    }
    return results;
  }

  /**
   * Delete all shards for a backup
   * @param {string} backupId
   * @returns {Promise<number>} number of shards deleted
   */
  async delete(backupId) {
    let count = 0;
    try {
      const files = fs.readdirSync(LOCAL_BASE);
      for (const file of files) {
        if (file.startsWith(backupId + "_shard_")) {
          fs.unlinkSync(path.join(LOCAL_BASE, file));
          count++;
        }
      }
    } catch (e) {
      console.warn("[BackupStorage] Error deleting shards:", e.message);
    }
    console.log(
      `[BackupStorage] Deleted ${count} shards for backup ${backupId}`,
    );
    return count;
  }
}

module.exports = { BackupStorageAdapter };
