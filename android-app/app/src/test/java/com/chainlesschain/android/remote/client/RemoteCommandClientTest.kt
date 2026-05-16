package com.chainlesschain.android.remote.client

import com.chainlesschain.android.core.p2p.pairing.PairedDesktop
import com.chainlesschain.android.core.p2p.pairing.PairedDesktopsStore
import com.chainlesschain.android.remote.offline.OfflineCommandQueue
import com.chainlesschain.android.remote.p2p.P2PClient
import io.mockk.clearAllMocks
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.test.runTest
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * RemoteCommandClient 单元测试
 *
 * 验证 2026-05-17 transport bug 修复回归：
 * - invokeTyped 必须 delegate 到 SignalingRpcClient（不走 P2PClient.sendCommand）
 * - pcPeerId 从 PairedDesktopsStore.devices.firstOrNull() 取
 * - 已配对桌面为空时返回 Result.failure("无已配对桌面")
 * - SignalingRpc 返回 JSONObject → Gson roundtrip 转 typed T
 *
 * Plan C 路径下 P2PClient.connectionState 永远 DISCONNECTED，老实现走
 * P2PClient.sendCommand 立即 "Not connected" 失败。此 test 锁死正确路径。
 */
@OptIn(ExperimentalCoroutinesApi::class)
class RemoteCommandClientTest {

    private lateinit var client: RemoteCommandClient
    private lateinit var p2pClient: P2PClient
    private lateinit var offlineQueue: OfflineCommandQueue
    private lateinit var signalingRpc: SignalingRpcClient
    private lateinit var pairedStore: PairedDesktopsStore
    private lateinit var devicesFlow: MutableStateFlow<List<PairedDesktop>>

    @Before
    fun setup() {
        p2pClient = mockk(relaxed = true)
        offlineQueue = mockk(relaxed = true)
        signalingRpc = mockk(relaxed = true)
        pairedStore = mockk(relaxed = true)
        devicesFlow = MutableStateFlow(emptyList())
        every { pairedStore.devices } returns (devicesFlow as StateFlow<List<PairedDesktop>>)

        client = RemoteCommandClient(p2pClient, offlineQueue, signalingRpc, pairedStore)
    }

    @After
    fun tearDown() {
        clearAllMocks()
    }

    @Test
    fun `invoke delegates to SignalingRpcClient with pcPeerId from PairedDesktopsStore`() = runTest {
        // Given: 配对桌面已存在
        val testPeerId = "fb8380b1d3cccd16cb38721a5b51c458"
        devicesFlow.value = listOf(
            PairedDesktop(
                pcPeerId = testPeerId,
                deviceName = "Test Desktop",
            ),
        )
        val mockResponse = JSONObject().apply {
            put("success", true)
            put("path", "/home/test")
            put("entries", org.json.JSONArray())
            put("total", 0)
        }
        coEvery {
            signalingRpc.invoke(testPeerId, "file.listDirectory", any(), any())
        } returns Result.success(mockResponse)

        // When
        val result: Result<JSONObject> = client.invoke<JSONObject>(
            "file.listDirectory",
            mapOf("path" to "/home/test"),
        )

        // Then
        assertTrue("expected success", result.isSuccess)
        coVerify(exactly = 1) {
            signalingRpc.invoke(testPeerId, "file.listDirectory", any(), any())
        }
        // 关键回归：必须 *不* 走 P2PClient.sendCommand（老路径会 Not connected）
        coVerify(exactly = 0) {
            p2pClient.sendCommand<Any>(any(), any(), any(), any())
        }
    }

    @Test
    fun `invoke fails when no paired desktop`() = runTest {
        // Given: 配对列表空
        devicesFlow.value = emptyList()

        // When
        val result: Result<JSONObject> = client.invoke<JSONObject>("file.listDirectory")

        // Then
        assertTrue("expected failure", result.isFailure)
        assertEquals("无已配对桌面", result.exceptionOrNull()?.message)
        coVerify(exactly = 0) {
            signalingRpc.invoke(any(), any(), any(), any())
        }
    }

    @Test
    fun `invoke propagates signalingRpc failure`() = runTest {
        // Given
        val testPeerId = "test-peer-id"
        devicesFlow.value = listOf(
            PairedDesktop(testPeerId, "Test"),
        )
        coEvery {
            signalingRpc.invoke(testPeerId, "file.listDirectory", any(), any())
        } returns Result.failure(Exception("远程命令超时 (30s)"))

        // When
        val result: Result<JSONObject> = client.invoke<JSONObject>("file.listDirectory")

        // Then
        assertTrue("expected failure", result.isFailure)
        assertEquals("远程命令超时 (30s)", result.exceptionOrNull()?.message)
    }

    @Test
    fun `invoke picks first device when multiple paired`() = runTest {
        // Given: 多个配对桌面
        devicesFlow.value = listOf(
            PairedDesktop("peer-1", "Desktop A"),
            PairedDesktop("peer-2", "Desktop B"),
        )
        coEvery {
            signalingRpc.invoke(any(), any(), any(), any())
        } returns Result.success(JSONObject())

        // When
        client.invoke<JSONObject>("file.listDirectory")

        // Then: 应该用 firstOrNull (peer-1)，不是 peer-2
        coVerify {
            signalingRpc.invoke("peer-1", "file.listDirectory", any(), any())
        }
    }
}
