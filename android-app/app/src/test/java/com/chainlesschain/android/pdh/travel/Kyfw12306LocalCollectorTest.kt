package com.chainlesschain.android.pdh.travel

import android.content.Context
import io.mockk.coEvery
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.test.runTest
import org.json.JSONObject
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class Kyfw12306LocalCollectorTest {

    @get:Rule
    val tmp = TemporaryFolder()

    private lateinit var context: Context
    private lateinit var apiClient: Kyfw12306ApiClient
    private lateinit var credentials: TravelCredentialsStore
    private lateinit var filesDir: File

    @Before
    fun setUp() {
        filesDir = tmp.newFolder("files")
        context = mockk(relaxed = true)
        every { context.filesDir } returns filesDir
        apiClient = mockk(relaxed = true)
        credentials = mockk(relaxed = true)
    }

    private val vendor = TravelVendor.KYFW_12306.key

    private fun newCollector() = Kyfw12306LocalCollector(context, apiClient, credentials)

    @Test
    fun `snapshot NoCredentials when no cookie stored`() = runTest {
        every { credentials.hasCredentials(vendor) } returns false
        val res = newCollector().snapshot()
        assertTrue(res is Kyfw12306LocalCollector.SnapshotResult.NoCredentials)
    }

    @Test
    fun `snapshot NoCredentials when checkLogin returns false (session expired)`() = runTest {
        every { credentials.hasCredentials(vendor) } returns true
        every { credentials.getCookie(vendor) } returns "tk=ABC"
        coEvery { apiClient.checkLogin(any()) } returns false
        val res = newCollector().snapshot()
        assertTrue(res is Kyfw12306LocalCollector.SnapshotResult.NoCredentials)
    }

    @Test
    fun `snapshot Ok with empty events when both fetches return empty`() = runTest {
        every { credentials.hasCredentials(vendor) } returns true
        every { credentials.getCookie(vendor) } returns "tk=ABC"
        coEvery { apiClient.checkLogin(any()) } returns true
        coEvery { apiClient.fetchCompletedOrders(any(), any(), any(), any()) } returns emptyList()
        coEvery { apiClient.fetchPendingOrders(any()) } returns emptyList()

        val res = newCollector().snapshot()
        assertTrue(res is Kyfw12306LocalCollector.SnapshotResult.Ok)
        res as Kyfw12306LocalCollector.SnapshotResult.Ok
        assertEquals(0, res.completedCount)
        assertEquals(0, res.pendingCount)
        assertEquals(0, res.totalEvents)
        assertTrue(res.everythingEmpty)
        // Snapshot file was written, schema valid
        val written = File(res.snapshotPath).readText()
        val obj = JSONObject(written)
        assertEquals(1, obj.getInt("schemaVersion"))
        assertEquals("12306", obj.getString("vendor"))
        assertEquals(0, obj.getJSONArray("events").length())
    }

    @Test
    fun `snapshot Ok merges completed + pending tickets into events with stable ids`() = runTest {
        every { credentials.hasCredentials(vendor) } returns true
        every { credentials.getCookie(vendor) } returns "tk=ABC"
        coEvery { apiClient.checkLogin(any()) } returns true
        coEvery { apiClient.fetchCompletedOrders(any(), any(), any(), any()) } returns listOf(
            mkTicket("EE001", "T-1", "张三", trainNumber = "G123", isCompleted = true),
            mkTicket("EE001", "T-2", "李四", trainNumber = "G123", isCompleted = true),
        )
        coEvery { apiClient.fetchPendingOrders(any()) } returns listOf(
            mkTicket("PENDING-1", "T-P1", "Wang", trainNumber = "D456", isCompleted = false),
        )

        val res = newCollector().snapshot() as Kyfw12306LocalCollector.SnapshotResult.Ok
        assertEquals(2, res.completedCount)
        assertEquals(1, res.pendingCount)
        assertEquals(3, res.totalEvents)
        assertEquals(false, res.everythingEmpty)

        val obj = JSONObject(File(res.snapshotPath).readText())
        val events = obj.getJSONArray("events")
        assertEquals(3, events.length())
        // Same order sequence_no → distinct suffixed ids :0, :1
        val ids = (0 until events.length()).map { events.getJSONObject(it).getString("id") }
        assertTrue(ids.contains("ticket-EE001:0"))
        assertTrue(ids.contains("ticket-EE001:1"))
        assertTrue(ids.contains("ticket-PENDING-1:0"))
        // First completed ticket → assert payload fields
        val first = events.getJSONObject(0)
        assertEquals("ticket", first.getString("kind"))
        assertEquals("张三", first.getString("passengerName"))
        assertEquals("G123", first.getString("trainNumber"))
        assertEquals(true, first.getBoolean("isCompleted"))
    }

    @Test
    fun `snapshot uses departureMs for capturedAt when non-zero`() = runTest {
        every { credentials.hasCredentials(vendor) } returns true
        every { credentials.getCookie(vendor) } returns "tk=ABC"
        coEvery { apiClient.checkLogin(any()) } returns true
        coEvery { apiClient.fetchCompletedOrders(any(), any(), any(), any()) } returns listOf(
            mkTicket("E1", "T1", "X", trainNumber = "G1", departureMs = 1_700_000_000_000L),
        )
        coEvery { apiClient.fetchPendingOrders(any()) } returns emptyList()
        val res = newCollector().snapshot() as Kyfw12306LocalCollector.SnapshotResult.Ok
        val obj = JSONObject(File(res.snapshotPath).readText())
        val ev = obj.getJSONArray("events").getJSONObject(0)
        assertEquals(1_700_000_000_000L, ev.getLong("capturedAt"))
    }

    @Test
    fun `snapshot calls recordSync with total event count`() = runTest {
        every { credentials.hasCredentials(vendor) } returns true
        every { credentials.getCookie(vendor) } returns "tk=ABC"
        coEvery { apiClient.checkLogin(any()) } returns true
        coEvery { apiClient.fetchCompletedOrders(any(), any(), any(), any()) } returns listOf(
            mkTicket("E1", "T1", "X"),
        )
        coEvery { apiClient.fetchPendingOrders(any()) } returns emptyList()
        var captured: Pair<Long, Int>? = null
        every { credentials.recordSync(eq(vendor), any(), any()) } answers {
            captured = secondArg<Long>() to thirdArg<Int>()
        }
        newCollector().snapshot()
        assertNotNull(captured)
        assertEquals(1, captured!!.second)
    }

    private fun mkTicket(
        sequenceNo: String,
        ticketNumber: String,
        passenger: String,
        trainNumber: String = "G123",
        departureMs: Long = 0L,
        isCompleted: Boolean = true,
    ) = Kyfw12306ApiClient.TicketRecord(
        orderSequenceNo = sequenceNo,
        ticketNumber = ticketNumber,
        passengerName = passenger,
        passengerIdLast6 = null,
        trainNumber = trainNumber,
        fromStation = "A",
        toStation = "B",
        departureMs = departureMs,
        arrivalMs = 0L,
        seatTypeName = "二等座",
        coachNo = "05",
        seatNo = "12A",
        ticketPrice = 553.5,
        orderDateMs = 0L,
        orderTotalPrice = 553.5,
        isCompleted = isCompleted,
    )
}
