package com.chainlesschain.android.feature.familyguard.data.anomaly

import com.chainlesschain.android.feature.familyguard.data.dao.ChildEventDao
import com.chainlesschain.android.feature.familyguard.data.entity.AnomalyEntity
import com.chainlesschain.android.feature.familyguard.data.entity.ChildEventEntity
import com.chainlesschain.android.feature.familyguard.domain.anomaly.AnomalyConfig
import com.chainlesschain.android.feature.familyguard.domain.anomaly.AnomalyDetector
import com.chainlesschain.android.feature.familyguard.domain.anomaly.DetectedAnomaly
import com.chainlesschain.android.feature.familyguard.domain.anomaly.GuardianAnomalyNotifier
import com.chainlesschain.android.feature.familyguard.domain.repository.AnomalyRepository
import com.chainlesschain.android.feature.familyguard.domain.telemetry.ChildIdentityProvider
import com.chainlesschain.android.feature.familyguard.domain.telemetry.ForegroundAppPayload
import java.time.LocalDateTime
import java.time.ZoneId
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.runTest
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * FAMILY-27 验收: [AnomalyScanTimer] 单次扫描管线 —
 * 非孩子端早返 / 检出后落库 / **仅新落库** (rowId>0) 推送一次 / 去重不重复推送。
 */
class AnomalyScanTimerTest {

    private val kid = "did:chain:kid"
    private val zone = ZoneId.of("UTC")
    private val pkg = "com.app.x"

    // now = 06-04 00:00 UTC; 窗口事件落在 06-03 02:00 (凌晨) → 触发 LATE_NIGHT_SCREEN。
    private val now = LocalDateTime.of(2026, 6, 4, 0, 0).atZone(zone).toInstant().toEpochMilli()
    private val nightEventMs =
        LocalDateTime.of(2026, 6, 3, 2, 0).atZone(zone).toInstant().toEpochMilli()

    // pkg 列入 knownApps 抑制 UNKNOWN_APP_FIRST_SEEN, 使凌晨事件只产 1 条异常 (断言干净)。
    private val config = AnomalyConfig(knownApps = setOf(pkg))

    private fun nightEvent() = ChildEventEntity(
        childDid = kid,
        source = "foreground_app",
        kind = "run",
        payload = ForegroundAppPayload.encode(pkg, 10 * 60_000L),
        timestamp = nightEventMs,
        durationMs = 10 * 60_000L,
        level = "L1",
    )

    private fun timer(
        identity: ChildIdentityProvider,
        dao: ChildEventDao,
        repo: AnomalyRepository,
        notifier: GuardianAnomalyNotifier,
    ) = AnomalyScanTimer(identity, dao, AnomalyDetector(zone), repo, notifier, config)

    @Test
    fun `non-child early returns without querying`() = runTest {
        val dao = FakeDao(window = listOf(nightEvent()))
        val repo = FakeRepo(recordResult = 1L)
        val notifier = FakeNotifier()
        timer(FakeIdentity(null), dao, repo, notifier).scanOnce(now)

        assertEquals(0, dao.querySinceCalls)
        assertTrue(repo.recorded.isEmpty())
        assertTrue(notifier.notified.isEmpty())
    }

    @Test
    fun `detected anomaly is recorded and notified once`() = runTest {
        val dao = FakeDao(window = listOf(nightEvent()))
        val repo = FakeRepo(recordResult = 1L) // 新落库
        val notifier = FakeNotifier()
        timer(FakeIdentity(kid), dao, repo, notifier).scanOnce(now)

        assertEquals(1, repo.recorded.size)
        assertEquals(1, notifier.notified.size)
        assertEquals(repo.recorded.first().dedupKey, notifier.notified.first().dedupKey)
    }

    @Test
    fun `dedup hit is recorded-attempt but not notified`() = runTest {
        val dao = FakeDao(window = listOf(nightEvent()))
        val repo = FakeRepo(recordResult = -1L) // OnConflict IGNORE → 已存在
        val notifier = FakeNotifier()
        timer(FakeIdentity(kid), dao, repo, notifier).scanOnce(now)

        assertEquals(1, repo.recorded.size) // 仍尝试 record
        assertTrue(notifier.notified.isEmpty()) // 但不重复推送
    }

    // ─── fakes ───

    private class FakeIdentity(private val did: String?) : ChildIdentityProvider {
        override suspend fun childDidOrNull(): String? = did
    }

    private class FakeNotifier : GuardianAnomalyNotifier {
        val notified = mutableListOf<DetectedAnomaly>()
        override suspend fun notifyGuardians(anomaly: DetectedAnomaly) {
            notified += anomaly
        }
    }

    private class FakeRepo(private val recordResult: Long) : AnomalyRepository {
        val recorded = mutableListOf<DetectedAnomaly>()
        override suspend fun record(anomaly: DetectedAnomaly): Long {
            recorded += anomaly
            return recordResult
        }
        override fun observeRecent(childDid: String, limit: Int): Flow<List<AnomalyEntity>> =
            flowOf(emptyList())
        override suspend fun acknowledge(id: Long): Boolean = false
        override suspend fun deleteOlderThan(cutoffMs: Long): Int = 0
    }

    private class FakeDao(
        private val window: List<ChildEventEntity> = emptyList(),
        private val prior: List<ChildEventEntity> = emptyList(),
    ) : ChildEventDao {
        var querySinceCalls = 0

        override suspend fun querySince(childDid: String, sinceMs: Long): List<ChildEventEntity> {
            querySinceCalls++
            return window
        }

        override suspend fun querySourceRange(
            childDid: String,
            source: String,
            sinceMs: Long,
            untilMs: Long,
        ): List<ChildEventEntity> = prior

        override suspend fun insert(entity: ChildEventEntity): Long = throw NotImplementedError()
        override suspend fun insertAll(entities: List<ChildEventEntity>): List<Long> =
            throw NotImplementedError()
        override fun observeRecent(childDid: String, limit: Int): Flow<List<ChildEventEntity>> =
            flowOf(emptyList())
        override fun observeRecentAnyChild(limit: Int): Flow<List<ChildEventEntity>> =
            flowOf(emptyList())
        override suspend fun deleteOlderThan(cutoffMs: Long): Int = 0
        override suspend fun deleteOlderThanByLevel(level: String, cutoffMs: Long): Int = 0
        override suspend fun countForChild(childDid: String): Int = 0
    }
}
