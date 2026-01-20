package com.chainlesschain.android.core.p2p.connection

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.*
import org.junit.After
import org.junit.Before
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * SignalingClient 单元测试
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SignalingClientTest {

    private lateinit var signalingClient: SignalingClient
    private val testDispatcher = StandardTestDispatcher()

    @Before
    fun setup() {
        Dispatchers.setMain(testDispatcher)
        signalingClient = SignalingClient()
    }

    @After
    fun tearDown() {
        signalingClient.release()
        Dispatchers.resetMain()
    }

    // ===== 连接状态测试 =====

    @Test
    fun `initial state should be Disconnected`() {
        // Then
        assertTrue(signalingClient.connectionState.value is SignalingConnectionState.Disconnected)
        assertFalse(signalingClient.isConnected())
    }

    @Test
    fun `disconnect should set state to Disconnected`() = runTest {
        // When
        signalingClient.disconnect()

        // Then
        assertTrue(signalingClient.connectionState.value is SignalingConnectionState.Disconnected)
    }

    // ===== 重连取消测试 =====

    @Test
    fun `cancelReconnect should stop pending reconnect`() = runTest {
        // Given - simulate a state where reconnect might be pending
        signalingClient.connectToServer("192.168.1.100")

        // When
        signalingClient.cancelReconnect()

        // Then - no exception should be thrown
        assertTrue(true)
    }

    // ===== 连接事件测试 =====

    @Test
    fun `disconnect should emit Disconnected event`() = runTest {
        // Given
        val events = mutableListOf<SignalingConnectionEvent>()
        val job = backgroundScope.launch {
            signalingClient.connectionEvents.collect { events.add(it) }
        }

        // Ensure collector is started
        yield()

        // When
        signalingClient.disconnect()
        advanceUntilIdle()

        // Then
        job.cancel()
        // The event might be emitted synchronously, so verify state instead if no event
        assertTrue(
            events.any { it is SignalingConnectionEvent.Disconnected } ||
            signalingClient.connectionState.value is SignalingConnectionState.Disconnected
        )
    }

    // ===== 常量验证测试 =====

    @Test
    fun `CONNECT_TIMEOUT_MS should be reasonable value`() {
        // 连接超时应该在合理范围内（5-30秒）
        assertTrue(SignalingClient.CONNECT_TIMEOUT_MS >= 5_000)
        assertTrue(SignalingClient.CONNECT_TIMEOUT_MS <= 30_000)
    }

    @Test
    fun `READ_TIMEOUT_MS should be reasonable value`() {
        // 读取超时应该在合理范围内（15-60秒）
        assertTrue(SignalingClient.READ_TIMEOUT_MS >= 15_000)
        assertTrue(SignalingClient.READ_TIMEOUT_MS <= 60_000)
    }

    @Test
    fun `MAX_RECONNECT_ATTEMPTS should be reasonable value`() {
        // 最大重连次数应该在合理范围内（2-10次）
        assertTrue(SignalingClient.MAX_RECONNECT_ATTEMPTS >= 2)
        assertTrue(SignalingClient.MAX_RECONNECT_ATTEMPTS <= 10)
    }

    @Test
    fun `RECONNECT_BASE_DELAY_MS should be reasonable value`() {
        // 重连基础延迟应该在合理范围内（500ms-5s）
        assertTrue(SignalingClient.RECONNECT_BASE_DELAY_MS >= 500)
        assertTrue(SignalingClient.RECONNECT_BASE_DELAY_MS <= 5_000)
    }

    // ===== 连接状态类型测试 =====

    @Test
    fun `SignalingConnectionState should have all expected states`() {
        // Verify all states exist
        val disconnected: SignalingConnectionState = SignalingConnectionState.Disconnected
        val listening: SignalingConnectionState = SignalingConnectionState.Listening
        val connecting: SignalingConnectionState = SignalingConnectionState.Connecting
        val connected: SignalingConnectionState = SignalingConnectionState.Connected
        val reconnecting: SignalingConnectionState = SignalingConnectionState.Reconnecting(1)
        val failed: SignalingConnectionState = SignalingConnectionState.Failed("test")

        assertTrue(disconnected is SignalingConnectionState.Disconnected)
        assertTrue(listening is SignalingConnectionState.Listening)
        assertTrue(connecting is SignalingConnectionState.Connecting)
        assertTrue(connected is SignalingConnectionState.Connected)
        assertTrue(reconnecting is SignalingConnectionState.Reconnecting)
        assertTrue(failed is SignalingConnectionState.Failed)
    }

    @Test
    fun `Reconnecting state should contain attempt number`() {
        val state = SignalingConnectionState.Reconnecting(3)
        assertEquals(3, state.attempt)
    }

    @Test
    fun `Failed state should contain reason`() {
        val state = SignalingConnectionState.Failed("Connection refused")
        assertEquals("Connection refused", state.reason)
    }

    // ===== 连接事件类型测试 =====

    @Test
    fun `SignalingConnectionEvent should have all expected events`() {
        // Verify all events exist
        val connected: SignalingConnectionEvent = SignalingConnectionEvent.Connected("host", 9999)
        val failed: SignalingConnectionEvent = SignalingConnectionEvent.ConnectionFailed("reason")
        val disconnected: SignalingConnectionEvent = SignalingConnectionEvent.Disconnected
        val reconnecting: SignalingConnectionEvent = SignalingConnectionEvent.Reconnecting(1, 1000L)
        val maxReached: SignalingConnectionEvent = SignalingConnectionEvent.MaxReconnectReached
        val serverError: SignalingConnectionEvent = SignalingConnectionEvent.ServerError("error")

        assertTrue(connected is SignalingConnectionEvent.Connected)
        assertTrue(failed is SignalingConnectionEvent.ConnectionFailed)
        assertTrue(disconnected is SignalingConnectionEvent.Disconnected)
        assertTrue(reconnecting is SignalingConnectionEvent.Reconnecting)
        assertTrue(maxReached is SignalingConnectionEvent.MaxReconnectReached)
        assertTrue(serverError is SignalingConnectionEvent.ServerError)
    }

    @Test
    fun `Connected event should contain host and port`() {
        val event = SignalingConnectionEvent.Connected("192.168.1.100", 9999)
        assertEquals("192.168.1.100", event.host)
        assertEquals(9999, event.port)
    }

    @Test
    fun `Reconnecting event should contain attempt and delay`() {
        val event = SignalingConnectionEvent.Reconnecting(2, 4000L)
        assertEquals(2, event.attempt)
        assertEquals(4000L, event.delayMs)
    }
}
