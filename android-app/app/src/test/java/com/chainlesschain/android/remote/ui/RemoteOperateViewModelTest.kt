package com.chainlesschain.android.remote.ui

import androidx.lifecycle.SavedStateHandle
import com.chainlesschain.android.core.p2p.pairing.PairedDesktop
import com.chainlesschain.android.core.p2p.pairing.PairedDesktopsStore
import com.chainlesschain.android.remote.client.SignalingRpcClient
import io.mockk.coEvery
import io.mockk.coVerify
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
import org.json.JSONObject
import org.junit.After
import org.junit.Before
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * RemoteOperateViewModel 单元测试 — v1.3+ issue #21 plan C。
 *
 * 不依赖 Robolectric——SignalingRpcClient + PairedDesktopsStore 全 mock，
 * SavedStateHandle 直接 new 出一个，纯 JVM 测试。
 */
@OptIn(ExperimentalCoroutinesApi::class)
class RemoteOperateViewModelTest {

    private val testDispatcher = StandardTestDispatcher()
    private lateinit var rpc: SignalingRpcClient
    private lateinit var store: PairedDesktopsStore
    private lateinit var devicesFlow: MutableStateFlow<List<PairedDesktop>>

    @Before
    fun setUp() {
        Dispatchers.setMain(testDispatcher)
        rpc = mockk(relaxed = false)
        store = mockk(relaxed = true)
        devicesFlow = MutableStateFlow(emptyList())
        every { store.devices } returns devicesFlow
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private fun makeVm(
        peerId: String = "desktop-peer-1",
        seedDesktop: PairedDesktop? = null,
    ): RemoteOperateViewModel {
        if (seedDesktop != null) {
            devicesFlow.value = listOf(seedDesktop)
        }
        val ssh = SavedStateHandle().apply { set("peerId", peerId) }
        return RemoteOperateViewModel(rpc, store, ssh)
    }

    @Test
    fun `initial state takes desktop name from store when matched`() {
        val vm = makeVm(
            peerId = "desktop-peer-1",
            seedDesktop = PairedDesktop(
                pcPeerId = "desktop-peer-1",
                deviceName = "My Mac",
            ),
        )

        val s = vm.state.value
        assertEquals("desktop-peer-1", s.pcPeerId)
        assertEquals("My Mac", s.desktopName)
        assertEquals(false, s.busy)
        assertNull(s.lastError)
        assertNull(s.lastResult)
    }

    @Test
    fun `initial state falls back to truncated peerId when no match in store`() {
        val vm = makeVm(peerId = "0123456789abcdefghij_extra")

        val s = vm.state.value
        // pcPeerId.take(12)
        assertEquals("0123456789ab", s.desktopName)
    }

    @Test
    fun `invoke success updates state with response and clears error`() = runTest(testDispatcher) {
        val vm = makeVm(peerId = "pc-1")
        val resultJson = JSONObject().apply { put("ok", true) }
        coEvery { rpc.invoke("pc-1", "system.ping", emptyMap()) } returns Result.success(resultJson)

        vm.invoke("Ping", "system.ping")
        advanceUntilIdle()

        val s = vm.state.value
        assertEquals(false, s.busy)
        assertEquals("Ping", s.lastLabel)
        assertNotNull(s.lastResult)
        assertTrue(s.lastResult!!.contains("\"ok\""))
        assertNull(s.lastError)
    }

    @Test
    fun `invoke failure updates lastError and clears busy`() = runTest(testDispatcher) {
        val vm = makeVm(peerId = "pc-1")
        coEvery {
            rpc.invoke("pc-1", "system.getStatus", emptyMap())
        } returns Result.failure(RuntimeException("relay down"))

        vm.invoke("Status", "system.getStatus")
        advanceUntilIdle()

        val s = vm.state.value
        assertEquals(false, s.busy)
        assertEquals("Status", s.lastLabel)
        assertEquals("relay down", s.lastError)
    }

    @Test
    fun `invoke failure with null message uses fallback text`() = runTest(testDispatcher) {
        val vm = makeVm(peerId = "pc-1")
        coEvery {
            rpc.invoke("pc-1", "system.ping", emptyMap())
        } returns Result.failure(RuntimeException(null as String?))

        vm.invoke("Ping", "system.ping")
        advanceUntilIdle()

        assertEquals("未知错误", vm.state.value.lastError)
    }

    @Test
    fun `unpair calls store remove with peerId`() {
        val vm = makeVm(peerId = "pc-1")

        vm.unpair()

        coVerify { store.remove("pc-1") }
    }
}
