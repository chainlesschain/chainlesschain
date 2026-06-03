package com.chainlesschain.android.feature.familyguard.data.repository

import com.chainlesschain.android.feature.familyguard.data.dao.GeofenceDao
import com.chainlesschain.android.feature.familyguard.data.entity.GeofenceEntity
import com.chainlesschain.android.feature.familyguard.domain.model.GeofenceKind
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.runTest
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * FAMILY-50 验收: GeofenceRepository upsert 校验（kind/radius/经纬度）+ getById/delete +
 * GeofenceKind 映射。Fake DAO（in-memory）。
 */
class GeofenceRepositoryImplTest {

    private class FakeGeofenceDao : GeofenceDao {
        val store = linkedMapOf<String, GeofenceEntity>()
        override fun observeActive(groupId: String): Flow<List<GeofenceEntity>> =
            flowOf(store.values.filter { it.familyGroupId == groupId && it.active })
        override suspend fun getById(id: String): GeofenceEntity? = store[id]
        override suspend fun upsert(entity: GeofenceEntity) {
            store[entity.id] = entity
        }
        override suspend fun deleteById(id: String): Int =
            if (store.remove(id) != null) 1 else 0
    }

    private fun geofence(
        id: String = "g1",
        kind: String = "home",
        radiusM: Int = 100,
        lat: Double = 31.23,
        lng: Double = 121.47,
    ) = GeofenceEntity(
        id = id,
        familyGroupId = "grp",
        name = "家",
        kind = kind,
        latitude = lat,
        longitude = lng,
        radiusM = radiusM,
        onEnterAction = "notify_parent",
        onExitAction = "silent",
        onLateAction = "notify_parent",
    )

    @Test
    fun `GeofenceKind storage round-trip + unknown null`() {
        for (k in GeofenceKind.entries) {
            assertEquals(k, GeofenceKind.fromStorage(k.storageValue))
        }
        assertEquals("home", GeofenceKind.HOME.storageValue)
        assertNull(GeofenceKind.fromStorage("airport"))
    }

    @Test
    fun `upsert valid geofence stores it`() = runTest {
        val dao = FakeGeofenceDao()
        val repo = GeofenceRepositoryImpl(dao)
        val res = repo.upsert(geofence(kind = "school"))
        assertTrue(res.isSuccess)
        assertEquals("school", repo.getById("g1")?.kind)
    }

    @Test
    fun `upsert unknown kind fails and does not store`() = runTest {
        val dao = FakeGeofenceDao()
        val repo = GeofenceRepositoryImpl(dao)
        val res = repo.upsert(geofence(kind = "airport"))
        assertTrue(res.isFailure)
        assertNull(repo.getById("g1"))
    }

    @Test
    fun `upsert non-positive radius fails`() = runTest {
        val repo = GeofenceRepositoryImpl(FakeGeofenceDao())
        assertTrue(repo.upsert(geofence(radiusM = 0)).isFailure)
        assertTrue(repo.upsert(geofence(radiusM = -5)).isFailure)
    }

    @Test
    fun `upsert out-of-range coordinates fails`() = runTest {
        val repo = GeofenceRepositoryImpl(FakeGeofenceDao())
        assertTrue(repo.upsert(geofence(lat = 91.0)).isFailure)
        assertTrue(repo.upsert(geofence(lng = 181.0)).isFailure)
        assertTrue(repo.upsert(geofence(lat = -91.0)).isFailure)
    }

    @Test
    fun `delete returns true when present false when absent`() = runTest {
        val dao = FakeGeofenceDao()
        val repo = GeofenceRepositoryImpl(dao)
        repo.upsert(geofence())
        assertTrue(repo.delete("g1"))
        assertFalse(repo.delete("g1")) // 已删
        assertFalse(repo.delete("nope"))
    }
}
