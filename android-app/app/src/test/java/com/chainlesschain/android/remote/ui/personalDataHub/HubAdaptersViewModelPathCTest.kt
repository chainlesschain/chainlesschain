package com.chainlesschain.android.remote.ui.personalDataHub

import com.chainlesschain.android.remote.commands.AdaptersResponse
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
import kotlinx.coroutines.flow.asSharedFlow
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
 * Path C unit tests for `HubAdaptersViewModel.collectAndIngestSystemDataAndroid()`.
 *
 * Mocks the collector + commands; verifies state transitions (syncing on/off,
 * progress kind + partition), payload shape, success / collector-failure /
 * ingest-failure branches.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class HubAdaptersViewModelPathCTest {

    private val testDispatcher = StandardTestDispatcher()
    private lateinit var hub: PersonalDataHubCommands
    private lateinit var dispatcher: HubSyncEventDispatcher
    private lateinit var collector: SystemDataLocalCollector
    private val eventsFlow = MutableSharedFlow<HubSyncEvent>(replay = 0)

    @Before
    fun setUp() {
        Dispatchers.setMain(testDispatcher)
        hub = mockk(relaxed = false)
        dispatcher = mockk(relaxed = false)
        collector = mockk(relaxed = false)
        every { dispatcher.events } returns eventsFlow.asSharedFlow()
        coEvery { hub.listAdapters() } returns Result.success(AdaptersResponse(emptyList()))
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private fun newVm() = HubAdaptersViewModel(hub, dispatcher, collector)

    private val sampleSnapshot = Snapshot(
        schemaVersion = 1,
        snapshottedAt = 1_700_000_000_000L,
        contacts = listOf(
            Contact(
                lookupKey = "ck-1",
                displayName = "妈妈",
                phones = listOf("13800000001"),
                emails = emptyList(),
                starred = true,
                organization = null,
                photoUri = null,
            ),
        ),
        apps = listOf(
            AppInfo(
                packageName = "com.tencent.mm",
                label = "微信",
                versionName = "8.0",
                versionCode = 2960,
                firstInstallTime = 1L,
                lastUpdateTime = 2L,
                isSystem = false,
            ),
        ),
    )

    @Test
    fun `collectAndIngest happy path emits SyncReport and clears syncing state`() = runTest(testDispatcher) {
        every { collector.snapshot() } returns sampleSnapshot
        coEvery { hub.ingestSystemDataAndroid(any()) } returns Result.success(
            SyncReport(adapter = "system-data-android", ingested = 2L)
        )

        val vm = newVm()
        advanceUntilIdle()
        vm.collectAndIngestSystemDataAndroid()
        advanceUntilIdle()

        val s = vm.uiState.value
        assertNull(s.syncingAdapter)
        assertNull(s.syncProgressKind)
        assertEquals(2L, s.lastReport?.ingested)
        assertNull(s.errorMessage)

        coVerify {
            hub.ingestSystemDataAndroid(match { payload ->
                payload["schemaVersion"] == 1 &&
                    (payload["contacts"] as List<*>).size == 1 &&
                    (payload["apps"] as List<*>).size == 1
            })
        }
    }

    @Test
    fun `collectAndIngest forwards collector failure as errorMessage`() = runTest(testDispatcher) {
        every { collector.snapshot() } throws RuntimeException("permission denied")
        val vm = newVm()
        advanceUntilIdle()
        vm.collectAndIngestSystemDataAndroid()
        advanceUntilIdle()

        val s = vm.uiState.value
        assertNull(s.syncingAdapter)
        assertNotNull(s.errorMessage)
        assertTrue(s.errorMessage!!.contains("permission denied"))
        coVerify(exactly = 0) { hub.ingestSystemDataAndroid(any()) }
    }

    @Test
    fun `collectAndIngest forwards ingest failure as errorMessage`() = runTest(testDispatcher) {
        every { collector.snapshot() } returns sampleSnapshot
        coEvery { hub.ingestSystemDataAndroid(any()) } returns Result.failure(
            RuntimeException("desktop offline")
        )
        val vm = newVm()
        advanceUntilIdle()
        vm.collectAndIngestSystemDataAndroid()
        advanceUntilIdle()

        val s = vm.uiState.value
        assertNull(s.syncingAdapter)
        assertNotNull(s.errorMessage)
        assertTrue(s.errorMessage!!.contains("desktop offline"))
        assertNull(s.lastReport)
    }
}
