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
}
