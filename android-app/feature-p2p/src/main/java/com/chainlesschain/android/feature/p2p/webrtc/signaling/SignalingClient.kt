package com.chainlesschain.android.feature.p2p.webrtc.signaling

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow

/**
 * Signaling client interface for WebRTC connection establishment
 *
 * Handles the exchange of SDP offers/answers and ICE candidates
 * between peers before the P2P connection is established.
 */
interface SignalingClient {
    /**
     * Current connection state
     */
    val connectionState: StateFlow<ConnectionState>

    /**
     * Incoming signaling messages
     */
    val incomingMessages: Flow<SignalingMessage>

    /**
     * Connect to signaling server
     *
     * @param userId Local user's DID
     * @param token Authentication token
     */
    suspend fun connect(userId: String, token: String): Result<Unit>

    /**
     * Disconnect from signaling server
     */
    suspend fun disconnect()

    /**
     * Send signaling message to remote peer
     *
     * @param message Message to send
     */
    suspend fun send(message: SignalingMessage): Result<Unit>

    /**
     * Check if connected to signaling server
     */
    fun isConnected(): Boolean
}

/**
 * Signaling connection state
 */
enum class ConnectionState {
    /**
     * Not connected
     */
    DISCONNECTED,

    /**
     * Attempting to connect
     */
    CONNECTING,

    /**
     * Connected and ready
     */
    CONNECTED,

    /**
     * Reconnecting after failure
     */
    RECONNECTING,

    /**
     * Failed to connect (permanent failure)
     */
    FAILED
}
