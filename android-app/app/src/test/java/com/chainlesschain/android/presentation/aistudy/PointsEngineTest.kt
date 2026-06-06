package com.chainlesschain.android.presentation.aistudy

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PointsEngineTest {

    private val rules = EarnRules()
    private val child = "did:child:1"
    private val parent = "did:parent:1"

    private fun ev(
        type: PointsEventType,
        amount: Int,
        childDid: String = child,
        taskId: String? = null,
        rewardId: String? = null,
        granter: String? = null,
        ts: Long = 0,
    ) = PointsEvent(
        id = "e-$ts-$amount",
        childDid = childDid,
        type = type,
        amount = amount,
        reason = "t",
        relatedTaskId = taskId,
        relatedRewardId = rewardId,
        granterDid = granter,
        timestamp = ts,
    )

    // ---- computeBalance ----

    @Test
    fun `balance folds signed amounts and tracks lifetime`() {
        val events = listOf(
            ev(PointsEventType.EARN, 30, ts = 1),
            ev(PointsEventType.GRANT, 20, granter = parent, ts = 2),
            ev(PointsEventType.SPEND, -40, rewardId = "r1", ts = 3),
        )
        val b = PointsEngine.computeBalance(child, events, updatedAt = 99)
        assertEquals(10, b.balance)
        assertEquals(50, b.lifetimeEarned)
        assertEquals(40, b.lifetimeSpent)
        assertEquals(99, b.updatedAt)
    }

    @Test
    fun `balance ignores other childs events`() {
        val events = listOf(
            ev(PointsEventType.EARN, 30, ts = 1),
            ev(PointsEventType.EARN, 100, childDid = "did:child:2", ts = 2),
        )
        assertEquals(30, PointsEngine.computeBalance(child, events, updatedAt = 0).balance)
    }

    // ---- homeworkPoints tiers ----

    @Test
    fun `homework points tiered by score`() {
        assertEquals(30, PointsEngine.homeworkPoints(100, rules))
        assertEquals(20, PointsEngine.homeworkPoints(85, rules))
        assertEquals(20, PointsEngine.homeworkPoints(80, rules))
        assertEquals(10, PointsEngine.homeworkPoints(60, rules))
        assertEquals(10, PointsEngine.homeworkPoints(79, rules))
        assertEquals(0, PointsEngine.homeworkPoints(59, rules))
    }

    @Test
    fun `raw points per completion kind`() {
        assertEquals(25, PointsEngine.rawPoints(Completion.Essay("t"), rules))
        assertEquals(15, PointsEngine.rawPoints(Completion.Running("t", km = 3), rules))
        assertEquals(0, PointsEngine.rawPoints(Completion.Running("t", km = -5), rules))
        assertEquals(8, PointsEngine.rawPoints(Completion.MistakeReview("t", count = 5), rules))
        assertEquals(0, PointsEngine.rawPoints(Completion.MistakeReview("t", count = 4), rules))
    }

    // ---- decideEarn happy path + anti-cheat ----

    @Test
    fun `earn happy path produces EARN event`() {
        val d = PointsEngine.decideEarn(
            childDid = child,
            completion = Completion.Homework("task-1", scorePct = 100),
            reason = "数学作业全对",
            context = EarnContext(),
            eventId = "e1",
            now = 1000,
        )
        assertEquals(30, d.approvedAmount)
        assertEquals(30, d.rawAmount)
        assertNotNull(d.event)
        val e = d.event!!
        assertEquals(PointsEventType.EARN, e.type)
        assertEquals("task-1", e.relatedTaskId)
        assertFalse(d.rejected)
    }

    @Test
    fun `earn rejected when task already earned`() {
        val d = PointsEngine.decideEarn(
            childDid = child,
            completion = Completion.Homework("task-1", scorePct = 100),
            reason = "r",
            context = EarnContext(taskAlreadyEarned = true),
            eventId = "e1",
            now = 0,
        )
        assertTrue(d.rejected)
        assertEquals(0, d.approvedAmount)
        assertNull(d.event)
    }

    @Test
    fun `earn rejected below threshold`() {
        val d = PointsEngine.decideEarn(
            childDid = child,
            completion = Completion.Homework("task-1", scorePct = 40),
            reason = "r",
            context = EarnContext(),
            eventId = "e1",
            now = 0,
        )
        assertTrue(d.rejected)
    }

    @Test
    fun `full mark with repeated answer-seeking is halved`() {
        val d = PointsEngine.decideEarn(
            childDid = child,
            completion = Completion.Homework("task-1", scorePct = 100, answerSeekingAttempts = 3),
            reason = "r",
            context = EarnContext(),
            eventId = "e1",
            now = 0,
        )
        assertEquals(15, d.approvedAmount)
        assertEquals(30, d.rawAmount)
        assertTrue(d.notes.any { it.contains("50%") })
    }

    @Test
    fun `answer-seeking below threshold does not halve`() {
        val d = PointsEngine.decideEarn(
            childDid = child,
            completion = Completion.Homework("task-1", scorePct = 100, answerSeekingAttempts = 2),
            reason = "r",
            context = EarnContext(),
            eventId = "e1",
            now = 0,
        )
        assertEquals(30, d.approvedAmount)
    }

    @Test
    fun `earn truncated at daily cap`() {
        val d = PointsEngine.decideEarn(
            childDid = child,
            completion = Completion.Homework("task-1", scorePct = 100),
            reason = "r",
            context = EarnContext(earnedToday = 190),
            eventId = "e1",
            now = 0,
        )
        assertEquals(10, d.approvedAmount) // cap 200 - 190 = 10
        assertTrue(d.notes.any { it.contains("单日上限") })
    }

    @Test
    fun `earn rejected when daily cap already reached`() {
        val d = PointsEngine.decideEarn(
            childDid = child,
            completion = Completion.Homework("task-1", scorePct = 100),
            reason = "r",
            context = EarnContext(earnedToday = 200),
            eventId = "e1",
            now = 0,
        )
        assertTrue(d.rejected)
    }

    // ---- decideSpend ----

    private fun reward(cost: Int, maxPerDay: Int = 0, active: Boolean = true) = RewardCatalogItem(
        id = "r1",
        familyGroupId = "g1",
        name = "额外 30 分钟游戏",
        cost = cost,
        deliverable = Deliverable(DeliverableKind.SCREEN_TIME_MIN, value = 30),
        maxPerDay = maxPerDay,
        active = active,
        createdBy = parent,
        createdAt = 0,
    )

    @Test
    fun `spend succeeds with sufficient balance`() {
        val d = PointsEngine.decideSpend(child, reward(cost = 50), balance = 80, redeemedTodayForItem = 0, eventId = "e1", now = 5)
        assertTrue(d.approved)
        val e = d.event!!
        assertEquals(-50, e.amount)
        assertEquals("r1", e.relatedRewardId)
    }

    @Test
    fun `spend fails with insufficient balance`() {
        val d = PointsEngine.decideSpend(child, reward(cost = 50), balance = 49, redeemedTodayForItem = 0, eventId = "e1", now = 0)
        assertFalse(d.approved)
        assertNull(d.event)
        assertTrue(d.reason.contains("积分不足"))
    }

    @Test
    fun `spend fails when reward inactive`() {
        val d = PointsEngine.decideSpend(child, reward(cost = 10, active = false), balance = 999, redeemedTodayForItem = 0, eventId = "e1", now = 0)
        assertFalse(d.approved)
        assertTrue(d.reason.contains("下架"))
    }

    @Test
    fun `spend fails when daily redeem cap hit`() {
        val d = PointsEngine.decideSpend(child, reward(cost = 10, maxPerDay = 1), balance = 999, redeemedTodayForItem = 1, eventId = "e1", now = 0)
        assertFalse(d.approved)
        assertTrue(d.reason.contains("兑换上限"))
    }

    // ---- decideGrant ----

    @Test
    fun `grant happy path`() {
        val d = PointsEngine.decideGrant(child, amount = 50, reason = "表现好", granterDid = parent, grantedTodayByGuardian = 0, eventId = "e1", now = 7)
        assertEquals(50, d.approvedAmount)
        val e = d.event!!
        assertEquals(PointsEventType.GRANT, e.type)
        assertEquals(parent, e.granterDid)
    }

    @Test
    fun `grant rejected above per-event cap`() {
        val d = PointsEngine.decideGrant(child, amount = 101, reason = "r", granterDid = parent, grantedTodayByGuardian = 0, eventId = "e1", now = 0)
        assertTrue(d.rejected)
        assertTrue(d.notes.first().contains("单笔发放上限"))
    }

    @Test
    fun `grant truncated at daily cap`() {
        val d = PointsEngine.decideGrant(child, amount = 100, reason = "r", granterDid = parent, grantedTodayByGuardian = 250, eventId = "e1", now = 0)
        assertEquals(50, d.approvedAmount) // 300 - 250
        assertTrue(d.notes.any { it.contains("单日发放上限") })
    }

    @Test
    fun `grant rejected when daily cap exhausted`() {
        val d = PointsEngine.decideGrant(child, amount = 50, reason = "r", granterDid = parent, grantedTodayByGuardian = 300, eventId = "e1", now = 0)
        assertTrue(d.rejected)
    }

    @Test
    fun `grant rejects non-positive amount`() {
        assertTrue(PointsEngine.decideGrant(child, 0, "r", parent, 0, "e1", 0).rejected)
        assertTrue(PointsEngine.decideGrant(child, -5, "r", parent, 0, "e1", 0).rejected)
    }

    // ---- streakBonus ----

    @Test
    fun `streak bonus only on multiples of 7`() {
        assertEquals(50, PointsEngine.streakBonus(7, rules))
        assertEquals(50, PointsEngine.streakBonus(14, rules))
        assertEquals(0, PointsEngine.streakBonus(6, rules))
        assertEquals(0, PointsEngine.streakBonus(8, rules))
        assertEquals(0, PointsEngine.streakBonus(0, rules))
    }

    // ---- InMemoryPointsLedger seam ----

    @Test
    fun `ledger append updates balance and dedup`() {
        val ledger = InMemoryPointsLedger()
        assertFalse(ledger.hasEarnedForTask(child, "task-1"))

        val d = PointsEngine.decideEarn(
            childDid = child,
            completion = Completion.Homework("task-1", scorePct = 100),
            reason = "r",
            context = EarnContext(taskAlreadyEarned = ledger.hasEarnedForTask(child, "task-1")),
            eventId = "e1",
            now = 1000,
        )
        ledger.append(d.event!!)

        assertEquals(30, ledger.balanceOf(child, now = 1000).balance)
        assertTrue(ledger.hasEarnedForTask(child, "task-1"))
    }

    @Test
    fun `ledger day-window aggregations`() {
        val ledger = InMemoryPointsLedger()
        // day window [1000, 2000)
        ledger.append(ev(PointsEventType.EARN, 30, taskId = "a", ts = 1100))
        ledger.append(ev(PointsEventType.EARN, 20, taskId = "b", ts = 1500))
        ledger.append(ev(PointsEventType.EARN, 99, taskId = "c", ts = 2500)) // outside
        ledger.append(ev(PointsEventType.GRANT, 40, granter = parent, ts = 1200))
        ledger.append(ev(PointsEventType.SPEND, -10, rewardId = "r1", ts = 1300))
        ledger.append(ev(PointsEventType.SPEND, -10, rewardId = "r1", ts = 1400))

        assertEquals(50, ledger.earnedBetween(child, 1000, 2000))
        assertEquals(40, ledger.grantedBetween(parent, child, 1000, 2000))
        assertEquals(2, ledger.redeemCountBetween(child, "r1", 1000, 2000))
    }
}
