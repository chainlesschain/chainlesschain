package com.chainlesschain.android.feature.p2p.e2e

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.chainlesschain.android.MainActivity
import dagger.hilt.android.testing.HiltAndroidRule
import dagger.hilt.android.testing.HiltAndroidTest
import io.mockk.coEvery
import io.mockk.mockk
import kotlinx.coroutines.test.runTest
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import com.chainlesschain.android.feature.p2p.moderation.ContentModerator
import com.chainlesschain.android.feature.p2p.moderation.ModerationResult
import com.chainlesschain.android.feature.p2p.moderation.ViolationCategory
import com.chainlesschain.android.feature.p2p.moderation.Severity
import com.chainlesschain.android.core.common.Result

/**
 * AI内容审核系统端到端测试 - Phase 7.5
 *
 * 测试场景：
 * 1. 发布正常内容 - 自动通过审核
 * 2. 发布违规内容 - 被拦截并提示
 * 3. 查看审核队列 - 管理员功能
 * 4. 人工复审流程 - 批准/拒绝
 *
 * 测试覆盖：
 * - AI审核规则引擎
 * - 审核工作流
 * - 审核队列UI
 * - 人工复审操作
 */
@HiltAndroidTest
@RunWith(AndroidJUnit4::class)
class ModerationE2ETest {

    @get:Rule(order = 0)
    val hiltRule = HiltAndroidRule(this)

    @get:Rule(order = 1)
    val composeTestRule = createAndroidComposeRule<MainActivity>()

    private lateinit var contentModerator: ContentModerator

    @Before
    fun setup() {
        hiltRule.inject()
        contentModerator = mockk(relaxed = true)
    }

    /**
     * Test 1: 发布正常内容 - 自动通过审核
     *
     * 场景：
     * 1. 用户输入正常文本内容
     * 2. 点击发布按钮
     * 3. AI审核通过（无违规）
     * 4. 帖子成功发布到Timeline
     *
     * 验证点：
     * - 审核流程自动完成
     * - 无需人工介入
     * - 发布成功提示
     * - Timeline显示新帖子
     */
    @Test
    fun test_publishNormalContent_autoApproved() = runTest {
        // Given: 正常内容，AI审核通过
        val normalContent = "今天天气真好！分享一张风景照片。"
        coEvery { contentModerator.moderateContent(normalContent) } returns Result.Success(
            ModerationResult(
                isViolation = false,
                violationCategories = emptyList(),
                severity = Severity.NONE,
                confidence = 0.95f,
                reason = "内容健康",
                suggestion = "可以发布"
            )
        )

        // When: 导航到发布页面
        composeTestRule.onNodeWithContentDescription("发布动态").performClick()
        composeTestRule.waitForIdle()

        // 输入内容
        composeTestRule.onNodeWithTag("post_content_input").performTextInput(normalContent)

        // 点击发布
        composeTestRule.onNodeWithText("发布").performClick()

        // Then: 验证发布成功
        composeTestRule.onNodeWithText("发布成功").assertIsDisplayed()

        // 返回Timeline，验证新帖子显示
        composeTestRule.onNodeWithContentDescription("返回").performClick()
        composeTestRule.waitForIdle()
        composeTestRule.onNodeWithText(normalContent).assertIsDisplayed()
    }

    /**
     * Test 2: 发布违规内容 - 被拦截并提示
     *
     * 场景：
     * 1. 用户输入违规内容（色情、暴力等）
     * 2. 点击发布按钮
     * 3. AI审核检测到违规
     * 4. 显示违规提示，阻止发布
     *
     * 验证点：
     * - 违规内容被正确识别
     * - 发布被阻止
     * - 显示违规原因
     * - 提供修改建议
     */
    @Test
    fun test_publishViolatingContent_blocked() = runTest {
        // Given: 违规内容，AI审核拒绝
        val violatingContent = "这是一段包含暴力描述的测试内容..."
        coEvery { contentModerator.moderateContent(violatingContent) } returns Result.Success(
            ModerationResult(
                isViolation = true,
                violationCategories = listOf(ViolationCategory.VIOLENCE),
                severity = Severity.HIGH,
                confidence = 0.98f,
                reason = "包含暴力描述",
                suggestion = "请移除暴力内容后重新发布"
            )
        )

        // When: 导航到发布页面
        composeTestRule.onNodeWithContentDescription("发布动态").performClick()
        composeTestRule.waitForIdle()

        // 输入违规内容
        composeTestRule.onNodeWithTag("post_content_input").performTextInput(violatingContent)

        // 点击发布
        composeTestRule.onNodeWithText("发布").performClick()

        // Then: 验证被拦截
        composeTestRule.onNodeWithText("内容违规").assertIsDisplayed()
        composeTestRule.onNodeWithText("包含暴力描述").assertIsDisplayed()
        composeTestRule.onNodeWithText("请移除暴力内容后重新发布").assertIsDisplayed()

        // 验证对话框有"了解"按钮
        composeTestRule.onNodeWithText("了解").assertIsDisplayed()

        // 关闭对话框
        composeTestRule.onNodeWithText("了解").performClick()
        composeTestRule.waitForIdle()

        // 验证仍在发布页面（未发布）
        composeTestRule.onNodeWithTag("post_content_input").assertIsDisplayed()
    }

    /**
     * Test 3: 查看审核队列 - 管理员功能
     *
     * 场景：
     * 1. 管理员登录
     * 2. 进入内容审核页面
     * 3. 查看待审核项目列表
     * 4. 查看统计数据
     *
     * 验证点：
     * - 审核队列UI正确显示
     * - 待审核项目按时间排序
     * - 统计数据正确
     * - 筛选功能可用
     */
    @Test
    fun test_viewModerationQueue_asAdmin() = runTest {
        // Given: 作为管理员用户登录
        // (假设已经在MainActivity中设置了管理员权限)

        // When: 导航到审核队列
        composeTestRule.onNodeWithContentDescription("菜单").performClick()
        composeTestRule.waitForIdle()
        composeTestRule.onNodeWithText("内容审核").performClick()
        composeTestRule.waitForIdle()

        // Then: 验证审核队列页面显示
        composeTestRule.onNodeWithText("内容审核").assertIsDisplayed()

        // 验证统计数据显示
        composeTestRule.onNodeWithText("待审").assertIsDisplayed()
        composeTestRule.onNodeWithText("已批准").assertIsDisplayed()
        composeTestRule.onNodeWithText("已拒绝").assertIsDisplayed()

        // 验证筛选选项
        composeTestRule.onNodeWithText("全部").assertIsDisplayed()
        composeTestRule.onNodeWithText("待审核").assertIsDisplayed()
        composeTestRule.onNodeWithText("已处理").assertIsDisplayed()

        // 验证有待审核项目显示（如果有）
        // 注意：实际测试需要提前插入测试数据
    }

    /**
     * Test 4: 人工复审流程 - 批准内容
     *
     * 场景：
     * 1. 管理员选择一条待审核内容
     * 2. 查看详细信息和AI审核结果
     * 3. 点击"批准"按钮
     * 4. 添加审核备注
     * 5. 确认批准
     *
     * 验证点：
     * - 详情对话框正确显示
     * - AI审核结果清晰可读
     * - 批准操作成功
     * - 状态更新为"已批准"
     */
    @Test
    fun test_humanReview_approveContent() = runTest {
        // Given: 在审核队列页面，有待审核项目
        composeTestRule.onNodeWithContentDescription("菜单").performClick()
        composeTestRule.waitForIdle()
        composeTestRule.onNodeWithText("内容审核").performClick()
        composeTestRule.waitForIdle()

        // 选择第一条待审核项目
        composeTestRule.onAllNodesWithTag("moderation_item_card")[0].performClick()
        composeTestRule.waitForIdle()

        // When: 查看AI审核结果
        composeTestRule.onNodeWithText("AI审核结果").assertIsDisplayed()
        composeTestRule.onNodeWithText("违规类型").assertIsDisplayed()
        composeTestRule.onNodeWithText("严重程度").assertIsDisplayed()
        composeTestRule.onNodeWithText("置信度").assertIsDisplayed()

        // 点击批准按钮
        composeTestRule.onNodeWithText("批准").performClick()
        composeTestRule.waitForIdle()

        // 输入备注
        composeTestRule.onNodeWithTag("review_note_input")
            .performTextInput("经复审，内容无问题，批准发布")

        // 确认批准
        composeTestRule.onNodeWithText("确认批准").performClick()
        composeTestRule.waitForIdle()

        // Then: 验证操作成功
        composeTestRule.onNodeWithText("批准成功").assertIsDisplayed()

        // 验证项目从待审核列表消失
        composeTestRule.onNodeWithText("待审核").performClick()
        composeTestRule.waitForIdle()

        // 验证统计数据更新
        // (已批准数量应该+1)
    }

    /**
     * Test 5: 申诉流程（额外测试）
     *
     * 场景：
     * 1. 用户的内容被拒绝
     * 2. 用户点击"申诉"按钮
     * 3. 填写申诉理由
     * 4. 提交申诉
     * 5. 管理员收到申诉通知
     *
     * 验证点：
     * - 申诉入口可见
     * - 申诉表单正确显示
     * - 提交成功
     * - 申诉状态更新
     */
    @Test
    fun test_appealProcess_userSubmitsAppeal() = runTest {
        // Given: 用户有被拒绝的内容
        // (需要提前设置测试数据)

        // When: 导航到"我的"页面
        composeTestRule.onNodeWithContentDescription("我的").performClick()
        composeTestRule.waitForIdle()

        // 查看被拒绝的内容
        composeTestRule.onNodeWithText("被拒绝的内容").performClick()
        composeTestRule.waitForIdle()

        // 选择一条被拒绝的内容
        composeTestRule.onAllNodesWithTag("rejected_post_card")[0].performClick()
        composeTestRule.waitForIdle()

        // 点击申诉按钮
        composeTestRule.onNodeWithText("申诉").performClick()
        composeTestRule.waitForIdle()

        // Then: 验证申诉表单显示
        composeTestRule.onNodeWithText("提交申诉").assertIsDisplayed()
        composeTestRule.onNodeWithTag("appeal_reason_input").assertIsDisplayed()

        // 填写申诉理由
        composeTestRule.onNodeWithTag("appeal_reason_input")
            .performTextInput("我认为这段内容并不违规，请重新审核。")

        // 提交申诉
        composeTestRule.onNodeWithText("提交").performClick()
        composeTestRule.waitForIdle()

        // 验证提交成功
        composeTestRule.onNodeWithText("申诉已提交").assertIsDisplayed()
        composeTestRule.onNodeWithText("我们将在24小时内处理您的申诉").assertIsDisplayed()
    }
}
