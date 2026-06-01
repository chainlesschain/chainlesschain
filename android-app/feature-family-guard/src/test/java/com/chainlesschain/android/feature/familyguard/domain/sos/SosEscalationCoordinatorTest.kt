package com.chainlesschain.android.feature.familyguard.domain.sos

import com.chainlesschain.android.feature.familyguard.data.entity.SosEventEntity
import kotlinx.coroutines.test.runTest
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * FAMILY-45 验收: SosEscalationCoordinator 兜底升级判定（PENDING + 过 60s + 有联系人）+
 * EmergencyContact JSON 解析 + escalateIfNeeded 仅 Escalate 时调 seam。
 */
class SosEscalationCoordinatorTest {

    private val child = "did:child:1"
    private val triggered = 100_000L

    private fun sos(status: String = "pending", loc: String? = "31.2,121.4") = SosEventEntity(
        id = "sos1",
        childDid = child,
        familyGroupId = "grp",
        triggeredAt = triggered,
        triggerSource = "in_app",
        locationSnapshot = loc,
        status = status,
    )

    private val contacts = listOf(EmergencyContact("外婆", "13800000000", "亲属"))

    private class RecordingNotifier : EmergencyContactNotifier {
        var calls = 0
        var lastContacts: List<EmergencyContact>? = null
        var lastLoc: String? = null
        override suspend fun notifyEmergencyContacts(
            sosEventId: String,
            childDid: String,
            contacts: List<EmergencyContact>,
            locationSnapshot: String?,
        ) {
            calls++
            lastContacts = contacts
            lastLoc = locationSnapshot
        }
    }

    private fun coordinator(notifier: EmergencyContactNotifier = RecordingNotifier()) =
        SosEscalationCoordinator(notifier)

    // ─── evaluate 纯判定 ───

    @Test
    fun `escalates when pending past 60s with contacts`() {
        val d = coordinator().evaluate(sos(), contacts, nowMs = triggered + 60_000L)
        assertTrue(d is SosEscalationDecision.Escalate)
        assertEquals(contacts, (d as SosEscalationDecision.Escalate).contacts)
    }

    @Test
    fun `holds within window`() {
        val d = coordinator().evaluate(sos(), contacts, nowMs = triggered + 59_999L)
        assertEquals(SosEscalationDecision.Hold(HoldReason.WITHIN_WINDOW), d)
    }

    @Test
    fun `holds when already acknowledged`() {
        val d = coordinator().evaluate(sos(status = "acknowledged"), contacts, nowMs = triggered + 120_000L)
        assertEquals(SosEscalationDecision.Hold(HoldReason.ALREADY_HANDLED), d)
    }

    @Test
    fun `holds when resolved or false alarm`() {
        val now = triggered + 120_000L
        assertEquals(SosEscalationDecision.Hold(HoldReason.ALREADY_HANDLED), coordinator().evaluate(sos(status = "resolved"), contacts, now))
        assertEquals(SosEscalationDecision.Hold(HoldReason.ALREADY_HANDLED), coordinator().evaluate(sos(status = "false_alarm"), contacts, now))
    }

    @Test
    fun `holds when no contacts`() {
        val d = coordinator().evaluate(sos(), emptyList(), nowMs = triggered + 120_000L)
        assertEquals(SosEscalationDecision.Hold(HoldReason.NO_CONTACTS), d)
    }

    // ─── escalateIfNeeded 副作用 ───

    @Test
    fun `escalateIfNeeded notifies only on escalate`() = runTest {
        val notifier = RecordingNotifier()
        val coord = SosEscalationCoordinator(notifier)
        // Hold → 不通知
        coord.escalateIfNeeded(sos(), contacts, nowMs = triggered + 10_000L)
        assertEquals(0, notifier.calls)
        // Escalate → 通知, 带 contacts + location
        val d = coord.escalateIfNeeded(sos(), contacts, nowMs = triggered + 60_000L)
        assertTrue(d is SosEscalationDecision.Escalate)
        assertEquals(1, notifier.calls)
        assertEquals(contacts, notifier.lastContacts)
        assertEquals("31.2,121.4", notifier.lastLoc)
    }

    @Test
    fun `custom window honored`() {
        val cfg = SosEscalationConfig(fallbackWindowMs = 30_000L)
        val d = coordinator().evaluate(sos(), contacts, nowMs = triggered + 30_000L, config = cfg)
        assertTrue(d is SosEscalationDecision.Escalate)
    }

    // ─── EmergencyContact 解析 ───

    @Test
    fun `parseList parses valid and drops bad entries`() {
        val json = """[
            {"name":"外婆","phone":"13800000000","relation":"亲属"},
            {"name":"","phone":"139"},
            {"name":"叔叔","phone":""},
            {"name":"老师","phone":"13900000000"}
        ]"""
        val list = EmergencyContact.parseList(json)
        assertEquals(2, list.size) // 空 name / 空 phone 的两项被丢
        assertEquals("外婆", list[0].name)
        assertEquals("老师", list[1].name)
    }

    @Test
    fun `parseList tolerates null blank and malformed`() {
        assertTrue(EmergencyContact.parseList(null).isEmpty())
        assertTrue(EmergencyContact.parseList("").isEmpty())
        assertTrue(EmergencyContact.parseList("not json").isEmpty())
        assertTrue(EmergencyContact.parseList("""{"name":"x"}""").isEmpty()) // 对象非数组
    }
}
