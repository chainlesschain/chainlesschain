package com.chainlesschain.android.wear.sync

import kotlinx.serialization.json.Json
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * v1.2 #20 P0.2 Wear Phase 1 — ApprovalRequest 协议 serialization 测。
 *
 * 严格按 phone-side WearPushForwarder.renderForWatch 产出的 JSON shape 反序列化
 * — 这是 wear-app 与 phone-app 之间唯一的真"接口契约"，破坏即推送被 watch
 * silently drop。
 */
class ApprovalRequestTest {

    private val json = Json {
        ignoreUnknownKeys = true
        isLenient = true
    }

    @Test
    fun `parse Marketplace shape sent by phone`() {
        val raw = """
            {
              "id": "mp:order-42",
              "kind": "multisig.purchase",
              "title": "Marketplace 审批",
              "summary": "Premium AI Bundle",
              "amountFen": 150000,
              "createdAtMs": 1700000000000,
              "needsBiometric": true
            }
        """.trimIndent()
        val req = json.decodeFromString<ApprovalRequest>(raw)
        assertEquals("mp:order-42", req.id)
        assertEquals("multisig.purchase", req.kind)
        assertEquals("Marketplace 审批", req.title)
        assertEquals(150000L, req.amountFen)
        assertEquals(true, req.needsBiometric)
        assertNull(req.severity)
    }

    @Test
    fun `parse SystemAlert shape with severity`() {
        val raw = """
            {
              "id": "sys:12345",
              "kind": "system.alert",
              "title": "同步冲突",
              "summary": "knowledge_items 3 行需手动 resolve",
              "severity": "critical",
              "createdAtMs": 1700000000000,
              "needsBiometric": true
            }
        """.trimIndent()
        val req = json.decodeFromString<ApprovalRequest>(raw)
        assertEquals("system.alert", req.kind)
        assertEquals("critical", req.severity)
        assertNull(req.amountFen)
    }

    @Test
    fun `unknown fields are ignored (forward-compat)`() {
        val raw = """
            {
              "id": "x",
              "kind": "multisig.purchase",
              "title": "t",
              "summary": "s",
              "createdAtMs": 1,
              "futureField": "should be ignored without error",
              "anotherFuture": 42
            }
        """.trimIndent()
        val req = json.decodeFromString<ApprovalRequest>(raw)
        assertEquals("x", req.id)
    }

    @Test
    fun `ApprovalDecision serialize roundtrip`() {
        val d = ApprovalDecision(
            requestId = "mp:order-42",
            approved = true,
            decidedAtMs = 1700000000000,
            biometricToken = "tok-abc",
        )
        val raw = json.encodeToString(ApprovalDecision.serializer(), d)
        val back = json.decodeFromString(ApprovalDecision.serializer(), raw)
        assertEquals(d, back)
    }

    @Test
    fun `PATH constants match phone-side contract`() {
        // Phone-side WearPushForwarder.PATH_PUSH 必须 == ApprovalRequest.PATH_PUSH
        // 这两个常量分别在 phone (app) + watch (wear-app) 模块复制定义；
        // 单测保护 wear-side 不被无意改动（phone-side 测试在 :app module）。
        assertEquals("/cc/push", ApprovalRequest.PATH_PUSH)
        assertEquals("/cc/decision", ApprovalRequest.PATH_DECISION)
    }

    @Test
    fun `ApprovalRequest default needsBiometric=false`() {
        val raw = """
            { "id":"x","kind":"k","title":"t","summary":"s","createdAtMs":1 }
        """.trimIndent()
        val req = json.decodeFromString<ApprovalRequest>(raw)
        assertEquals(false, req.needsBiometric)
    }

    @Test
    fun `decoded request roundtrips through encode`() {
        val original = ApprovalRequest(
            id = "mp:o1",
            kind = "multisig.purchase",
            title = "x",
            summary = "y",
            amountFen = 100,
            createdAtMs = 100,
        )
        val raw = json.encodeToString(ApprovalRequest.serializer(), original)
        val back = json.decodeFromString<ApprovalRequest>(raw)
        assertEquals(original, back)
        assertTrue(raw.contains("\"amountFen\":100"))
    }
}
