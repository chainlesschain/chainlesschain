package com.chainlesschain.android.pdh

import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue

/**
 * §3.5.17 事务执行纯决策测试:风险分级 / 确认词 / 可撤销 / 幂等键。
 */
class PdhTransactionTest {

    @Test
    fun risk_tiers() {
        assertEquals(TxnRisk.LOW, PdhTransaction.riskOf("mcp__pdh__set_reminder"))
        assertEquals(TxnRisk.MEDIUM, PdhTransaction.riskOf("manage_data_lifecycle", """{"op":"export"}"""))
        assertEquals(TxnRisk.HIGH, PdhTransaction.riskOf("mcp__pdh__send_message"))
        assertEquals(TxnRisk.HIGH, PdhTransaction.riskOf("make_call"))
        assertEquals(TxnRisk.CRITICAL, PdhTransaction.riskOf("manage_data_lifecycle", """{"op":"destroy"}"""))
        assertEquals(TxnRisk.CRITICAL, PdhTransaction.riskOf("pay_order"))
    }

    @Test
    fun unknown_side_effect_tool_is_medium() {
        assertEquals(TxnRisk.MEDIUM, PdhTransaction.riskOf("mcp__pdh__do_something"))
    }

    @Test
    fun is_transaction_recognizes_side_effect_tools_only() {
        for (t in listOf(
            "mcp__pdh__send_message", "make_call", "set_reminder",
            "pay_order", "transfer", "purchase", "manage_data_lifecycle",
        )) {
            assertTrue(PdhTransaction.isTransaction(t), "txn: $t")
        }
        assertFalse(PdhTransaction.isTransaction("mcp__pdh__collect_app_data"))
        assertFalse(PdhTransaction.isTransaction("query_vault"))
        assertFalse(PdhTransaction.isTransaction(null))
    }

    @Test
    fun only_critical_requires_confirm_word() {
        assertTrue(PdhTransaction.requiresConfirmWord(TxnRisk.CRITICAL))
        assertFalse(PdhTransaction.requiresConfirmWord(TxnRisk.HIGH))
        assertFalse(PdhTransaction.requiresConfirmWord(TxnRisk.LOW))
    }

    @Test
    fun reversibility() {
        assertTrue(PdhTransaction.isReversible("set_reminder"))
        assertTrue(PdhTransaction.isReversible("manage_data_lifecycle"))
        // 触达他人 / 不可逆
        assertFalse(PdhTransaction.isReversible("send_message"))
        assertFalse(PdhTransaction.isReversible("make_call"))
        assertFalse(PdhTransaction.isReversible("pay_order"))
    }

    @Test
    fun idempotency_key_stable_for_same_payload() {
        val a = PdhTransaction.idempotencyKey("send_message", """{"to":"妈妈","text":"晚上好"}""")
        val b = PdhTransaction.idempotencyKey("send_message", """{"to":"妈妈","text":"晚上好"}""")
        assertEquals(a, b)
        assertTrue(a.startsWith("txn-"))
    }

    @Test
    fun idempotency_key_differs_for_different_payload() {
        val a = PdhTransaction.idempotencyKey("send_message", """{"to":"妈妈"}""")
        val b = PdhTransaction.idempotencyKey("send_message", """{"to":"爸爸"}""")
        assertNotEquals(a, b)
    }
}
