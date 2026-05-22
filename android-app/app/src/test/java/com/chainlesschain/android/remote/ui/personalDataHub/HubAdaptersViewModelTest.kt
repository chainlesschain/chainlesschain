package com.chainlesschain.android.remote.ui.personalDataHub

import com.chainlesschain.android.remote.commands.AdapterMeta
import com.chainlesschain.android.remote.commands.AdaptersResponse
import com.chainlesschain.android.remote.commands.HubStreamStartResponse
import com.chainlesschain.android.remote.commands.PersonalDataHubCommands
import com.chainlesschain.android.remote.commands.SyncReport
import com.chainlesschain.android.remote.events.HubSyncEvent
import com.chainlesschain.android.remote.events.HubSyncEventDispatcher
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableSharedFlow
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
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Phase 14.1.4 + 14.3.1 — HubAdaptersViewModel 单元测试。覆盖：
 *  - init reload / 列表为空 / reload 失败 / manual reload
 *  - 非流式 sync（成功 / 失败）
 *  - 流式 syncStream（启动 / fetching 进度 / done / error / 其它 adapter 隔离 / 启动失败）
 */
@OptIn(ExperimentalCoroutinesApi::class)
class HubAdaptersViewModelTest {

    private val testDispatcher = StandardTestDispatcher()
    private lateinit var hub: PersonalDataHubCommands
    private lateinit var syncDispatcher: HubSyncEventDispatcher
    private lateinit var dispatcherEvents: MutableSharedFlow<HubSyncEvent>
    // Path C — VM ctor grew systemDataCollector. These tests cover non-Path-C
    // flows, so a relaxed mock is enough: snapshot()/Singleton wiring isn't touched.
    private lateinit var systemDataCollector: SystemDataLocalCollector

    @Before
    fun setUp() {
        Dispatchers.setMain(testDispatcher)
        hub = mockk(relaxed = false)
        syncDispatcher = mockk(relaxed = false)
        dispatcherEvents = MutableSharedFlow(replay = 0, extraBufferCapacity = 32)
        every { syncDispatcher.events } returns dispatcherEvents
        systemDataCollector = mockk(relaxed = true)
    }

    @After
    fun tearDown() { Dispatchers.resetMain() }

    @Test
    fun `init reload populates adapters list`() = runTest(testDispatcher) {
        val adapters = listOf(
            AdapterMeta("email-imap", "1.0.0", listOf("ingest"), "high"),
            AdapterMeta("alipay-bill", "1.0.0", listOf("import"), "critical")
        )
        coEvery { hub.listAdapters() } returns Result.success(AdaptersResponse(adapters = adapters))

        val vm = HubAdaptersViewModel(hub, syncDispatcher, systemDataCollector)
        advanceUntilIdle()

        assertEquals(2, vm.uiState.value.adapters.size)
        assertEquals("email-imap", vm.uiState.value.adapters[0].name)
        assertTrue(!vm.uiState.value.isLoading)
        assertNull(vm.uiState.value.errorMessage)
    }

    @Test
    fun `reload failure surfaces errorMessage and clears loading`() = runTest(testDispatcher) {
        coEvery { hub.listAdapters() } returns Result.failure(RuntimeException("no peer"))

        val vm = HubAdaptersViewModel(hub, syncDispatcher, systemDataCollector)
        advanceUntilIdle()

        assertTrue(vm.uiState.value.adapters.isEmpty())
        assertTrue(!vm.uiState.value.isLoading)
        assertEquals("no peer", vm.uiState.value.errorMessage)
    }

    @Test
    fun `sync success clears syncingAdapter and stores lastReport`() = runTest(testDispatcher) {
        coEvery { hub.listAdapters() } returns Result.success(AdaptersResponse())
        coEvery { hub.syncAdapter(name = "email-imap") } returns Result.success(
            SyncReport(adapter = "email-imap", ingested = 42)
        )

        val vm = HubAdaptersViewModel(hub, syncDispatcher, systemDataCollector)
        advanceUntilIdle()
        vm.sync("email-imap")
        advanceUntilIdle()

        assertNull(vm.uiState.value.syncingAdapter)
        assertNotNull(vm.uiState.value.lastReport)
        assertEquals(42L, vm.uiState.value.lastReport?.ingested)
        coVerify(exactly = 1) { hub.syncAdapter(name = "email-imap") }
    }

    @Test
    fun `sync failure clears syncingAdapter and sets errorMessage`() = runTest(testDispatcher) {
        coEvery { hub.listAdapters() } returns Result.success(AdaptersResponse())
        coEvery { hub.syncAdapter(name = "email-imap") } returns Result.failure(
            RuntimeException("IMAP timeout")
        )

        val vm = HubAdaptersViewModel(hub, syncDispatcher, systemDataCollector)
        advanceUntilIdle()
        vm.sync("email-imap")
        advanceUntilIdle()

        assertNull(vm.uiState.value.syncingAdapter)
        assertEquals("IMAP timeout", vm.uiState.value.errorMessage)
    }

    @Test
    fun `empty adapter list leaves state empty without error`() = runTest(testDispatcher) {
        coEvery { hub.listAdapters() } returns Result.success(AdaptersResponse(adapters = emptyList()))

        val vm = HubAdaptersViewModel(hub, syncDispatcher, systemDataCollector)
        advanceUntilIdle()

        assertTrue(vm.uiState.value.adapters.isEmpty())
        assertNull(vm.uiState.value.errorMessage)
        assertTrue(!vm.uiState.value.isLoading)
    }

    @Test
    fun `manual reload after init refetches adapters`() = runTest(testDispatcher) {
        val initial = listOf(AdapterMeta("a", "1.0", emptyList(), null))
        val refreshed = listOf(
            AdapterMeta("a", "1.0", emptyList(), null),
            AdapterMeta("b", "1.0", emptyList(), null)
        )
        coEvery { hub.listAdapters() } returnsMany listOf(
            Result.success(AdaptersResponse(adapters = initial)),
            Result.success(AdaptersResponse(adapters = refreshed))
        )

        val vm = HubAdaptersViewModel(hub, syncDispatcher, systemDataCollector)
        advanceUntilIdle()
        assertEquals(1, vm.uiState.value.adapters.size)

        vm.reload()
        advanceUntilIdle()
        assertEquals(2, vm.uiState.value.adapters.size)
        coVerify(exactly = 2) { hub.listAdapters() }
    }

    // ==================== Phase 14.3.1 streaming path ====================

    @Test
    fun `syncStream sets syncingAdapter + initial connecting kind`() = runTest(testDispatcher) {
        coEvery { hub.listAdapters() } returns Result.success(AdaptersResponse())
        coEvery { hub.syncAdapterStream(name = "email-imap") } returns
            Result.success(HubStreamStartResponse(streamId = "s-1", name = "email-imap"))

        val vm = HubAdaptersViewModel(hub, syncDispatcher, systemDataCollector)
        advanceUntilIdle()
        vm.syncStream("email-imap")
        advanceUntilIdle()

        assertEquals("email-imap", vm.uiState.value.syncingAdapter)
        assertEquals("connecting", vm.uiState.value.syncProgressKind)
        coVerify(exactly = 1) { hub.syncAdapterStream(name = "email-imap") }
    }

    @Test
    fun `dispatcher fetching event updates progress kind + partition + detail`() = runTest(testDispatcher) {
        coEvery { hub.listAdapters() } returns Result.success(AdaptersResponse())
        coEvery { hub.syncAdapterStream(name = "email-imap") } returns
            Result.success(HubStreamStartResponse(streamId = "s-1"))

        val vm = HubAdaptersViewModel(hub, syncDispatcher, systemDataCollector)
        advanceUntilIdle()
        vm.syncStream("email-imap")
        advanceUntilIdle()

        dispatcherEvents.emit(
            HubSyncEvent(
                kind = "fetching",
                adapter = "email-imap",
                partition = "INBOX",
                detail = mapOf("uidsScanned" to 200L),
            ),
        )
        advanceUntilIdle()

        val s = vm.uiState.value
        assertEquals("fetching", s.syncProgressKind)
        assertEquals("INBOX", s.syncProgressPartition)
        assertEquals(200L, s.syncProgressDetail?.get("uidsScanned"))
        assertEquals("email-imap", s.syncingAdapter)
    }

    @Test
    fun `dispatcher done event clears syncingAdapter and stores SyncReport`() = runTest(testDispatcher) {
        coEvery { hub.listAdapters() } returns Result.success(AdaptersResponse())
        coEvery { hub.syncAdapterStream(name = "email-imap") } returns
            Result.success(HubStreamStartResponse(streamId = "s-1"))

        val vm = HubAdaptersViewModel(hub, syncDispatcher, systemDataCollector)
        advanceUntilIdle()
        vm.syncStream("email-imap")
        advanceUntilIdle()

        val report = SyncReport(adapter = "email-imap", ingested = 30, kgTriples = 90, durationMs = 18200)
        dispatcherEvents.emit(
            HubSyncEvent(kind = "done", adapter = "email-imap", report = report),
        )
        advanceUntilIdle()

        val s = vm.uiState.value
        assertNull(s.syncingAdapter)
        assertNull(s.syncProgressKind)
        assertEquals(30L, s.lastReport?.ingested)
        assertEquals(18200L, s.lastReport?.durationMs)
    }

    @Test
    fun `dispatcher error event clears syncing + sets errorMessage`() = runTest(testDispatcher) {
        coEvery { hub.listAdapters() } returns Result.success(AdaptersResponse())
        coEvery { hub.syncAdapterStream(name = "alipay-bill") } returns
            Result.success(HubStreamStartResponse(streamId = "s-2"))

        val vm = HubAdaptersViewModel(hub, syncDispatcher, systemDataCollector)
        advanceUntilIdle()
        vm.syncStream("alipay-bill")
        advanceUntilIdle()

        dispatcherEvents.emit(
            HubSyncEvent(kind = "error", adapter = "alipay-bill", message = "ZIP password incorrect"),
        )
        advanceUntilIdle()

        val s = vm.uiState.value
        assertNull(s.syncingAdapter)
        assertNull(s.syncProgressKind)
        assertEquals("ZIP password incorrect", s.errorMessage)
    }

    @Test
    fun `dispatcher event for other adapter is ignored while syncing target adapter`() = runTest(testDispatcher) {
        coEvery { hub.listAdapters() } returns Result.success(AdaptersResponse())
        coEvery { hub.syncAdapterStream(name = "email-imap") } returns
            Result.success(HubStreamStartResponse(streamId = "s-1"))

        val vm = HubAdaptersViewModel(hub, syncDispatcher, systemDataCollector)
        advanceUntilIdle()
        vm.syncStream("email-imap")
        advanceUntilIdle()

        // alipay-bill event arrives — should NOT touch our state (we're syncing email-imap)
        dispatcherEvents.emit(
            HubSyncEvent(kind = "fetching", adapter = "alipay-bill", partition = "2025"),
        )
        advanceUntilIdle()

        val s = vm.uiState.value
        // Still on initial "connecting" — alipay event filtered out
        assertEquals("connecting", s.syncProgressKind)
        assertNull(s.syncProgressPartition)
        assertEquals("email-imap", s.syncingAdapter)
    }

    @Test
    fun `syncStream failure to start clears syncing + sets errorMessage`() = runTest(testDispatcher) {
        coEvery { hub.listAdapters() } returns Result.success(AdaptersResponse())
        coEvery { hub.syncAdapterStream(name = "email-imap") } returns
            Result.failure(RuntimeException("DC closed"))

        val vm = HubAdaptersViewModel(hub, syncDispatcher, systemDataCollector)
        advanceUntilIdle()
        vm.syncStream("email-imap")
        advanceUntilIdle()

        val s = vm.uiState.value
        assertNull(s.syncingAdapter)
        assertNull(s.syncProgressKind)
        assertEquals("DC closed", s.errorMessage)
    }
}
