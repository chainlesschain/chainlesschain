package com.chainlesschain.android.core.p2p.ice

import org.junit.Before
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * IceServerConfig 单元测试
 */
class IceServerConfigTest {

    private lateinit var iceServerConfig: IceServerConfig

    @Before
    fun setup() {
        iceServerConfig = IceServerConfig()
    }

    // ===== 默认配置测试 =====

    @Test
    fun `default STUN servers should not be empty`() {
        assertTrue(IceServerConfig.DEFAULT_STUN_SERVERS.isNotEmpty())
    }

    @Test
    fun `default STUN servers should include Google servers`() {
        val googleServers = IceServerConfig.DEFAULT_STUN_SERVERS.filter {
            it.contains("google.com")
        }
        assertTrue(googleServers.isNotEmpty())
    }

    @Test
    fun `default ICE candidate pool size should be reasonable`() {
        assertTrue(IceServerConfig.DEFAULT_ICE_CANDIDATE_POOL_SIZE >= 0)
        assertTrue(IceServerConfig.DEFAULT_ICE_CANDIDATE_POOL_SIZE <= 10)
    }

    // ===== ICE 服务器配置测试 =====

    @Test
    fun `getIceServers should return default servers when no custom servers`() {
        val servers = iceServerConfig.getIceServers()

        assertTrue(servers.isNotEmpty())
        assertEquals(IceServerConfig.DEFAULT_STUN_SERVERS.size, servers.size)
    }

    @Test
    fun `addStunServer should add custom STUN server`() {
        val customServer = "stun:custom.stun.server:3478"

        iceServerConfig.addStunServer(customServer)
        val servers = iceServerConfig.getIceServers()

        // 当有自定义服务器时，只使用自定义服务器
        assertEquals(1, servers.size)
    }

    @Test
    fun `addStunServer should not add duplicate`() {
        val customServer = "stun:custom.stun.server:3478"

        iceServerConfig.addStunServer(customServer)
        iceServerConfig.addStunServer(customServer)
        val servers = iceServerConfig.getIceServers()

        assertEquals(1, servers.size)
    }

    @Test
    fun `addTurnServer should add TURN server with credentials`() {
        val turnUrl = "turn:turn.example.com:3478"
        val username = "user"
        val password = "pass"

        iceServerConfig.addTurnServer(turnUrl, username, password)
        val servers = iceServerConfig.getIceServers()

        // 默认 STUN + 1 个 TURN
        assertEquals(IceServerConfig.DEFAULT_STUN_SERVERS.size + 1, servers.size)
    }

    @Test
    fun `removeTurnServer should remove TURN server`() {
        val turnUrl = "turn:turn.example.com:3478"

        iceServerConfig.addTurnServer(turnUrl, "user", "pass")
        iceServerConfig.removeTurnServer(turnUrl)
        val servers = iceServerConfig.getIceServers()

        assertEquals(IceServerConfig.DEFAULT_STUN_SERVERS.size, servers.size)
    }

    @Test
    fun `clearCustomServers should remove all custom servers`() {
        iceServerConfig.addStunServer("stun:custom1:3478")
        iceServerConfig.addStunServer("stun:custom2:3478")
        iceServerConfig.addTurnServer("turn:turn1:3478", "user", "pass")

        iceServerConfig.clearCustomServers()
        val servers = iceServerConfig.getIceServers()

        // 应该恢复到默认服务器
        assertEquals(IceServerConfig.DEFAULT_STUN_SERVERS.size, servers.size)
    }

    // ===== ICE 候选池测试 =====

    @Test
    fun `setIceCandidatePoolSize should accept valid values`() {
        iceServerConfig.setIceCandidatePoolSize(5)
        val summary = iceServerConfig.getConfigSummary()

        assertEquals(5, summary.candidatePoolSize)
    }

    @Test
    fun `setIceCandidatePoolSize should clamp negative values to 0`() {
        iceServerConfig.setIceCandidatePoolSize(-5)
        val summary = iceServerConfig.getConfigSummary()

        assertEquals(0, summary.candidatePoolSize)
    }

    @Test
    fun `setIceCandidatePoolSize should clamp large values to 10`() {
        iceServerConfig.setIceCandidatePoolSize(100)
        val summary = iceServerConfig.getConfigSummary()

        assertEquals(10, summary.candidatePoolSize)
    }

    // ===== 配置摘要测试 =====

    @Test
    fun `getConfigSummary should return correct counts`() {
        iceServerConfig.addTurnServer("turn:turn1:3478", "user", "pass")
        iceServerConfig.addTurnServer("turn:turn2:3478", "user", "pass")

        val summary = iceServerConfig.getConfigSummary()

        assertEquals(IceServerConfig.DEFAULT_STUN_SERVERS.size, summary.stunServerCount)
        assertEquals(2, summary.turnServerCount)
    }

    @Test
    fun `getConfigSummary should use custom STUN count when available`() {
        iceServerConfig.addStunServer("stun:custom1:3478")
        iceServerConfig.addStunServer("stun:custom2:3478")
        iceServerConfig.addStunServer("stun:custom3:3478")

        val summary = iceServerConfig.getConfigSummary()

        assertEquals(3, summary.stunServerCount)
    }

    // ===== TURN 服务器凭据测试 =====

    @Test
    fun `TurnServerCredentials should store all fields`() {
        val credentials = TurnServerCredentials(
            url = "turn:turn.example.com:3478",
            username = "testuser",
            password = "testpass"
        )

        assertEquals("turn:turn.example.com:3478", credentials.url)
        assertEquals("testuser", credentials.username)
        assertEquals("testpass", credentials.password)
    }

    // ===== STUN 测试结果测试 =====

    @Test
    fun `StunTestResult Success should contain latency`() {
        val result = StunTestResult.Success("stun:example.com:3478", 50)

        assertTrue(result is StunTestResult.Success)
        assertEquals(50, result.latencyMs)
    }

    @Test
    fun `StunTestResult Timeout should contain url`() {
        val result = StunTestResult.Timeout("stun:example.com:3478")

        assertTrue(result is StunTestResult.Timeout)
        assertEquals("stun:example.com:3478", result.url)
    }

    @Test
    fun `StunTestResult Failed should contain error message`() {
        val result = StunTestResult.Failed("stun:example.com:3478", "Connection refused")

        assertTrue(result is StunTestResult.Failed)
        assertEquals("Connection refused", result.error)
    }

    // ===== ICE 配置摘要测试 =====

    @Test
    fun `IceConfigSummary should store all fields`() {
        val summary = IceConfigSummary(
            stunServerCount = 5,
            turnServerCount = 2,
            transportPolicy = "ALL",
            candidatePoolSize = 3
        )

        assertEquals(5, summary.stunServerCount)
        assertEquals(2, summary.turnServerCount)
        assertEquals("ALL", summary.transportPolicy)
        assertEquals(3, summary.candidatePoolSize)
    }

    // ===== STUN URL 格式测试 =====

    @Test
    fun `STUN server URLs should have correct format`() {
        for (url in IceServerConfig.DEFAULT_STUN_SERVERS) {
            assertTrue(url.startsWith("stun:"), "URL should start with 'stun:': $url")
            assertTrue(url.contains(":"), "URL should contain port: $url")
        }
    }
}
