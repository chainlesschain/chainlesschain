package com.chainlesschain.android.remote.ui.project

import com.chainlesschain.android.core.database.dao.ProjectDao
import com.chainlesschain.android.core.database.entity.ProjectEntity
import com.chainlesschain.android.core.database.entity.ProjectFileEntity
import com.chainlesschain.android.remote.commands.ProjectCommands
import com.chainlesschain.android.remote.commands.ProjectPullSingleResponse
import com.chainlesschain.android.remote.commands.RemoteFileFull
import com.chainlesschain.android.remote.commands.RemoteProjectFile
import com.chainlesschain.android.remote.commands.RemoteProjectItem
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Before
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * RemoteProjectBrowserViewModel 单元测试 — Sub-phase 5-6 v2 + Sub-phase 10 v2
 * (2026-05-18 "全量项目内容拉取")。
 *
 * 重点覆盖：
 *  - pullProject 真把 RemoteProjectFile → ProjectFileEntity (含 content)
 *  - 单文件 getFile 失败 continue + 不阻塞后续
 *  - content > 1MB skip（写占位 row 但 content=null）
 *  - 文件清单为空（旧 metadata-only 项目）不调 getFile + project 仍存
 *  - 同名 path 拆出正确 name + extension
 *  - pullProgress StateFlow 真随进度更新（最终回 null）
 */
@OptIn(ExperimentalCoroutinesApi::class)
class RemoteProjectBrowserViewModelTest {

    private val testDispatcher = StandardTestDispatcher()
    private lateinit var commands: ProjectCommands
    private lateinit var dao: ProjectDao

    @Before
    fun setUp() {
        Dispatchers.setMain(testDispatcher)
        commands = mockk(relaxed = false)
        dao = mockk(relaxed = false)
        // dedup 用 — 默认本地空
        coEvery { dao.getProjectsByUser(any()) } returns flowOf(emptyList())
        coEvery { dao.insertProject(any()) } returns 1L
        coEvery { dao.insertFile(any()) } returns 1L
        // loadProjects 会被 pull 后 refresh 一次；mock 空响应避免 NPE
        coEvery { commands.list(any(), any(), any(), any()) } returns
            Result.success(
                com.chainlesschain.android.remote.commands.ProjectListResponse(
                    projects = emptyList(),
                    total = 0,
                    hasMore = false,
                ),
            )
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private fun makeVm() = RemoteProjectBrowserViewModel(commands, dao)

    private fun makeRemoteProject(id: String = "p1"): RemoteProjectItem =
        RemoteProjectItem(
            id = id,
            name = "Alpha",
            description = "test",
            type = "code",
            status = "active",
            rootPath = "C:\\code\\alpha",
            pcRootPath = "C:\\code\\alpha",
            tags = null,
            metadata = null,
            createdAt = 1000L,
            updatedAt = 2000L,
        )

    private fun makeRemoteFile(
        id: String,
        path: String,
        size: Long = 100,
        hash: String? = "deadbeef",
    ): RemoteProjectFile = RemoteProjectFile(
        id = id,
        path = path,
        size = size,
        hash = hash,
        mimeType = null,
        updatedAt = 1500L,
    )

    private fun makeFull(
        id: String,
        projectId: String,
        path: String,
        content: String? = "file body",
    ): RemoteFileFull = RemoteFileFull(
        id = id,
        projectId = projectId,
        filePath = path,
        fileName = path.substringAfterLast('/').substringAfterLast('\\'),
        content = content,
        fileSize = (content?.length ?: 0).toLong(),
        createdAt = 1000L,
        updatedAt = 2000L,
    )

    // ==================== pullProject happy path ====================

    @Test
    fun `pullProject downloads all files and inserts ProjectFileEntity rows`() = runTest(testDispatcher) {
        val proj = makeRemoteProject()
        val files = listOf(
            makeRemoteFile("f1", "src/Main.kt"),
            makeRemoteFile("f2", "README.md"),
            makeRemoteFile("f3", "subdir/util.ts"),
        )
        coEvery { commands.pullSingle("p1", "user-1", true) } returns
            Result.success(
                ProjectPullSingleResponse(project = proj, files = files, filesCount = 3),
            )
        coEvery { commands.getFile("f1") } returns Result.success(makeFull("f1", "p1", "src/Main.kt", "kotlin code"))
        coEvery { commands.getFile("f2") } returns Result.success(makeFull("f2", "p1", "README.md", "# Title"))
        coEvery { commands.getFile("f3") } returns Result.success(makeFull("f3", "p1", "subdir/util.ts", "export {}"))

        val vm = makeVm()
        val saved = mutableListOf<ProjectFileEntity>()
        coEvery { dao.insertFile(capture(saved)) } returns 1L

        var pulled: String? = null
        vm.pullProject("p1", "user-1") { pulled = it }
        advanceUntilIdle()

        assertEquals("p1", pulled)
        assertEquals(3, saved.size)
        val mainKt = saved.first { it.id == "f1" }
        assertEquals("Main.kt", mainKt.name)
        assertEquals("kt", mainKt.extension)
        assertEquals("kotlin code", mainKt.content)
        assertEquals("src/Main.kt", mainKt.path)
        assertEquals("p1", mainKt.projectId)
        assertEquals("deadbeef", mainKt.hash)
        // subdir/util.ts → name=util.ts ext=ts
        val utilTs = saved.first { it.id == "f3" }
        assertEquals("util.ts", utilTs.name)
        assertEquals("ts", utilTs.extension)
        // 最终 pullProgress 回 null
        assertNull(vm.pullProgress.value)
        assertNull(vm.pullingId.value)
    }

    // ==================== 单文件失败 continue ====================

    @Test
    fun `pullProject continues when single getFile fails`() = runTest(testDispatcher) {
        val proj = makeRemoteProject()
        val files = listOf(
            makeRemoteFile("f1", "ok.md"),
            makeRemoteFile("f2", "broken.bin"),
            makeRemoteFile("f3", "also-ok.txt"),
        )
        coEvery { commands.pullSingle("p1", "user-1", true) } returns
            Result.success(ProjectPullSingleResponse(project = proj, files = files, filesCount = 3))
        coEvery { commands.getFile("f1") } returns Result.success(makeFull("f1", "p1", "ok.md", "alpha"))
        coEvery { commands.getFile("f2") } returns Result.failure(RuntimeException("file_not_found"))
        coEvery { commands.getFile("f3") } returns Result.success(makeFull("f3", "p1", "also-ok.txt", "beta"))

        val saved = mutableListOf<ProjectFileEntity>()
        coEvery { dao.insertFile(capture(saved)) } returns 1L

        val vm = makeVm()
        vm.pullProject("p1", "user-1") {}
        advanceUntilIdle()

        // f1 + f3 入 Room；f2 skip
        assertEquals(2, saved.size)
        assertTrue(saved.any { it.id == "f1" })
        assertTrue(saved.any { it.id == "f3" })
        assertTrue(saved.none { it.id == "f2" })
    }

    @Test
    fun `pullProject continues when getFile throws exception`() = runTest(testDispatcher) {
        val proj = makeRemoteProject()
        val files = listOf(
            makeRemoteFile("f1", "ok.md"),
            makeRemoteFile("f2", "boom.txt"),
        )
        coEvery { commands.pullSingle(any(), any(), any()) } returns
            Result.success(ProjectPullSingleResponse(project = proj, files = files, filesCount = 2))
        coEvery { commands.getFile("f1") } returns Result.success(makeFull("f1", "p1", "ok.md", "x"))
        coEvery { commands.getFile("f2") } throws RuntimeException("network")

        val saved = mutableListOf<ProjectFileEntity>()
        coEvery { dao.insertFile(capture(saved)) } returns 1L

        val vm = makeVm()
        vm.pullProject("p1", "user-1") {}
        advanceUntilIdle()

        assertEquals(1, saved.size)
        assertEquals("f1", saved[0].id)
    }

    // ==================== >1MB content skip ====================

    @Test
    fun `pullProject skips content for files larger than 1MB`() = runTest(testDispatcher) {
        val proj = makeRemoteProject()
        val files = listOf(
            makeRemoteFile("f-big", "huge.bin", size = 2_000_000),
            makeRemoteFile("f-small", "tiny.txt", size = 100),
        )
        val bigContent = "x".repeat(1_500_000) // 1.5MB
        coEvery { commands.pullSingle(any(), any(), any()) } returns
            Result.success(ProjectPullSingleResponse(project = proj, files = files, filesCount = 2))
        coEvery { commands.getFile("f-big") } returns
            Result.success(makeFull("f-big", "p1", "huge.bin", bigContent))
        coEvery { commands.getFile("f-small") } returns
            Result.success(makeFull("f-small", "p1", "tiny.txt", "hi"))

        val saved = mutableListOf<ProjectFileEntity>()
        coEvery { dao.insertFile(capture(saved)) } returns 1L

        val vm = makeVm()
        vm.pullProject("p1", "user-1") {}
        advanceUntilIdle()

        assertEquals(2, saved.size)
        val big = saved.first { it.id == "f-big" }
        assertNull(big.content) // skip 写 null
        assertEquals(2_000_000L, big.size) // 但 size + hash 保留
        assertEquals("deadbeef", big.hash)
        val small = saved.first { it.id == "f-small" }
        assertEquals("hi", small.content)
    }

    // ==================== files 为空 ====================

    @Test
    fun `pullProject saves project entity even when no files`() = runTest(testDispatcher) {
        val proj = makeRemoteProject()
        coEvery { commands.pullSingle(any(), any(), any()) } returns
            Result.success(ProjectPullSingleResponse(project = proj, files = emptyList(), filesCount = 0))

        val savedProjects = mutableListOf<ProjectEntity>()
        coEvery { dao.insertProject(capture(savedProjects)) } returns 1L

        val vm = makeVm()
        var pulled: String? = null
        vm.pullProject("p1", "user-1") { pulled = it }
        advanceUntilIdle()

        assertEquals("p1", pulled)
        assertTrue(savedProjects.isNotEmpty())
        coVerify(exactly = 0) { commands.getFile(any()) }
        coVerify(exactly = 0) { dao.insertFile(any()) }
    }

    // ==================== 反 race + progress lifecycle ====================

    @Test
    fun `pullProject sets pullingId and clears it on done`() = runTest(testDispatcher) {
        val proj = makeRemoteProject()
        coEvery { commands.pullSingle(any(), any(), any()) } returns
            Result.success(ProjectPullSingleResponse(project = proj, files = emptyList(), filesCount = 0))

        val vm = makeVm()
        assertNull(vm.pullingId.value)
        vm.pullProject("p1", "user-1") {}
        // 启动一拍后 pullingId 应被设
        advanceUntilIdle()
        // 完成后清回 null
        assertNull(vm.pullingId.value)
    }

    @Test
    fun `pullProject ignores second concurrent call while one is in flight`() = runTest(testDispatcher) {
        val proj = makeRemoteProject()
        coEvery { commands.pullSingle(any(), any(), any()) } coAnswers {
            // 模拟 IO 延迟
            kotlinx.coroutines.delay(100)
            Result.success(ProjectPullSingleResponse(project = proj, files = emptyList(), filesCount = 0))
        }

        val vm = makeVm()
        vm.pullProject("p1", "user-1") {}
        // 第二次调用 — 应被第 1 次未完 ignore
        vm.pullProject("p2", "user-1") {}
        advanceUntilIdle()

        // 只 1 次 pullSingle 跑（第二次被 pullingId guard ignore）
        coVerify(exactly = 1) { commands.pullSingle("p1", any(), any()) }
        coVerify(exactly = 0) { commands.pullSingle("p2", any(), any()) }
    }
}
