package com.chainlesschain.android.wear.sync

import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * v1.2 #20 P0.2 Wear Phase 2 — WearDecisionSender contract test。
 *
 * 真 sendMessage 走 Wearable Data Layer，单测里 mock NodeClient 复杂度高且
 * Play services 在 unit-test JVM 下不可用。这里测的是 JSON 协议形状 +
 * PATH constant 与 phone-side 对齐（实际 Wearable IO 留 instrumented test）。
 */
class WearDecisionSenderTest {

    private val json = kotlinx.serialization.json.Json { encodeDefaults = false }

    @Test
    fun `decision encodes minimal fields when biometricToken null`() {
        val d = ApprovalDecision(
            requestId = "mp:o-1",
            approved = true,
            decidedAtMs = 1700000000000,
            biometricToken = null,
        )
        val raw = json.encodeToString(ApprovalDecision.serializer(), d)
        assertTrue(raw.contains("\"requestId\":\"mp:o-1\""))
        assertTrue(raw.contains("\"approved\":true"))
        // encodeDefaults=false 加 biometricToken 是默认 null → 不输出
        assertEquals(false, raw.contains("biometricToken"))
    }

    @Test
    fun `decision encodes biometricToken when present`() {
        val d = ApprovalDecision(
            requestId = "mp:o-2",
            approved = true,
            decidedAtMs = 1700000000000,
            biometricToken = "weak-ok",
        )
        val raw = json.encodeToString(ApprovalDecision.serializer(), d)
        assertTrue(raw.contains("\"biometricToken\":\"weak-ok\""))
    }

    @Test
    fun `decision can be parsed back symmetrically`() {
        val d = ApprovalDecision(
            requestId = "sys:42",
            approved = false,
            decidedAtMs = 1,
        )
        val raw = json.encodeToString(ApprovalDecision.serializer(), d)
        val back = json.decodeFromString(ApprovalDecision.serializer(), raw)
        assertEquals(d, back)
    }

    @Test
    fun `phone-side wire format PATH_DECISION matches`() {
        // Local constant + phone-side hardcoded "/cc/decision" must match.
        assertEquals("/cc/decision", ApprovalRequest.PATH_DECISION)
    }
}
