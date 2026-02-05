package com.chainlesschain.android.feature.p2p.webrtc.transfer

import com.chainlesschain.android.feature.p2p.webrtc.channel.ChannelType
import com.chainlesschain.android.feature.p2p.webrtc.channel.DataChannelManager
import com.chainlesschain.android.feature.p2p.webrtc.channel.IncomingMessage
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import timber.log.Timber
import java.io.File
import java.io.RandomAccessFile
import java.security.MessageDigest
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.math.ceil

/**
 * File transfer manager for P2P file sharing
 *
 * Features:
 * - Chunked transfer with configurable chunk size
 * - Pause/resume support
 * - SHA-256 checksum verification
 * - Progress tracking
 * - Concurrent transfers
 */
@Singleton
class FileTransferManager @Inject constructor(
    private val dataChannelManager: DataChannelManager,
    private val json: Json
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private val activeTransfers = mutableMapOf<String, FileTransferState>()

    private val _transferProgress = MutableSharedFlow<TransferProgress>(
        extraBufferCapacity = 32,
        onBufferOverflow = BufferOverflow.DROP_OLDEST
    )
    val transferProgress: SharedFlow<TransferProgress> = _transferProgress.asSharedFlow()

    companion object {
        private const val CHUNK_SIZE = 64 * 1024 // 64KB chunks
        private const val MAX_CONCURRENT_CHUNKS = 4
    }

    init {
        // Listen for incoming transfer messages
        scope.launch {
            dataChannelManager.incomingMessages
                .filter { it.channelType == ChannelType.RELIABLE }
                .collect { message ->
                    handleIncomingMessage(message)
                }
        }
    }

    /**
     * Send file to remote peer
     *
     * @param peerId Remote peer's DID
     * @param file File to send
     * @return Transfer ID
     */
    suspend fun sendFile(peerId: String, file: File): Result<String> {
        return withContext(Dispatchers.IO) {
            try {
                if (!file.exists() || !file.isFile) {
                    return@withContext Result.failure(
                        IllegalArgumentException("File does not exist or is not a file")
                    )
                }

                val transferId = UUID.randomUUID().toString()
                val fileSize = file.length()
                val totalChunks = ceil(fileSize.toDouble() / CHUNK_SIZE).toInt()
                val checksum = calculateChecksum(file)

                // Create transfer state
                val state = FileTransferState(
                    transferId = transferId,
                    peerId = peerId,
                    fileName = file.name,
                    fileSize = fileSize,
                    totalChunks = totalChunks,
                    direction = TransferDirection.OUTGOING,
                    file = file
                )
                activeTransfers[transferId] = state

                // Send start message
                val startMessage = TransferMessage.Start(
                    transferId = transferId,
                    fileName = file.name,
                    fileSize = fileSize,
                    totalChunks = totalChunks,
                    chunkSize = CHUNK_SIZE,
                    checksum = checksum
                )
                sendTransferMessage(peerId, startMessage)

                // Start sending chunks
                scope.launch {
                    sendFileChunks(transferId, peerId, file, totalChunks)
                }

                Timber.i("Started file transfer: $transferId (${file.name}, $fileSize bytes)")
                Result.success(transferId)
            } catch (e: Exception) {
                Timber.e(e, "Failed to start file transfer")
                Result.failure(e)
            }
        }
    }

    /**
     * Send file chunks
     */
    private suspend fun sendFileChunks(
        transferId: String,
        peerId: String,
        file: File,
        totalChunks: Int
    ) {
        withContext(Dispatchers.IO) {
            try {
                val state = activeTransfers[transferId] ?: return@withContext

                RandomAccessFile(file, "r").use { raf ->
                    var chunkIndex = 0
                    val buffer = ByteArray(CHUNK_SIZE)

                    while (chunkIndex < totalChunks && !state.isPaused && !state.isCancelled) {
                        // Read chunk
                        val bytesRead = raf.read(buffer)
                        if (bytesRead <= 0) break

                        val chunkData = if (bytesRead < CHUNK_SIZE) {
                            buffer.copyOf(bytesRead)
                        } else {
                            buffer
                        }

                        // Calculate chunk checksum
                        val chunkChecksum = calculateChecksum(chunkData)

                        // Send chunk message
                        val chunkMessage = TransferMessage.Chunk(
                            transferId = transferId,
                            chunkIndex = chunkIndex,
                            data = chunkData,
                            checksum = chunkChecksum
                        )
                        sendTransferMessage(peerId, chunkMessage)

                        // Wait for acknowledgment
                        delay(10) // Small delay to avoid overwhelming the receiver

                        // Update progress
                        state.sentChunks++
                        emitProgress(state)

                        chunkIndex++
                    }

                    if (!state.isCancelled) {
                        // Send complete message
                        val completeMessage = TransferMessage.Complete(
                            transferId = transferId,
                            success = true
                        )
                        sendTransferMessage(peerId, completeMessage)

                        state.isCompleted = true
                        emitProgress(state)
                        Timber.i("File transfer completed: $transferId")
                    }
                }
            } catch (e: Exception) {
                Timber.e(e, "Error sending file chunks for $transferId")
                val state = activeTransfers[transferId]
                state?.let {
                    it.error = e.message
                    emitProgress(it)
                }
            }
        }
    }

    /**
     * Handle incoming transfer message
     */
    private suspend fun handleIncomingMessage(message: IncomingMessage) {
        try {
            val text = String(message.data, Charsets.UTF_8)
            val transferMessage = json.decodeFromString<TransferMessage>(text)

            when (transferMessage) {
                is TransferMessage.Start -> handleStartMessage(transferMessage, message.peerId)
                is TransferMessage.Chunk -> handleChunkMessage(transferMessage, message.peerId)
                is TransferMessage.Ack -> handleAckMessage(transferMessage)
                is TransferMessage.Complete -> handleCompleteMessage(transferMessage)
            }
        } catch (e: Exception) {
            Timber.e(e, "Failed to handle incoming transfer message")
        }
    }

    /**
     * Handle start message (incoming file transfer)
     */
    private suspend fun handleStartMessage(message: TransferMessage.Start, peerId: String) {
        withContext(Dispatchers.IO) {
            try {
                // Create temporary file for receiving
                val tempFile = File.createTempFile("transfer_${message.transferId}", ".tmp")

                val state = FileTransferState(
                    transferId = message.transferId,
                    peerId = peerId,
                    fileName = message.fileName,
                    fileSize = message.fileSize,
                    totalChunks = message.totalChunks,
                    direction = TransferDirection.INCOMING,
                    file = tempFile,
                    expectedChecksum = message.checksum
                )
                activeTransfers[message.transferId] = state

                Timber.i("Receiving file: ${message.fileName} (${message.fileSize} bytes)")
                emitProgress(state)
            } catch (e: Exception) {
                Timber.e(e, "Failed to handle start message")
            }
        }
    }

    /**
     * Handle chunk message (receiving file chunk)
     */
    private suspend fun handleChunkMessage(message: TransferMessage.Chunk, peerId: String) {
        withContext(Dispatchers.IO) {
            try {
                val state = activeTransfers[message.transferId] ?: return@withContext

                // Verify chunk checksum
                val actualChecksum = calculateChecksum(message.data)
                if (actualChecksum != message.checksum) {
                    Timber.e("Chunk checksum mismatch for ${message.transferId}:${message.chunkIndex}")
                    return@withContext
                }

                // Write chunk to file
                RandomAccessFile(state.file, "rw").use { raf ->
                    raf.seek(message.chunkIndex.toLong() * CHUNK_SIZE)
                    raf.write(message.data)
                }

                // Update progress
                state.receivedChunks++
                emitProgress(state)

                // Send acknowledgment
                val ackMessage = TransferMessage.Ack(
                    transferId = message.transferId,
                    chunkIndex = message.chunkIndex
                )
                sendTransferMessage(peerId, ackMessage)

                Timber.d("Received chunk ${message.chunkIndex}/${state.totalChunks} for ${message.transferId}")
            } catch (e: Exception) {
                Timber.e(e, "Failed to handle chunk message")
            }
        }
    }

    /**
     * Handle acknowledgment message
     */
    private suspend fun handleAckMessage(message: TransferMessage.Ack) {
        // Optional: Track acknowledged chunks for reliability
        Timber.v("Chunk ${message.chunkIndex} acknowledged for ${message.transferId}")
    }

    /**
     * Handle complete message
     */
    private suspend fun handleCompleteMessage(message: TransferMessage.Complete) {
        withContext(Dispatchers.IO) {
            try {
                val state = activeTransfers[message.transferId] ?: return@withContext

                if (message.success) {
                    // Verify file checksum
                    val actualChecksum = calculateChecksum(state.file)
                    if (actualChecksum == state.expectedChecksum) {
                        state.isCompleted = true
                        Timber.i("File transfer completed and verified: ${message.transferId}")
                    } else {
                        state.error = "Checksum verification failed"
                        Timber.e("File checksum mismatch for ${message.transferId}")
                    }
                } else {
                    state.error = "Transfer failed"
                }

                emitProgress(state)
            } catch (e: Exception) {
                Timber.e(e, "Failed to handle complete message")
            }
        }
    }

    /**
     * Pause file transfer
     */
    fun pauseTransfer(transferId: String) {
        activeTransfers[transferId]?.let { state ->
            state.isPaused = true
            scope.launch {
                emitProgress(state)
            }
            Timber.i("Paused transfer: $transferId")
        }
    }

    /**
     * Resume file transfer
     */
    fun resumeTransfer(transferId: String) {
        activeTransfers[transferId]?.let { state ->
            state.isPaused = false
            scope.launch {
                if (state.direction == TransferDirection.OUTGOING) {
                    sendFileChunks(transferId, state.peerId, state.file, state.totalChunks)
                }
                emitProgress(state)
            }
            Timber.i("Resumed transfer: $transferId")
        }
    }

    /**
     * Cancel file transfer
     */
    fun cancelTransfer(transferId: String) {
        activeTransfers[transferId]?.let { state ->
            state.isCancelled = true
            scope.launch {
                val peerId = state.peerId
                val completeMessage = TransferMessage.Complete(
                    transferId = transferId,
                    success = false
                )
                sendTransferMessage(peerId, completeMessage)
                emitProgress(state)
            }
            Timber.i("Cancelled transfer: $transferId")
        }
    }

    /**
     * Get transfer state
     */
    fun getTransferState(transferId: String): FileTransferState? {
        return activeTransfers[transferId]
    }

    /**
     * Send transfer message
     */
    private suspend fun sendTransferMessage(peerId: String, message: TransferMessage) {
        val jsonString = json.encodeToString(message)
        val data = jsonString.toByteArray(Charsets.UTF_8)
        dataChannelManager.sendReliable(peerId, data, binary = false)
    }

    /**
     * Emit transfer progress
     */
    private suspend fun emitProgress(state: FileTransferState) {
        val progress = TransferProgress(
            transferId = state.transferId,
            fileName = state.fileName,
            fileSize = state.fileSize,
            direction = state.direction,
            sentChunks = state.sentChunks,
            receivedChunks = state.receivedChunks,
            totalChunks = state.totalChunks,
            isPaused = state.isPaused,
            isCompleted = state.isCompleted,
            isCancelled = state.isCancelled,
            error = state.error
        )
        _transferProgress.emit(progress)
    }

    /**
     * Calculate SHA-256 checksum
     */
    private fun calculateChecksum(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buffer = ByteArray(8192)
            var bytesRead: Int
            while (input.read(buffer).also { bytesRead = it } != -1) {
                digest.update(buffer, 0, bytesRead)
            }
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }

    /**
     * Calculate SHA-256 checksum for byte array
     */
    private fun calculateChecksum(data: ByteArray): String {
        val digest = MessageDigest.getInstance("SHA-256")
        digest.update(data)
        return digest.digest().joinToString("") { "%02x".format(it) }
    }

    /**
     * Cleanup resources
     */
    fun cleanup() {
        scope.cancel()
        activeTransfers.clear()
    }
}

/**
 * File transfer state
 */
data class FileTransferState(
    val transferId: String,
    val peerId: String,
    val fileName: String,
    val fileSize: Long,
    val totalChunks: Int,
    val direction: TransferDirection,
    val file: File,
    val expectedChecksum: String? = null,
    var sentChunks: Int = 0,
    var receivedChunks: Int = 0,
    var isPaused: Boolean = false,
    var isCompleted: Boolean = false,
    var isCancelled: Boolean = false,
    var error: String? = null
)

/**
 * Transfer direction
 */
enum class TransferDirection {
    OUTGOING,
    INCOMING
}

/**
 * Transfer progress
 */
data class TransferProgress(
    val transferId: String,
    val fileName: String,
    val fileSize: Long,
    val direction: TransferDirection,
    val sentChunks: Int,
    val receivedChunks: Int,
    val totalChunks: Int,
    val isPaused: Boolean,
    val isCompleted: Boolean,
    val isCancelled: Boolean,
    val error: String?
) {
    val progressPercent: Float
        get() {
            val chunks = if (direction == TransferDirection.OUTGOING) sentChunks else receivedChunks
            return if (totalChunks > 0) (chunks.toFloat() / totalChunks * 100) else 0f
        }
}

/**
 * Transfer protocol messages
 */
@Serializable
sealed class TransferMessage {
    @Serializable
    data class Start(
        val transferId: String,
        val fileName: String,
        val fileSize: Long,
        val totalChunks: Int,
        val chunkSize: Int,
        val checksum: String
    ) : TransferMessage()

    @Serializable
    data class Chunk(
        val transferId: String,
        val chunkIndex: Int,
        val data: ByteArray,
        val checksum: String
    ) : TransferMessage() {
        override fun equals(other: Any?): Boolean {
            if (this === other) return true
            if (javaClass != other?.javaClass) return false

            other as Chunk

            if (transferId != other.transferId) return false
            if (chunkIndex != other.chunkIndex) return false
            if (!data.contentEquals(other.data)) return false
            if (checksum != other.checksum) return false

            return true
        }

        override fun hashCode(): Int {
            var result = transferId.hashCode()
            result = 31 * result + chunkIndex
            result = 31 * result + data.contentHashCode()
            result = 31 * result + checksum.hashCode()
            return result
        }
    }

    @Serializable
    data class Ack(
        val transferId: String,
        val chunkIndex: Int
    ) : TransferMessage()

    @Serializable
    data class Complete(
        val transferId: String,
        val success: Boolean
    ) : TransferMessage()
}
