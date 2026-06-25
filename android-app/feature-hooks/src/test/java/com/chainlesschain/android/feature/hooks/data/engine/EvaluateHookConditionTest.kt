package com.chainlesschain.android.feature.hooks.data.engine

import com.chainlesschain.android.feature.hooks.domain.model.ConditionOperator
import com.chainlesschain.android.feature.hooks.domain.model.HookCondition
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * evaluateHookCondition 单测：各操作符语义；重点是 MATCHES 遇到非法用户正则时安全
 * 降级为 false（旧实现会抛 PatternSyntaxException 崩掉 hook 引擎）。feature-hooks 此前零单测。
 */
class EvaluateHookConditionTest {

    private fun cond(op: ConditionOperator, value: String) =
        HookCondition(field = "f", operator = op, value = value)

    @Test
    fun `equals and not-equals`() {
        assertTrue(evaluateHookCondition(cond(ConditionOperator.EQUALS, "x"), "x"))
        assertFalse(evaluateHookCondition(cond(ConditionOperator.EQUALS, "x"), "y"))
        assertTrue(evaluateHookCondition(cond(ConditionOperator.NOT_EQUALS, "x"), "y"))
    }

    @Test
    fun `contains starts-with ends-with`() {
        assertTrue(evaluateHookCondition(cond(ConditionOperator.CONTAINS, "ell"), "hello"))
        assertTrue(evaluateHookCondition(cond(ConditionOperator.STARTS_WITH, "he"), "hello"))
        assertTrue(evaluateHookCondition(cond(ConditionOperator.ENDS_WITH, "lo"), "hello"))
    }

    @Test
    fun `matches a valid regex`() {
        assertTrue(evaluateHookCondition(cond(ConditionOperator.MATCHES, "h.+o"), "hello"))
        assertFalse(evaluateHookCondition(cond(ConditionOperator.MATCHES, "z+"), "hello"))
    }

    @Test
    fun `invalid regex returns false instead of crashing (regression)`() {
        // 旧实现 Regex("(unclosed") 抛 PatternSyntaxException → 崩掉 hook 引擎。
        assertFalse(
            evaluateHookCondition(cond(ConditionOperator.MATCHES, "(unclosed"), "anything"),
        )
        assertFalse(
            evaluateHookCondition(cond(ConditionOperator.MATCHES, "[a-"), "anything"),
        )
    }

    @Test
    fun `greater-than and less-than coerce numbers`() {
        assertTrue(evaluateHookCondition(cond(ConditionOperator.GREATER_THAN, "100"), "150"))
        assertFalse(evaluateHookCondition(cond(ConditionOperator.GREATER_THAN, "100"), "50"))
        assertTrue(evaluateHookCondition(cond(ConditionOperator.LESS_THAN, "100"), "50"))
    }
}
