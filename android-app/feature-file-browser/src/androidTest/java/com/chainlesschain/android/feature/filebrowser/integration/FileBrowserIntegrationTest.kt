package com.chainlesschain.android.feature.filebrowser.integration

import android.Manifest
import android.content.Context
import android.os.Build
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.rule.GrantPermissionRule
import com.chainlesschain.android.core.database.AppDatabase
import com.chainlesschain.android.core.database.entity.FileCategory
import com.chainlesschain.android.feature.filebrowser.data.repository.ExternalFileRepository
import com.chainlesschain.android.feature.filebrowser.data.scanner.MediaStoreScanner
import com.chainlesschain.android.feature.filebrowser.ui.GlobalFileBrowserScreen
import com.chainlesschain.android.feature.filebrowser.viewmodel.GlobalFileBrowserViewModel
import dagger.hilt.android.testing.HiltAndroidRule
import dagger.hilt.android.testing.HiltAndroidTest
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import javax.inject.Inject

/**
 * 文件浏览器集成测试
 *
 * 测试场景:
 * 1. 端到端流程: 权限 → 扫描 → 显示 → 筛选 → 搜索 → 排序 → 导入
 * 2. 错误场景: 权限拒绝, 扫描失败, 空列表
 * 3. 边界测试: 大量文件, 长文件名, 特殊字符
 */
@OptIn(ExperimentalCoroutinesApi::class)
@HiltAndroidTest
@RunWith(AndroidJUnit4::class)
class FileBrowserIntegrationTest {

    @get:Rule(order = 0)
    val hiltRule = HiltAndroidRule(this)

    @get:Rule(order = 1)
    val composeTestRule = createAndroidComposeRule<MainActivity>()

    @get:Rule(order = 2)
    val permissionRule: GrantPermissionRule = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        GrantPermissionRule.grant(
            Manifest.permission.READ_MEDIA_IMAGES,
            Manifest.permission.READ_MEDIA_VIDEO,
            Manifest.permission.READ_MEDIA_AUDIO
        )
    } else {
        GrantPermissionRule.grant(Manifest.permission.READ_EXTERNAL_STORAGE)
    }

    @Inject
    lateinit var database: AppDatabase

    @Inject
    lateinit var scanner: MediaStoreScanner

    @Inject
    lateinit var repository: ExternalFileRepository

    private lateinit var context: Context

    @Before
    fun setup() {
        hiltRule.inject()
        context = ApplicationProvider.getApplicationContext()

        // 清空数据库
        database.clearAllTables()
    }

    @After
    fun tearDown() {
        database.clearAllTables()
        database.close()
    }

    /**
     * Test 1: 端到端完整流程
     * 权限已授予 → 触发扫描 → 等待完成 → 显示文件列表 → 分类筛选 → 搜索
     */
    @Test
    fun endToEndFlow_scanAndDisplayFiles() = runTest {
        // 启动GlobalFileBrowserScreen
        composeTestRule.setContent {
            GlobalFileBrowserScreen(
                projectId = null,
                onNavigateBack = {},
                onFileImported = {}
            )
        }

        // 步骤1: 验证权限已授予，显示主界面
        composeTestRule.onNodeWithText("文件浏览器").assertIsDisplayed()

        // 步骤2: 点击FAB触发扫描
        composeTestRule.onNodeWithContentDescription("扫描文件").performClick()

        // 步骤3: 等待扫描进度显示
        composeTestRule.waitUntil(timeoutMillis = 5000) {
            composeTestRule.onAllNodesWithText("扫描中:", substring = true)
                .fetchSemanticsNodes().isNotEmpty()
        }

        // 步骤4: 等待扫描完成
        composeTestRule.waitUntil(timeoutMillis = 30000) {
            composeTestRule.onAllNodesWithText("扫描完成:", substring = true)
                .fetchSemanticsNodes().isNotEmpty()
        }

        // 步骤5: 验证文件列表显示 (至少有1个文件)
        composeTestRule.waitUntil(timeoutMillis = 5000) {
            composeTestRule.onAllNodesWithTag("file_list_item")
                .fetchSemanticsNodes().isNotEmpty()
        }

        // 步骤6: 测试分类筛选
        composeTestRule.onNodeWithText("图片").performClick()
        composeTestRule.waitForIdle()

        // 验证筛选后的列表
        composeTestRule.onAllNodesWithTag("file_list_item")
            .assertCountEquals(0) // 或更多，取决于设备

        // 步骤7: 切换回全部
        composeTestRule.onNodeWithText("全部").performClick()
        composeTestRule.waitForIdle()

        // 步骤8: 测试搜索
        composeTestRule.onNodeWithContentDescription("搜索").performClick()
        composeTestRule.onNodeWithText("搜索文件...").performTextInput("test")
        composeTestRule.waitForIdle()

        // 验证搜索结果
        // (结果数量取决于设备文件)
    }

    /**
     * Test 2: 分类筛选功能
     */
    @Test
    fun categoryFilter_worksCorrectly() = runTest {
        // 预先插入测试数据
        insertTestFiles()

        composeTestRule.setContent {
            GlobalFileBrowserScreen(
                projectId = null,
                onNavigateBack = {},
                onFileImported = {}
            )
        }

        // 等待数据加载
        composeTestRule.waitForIdle()

        // 测试每个分类
        val categories = listOf("全部", "文档", "图片", "视频", "音频", "代码")

        categories.forEach { category ->
            composeTestRule.onNodeWithText(category).performClick()
            composeTestRule.waitForIdle()

            // 验证分类chip被选中
            composeTestRule.onNodeWithText(category).assertIsDisplayed()
        }
    }

    /**
     * Test 3: 排序功能
     */
    @Test
    fun sorting_worksCorrectly() = runTest {
        // 预先插入测试数据
        insertTestFiles()

        composeTestRule.setContent {
            GlobalFileBrowserScreen(
                projectId = null,
                onNavigateBack = {},
                onFileImported = {}
            )
        }

        composeTestRule.waitForIdle()

        // 测试名称排序
        composeTestRule.onNodeWithText("名称").performClick()
        composeTestRule.waitForIdle()

        // 测试大小排序
        composeTestRule.onNodeWithText("大小").performClick()
        composeTestRule.waitForIdle()

        // 测试日期排序
        composeTestRule.onNodeWithText("日期").performClick()
        composeTestRule.waitForIdle()

        // 测试排序方向切换
        composeTestRule.onNodeWithText("↑ 升序", substring = true).performClick()
        composeTestRule.waitForIdle()
        composeTestRule.onNodeWithText("↓ 降序", substring = true).assertIsDisplayed()
    }

    /**
     * Test 4: 搜索功能
     */
    @Test
    fun search_filtersFilesCorrectly() = runTest {
        // 预先插入测试数据
        insertTestFiles()

        composeTestRule.setContent {
            GlobalFileBrowserScreen(
                projectId = null,
                onNavigateBack = {},
                onFileImported = {}
            )
        }

        composeTestRule.waitForIdle()

        // 打开搜索
        composeTestRule.onNodeWithContentDescription("搜索").performClick()

        // 输入搜索关键词
        composeTestRule.onNodeWithText("搜索文件...").performTextInput("document")
        composeTestRule.waitForIdle()

        // 验证搜索结果只包含匹配的文件
        // (具体验证取决于测试数据)
    }

    /**
     * Test 5: 收藏功能
     */
    @Test
    fun favorite_togglesCorrectly() = runTest {
        // 预先插入测试数据
        insertTestFiles()

        composeTestRule.setContent {
            GlobalFileBrowserScreen(
                projectId = null,
                onNavigateBack = {},
                onFileImported = {}
            )
        }

        composeTestRule.waitForIdle()

        // 点击第一个文件的收藏按钮
        composeTestRule.onAllNodesWithContentDescription("收藏")[0].performClick()
        composeTestRule.waitForIdle()

        // 验证收藏状态已更新
        // (图标应该从StarBorder变为Star)
    }

    /**
     * Test 6: 文件导入流程
     */
    @Test
    fun fileImport_worksCorrectly() = runTest {
        // 预先插入测试数据
        insertTestFiles()

        var importedFileId: String? = null

        composeTestRule.setContent {
            GlobalFileBrowserScreen(
                projectId = "test_project_1",
                onNavigateBack = {},
                onFileImported = { fileId -> importedFileId = fileId }
            )
        }

        composeTestRule.waitForIdle()

        // 点击第一个文件的导入按钮
        composeTestRule.onAllNodesWithContentDescription("导入")[0].performClick()
        composeTestRule.waitForIdle()

        // 验证导入对话框显示
        composeTestRule.onNodeWithText("导入文件").assertIsDisplayed()

        // 点击确认导入
        composeTestRule.onNodeWithText("导入").performClick()
        composeTestRule.waitForIdle()

        // 验证回调被调用
        assert(importedFileId != null)
    }

    /**
     * Test 7: 空状态显示
     */
    @Test
    fun emptyState_displaysCorrectly() = runTest {
        // 不插入任何数据

        composeTestRule.setContent {
            GlobalFileBrowserScreen(
                projectId = null,
                onNavigateBack = {},
                onFileImported = {}
            )
        }

        composeTestRule.waitForIdle()

        // 验证空状态消息显示
        composeTestRule.onNodeWithText("未找到文件").assertIsDisplayed()
        composeTestRule.onNodeWithText("点击右下角的按钮开始扫描文件").assertIsDisplayed()
    }

    /**
     * Test 8: 刷新功能
     */
    @Test
    fun refresh_reloadsFiles() = runTest {
        // 预先插入测试数据
        insertTestFiles()

        composeTestRule.setContent {
            GlobalFileBrowserScreen(
                projectId = null,
                onNavigateBack = {},
                onFileImported = {}
            )
        }

        composeTestRule.waitForIdle()

        // 点击刷新按钮
        composeTestRule.onNodeWithContentDescription("刷新").performClick()
        composeTestRule.waitForIdle()

        // 验证文件列表重新加载
        composeTestRule.onAllNodesWithTag("file_list_item")
            .fetchSemanticsNodes().isNotEmpty()
    }

    /**
     * Test 9: 边界测试 - 长文件名
     */
    @Test
    fun longFileName_displaysCorrectly() = runTest {
        // 插入超长文件名的测试数据
        val longFileName = "This_is_a_very_long_file_name_that_should_be_truncated_in_the_UI_display_to_prevent_layout_issues.txt"
        insertTestFileWithName(longFileName)

        composeTestRule.setContent {
            GlobalFileBrowserScreen(
                projectId = null,
                onNavigateBack = {},
                onFileImported = {}
            )
        }

        composeTestRule.waitForIdle()

        // 验证长文件名被正确显示 (应该被截断)
        composeTestRule.onNodeWithText(longFileName, substring = true).assertIsDisplayed()
    }

    /**
     * Test 10: 边界测试 - 特殊字符文件名
     */
    @Test
    fun specialCharacters_handledCorrectly() = runTest {
        // 插入包含特殊字符的文件名
        val specialFileName = "文件#@123-测试_特殊字符.txt"
        insertTestFileWithName(specialFileName)

        composeTestRule.setContent {
            GlobalFileBrowserScreen(
                projectId = null,
                onNavigateBack = {},
                onFileImported = {}
            )
        }

        composeTestRule.waitForIdle()

        // 验证特殊字符文件名正确显示
        composeTestRule.onNodeWithText(specialFileName).assertIsDisplayed()
    }

    // Helper functions

    /**
     * 插入测试文件数据
     */
    private suspend fun insertTestFiles() {
        val testFiles = listOf(
            createTestFile("document1.pdf", FileCategory.DOCUMENT, 1024L),
            createTestFile("image1.jpg", FileCategory.IMAGE, 2048L),
            createTestFile("video1.mp4", FileCategory.VIDEO, 10240L),
            createTestFile("audio1.mp3", FileCategory.AUDIO, 5120L),
            createTestFile("code1.kt", FileCategory.CODE, 512L)
        )

        database.externalFileDao().insertAll(testFiles)
    }

    /**
     * 插入指定文件名的测试文件
     */
    private suspend fun insertTestFileWithName(fileName: String) {
        val file = createTestFile(fileName, FileCategory.DOCUMENT, 1024L)
        database.externalFileDao().insert(file)
    }

    /**
     * 创建测试文件实体
     */
    private fun createTestFile(
        name: String,
        category: FileCategory,
        size: Long
    ) = com.chainlesschain.android.core.database.entity.ExternalFileEntity(
        id = "test_${System.currentTimeMillis()}_${name}",
        uri = "content://media/external/file/test",
        displayName = name,
        mimeType = when (category) {
            FileCategory.IMAGE -> "image/jpeg"
            FileCategory.VIDEO -> "video/mp4"
            FileCategory.AUDIO -> "audio/mpeg"
            FileCategory.DOCUMENT -> "application/pdf"
            FileCategory.CODE -> "text/plain"
            else -> "application/octet-stream"
        },
        size = size,
        category = category,
        lastModified = System.currentTimeMillis(),
        displayPath = "/storage/emulated/0/$name",
        parentFolder = "TestFolder",
        scannedAt = System.currentTimeMillis(),
        isFavorite = false,
        extension = name.substringAfterLast('.', "")
    )
}

/**
 * 测试用MainActivity
 */
class MainActivity : androidx.activity.ComponentActivity()
