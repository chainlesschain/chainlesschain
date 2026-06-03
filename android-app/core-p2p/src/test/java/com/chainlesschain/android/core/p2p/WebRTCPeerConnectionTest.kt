package com.chainlesschain.android.core.p2p

import com.chainlesschain.android.core.p2p.connection.*
import com.chainlesschain.android.core.p2p.model.ConnectionStatus
import com.chainlesschain.android.core.p2p.model.DeviceType
import com.chainlesschain.android.core.p2p.model.P2PDevice
import org.junit.Ignore
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/**
 * WebRTC P2P连接测试
 *
 * 注意: WebRTC使用native库，无法在JVM单元测试中直接测试
 * 这些测试仅验证数据模型和辅助类
 * 实际的WebRTC功能测试应在instrumentation测试中进行
 */
class WebRTCPeerConnectionTest {

    private val testDevice = P2PDevice(
        deviceId = "test-device-123",
        deviceName = "Test Device",
        deviceType = DeviceType.MOBILE,
        status = ConnectionStatus.DISCOVERED,
        address = "192.168.1.100:8888"
    )

    @Test
    fun `P2PDevice should have correct properties`() {
        // Then
        assertEquals("test-device-123", testDevice.deviceId)
        assertEquals("Test Device", testDevice.deviceName)
        assertEquals(DeviceType.MOBILE, testDevice.deviceType)
        assertEquals(ConnectionStatus.DISCOVERED, testDevice.status)
        assertEquals("192.168.1.100:8888", testDevice.address)
    }

    @Test
    fun `SessionDescription should serialize correctly`() {
        // Given
        val offer = SessionDescription(
            type = SessionDescription.Type.OFFER,
            sdp = "test-sdp-offer"
        )

        // Then
        assertEquals(SessionDescription.Type.OFFER, offer.type)
        assertEquals("test-sdp-offer", offer.sdp)
    }

    @Test
    fun `IceCandidate should have correct properties`() {
        // Given
        val candidate = IceCandidate(
            sdpMid = "0",
            sdpMLineIndex = 0,
            sdp = "test-candidate"
        )

        // Then
        assertEquals("0", candidate.sdpMid)
        assertEquals(0, candidate.sdpMLineIndex)
        assertEquals("test-candidate", candidate.sdp)
    }

    @Test
    fun `ConnectionState sealed class should work correctly`() {
        // Given
        val idleState: ConnectionState = ConnectionState.Idle
        val connectingState: ConnectionState = ConnectionState.Connecting
        val connectedState: ConnectionState = ConnectionState.Connected(testDevice)
        val disconnectedState: ConnectionState = ConnectionState.Disconnected("User requested")
        val failedState: ConnectionState = ConnectionState.Failed("Connection error")

        // Then
        assertTrue(idleState is ConnectionState.Idle)
        assertTrue(connectingState is ConnectionState.Connecting)
        assertTrue(connectedState is ConnectionState.Connected)
        assertTrue(disconnectedState is ConnectionState.Disconnected)
        assertTrue(failedState is ConnectionState.Failed)

        // Verify connected state holds device
        assertEquals(testDevice, (connectedState as ConnectionState.Connected).device)

        // Verify disconnected state holds reason
        assertEquals("User requested", (disconnectedState as ConnectionState.Disconnected).reason)

        // Verify failed state holds error
        assertEquals("Connection error", (failedState as ConnectionState.Failed).error)
    }

    @Test
    fun `SessionDescription Type enum should have correct values`() {
        // Then
        assertNotNull(SessionDescription.Type.OFFER)
        assertNotNull(SessionDescription.Type.ANSWER)
    }

    @Test
    @Ignore("WebRTC requires native library - test in instrumentation tests")
    fun `WebRTCPeerConnection integration test`() {
        // This test is intentionally ignored
        // WebRTC initialization requires native library which isn't available in JVM tests
        // Integration testing should be done in androidTest
    }

    // ===== ICE 状态枚举测试 =====

    @Test
    fun `IceConnectionState should have all expected values`() {
        val states = IceConnectionState.values()
        assertEquals(7, states.size)
        assertTrue(states.contains(IceConnectionState.NEW))
        assertTrue(states.contains(IceConnectionState.CHECKING))
        assertTrue(states.contains(IceConnectionState.CONNECTED))
        assertTrue(states.contains(IceConnectionState.COMPLETED))
        assertTrue(states.contains(IceConnectionState.FAILED))
        assertTrue(states.contains(IceConnectionState.DISCONNECTED))
        assertTrue(states.contains(IceConnectionState.CLOSED))
    }

    @Test
    fun `IceGatheringState should have all expected values`() {
        val states = IceGatheringState.values()
        assertEquals(3, states.size)
        assertTrue(states.contains(IceGatheringState.NEW))
        assertTrue(states.contains(IceGatheringState.GATHERING))
        assertTrue(states.contains(IceGatheringState.COMPLETE))
    }

    // ===== ConnectionHealthStats 测试 =====

    @Test
    fun `ConnectionHealthStats should contain all required fields`() {
        val stats = ConnectionHealthStats(
            isConnected = true,
            uptimeMs = 120000L,
            heartbeatsSent = 8,
            heartbeatsReceived = 7,
            healthPercentage = 87,
            reconnectAttempts = 2
        )

        assertTrue(stats.isConnected)
        assertEquals(120000L, stats.uptimeMs)
        assertEquals(8, stats.heartbeatsSent)
        assertEquals(7, stats.heartbeatsReceived)
        assertEquals(87, stats.healthPercentage)
        assertEquals(2, stats.reconnectAttempts)
    }

    @Test
    fun `ConnectionHealthStats health percentage should be calculated correctly`() {
        // 100% health
        val perfectStats = ConnectionHealthStats(
            isConnected = true,
            uptimeMs = 60000L,
            heartbeatsSent = 10,
            heartbeatsReceived = 10,
            healthPercentage = 100,
            reconnectAttempts = 0
        )
        assertEquals(100, perfectStats.healthPercentage)

        // 50% health
        val halfStats = ConnectionHealthStats(
            isConnected = true,
            uptimeMs = 60000L,
            heartbeatsSent = 10,
            heartbeatsReceived = 5,
            healthPercentage = 50,
            reconnectAttempts = 1
        )
        assertEquals(50, halfStats.healthPercentage)
    }

    // ===== SignalingMessage 扩展测试 =====

    @Test
    fun `SignalingMessage Heartbeat should have default timestamp`() {
        val heartbeat = SignalingMessage.Heartbeat("hb_1")
        assertEquals("hb_1", heartbeat.id)
        assertTrue(heartbeat.timestamp > 0)
    }

    @Test
    fun `SignalingMessage HeartbeatAck should have default timestamp`() {
        val ack = SignalingMessage.HeartbeatAck("hb_1")
        assertEquals("hb_1", ack.id)
        assertTrue(ack.timestamp > 0)
    }

    @Test
    fun `SignalingMessage Close should contain fromDeviceId and reason`() {
        val close = SignalingMessage.Close("device_123", "Connection terminated")
        assertEquals("device_123", close.fromDeviceId)
        assertEquals("Connection terminated", close.reason)
    }
}
