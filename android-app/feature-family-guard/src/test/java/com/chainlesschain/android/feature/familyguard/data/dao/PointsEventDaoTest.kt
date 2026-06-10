package com.chainlesschain.android.feature.familyguard.data.dao

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.chainlesschain.android.feature.familyguard.data.FamilyGuardDatabase
import com.chainlesschain.android.feature.familyguard.data.entity.PointsEventEntity
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import kotlin.test.assertEquals

/**
 * M9 points_event DAO (主文档 §3.9)。Room in-memory 真跑 SQL;
 * 验 append-only 去重 / 聚合下推 (同 task earn 计数 / 区间 earn·grant 累计 / 兑换次数)。
 */
@RunWith(AndroidJUnit4::class)
@Config(sdk = [33])
class PointsEventDaoTest {

    private lateinit var db: FamilyGuardDatabase
    private lateinit var dao: PointsEventDao
    private val child = "did:chain:child"
    private val parent = "did:chain:parent"

    @Before
    fun setUp() {
        db = Room.inMemoryDatabaseBuilder(
            ApplicationProvider.getApplicationContext(),
            FamilyGuardDatabase::class.java,
        )
            .allowMainThreadQueries()
            .build()
        dao = db.pointsEventDao()
    }

    @After
    fun tearDown() = db.close()

    private fun ev(
        id: String,
        type: String = "earn",
        amount: Int = 30,
        taskId: String? = null,
        rewardId: String? = null,
        granter: String? = null,
        ts: Long = 1_000L,
    ) = PointsEventEntity(
        id = id,
        childDid = child,
        type = type,
        amount = amount,
        reason = "r",
        relatedTaskId = taskId,
        relatedRewardId = rewardId,
        granterDid = granter,
        timestamp = ts,
    )

    @Test
    fun `insert and observe round-trips all fields in timestamp order`() = runBlocking {
        dao.insert(ev("e2", ts = 2_000L, taskId = "t2", amount = 20))
        dao.insert(ev("e1", ts = 1_000L, taskId = "t1"))

        val all = dao.observeAll().first()
        assertEquals(listOf("e1", "e2"), all.map { it.id })
        val first = all.first()
        assertEquals(child, first.childDid)
        assertEquals("earn", first.type)
        assertEquals(30, first.amount)
        assertEquals("t1", first.relatedTaskId)
        assertEquals(1_000L, first.timestamp)
    }

    @Test
    fun `duplicate id is silently ignored (P2P replay)`() = runBlocking {
        dao.insert(ev("e1", amount = 30))
        val second = dao.insert(ev("e1", amount = 999))
        assertEquals(-1L, second)
        assertEquals(1, dao.count())
        assertEquals(30, dao.observeAll().first().single().amount)
    }

    @Test
    fun `countEarnForTask only counts earn rows of that task`() = runBlocking {
        dao.insert(ev("e1", taskId = "t1"))
        dao.insert(ev("e2", type = "spend", amount = -10, taskId = "t1"))
        dao.insert(ev("e3", taskId = "t2"))

        assertEquals(1, dao.countEarnForTask(child, "t1"))
        assertEquals(0, dao.countEarnForTask(child, "missing"))
        assertEquals(0, dao.countEarnForTask("did:other", "t1"))
    }

    @Test
    fun `window aggregations are half-open and type-scoped`() = runBlocking {
        dao.insert(ev("e1", amount = 30, ts = 1_100L, taskId = "a"))
        dao.insert(ev("e2", amount = 20, ts = 1_500L, taskId = "b"))
        dao.insert(ev("e3", amount = 99, ts = 2_000L, taskId = "c")) // dayEnd 排除 (half-open)
        dao.insert(ev("e4", type = "grant", amount = 40, granter = parent, ts = 1_200L))
        dao.insert(ev("e5", type = "spend", amount = -10, rewardId = "r1", ts = 1_300L))
        dao.insert(ev("e6", type = "spend", amount = -10, rewardId = "r1", ts = 1_400L))

        assertEquals(50, dao.sumEarnedBetween(child, 1_000L, 2_000L))
        assertEquals(40, dao.sumGrantedBetween(parent, child, 1_000L, 2_000L))
        assertEquals(2, dao.countRedeemsBetween(child, "r1", 1_000L, 2_000L))
        // 空区间 SUM → COALESCE 0
        assertEquals(0, dao.sumEarnedBetween(child, 9_000L, 9_999L))
    }
}
