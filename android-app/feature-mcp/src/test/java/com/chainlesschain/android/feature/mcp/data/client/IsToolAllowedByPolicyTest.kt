package com.chainlesschain.android.feature.mcp.data.client

import com.chainlesschain.android.feature.mcp.domain.model.MCPSecurityPolicy
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * isToolAllowedByPolicy 单测：MCP 工具安全策略放行判定——blocked 优先拒绝；allowedTools
 * null=全放行 / 空=全拒绝 / 非空=白名单。feature-mcp 此前零单测。
 */
class IsToolAllowedByPolicyTest {

    @Test
    fun `null allowlist allows any non-blocked tool`() {
        assertTrue(isToolAllowedByPolicy(MCPSecurityPolicy(), "anything"))
    }

    @Test
    fun `empty allowlist denies all`() {
        assertFalse(isToolAllowedByPolicy(MCPSecurityPolicy(allowedTools = emptyList()), "t"))
    }

    @Test
    fun `non-empty allowlist restricts to listed tools`() {
        val policy = MCPSecurityPolicy(allowedTools = listOf("read", "list"))
        assertTrue(isToolAllowedByPolicy(policy, "read"))
        assertFalse(isToolAllowedByPolicy(policy, "write"))
    }

    @Test
    fun `blocked tool is denied even with a null allowlist`() {
        val policy = MCPSecurityPolicy(blockedTools = listOf("danger"))
        assertFalse(isToolAllowedByPolicy(policy, "danger"))
        assertTrue(isToolAllowedByPolicy(policy, "safe"))
    }

    @Test
    fun `blocked takes precedence over the allowlist`() {
        val policy = MCPSecurityPolicy(
            allowedTools = listOf("danger", "safe"),
            blockedTools = listOf("danger"),
        )
        assertFalse(isToolAllowedByPolicy(policy, "danger")) // blocked wins
        assertTrue(isToolAllowedByPolicy(policy, "safe"))
    }
}
