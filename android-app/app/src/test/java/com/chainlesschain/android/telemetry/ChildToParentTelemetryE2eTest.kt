package com.chainlesschain.android.telemetry

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.chainlesschain.android.feature.familyguard.data.FamilyGuardDatabase
import com.chainlesschain.android.feature.familyguard.data.repository.ChildEventRepositoryImpl
import com.chainlesschain.android.feature.familyguard.data.telemetry.TelemetryEventConverter
import com.chainlesschain.android.feature.familyguard.domain.model.permissions.TelemetryLevel
import com.chainlesschain.android.feature.familyguard.domain.telemetry.ForegroundAppPayload
import com.chainlesschain.android.feature.familyguard.domain.telemetry.TelemetryEvent
import com.chainlesschain.android.feature.familyguard.domain.telemetry.TelemetrySourceType
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/**
 * 孩子端 → 家长端 telemetry **单进程 loopback E2E** (FAMILY-26 下行 + FAMILY-67 看板)。
 *
 * 在一个进程里跑通整条数据链路（仅缺真 libp2p 传输那一跳——那跳由 FAMILY-26 真机计划覆盖）：
 *
 *   [child] TelemetryEvent → SyncManagerTelemetryOutbox.enqueue → 捕获 SyncItem.data (wire 字节)
 *      ──(wire)──►
 *   [parent] TelemetrySyncApplierImpl.saveTelemetryFromSync → TelemetryIngest.decode
 *      → ChildEventRepositoryImpl.saveTelemetryEvent → **真 Room child_event 镜像表 (in-memory)**
 *      → observeRecentAnyChild → TelemetryEventConverter.fromEntity
 *      → ChildActivityDashboard.summarize → **家长可见摘要**
 *
 * 断言：家长端看到的每 app 用量 / 总屏幕时长 / 孩子 DID，与孩子端实际产生的一致。
 * 证明 encode→wire→decode→真持久→读回→聚合 全程保真。真双机 E2E 见
 * docs/design/FAMILY-67_ChildActivity_Dashboard_E2E_Plan.md。
 */
@RunWith(AndroidJUnit4::class)
@Config(sdk = [33])
class ChildToParentTelemetryE2eTest {

    private lateinit var db: FamilyGuardDatabase
    private lateinit var parentRepo: ChildEventRepositoryImpl
    private lateinit var applier: TelemetrySyncApplierImpl
    private val kid = "did:chain:kid"

    @Before
    fun setUp() {
        db = Room.inMemoryDatabaseBuilder(
            ApplicationProvider.getApplicationContext(),
            FamilyGuardDatabase::class.java,
        ).allowMainThreadQueries().build()
        parentRepo = ChildEventRepositoryImpl(db.childEventDao())
        applier = TelemetrySyncApplierImpl(parentRepo)
    }

    @After
    fun tearDown() = db.close()

    /** 孩子端前台 app 段 → TelemetryEvent。 */
    private fun fgEvent(pkg: String, durationMs: Long, ts: Long) = TelemetryEvent(
        childDid = kid,
        source = TelemetrySourceType.FOREGROUND_APP,
        kind = "run",
        payload = ForegroundAppPayload.encode(pkg, durationMs),
        timestampMs = ts,
        durationMs = durationMs,
        level = TelemetryLevel.L1,
    )

    /**
     * 孩子端发出的 wire (resourceId, data)。data 直接走 [TelemetrySyncData] 序列化——与
     * SyncManagerTelemetryOutbox.enqueue 内部 `json.encodeToString(event.toSyncData(...))` 同字节；
     * outbox↔ingest 的真实编码往返保真已由 TelemetryIngestTest 证实。此处不用 mockk(避免
     * mockk + Robolectric 类加载器冲突致 runner 实例化失败)。
     */
    private fun childEncode(events: List<TelemetryEvent>): List<Pair<String, String>> =
        events.mapIndexed { i, e ->
            val data = TelemetrySyncData(
                childDid = e.childDid,
                source = e.source.storageValue,
                kind = e.kind,
                payload = e.payload,
                timestampMs = e.timestampMs,
                durationMs = e.durationMs,
                level = e.level.name,
                rowId = (i + 1).toLong(),
                guardianDids = listOf("did:chain:mom"),
            )
            val resourceId = "telemetry|${e.childDid}|${e.source.storageValue}|${e.kind}|${e.timestampMs}"
            resourceId to Json.encodeToString(data)
        }

    @Test
    fun `child foreground usage shows up in parent dashboard summary`() = runBlocking {
        val now = 1_000_000_000_000L
        // 孩子端：今天用了王者 90s（两段）+ B 站 45s。
        val events = listOf(
            fgEvent("com.tencent.tmgp.sgame", 60_000L, now + 1_000),
            fgEvent("com.tencent.tmgp.sgame", 30_000L, now + 2_000),
            fgEvent("tv.danmaku.bili", 45_000L, now + 3_000),
        )

        // 孩子端编码 → wire；家长端逐条经 applier 解码 + 落真 Room child_event。
        childEncode(events).forEach { (resourceId, data) -> applier.saveTelemetryFromSync(resourceId, data) }

        // 家长端读回镜像表 + 聚合（同 ChildActivityDashboardViewModel 逻辑）。
        val stored = parentRepo.observeRecentAnyChild(limit = 1000).first()
        assertEquals(3, stored.size)
        val decoded = stored.mapNotNull { TelemetryEventConverter.fromEntity(it) }
        val summary = ChildActivityDashboard.summarize(
            childDid = kid,
            events = decoded,
            windowStartMs = now,
            windowEndMs = now + 10_000,
        )

        // 家长看到的 == 孩子实际产生的。
        assertEquals(kid, summary.childDid)
        assertEquals(135_000L, summary.totalForegroundMs)
        assertEquals(2, summary.appUsage.size)
        assertEquals("com.tencent.tmgp.sgame", summary.topApps[0].packageName)
        assertEquals(90_000L, summary.topApps[0].totalMs)
        assertEquals(2, summary.topApps[0].sessions)
        assertEquals("tv.danmaku.bili", summary.topApps[1].packageName)
        assertEquals(45_000L, summary.topApps[1].totalMs)
        assertEquals(3, summary.eventsByLevel[TelemetryLevel.L1])
    }

    @Test
    fun `re-delivered wire item is decodable (idempotency relies on sync-layer dedup)`() = runBlocking<Unit> {
        val now = 2_000_000_000_000L
        val (resourceId, data) = childEncode(listOf(fgEvent("com.x", 10_000L, now + 1_000))).single()

        // 同一 wire item 投递两次（模拟重放）：两次都成功解码落库（行级内容去重是 follow-up，
        // 真去重靠 SyncManager resourceId + 冲突检测，见 applier 注释）。
        applier.saveTelemetryFromSync(resourceId, data)
        applier.saveTelemetryFromSync(resourceId, data)

        val stored = parentRepo.observeRecentAnyChild(limit = 1000).first()
        assertTrue(stored.isNotEmpty())
        assertNotNull(TelemetryEventConverter.fromEntity(stored.first()))
    }
}
