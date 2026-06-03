package com.chainlesschain.android.feature.familyguard.data.repository

import com.chainlesschain.android.feature.familyguard.data.dao.LocationPointDao
import com.chainlesschain.android.feature.familyguard.data.entity.LocationPointEntity
import com.chainlesschain.android.feature.familyguard.domain.repository.LocationPointRepository
import javax.inject.Inject
import javax.inject.Singleton

/** FAMILY-50 实装。薄封装 LocationPointDao（采集/调频/省电在 FAMILY-51/56）。 */
@Singleton
class LocationPointRepositoryImpl @Inject constructor(
    private val locationPointDao: LocationPointDao,
) : LocationPointRepository {

    override suspend fun record(points: List<LocationPointEntity>): List<Long> {
        if (points.isEmpty()) return emptyList()
        return locationPointDao.insertAll(points)
    }

    override suspend fun querySince(childDid: String, sinceMs: Long): List<LocationPointEntity> =
        locationPointDao.querySince(childDid, sinceMs)

    override suspend fun deleteOlderThan(cutoffMs: Long): Int =
        locationPointDao.deleteOlderThan(cutoffMs)
}
