package com.chainlesschain.android.config

import com.chainlesschain.android.core.p2p.ice.IceServerConfig
import io.mockk.coEvery
import io.mockk.every
import io.mockk.mockk
import io.mockk.unmockkAll
import io.mockk.verify
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Before
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * v1.2 prep #2 — [TurnEphemeralRefresher] 启停 + disabled/empty-URL no-op 单测。
 *
 * 注意：refreshLoop 内嵌 delay(80% TTL) 导致正路径 fetch+apply 后会挂在 delay；这里只验
 * "被 cancel 干净 / disabled 时不取" 等无 delay 路径。完整 refresh 周期靠 Phase 集成测试。
 */
class TurnEphemeralRefresherTest {

    private lateinit var preferences: TurnServerPreferences
    private lateinit var client: TurnEphemeralCredentialsClient
    private lateinit var iceConfig: IceServerConfig
    private lateinit var refresher: TurnEphemeralRefresher

    @Before
    fun setup() {
        unmockkAll()
        preferences = mockk(relaxed = true)
        client = mockk(relaxed = true)
        iceConfig = mockk(relaxed = true)
    }

    @After
    fun tearDown() {
        if (::refresher.isInitialized) refresher.stop()
        unmockkAll()
    }

    @Test
    fun `start no-op when ephemeral disabled`() {
        every { preferences.ephemeralEnabled } returns MutableStateFlow(false)
        every { preferences.ephemeralEndpointUrl } returns MutableStateFlow("https://x.example.com/creds")
        refresher = TurnEphemeralRefresher(preferences, client, iceConfig)

        refresher.start()

        // no fetch attempted
        verify(exactly = 0) { iceConfig.addTurnServer(any(), any(), any()) }
        assertNull(refresher.current())
    }

    @Test
    fun `start no-op when URL blank`() {
        every { preferences.ephemeralEnabled } returns MutableStateFlow(true)
        every { preferences.ephemeralEndpointUrl } returns MutableStateFlow("")
        refresher = TurnEphemeralRefresher(preferences, client, iceConfig)

        refresher.start()

        verify(exactly = 0) { iceConfig.addTurnServer(any(), any(), any()) }
    }

    @Test
    fun `start enabled + URL kicks off fetch and applies to IceConfig`() = runBlocking {
        every { preferences.ephemeralEnabled } returns MutableStateFlow(true)
        every { preferences.ephemeralEndpointUrl } returns MutableStateFlow("https://x.example.com/creds")
        coEvery { client.fetch(any()) } returns TurnEphemeralCredentials(
            username = "u",
            password = "p",
            ttlSeconds = 3600,
            uris = listOf("turn:a:3478", "turn:b:3478"),
            fetchedAtMs = System.currentTimeMillis(),
        )
        refresher = TurnEphemeralRefresher(preferences, client, iceConfig)

        refresher.start()
        // 等首次 fetch + apply 完成。3s deadline 在 CI 大并发 (1671 其他 test 同跑)
        // 下 race-lose: refreshLoop 还没把 fetch 结果 apply 到 iceConfig，poll 就先
        // 超时退出 → addTurnServer verify 0 calls → 假阳性 fail (run 26478795271
        // / 26451121618 retry pass)。bump 到 10s — current() 一就续 break 不付
        // delay 成本，只有 flake 路径才吃满 budget。
        val deadline = System.currentTimeMillis() + 10000
        while (refresher.current() == null && System.currentTimeMillis() < deadline) {
            kotlinx.coroutines.delay(50)
        }
        refresher.stop()  // 截断后续 80%TTL delay

        verify(atLeast = 1) { iceConfig.addTurnServer("turn:a:3478", "u", "p") }
        verify(atLeast = 1) { iceConfig.addTurnServer("turn:b:3478", "u", "p") }
    }

    @Test
    fun `restart stops then starts`() {
        every { preferences.ephemeralEnabled } returns MutableStateFlow(false)
        every { preferences.ephemeralEndpointUrl } returns MutableStateFlow("")
        refresher = TurnEphemeralRefresher(preferences, client, iceConfig)

        refresher.start()
        refresher.restart()  // disabled → 仍 no-op，但调用 stop+start 不应抛
        assertNull(refresher.current())
    }

    @Test
    fun `stop is idempotent and clears current`() = runBlocking {
        every { preferences.ephemeralEnabled } returns MutableStateFlow(true)
        every { preferences.ephemeralEndpointUrl } returns MutableStateFlow("https://x.example.com/creds")
        coEvery { client.fetch(any()) } returns TurnEphemeralCredentials(
            username = "u",
            password = "p",
            ttlSeconds = 3600,
            uris = listOf("turn:a:3478"),
            fetchedAtMs = System.currentTimeMillis(),
        )
        refresher = TurnEphemeralRefresher(preferences, client, iceConfig)
        refresher.start()
        kotlinx.coroutines.delay(150)

        refresher.stop()
        refresher.stop()  // 再 stop 不应抛
        assertNull(refresher.current())
        assertTrue(true)
    }
}
