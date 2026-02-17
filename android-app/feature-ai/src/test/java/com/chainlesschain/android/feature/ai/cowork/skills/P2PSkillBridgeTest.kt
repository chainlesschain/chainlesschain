package com.chainlesschain.android.feature.ai.cowork.skills

import com.chainlesschain.android.feature.ai.cowork.skills.bridge.P2PSkillBridge
import com.chainlesschain.android.remote.p2p.ConnectionState
import com.chainlesschain.android.remote.p2p.P2PClient
import io.mockk.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test

/**
 * Unit tests for P2PSkillBridge — remote skill execution via P2P.
 */
class P2PSkillBridgeTest {

    private lateinit var mockP2PClient: P2PClient
    private lateinit var connectionState: MutableStateFlow<ConnectionState>

    @Before
    fun setUp() {
        mockP2PClient = mockk(relaxed = true)
        connectionState = MutableStateFlow(ConnectionState.DISCONNECTED)
        every { mockP2PClient.connectionState } returns connectionState
    }

    @Test
    fun `isDesktopConnected returns true when connected`() {
        connectionState.value = ConnectionState.CONNECTED
        val bridge = P2PSkillBridge(mockP2PClient)
        assertTrue(bridge.isDesktopConnected)
    }

    @Test
    fun `isDesktopConnected returns false when disconnected`() {
        connectionState.value = ConnectionState.DISCONNECTED
        val bridge = P2PSkillBridge(mockP2PClient)
        assertFalse(bridge.isDesktopConnected)
    }

    @Test
    fun `executeRemote returns error when no p2pClient`() = runBlocking {
        val bridge = P2PSkillBridge(null)
        val result = bridge.executeRemote("browser-automation", emptyMap())
        assertFalse(result.success)
        assertTrue(result.error!!.contains("P2P client not available"))
    }

    @Test
    fun `executeRemote returns error when not connected`() = runBlocking {
        connectionState.value = ConnectionState.DISCONNECTED
        val bridge = P2PSkillBridge(mockP2PClient)

        val result = bridge.executeRemote("browser-automation", mapOf("url" to "https://example.com"))
        assertFalse(result.success)
        assertTrue(result.error!!.contains("No desktop peer connected"))
    }

    @Test
    fun `executeRemote succeeds with connected desktop`() = runBlocking {
        connectionState.value = ConnectionState.CONNECTED
        val bridge = P2PSkillBridge(mockP2PClient)

        val responseMap = mapOf<String, Any>(
            "success" to true,
            "output" to "Browser automation completed",
            "skillName" to "browser-automation"
        )

        coEvery {
            mockP2PClient.sendCommand<Map<String, Any>>(
                method = "skill.execute",
                params = any(),
                timeout = any()
            )
        } returns Result.success(responseMap)

        val result = bridge.executeRemote("browser-automation", mapOf("url" to "https://example.com"))
        assertTrue(result.success)
        assertEquals("Browser automation completed", result.output)
    }

    @Test
    fun `executeRemote handles P2P failure`() = runBlocking {
        connectionState.value = ConnectionState.CONNECTED
        val bridge = P2PSkillBridge(mockP2PClient)

        coEvery {
            mockP2PClient.sendCommand<Map<String, Any>>(
                method = "skill.execute",
                params = any(),
                timeout = any()
            )
        } returns Result.failure(Exception("Connection lost"))

        val result = bridge.executeRemote("browser-automation", emptyMap())
        assertFalse(result.success)
        assertTrue(result.error!!.contains("Connection lost"))
    }

    @Test
    fun `getDesktopSkills returns empty when not connected`() = runBlocking {
        connectionState.value = ConnectionState.DISCONNECTED
        val bridge = P2PSkillBridge(mockP2PClient)

        val skills = bridge.getDesktopSkills()
        assertTrue(skills.isEmpty())
    }

    @Test
    fun `getDesktopSkills returns skills from desktop`() = runBlocking {
        connectionState.value = ConnectionState.CONNECTED
        val bridge = P2PSkillBridge(mockP2PClient)

        val responseMap = mapOf<String, Any>(
            "skills" to listOf(
                mapOf("name" to "browser-automation", "description" to "Automate browser"),
                mapOf("name" to "computer-use", "description" to "Desktop control")
            )
        )

        coEvery {
            mockP2PClient.sendCommand<Map<String, Any>>(
                method = "skill.list",
                params = any(),
                timeout = any()
            )
        } returns Result.success(responseMap)

        val skills = bridge.getDesktopSkills()
        assertEquals(2, skills.size)
        assertEquals("browser-automation", skills[0]["name"])
    }
}
