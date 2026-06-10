package com.chainlesschain.android.presentation.aistudy

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.chainlesschain.android.feature.familyguard.data.FamilyGuardDatabase
import com.chainlesschain.android.feature.familyguard.data.entity.PointsEventEntity
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config

/**
 * M9 积分账本真持久实现 ([RoomPointsLedger] ↔ family_guard.db points_event)。
 * Room in-memory 真跑 SQL; 验 domain↔entity 映射 (type 小写) / 去重 / 聚合 / 余额折叠。
 */
@RunWith(AndroidJUnit4::class)
@Config(sdk = [33])
class RoomPointsLedgerTest {

    private lateinit var db: FamilyGuardDatabase
    private lateinit var ledger: RoomPointsLedger
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
        ledger = RoomPointsLedger(db.pointsEventDao())
    }

    @After
    fun tearDown() = db.close()

    private fun event(
        id: String,
        type: PointsEventType = PointsEventType.EARN,
        amount: Int = 30,
        taskId: String? = null,
        rewardId: String? = null,
        granter: String? = null,
        ts: Long = 1_000L,
    ) = PointsEvent(
        id = id,
        childDid = child,
        type = type,
        amount = amount,
        reason = "完成作业",
        relatedTaskId = taskId,
        relatedRewardId = rewardId,
        granterDid = granter,
        timestamp = ts,
    )

    @Test
    fun `append persists and events flow round-trips the domain model`() = runBlocking {
        ledger.append(event("e1", taskId = "t1"))

        val events = ledger.events.first()
        assertEquals(1, events.size)
        assertEquals(event("e1", taskId = "t1"), events[0])
        // type 存小写字符串
        assertEquals("earn", db.pointsEventDao().observeAll().first().single().type)
    }

    @Test
    fun `balance folds persisted signed amounts`() = runBlocking {
        ledger.append(event("e1", amount = 30, taskId = "t1", ts = 1_000L))
        ledger.append(event("e2", type = PointsEventType.SPEND, amount = -10, rewardId = "r1", ts = 1_100L))
        ledger.append(event("e3", type = PointsEventType.GRANT, amount = 40, granter = parent, ts = 1_200L))

        val balance = ledger.balanceOf(child, now = 2_000L)
        assertEquals(60, balance.balance)
        assertEquals(70, balance.lifetimeEarned)
        assertEquals(10, balance.lifetimeSpent)
    }

    @Test
    fun `duplicate event id is ignored and task dedup works`() = runBlocking {
        assertFalse(ledger.hasEarnedForTask(child, "t1"))
        ledger.append(event("e1", taskId = "t1", amount = 30))
        ledger.append(event("e1", taskId = "t1", amount = 999)) // P2P 重放
        assertTrue(ledger.hasEarnedForTask(child, "t1"))
        assertEquals(30, ledger.balanceOf(child, now = 2_000L).balance)
    }

    @Test
    fun `window aggregations match the in-memory ledger semantics`() = runBlocking {
        ledger.append(event("e1", amount = 30, taskId = "a", ts = 1_100L))
        ledger.append(event("e2", amount = 20, taskId = "b", ts = 1_500L))
        ledger.append(event("e3", amount = 99, taskId = "c", ts = 2_500L)) // 窗外
        ledger.append(event("e4", type = PointsEventType.GRANT, amount = 40, granter = parent, ts = 1_200L))
        ledger.append(event("e5", type = PointsEventType.SPEND, amount = -10, rewardId = "r1", ts = 1_300L))
        ledger.append(event("e6", type = PointsEventType.SPEND, amount = -10, rewardId = "r1", ts = 1_400L))

        assertEquals(50, ledger.earnedBetween(child, 1_000L, 2_000L))
        assertEquals(40, ledger.grantedBetween(parent, child, 1_000L, 2_000L))
        assertEquals(2, ledger.redeemCountBetween(child, "r1", 1_000L, 2_000L))
    }

    @Test
    fun `unknown persisted type is dropped instead of crashing`() = runBlocking {
        db.pointsEventDao().insert(
            PointsEventEntity(
                id = "future-1",
                childDid = child,
                type = "bonus_v2", // 未来版本 P2P 同步来的未知枚举
                amount = 5,
                reason = "r",
                relatedTaskId = null,
                relatedRewardId = null,
                granterDid = null,
                timestamp = 1_000L,
            ),
        )
        ledger.append(event("e1", amount = 30))

        assertEquals(listOf("e1"), ledger.events.first().map { it.id })
        assertEquals(30, ledger.balanceOf(child, now = 2_000L).balance)
    }
}
