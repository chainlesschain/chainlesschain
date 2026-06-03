package com.chainlesschain.android.pdh.travel

import android.content.Context
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import timber.log.Timber
import java.io.File
import javax.inject.Inject
import javax.inject.Singleton

/**
 * §2.5 v0.2 — 12306 snapshot writer.
 *
 * v0.1 path was cookie-scrape-only (`syncTravel` writes `{vendor, cookie, fetchedAt}`,
 * JS adapter does nothing useful — just records the cookie was captured).
 *
 * v0.2 path: this collector takes the cookie, fetches completed + pending
 * orders from kyfw.12306.cn directly (no signing required), parses into
 * structured `TicketRecord`s, and writes a proper snapshot JSON the JS adapter
 * `travel-12306` can consume in `_syncViaSnapshot` mode.
 *
 * Snapshot schema (mirrors `packages/personal-data-hub/lib/adapters/travel-12306`
 * SNAPSHOT_SCHEMA_VERSION = 1 — added in v0.2 alongside this collector):
 *
 *   {
 *     "schemaVersion": 1,
 *     "snapshottedAt": <epoch-ms>,
 *     "vendor": "12306",
 *     "events": [
 *       { "kind": "ticket", "id": "ticket-<sequenceNo>:<n>", "capturedAt": <ms>,
 *         "orderSequenceNo": "...", "ticketNumber": "...",
 *         "passengerName": "张三", "trainNumber": "G123",
 *         "fromStation": "上海虹桥", "toStation": "北京南",
 *         "departureMs": <ms>, "arrivalMs": <ms>,
 *         "seatTypeName": "二等座", "coachNo": "05", "seatNo": "12A",
 *         "ticketPrice": 553.5, "orderDateMs": <ms>, "orderTotalPrice": ...,
 *         "isCompleted": true }
 *     ]
 *   }
 *
 * Failure modes:
 *   - cookie 失效 → checkLogin returns false → SnapshotResult.NoCredentials
 *     (UI 引导重 login)
 *   - HTTP / parse fail on queryMyOrder → 单端点失败不 tank 另一端点；都失败 →
 *     events 仍可空，Ok but everythingEmpty=true
 *   - staging dir 写失败 → SnapshotResult.Failed
 */
@Singleton
class Kyfw12306LocalCollector @Inject constructor(
    @ApplicationContext private val context: Context,
    private val apiClient: Kyfw12306ApiClient,
    private val credentialsStore: TravelCredentialsStore,
) {

    sealed class SnapshotResult {
        data class Ok(
            val snapshotPath: String,
            val completedCount: Int,
            val pendingCount: Int,
            val totalEvents: Int,
            val everythingEmpty: Boolean,
            val snapshottedAt: Long,
            val lastErrorCode: Int = 0,
            val lastErrorMessage: String? = null,
        ) : SnapshotResult()

        object NoCredentials : SnapshotResult()

        data class Failed(val reason: String) : SnapshotResult()
    }

    suspend fun snapshot(): SnapshotResult = withContext(Dispatchers.IO) {
        val vendor = TravelVendor.KYFW_12306.key
        if (!credentialsStore.hasCredentials(vendor)) {
            return@withContext SnapshotResult.NoCredentials
        }
        val cookie = credentialsStore.getCookie(vendor)
            ?: return@withContext SnapshotResult.NoCredentials

        // checkLogin probe — distinguishes "cookie present in store but session
        // expired on server" (NoCredentials) from "session OK but no orders"
        // (Ok with empty events). 12306 expires sessions after ~30min idle.
        val sessionAlive = try {
            apiClient.checkLogin(cookie)
        } catch (t: Throwable) {
            Timber.w(t, "Kyfw12306LocalCollector: checkLogin threw")
            false
        }
        if (!sessionAlive) {
            return@withContext SnapshotResult.NoCredentials
        }

        val completed = safelyFetch("queryMyOrder") {
            apiClient.fetchCompletedOrders(cookie)
        }
        val pending = safelyFetch("queryMyOrderNoComplete") {
            apiClient.fetchPendingOrders(cookie)
        }

        val snapshottedAt = System.currentTimeMillis()
        val events = JSONArray()
        // Number tickets within an order to keep originalId stable per ticket
        // (some orders have N passengers → N tickets sharing sequence_no).
        val seenSequence = mutableMapOf<String, Int>()
        for (t in (completed + pending)) {
            val idx = seenSequence.merge(t.orderSequenceNo, 0) { v, _ -> v + 1 } ?: 0
            events.put(
                JSONObject()
                    .put("kind", "ticket")
                    .put("id", "ticket-${t.orderSequenceNo}:$idx")
                    .put("capturedAt", t.departureMs.takeIf { it > 0 } ?: snapshottedAt)
                    .put("orderSequenceNo", t.orderSequenceNo)
                    .putOpt("ticketNumber", t.ticketNumber)
                    .put("passengerName", t.passengerName)
                    .putOpt("passengerIdLast6", t.passengerIdLast6)
                    .put("trainNumber", t.trainNumber)
                    .put("fromStation", t.fromStation)
                    .put("toStation", t.toStation)
                    .put("departureMs", t.departureMs)
                    .put("arrivalMs", t.arrivalMs)
                    .putOpt("seatTypeName", t.seatTypeName)
                    .putOpt("coachNo", t.coachNo)
                    .putOpt("seatNo", t.seatNo)
                    .put("ticketPrice", t.ticketPrice)
                    .put("orderDateMs", t.orderDateMs)
                    .put("orderTotalPrice", t.orderTotalPrice)
                    .put("isCompleted", t.isCompleted),
            )
        }
        val total = events.length()

        val root = JSONObject()
            .put("schemaVersion", SNAPSHOT_SCHEMA_VERSION)
            .put("snapshottedAt", snapshottedAt)
            .put("vendor", "12306")
            .put("events", events)

        val stagingDir = File(context.filesDir, ".chainlesschain/staging")
        if (!stagingDir.exists() && !stagingDir.mkdirs()) {
            return@withContext SnapshotResult.Failed(
                "failed to create staging dir at ${stagingDir.absolutePath}",
            )
        }
        val snapshotFile = File(stagingDir, "travel-12306.json")
        try {
            snapshotFile.writeText(root.toString(), Charsets.UTF_8)
        } catch (t: Throwable) {
            Timber.e(t, "Kyfw12306LocalCollector: snapshot write failed")
            return@withContext SnapshotResult.Failed("write failed: ${t.message}")
        }

        credentialsStore.recordSync(vendor, snapshottedAt, total)

        SnapshotResult.Ok(
            snapshotPath = snapshotFile.absolutePath,
            completedCount = completed.size,
            pendingCount = pending.size,
            totalEvents = total,
            everythingEmpty = total == 0,
            snapshottedAt = snapshottedAt,
            lastErrorCode = apiClient.lastErrorCode,
            lastErrorMessage = apiClient.lastErrorMessage,
        )
    }

    private inline fun <T> safelyFetch(name: String, block: () -> List<T>): List<T> = try {
        block()
    } catch (t: Throwable) {
        Timber.w(t, "Kyfw12306LocalCollector: %s threw", name)
        emptyList()
    }

    companion object {
        /** Must equal SNAPSHOT_SCHEMA_VERSION in travel-12306/index.js. */
        const val SNAPSHOT_SCHEMA_VERSION = 1
    }
}
