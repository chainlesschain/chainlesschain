package com.chainlesschain.android.feature.familyguard.data.repository

import com.chainlesschain.android.feature.familyguard.data.dao.GeofenceDao
import com.chainlesschain.android.feature.familyguard.data.entity.GeofenceEntity
import com.chainlesschain.android.feature.familyguard.domain.model.GeofenceKind
import com.chainlesschain.android.feature.familyguard.domain.repository.GeofenceRepository
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.Flow

/**
 * FAMILY-50 实装。upsert 前校验 kind ∈ [GeofenceKind] + radius>0 + 经纬度范围，
 * 非法 fail-fast 不写库（防 UI/对端发来脏数据进围栏判定）。
 */
@Singleton
class GeofenceRepositoryImpl @Inject constructor(
    private val geofenceDao: GeofenceDao,
) : GeofenceRepository {

    override fun observeActive(groupId: String): Flow<List<GeofenceEntity>> =
        geofenceDao.observeActive(groupId)

    override suspend fun getById(id: String): GeofenceEntity? = geofenceDao.getById(id)

    override suspend fun upsert(geofence: GeofenceEntity): Result<Unit> {
        if (GeofenceKind.fromStorage(geofence.kind) == null) {
            return Result.failure(IllegalArgumentException("未知围栏 kind: ${geofence.kind}"))
        }
        if (geofence.radiusM <= 0) {
            return Result.failure(IllegalArgumentException("radius_m 必须 > 0: ${geofence.radiusM}"))
        }
        if (geofence.latitude !in -90.0..90.0 || geofence.longitude !in -180.0..180.0) {
            return Result.failure(
                IllegalArgumentException("经纬度越界: (${geofence.latitude}, ${geofence.longitude})"),
            )
        }
        return runCatching { geofenceDao.upsert(geofence) }
    }

    override suspend fun delete(id: String): Boolean = geofenceDao.deleteById(id) > 0
}
