package com.chainlesschain.android.feature.familyguard.data.dao

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.chainlesschain.android.feature.familyguard.data.FamilyGuardDatabase
import com.chainlesschain.android.feature.familyguard.data.entity.RewardCatalogEntity
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import kotlin.test.assertEquals
import kotlin.test.assertNull

/** M9 reward_catalog DAO (主文档 §3.9)。Room in-memory 真 SQL; 验 CRUD/软删/排序。 */
@RunWith(AndroidJUnit4::class)
@Config(sdk = [33])
class RewardCatalogDaoTest {

    private lateinit var db: FamilyGuardDatabase
    private lateinit var dao: RewardCatalogDao
    private val group = "local-family"

    @Before
    fun setUp() {
        db = Room.inMemoryDatabaseBuilder(
            ApplicationProvider.getApplicationContext(),
            FamilyGuardDatabase::class.java,
        )
            .allowMainThreadQueries()
            .build()
        dao = db.rewardCatalogDao()
    }

    @After
    fun tearDown() = db.close()

    private fun item(
        id: String,
        cost: Int = 50,
        active: Boolean = true,
        groupId: String = group,
        createdAt: Long = 1_000L,
    ) = RewardCatalogEntity(
        id = id,
        familyGroupId = groupId,
        name = "奖励 $id",
        description = "",
        cost = cost,
        deliverableKind = "SCREEN_TIME_MIN",
        deliverableValue = 30,
        targetApps = "",
        maxPerDay = 1,
        active = active,
        createdBy = "did:chain:parent",
        createdAt = createdAt,
    )

    @Test
    fun `upsert round-trips and observe orders by cost`() = runBlocking {
        dao.upsert(item("b", cost = 100))
        dao.upsert(item("a", cost = 30))

        val active = dao.observeActiveForGroup(group).first()
        assertEquals(listOf("a", "b"), active.map { it.id })
        assertEquals("SCREEN_TIME_MIN", active[0].deliverableKind)
        assertEquals(2, dao.countForGroup(group))
    }

    @Test
    fun `setActive soft-deletes from the active view but keeps the row`() = runBlocking {
        dao.upsert(item("a"))
        assertEquals(1, dao.setActive("a", false))

        assertEquals(0, dao.observeActiveForGroup(group).first().size)
        assertEquals(1, dao.countForGroup(group)) // 软删: 行还在 (流水回查)
        assertEquals(false, dao.getById("a")?.active)
        assertEquals(0, dao.setActive("missing", false))
    }

    @Test
    fun `groups are isolated and upsert replaces by id`() = runBlocking {
        dao.upsert(item("a", groupId = "family-1"))
        dao.upsert(item("a", cost = 99, groupId = "family-1")) // 同 id 改价
        dao.upsert(item("z", groupId = "family-2"))

        val f1 = dao.observeActiveForGroup("family-1").first()
        assertEquals(1, f1.size)
        assertEquals(99, f1[0].cost)
        assertNull(dao.observeActiveForGroup("family-1").first().firstOrNull { it.id == "z" })
    }
}
