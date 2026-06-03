package com.chainlesschain.android.feature.p2p.ui

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import com.chainlesschain.android.core.database.entity.social.PostEditHistoryEntity
import com.chainlesschain.android.feature.p2p.ui.social.components.EditHistoryDialog
import com.chainlesschain.android.feature.p2p.ui.social.components.HistoryVersionDialog
import org.junit.Rule
import org.junit.Test

/**
 * 编辑历史对话框UI测试
 *
 * 测试场景：
 * - 显示编辑历史列表
 * - 显示历史版本详情
 * - 空状态显示
 * - 交互行为
 *
 * @since v0.31.0
 */
class EditHistoryDialogTest {

    @get:Rule
    val composeTestRule = createComposeRule()

    /**
     * 测试空历史状态
     */
    @Test
    fun editHistoryDialog_withEmptyList_showsEmptyState() {
        composeTestRule.setContent {
            EditHistoryDialog(
                editHistories = emptyList(),
                onDismiss = {},
                onViewVersion = {}
            )
        }

        // 验证标题存在
        composeTestRule.onNodeWithText("编辑历史").assertExists()

        // 验证空状态显示
        composeTestRule.onNodeWithText("暂无编辑历史").assertExists()

        // 验证关闭按钮存在
        composeTestRule.onNodeWithContentDescription("关闭").assertExists()
    }

    /**
     * 测试显示编辑历史列表
     */
    @Test
    fun editHistoryDialog_withHistories_displaysAllItems() {
        val histories = listOf(
            createTestHistory("1", "第一次编辑内容", 1000L),
            createTestHistory("2", "第二次编辑内容", 2000L),
            createTestHistory("3", "第三次编辑内容", 3000L)
        )

        composeTestRule.setContent {
            EditHistoryDialog(
                editHistories = histories,
                onDismiss = {},
                onViewVersion = {}
            )
        }

        // 验证所有历史记录都显示
        composeTestRule.onNodeWithText("第一次编辑内容", substring = true).assertExists()
        composeTestRule.onNodeWithText("第二次编辑内容", substring = true).assertExists()
        composeTestRule.onNodeWithText("第三次编辑内容", substring = true).assertExists()
    }

    /**
     * 测试点击查看版本
     */
    @Test
    fun editHistoryDialog_clickViewVersion_triggersCallback() {
        val history = createTestHistory("1", "测试内容", 1000L)
        var viewedHistory: PostEditHistoryEntity? = null

        composeTestRule.setContent {
            EditHistoryDialog(
                editHistories = listOf(history),
                onDismiss = {},
                onViewVersion = { viewedHistory = it }
            )
        }

        // 点击查看详情按钮
        composeTestRule.onNodeWithText("查看完整内容").performClick()

        // 验证回调被触发
        assert(viewedHistory == history)
    }

    /**
     * 测试历史版本详情对话框
     */
    @Test
    fun historyVersionDialog_displaysAllContent() {
        val history = createTestHistory(
            id = "1",
            content = "这是一段测试内容",
            timestamp = System.currentTimeMillis(),
            reason = "用户编辑",
            images = listOf("image1.jpg", "image2.jpg"),
            tags = listOf("测试", "编辑")
        )

        composeTestRule.setContent {
            HistoryVersionDialog(
                history = history,
                onDismiss = {}
            )
        }

        // 验证标题
        composeTestRule.onNodeWithText("历史版本").assertExists()

        // 验证编辑原因
        composeTestRule.onNodeWithText("用户编辑").assertExists()

        // 验证内容
        composeTestRule.onNodeWithText("这是一段测试内容").assertExists()

        // 验证图片数量
        composeTestRule.onNodeWithText("图片 (2)").assertExists()

        // 验证标签
        composeTestRule.onNodeWithText("#测试").assertExists()
        composeTestRule.onNodeWithText("#编辑").assertExists()
    }

    /**
     * 测试关闭对话框
     */
    @Test
    fun editHistoryDialog_clickClose_triggersOnDismiss() {
        var dismissed = false

        composeTestRule.setContent {
            EditHistoryDialog(
                editHistories = emptyList(),
                onDismiss = { dismissed = true },
                onViewVersion = {}
            )
        }

        // 点击关闭按钮
        composeTestRule.onNodeWithContentDescription("关闭").performClick()

        // 验证onDismiss被调用
        assert(dismissed)
    }

    // ===== 辅助方法 =====

    private fun createTestHistory(
        id: String,
        content: String,
        timestamp: Long,
        reason: String? = null,
        images: List<String> = emptyList(),
        tags: List<String> = emptyList()
    ): PostEditHistoryEntity {
        return PostEditHistoryEntity(
            id = id,
            postId = "post_123",
            previousContent = content,
            previousImages = images,
            previousLinkUrl = null,
            previousLinkPreview = null,
            previousTags = tags,
            editedAt = timestamp,
            editReason = reason,
            metadata = null
        )
    }
}
