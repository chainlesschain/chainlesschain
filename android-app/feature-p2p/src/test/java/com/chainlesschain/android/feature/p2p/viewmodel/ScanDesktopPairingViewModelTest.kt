package com.chainlesschain.android.feature.p2p.viewmodel

import com.chainlesschain.android.core.did.manager.DIDIdentity
import com.chainlesschain.android.core.did.manager.DIDManager
import com.chainlesschain.android.core.p2p.pairing.PairingSignalingGate
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Before
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/**
 * ScanDesktopPairingViewModel 单元测试 — v1.1 W3.7 Flow B (issue #19)。
 *
 * 覆盖 ScanDesktopPairingViewModel.onQrScanned 的全部 validation 分支 +
 * happy path + retry。
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ScanDesktopPairingViewModelTest {

    private lateinit var didManager: DIDManager
    private lateinit var didIdentityFlow: MutableStateFlow<DIDIdentity?>
    private val testDispatcher = StandardTestDispatcher()

    private val fakeDeviceInfo = object : PairingDeviceInfoProvider {
        override fun deviceId() = "mobile-uuid-abc"
        override fun name() = "Test Phone"
        override fun platform() = "android"
    }

    private fun fixedClock(t: Long) = object : PairingClock {
        override fun nowMillis() = t
    }

    /** Fake gate captures sendAck calls; configurable to fail. */
    private class FakeGate(
        private val sendAckResult: Result<Unit> = Result.success(Unit),
    ) : PairingSignalingGate {
        var lastAckTarget: String? = null
        var lastAckPayload: Map<String, Any?>? = null
        var sendAckCallCount: Int = 0

        override suspend fun ensureRegistered(localPeerId: String): Result<Unit> =
            Result.success(Unit)

        override suspend fun sendAck(
            toPeerId: String,
            ackPayload: Map<String, Any?>,
        ): Result<Unit> {
            lastAckTarget = toPeerId
            lastAckPayload = ackPayload
            sendAckCallCount++
            return sendAckResult
        }
    }

    @Before
    fun setUp() {
        Dispatchers.setMain(testDispatcher)
        didManager = mockk(relaxed = true)
        didIdentityFlow = MutableStateFlow(null)
        every { didManager.currentIdentity } returns didIdentityFlow
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private fun seedActiveDid(did: String = "did:cc:mobile") {
        didIdentityFlow.value = DIDIdentity(
            did = did,
            deviceName = "Test",
            keyPair = mockk(relaxed = true),
            didDocument = mockk(relaxed = true),
            createdAt = 1L,
        )
    }

    private fun makeVM(
        nowMs: Long = 1_700_000_000_000L,
        gate: FakeGate = FakeGate(),
    ): Pair<ScanDesktopPairingViewModel, FakeGate> {
        val vm = ScanDesktopPairingViewModel(
            didManager = didManager,
            signalingGate = gate,
            signalingConfig = io.mockk.mockk(relaxed = true),
            pairedDesktopsStore = io.mockk.mockk(relaxed = true),
            deviceInfoProvider = fakeDeviceInfo,
            clock = fixedClock(nowMs),
        )
        return vm to gate
    }

    /** Build a valid desktop QR payload matching desktop-pair-handlers shape. */
    private fun validQrJson(
        code: String = "123456",
        pcPeerId: String = "desktop-peer-1",
        timestamp: Long = 1_700_000_000_000L,
        type: String = "desktop-pairing",
    ): String = """
        {
          "type":"$type",
          "code":"$code",
          "pcPeerId":"$pcPeerId",
          "deviceInfo":{"name":"My Desktop","platform":"win32","version":"v1.1"},
          "timestamp":"$timestamp"
        }
    """.trimIndent()

    @Test
    fun `initial state is Scanning`() {
        val (vm, _) = makeVM()
        assertEquals(ScanDesktopPairingState.Scanning, vm.state.value)
    }

    @Test
    fun `valid QR transitions Scanning to Success and sends ack payload`() =
        runTest(testDispatcher) {
            seedActiveDid("did:cc:happy")
            val (vm, gate) = makeVM(nowMs = 1_700_000_000_000L)

            vm.onQrScanned(validQrJson(code = "654321", pcPeerId = "pc-xyz"))
            advanceUntilIdle()

            val state = vm.state.value
            assertTrue(state is ScanDesktopPairingState.Success, "got $state")
            assertEquals("My Desktop", (state as ScanDesktopPairingState.Success).desktopName)
            assertEquals(1, gate.sendAckCallCount)
            assertEquals("pc-xyz", gate.lastAckTarget)
            val payload = gate.lastAckPayload
            assertNotNull(payload)
            assertEquals("pair-ack", payload["type"])
            assertEquals("654321", payload["pairingCode"])
            assertEquals("did:cc:happy", payload["mobileDid"])
            assertEquals(1_700_000_000_000L, payload["timestamp"])
            @Suppress("UNCHECKED_CAST")
            val deviceInfo = payload["deviceInfo"] as Map<String, Any?>
            assertEquals("mobile-uuid-abc", deviceInfo["deviceId"])
            assertEquals("Test Phone", deviceInfo["name"])
            assertEquals("android", deviceInfo["platform"])
        }

    @Test
    fun `wrong type field fails without invoking signaling`() =
        runTest(testDispatcher) {
            seedActiveDid()
            val (vm, gate) = makeVM()

            vm.onQrScanned(validQrJson(type = "device-pairing")) // 反向类型
            advanceUntilIdle()

            val state = vm.state.value as? ScanDesktopPairingState.Failed
            assertNotNull(state)
            assertTrue(state.error.contains("不是桌面配对 QR"), "got ${state.error}")
            assertEquals(0, gate.sendAckCallCount)
        }

    @Test
    fun `invalid code rejected (not 6 digits)`() =
        runTest(testDispatcher) {
            seedActiveDid()
            val (vm, gate) = makeVM()

            vm.onQrScanned(validQrJson(code = "12345")) // 5 位
            advanceUntilIdle()

            val state = vm.state.value as? ScanDesktopPairingState.Failed
            assertNotNull(state)
            assertTrue(state.error.contains("6 位"), "got ${state.error}")
            assertEquals(0, gate.sendAckCallCount)
        }

    @Test
    fun `blank pcPeerId rejected`() = runTest(testDispatcher) {
        seedActiveDid()
        val (vm, gate) = makeVM()

        vm.onQrScanned(validQrJson(pcPeerId = ""))
        advanceUntilIdle()

        val state = vm.state.value as? ScanDesktopPairingState.Failed
        assertNotNull(state)
        assertTrue(state.error.contains("pcPeerId"), "got ${state.error}")
        assertEquals(0, gate.sendAckCallCount)
    }

    @Test
    fun `expired QR rejected (older than 5 minutes)`() = runTest(testDispatcher) {
        seedActiveDid()
        val (vm, gate) = makeVM(nowMs = 1_700_000_000_000L + 6 * 60 * 1000)

        vm.onQrScanned(validQrJson(timestamp = 1_700_000_000_000L))
        advanceUntilIdle()

        val state = vm.state.value as? ScanDesktopPairingState.Failed
        assertNotNull(state)
        assertTrue(state.error.contains("过期"), "got ${state.error}")
        assertEquals(0, gate.sendAckCallCount)
    }

    @Test
    fun `no DID rejected`() = runTest(testDispatcher) {
        // 不 seedActiveDid → didIdentityFlow.value == null
        val (vm, gate) = makeVM()

        vm.onQrScanned(validQrJson())
        advanceUntilIdle()

        val state = vm.state.value as? ScanDesktopPairingState.Failed
        assertNotNull(state)
        assertTrue(state.error.contains("DID"), "got ${state.error}")
        assertEquals(0, gate.sendAckCallCount)
    }

    @Test
    fun `signaling gate failure surfaces Failed`() = runTest(testDispatcher) {
        seedActiveDid()
        val (vm, gate) = makeVM(
            gate = FakeGate(sendAckResult = Result.failure(RuntimeException("ws broken"))),
        )

        vm.onQrScanned(validQrJson())
        advanceUntilIdle()

        // v1.3+: LAN sendAck failure triggers retry on relay. Same FakeGate
        // result returns failure on the second call too, so we end up in the
        // "LAN+relay both fail" branch — error message contains both prefixes
        // and sendAckCallCount is 2.
        val state = vm.state.value as? ScanDesktopPairingState.Failed
        assertNotNull(state)
        assertTrue(state.error.contains("通知桌面失败"), "got ${state.error}")
        assertTrue(state.error.contains("ws broken"), "got ${state.error}")
        assertEquals(2, gate.sendAckCallCount)
    }

    @Test
    fun `retry resets state to Scanning`() = runTest(testDispatcher) {
        seedActiveDid()
        val (vm, _) = makeVM(
            gate = FakeGate(sendAckResult = Result.failure(RuntimeException("fail"))),
        )

        vm.onQrScanned(validQrJson())
        advanceUntilIdle()
        assertTrue(vm.state.value is ScanDesktopPairingState.Failed)

        vm.retry()
        assertEquals(ScanDesktopPairingState.Scanning, vm.state.value)
    }

    @Test
    fun `repeated scan after success is idempotent (no second ack)`() =
        runTest(testDispatcher) {
            seedActiveDid()
            val (vm, gate) = makeVM()

            vm.onQrScanned(validQrJson())
            advanceUntilIdle()
            assertTrue(vm.state.value is ScanDesktopPairingState.Success)

            vm.onQrScanned(validQrJson()) // 第二次不应再发 ack
            advanceUntilIdle()
            assertEquals(1, gate.sendAckCallCount)
        }

    @Test
    fun `malformed JSON surfaces Failed`() = runTest(testDispatcher) {
        seedActiveDid()
        val (vm, gate) = makeVM()

        vm.onQrScanned("not-json-at-all")
        advanceUntilIdle()

        assertTrue(vm.state.value is ScanDesktopPairingState.Failed)
        assertEquals(0, gate.sendAckCallCount)
    }
}
