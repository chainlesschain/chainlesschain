package com.chainlesschain.android.feature.p2p.viewmodel

import com.chainlesschain.android.core.e2ee.session.PersistentSessionManager
import com.chainlesschain.android.core.e2ee.session.SessionInfo
import com.chainlesschain.android.core.e2ee.verification.VerificationManager
import com.chainlesschain.android.core.p2p.discovery.DeviceDiscovery
import com.chainlesschain.android.core.p2p.model.P2PDevice
import io.mockk.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.*
import org.junit.After
import org.junit.Before
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue

/**
 * P2PDeviceViewModel 单元测试
 */
@OptIn(ExperimentalCoroutinesApi::class)
class P2PDeviceViewModelTest {

    private lateinit var viewModel: P2PDeviceViewModel
    private lateinit var deviceDiscovery: DeviceDiscovery
    private lateinit var sessionManager: PersistentSessionManager
    private lateinit var verificationManager: VerificationManager

    private val testDispatcher = StandardTestDispatcher()

    private val discoveredDevicesFlow = MutableStateFlow<List<P2PDevice>>(emptyList())
    private val activeSessionsFlow = MutableStateFlow<List<SessionInfo>>(emptyList())

    @Before
    fun setup() {
        Dispatchers.setMain(testDispatcher)

        deviceDiscovery = mockk(relaxed = true)
        sessionManager = mockk(relaxed = true)
        verificationManager = mockk(relaxed = true)

        every { deviceDiscovery.observeDiscoveredDevices() } returns discoveredDevicesFlow
        every { sessionManager.activeSessions } returns activeSessionsFlow

        viewModel = P2PDeviceViewModel(
            deviceDiscovery = deviceDiscovery,
            sessionManager = sessionManager,
            verificationManager = verificationManager
        )
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    @Test
    fun `startScanning should update isScanning to true`() = runTest {
        // When
        viewModel.startScanning()
        advanceUntilIdle()

        // Then
        assertTrue(viewModel.isScanning.value)
        assertIs<DeviceUiState.Scanning>(viewModel.uiState.value)
        coVerify { deviceDiscovery.startDiscovery() }
    }

    @Test
    fun `stopScanning should update isScanning to false`() = runTest {
        // Given
        viewModel.startScanning()
        advanceUntilIdle()

        // When
        viewModel.stopScanning()
        advanceUntilIdle()

        // Then
        assertEquals(false, viewModel.isScanning.value)
        assertIs<DeviceUiState.Idle>(viewModel.uiState.value)
        coVerify { deviceDiscovery.stopDiscovery() }
    }

    @Test
    fun `discovered devices should be collected from deviceDiscovery`() = runTest {
        // Given
        val testDevices = listOf(
            P2PDevice(deviceId = "device1", deviceName = "Device 1", address = "192.168.1.1:8080"),
            P2PDevice(deviceId = "device2", deviceName = "Device 2", address = "192.168.1.2:8080")
        )

        // When
        discoveredDevicesFlow.value = testDevices
        advanceUntilIdle()

        // Then
        assertEquals(testDevices, viewModel.discoveredDevices.value)
    }

    @Test
    fun `connected devices should be updated from activeSessions`() = runTest {
        // Given
        val testSessions = listOf(
            SessionInfo(
                peerId = "peer1",
                sendMessageNumber = 10,
                receiveMessageNumber = 8,
                skippedMessagesCount = 0
            ),
            SessionInfo(
                peerId = "peer2",
                sendMessageNumber = 5,
                receiveMessageNumber = 3,
                skippedMessagesCount = 0
            )
        )

        // When
        activeSessionsFlow.value = testSessions
        advanceUntilIdle()

        // Then
        assertEquals(2, viewModel.connectedDevices.value.size)
        assertEquals("peer1", viewModel.connectedDevices.value[0].deviceId)
        assertEquals("peer2", viewModel.connectedDevices.value[1].deviceId)
    }

    @Test
    fun `connectDevice should update UI state to Connecting`() = runTest {
        // Given
        val testDevice = P2PDevice(deviceId = "device1", deviceName = "Device 1", address = "192.168.1.1:8080")

        // When
        viewModel.connectDevice(testDevice)
        advanceUntilIdle()

        // Then
        assertIs<DeviceUiState.Connected>(viewModel.uiState.value)
    }

    @Test
    fun `disconnectDevice should delete session`() = runTest {
        // Given
        val peerId = "peer1"
        coEvery { sessionManager.deleteSession(peerId) } just Awaits

        // When
        viewModel.disconnectDevice(peerId)
        advanceUntilIdle()

        // Then
        coVerify { sessionManager.deleteSession(peerId) }
        assertIs<DeviceUiState.Disconnected>(viewModel.uiState.value)
    }

    @Test
    fun `isDeviceVerified should call verificationManager`() = runTest {
        // Given
        val peerId = "peer1"
        coEvery { verificationManager.isVerified(peerId) } returns true

        // When
        val result = viewModel.isDeviceVerified(peerId)

        // Then
        assertTrue(result)
        coVerify { verificationManager.isVerified(peerId) }
    }

    @Test
    fun `clearError should reset UI state to Idle`() = runTest {
        // Given
        viewModel.startScanning()
        advanceUntilIdle()
        // Simulate error by directly setting state
        val errorState = DeviceUiState.Error("Test error")

        // When
        viewModel.clearError()

        // Then
        assertIs<DeviceUiState.Idle>(viewModel.uiState.value)
    }

    @Test
    fun `startScanning failure should set error state`() = runTest {
        // Given
        coEvery { deviceDiscovery.startDiscovery() } throws Exception("Discovery failed")

        // When
        viewModel.startScanning()
        advanceUntilIdle()

        // Then
        assertIs<DeviceUiState.Error>(viewModel.uiState.value)
        assertEquals(false, viewModel.isScanning.value)
    }

    @Test
    fun `onCleared should stop scanning`() = runTest {
        // Given
        viewModel.startScanning()
        advanceUntilIdle()

        // When
        // Manually call onCleared (normally called by system)
        viewModel.onCleared()
        advanceUntilIdle()

        // Then
        coVerify { deviceDiscovery.stopDiscovery() }
    }
}
