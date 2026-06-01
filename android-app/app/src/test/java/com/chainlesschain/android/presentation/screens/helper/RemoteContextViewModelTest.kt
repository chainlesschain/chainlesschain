package com.chainlesschain.android.presentation.screens.helper

import com.chainlesschain.android.core.p2p.pairing.PairedPeersStore
import com.chainlesschain.android.remote.client.SignalingRpcClient
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Before
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.test.assertFalse

/**
 * RemoteContextViewModel 单元测试 — Sub-phase 5-6 v2 (2026-05-18)。
 *
 * 覆盖：
 *  - listPcProjects: list 解析 + pcRootPath/rootPath 兜替 + 缺路径 row 过滤 + 异常兜底
 *  - findPcProjectPathByName: 名字命中 + 缺路径返 null + 没命中返 null
 *  - pushPcRootPathToDesktop: ok=true / ok=false / 异常
 *
 * 纯 JVM 测试 — SignalingRpcClient + PairedPeersStore 全 mock。
 */
@OptIn(ExperimentalCoroutinesApi::class)
class RemoteContextViewModelTest {

    private val testDispatcher = StandardTestDispatcher()
    private lateinit var rpc: SignalingRpcClient
    private lateinit var store: PairedPeersStore

    @Before
    fun setUp() {
        Dispatchers.setMain(testDispatcher)
        rpc = mockk(relaxed = false)
        store = mockk(relaxed = true)
        every { store.devices } returns MutableStateFlow(emptyList())
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private fun makeVm(): RemoteContextViewModel = RemoteContextViewModel(store, rpc)

    private fun projectJson(
        id: String,
        name: String,
        pcRootPath: String? = null,
        rootPath: String? = null,
        type: String? = "code",
    ): JSONObject = JSONObject().apply {
        put("id", id)
        put("name", name)
        if (pcRootPath != null) put("pcRootPath", pcRootPath) else put("pcRootPath", JSONObject.NULL)
        if (rootPath != null) put("rootPath", rootPath) else put("rootPath", JSONObject.NULL)
        if (type != null) put("type", type)
    }

    private fun listResponse(items: List<JSONObject>): JSONObject = JSONObject().apply {
        val arr = JSONArray()
        items.forEach { arr.put(it) }
        put("projects", arr)
    }

    // ==================== listPcProjects ====================

    @Test
    fun `listPcProjects returns choices with pcRootPath preference over rootPath`() = runTest(testDispatcher) {
        val vm = makeVm()
        val response = listResponse(
            listOf(
                projectJson("p1", "Alpha", pcRootPath = "C:\\code\\alpha"),
                projectJson("p2", "Beta", rootPath = "/home/user/beta"),
                projectJson("p3", "Gamma", pcRootPath = "C:\\code\\gamma", rootPath = "C:\\old\\gamma"),
            ),
        )
        coEvery { rpc.invoke("pc-1", "project.list", mapOf("limit" to 200), any()) } returns
            Result.success(response)

        val choices = vm.listPcProjects("pc-1")

        assertEquals(3, choices.size)
        assertEquals("Alpha", choices[0].name)
        assertEquals("C:\\code\\alpha", choices[0].pcRootPath)
        assertEquals("Beta", choices[1].name)
        assertEquals("/home/user/beta", choices[1].pcRootPath)
        assertEquals("Gamma", choices[2].name)
        // pcRootPath 优先于 rootPath
        assertEquals("C:\\code\\gamma", choices[2].pcRootPath)
    }

    @Test
    fun `listPcProjects filters out projects with no path`() = runTest(testDispatcher) {
        val vm = makeVm()
        val response = listResponse(
            listOf(
                projectJson("p1", "Alpha", pcRootPath = "C:\\code\\alpha"),
                projectJson("p2", "NoPath"), // 两者都 null → 应被过滤
                projectJson("p3", "BlankPaths", pcRootPath = "", rootPath = ""), // 空串等同 null
            ),
        )
        coEvery { rpc.invoke("pc-1", "project.list", any(), any()) } returns Result.success(response)

        val choices = vm.listPcProjects("pc-1")

        assertEquals(1, choices.size)
        assertEquals("Alpha", choices[0].name)
    }

    @Test
    fun `listPcProjects returns empty when pcPeerId blank`() = runTest(testDispatcher) {
        val vm = makeVm()
        val choices = vm.listPcProjects("")
        assertTrue(choices.isEmpty())
        coVerify(exactly = 0) { rpc.invoke(any(), any(), any(), any()) }
    }

    @Test
    fun `listPcProjects returns empty when invoke fails`() = runTest(testDispatcher) {
        val vm = makeVm()
        coEvery { rpc.invoke("pc-1", "project.list", any(), any()) } returns
            Result.failure(RuntimeException("timeout"))

        val choices = vm.listPcProjects("pc-1")
        assertTrue(choices.isEmpty())
    }

    @Test
    fun `listPcProjects returns empty when projects field missing`() = runTest(testDispatcher) {
        val vm = makeVm()
        coEvery { rpc.invoke("pc-1", "project.list", any(), any()) } returns
            Result.success(JSONObject()) // no "projects" key

        val choices = vm.listPcProjects("pc-1")
        assertTrue(choices.isEmpty())
    }

    @Test
    fun `listPcProjects returns empty when invoke throws`() = runTest(testDispatcher) {
        val vm = makeVm()
        coEvery { rpc.invoke("pc-1", "project.list", any(), any()) } throws RuntimeException("network")

        val choices = vm.listPcProjects("pc-1")
        assertTrue(choices.isEmpty())
    }

    // ==================== findPcProjectPathByName ====================

    @Test
    fun `findPcProjectPathByName returns pcRootPath when matched`() = runTest(testDispatcher) {
        val vm = makeVm()
        val response = listResponse(
            listOf(
                projectJson("p1", "Alpha", pcRootPath = "C:\\code\\alpha"),
                projectJson("p2", "Beta", pcRootPath = "C:\\code\\beta"),
            ),
        )
        coEvery { rpc.invoke("pc-1", "project.list", any(), any()) } returns Result.success(response)

        val path = vm.findPcProjectPathByName("pc-1", "Beta")
        assertEquals("C:\\code\\beta", path)
    }

    @Test
    fun `findPcProjectPathByName falls back to rootPath when pcRootPath empty`() = runTest(testDispatcher) {
        val vm = makeVm()
        val response = listResponse(
            listOf(projectJson("p1", "Alpha", rootPath = "/home/user/alpha")),
        )
        coEvery { rpc.invoke("pc-1", "project.list", any(), any()) } returns Result.success(response)

        val path = vm.findPcProjectPathByName("pc-1", "Alpha")
        assertEquals("/home/user/alpha", path)
    }

    @Test
    fun `findPcProjectPathByName returns null when name not found`() = runTest(testDispatcher) {
        val vm = makeVm()
        val response = listResponse(
            listOf(projectJson("p1", "Alpha", pcRootPath = "C:\\code\\alpha")),
        )
        coEvery { rpc.invoke("pc-1", "project.list", any(), any()) } returns Result.success(response)

        val path = vm.findPcProjectPathByName("pc-1", "Zeta")
        assertNull(path)
    }

    @Test
    fun `findPcProjectPathByName returns null when matched project has no path`() = runTest(testDispatcher) {
        val vm = makeVm()
        val response = listResponse(
            listOf(projectJson("p1", "Alpha")), // 两者都 null
        )
        coEvery { rpc.invoke("pc-1", "project.list", any(), any()) } returns Result.success(response)

        val path = vm.findPcProjectPathByName("pc-1", "Alpha")
        assertNull(path)
    }

    @Test
    fun `findPcProjectPathByName returns null when args blank`() = runTest(testDispatcher) {
        val vm = makeVm()
        assertNull(vm.findPcProjectPathByName("", "Alpha"))
        assertNull(vm.findPcProjectPathByName("pc-1", ""))
        coVerify(exactly = 0) { rpc.invoke(any(), any(), any(), any()) }
    }

    // ==================== pushPcRootPathToDesktop ====================

    @Test
    fun `pushPcRootPathToDesktop returns true when desktop ok=true`() = runTest(testDispatcher) {
        val vm = makeVm()
        coEvery {
            rpc.invoke(
                "pc-1",
                "project.updatePath",
                mapOf("projectId" to "proj-1", "pcRootPath" to "C:\\code\\new"),
                any(),
            )
        } returns Result.success(JSONObject().apply { put("ok", true) })

        val ok = vm.pushPcRootPathToDesktop("pc-1", "proj-1", "C:\\code\\new")
        assertTrue(ok)
    }

    @Test
    fun `pushPcRootPathToDesktop returns false when desktop ok=false`() = runTest(testDispatcher) {
        val vm = makeVm()
        coEvery { rpc.invoke("pc-1", "project.updatePath", any(), any()) } returns
            Result.success(JSONObject().apply {
                put("ok", false)
                put("error", "PROJECT_NOT_FOUND")
            })

        val ok = vm.pushPcRootPathToDesktop("pc-1", "proj-missing", "C:\\code\\new")
        assertFalse(ok)
    }

    @Test
    fun `pushPcRootPathToDesktop returns false when invoke fails`() = runTest(testDispatcher) {
        val vm = makeVm()
        coEvery { rpc.invoke("pc-1", "project.updatePath", any(), any()) } returns
            Result.failure(RuntimeException("timeout"))

        val ok = vm.pushPcRootPathToDesktop("pc-1", "proj-1", "C:\\code\\new")
        assertFalse(ok)
    }

    @Test
    fun `pushPcRootPathToDesktop returns false when args blank`() = runTest(testDispatcher) {
        val vm = makeVm()
        assertFalse(vm.pushPcRootPathToDesktop("", "proj-1", "/x"))
        assertFalse(vm.pushPcRootPathToDesktop("pc-1", "", "/x"))
        coVerify(exactly = 0) { rpc.invoke(any(), any(), any(), any()) }
    }

    @Test
    fun `pushPcRootPathToDesktop returns false when invoke throws`() = runTest(testDispatcher) {
        val vm = makeVm()
        coEvery { rpc.invoke("pc-1", "project.updatePath", any(), any()) } throws
            RuntimeException("network")

        val ok = vm.pushPcRootPathToDesktop("pc-1", "proj-1", "/x")
        assertFalse(ok)
    }
}
