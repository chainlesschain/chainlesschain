/**
 * Signaling Peer Registry
 *
 * Manages peer registration and lookup for the embedded signaling server.
 * Tracks connected peers, their device information, and connection state.
 */

const { logger } = require('../utils/logger.js');

class SignalingPeerRegistry {
  constructor(options = {}) {
    // peerId -> { socket, deviceInfo, deviceType, connectedAt, lastSeen }
    this.peers = new Map();

    // Connection ID -> peerId mapping for lookup before registration
    this.connectionToPeer = new Map();

    // Stale connection detection
    this.staleTimeout = options.staleTimeout || 120000; // 2 minutes
    this.staleCheckInterval = options.staleCheckInterval || 30000; // 30 seconds
    this.staleCheckTimer = null;

    // Stats
    this.stats = {
      totalRegistrations: 0,
      totalUnregistrations: 0,
      duplicateRegistrations: 0,
    };
  }

  /**
   * Initialize the registry (start stale connection checker)
   */
  initialize() {
    if (this.staleCheckTimer) {
      clearInterval(this.staleCheckTimer);
    }

    this.staleCheckTimer = setInterval(() => {
      this.checkStaleConnections();
    }, this.staleCheckInterval);

    logger.info('[PeerRegistry] Initialized');
  }

  /**
   * Register a peer
   * @param {string} peerId - Unique peer identifier
   * @param {WebSocket} socket - WebSocket connection
   * @param {Object} deviceInfo - Device metadata
   * @param {string} deviceType - 'mobile' | 'desktop' | 'unknown'
   * @returns {Object} Registration result with previous connection info if any
   */
  register(peerId, socket, deviceInfo = {}, deviceType = 'unknown') {
    const result = {
      success: true,
      previousConnection: null,
      isReconnect: false,
    };

    // Check if peer already exists
    if (this.peers.has(peerId)) {
      const existing = this.peers.get(peerId);
      result.previousConnection = {
        socket: existing.socket,
        deviceInfo: existing.deviceInfo,
        connectedAt: existing.connectedAt,
      };
      result.isReconnect = true;
      this.stats.duplicateRegistrations++;

      logger.info(`[PeerRegistry] Peer ${peerId} reconnecting, closing old connection`);
    }

    // Store new registration
    this.peers.set(peerId, {
      socket,
      deviceInfo,
      deviceType,
      connectedAt: Date.now(),
      lastSeen: Date.now(),
    });

    // Map connection ID to peer ID if available
    if (socket.connectionId) {
      this.connectionToPeer.set(socket.connectionId, peerId);
    }

    this.stats.totalRegistrations++;

    logger.info(`[PeerRegistry] Registered peer: ${peerId} (${deviceType})`);

    return result;
  }

  /**
   * Unregister a peer
   * @param {string} peerId - Peer identifier to remove
   * @returns {Object|null} Removed peer info or null if not found
   */
  unregister(peerId) {
    const peer = this.peers.get(peerId);

    if (!peer) {
      return null;
    }

    // Remove from connection mapping
    if (peer.socket && peer.socket.connectionId) {
      this.connectionToPeer.delete(peer.socket.connectionId);
    }

    this.peers.delete(peerId);
    this.stats.totalUnregistrations++;

    logger.info(`[PeerRegistry] Unregistered peer: ${peerId}`);

    return peer;
  }

  /**
   * Unregister by connection ID (used when socket closes before registration)
   * @param {string} connectionId - Connection identifier
   * @returns {Object|null} Removed peer info or null
   */
  unregisterByConnectionId(connectionId) {
    const peerId = this.connectionToPeer.get(connectionId);

    if (!peerId) {
      return null;
    }

    return this.unregister(peerId);
  }

  /**
   * Get a peer by ID
   * @param {string} peerId - Peer identifier
   * @returns {Object|null} Peer info or null if not found
   */
  getPeer(peerId) {
    return this.peers.get(peerId) || null;
  }

  /**
   * Get peer by connection ID
   * @param {string} connectionId - Connection identifier
   * @returns {Object|null} Peer info or null
   */
  getPeerByConnectionId(connectionId) {
    const peerId = this.connectionToPeer.get(connectionId);
    return peerId ? this.getPeer(peerId) : null;
  }

  /**
   * Get all peers of a specific device type
   * @param {string} deviceType - 'mobile' | 'desktop'
   * @returns {Array} List of peers matching the type
   */
  getPeersByType(deviceType) {
    const result = [];

    for (const [peerId, peer] of this.peers.entries()) {
      if (peer.deviceType === deviceType) {
        result.push({
          peerId,
          ...peer,
        });
      }
    }

    return result;
  }

  /**
   * Check if a peer is online (registered and has active socket)
   * @param {string} peerId - Peer identifier
   * @returns {boolean} True if peer is online
   */
  isOnline(peerId) {
    const peer = this.peers.get(peerId);

    if (!peer) {
      return false;
    }

    // Check if socket is still open
    const WebSocket = require('ws');
    return peer.socket && peer.socket.readyState === WebSocket.OPEN;
  }

  /**
   * Register the local host device (no WebSocket needed)
   * This allows the signaling server host to appear in the peers list
   * @param {string} peerId - Local peer identifier
   * @param {Object} deviceInfo - Device metadata
   * @param {string} deviceType - Device type (usually 'DESKTOP')
   */
  registerLocal(peerId, deviceInfo = {}, deviceType = 'DESKTOP') {
    this.peers.set(peerId, {
      socket: null, // Local peer has no socket
      deviceInfo,
      deviceType,
      connectedAt: Date.now(),
      lastSeen: Date.now(),
      isLocal: true, // Mark as local peer
    });

    this.stats.totalRegistrations++;
    logger.info(`[PeerRegistry] Local peer registered: ${peerId} (${deviceType})`);
  }

  /**
   * Get all online peers
   * @returns {Array} List of online peer objects with peerId
   */
  getOnlinePeers() {
    const result = [];
    const WebSocket = require('ws');

    for (const [peerId, peer] of this.peers.entries()) {
      // Include local peer (no socket) or peers with open socket
      if (peer.isLocal || (peer.socket && peer.socket.readyState === WebSocket.OPEN)) {
        result.push({
          peerId,
          deviceType: peer.deviceType,
          deviceInfo: peer.deviceInfo,
          connectedAt: peer.connectedAt,
          lastSeen: peer.lastSeen,
        });
      }
    }

    return result;
  }

  /**
   * Get device info for a peer
   * @param {string} peerId - Peer identifier
   * @returns {Object|null} Device info or null
   */
  getDeviceInfo(peerId) {
    const peer = this.peers.get(peerId);
    return peer ? peer.deviceInfo : null;
  }

  /**
   * Update last seen timestamp for a peer
   * @param {string} peerId - Peer identifier
   */
  updateLastSeen(peerId) {
    const peer = this.peers.get(peerId);
    if (peer) {
      peer.lastSeen = Date.now();
    }
  }

  /**
   * Check for and remove stale connections
   * @returns {Array} List of removed peer IDs
   */
  checkStaleConnections() {
    const now = Date.now();
    const removed = [];
    const WebSocket = require('ws');

    for (const [peerId, peer] of this.peers.entries()) {
      // Check if socket is closed/closing
      if (!peer.socket || peer.socket.readyState >= WebSocket.CLOSING) {
        this.unregister(peerId);
        removed.push(peerId);
        continue;
      }

      // Check for stale connection (no activity)
      if (now - peer.lastSeen > this.staleTimeout) {
        logger.warn(`[PeerRegistry] Stale connection detected: ${peerId}`);
        // Don't auto-remove stale connections, just log
        // The heartbeat mechanism should handle this
      }
    }

    if (removed.length > 0) {
      logger.info(`[PeerRegistry] Removed ${removed.length} stale connections`);
    }

    return removed;
  }

  /**
   * Get the count of registered peers
   * @returns {number} Number of registered peers
   */
  getCount() {
    return this.peers.size;
  }

  /**
   * Get registry statistics
   * @returns {Object} Statistics object
   */
  getStats() {
    return {
      ...this.stats,
      currentPeers: this.peers.size,
      onlinePeers: this.getOnlinePeers().length,
      mobileCount: this.getPeersByType('mobile').length,
      desktopCount: this.getPeersByType('desktop').length,
    };
  }

  /**
   * Get all peer IDs
   * @returns {Array<string>} List of peer IDs
   */
  getAllPeerIds() {
    return Array.from(this.peers.keys());
  }

  /**
   * Clear all peers (for testing or shutdown)
   */
  clear() {
    this.peers.clear();
    this.connectionToPeer.clear();
    logger.info('[PeerRegistry] Cleared all peers');
  }

  /**
   * Stop the registry (cleanup timers)
   */
  stop() {
    if (this.staleCheckTimer) {
      clearInterval(this.staleCheckTimer);
      this.staleCheckTimer = null;
    }

    logger.info('[PeerRegistry] Stopped');
  }
}

module.exports = SignalingPeerRegistry;
