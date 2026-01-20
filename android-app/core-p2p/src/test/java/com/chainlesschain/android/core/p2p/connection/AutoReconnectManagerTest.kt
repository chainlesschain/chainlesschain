package com.chainlesschain.android.core.p2p.connection

import com.chainlesschain.android.core.p2p.model.ConnectionStatus
import com.chainlesschain.android.core.p2p.model.DeviceType
import com.chainlesschain.android.core.p2p.model.P2PDevice
import io.mockk.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.*
import org.junit.After
import org.junit.Before
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * AutoReconnectManager 单元测试
 */
@OptIn(ExperimentalCoroutinesApi::class)
class AutoReconnectManagerTest {

    private lateinit var autoReconnectManager: AutoReconnectManager
    private lateinit var heartbeatManager: HeartbeatManager
    private val mockReconnectEvents = MutableSharedFlow<ReconnectEvent>()

    private val testDispatcher = StandardTestDispatcher()

    private val testDevice = P2PDevice(
        deviceId = "did:key:test-device-123",
        deviceName = "Test Device",
        deviceType = DeviceType.MOBILE,
        status = ConnectionStatus.CONNECTED,
        address = "192.168.1.100:8888"
    )

    @Before
    fun setup() {
        Dispatchers.setMain(testDispatcher)
        heartbeatManager = mockk(relaxed = true)
        every { heartbeatManager.reconnectEvents } returns mockReconnectEvents
        autoReconnectManager = AutoReconnectManager(heartbeatManager)
    }

    @After
    fun tearDown() {
        autoReconnectManager.release()
        Dispatchers.resetMain()
    }

    // ===== 设备缓存测试 =====

    @Test
    fun `cacheDevice should store device info`() {
        // When
        autoReconnectManager.cacheDevice(testDevice)

        // Then
        val cached = autoReconnectManager.getCachedDevice(testDevice.deviceId)
        assertNotNull(cached)
        assertEquals(testDevice.deviceName, cached.deviceName)
    }

    @Test
    fun `removeDeviceCache should remove device info`() {
        // Given
        autoReconnectManager.cacheDevice(testDevice)

        // When
        autoReconnectManager.removeDeviceCache(testDevice.deviceId)

        // Then
        assertNull(autoReconnectManager.getCachedDevice(testDevice.deviceId))
    }

    @Test
    fun `getCachedDevice should return null for unknown device`() {
        // Then
        assertNull(autoReconnectManager.getCachedDevice("unknown-device"))
    }

    // ===== 重连安排测试 =====

    @Test
    fun `scheduleReconnect should add task to queue`() = runTest {
        // Given
        autoReconnectManager.cacheDevice(testDevice)
        every { heartbeatManager.getReconnectAttempts(any()) } returns 1

        var reconnectCalled = false
        autoReconnectManager.start { reconnectCalled = true }

        // When
        autoReconnectManager.scheduleReconnect(
            testDevice.deviceId,
            1000L,
            ReconnectReason.HEARTBEAT_TIMEOUT
        )

        // Then
        assertEquals(1, autoReconnectManager.getPendingReconnectCount())
        assertTrue(autoReconnectManager.getPendingReconnectDeviceIds().contains(testDevice.deviceId))
    }

    @Test
    fun `scheduleReconnect without cached device should not add task`() = runTest {
        // Given - no cached device
        every { heartbeatManager.getReconnectAttempts(any()) } returns 1

        autoReconnectManager.start { }

        // When
        autoReconnectManager.scheduleReconnect(
            "unknown-device",
            1000L,
            ReconnectReason.HEARTBEAT_TIMEOUT
        )

        // Then
        assertEquals(0, autoReconnectManager.getPendingReconnectCount())
    }

    @Test
    fun `scheduleReconnect when paused should not add task`() = runTest {
        // Given
        autoReconnectManager.cacheDevice(testDevice)
        autoReconnectManager.start { }
        autoReconnectManager.pause()

        // When
        autoReconnectManager.scheduleReconnect(
            testDevice.deviceId,
            1000L,
            ReconnectReason.HEARTBEAT_TIMEOUT
        )

        // Then
        assertEquals(0, autoReconnectManager.getPendingReconnectCount())
    }

    // ===== 重连取消测试 =====

    @Test
    fun `cancelReconnect should remove task from queue`() = runTest {
        // Given
        autoReconnectManager.cacheDevice(testDevice)
        every { heartbeatManager.getReconnectAttempts(any()) } returns 1

        autoReconnectManager.start { }
        autoReconnectManager.scheduleReconnect(
            testDevice.deviceId,
            5000L, // Long delay so it doesn't execute
            ReconnectReason.HEARTBEAT_TIMEOUT
        )

        assertEquals(1, autoReconnectManager.getPendingReconnectCount())

        // When
        autoReconnectManager.cancelReconnect(testDevice.deviceId)

        // Then
        assertEquals(0, autoReconnectManager.getPendingReconnectCount())
        verify { heartbeatManager.resetReconnectAttempts(testDevice.deviceId) }
    }

    // ===== 暂停/恢复测试 =====

    @Test
    fun `pause should prevent new reconnect tasks`() = runTest {
        // Given
        autoReconnectManager.cacheDevice(testDevice)
        autoReconnectManager.start { }

        // When
        autoReconnectManager.pause()
        autoReconnectManager.scheduleReconnect(
            testDevice.deviceId,
            1000L,
            ReconnectReason.CONNECTION_LOST
        )

        // Then
        assertEquals(0, autoReconnectManager.getPendingReconnectCount())
    }

    @Test
    fun `resume should allow new reconnect tasks`() = runTest {
        // Given
        autoReconnectManager.cacheDevice(testDevice)
        every { heartbeatManager.getReconnectAttempts(any()) } returns 1
        autoReconnectManager.start { }

        autoReconnectManager.pause()
        autoReconnectManager.resume()

        // When
        autoReconnectManager.scheduleReconnect(
            testDevice.deviceId,
            1000L,
            ReconnectReason.CONNECTION_LOST
        )

        // Then
        assertEquals(1, autoReconnectManager.getPendingReconnectCount())
    }

    // ===== 立即重连测试 =====

    @Test
    fun `reconnectNow should execute reconnect immediately`() = runTest {
        // Given
        autoReconnectManager.cacheDevice(testDevice)

        var reconnectedDevice: P2PDevice? = null
        autoReconnectManager.start { device ->
            reconnectedDevice = device
        }

        // Schedule a delayed reconnect
        every { heartbeatManager.getReconnectAttempts(any()) } returns 1
        autoReconnectManager.scheduleReconnect(
            testDevice.deviceId,
            60_000L, // Long delay
            ReconnectReason.HEARTBEAT_TIMEOUT
        )

        // When
        autoReconnectManager.reconnectNow(testDevice.deviceId)
        advanceUntilIdle()

        // Then
        assertEquals(testDevice.deviceId, reconnectedDevice?.deviceId)
        assertEquals(0, autoReconnectManager.getPendingReconnectCount())
    }

    @Test
    fun `reconnectNow without cached device should do nothing`() = runTest {
        // Given
        var reconnectCalled = false
        autoReconnectManager.start { reconnectCalled = true }

        // When
        autoReconnectManager.reconnectNow("unknown-device")
        advanceUntilIdle()

        // Then
        assertFalse(reconnectCalled)
    }

    // ===== 重连状态事件测试 =====

    @Test
    fun `scheduleReconnect should emit SCHEDULED event`() = runTest {
        // Given
        autoReconnectManager.cacheDevice(testDevice)
        every { heartbeatManager.getReconnectAttempts(any()) } returns 1

        var statusEvent: ReconnectStatusEvent? = null
        val job = backgroundScope.launch {
            autoReconnectManager.reconnectStatusEvents.first().also {
                statusEvent = it
            }
        }

        autoReconnectManager.start { }

        // When
        autoReconnectManager.scheduleReconnect(
            testDevice.deviceId,
            1000L,
            ReconnectReason.HEARTBEAT_TIMEOUT
        )
        advanceUntilIdle()

        // Then
        job.cancel()
        assertEquals(ReconnectStatus.SCHEDULED, statusEvent?.status)
        assertEquals(testDevice.deviceId, statusEvent?.deviceId)
    }

    @Test
    fun `successful reconnect should emit SUCCESS event`() = runTest {
        // Given
        autoReconnectManager.cacheDevice(testDevice)
        every { heartbeatManager.getReconnectAttempts(any()) } returns 1

        val events = mutableListOf<ReconnectStatusEvent>()
        val job = backgroundScope.launch {
            autoReconnectManager.reconnectStatusEvents.collect {
                events.add(it)
            }
        }

        autoReconnectManager.start { /* success */ }

        // When
        autoReconnectManager.scheduleReconnect(
            testDevice.deviceId,
            0L, // Execute immediately
            ReconnectReason.CONNECTION_LOST
        )
        advanceUntilIdle()

        // Then
        job.cancel()
        assertTrue(events.any { it.status == ReconnectStatus.SUCCESS })
    }

    @Test
    fun `failed reconnect should emit FAILED event and retry`() = runTest {
        // Given
        autoReconnectManager.cacheDevice(testDevice)
        every { heartbeatManager.getReconnectAttempts(any()) } returns 1
        every { heartbeatManager.canRetryReconnect(any()) } returns true
        every { heartbeatManager.incrementReconnectAttempts(any()) } returns 2
        every { heartbeatManager.calculateReconnectDelay(any()) } returns 1000L

        val events = mutableListOf<ReconnectStatusEvent>()
        val job = backgroundScope.launch {
            autoReconnectManager.reconnectStatusEvents.collect {
                events.add(it)
            }
        }

        autoReconnectManager.start { throw Exception("Connection failed") }

        // When
        autoReconnectManager.scheduleReconnect(
            testDevice.deviceId,
            0L,
            ReconnectReason.CONNECTION_LOST
        )
        advanceUntilIdle()

        // Then
        job.cancel()
        assertTrue(events.any { it.status == ReconnectStatus.FAILED })
    }

    @Test
    fun `exhausted retries should emit EXHAUSTED event`() = runTest {
        // Given
        autoReconnectManager.cacheDevice(testDevice)
        every { heartbeatManager.getReconnectAttempts(any()) } returns 5
        every { heartbeatManager.canRetryReconnect(any()) } returns false

        val events = mutableListOf<ReconnectStatusEvent>()
        val job = backgroundScope.launch {
            autoReconnectManager.reconnectStatusEvents.collect {
                events.add(it)
            }
        }

        autoReconnectManager.start { throw Exception("Connection failed") }

        // When
        autoReconnectManager.scheduleReconnect(
            testDevice.deviceId,
            0L,
            ReconnectReason.CONNECTION_LOST
        )
        advanceUntilIdle()

        // Then
        job.cancel()
        assertTrue(events.any { it.status == ReconnectStatus.EXHAUSTED })
    }

    // ===== 多设备测试 =====

    @Test
    fun `should handle multiple devices independently`() = runTest {
        // Given
        val device1 = testDevice.copy(deviceId = "device-1", deviceName = "Device 1")
        val device2 = testDevice.copy(deviceId = "device-2", deviceName = "Device 2")

        autoReconnectManager.cacheDevice(device1)
        autoReconnectManager.cacheDevice(device2)

        every { heartbeatManager.getReconnectAttempts(any()) } returns 1

        autoReconnectManager.start { }

        // When
        autoReconnectManager.scheduleReconnect(device1.deviceId, 1000L, ReconnectReason.HEARTBEAT_TIMEOUT)
        autoReconnectManager.scheduleReconnect(device2.deviceId, 2000L, ReconnectReason.CONNECTION_LOST)

        // Then
        assertEquals(2, autoReconnectManager.getPendingReconnectCount())
        assertTrue(autoReconnectManager.getPendingReconnectDeviceIds().contains(device1.deviceId))
        assertTrue(autoReconnectManager.getPendingReconnectDeviceIds().contains(device2.deviceId))
    }

    @Test
    fun `cancelReconnect should only affect specified device`() = runTest {
        // Given
        val device1 = testDevice.copy(deviceId = "device-1")
        val device2 = testDevice.copy(deviceId = "device-2")

        autoReconnectManager.cacheDevice(device1)
        autoReconnectManager.cacheDevice(device2)

        every { heartbeatManager.getReconnectAttempts(any()) } returns 1

        autoReconnectManager.start { }
        autoReconnectManager.scheduleReconnect(device1.deviceId, 5000L, ReconnectReason.HEARTBEAT_TIMEOUT)
        autoReconnectManager.scheduleReconnect(device2.deviceId, 5000L, ReconnectReason.HEARTBEAT_TIMEOUT)

        // When
        autoReconnectManager.cancelReconnect(device1.deviceId)

        // Then
        assertEquals(1, autoReconnectManager.getPendingReconnectCount())
        assertFalse(autoReconnectManager.getPendingReconnectDeviceIds().contains(device1.deviceId))
        assertTrue(autoReconnectManager.getPendingReconnectDeviceIds().contains(device2.deviceId))
    }
}
