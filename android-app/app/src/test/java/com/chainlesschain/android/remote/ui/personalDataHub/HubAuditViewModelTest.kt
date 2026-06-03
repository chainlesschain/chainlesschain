package com.chainlesschain.android.remote.ui.personalDataHub

import com.chainlesschain.android.remote.commands.AuditRow
import com.chainlesschain.android.remote.commands.AuditRowsResponse
import com.chainlesschain.android.remote.commands.EventDetailResponse
import com.chainlesschain.android.remote.commands.HubEvent
import com.chainlesschain.android.remote.commands.PersonalDataHubCommands
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import kotlinx.coroutines.CompletableDeferred
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
 * Phase 14.1.5 — HubAuditViewModel 单元测试。Cover init reload / action filter
 * reapply / limit forwarded / error path。
 */
@OptIn(ExperimentalCoroutinesApi::class)
class HubAuditViewModelTest {

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
    fun `init reload fetches first page with null action and default limit`() = runTest(testDispatcher) {
        val rows = listOf(
            AuditRow(at = 1000L, action = "ask", adapter = null, actor = "user"),
            AuditRow(at = 1100L, action = "ingest", adapter = "email-imap")
        )
        coEvery { hub.recentAudit(action = null, limit = DEFAULT_AUDIT_LIMIT) } returns
            Result.success(AuditRowsResponse(rows = rows))

        val vm = HubAuditViewModel(hub)
        advanceUntilIdle()

        assertEquals(2, vm.uiState.value.rows.size)
        assertEquals("ask", vm.uiState.value.rows[0].action)
        assertTrue(!vm.uiState.value.isLoading)
        coVerify(exactly = 1) { hub.recentAudit(action = null, limit = DEFAULT_AUDIT_LIMIT) }
    }

    @Test
    fun `setActionFilter reapplies reload with new filter`() = runTest(testDispatcher) {
        coEvery { hub.recentAudit(action = null, limit = DEFAULT_AUDIT_LIMIT) } returns
            Result.success(AuditRowsResponse(rows = emptyList()))
        coEvery { hub.recentAudit(action = "ingest", limit = DEFAULT_AUDIT_LIMIT) } returns
            Result.success(AuditRowsResponse(rows = listOf(AuditRow(at = 1L, action = "ingest"))))

        val vm = HubAuditViewModel(hub)
        advanceUntilIdle()
        vm.setActionFilter("ingest")
        advanceUntilIdle()

        assertEquals("ingest", vm.uiState.value.actionFilter)
        assertEquals(1, vm.uiState.value.rows.size)
        coVerify(exactly = 1) { hub.recentAudit(action = "ingest", limit = DEFAULT_AUDIT_LIMIT) }
    }

    @Test
    fun `setActionFilter to null clears filter and reloads`() = runTest(testDispatcher) {
        coEvery { hub.recentAudit(any(), any(), any()) } returns
            Result.success(AuditRowsResponse(rows = emptyList()))

        val vm = HubAuditViewModel(hub)
        advanceUntilIdle()
        vm.setActionFilter("ingest")
        advanceUntilIdle()
        vm.setActionFilter(null)
        advanceUntilIdle()

        assertNull(vm.uiState.value.actionFilter)
        // init reload + setActionFilter(null) → 2 calls with action=null
        coVerify(exactly = 2) { hub.recentAudit(action = null, limit = DEFAULT_AUDIT_LIMIT) }
    }

    @Test
    fun `reload failure clears loading and surfaces errorMessage`() = runTest(testDispatcher) {
        coEvery { hub.recentAudit(action = null, limit = DEFAULT_AUDIT_LIMIT) } returns
            Result.failure(RuntimeException("DC closed"))

        val vm = HubAuditViewModel(hub)
        advanceUntilIdle()

        assertTrue(vm.uiState.value.rows.isEmpty())
        assertTrue(!vm.uiState.value.isLoading)
        assertEquals("DC closed", vm.uiState.value.errorMessage)
    }

    @Test
    fun `manual reload after filter change refetches with current filter and limit`() = runTest(testDispatcher) {
        coEvery { hub.recentAudit(action = null, limit = DEFAULT_AUDIT_LIMIT) } returns
            Result.success(AuditRowsResponse(rows = emptyList()))
        coEvery { hub.recentAudit(action = "sync", limit = DEFAULT_AUDIT_LIMIT) } returns
            Result.success(AuditRowsResponse(rows = listOf(AuditRow(at = 9L, action = "sync"))))

        val vm = HubAuditViewModel(hub)
        advanceUntilIdle()
        vm.setActionFilter("sync")
        advanceUntilIdle()
        vm.reload()
        advanceUntilIdle()

        // setActionFilter triggers 1 reload + manual reload() = 2 calls with "sync"
        coVerify(exactly = 2) { hub.recentAudit(action = "sync", limit = DEFAULT_AUDIT_LIMIT) }
    }

    // ─── Phase 14.3.3.b deep-link tests ─────────────────────────────────

    private fun stubReloadEmpty() {
        coEvery { hub.recentAudit(action = null, limit = DEFAULT_AUDIT_LIMIT) } returns
            Result.success(AuditRowsResponse(rows = emptyList()))
    }

    private fun fixtureDetail(id: String = "evt-1"): EventDetailResponse =
        EventDetailResponse(
            event = HubEvent(
                id = id,
                subtype = "payment",
                source = "alipay-bill",
                ingestedAt = 1700_000_000_000L,
                at = 1700_000_000_000L,
                actor = "person-self",
                amount = 38.0,
                currency = "CNY",
                title = "美团外卖",
            ),
        )

    @Test
    fun `openEventDetail fetches detail and sets activeEventDetail`() = runTest(testDispatcher) {
        stubReloadEmpty()
        coEvery { hub.eventDetail("evt-1") } returns Result.success(fixtureDetail("evt-1"))

        val vm = HubAuditViewModel(hub)
        advanceUntilIdle()
        vm.openEventDetail("evt-1")
        advanceUntilIdle()

        val s = vm.uiState.value
        assertEquals("evt-1", s.activeEventId)
        assertNotNull(s.activeEventDetail)
        assertEquals("evt-1", s.activeEventDetail!!.event.id)
        assertTrue(!s.isEventDetailLoading)
        assertNull(s.eventDetailError)
    }

    @Test
    fun `openEventDetail with blank id is no-op`() = runTest(testDispatcher) {
        stubReloadEmpty()

        val vm = HubAuditViewModel(hub)
        advanceUntilIdle()
        vm.openEventDetail("")
        advanceUntilIdle()

        assertNull(vm.uiState.value.activeEventId)
        coVerify(exactly = 0) { hub.eventDetail(any()) }
    }

    @Test
    fun `eventDetail failure surfaces error and keeps sheet open with eventId`() = runTest(testDispatcher) {
        stubReloadEmpty()
        coEvery { hub.eventDetail("evt-bad") } returns Result.failure(RuntimeException("vault destroyed"))

        val vm = HubAuditViewModel(hub)
        advanceUntilIdle()
        vm.openEventDetail("evt-bad")
        advanceUntilIdle()

        val s = vm.uiState.value
        assertEquals("evt-bad", s.activeEventId)
        assertNull(s.activeEventDetail)
        assertTrue(!s.isEventDetailLoading)
        assertEquals("vault destroyed", s.eventDetailError)
    }

    @Test
    fun `closeEventDetail clears all detail state`() = runTest(testDispatcher) {
        stubReloadEmpty()
        coEvery { hub.eventDetail("evt-1") } returns Result.success(fixtureDetail("evt-1"))

        val vm = HubAuditViewModel(hub)
        advanceUntilIdle()
        vm.openEventDetail("evt-1")
        advanceUntilIdle()
        vm.closeEventDetail()

        val s = vm.uiState.value
        assertNull(s.activeEventId)
        assertNull(s.activeEventDetail)
        assertTrue(!s.isEventDetailLoading)
        assertNull(s.eventDetailError)
    }

    @Test
    fun `stale response is discarded when user taps a newer eventId before old RPC returns`() = runTest(testDispatcher) {
        // Race scenario per design §7 T12: 2 quick taps, slow first RPC,
        // fast second RPC. After both resolve, state must reflect the 2nd.
        stubReloadEmpty()
        val slow = CompletableDeferred<Result<EventDetailResponse>>()
        coEvery { hub.eventDetail("evt-old") } coAnswers { slow.await() }
        coEvery { hub.eventDetail("evt-new") } returns Result.success(fixtureDetail("evt-new"))

        val vm = HubAuditViewModel(hub)
        advanceUntilIdle()

        vm.openEventDetail("evt-old")    // first tap — RPC pending
        advanceUntilIdle()
        vm.openEventDetail("evt-new")    // second tap — RPC resolves fast
        advanceUntilIdle()

        // Now resolve old RPC late
        slow.complete(Result.success(fixtureDetail("evt-old")))
        advanceUntilIdle()

        val s = vm.uiState.value
        // active id is the newer one
        assertEquals("evt-new", s.activeEventId)
        // detail is still evt-new (NOT overwritten by the late old response)
        assertEquals("evt-new", s.activeEventDetail!!.event.id)
    }
}
