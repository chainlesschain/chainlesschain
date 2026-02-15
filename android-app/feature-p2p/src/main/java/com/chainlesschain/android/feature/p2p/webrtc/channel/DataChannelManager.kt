package com.chainlesschain.android.feature.p2p.webrtc.channel

import com.chainlesschain.android.feature.p2p.webrtc.connection.WebRTCConnectionManager
import kotlinx.coroutines.*
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import org.webrtc.DataChannel
import org.webrtc.PeerConnection
import timber.log.Timber
import java.nio.ByteBuffer
import java.nio.charset.StandardCharsets
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Data channel manager for WebRTC
 *
 * Manages two types of data channels:
 * 1. Reliable channel: Ordered, infinite retransmit (for file transfer, critical messages)
 * 2. Unreliable channel: Unordered, limited lifetime (for realtime messaging, low-latency)
 */
@Singleton
class DataChannelManager @Inject constructor(
    private val connectionManager: WebRTCConnectionManager
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    private val dataChannels = mutableMapOf<String, DataChannelPair>()

    private val _incomingMessages = MutableSharedFlow<IncomingMessage>(
        extraBufferCapacity = 64,
        onBufferOverflow = BufferOverflow.DROP_OLDEST
    )
    val incomingMessages: SharedFlow<IncomingMessage> = _incomingMessages.asSharedFlow()

    /**
     * Create data channels for a peer
     *
     * @param peerId Remote peer's DID
     * @return Result containing the created channel pair
     */
    suspend fun createDataChannels(peerId: String): Result<DataChannelPair> {
        return withContext(Dispatchers.Default) {
            try {
                val peerConnection = connectionManager.getPeerConnection(peerId)
                    ?: return@withContext Result.failure(
                        IllegalStateException("No peer connection found for $peerId")
                    )

                val reliableChannel = createReliableChannel(peerConnection, peerId)
                val unreliableChannel = createUnreliableChannel(peerConnection, peerId)

                val channelPair = DataChannelPair(reliableChannel, unreliableChannel, peerId)
                dataChannels[peerId] = channelPair

                Timber.i("Created data channels for $peerId")
                Result.success(channelPair)
            } catch (e: Exception) {
                Timber.e(e, "Failed to create data channels for $peerId")
                Result.failure(e)
            }
        }
    }

    /**
     * Send message over reliable channel
     *
     * @param peerId Remote peer's DID
     * @param data Message data
     * @param binary True for binary data, false for text
     */
    suspend fun sendReliable(peerId: String, data: ByteArray, binary: Boolean = true): Result<Unit> {
        return withContext(Dispatchers.Default) {
            try {
                val channelPair = dataChannels[peerId]
                    ?: return@withContext Result.failure(
                        IllegalStateException("No data channels found for $peerId")
                    )

                val buffer = DataChannel.Buffer(ByteBuffer.wrap(data), binary)
                val success = channelPair.reliableChannel.send(buffer)

                if (success) {
                    Timber.d("Sent reliable message to $peerId (${data.size} bytes)")
                    Result.success(Unit)
                } else {
                    Timber.w("Failed to send reliable message to $peerId (buffer full)")
                    Result.failure(IllegalStateException("Data channel buffer full"))
                }
            } catch (e: Exception) {
                Timber.e(e, "Error sending reliable message to $peerId")
                Result.failure(e)
            }
        }
    }

    /**
     * Send message over unreliable channel (low latency)
     *
     * @param peerId Remote peer's DID
     * @param data Message data
     * @param binary True for binary data, false for text
     */
    suspend fun sendUnreliable(peerId: String, data: ByteArray, binary: Boolean = true): Result<Unit> {
        return withContext(Dispatchers.Default) {
            try {
                val channelPair = dataChannels[peerId]
                    ?: return@withContext Result.failure(
                        IllegalStateException("No data channels found for $peerId")
                    )

                val buffer = DataChannel.Buffer(ByteBuffer.wrap(data), binary)
                val success = channelPair.unreliableChannel.send(buffer)

                if (success) {
                    Timber.v("Sent unreliable message to $peerId (${data.size} bytes)")
                    Result.success(Unit)
                } else {
                    Timber.v("Failed to send unreliable message to $peerId (dropped)")
                    Result.failure(IllegalStateException("Data channel send failed"))
                }
            } catch (e: Exception) {
                Timber.e(e, "Error sending unreliable message to $peerId")
                Result.failure(e)
            }
        }
    }

    /**
     * Send text message over reliable channel
     */
    suspend fun sendText(peerId: String, text: String): Result<Unit> {
        val data = text.toByteArray(StandardCharsets.UTF_8)
        return sendReliable(peerId, data, binary = false)
    }

    /**
     * Close data channels for a peer
     */
    suspend fun closeDataChannels(peerId: String) {
        withContext(Dispatchers.Default) {
            dataChannels.remove(peerId)?.let { pair ->
                pair.reliableChannel.close()
                pair.unreliableChannel.close()
                Timber.i("Closed data channels for $peerId")
            }
        }
    }

    /**
     * Create reliable data channel (ordered, infinite retransmit)
     */
    private fun createReliableChannel(
        peerConnection: PeerConnection,
        peerId: String
    ): DataChannel {
        val init = DataChannel.Init().apply {
            ordered = true
            maxRetransmits = -1 // Infinite retransmits
            negotiated = false
        }

        val channel = peerConnection.createDataChannel("reliable-$peerId", init)
            ?: throw IllegalStateException("Failed to create reliable data channel for $peerId")
        channel.registerObserver(createDataChannelObserver(peerId, ChannelType.RELIABLE))

        Timber.d("Created reliable data channel for $peerId")
        return channel
    }

    /**
     * Create unreliable data channel (unordered, limited lifetime)
     */
    private fun createUnreliableChannel(
        peerConnection: PeerConnection,
        peerId: String
    ): DataChannel {
        val init = DataChannel.Init().apply {
            ordered = false
            maxRetransmitTimeMs = 1000 // 1 second max lifetime
            negotiated = false
        }

        val channel = peerConnection.createDataChannel("unreliable-$peerId", init)
            ?: throw IllegalStateException("Failed to create unreliable data channel for $peerId")
        channel.registerObserver(createDataChannelObserver(peerId, ChannelType.UNRELIABLE))

        Timber.d("Created unreliable data channel for $peerId")
        return channel
    }

    /**
     * Create data channel observer
     */
    private fun createDataChannelObserver(
        peerId: String,
        channelType: ChannelType
    ): DataChannel.Observer {
        return object : DataChannel.Observer {
            override fun onBufferedAmountChange(previousAmount: Long) {
                Timber.v("[$channelType] Buffered amount changed: $previousAmount for $peerId")
            }

            override fun onStateChange() {
                val channelPair = dataChannels[peerId] ?: return
                val channel = when (channelType) {
                    ChannelType.RELIABLE -> channelPair.reliableChannel
                    ChannelType.UNRELIABLE -> channelPair.unreliableChannel
                }

                Timber.i("[$channelType] State changed: ${channel.state()} for $peerId")

                if (channel.state() == DataChannel.State.OPEN) {
                    Timber.i("[$channelType] Data channel OPEN for $peerId")
                }
            }

            override fun onMessage(buffer: DataChannel.Buffer?) {
                buffer?.let {
                    scope.launch {
                        try {
                            val data = ByteArray(it.data.remaining())
                            it.data.get(data)

                            val message = IncomingMessage(
                                peerId = peerId,
                                data = data,
                                binary = it.binary,
                                channelType = channelType,
                                timestamp = System.currentTimeMillis()
                            )

                            _incomingMessages.emit(message)

                            if (it.binary) {
                                Timber.d("[$channelType] Received binary message from $peerId (${data.size} bytes)")
                            } else {
                                val text = String(data, StandardCharsets.UTF_8)
                                Timber.d("[$channelType] Received text message from $peerId: $text")
                            }
                        } catch (e: Exception) {
                            Timber.e(e, "Error processing incoming message from $peerId")
                        }
                    }
                }
            }
        }
    }

    /**
     * Get data channel state
     */
    fun getChannelState(peerId: String): DataChannelState? {
        val pair = dataChannels[peerId] ?: return null
        return DataChannelState(
            reliableState = pair.reliableChannel.state(),
            unreliableState = pair.unreliableChannel.state()
        )
    }

    /**
     * Check if data channels are ready for a peer
     */
    fun isReady(peerId: String): Boolean {
        val pair = dataChannels[peerId] ?: return false
        return pair.reliableChannel.state() == DataChannel.State.OPEN &&
                pair.unreliableChannel.state() == DataChannel.State.OPEN
    }

    /**
     * Cleanup resources
     */
    fun cleanup() {
        scope.cancel()
        dataChannels.values.forEach { pair ->
            pair.reliableChannel.close()
            pair.unreliableChannel.close()
        }
        dataChannels.clear()
    }
}

/**
 * Data channel pair for a peer
 */
data class DataChannelPair(
    val reliableChannel: DataChannel,
    val unreliableChannel: DataChannel,
    val peerId: String
)

/**
 * Incoming message from data channel
 */
data class IncomingMessage(
    val peerId: String,
    val data: ByteArray,
    val binary: Boolean,
    val channelType: ChannelType,
    val timestamp: Long
) {
    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (javaClass != other?.javaClass) return false

        other as IncomingMessage

        if (peerId != other.peerId) return false
        if (!data.contentEquals(other.data)) return false
        if (binary != other.binary) return false
        if (channelType != other.channelType) return false
        if (timestamp != other.timestamp) return false

        return true
    }

    override fun hashCode(): Int {
        var result = peerId.hashCode()
        result = 31 * result + data.contentHashCode()
        result = 31 * result + binary.hashCode()
        result = 31 * result + channelType.hashCode()
        result = 31 * result + timestamp.hashCode()
        return result
    }
}

/**
 * Channel type
 */
enum class ChannelType {
    RELIABLE,
    UNRELIABLE
}

/**
 * Data channel state
 */
data class DataChannelState(
    val reliableState: DataChannel.State,
    val unreliableState: DataChannel.State
)
