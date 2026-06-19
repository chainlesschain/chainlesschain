package com.chainlesschain.android.presentation.aistudy

import kotlinx.serialization.SerializationException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class PointsEventSyncDataTest {

    private fun earn() = PointsEvent(
        id = "pe-1",
        childDid = "did:key:child",
        type = PointsEventType.EARN,
        amount = 30,
        reason = "作业满分",
        relatedTaskId = "t-1",
        timestamp = 1_700_000_000_000L,
    )

    @Test
    fun `earn event round-trips losslessly`() {
        val original = earn()
        val decoded = PointsEventSyncData.decode(PointsEventSyncData.encode(original))
        assertEquals(original, decoded)
    }

    @Test
    fun `grant event with granter and negative spend round-trip`() {
        val grant = PointsEvent(
            id = "pe-2", childDid = "did:key:child", type = PointsEventType.GRANT,
            amount = 100, reason = "奖励", granterDid = "did:key:parent", timestamp = 2L,
        )
        val spend = PointsEvent(
            id = "pe-3", childDid = "did:key:child", type = PointsEventType.SPEND,
            amount = -50, reason = "兑换屏幕时间", relatedRewardId = "r-1", timestamp = 3L,
        )
        assertEquals(grant, PointsEventSyncData.decode(PointsEventSyncData.encode(grant)))
        assertEquals(spend, PointsEventSyncData.decode(PointsEventSyncData.encode(spend)))
    }

    @Test
    fun `type serialized as name keeps amount sign intact`() {
        val json = PointsEventSyncData.encode(earn())
        assertTrue(json.contains("EARN"))
        assertTrue(json.contains("\"amount\":30"))
    }

    @Test
    fun `unknown type throws so caller can drop the row`() {
        // 积分宁缺勿错：未知 type 不静默回落，抛异常让调用方丢弃 (否则错算余额)。
        val json = PointsEventSyncData.encode(earn()).replace("EARN", "BRAND_NEW_TYPE")
        assertThrows(IllegalArgumentException::class.java) {
            PointsEventSyncData.decode(json)
        }
    }

    @Test
    fun `unknown extra json keys are ignored`() {
        val good = PointsEventSyncData.encode(earn())
        val withExtra = good.dropLast(1) + ",\"futureField\":1}"
        assertEquals("pe-1", PointsEventSyncData.decode(withExtra).id)
    }

    @Test
    fun `malformed json throws SerializationException`() {
        assertThrows(SerializationException::class.java) {
            PointsEventSyncData.decode("}{")
        }
    }
}
