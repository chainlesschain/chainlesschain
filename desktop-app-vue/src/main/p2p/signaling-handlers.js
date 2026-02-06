/**
 * Signaling Message Handlers
 *
 * Protocol message handlers for the embedded signaling server.
 * Handles all signaling message types: register, offer, answer, ice-candidate, etc.
 */

const { logger } = require('../utils/logger.js');

/**
 * Handle peer registration
 * @param {WebSocket} socket - Client WebSocket
 * @param {Object} message - Registration message
 * @param {SignalingPeerRegistry} registry - Peer registry
 * @param {SignalingMessageQueue} queue - Message queue
 * @param {Function} sendMessage - Function to send messages
 * @param {Function} broadcastPeerStatus - Function to broadcast peer status
 */
function handleRegister(socket, message, registry, queue, sendMessage, broadcastPeerStatus) {
  const { peerId, deviceInfo, deviceType } = message;

  if (!peerId) {
    sendMessage(socket, {
      type: 'error',
      error: 'peerId is required for registration',
      timestamp: Date.now(),
    });
    return;
  }

  // Register the peer
  const result = registry.register(peerId, socket, deviceInfo, deviceType);

  // Close old connection if reconnecting
  if (result.previousConnection && result.previousConnection.socket) {
    try {
      result.previousConnection.socket.close();
    } catch (error) {
      logger.warn('[Handlers] Failed to close previous connection:', error.message);
    }
  }

  // Store peerId on socket for later reference
  socket.peerId = peerId;

  // Send registration confirmation
  sendMessage(socket, {
    type: 'registered',
    peerId,
    serverTime: Date.now(),
    isReconnect: result.isReconnect,
  });

  // Deliver any pending offline messages
  const pendingMessages = queue.dequeue(peerId);
  if (pendingMessages.length > 0) {
    logger.info(`[Handlers] Delivering ${pendingMessages.length} offline messages to ${peerId}`);

    for (const entry of pendingMessages) {
      sendMessage(socket, {
        type: 'offline-message',
        originalMessage: entry.message,
        storedAt: entry.storedAt,
        deliveredAt: Date.now(),
      });
    }
  }

  // Broadcast peer online status to others
  broadcastPeerStatus(peerId, 'online', { deviceType, deviceInfo });

  logger.info(`[Handlers] Peer registered: ${peerId} (${deviceType || 'unknown'})`);
}

/**
 * Handle WebRTC offer
 * @param {WebSocket} socket - Client WebSocket
 * @param {Object} message - Offer message
 * @param {SignalingPeerRegistry} registry - Peer registry
 * @param {SignalingMessageQueue} queue - Message queue
 * @param {Function} sendMessage - Function to send messages
 */
function handleOffer(socket, message, registry, queue, sendMessage) {
  const { to, offer, sdp, iceRestart } = message;

  if (!to) {
    sendMessage(socket, {
      type: 'error',
      error: 'Missing "to" field in offer',
      timestamp: Date.now(),
    });
    return;
  }

  const from = socket.peerId || message.from;
  const offerPayload = offer || sdp; // Support both formats

  const forwardMessage = {
    type: 'offer',
    from,
    offer: offerPayload,
    sdp: offerPayload, // Include both for compatibility
    iceRestart: iceRestart || false,
    timestamp: Date.now(),
  };

  const targetPeer = registry.getPeer(to);

  if (targetPeer && registry.isOnline(to)) {
    // Target is online, forward directly
    sendMessage(targetPeer.socket, forwardMessage);
    registry.updateLastSeen(to);
    logger.info(`[Handlers] Forwarded offer: ${from} -> ${to}`);
  } else {
    // Target is offline, queue the message
    queue.enqueue(to, forwardMessage);

    // Notify sender that target is offline
    sendMessage(socket, {
      type: 'peer-offline',
      peerId: to,
      messageType: 'offer',
      timestamp: Date.now(),
    });

    logger.info(`[Handlers] Target offline, queued offer: ${from} -> ${to}`);
  }
}

/**
 * Handle WebRTC answer
 * @param {WebSocket} socket - Client WebSocket
 * @param {Object} message - Answer message
 * @param {SignalingPeerRegistry} registry - Peer registry
 * @param {SignalingMessageQueue} queue - Message queue
 * @param {Function} sendMessage - Function to send messages
 */
function handleAnswer(socket, message, registry, queue, sendMessage) {
  const { to, answer, sdp } = message;

  if (!to) {
    sendMessage(socket, {
      type: 'error',
      error: 'Missing "to" field in answer',
      timestamp: Date.now(),
    });
    return;
  }

  const from = socket.peerId || message.from;
  const answerPayload = answer || sdp;

  const forwardMessage = {
    type: 'answer',
    from,
    answer: answerPayload,
    sdp: answerPayload,
    timestamp: Date.now(),
  };

  const targetPeer = registry.getPeer(to);

  if (targetPeer && registry.isOnline(to)) {
    sendMessage(targetPeer.socket, forwardMessage);
    registry.updateLastSeen(to);
    logger.info(`[Handlers] Forwarded answer: ${from} -> ${to}`);
  } else {
    queue.enqueue(to, forwardMessage);

    sendMessage(socket, {
      type: 'peer-offline',
      peerId: to,
      messageType: 'answer',
      timestamp: Date.now(),
    });

    logger.info(`[Handlers] Target offline, queued answer: ${from} -> ${to}`);
  }
}

/**
 * Handle single ICE candidate
 * @param {WebSocket} socket - Client WebSocket
 * @param {Object} message - ICE candidate message
 * @param {SignalingPeerRegistry} registry - Peer registry
 * @param {SignalingMessageQueue} queue - Message queue
 * @param {Function} sendMessage - Function to send messages
 */
function handleIceCandidate(socket, message, registry, queue, sendMessage) {
  const { to, candidate } = message;

  if (!to) {
    sendMessage(socket, {
      type: 'error',
      error: 'Missing "to" field in ice-candidate',
      timestamp: Date.now(),
    });
    return;
  }

  const from = socket.peerId || message.from;

  const forwardMessage = {
    type: 'ice-candidate',
    from,
    candidate,
    timestamp: Date.now(),
  };

  const targetPeer = registry.getPeer(to);

  if (targetPeer && registry.isOnline(to)) {
    sendMessage(targetPeer.socket, forwardMessage);
    registry.updateLastSeen(to);
    // Don't log every ICE candidate to avoid spam
  } else {
    queue.enqueue(to, forwardMessage);
  }
}

/**
 * Handle batched ICE candidates
 * @param {WebSocket} socket - Client WebSocket
 * @param {Object} message - ICE candidates message
 * @param {SignalingPeerRegistry} registry - Peer registry
 * @param {SignalingMessageQueue} queue - Message queue
 * @param {Function} sendMessage - Function to send messages
 */
function handleIceCandidates(socket, message, registry, queue, sendMessage) {
  const { to, candidates } = message;

  if (!to) {
    sendMessage(socket, {
      type: 'error',
      error: 'Missing "to" field in ice-candidates',
      timestamp: Date.now(),
    });
    return;
  }

  if (!candidates || !Array.isArray(candidates)) {
    sendMessage(socket, {
      type: 'error',
      error: 'Invalid candidates array in ice-candidates',
      timestamp: Date.now(),
    });
    return;
  }

  const from = socket.peerId || message.from;

  const forwardMessage = {
    type: 'ice-candidates',
    from,
    candidates,
    timestamp: Date.now(),
  };

  const targetPeer = registry.getPeer(to);

  if (targetPeer && registry.isOnline(to)) {
    sendMessage(targetPeer.socket, forwardMessage);
    registry.updateLastSeen(to);
    logger.info(`[Handlers] Forwarded ${candidates.length} ICE candidates: ${from} -> ${to}`);
  } else {
    queue.enqueue(to, forwardMessage);
    logger.info(`[Handlers] Target offline, queued ${candidates.length} ICE candidates: ${from} -> ${to}`);
  }
}

/**
 * Handle P2P business message
 * @param {WebSocket} socket - Client WebSocket
 * @param {Object} message - P2P message
 * @param {SignalingPeerRegistry} registry - Peer registry
 * @param {SignalingMessageQueue} queue - Message queue
 * @param {Function} sendMessage - Function to send messages
 */
function handleMessage(socket, message, registry, queue, sendMessage) {
  const { to, payload } = message;

  if (!to) {
    sendMessage(socket, {
      type: 'error',
      error: 'Missing "to" field in message',
      timestamp: Date.now(),
    });
    return;
  }

  if (!payload) {
    sendMessage(socket, {
      type: 'error',
      error: 'Missing "payload" field in message',
      timestamp: Date.now(),
    });
    return;
  }

  const from = socket.peerId || message.from;

  const forwardMessage = {
    type: 'message',
    from,
    payload,
    timestamp: Date.now(),
  };

  const targetPeer = registry.getPeer(to);

  if (targetPeer && registry.isOnline(to)) {
    sendMessage(targetPeer.socket, forwardMessage);
    registry.updateLastSeen(to);
    logger.info(`[Handlers] Forwarded message: ${from} -> ${to}`);
  } else {
    queue.enqueue(to, forwardMessage);

    sendMessage(socket, {
      type: 'peer-offline',
      peerId: to,
      messageType: 'message',
      timestamp: Date.now(),
    });

    logger.info(`[Handlers] Target offline, queued message: ${from} -> ${to}`);
  }
}

/**
 * Handle peer status request
 * @param {WebSocket} socket - Client WebSocket
 * @param {Object} message - Status request message
 * @param {SignalingPeerRegistry} registry - Peer registry
 * @param {Function} sendMessage - Function to send messages
 */
function handlePeerStatusRequest(socket, message, registry, sendMessage) {
  const { peerId } = message;

  if (peerId) {
    // Status for specific peer
    const isOnline = registry.isOnline(peerId);
    const peerInfo = registry.getPeer(peerId);

    sendMessage(socket, {
      type: 'peer-status-response',
      peerId,
      status: isOnline ? 'online' : 'offline',
      deviceType: peerInfo?.deviceType,
      deviceInfo: peerInfo?.deviceInfo,
      timestamp: Date.now(),
    });
  } else {
    // Get all peers
    const onlinePeers = registry.getOnlinePeers();

    sendMessage(socket, {
      type: 'peers-list',
      peers: onlinePeers,
      count: onlinePeers.length,
      timestamp: Date.now(),
    });
  }
}

/**
 * Handle get-peers request
 * @param {WebSocket} socket - Client WebSocket
 * @param {SignalingPeerRegistry} registry - Peer registry
 * @param {Function} sendMessage - Function to send messages
 */
function handleGetPeers(socket, registry, sendMessage) {
  const onlinePeers = registry.getOnlinePeers();

  // Exclude the requesting peer from the list
  const peers = onlinePeers.filter(peer => peer.peerId !== socket.peerId);

  sendMessage(socket, {
    type: 'peers-list',
    peers,
    count: peers.length,
    timestamp: Date.now(),
  });
}

/**
 * Handle pairing messages (request, confirmation, reject)
 * @param {WebSocket} socket - Client WebSocket
 * @param {Object} message - Pairing message
 * @param {SignalingPeerRegistry} registry - Peer registry
 * @param {SignalingMessageQueue} queue - Message queue
 * @param {Function} sendMessage - Function to send messages
 */
function handlePairing(socket, message, registry, queue, sendMessage) {
  const { to } = message;

  if (!to) {
    sendMessage(socket, {
      type: 'error',
      error: `Missing "to" field in ${message.type}`,
      timestamp: Date.now(),
    });
    return;
  }

  const from = socket.peerId || message.from;
  const forwardMessage = {
    ...message,
    from,
    timestamp: Date.now(),
  };

  const targetPeer = registry.getPeer(to);

  if (targetPeer && registry.isOnline(to)) {
    sendMessage(targetPeer.socket, forwardMessage);
    registry.updateLastSeen(to);
    logger.info(`[Handlers] Forwarded ${message.type}: ${from} -> ${to}`);
  } else {
    queue.enqueue(to, forwardMessage);

    sendMessage(socket, {
      type: 'peer-offline',
      peerId: to,
      messageType: message.type,
      timestamp: Date.now(),
    });

    logger.info(`[Handlers] Target offline, queued ${message.type}: ${from} -> ${to}`);
  }
}

/**
 * Handle ping message
 * @param {WebSocket} socket - Client WebSocket
 * @param {Function} sendMessage - Function to send messages
 */
function handlePing(socket, sendMessage) {
  sendMessage(socket, {
    type: 'pong',
    timestamp: Date.now(),
  });
}

module.exports = {
  handleRegister,
  handleOffer,
  handleAnswer,
  handleIceCandidate,
  handleIceCandidates,
  handleMessage,
  handlePeerStatusRequest,
  handleGetPeers,
  handlePairing,
  handlePing,
};
