package com.chainlesschain.android.core.p2p.filetransfer

import android.util.Log
import com.chainlesschain.android.core.p2p.filetransfer.model.FileChunk
import kotlinx.coroutines.*
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.atomic.AtomicInteger
import javax.inject.Inject
import javax.inject.Singleton

/**
 * ByteArray 对象池
 *
 * 重用 ByteArray 以减少 GC 压力和内存分配开销。
 * 特别适用于频繁的文件分块读写操作。
 *
 * 特性：
 * - 多种大小的缓冲区池
 * - 自动扩展和收缩
 * - 线程安全
 * - 统计信息
 */
@Singleton
class ByteArrayPool @Inject constructor() {

    companion object {
        private const val TAG = "ByteArrayPool"

        // 池大小配置
        const val SMALL_BUFFER_SIZE = 64 * 1024    // 64KB
        const val MEDIUM_BUFFER_SIZE = 256 * 1024  // 256KB
        const val LARGE_BUFFER_SIZE = 512 * 1024   // 512KB
        const val XLARGE_BUFFER_SIZE = 1024 * 1024 // 1MB

        // 每种大小的最大池数量
        const val MAX_POOL_SIZE = 8
    }

    // 不同大小的缓冲区池
    private val smallPool = ConcurrentLinkedQueue<ByteArray>()
    private val mediumPool = ConcurrentLinkedQueue<ByteArray>()
    private val largePool = ConcurrentLinkedQueue<ByteArray>()
    private val xlargePool = ConcurrentLinkedQueue<ByteArray>()

    // 统计信息
    private val _stats = MutableStateFlow(PoolStats())
    val stats: StateFlow<PoolStats> = _stats.asStateFlow()

    private val hits = AtomicInteger(0)
    private val misses = AtomicInteger(0)
    private val allocations = AtomicInteger(0)

    /**
     * 获取指定大小的缓冲区
     *
     * 优先从池中获取，如果池为空则新建
     */
    fun acquire(size: Int): ByteArray {
        val pool = getPoolForSize(size)
        val buffer = pool?.poll()

        return if (buffer != null && buffer.size >= size) {
            hits.incrementAndGet()
            updateStats()
            buffer
        } else {
            misses.incrementAndGet()
            allocations.incrementAndGet()
            updateStats()
            ByteArray(getNormalizedSize(size))
        }
    }

    /**
     * 释放缓冲区回池
     *
     * 如果池已满，缓冲区将被丢弃（由GC回收）
     */
    fun release(buffer: ByteArray) {
        val pool = getPoolForSize(buffer.size) ?: return

        if (pool.size < MAX_POOL_SIZE) {
            // 清零缓冲区（安全考虑）
            buffer.fill(0)
            pool.offer(buffer)
        }
        // 如果池已满，让 GC 回收

        updateStats()
    }

    /**
     * 清空所有池
     */
    fun clear() {
        smallPool.clear()
        mediumPool.clear()
        largePool.clear()
        xlargePool.clear()

        hits.set(0)
        misses.set(0)
        allocations.set(0)

        updateStats()
        Log.i(TAG, "Pool cleared")
    }

    /**
     * 预热池（预分配缓冲区）
     */
    fun warmup(smallCount: Int = 2, mediumCount: Int = 4, largeCount: Int = 2) {
        repeat(smallCount) {
            smallPool.offer(ByteArray(SMALL_BUFFER_SIZE))
        }
        repeat(mediumCount) {
            mediumPool.offer(ByteArray(MEDIUM_BUFFER_SIZE))
        }
        repeat(largeCount) {
            largePool.offer(ByteArray(LARGE_BUFFER_SIZE))
        }

        allocations.addAndGet(smallCount + mediumCount + largeCount)
        updateStats()
        Log.i(TAG, "Pool warmed up: small=$smallCount, medium=$mediumCount, large=$largeCount")
    }

    private fun getPoolForSize(size: Int): ConcurrentLinkedQueue<ByteArray>? {
        return when {
            size <= SMALL_BUFFER_SIZE -> smallPool
            size <= MEDIUM_BUFFER_SIZE -> mediumPool
            size <= LARGE_BUFFER_SIZE -> largePool
            size <= XLARGE_BUFFER_SIZE -> xlargePool
            else -> null // 超大缓冲区不池化
        }
    }

    private fun getNormalizedSize(size: Int): Int {
        return when {
            size <= SMALL_BUFFER_SIZE -> SMALL_BUFFER_SIZE
            size <= MEDIUM_BUFFER_SIZE -> MEDIUM_BUFFER_SIZE
            size <= LARGE_BUFFER_SIZE -> LARGE_BUFFER_SIZE
            size <= XLARGE_BUFFER_SIZE -> XLARGE_BUFFER_SIZE
            else -> size // 超大缓冲区使用实际大小
        }
    }

    private fun updateStats() {
        val totalHits = hits.get()
        val totalMisses = misses.get()
        val total = totalHits + totalMisses

        _stats.value = PoolStats(
            smallPoolSize = smallPool.size,
            mediumPoolSize = mediumPool.size,
            largePoolSize = largePool.size,
            xlargePoolSize = xlargePool.size,
            totalAllocations = allocations.get(),
            hitRate = if (total > 0) totalHits.toFloat() / total else 0f,
            hits = totalHits,
            misses = totalMisses
        )
    }

    /**
     * 池统计信息
     */
    data class PoolStats(
        val smallPoolSize: Int = 0,
        val mediumPoolSize: Int = 0,
        val largePoolSize: Int = 0,
        val xlargePoolSize: Int = 0,
        val totalAllocations: Int = 0,
        val hitRate: Float = 0f,
        val hits: Int = 0,
        val misses: Int = 0
    ) {
        val totalPoolSize: Int
            get() = smallPoolSize + mediumPoolSize + largePoolSize + xlargePoolSize
    }
}

/**
 * 分块预读缓冲区
 *
 * 在发送分块时预先读取后续分块，减少 I/O 等待时间。
 *
 * 特性：
 * - 异步预读指定数量的分块
 * - 自动管理缓冲区生命周期
 * - 支持取消和清理
 */
class ChunkReadAheadBuffer(
    private val fileChunker: FileChunker,
    private val byteArrayPool: ByteArrayPool,
    private val readAheadCount: Int = 3
) {
    companion object {
        private const val TAG = "ChunkReadAheadBuffer"
    }

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    // 预读分块通道
    private var chunkChannel: Channel<FileChunk>? = null

    // 预读任务
    private var readAheadJob: Job? = null

    // 当前传输状态
    @Volatile
    private var currentTransferId: String? = null
    @Volatile
    private var isActive = false

    /**
     * 开始预读
     */
    fun start(
        transferId: String,
        uri: android.net.Uri,
        startChunk: Int,
        totalChunks: Int,
        chunkSize: Int,
        mimeType: String?,
        enableCompression: Boolean
    ) {
        stop() // 停止之前的预读

        currentTransferId = transferId
        isActive = true
        chunkChannel = Channel(readAheadCount)

        readAheadJob = scope.launch {
            var currentChunk = startChunk

            while (isActive && currentChunk < totalChunks) {
                try {
                    val chunk = fileChunker.readChunk(
                        uri = uri,
                        chunkIndex = currentChunk,
                        chunkSize = chunkSize,
                        totalChunks = totalChunks,
                        transferId = transferId,
                        mimeType = mimeType,
                        enableCompression = enableCompression
                    )

                    chunkChannel?.send(chunk)
                    currentChunk++

                    Log.d(TAG, "Pre-read chunk $currentChunk/$totalChunks for $transferId")
                } catch (e: Exception) {
                    if (e is CancellationException) throw e
                    Log.e(TAG, "Error pre-reading chunk $currentChunk", e)
                    break
                }
            }

            Log.d(TAG, "Read-ahead completed for $transferId")
        }

        Log.i(TAG, "Started read-ahead for $transferId from chunk $startChunk")
    }

    /**
     * 获取下一个预读的分块
     *
     * @return 预读的分块，如果没有可用的则返回 null
     */
    suspend fun getNextChunk(): FileChunk? {
        return try {
            chunkChannel?.receive()
        } catch (e: Exception) {
            null
        }
    }

    /**
     * 尝试获取预读分块（非阻塞）
     */
    fun tryGetNextChunk(): FileChunk? {
        return chunkChannel?.tryReceive()?.getOrNull()
    }

    /**
     * 检查是否有预读分块可用
     */
    fun hasBufferedChunks(): Boolean {
        return chunkChannel?.isEmpty == false
    }

    /**
     * 获取当前缓冲的分块数量
     */
    fun getBufferedCount(): Int {
        // Channel 没有直接的 size 属性，这是近似值
        return if (chunkChannel?.isEmpty == true) 0 else readAheadCount
    }

    /**
     * 停止预读并清理资源
     */
    fun stop() {
        isActive = false
        readAheadJob?.cancel()
        readAheadJob = null
        chunkChannel?.close()
        chunkChannel = null
        currentTransferId = null

        Log.d(TAG, "Read-ahead stopped")
    }

    /**
     * 跳到指定分块（用于恢复传输）
     */
    fun skipTo(
        chunkIndex: Int,
        uri: android.net.Uri,
        totalChunks: Int,
        chunkSize: Int,
        mimeType: String?,
        enableCompression: Boolean
    ) {
        val transferId = currentTransferId ?: return

        stop()
        start(transferId, uri, chunkIndex, totalChunks, chunkSize, mimeType, enableCompression)

        Log.i(TAG, "Skipped to chunk $chunkIndex")
    }
}

/**
 * 分块缓冲区管理器
 *
 * 为多个传输管理独立的预读缓冲区
 */
@Singleton
class ChunkBufferManager @Inject constructor(
    private val fileChunker: FileChunker,
    private val byteArrayPool: ByteArrayPool
) {
    companion object {
        private const val TAG = "ChunkBufferManager"
        private const val DEFAULT_READ_AHEAD_COUNT = 3
    }

    // 每个传输的缓冲区
    private val buffers = mutableMapOf<String, ChunkReadAheadBuffer>()

    /**
     * 为传输创建预读缓冲区
     */
    fun createBuffer(
        transferId: String,
        uri: android.net.Uri,
        startChunk: Int,
        totalChunks: Int,
        chunkSize: Int,
        mimeType: String?,
        enableCompression: Boolean,
        readAheadCount: Int = DEFAULT_READ_AHEAD_COUNT
    ): ChunkReadAheadBuffer {
        // 清理已存在的缓冲区
        buffers[transferId]?.stop()

        val buffer = ChunkReadAheadBuffer(fileChunker, byteArrayPool, readAheadCount)
        buffer.start(transferId, uri, startChunk, totalChunks, chunkSize, mimeType, enableCompression)

        buffers[transferId] = buffer
        Log.i(TAG, "Created buffer for $transferId")

        return buffer
    }

    /**
     * 获取传输的缓冲区
     */
    fun getBuffer(transferId: String): ChunkReadAheadBuffer? = buffers[transferId]

    /**
     * 移除传输的缓冲区
     */
    fun removeBuffer(transferId: String) {
        buffers.remove(transferId)?.stop()
        Log.d(TAG, "Removed buffer for $transferId")
    }

    /**
     * 清理所有缓冲区
     */
    fun clearAll() {
        buffers.values.forEach { it.stop() }
        buffers.clear()
        Log.i(TAG, "Cleared all buffers")
    }
}
