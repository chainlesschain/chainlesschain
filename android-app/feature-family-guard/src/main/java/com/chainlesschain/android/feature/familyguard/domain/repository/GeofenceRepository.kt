package com.chainlesschain.android.feature.familyguard.domain.repository

import com.chainlesschain.android.feature.familyguard.data.entity.GeofenceEntity
import kotlinx.coroutines.flow.Flow

/**
 * 电子围栏仓库 (FAMILY-50，主文档 §3.8)。
 *
 * 围栏定义按 family_group 共享；[upsert] 校验 kind ∈ GeofenceKind + radius/经纬度合法。
 * 边界注册 / on_enter|exit|dwell 触发在 FAMILY-52；动作引擎在 FAMILY-54；UI CRUD 在 FAMILY-53。
 */
interface GeofenceRepository {

    /** 观察某家庭组的 active 围栏。 */
    fun observeActive(groupId: String): Flow<List<GeofenceEntity>>

    suspend fun getById(id: String): GeofenceEntity?

    /** 创建 / 更新围栏；kind / radius / 经纬度非法时返 failure（不写库）。 */
    suspend fun upsert(geofence: GeofenceEntity): Result<Unit>

    /** @return true 表示删除了一行。 */
    suspend fun delete(id: String): Boolean
}
