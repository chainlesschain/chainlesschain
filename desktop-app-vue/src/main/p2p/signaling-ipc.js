/**
 * Signaling Server IPC Handlers
 *
 * Provides IPC interface for renderer process to control
 * and monitor the embedded signaling server.
 */

const { ipcMain } = require('electron');
const { logger } = require('../utils/logger.js');

/**
 * Register signaling server IPC handlers
 * @param {Object} options - Options object
 * @param {SignalingServer} [options.signalingServer] - SignalingServer instance (direct)
 * @param {P2PManager} [options.p2pManager] - P2PManager instance (to get signaling server dynamically)
 */
function registerSignalingIPC({ signalingServer, p2pManager }) {
  // Helper to get the signaling server (either direct or from p2pManager)
  const getServer = () => {
    if (signalingServer) {
      return signalingServer;
    }
    if (p2pManager && typeof p2pManager.getSignalingServer === 'function') {
      return p2pManager.getSignalingServer();
    }
    return null;
  };

  if (!signalingServer && !p2pManager) {
    logger.warn('[SignalingIPC] No signaling server or p2pManager provided');
    return;
  }

  /**
   * Start the signaling server
   */
  ipcMain.handle('signaling:start', async (_event, options = {}) => {
    try {
      const server = getServer();
      if (!server) {
        return {
          success: false,
          error: 'Signaling server not initialized',
        };
      }

      if (server.isServerRunning()) {
        return {
          success: true,
          message: 'Server already running',
          stats: server.getStats(),
        };
      }

      // Apply options if provided
      if (options.port) {
        server.port = options.port;
      }
      if (options.host) {
        server.host = options.host;
      }

      await server.start();

      return {
        success: true,
        message: 'Server started',
        stats: server.getStats(),
      };
    } catch (error) {
      logger.error('[SignalingIPC] Failed to start server:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * Stop the signaling server
   */
  ipcMain.handle('signaling:stop', async () => {
    try {
      const server = getServer();
      if (!server) {
        return {
          success: true,
          message: 'Signaling server not initialized',
        };
      }

      if (!server.isServerRunning()) {
        return {
          success: true,
          message: 'Server not running',
        };
      }

      await server.stop();

      return {
        success: true,
        message: 'Server stopped',
      };
    } catch (error) {
      logger.error('[SignalingIPC] Failed to stop server:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * Get server status
   */
  ipcMain.handle('signaling:get-status', async () => {
    try {
      const server = getServer();
      if (!server) {
        return {
          success: true,
          isRunning: false,
          initialized: false,
          message: 'Signaling server not initialized',
        };
      }

      const stats = server.getStats();

      return {
        success: true,
        isRunning: server.isServerRunning(),
        initialized: true,
        stats,
      };
    } catch (error) {
      logger.error('[SignalingIPC] Failed to get status:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * Get list of connected peers
   */
  ipcMain.handle('signaling:get-peers', async () => {
    try {
      const server = getServer();
      if (!server) {
        return {
          success: false,
          error: 'Signaling server not initialized',
        };
      }

      const peers = server.getPeers();

      return {
        success: true,
        peers,
        count: peers.length,
      };
    } catch (error) {
      logger.error('[SignalingIPC] Failed to get peers:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * Get server statistics
   */
  ipcMain.handle('signaling:get-stats', async () => {
    try {
      const server = getServer();
      if (!server) {
        return {
          success: false,
          error: 'Signaling server not initialized',
        };
      }

      const stats = server.getStats();

      return {
        success: true,
        stats,
      };
    } catch (error) {
      logger.error('[SignalingIPC] Failed to get stats:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * Update server configuration
   */
  ipcMain.handle('signaling:set-config', async (_event, config) => {
    try {
      const server = getServer();
      if (!server) {
        return {
          success: false,
          error: 'Signaling server not initialized',
        };
      }

      server.setConfig(config);

      return {
        success: true,
        message: 'Configuration updated',
      };
    } catch (error) {
      logger.error('[SignalingIPC] Failed to set config:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * Kick a specific peer
   */
  ipcMain.handle('signaling:kick-peer', async (_event, peerId, reason) => {
    try {
      const server = getServer();
      if (!server) {
        return {
          success: false,
          error: 'Signaling server not initialized',
        };
      }

      const result = server.kickPeer(peerId, reason);

      return {
        success: result,
        message: result ? `Peer ${peerId} kicked` : `Peer ${peerId} not found`,
      };
    } catch (error) {
      logger.error('[SignalingIPC] Failed to kick peer:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * Broadcast a message to all connected peers
   */
  ipcMain.handle('signaling:broadcast', async (_event, message, excludePeerId) => {
    try {
      const server = getServer();
      if (!server) {
        return {
          success: false,
          error: 'Signaling server not initialized',
        };
      }

      if (!server.isServerRunning()) {
        return {
          success: false,
          error: 'Server not running',
        };
      }

      server.broadcast(message, excludePeerId);

      return {
        success: true,
        message: 'Broadcast sent',
      };
    } catch (error) {
      logger.error('[SignalingIPC] Failed to broadcast:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * Restart the signaling server
   */
  ipcMain.handle('signaling:restart', async (_event, options = {}) => {
    try {
      const server = getServer();
      if (!server) {
        return {
          success: false,
          error: 'Signaling server not initialized',
        };
      }

      // Stop if running
      if (server.isServerRunning()) {
        await server.stop();
      }

      // Apply new options
      if (options.port) {
        server.port = options.port;
      }
      if (options.host) {
        server.host = options.host;
      }

      // Start
      await server.start();

      return {
        success: true,
        message: 'Server restarted',
        stats: server.getStats(),
      };
    } catch (error) {
      logger.error('[SignalingIPC] Failed to restart server:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * Get message queue info for a specific peer
   */
  ipcMain.handle('signaling:get-queue-info', async (_event, peerId) => {
    try {
      const server = getServer();
      if (!server) {
        return {
          success: false,
          error: 'Signaling server not initialized',
        };
      }

      const stats = server.getStats();
      const queueStats = stats.messageQueue;

      if (peerId) {
        // Get queue info for specific peer
        const messages = server.messageQueue.peek(peerId);
        return {
          success: true,
          peerId,
          queueSize: messages.length,
          messages: messages.map(m => ({
            messageId: m.messageId,
            storedAt: m.storedAt,
            type: m.message?.type,
          })),
        };
      }

      return {
        success: true,
        queueStats,
        peersWithMessages: server.messageQueue.getPeersWithMessages(),
      };
    } catch (error) {
      logger.error('[SignalingIPC] Failed to get queue info:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * Clear message queue for a specific peer
   */
  ipcMain.handle('signaling:clear-queue', async (_event, peerId) => {
    try {
      const server = getServer();
      if (!server) {
        return {
          success: false,
          error: 'Signaling server not initialized',
        };
      }

      if (!peerId) {
        return {
          success: false,
          error: 'peerId is required',
        };
      }

      const count = server.messageQueue.clearQueue(peerId);

      return {
        success: true,
        clearedCount: count,
        message: `Cleared ${count} messages for ${peerId}`,
      };
    } catch (error) {
      logger.error('[SignalingIPC] Failed to clear queue:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  logger.info('[SignalingIPC] Handlers registered');
}

/**
 * Unregister signaling IPC handlers
 */
function unregisterSignalingIPC() {
  const channels = [
    'signaling:start',
    'signaling:stop',
    'signaling:get-status',
    'signaling:get-peers',
    'signaling:get-stats',
    'signaling:set-config',
    'signaling:kick-peer',
    'signaling:broadcast',
    'signaling:restart',
    'signaling:get-queue-info',
    'signaling:clear-queue',
  ];

  for (const channel of channels) {
    ipcMain.removeHandler(channel);
  }

  logger.info('[SignalingIPC] Handlers unregistered');
}

module.exports = {
  registerSignalingIPC,
  unregisterSignalingIPC,
};
