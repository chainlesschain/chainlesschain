package com.chainlesschain.android.feature.knowledge.e2e

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.chainlesschain.android.MainActivity
import com.chainlesschain.android.core.database.test.DatabaseFixture
import com.chainlesschain.android.test.*
import dagger.hilt.android.testing.HiltAndroidRule
import dagger.hilt.android.testing.HiltAndroidTest
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * 知识库 E2E 测试
 *
 * 测试完整的知识库管理流程
 */
@HiltAndroidTest
@RunWith(AndroidJUnit4::class)
class KnowledgeE2ETest {

    @get:Rule(order = 0)
    val hiltRule = HiltAndroidRule(this)

    @get:Rule(order = 1)
    val composeTestRule = createAndroidComposeRule<MainActivity>()

    @get:Rule(order = 2)
    val databaseFixture = DatabaseFixture()

    @Before
    fun setup() {
        hiltRule.inject()
        // 导航到知识库页面
        composeTestRule.waitForLoadingToComplete()
        navigateToKnowledgeBase()
    }

    private fun navigateToKnowledgeBase() {
        // 从主页导航到知识库（根据实际导航结构调整）
        composeTestRule.apply {
            clickOnText("知识库", substring = true)
            waitForLoadingToComplete()
        }
    }

    /**
     * E2E-KB-01: 完整工作流程
     * 创建→编辑→添加标签→搜索→置顶→删除
     */
    @Test
    fun testCompleteKnowledgeWorkflow() {
        val noteTitle = "E2E Test Note ${System.currentTimeMillis()}"
        val noteContent = "This is a test note content for E2E testing"
        val tag = "e2e-test"

        composeTestRule.apply {
            // 1. 创建笔记
            onNode(hasContentDescription("新建笔记") or hasText("新建")).performClick()
            waitForText("标题")

            typeTextInField("标题", noteTitle)
            typeTextInField("内容", noteContent, clearFirst = false)

            clickOnText("保存")
            waitForText(noteTitle)
            assertTextExists(noteTitle)

            // 2. 编辑笔记
            clickOnText(noteTitle)
            waitForLoadingToComplete()

            clickOnText("编辑")
            val updatedContent = "$noteContent (Updated)"
            typeTextInField("内容", updatedContent)
            clickOnText("保存")

            // 3. 添加标签
            clickOnText("标签", substring = true)
            typeTextInField("标签", tag)
            clickOnText("添加")
            assertTextExists(tag)
            clickBackButton()

            // 4. 搜索笔记
            clickOnText("搜索")
            typeTextInField("搜索", noteTitle.substring(0, 10))
            waitForText(noteTitle)
            assertTextExists(noteTitle)
            clickBackButton()

            // 5. 置顶笔记
            onNode(hasText(noteTitle)).performLongClick()
            clickOnText("置顶")
            assertSnackbarMessage("已置顶")

            // 6. 删除笔记
            onNode(hasText(noteTitle)).performLongClick()
            clickOnText("删除")
            clickOnText("确认")
            waitForLoadingToComplete()
            assertTextDoesNotExist(noteTitle)
        }
    }

    /**
     * E2E-KB-02: Markdown 编辑器功能测试
     */
    @Test
    fun testMarkdownEditorFunctionality() {
        val markdownContent = """
            # Heading 1
            ## Heading 2

            **Bold text**
            *Italic text*

            - List item 1
            - List item 2

            ```kotlin
            fun test() {
                println("Hello")
            }
            ```

            [Link](https://example.com)
        """.trimIndent()

        composeTestRule.apply {
            // 创建Markdown笔记
            onNode(hasContentDescription("新建笔记") or hasText("新建")).performClick()
            waitForText("标题")

            typeTextInField("标题", "Markdown Test")
            typeTextInField("内容", markdownContent, clearFirst = false)

            // 切换到预览模式
            clickOnText("预览")
            waitForLoadingToComplete()

            // 验证Markdown渲染
            assertTextExists("Heading 1", substring = true)
            assertTextExists("Bold text", substring = true)
            assertTextExists("Link", substring = true)

            // 保存
            clickOnText("保存")
            assertTextExists("Markdown Test")
        }
    }

    /**
     * E2E-KB-03: 离线创建并同步测试
     */
    @Test
    fun testOfflineCreationAndSync() {
        val offlineNoteTitle = "Offline Note ${System.currentTimeMillis()}"

        composeTestRule.apply {
            // 1. 离线创建笔记（禁用网络）
            onNode(hasContentDescription("新建笔记") or hasText("新建")).performClick()

            typeTextInField("标题", offlineNoteTitle)
            typeTextInField("内容", "Created offline")
            clickOnText("保存")

            // 2. 验证本地保存成功
            waitForText(offlineNoteTitle)
            assertTextExists(offlineNoteTitle)

            // 3. 触发同步
            performPullToRefresh()
            waitForLoadingToComplete()

            // 4. 验证同步状态
            clickOnText(offlineNoteTitle)
            // 检查同步标记（根据实际UI调整）
            assertTextExists("已同步", substring = true)
        }
    }

    /**
     * E2E-KB-04: FTS5 全文搜索测试
     */
    @Test
    fun testFullTextSearch() {
        val searchKeyword = "kotlin coroutines flow"
        val noteContent = "Learn about Kotlin Coroutines and Flow API for asynchronous programming"

        composeTestRule.apply {
            // 1. 创建测试笔记
            onNode(hasContentDescription("新建笔记") or hasText("新建")).performClick()
            typeTextInField("标题", "Kotlin Learning")
            typeTextInField("内容", noteContent, clearFirst = false)
            clickOnText("保存")

            // 2. 执行全文搜索
            clickOnText("搜索")
            typeTextInField("搜索", "coroutines")
            waitForLoadingToComplete()

            // 3. 验证搜索结果
            assertTextExists("Kotlin Learning")
            assertTextExists("coroutines", substring = true)

            // 4. 测试多关键词搜索
            typeTextInField("搜索", "flow api", clearFirst = true)
            waitForLoadingToComplete()
            assertTextExists("Kotlin Learning")

            // 5. 测试无结果搜索
            typeTextInField("搜索", "nonexistent_keyword_xyz", clearFirst = true)
            waitForLoadingToComplete()
            assertTextExists("没有找到", substring = true)
        }
    }

    /**
     * E2E-KB-05: 分页加载测试
     */
    @Test
    fun testPaginationLoading() {
        composeTestRule.apply {
            // 创建多个笔记以测试分页
            repeat(25) { index ->
                onNode(hasContentDescription("新建笔记") or hasText("新建")).performClick()
                typeTextInField("标题", "Page Test Note $index")
                typeTextInField("内容", "Content $index", clearFirst = false)
                clickOnText("保存")
                waitForLoadingToComplete()
            }

            // 滚动到列表顶部
            performPullToRefresh()
            waitForLoadingToComplete()

            // 验证第一页加载
            assertTextExists("Page Test Note 0", substring = true)

            // 滚动触发加载更多
            repeat(3) {
                scrollToBottom()
                waitForLoadingToComplete()
            }

            // 验证后续页面加载
            assertTextExists("Page Test Note 20", substring = true)

            // 验证加载完成提示
            scrollToBottom()
            waitForText("没有更多了", substring = true)
        }
    }

    /**
     * E2E-KB-06: 收藏功能测试
     */
    @Test
    fun testFavoritesFunctionality() {
        val favoriteNoteTitle = "Favorite Note ${System.currentTimeMillis()}"

        composeTestRule.apply {
            // 1. 创建笔记
            onNode(hasContentDescription("新建笔记") or hasText("新建")).performClick()
            typeTextInField("标题", favoriteNoteTitle)
            typeTextInField("内容", "This is a favorite note")
            clickOnText("保存")

            // 2. 添加到收藏
            clickOnText(favoriteNoteTitle)
            clickOnText("收藏")
            assertSnackbarMessage("已收藏")
            clickBackButton()

            // 3. 查看收藏列表
            clickOnText("收藏")
            waitForLoadingToComplete()
            assertTextExists(favoriteNoteTitle)

            // 4. 取消收藏
            clickOnText(favoriteNoteTitle)
            clickOnText("取消收藏")
            assertSnackbarMessage("已取消收藏")
            clickBackButton()

            // 5. 验证收藏列表已移除
            assertTextDoesNotExist(favoriteNoteTitle)
        }
    }

    /**
     * E2E-KB-07: 标签筛选测试
     */
    @Test
    fun testTagFiltering() {
        val tag1 = "android"
        val tag2 = "kotlin"

        composeTestRule.apply {
            // 创建带不同标签的笔记
            createNoteWithTag("Android Note 1", tag1)
            createNoteWithTag("Android Note 2", tag1)
            createNoteWithTag("Kotlin Note 1", tag2)

            // 筛选 android 标签
            clickOnText("标签")
            clickOnText(tag1)
            waitForLoadingToComplete()

            assertTextExists("Android Note 1")
            assertTextExists("Android Note 2")
            assertTextDoesNotExist("Kotlin Note 1")

            // 清除筛选
            clickOnText("清除筛选")
            waitForLoadingToComplete()

            // 验证显示所有笔记
            assertTextExists("Android Note 1")
            assertTextExists("Kotlin Note 1")
        }
    }

    /**
     * E2E-KB-08: 多设备同步测试
     */
    @Test
    fun testMultiDeviceSync() {
        val syncNoteTitle = "Sync Test Note ${System.currentTimeMillis()}"

        composeTestRule.apply {
            // 1. 设备A创建笔记
            onNode(hasContentDescription("新建笔记") or hasText("新建")).performClick()
            typeTextInField("标题", syncNoteTitle)
            typeTextInField("内容", "Created on Device A")
            clickOnText("保存")

            // 2. 触发同步
            performPullToRefresh()
            waitForLoadingToComplete()

            // 3. 模拟设备B接收同步（刷新）
            performPullToRefresh()
            waitForLoadingToComplete()

            // 4. 验证笔记存在
            assertTextExists(syncNoteTitle)

            // 5. 设备B编辑笔记
            clickOnText(syncNoteTitle)
            clickOnText("编辑")
            typeTextInField("内容", " - Updated on Device B")
            clickOnText("保存")

            // 6. 同步回设备A
            clickBackButton()
            performPullToRefresh()
            waitForLoadingToComplete()

            // 7. 验证更新已同步
            clickOnText(syncNoteTitle)
            assertTextExists("Updated on Device B", substring = true)
        }
    }

    // ===== Helper Methods =====

    private fun createNoteWithTag(title: String, tag: String) {
        composeTestRule.apply {
            onNode(hasContentDescription("新建笔记") or hasText("新建")).performClick()
            typeTextInField("标题", title)
            typeTextInField("内容", "Content for $title", clearFirst = false)

            // 添加标签
            clickOnText("标签", substring = true)
            typeTextInField("标签", tag)
            clickOnText("添加")

            clickOnText("保存")
            waitForLoadingToComplete()
        }
    }
}
