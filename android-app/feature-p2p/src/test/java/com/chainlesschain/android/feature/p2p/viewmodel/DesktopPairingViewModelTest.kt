package com.chainlesschain.android.feature.p2p.viewmodel

import com.chainlesschain.android.core.did.manager.DIDIdentity
import com.chainlesschain.android.core.did.manager.DIDManager
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.After
import org.junit.Before
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * DesktopPairingViewModel 单元测试 — v1.1 W3.2 (issue #19)。
 *
 * 覆盖：
 *   - 默认 Idle 状态
 *   - startPairing 进 Displaying 状态 + payload 字段完整
 *   - code 6 位数字（与 desktop validatePairingCode `^\d{6}$` 对齐）
 *   - timestamp 来自注入 clock
 *   - 5 分钟后自动 Expired
 *   - cancelPairing 重置 Idle
 *   - markConfirmed 触发 Completed
 *   - DIDManager.currentIdentity 为 null 时 Failed
 *   - JSON payload 结构匹配 desktop device-pairing-handler.js validatePairingCode 字段
 */
@OptIn(ExperimentalCoroutinesApi::class)
class DesktopPairingViewModelTest {

    private lateinit var didManager: DIDManager
    private lateinit var didIdentityFlow: MutableStateFlow<DIDIdentity?>
    private val testDispatcher = StandardTestDispatcher()

    private val fakeDeviceInfo = object : PairingDeviceInfoProvider {
        override fun deviceId() = "android-test-uuid-123"
        override fun name() = "Pixel Test Device"
        override fun platform() = "android"
    }

    private fun fixedClock(t: Long) = object : PairingClock {
        override fun nowMillis() = t
    }

    private fun fixedCodeGen(code: String) = object : PairingCodeGenerator {
        override fun generate() = code
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

    private fun makeVM(
        code: String = "123456",
        nowMs: Long = 1_700_000_000_000L,
    ) = DesktopPairingViewModel(
        didManager = didManager,
        deviceInfoProvider = fakeDeviceInfo,
        clock = fixedClock(nowMs),
        codeGenerator = fixedCodeGen(code),
    )

    private fun seedActiveDid(did: String = "did:cc:mobile-test") {
        didIdentityFlow.value = DIDIdentity(
            did = did,
            deviceName = "Test Device",
            keyPair = mockk(relaxed = true),
            didDocument = mockk(relaxed = true),
            createdAt = 1L,
        )
    }

    @Test
    fun `initial state is Idle`() {
        val vm = makeVM()
        assertEquals(DesktopPairingState.Idle, vm.pairingState.value)
    }

    @Test
    fun `startPairing transitions to Displaying with full payload`() = runTest(testDispatcher) {
        seedActiveDid("did:cc:active-1")
        val vm = makeVM(code = "654321", nowMs = 1_700_000_000_000L)

        vm.startPairing()
        runCurrent() // 只跑 startPairing launch 不触发 delayed expiry job

        val state = vm.pairingState.value
        assertTrue(state is DesktopPairingState.Displaying)
        val displaying = state as DesktopPairingState.Displaying
        assertEquals("device-pairing", displaying.payload.type)
        assertEquals("654321", displaying.payload.code)
        assertEquals("did:cc:active-1", displaying.payload.did)
        assertEquals("android-test-uuid-123", displaying.payload.deviceInfo.deviceId)
        assertEquals("Pixel Test Device", displaying.payload.deviceInfo.name)
        assertEquals("android", displaying.payload.deviceInfo.platform)
        assertEquals(1_700_000_000_000L, displaying.payload.timestamp)
        assertEquals(1_700_000_000_000L + 5 * 60 * 1000, displaying.expiresAt)
    }

    @Test
    fun `random code generator produces 6 digit strings`() {
        // 不 mock，验真生成器满足 desktop validatePairingCode 的正则 ^\d{6}$
        val regex = Regex("^\\d{6}$")
        repeat(50) {
            val code = PairingCodeGenerator.Random.generate()
            assertTrue(regex.matches(code), "$code should match ^\\d{6}$")
        }
    }

    @Test
    fun `payload JSON contains exact desktop-required fields`() = runTest(testDispatcher) {
        seedActiveDid("did:cc:json-check")
        val vm = makeVM(code = "111222", nowMs = 1_700_000_000_000L)

        vm.startPairing()
        runCurrent() // 只跑 startPairing launch 不触发 delayed expiry job

        val state = vm.pairingState.value as DesktopPairingState.Displaying
        val obj = Json.parseToJsonElement(state.payloadJson).jsonObject

        // 与 device-pairing-handler.js validatePairingCode 检查的字段对齐
        assertEquals("device-pairing", obj["type"]?.jsonPrimitive?.content)
        assertEquals("111222", obj["code"]?.jsonPrimitive?.content)
        assertEquals("did:cc:json-check", obj["did"]?.jsonPrimitive?.content)
        assertEquals(1_700_000_000_000L, obj["timestamp"]?.jsonPrimitive?.content?.toLong())
        // deviceInfo 嵌套 object
        val deviceInfo = obj["deviceInfo"]?.jsonObject
        assertTrue(deviceInfo != null)
        assertEquals("android-test-uuid-123", deviceInfo!!["deviceId"]?.jsonPrimitive?.content)
    }

    @Test
    fun `auto-expires to Expired after 5 minutes`() = runTest(testDispatcher) {
        seedActiveDid()
        val vm = makeVM()
        vm.startPairing()
        runCurrent() // 只跑 startPairing launch 不触发 delayed expiry job
        assertTrue(vm.pairingState.value is DesktopPairingState.Displaying)

        advanceTimeBy(DesktopPairingViewModel.PAIRING_TIMEOUT_MS + 100)
        advanceUntilIdle()

        assertEquals(DesktopPairingState.Expired, vm.pairingState.value)
    }

    @Test
    fun `cancelPairing resets to Idle and stops expiry timer`() = runTest(testDispatcher) {
        seedActiveDid()
        val vm = makeVM()
        vm.startPairing()
        runCurrent() // 只跑 startPairing launch 不触发 delayed expiry job

        vm.cancelPairing()
        assertEquals(DesktopPairingState.Idle, vm.pairingState.value)

        // expiry timer 已 cancel — 推进 6 min 不再变 Expired
        advanceTimeBy(DesktopPairingViewModel.PAIRING_TIMEOUT_MS + 1000)
        advanceUntilIdle()
        assertEquals(DesktopPairingState.Idle, vm.pairingState.value)
    }

    @Test
    fun `markConfirmed transitions Displaying to Completed`() = runTest(testDispatcher) {
        seedActiveDid()
        val vm = makeVM()
        vm.startPairing()
        runCurrent() // 只跑 startPairing launch 不触发 delayed expiry job

        vm.markConfirmed()

        assertEquals(DesktopPairingState.Completed, vm.pairingState.value)
    }

    @Test
    fun `markConfirmed is no-op when not Displaying`() = runTest(testDispatcher) {
        seedActiveDid()
        val vm = makeVM()

        // From Idle — should not transition
        vm.markConfirmed()
        assertEquals(DesktopPairingState.Idle, vm.pairingState.value)
    }

    @Test
    fun `startPairing fails with Failed state when no active DID`() = runTest(testDispatcher) {
        // didIdentityFlow stays at null (no seedActiveDid call)
        val vm = makeVM()
        vm.startPairing()
        runCurrent() // 只跑 startPairing launch 不触发 delayed expiry job

        val state = vm.pairingState.value
        assertTrue(state is DesktopPairingState.Failed)
        assertTrue((state as DesktopPairingState.Failed).error.contains("DID"))
    }

    @Test
    fun `startPairing twice regenerates code and timestamp`() = runTest(testDispatcher) {
        seedActiveDid()
        val genQueue = ArrayDeque(listOf("111111", "222222"))
        val vm = DesktopPairingViewModel(
            didManager = didManager,
            deviceInfoProvider = fakeDeviceInfo,
            clock = fixedClock(1_700_000_000_000L),
            codeGenerator = object : PairingCodeGenerator {
                override fun generate() = genQueue.removeFirst()
            },
        )

        vm.startPairing()
        runCurrent() // 只跑 startPairing launch 不触发 delayed expiry job
        assertEquals("111111", (vm.pairingState.value as DesktopPairingState.Displaying).payload.code)

        vm.startPairing()
        runCurrent() // 只跑 startPairing launch 不触发 delayed expiry job
        assertEquals("222222", (vm.pairingState.value as DesktopPairingState.Displaying).payload.code)
    }
}
