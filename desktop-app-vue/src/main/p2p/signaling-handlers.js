/**
 * Signaling Message Handlers
 *
 * Protocol message handlers for the embedded signaling server.
 * Handles all signaling message types: register, offer, answer, ice-candidate, etc.
 */

const { logger } = require("../utils/logger.js");

/**
 * Handle peer registration
 * @param {WebSocket} socket - Client WebSocket
 * @param {Object} message - Registration message
 * @param {SignalingPeerRegistry} registry - Peer registry
 * @param {SignalingMessageQueue} queue - Message queue
 * @param {Function} sendMessage - Function to send messages
 * @param {Function} broadcastPeerStatus - Function to broadcast peer status
 */
function handleRegister(
  socket,
  message,
  registry,
  queue,
  sendMessage,
  broadcastPeerStatus,
) {
  const { peerId, deviceInfo, deviceType } = message;

  logger.info(`[Handlers] ========================================`);
  logger.info(`[Handlers] 收到注册请求`);
  logger.info(`[Handlers] peerId: ${peerId}`);
  logger.info(`[Handlers] deviceType: ${deviceType || "unknown"}`);
  logger.info(`[Handlers] deviceInfo: ${JSON.stringify(deviceInfo || {})}`);
  logger.info(`[Handlers] ========================================`);

  if (!peerId) {
    sendMessage(socket, {
      type: "error",
      error: "peerId is required for registration",
      timestamp: Date.now(),
    });
    return;
  }

  // Check if peer already exists (important for MobileBridge replacing local registration)
  const existingPeer = registry.getPeer(peerId);
  if (existingPeer) {
    logger.info(`[Handlers] 已存在同ID节点:`);
    logger.info(`[Handlers]   isLocal: ${existingPeer.isLocal || false}`);
    logger.info(`[Handlers]   hasSocket: ${!!existingPeer.socket}`);
    logger.info(`[Handlers]   deviceType: ${existingPeer.deviceType}`);
    logger.info(`[Handlers] 将被新注册覆盖...`);
  }

  // Register the peer
  const result = registry.register(peerId, socket, deviceInfo, deviceType);

  // Close old connection if reconnecting
  if (result.previousConnection && result.previousConnection.socket) {
    try {
      result.previousConnection.socket.close();
      logger.info(`[Handlers] 已关闭旧连接`);
    } catch (error) {
      logger.warn(
        "[Handlers] Failed to close previous connection:",
        error.message,
      );
    }
  }

  // Store peerId on socket for later reference
  socket.peerId = peerId;

  // Send registration confirmation
  sendMessage(socket, {
    type: "registered",
    peerId,
    serverTime: Date.now(),
    isReconnect: result.isReconnect,
  });

  // Deliver any pending offline messages
  const pendingMessages = queue.dequeue(peerId);
  if (pendingMessages.length > 0) {
    logger.info(
      `[Handlers] 递送 ${pendingMessages.length} 条离线消息给 ${peerId}`,
    );

    for (const entry of pendingMessages) {
      sendMessage(socket, {
        type: "offline-message",
        originalMessage: entry.message,
        storedAt: entry.storedAt,
        deliveredAt: Date.now(),
      });
    }
  }

  // Broadcast peer online status to others
  broadcastPeerStatus(peerId, "online", { deviceType, deviceInfo });

  // Log final registration state
  const registeredPeer = registry.getPeer(peerId);
  logger.info(`[Handlers] ✓ 注册完成: ${peerId} (${deviceType || "unknown"})`);
  logger.info(`[Handlers]   hasSocket: ${!!registeredPeer?.socket}`);
  logger.info(`[Handlers]   isOnline: ${registry.isOnline(peerId)}`);
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

  logger.info(`[Handlers] ========================================`);
  logger.info(`[Handlers] 收到 Offer 消息`);
  logger.info(`[Handlers] From: ${socket.peerId || message.from}`);
  logger.info(`[Handlers] To: ${to}`);
  logger.info(`[Handlers] Offer类型: ${offer?.type || sdp?.type || "unknown"}`);
  logger.info(
    `[Handlers] SDP长度: ${offer?.sdp?.length || sdp?.sdp?.length || sdp?.length || 0}`,
  );

  // 列出所有已注册的节点
  const allPeerIds = registry.getAllPeerIds();
  logger.info(`[Handlers] 当前所有注册节点: [${allPeerIds.join(", ")}]`);
  logger.info(`[Handlers] ========================================`);

  if (!to) {
    sendMessage(socket, {
      type: "error",
      error: 'Missing "to" field in offer',
      timestamp: Date.now(),
    });
    return;
  }

  const from = socket.peerId || message.from;
  const offerPayload = offer || sdp; // Support both formats

  const forwardMessage = {
    type: "offer",
    from,
    offer: offerPayload,
    sdp: offerPayload, // Include both for compatibility
    iceRestart: iceRestart || false,
    timestamp: Date.now(),
  };

  const targetPeer = registry.getPeer(to);

  // Log target peer state for debugging
  if (targetPeer) {
    logger.info(`[Handlers] 目标节点信息:`);
    logger.info(`[Handlers]   deviceType: ${targetPeer.deviceType}`);
    logger.info(`[Handlers]   isLocal: ${targetPeer.isLocal || false}`);
    logger.info(`[Handlers]   hasSocket: ${!!targetPeer.socket}`);
    logger.info(`[Handlers]   isOnline: ${registry.isOnline(to)}`);
  } else {
    logger.warn(`[Handlers] 目标节点不存在: ${to}`);
    // Log all registered peers for debugging
    const allPeers = registry.getAllPeerIds();
    logger.info(`[Handlers] 当前注册的节点: ${allPeers.join(", ") || "无"}`);
  }

  if (targetPeer && registry.isOnline(to)) {
    // Check if target has a valid socket
    if (targetPeer.socket) {
      // Target is online with valid socket, forward directly
      sendMessage(targetPeer.socket, forwardMessage);
      registry.updateLastSeen(to);
      logger.info(`[Handlers] ✓ Offer已转发: ${from} -> ${to}`);
    } else if (targetPeer.isLocal) {
      // Target is local PC without socket (MobileBridge not yet connected)
      // Queue the message for later delivery when MobileBridge connects
      queue.enqueue(to, forwardMessage);
      logger.info(
        `[Handlers] ⏳ 目标是本地PC但MobileBridge未连接，Offer已入队: ${from} -> ${to}`,
      );

      // Notify sender to wait (not offline, just pending)
      sendMessage(socket, {
        type: "offer-pending",
        peerId: to,
        message: "PC is starting up, please wait...",
        timestamp: Date.now(),
      });
    } else {
      // Should not happen, but handle gracefully
      queue.enqueue(to, forwardMessage);
      logger.warn(
        `[Handlers] ⚠ 目标在线但无socket，Offer已入队: ${from} -> ${to}`,
      );
    }
  } else {
    // Target is offline, queue the message
    queue.enqueue(to, forwardMessage);

    // Notify sender that target is offline
    sendMessage(socket, {
      type: "peer-offline",
      peerId: to,
      messageType: "offer",
      timestamp: Date.now(),
    });

    logger.info(`[Handlers] ✗ 目标离线，Offer已入队: ${from} -> ${to}`);
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
      type: "error",
      error: 'Missing "to" field in answer',
      timestamp: Date.now(),
    });
    return;
  }

  const from = socket.peerId || message.from;
  const answerPayload = answer || sdp;

  const forwardMessage = {
    type: "answer",
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
      type: "peer-offline",
      peerId: to,
      messageType: "answer",
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
      type: "error",
      error: 'Missing "to" field in ice-candidate',
      timestamp: Date.now(),
    });
    return;
  }

  const from = socket.peerId || message.from;

  const forwardMessage = {
    type: "ice-candidate",
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
      type: "error",
      error: 'Missing "to" field in ice-candidates',
      timestamp: Date.now(),
    });
    return;
  }

  if (!candidates || !Array.isArray(candidates)) {
    sendMessage(socket, {
      type: "error",
      error: "Invalid candidates array in ice-candidates",
      timestamp: Date.now(),
    });
    return;
  }

  const from = socket.peerId || message.from;

  const forwardMessage = {
    type: "ice-candidates",
    from,
    candidates,
    timestamp: Date.now(),
  };

  const targetPeer = registry.getPeer(to);

  if (targetPeer && registry.isOnline(to)) {
    sendMessage(targetPeer.socket, forwardMessage);
    registry.updateLastSeen(to);
    logger.info(
      `[Handlers] Forwarded ${candidates.length} ICE candidates: ${from} -> ${to}`,
    );
  } else {
    queue.enqueue(to, forwardMessage);
    logger.info(
      `[Handlers] Target offline, queued ${candidates.length} ICE candidates: ${from} -> ${to}`,
    );
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
      type: "error",
      error: 'Missing "to" field in message',
      timestamp: Date.now(),
    });
    return;
  }

  if (!payload) {
    sendMessage(socket, {
      type: "error",
      error: 'Missing "payload" field in message',
      timestamp: Date.now(),
    });
    return;
  }

  const from = socket.peerId || message.from;

  const forwardMessage = {
    type: "message",
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
      type: "peer-offline",
      peerId: to,
      messageType: "message",
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
      type: "peer-status-response",
      peerId,
      status: isOnline ? "online" : "offline",
      deviceType: peerInfo?.deviceType,
      deviceInfo: peerInfo?.deviceInfo,
      timestamp: Date.now(),
    });
  } else {
    // Get all peers
    const onlinePeers = registry.getOnlinePeers();

    sendMessage(socket, {
      type: "peers-list",
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
  const peers = onlinePeers.filter((peer) => peer.peerId !== socket.peerId);

  sendMessage(socket, {
    type: "peers-list",
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
      type: "error",
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
      type: "peer-offline",
      peerId: to,
      messageType: message.type,
      timestamp: Date.now(),
    });

    logger.info(
      `[Handlers] Target offline, queued ${message.type}: ${from} -> ${to}`,
    );
  }
}

/**
 * Handle ping message
 * @param {WebSocket} socket - Client WebSocket
 * @param {Function} sendMessage - Function to send messages
 */
function handlePing(socket, sendMessage) {
  sendMessage(socket, {
    type: "pong",
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
