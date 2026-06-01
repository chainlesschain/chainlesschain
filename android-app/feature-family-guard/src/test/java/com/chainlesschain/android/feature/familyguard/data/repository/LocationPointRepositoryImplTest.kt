package com.chainlesschain.android.feature.familyguard.data.repository

import com.chainlesschain.android.feature.familyguard.data.dao.LocationPointDao
import com.chainlesschain.android.feature.familyguard.data.entity.LocationPointEntity
import kotlinx.coroutines.test.runTest
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * FAMILY-50 验收: LocationPointRepository record / querySince / deleteOlderThan + 空守卫。
 */
class LocationPointRepositoryImplTest {

    private class FakeLocationDao : LocationPointDao {
        val rows = mutableListOf<LocationPointEntity>()
        var insertCalls = 0
        override suspend fun querySince(childDid: String, sinceMs: Long): List<LocationPointEntity> =
            rows.filter { it.childDid == childDid && it.timestamp >= sinceMs }
                .sortedByDescending { it.timestamp }
        override suspend fun insertAll(points: List<LocationPointEntity>): List<Long> {
            insertCalls++
            rows.addAll(points)
            return points.indices.map { (rows.size - points.size + it + 1).toLong() }
        }
        override suspend fun deleteOlderThan(cutoffMs: Long): Int {
            val before = rows.size
            rows.removeAll { it.timestamp < cutoffMs }
            return before - rows.size
        }
    }

    private fun point(childDid: String = "kid", ts: Long, src: String = "fused") =
        LocationPointEntity(
            childDid = childDid,
            deviceId = "dev",
            latitude = 31.0,
            longitude = 121.0,
            source = src,
            timestamp = ts,
        )

    @Test
    fun `record empty list is a no-op (no DAO call)`() = runTest {
        val dao = FakeLocationDao()
        val repo = LocationPointRepositoryImpl(dao)
        assertEquals(emptyList(), repo.record(emptyList()))
        assertEquals(0, dao.insertCalls)
    }

    @Test
    fun `record inserts and querySince filters by child + time`() = runTest {
        val dao = FakeLocationDao()
        val repo = LocationPointRepositoryImpl(dao)
        repo.record(listOf(point(ts = 100), point(ts = 300), point(childDid = "other", ts = 400)))
        val kid = repo.querySince("kid", sinceMs = 150)
        assertEquals(1, kid.size) // 只有 ts=300 的 kid 点
        assertEquals(300, kid[0].timestamp)
    }

    @Test
    fun `deleteOlderThan prunes by cutoff`() = runTest {
        val dao = FakeLocationDao()
        val repo = LocationPointRepositoryImpl(dao)
        repo.record(listOf(point(ts = 100), point(ts = 200), point(ts = 300)))
        val deleted = repo.deleteOlderThan(250)
        assertEquals(2, deleted)
        assertTrue(repo.querySince("kid", 0).all { it.timestamp >= 250 })
    }
}
