/**
 * Device Discovery & Authorization for P2P Git Sync
 * Wraps existing libp2p mDNS/DHT discovery + DevicePairingHandler
 * Provides DID signature handshake and device authorization whitelist
 *
 * @module git/device-discovery
 * @version 1.0.0
 */

const { EventEmitter } = require("events");
const { logger } = require("../utils/logger.js");
const crypto = require("crypto");
const { v4: uuidv4 } = require("uuid");

// Challenge-response timeout
const CHALLENGE_TIMEOUT_MS = 15000;

// Device types
const DEVICE_TYPES = {
  DESKTOP: "desktop",
  MOBILE: "mobile",
  TABLET: "tablet",
  SERVER: "server",
  UNKNOWN: "unknown",
};

/**
 * Device Discovery Manager
 * Handles device discovery, DID authentication, and authorization whitelist
 */
class DeviceDiscoveryManager extends EventEmitter {
  /**
   * @param {Object} options
   * @param {Object} options.p2pManager - P2PManager instance (libp2p)
   * @param {Object} options.didManager - DIDManager instance (Ed25519 signing)
   * @param {Object} [options.devicePairingHandler] - DevicePairingHandler instance
   * @param {Object} options.database - DatabaseManager instance
   */
  constructor(options = {}) {
    super();
    this.p2pManager = options.p2pManager || null;
    this.didManager = options.didManager || null;
    this.pairingHandler = options.devicePairingHandler || null;
    this.db = options.database || null;

    // Discovered peers (peerId -> deviceInfo)
    this.discoveredPeers = new Map();

    // Verified peers (peerId -> verifiedInfo)
    this.verifiedPeers = new Map();

    // Pending challenges (peerId -> challengeData)
    this._pendingChallenges = new Map();

    // Local device info
    this.localDID = null;
    this.localDeviceName = null;
    this.localDeviceType = DEVICE_TYPES.DESKTOP;

    // Discovery interval
    this._discoveryInterval = null;
  }

  /**
   * Initialize discovery manager
   */
  async initialize() {
    logger.info("[DeviceDiscovery] Initializing...");

    // Get local DID
    if (this.didManager) {
      try {
        const identity = await this.didManager.getDefaultIdentity();
        this.localDID = identity?.did || null;
        logger.info(`[DeviceDiscovery] Local DID: ${this.localDID}`);
      } catch (error) {
        logger.warn(
          "[DeviceDiscovery] Failed to get local DID:",
          error.message,
        );
      }
    }

    // Set up P2P discovery listeners
    if (this.p2pManager) {
      this.p2pManager.on("peer:discovery", (peerId, peerInfo) => {
        this._handlePeerDiscovered(peerId, peerInfo);
      });

      this.p2pManager.on("peer:disconnect", (peerId) => {
        this._handlePeerDisconnected(peerId);
      });
    }

    // Set up pairing handler listeners
    if (this.pairingHandler) {
      this.pairingHandler.on("pairing:complete", (deviceInfo) => {
        this._handlePairingComplete(deviceInfo);
      });
    }

    logger.info("[DeviceDiscovery] Initialized");
  }

  /**
   * Start active device discovery
   * @param {Object} [options]
   * @param {number} [options.interval=10000] - Discovery interval in ms
   * @param {string[]} [options.methods=['mdns','libp2p']] - Discovery methods
   */
  startDiscovery(options = {}) {
    const interval = options.interval || 10000;
    const methods = options.methods || ["mdns", "libp2p"];

    logger.info(
      `[DeviceDiscovery] Starting discovery (interval: ${interval}ms, methods: ${methods.join(",")})`,
    );

    // Initial discovery scan
    this._performDiscoveryScan(methods);

    // Periodic discovery
    this._discoveryInterval = setInterval(() => {
      this._performDiscoveryScan(methods);
    }, interval);

    this.emit("discovery:started", { interval, methods });
  }

  /**
   * Stop active discovery
   */
  stopDiscovery() {
    if (this._discoveryInterval) {
      clearInterval(this._discoveryInterval);
      this._discoveryInterval = null;
    }
    logger.info("[DeviceDiscovery] Discovery stopped");
    this.emit("discovery:stopped");
  }

  /**
   * Perform a discovery scan
   * @param {string[]} methods
   */
  async _performDiscoveryScan(methods) {
    try {
      if (this.p2pManager && methods.includes("mdns")) {
        // Trigger mDNS discovery refresh
        const peers = (await this.p2pManager.getConnectedPeers?.()) || [];
        for (const peer of peers) {
          if (!this.discoveredPeers.has(peer.id)) {
            this._handlePeerDiscovered(peer.id, peer);
          }
        }
      }
    } catch (error) {
      logger.warn("[DeviceDiscovery] Discovery scan error:", error.message);
    }
  }

  /**
   * Handle a newly discovered peer
   * @param {string} peerId
   * @param {Object} peerInfo
   */
  _handlePeerDiscovered(peerId, peerInfo) {
    if (this.discoveredPeers.has(peerId)) {
      return;
    }

    const deviceInfo = {
      peerId,
      did: peerInfo?.did || null,
      name: peerInfo?.name || `Device-${peerId.slice(0, 8)}`,
      type: peerInfo?.type || DEVICE_TYPES.UNKNOWN,
      addresses: peerInfo?.addresses || [],
      discoveredAt: Date.now(),
      verified: false,
    };

    this.discoveredPeers.set(peerId, deviceInfo);
    logger.info(
      `[DeviceDiscovery] Peer discovered: ${deviceInfo.name} (${peerId})`,
    );

    this.emit("device:discovered", deviceInfo);
  }

  /**
   * Handle peer disconnection
   * @param {string} peerId
   */
  _handlePeerDisconnected(peerId) {
    const deviceInfo = this.discoveredPeers.get(peerId);
    if (deviceInfo) {
      this.discoveredPeers.delete(peerId);
      this.verifiedPeers.delete(peerId);
      this.emit("device:disconnected", deviceInfo);
      logger.info(`[DeviceDiscovery] Peer disconnected: ${peerId}`);
    }
  }

  /**
   * Handle pairing completion
   * @param {Object} deviceInfo
   */
  async _handlePairingComplete(deviceInfo) {
    if (deviceInfo.peerId && deviceInfo.did) {
      await this.authorizeDevice(deviceInfo.did, {
        name: deviceInfo.name,
        type: deviceInfo.type,
        publicKey: deviceInfo.publicKey,
        authorizedBy: "pairing",
      });
    }
  }

  /**
   * Verify a peer's identity using DID challenge-response
   * @param {string} peerId - Peer identifier
   * @returns {Promise<Object>} Verification result
   */
  async verifyPeer(peerId) {
    logger.info(`[DeviceDiscovery] Verifying peer: ${peerId}`);

    const deviceInfo = this.discoveredPeers.get(peerId);
    if (!deviceInfo) {
      throw new Error(`Peer not found: ${peerId}`);
    }

    if (!this.didManager) {
      throw new Error("DID manager not available for verification");
    }

    try {
      // Generate challenge
      const challenge = crypto.randomBytes(32).toString("hex");
      const nonce = crypto.randomBytes(16).toString("hex");
      const timestamp = Date.now();

      // Store pending challenge
      this._pendingChallenges.set(peerId, {
        challenge,
        nonce,
        timestamp,
      });

      // Send challenge to peer via P2P
      if (this.p2pManager) {
        await this.p2pManager.sendMessage?.(peerId, {
          type: "did:challenge",
          challenge,
          nonce,
          timestamp,
          senderDID: this.localDID,
        });
      }

      // Wait for response with timeout
      const response = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          this._pendingChallenges.delete(peerId);
          reject(new Error("Challenge-response timeout"));
        }, CHALLENGE_TIMEOUT_MS);

        const handler = (respPeerId, respData) => {
          if (
            respPeerId === peerId &&
            respData.type === "did:challenge-response"
          ) {
            clearTimeout(timeout);
            this.p2pManager?.off?.("message", handler);
            resolve(respData);
          }
        };

        this.p2pManager?.on?.("message", handler);
      });

      // Verify signature
      const challengeData = this._pendingChallenges.get(peerId);
      this._pendingChallenges.delete(peerId);

      if (!challengeData) {
        throw new Error("Challenge data not found");
      }

      const messageToVerify = `${challengeData.challenge}:${challengeData.nonce}:${challengeData.timestamp}`;
      const isValid = await this.didManager.verifySignature?.(
        response.did,
        messageToVerify,
        response.signature,
      );

      if (!isValid) {
        throw new Error("DID signature verification failed");
      }

      // Update device info
      deviceInfo.did = response.did;
      deviceInfo.verified = true;
      deviceInfo.verifiedAt = Date.now();
      this.verifiedPeers.set(peerId, deviceInfo);

      logger.info(
        `[DeviceDiscovery] Peer verified: ${peerId} (DID: ${response.did})`,
      );

      this.emit("device:verified", deviceInfo);
      return { success: true, deviceInfo };
    } catch (error) {
      logger.error(
        `[DeviceDiscovery] Peer verification failed for ${peerId}:`,
        error.message,
      );
      return { success: false, error: error.message };
    }
  }

  /**
   * Handle incoming DID challenge (respond as server)
   * @param {string} peerId
   * @param {Object} challengeData
   */
  async handleChallenge(peerId, challengeData) {
    if (!this.didManager || !this.localDID) {
      logger.warn(
        "[DeviceDiscovery] Cannot respond to challenge: no DID manager",
      );
      return;
    }

    try {
      const message = `${challengeData.challenge}:${challengeData.nonce}:${challengeData.timestamp}`;
      const signature = await this.didManager.sign?.(message);

      if (this.p2pManager) {
        await this.p2pManager.sendMessage?.(peerId, {
          type: "did:challenge-response",
          did: this.localDID,
          signature,
          nonce: challengeData.nonce,
        });
      }
    } catch (error) {
      logger.error(
        "[DeviceDiscovery] Failed to respond to challenge:",
        error.message,
      );
    }
  }

  // ==========================================
  // Authorization Whitelist Management
  // ==========================================

  /**
   * Authorize a device for P2P Git sync
   * @param {string} deviceDID - Device DID
   * @param {Object} [info] - Additional device info
   */
  async authorizeDevice(deviceDID, info = {}) {
    if (!this.db) {
      logger.warn(
        "[DeviceDiscovery] No database, authorization stored in memory only",
      );
      return { success: true, id: uuidv4() };
    }

    try {
      const id = uuidv4();
      this.db.run(
        `INSERT OR REPLACE INTO git_p2p_authorized_devices
         (id, device_did, device_name, device_type, public_key, authorized_by, last_seen, is_active)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'), 1)`,
        [
          id,
          deviceDID,
          info.name || null,
          info.type || DEVICE_TYPES.UNKNOWN,
          info.publicKey || null,
          info.authorizedBy || "manual",
        ],
      );

      logger.info(`[DeviceDiscovery] Device authorized: ${deviceDID}`);
      this.emit("device:authorized", { did: deviceDID, ...info });
      return { success: true, id };
    } catch (error) {
      logger.error("[DeviceDiscovery] Authorization failed:", error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Revoke device authorization
   * @param {string} deviceDID - Device DID to revoke
   */
  async revokeDevice(deviceDID) {
    if (!this.db) {
      return { success: false, error: "No database" };
    }

    try {
      this.db.run(
        `UPDATE git_p2p_authorized_devices SET is_active = 0 WHERE device_did = ?`,
        [deviceDID],
      );

      // Disconnect if currently connected
      for (const [peerId, info] of this.verifiedPeers) {
        if (info.did === deviceDID) {
          this.verifiedPeers.delete(peerId);
          break;
        }
      }

      logger.info(`[DeviceDiscovery] Device revoked: ${deviceDID}`);
      this.emit("device:revoked", { did: deviceDID });
      return { success: true };
    } catch (error) {
      logger.error("[DeviceDiscovery] Revocation failed:", error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Check if a device is authorized
   * @param {string} deviceDID
   * @returns {boolean}
   */
  isDeviceAuthorized(deviceDID) {
    if (!this.db) {
      return false;
    }

    try {
      const result = this.db.get(
        `SELECT id FROM git_p2p_authorized_devices WHERE device_did = ? AND is_active = 1`,
        [deviceDID],
      );
      return !!result;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get all authorized devices
   * @returns {Array} Authorized device list
   */
  getAuthorizedDevices() {
    if (!this.db) {
      return [];
    }

    try {
      return this.db.all(
        `SELECT * FROM git_p2p_authorized_devices WHERE is_active = 1 ORDER BY authorized_at DESC`,
      );
    } catch (error) {
      logger.error(
        "[DeviceDiscovery] Failed to get authorized devices:",
        error.message,
      );
      return [];
    }
  }

  /**
   * Update device last seen timestamp
   * @param {string} deviceDID
   */
  updateLastSeen(deviceDID) {
    if (!this.db) {
      return;
    }

    try {
      this.db.run(
        `UPDATE git_p2p_authorized_devices SET last_seen = datetime('now') WHERE device_did = ?`,
        [deviceDID],
      );
    } catch (error) {
      // Non-fatal
    }
  }

  // ==========================================
  // Getters
  // ==========================================

  /**
   * Get all discovered peers
   * @returns {Array}
   */
  getDiscoveredPeers() {
    return Array.from(this.discoveredPeers.values());
  }

  /**
   * Get verified peers only
   * @returns {Array}
   */
  getVerifiedPeers() {
    return Array.from(this.verifiedPeers.values());
  }

  /**
   * Get peers that are both verified and authorized
   * @returns {Array}
   */
  getSyncablePeers() {
    const authorized = this.getAuthorizedDevices();
    const authorizedDIDs = new Set(authorized.map((d) => d.device_did));

    return Array.from(this.verifiedPeers.values()).filter(
      (peer) => peer.did && authorizedDIDs.has(peer.did),
    );
  }

  /**
   * Destroy and clean up
   */
  destroy() {
    this.stopDiscovery();
    this._pendingChallenges.clear();
    this.discoveredPeers.clear();
    this.verifiedPeers.clear();
    this.removeAllListeners();
    logger.info("[DeviceDiscovery] Destroyed");
  }
}

module.exports = {
  DeviceDiscoveryManager,
  DEVICE_TYPES,
};
