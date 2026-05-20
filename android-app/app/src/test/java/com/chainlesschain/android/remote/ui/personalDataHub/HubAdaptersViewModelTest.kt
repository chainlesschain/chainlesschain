package com.chainlesschain.android.remote.ui.personalDataHub

import com.chainlesschain.android.remote.commands.AdapterMeta
import com.chainlesschain.android.remote.commands.AdaptersResponse
import com.chainlesschain.android.remote.commands.PersonalDataHubCommands
import com.chainlesschain.android.remote.commands.SyncReport
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
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
 * Phase 14.1.4 — HubAdaptersViewModel 单元测试。覆盖 init reload / sync 成功 /
 * sync 失败 / 列表为空 / reload 失败 / sync ingested 事件计数。
 */
@OptIn(ExperimentalCoroutinesApi::class)
class HubAdaptersViewModelTest {

    private val testDispatcher = StandardTestDispatcher()
    private lateinit var hub: PersonalDataHubCommands

    @Before
    fun setUp() {
        Dispatchers.setMain(testDispatcher)
        hub = mockk(relaxed = false)
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

        val vm = HubAdaptersViewModel(hub)
        advanceUntilIdle()

        assertEquals(2, vm.uiState.value.adapters.size)
        assertEquals("email-imap", vm.uiState.value.adapters[0].name)
        assertTrue(!vm.uiState.value.isLoading)
        assertNull(vm.uiState.value.errorMessage)
    }

    @Test
    fun `reload failure surfaces errorMessage and clears loading`() = runTest(testDispatcher) {
        coEvery { hub.listAdapters() } returns Result.failure(RuntimeException("no peer"))

        val vm = HubAdaptersViewModel(hub)
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

        val vm = HubAdaptersViewModel(hub)
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

        val vm = HubAdaptersViewModel(hub)
        advanceUntilIdle()
        vm.sync("email-imap")
        advanceUntilIdle()

        assertNull(vm.uiState.value.syncingAdapter)
        assertEquals("IMAP timeout", vm.uiState.value.errorMessage)
    }

    @Test
    fun `empty adapter list leaves state empty without error`() = runTest(testDispatcher) {
        coEvery { hub.listAdapters() } returns Result.success(AdaptersResponse(adapters = emptyList()))

        val vm = HubAdaptersViewModel(hub)
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

        val vm = HubAdaptersViewModel(hub)
        advanceUntilIdle()
        assertEquals(1, vm.uiState.value.adapters.size)

        vm.reload()
        advanceUntilIdle()
        assertEquals(2, vm.uiState.value.adapters.size)
        coVerify(exactly = 2) { hub.listAdapters() }
    }
}
