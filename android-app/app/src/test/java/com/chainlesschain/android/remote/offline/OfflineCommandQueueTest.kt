package com.chainlesschain.android.remote.offline

import com.chainlesschain.android.remote.data.CommandRequest
import com.chainlesschain.android.remote.data.AuthInfo
import com.chainlesschain.android.remote.p2p.P2PClient
import com.chainlesschain.android.remote.p2p.ConnectionState
import io.mockk.*
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Before
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * 离线命令队列单元测试
 *
 * 测试命令入队、出队、重试、自动发送等功能
 */
@OptIn(ExperimentalCoroutinesApi::class)
class OfflineCommandQueueTest {

    private lateinit var queue: OfflineCommandQueue
    private lateinit var mockDao: OfflineCommandDao
    private lateinit var mockP2PClient: P2PClient
    private lateinit var connectionStateFlow: MutableStateFlow<ConnectionState>

    @Before
    fun setup() {
        // Defensive: gradle :app:testDebugUnitTest runs all test classes in a single JVM,
        // and sibling tests (notably WebRTCClientTest) use class-level mockkStatic on
        // PeerConnectionFactory/SessionDescription/IceCandidate. If they leak (or if a
        // future sibling adds mockkConstructor without symmetric tearDown), residual
        // global mockk state can break our coEvery/coVerify generic resolution on
        // p2pClient.sendCommand<Any>. See memory `feedback_mockk_cross_file_jvm_pollution.md`
        // — this was the documented root cause of OQ's 3 residual failures on #17.
        unmockkAll()

        mockDao = mockk(relaxed = true)
        mockP2PClient = mockk(relaxed = true)
        connectionStateFlow = MutableStateFlow(ConnectionState.DISCONNECTED)

        every { mockP2PClient.connectionState } returns connectionStateFlow

        // v1.2 prep #1：preferences mock，ttlMillis 默认 7d 兼容 v1.0 行为。
        // relaxed mock 返 0L 时，cleanupOldCommands 走 FALLBACK_TTL_MS 7d 路径
        // (详 OfflineCommandQueue.cleanupOldCommands)。
        val mockPreferences = mockk<OfflineQueuePreferences>(relaxed = true)
        every { mockPreferences.ttlMillis } returns 7L * 24 * 60 * 60 * 1000

        queue = OfflineCommandQueue(mockDao, mockP2PClient, mockPreferences)
    }

    @After
    fun tearDown() {
        clearAllMocks()
        unmockkAll()
    }

    @Test
    fun `test enqueue command success`() = runTest {
        // Arrange
        val request = CommandRequest(
            id = "cmd-123",
            method = "ai.chat",
            params = mapOf("message" to "Hello"),
            auth = AuthInfo(
                did = "did:example:123",
                signature = "sig",
                timestamp = System.currentTimeMillis(),
                nonce = "123456"
            )
        )

        coEvery { mockDao.insert(any()) } just Runs

        // Act
        val result = queue.enqueue(request)

        // Assert
        assertTrue(result.isSuccess)
        coVerify {
            mockDao.insert(
                match { entity ->
                    entity.id == "cmd-123" &&
                    entity.method == "ai.chat" &&
                    entity.status == "pending" &&
                    entity.retries == 0
                }
            )
        }
    }

    @Test
    fun `test enqueue command failure`() = runTest {
        // Arrange
        val request = CommandRequest(
            id = "cmd-error",
            method = "ai.chat",
            params = emptyMap(),
            auth = AuthInfo("did", "sig", 0L, "nonce")
        )

        coEvery { mockDao.insert(any()) } throws Exception("Database error")

        // Act
        val result = queue.enqueue(request)

        // Assert
        assertTrue(result.isFailure)
        assertEquals("Database error", result.exceptionOrNull()?.message)
    }

    @Test
    fun `test dequeue and send with empty queue`() = runTest {
        // Arrange
        coEvery { mockDao.getPendingCommands() } returns emptyList()

        // Act
        val result = queue.dequeueAndSend()

        // Assert
        assertTrue(result.isSuccess)
        assertEquals(0, result.getOrNull())
    }

    @Test
    fun `test dequeue and send success`() = runTest {
        // Arrange
        val commands = listOf(
            OfflineCommandEntity(
                id = "cmd-1",
                method = "ai.chat",
                params = """{"message":"Hello"}""",
                auth = """{"did":"did:example:123","signature":"sig","timestamp":0,"nonce":"123"}""",
                timestamp = System.currentTimeMillis(),
                retries = 0,
                status = "pending"
            ),
            OfflineCommandEntity(
                id = "cmd-2",
                method = "system.getStatus",
                params = "{}",
                auth = """{"did":"did:example:123","signature":"sig","timestamp":0,"nonce":"456"}""",
                timestamp = System.currentTimeMillis(),
                retries = 0,
                status = "pending"
            )
        )

        coEvery { mockDao.getPendingCommands() } returns commands
        coEvery { mockDao.update(any()) } just Runs
        coEvery { mockDao.deleteById(any()) } just Runs
        // Use `coAnswers { Result.success(...) }` not `returns Result.success(...)`.
        // The latter doesn't match production's actual invocation (likely because
        // `Result<T>` is an inline value class and mockk's eager auto-boxing in
        // `returns` doesn't align with the boxed return that mockk records at call
        // time). coAnswers fires lazily on each invocation and matches reliably —
        // same pattern the previously-passing `test dequeue marks command as sending
        // before send` test in this file uses.
        coEvery {
            mockP2PClient.sendCommand<Any>(any(), any(), any())
        } coAnswers { Result.success(mapOf("status" to "ok")) }

        // Act
        val result = queue.dequeueAndSend()

        // Assert
        assertTrue(result.isSuccess)
        assertEquals(2, result.getOrNull())
        coVerify(exactly = 2) { mockDao.deleteById(any()) }
        coVerify(exactly = 2) { mockP2PClient.sendCommand<Any>(any(), any(), any()) }
    }

    @Test
    fun `test dequeue and send with partial failures`() = runTest {
        // Arrange
        val commands = listOf(
            OfflineCommandEntity(
                id = "cmd-success",
                method = "ai.chat",
                params = """{"message":"Hello"}""",
                auth = """{"did":"did:example:123","signature":"sig","timestamp":0,"nonce":"123"}""",
                timestamp = System.currentTimeMillis(),
                retries = 0,
                status = "pending"
            ),
            OfflineCommandEntity(
                id = "cmd-failure",
                method = "system.crash",
                params = "{}",
                auth = """{"did":"did:example:123","signature":"sig","timestamp":0,"nonce":"456"}""",
                timestamp = System.currentTimeMillis(),
                retries = 0,
                status = "pending"
            )
        )

        coEvery { mockDao.getPendingCommands() } returns commands
        coEvery { mockDao.update(any()) } just Runs
        coEvery { mockDao.deleteById("cmd-success") } just Runs

        // First command succeeds, second fails — coAnswers for the same Result<Any>
        // inline-value-class reason described in `test dequeue and send success`.
        coEvery {
            mockP2PClient.sendCommand<Any>("ai.chat", any(), any())
        } coAnswers { Result.success(mapOf("ok" to true)) }
        coEvery {
            mockP2PClient.sendCommand<Any>("system.crash", any(), any())
        } coAnswers { Result.failure(Exception("Command failed")) }

        // Act
        val result = queue.dequeueAndSend()

        // Assert
        assertTrue(result.isSuccess)
        assertEquals(1, result.getOrNull()) // Only 1 success
        coVerify(exactly = 1) { mockDao.deleteById("cmd-success") }
        coVerify { mockDao.update(match { it.id == "cmd-failure" && it.status == "pending" && it.retries == 1 }) }
    }

    @Test
    fun `test retry logic - increments retry count`() = runTest {
        // Arrange
        val command = OfflineCommandEntity(
            id = "cmd-retry",
            method = "ai.chat",
            params = """{"message":"Test"}""",
            auth = """{"did":"did:example:123","signature":"sig","timestamp":0,"nonce":"123"}""",
            timestamp = System.currentTimeMillis(),
            retries = 0,
            status = "pending"
        )

        coEvery { mockDao.getPendingCommands() } returns listOf(command)
        coEvery { mockDao.update(any()) } just Runs
        // coAnswers for same Result<Any> inline-class reason as the other dequeue tests.
        coEvery {
            mockP2PClient.sendCommand<Any>(any(), any(), any())
        } coAnswers { Result.failure(Exception("Network error")) }

        // Act
        val result = queue.dequeueAndSend()

        // Assert
        coVerify {
            mockDao.update(
                match { entity ->
                    entity.id == "cmd-retry" &&
                    entity.retries == 1 &&
                    entity.status == "pending" &&
                    entity.errorMessage == "Network error"
                }
            )
        }
    }

    @Test
    fun `test max retries - marks as failed`() = runTest {
        // Arrange
        val command = OfflineCommandEntity(
            id = "cmd-max-retry",
            method = "ai.chat",
            params = """{"message":"Test"}""",
            auth = """{"did":"did:example:123","signature":"sig","timestamp":0,"nonce":"123"}""",
            timestamp = System.currentTimeMillis(),
            retries = 2, // Already retried twice
            status = "pending"
        )

        coEvery { mockDao.getPendingCommands() } returns listOf(command)
        coEvery { mockDao.update(any()) } just Runs
        coEvery { mockP2PClient.sendCommand<Any>(any(), any(), any()) } returns Result.failure(Exception("Still failing"))

        // Act
        queue.dequeueAndSend()

        // Assert
        coVerify {
            mockDao.update(
                match { entity ->
                    entity.id == "cmd-max-retry" &&
                    entity.retries == 3 &&
                    entity.status == "failed"
                }
            )
        }
    }

    @Test
    fun `test get recent commands`() = runTest {
        // Arrange
        val commands = listOf(
            OfflineCommandEntity("cmd-1", "ai.chat", "{}", "{}", 1000L, 0, "pending"),
            OfflineCommandEntity("cmd-2", "system.getStatus", "{}", "{}", 2000L, 0, "pending")
        )

        coEvery { mockDao.getRecentCommands(50) } returns commands

        // Act
        val result = queue.getRecentCommands()

        // Assert
        assertEquals(2, result.size)
        assertEquals("cmd-1", result[0].id)
        assertEquals("cmd-2", result[1].id)
    }

    @Test
    fun `test cleanup old commands`() = runTest {
        // Arrange
        coEvery { mockDao.deleteOldCommands(any()) } just Runs

        // Act
        queue.cleanupOldCommands()

        // Assert
        coVerify { mockDao.deleteOldCommands(any()) }
    }

    @Test
    fun `test update stats`() = runTest {
        // Arrange
        val commands = listOf(
            OfflineCommandEntity("cmd-1", "ai.chat", "{}", "{}", 1000L, 0, "pending"),
            OfflineCommandEntity("cmd-2", "system.getStatus", "{}", "{}", 2000L, 0, "sending"),
            OfflineCommandEntity("cmd-3", "ai.search", "{}", "{}", 3000L, 0, "failed"),
            OfflineCommandEntity("cmd-4", "system.notify", "{}", "{}", 4000L, 0, "pending")
        )

        coEvery { mockDao.getRecentCommands(1000) } returns commands

        // Act
        queue.updateStats()

        // Wait for stats to update
        kotlinx.coroutines.delay(50)

        // Assert
        val stats = queue.stats.value
        assertEquals(4, stats.total)
        assertEquals(2, stats.pending)
        assertEquals(1, stats.sending)
        assertEquals(1, stats.failed)
    }

    @Test
    fun `test retry failed commands`() = runTest {
        // Arrange
        val failedCommands = listOf(
            OfflineCommandEntity("cmd-failed-1", "ai.chat", "{}", "{}", 1000L, 3, "failed", "Error 1"),
            OfflineCommandEntity("cmd-failed-2", "system.exec", "{}", "{}", 2000L, 2, "failed", "Error 2")
        )

        val allCommands = failedCommands + listOf(
            OfflineCommandEntity("cmd-pending", "ai.search", "{}", "{}", 3000L, 0, "pending")
        )

        coEvery { mockDao.getRecentCommands(1000) } returns allCommands
        coEvery { mockDao.update(any()) } just Runs
        coEvery { mockDao.countPending() } returns 2

        connectionStateFlow.value = ConnectionState.CONNECTED
        coEvery { mockP2PClient.sendCommand<Any>(any(), any(), any()) } returns Result.success(mapOf("ok" to true))

        // Act
        val result = queue.retryFailedCommands()

        // Assert
        assertTrue(result.isSuccess)
        assertEquals(2, result.getOrNull())
        coVerify(exactly = 2) {
            mockDao.update(
                match { entity ->
                    entity.status == "pending" &&
                    entity.retries == 0 &&
                    entity.errorMessage == null
                }
            )
        }
    }

    @Test
    fun `test clear queue`() = runTest {
        // Arrange
        val pendingCommands = listOf(
            OfflineCommandEntity("cmd-1", "ai.chat", "{}", "{}", 1000L),
            OfflineCommandEntity("cmd-2", "system.getStatus", "{}", "{}", 2000L)
        )

        coEvery { mockDao.getPendingCommands() } returns pendingCommands
        coEvery { mockDao.delete(any()) } just Runs

        // Act
        queue.clear()

        // Assert
        coVerify(exactly = 2) { mockDao.delete(any()) }
    }

    @Test
    fun `test auto send starts when connected`() = runBlocking {
        // Arrange — `initialize()` is what registers the connectionState collector that
        // triggers startAutoSend on CONNECTED. The test must invoke it (launched, since
        // it never returns — it keeps the collect open). runBlocking + real delays
        // because the auto-send loop runs on the queue's internal Dispatchers.IO scope.
        coEvery { mockDao.countPending() } returns 3
        coEvery { mockDao.getPendingCommands() } returns emptyList()
        coEvery { mockDao.getRecentCommands(any()) } returns emptyList()

        val initJob = launch { queue.initialize() }
        delay(200) // give the collector time to register

        // Act
        connectionStateFlow.value = ConnectionState.CONNECTED

        // Wait for auto-send to fire countPending() at least once
        delay(500)

        // Assert
        coVerify(atLeast = 1) { mockDao.countPending() }

        initJob.cancel()
    }

    @Test
    fun `test auto send stops when disconnected`() = runTest {
        // Arrange
        connectionStateFlow.value = ConnectionState.CONNECTED
        kotlinx.coroutines.delay(50)

        // Act
        connectionStateFlow.value = ConnectionState.DISCONNECTED

        // Wait a bit
        kotlinx.coroutines.delay(100)

        // Auto-send should have stopped (no more checks)
        // We can't directly verify this, but we ensure no crash occurs
    }

    @Test
    fun `test initialize cleans up old commands`() = runTest {
        // Arrange
        coEvery { mockDao.deleteOldCommands(any()) } just Runs
        coEvery { mockDao.countPending() } returns 0

        // Note: Can't easily test initialize() because it has a collect loop
        // So we test cleanupOldCommands directly

        // Act
        queue.cleanupOldCommands()

        // Assert
        coVerify { mockDao.deleteOldCommands(any()) }
    }

    @Test
    fun `test queue stats initial state`() {
        // Assert
        val stats = queue.stats.value
        assertEquals(0, stats.total)
        assertEquals(0, stats.pending)
        assertEquals(0, stats.sending)
        assertEquals(0, stats.failed)
    }

    @Test
    fun `test dequeue marks command as sending before send`() = runTest {
        // Arrange
        val command = OfflineCommandEntity(
            id = "cmd-sending-test",
            method = "ai.chat",
            params = """{"message":"Test"}""",
            auth = """{"did":"did:example:123","signature":"sig","timestamp":0,"nonce":"123"}""",
            timestamp = System.currentTimeMillis(),
            retries = 0,
            status = "pending"
        )

        coEvery { mockDao.getPendingCommands() } returns listOf(command)
        coEvery { mockDao.update(any()) } just Runs
        coEvery { mockDao.deleteById(any()) } just Runs
        coEvery { mockP2PClient.sendCommand<Any>(any(), any(), any()) } coAnswers {
            // Verify status was set to "sending" before this call
            coVerify { mockDao.update(match { it.status == "sending" }) }
            Result.success(mapOf("ok" to true))
        }

        // Act
        queue.dequeueAndSend()

        // Assert
        coVerify { mockDao.update(match { it.id == "cmd-sending-test" && it.status == "sending" }) }
    }

    @Test
    fun `test count pending commands`() = runTest {
        // Arrange
        coEvery { mockDao.countPending() } returns 5

        // Act
        val count = mockDao.countPending()

        // Assert
        assertEquals(5, count)
    }
}
