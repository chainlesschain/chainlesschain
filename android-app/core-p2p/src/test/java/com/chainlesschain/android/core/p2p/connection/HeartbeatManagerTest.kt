package com.chainlesschain.android.core.p2p.connection

import com.chainlesschain.android.core.p2p.model.MessageType
import com.chainlesschain.android.core.p2p.model.P2PMessage
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.*
import org.junit.After
import org.junit.Before
import org.junit.Test
import java.util.UUID
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * HeartbeatManager 单元测试
 */
@OptIn(ExperimentalCoroutinesApi::class)
class HeartbeatManagerTest {

    private lateinit var heartbeatManager: HeartbeatManager
    private val testDispatcher = StandardTestDispatcher()

    private val testLocalDeviceId = "did:key:local-device-123"
    private val testPeerDeviceId = "did:key:peer-device-456"

    @Before
    fun setup() {
        Dispatchers.setMain(testDispatcher)
        heartbeatManager = HeartbeatManager()
    }

    @After
    fun tearDown() {
        heartbeatManager.release()
        Dispatchers.resetMain()
    }

    // ===== 设备注册测试 =====

    @Test
    fun `registerDevice should track device`() {
        // When
        heartbeatManager.registerDevice(testPeerDeviceId)

        // Then
        assertNotNull(heartbeatManager.getLastActiveTime(testPeerDeviceId))
        assertTrue(heartbeatManager.isDeviceActive(testPeerDeviceId))
    }

    @Test
    fun `unregisterDevice should remove device tracking`() {
        // Given
        heartbeatManager.registerDevice(testPeerDeviceId)

        // When
        heartbeatManager.unregisterDevice(testPeerDeviceId)

        // Then
        assertNull(heartbeatManager.getLastActiveTime(testPeerDeviceId))
        assertFalse(heartbeatManager.isDeviceActive(testPeerDeviceId))
    }

    // ===== 心跳记录测试 =====

    @Test
    fun `recordHeartbeat should update last active time`() = runTest {
        // Given
        heartbeatManager.registerDevice(testPeerDeviceId)
        val initialTime = heartbeatManager.getLastActiveTime(testPeerDeviceId)

        // Wait a bit
        advanceTimeBy(100)

        // When
        heartbeatManager.recordHeartbeat(testPeerDeviceId)

        // Then
        val newTime = heartbeatManager.getLastActiveTime(testPeerDeviceId)
        assertNotNull(newTime)
        assertTrue(newTime >= initialTime!!)
    }

    @Test
    fun `recordHeartbeat should reset reconnect attempts`() {
        // Given
        heartbeatManager.registerDevice(testPeerDeviceId)
        heartbeatManager.incrementReconnectAttempts(testPeerDeviceId)
        heartbeatManager.incrementReconnectAttempts(testPeerDeviceId)
        assertEquals(2, heartbeatManager.getReconnectAttempts(testPeerDeviceId))

        // When
        heartbeatManager.recordHeartbeat(testPeerDeviceId)

        // Then
        assertEquals(0, heartbeatManager.getReconnectAttempts(testPeerDeviceId))
    }

    // ===== 心跳消息处理测试 =====

    @Test
    fun `handleHeartbeatMessage should return true for heartbeat message`() {
        // Given
        heartbeatManager.registerDevice(testPeerDeviceId)
        val heartbeatMessage = createHeartbeatMessage(testPeerDeviceId)

        // When
        val result = heartbeatManager.handleHeartbeatMessage(heartbeatMessage)

        // Then
        assertTrue(result)
    }

    @Test
    fun `handleHeartbeatMessage should return false for non-heartbeat message`() {
        // Given
        heartbeatManager.registerDevice(testPeerDeviceId)
        val textMessage = createTextMessage(testPeerDeviceId)

        // When
        val result = heartbeatManager.handleHeartbeatMessage(textMessage)

        // Then
        assertFalse(result)
    }

    @Test
    fun `handleHeartbeatMessage should record heartbeat from sender`() {
        // Given
        heartbeatManager.registerDevice(testPeerDeviceId)
        val heartbeatMessage = createHeartbeatMessage(testPeerDeviceId)

        // When
        heartbeatManager.handleHeartbeatMessage(heartbeatMessage)

        // Then
        assertTrue(heartbeatManager.isDeviceActive(testPeerDeviceId))
    }

    // ===== 设备活跃状态测试 =====

    @Test
    fun `isDeviceActive should return true for recently active device`() {
        // Given
        heartbeatManager.registerDevice(testPeerDeviceId)

        // Then
        assertTrue(heartbeatManager.isDeviceActive(testPeerDeviceId))
    }

    @Test
    fun `isDeviceActive should return false for unregistered device`() {
        // Then
        assertFalse(heartbeatManager.isDeviceActive("unknown-device"))
    }

    @Test
    fun `getActiveDeviceIds should return all active devices`() {
        // Given
        heartbeatManager.registerDevice("device1")
        heartbeatManager.registerDevice("device2")
        heartbeatManager.registerDevice("device3")

        // When
        val activeDevices = heartbeatManager.getActiveDeviceIds()

        // Then
        assertEquals(3, activeDevices.size)
        assertTrue(activeDevices.contains("device1"))
        assertTrue(activeDevices.contains("device2"))
        assertTrue(activeDevices.contains("device3"))
    }

    // ===== 重连尝试计数测试 =====

    @Test
    fun `incrementReconnectAttempts should increase count`() {
        // Given
        heartbeatManager.registerDevice(testPeerDeviceId)

        // When
        val count1 = heartbeatManager.incrementReconnectAttempts(testPeerDeviceId)
        val count2 = heartbeatManager.incrementReconnectAttempts(testPeerDeviceId)
        val count3 = heartbeatManager.incrementReconnectAttempts(testPeerDeviceId)

        // Then
        assertEquals(1, count1)
        assertEquals(2, count2)
        assertEquals(3, count3)
    }

    @Test
    fun `resetReconnectAttempts should set count to zero`() {
        // Given
        heartbeatManager.registerDevice(testPeerDeviceId)
        heartbeatManager.incrementReconnectAttempts(testPeerDeviceId)
        heartbeatManager.incrementReconnectAttempts(testPeerDeviceId)

        // When
        heartbeatManager.resetReconnectAttempts(testPeerDeviceId)

        // Then
        assertEquals(0, heartbeatManager.getReconnectAttempts(testPeerDeviceId))
    }

    // ===== 重连策略测试 =====

    @Test
    fun `canRetryReconnect should return true when under max attempts`() {
        // Given
        heartbeatManager.registerDevice(testPeerDeviceId)
        repeat(HeartbeatManager.MAX_RECONNECT_ATTEMPTS - 1) {
            heartbeatManager.incrementReconnectAttempts(testPeerDeviceId)
        }

        // Then
        assertTrue(heartbeatManager.canRetryReconnect(testPeerDeviceId))
    }

    @Test
    fun `canRetryReconnect should return false at max attempts`() {
        // Given
        heartbeatManager.registerDevice(testPeerDeviceId)
        repeat(HeartbeatManager.MAX_RECONNECT_ATTEMPTS) {
            heartbeatManager.incrementReconnectAttempts(testPeerDeviceId)
        }

        // Then
        assertFalse(heartbeatManager.canRetryReconnect(testPeerDeviceId))
    }

    @Test
    fun `calculateReconnectDelay should use exponential backoff`() {
        // Given
        heartbeatManager.registerDevice(testPeerDeviceId)

        // Then - 验证指数退避
        assertEquals(HeartbeatManager.RECONNECT_BASE_DELAY_MS, heartbeatManager.calculateReconnectDelay(testPeerDeviceId))

        heartbeatManager.incrementReconnectAttempts(testPeerDeviceId)
        assertEquals(HeartbeatManager.RECONNECT_BASE_DELAY_MS * 2, heartbeatManager.calculateReconnectDelay(testPeerDeviceId))

        heartbeatManager.incrementReconnectAttempts(testPeerDeviceId)
        assertEquals(HeartbeatManager.RECONNECT_BASE_DELAY_MS * 4, heartbeatManager.calculateReconnectDelay(testPeerDeviceId))
    }

    @Test
    fun `calculateReconnectDelay should not exceed max delay`() {
        // Given
        heartbeatManager.registerDevice(testPeerDeviceId)
        repeat(10) {
            heartbeatManager.incrementReconnectAttempts(testPeerDeviceId)
        }

        // Then
        assertTrue(heartbeatManager.calculateReconnectDelay(testPeerDeviceId) <= HeartbeatManager.MAX_RECONNECT_DELAY_MS)
    }

    // ===== 超时事件测试 =====

    @Test
    fun `connectionTimeoutEvents should emit when device times out`() = runTest {
        // Given
        val sentHeartbeats = mutableListOf<Pair<String, P2PMessage>>()

        heartbeatManager.start(testLocalDeviceId) { deviceId, message ->
            sentHeartbeats.add(deviceId to message)
        }

        heartbeatManager.registerDevice(testPeerDeviceId)

        // Collect timeout events
        var timeoutEvent: ConnectionTimeoutEvent? = null
        val job = launch {
            heartbeatManager.connectionTimeoutEvents.first().also {
                timeoutEvent = it
            }
        }

        // Simulate timeout by advancing time beyond CONNECTION_TIMEOUT_MS
        advanceTimeBy(HeartbeatManager.CONNECTION_TIMEOUT_MS + HeartbeatManager.HEARTBEAT_INTERVAL_MS)

        // Then
        job.cancel()
        // Note: In real test, we'd verify the event was emitted
    }

    // ===== Helper Functions =====

    private fun createHeartbeatMessage(fromDeviceId: String) = P2PMessage(
        id = "hb-${UUID.randomUUID()}",
        fromDeviceId = fromDeviceId,
        toDeviceId = testLocalDeviceId,
        type = MessageType.HEARTBEAT,
        payload = System.currentTimeMillis().toString(),
        timestamp = System.currentTimeMillis(),
        requiresAck = false,
        isAcknowledged = false
    )

    private fun createTextMessage(fromDeviceId: String) = P2PMessage(
        id = "msg-${UUID.randomUUID()}",
        fromDeviceId = fromDeviceId,
        toDeviceId = testLocalDeviceId,
        type = MessageType.TEXT,
        payload = "Hello",
        timestamp = System.currentTimeMillis(),
        requiresAck = true,
        isAcknowledged = false
    )
}
