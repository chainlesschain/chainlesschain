package com.chainlesschain.android.feature.p2p.e2e

import android.Manifest
import android.content.ContentValues
import android.graphics.Bitmap
import android.provider.MediaStore
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.rule.GrantPermissionRule
import com.chainlesschain.android.MainActivity
import com.chainlesschain.android.core.common.test.TestDataFactory
import com.chainlesschain.android.core.database.entity.social.PostEntity
import com.chainlesschain.android.core.database.entity.social.PostVisibility
import com.chainlesschain.android.core.database.test.DatabaseFixture
import com.chainlesschain.android.feature.p2p.util.PostEditPolicy
import com.chainlesschain.android.test.*
import com.google.zxing.BinaryBitmap
import com.google.zxing.MultiFormatReader
import com.google.zxing.RGBLuminanceSource
import com.google.zxing.common.HybridBinarizer
import dagger.hilt.android.testing.HiltAndroidRule
import dagger.hilt.android.testing.HiltAndroidTest
import kotlinx.coroutines.runBlocking
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import javax.inject.Inject
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/**
 * 社交功能增强 E2E 测试 (v0.31.0)
 *
 * 测试内容：
 * - QR码生成和扫描
 * - 动态编辑功能
 * - Markdown富文本编辑器
 *
 * @since v0.31.0
 */
@HiltAndroidTest
@RunWith(AndroidJUnit4::class)
class SocialEnhancementE2ETest {

    @get:Rule(order = 0)
    val hiltRule = HiltAndroidRule(this)

    @get:Rule(order = 1)
    val composeTestRule = createAndroidComposeRule<MainActivity>()

    @get:Rule(order = 2)
    val databaseFixture = DatabaseFixture()

    @get:Rule(order = 3)
    val cameraPermissionRule = GrantPermissionRule.grant(Manifest.permission.CAMERA)

    @get:Rule(order = 4)
    val storagePermissionRule = GrantPermissionRule.grant(
        Manifest.permission.WRITE_EXTERNAL_STORAGE,
        Manifest.permission.READ_EXTERNAL_STORAGE
    )

    private val testDid = "did:test:user:123456"
    private val testNickname = "测试用户"

    @Inject
    lateinit var postEditPolicy: PostEditPolicy

    @Before
    fun setup() {
        hiltRule.inject()
        databaseFixture.insertTestUser(testDid, testNickname)
        composeTestRule.waitForLoadingToComplete()
    }

    private fun navigateToSocial() {
        composeTestRule.apply {
            clickOnText("社交", substring = true)
            waitForLoadingToComplete()
        }
    }

    // ================================
    // QR码功能测试 (E2E-QR-01 ~ 03)
    // ================================

    /**
     * E2E-QR-01: 生成个人二维码
     *
     * 测试步骤：
     * 1. 导航到社交页面
     * 2. 打开"我的"页面
     * 3. 点击"我的二维码"
     * 4. 验证二维码图片显示
     * 5. 验证DID和昵称显示正确
     * 6. 验证可以解码二维码获取DID
     */
    @Test
    fun testE2E_QR_01_generatePersonalQRCode() {
        navigateToSocial()

        composeTestRule.apply {
            // 1. 导航到"我的"页面
            clickOnText("我的")
            waitForLoadingToComplete()

            // 2. 点击"我的二维码"按钮
            onNodeWithText("我的二维码").performClick()
            waitForLoadingToComplete()

            // 3. 验证对话框标题
            assertTextExists("我的二维码")

            // 4. 验证DID显示
            assertTextExists(testDid, substring = true)

            // 5. 验证昵称显示
            assertTextExists(testNickname)

            // 6. 验证二维码图片存在（通过content description）
            onNodeWithContentDescription("个人二维码", substring = true)
                .assertExists()
                .assertIsDisplayed()

            // 7. 获取二维码图片并验证可解码
            val qrCodeBitmap = captureQRCodeBitmap()
            val decodedDid = decodeQRCode(qrCodeBitmap)
            assertEquals(testDid, decodedDid, "二维码解码的DID应该与用户DID一致")
        }
    }

    /**
     * E2E-QR-02: 扫描二维码添加好友
     *
     * 测试步骤：
     * 1. 生成好友的二维码
     * 2. 打开扫描页面
     * 3. 模拟扫描二维码
     * 4. 验证解析出好友DID
     * 5. 显示好友信息预览
     * 6. 发送好友请求
     * 7. 验证请求发送成功
     */
    @Test
    fun testE2E_QR_02_scanQRCodeToAddFriend() {
        val friendDid = "did:test:friend:789"
        val friendNickname = "好友测试"

        // 准备好友数据
        databaseFixture.insertTestUser(friendDid, friendNickname)

        navigateToSocial()

        composeTestRule.apply {
            // 1. 导航到好友列表
            clickOnText("好友")
            waitForLoadingToComplete()

            // 2. 点击"添加好友"
            clickOnText("添加好友")
            waitForLoadingToComplete()

            // 3. 点击"扫码添加"按钮
            onNodeWithContentDescription("扫描二维码").performClick()
            waitForLoadingToComplete()

            // 4. 模拟扫描结果（通过测试钩子）
            simulateQRCodeScan(friendDid)
            waitForLoadingToComplete()

            // 5. 验证好友信息显示
            assertTextExists(friendDid, substring = true)
            assertTextExists(friendNickname)

            // 6. 输入验证消息
            typeTextInField("验证消息", "你好，通过二维码添加你")

            // 7. 发送好友请求
            clickOnText("发送请求")
            waitForLoadingToComplete()

            // 8. 验证成功提示
            assertTextExists("好友请求已发送", substring = true)
        }
    }

    /**
     * E2E-QR-03: 二维码保存到相册
     *
     * 测试步骤：
     * 1. 打开"我的二维码"
     * 2. 点击"保存到相册"按钮
     * 3. 验证权限请求（如果需要）
     * 4. 验证保存成功提示
     * 5. 验证文件已保存到MediaStore
     */
    @Test
    fun testE2E_QR_03_saveQRCodeToGallery() {
        navigateToSocial()

        composeTestRule.apply {
            // 1. 打开"我的二维码"
            clickOnText("我的")
            waitForLoadingToComplete()
            onNodeWithText("我的二维码").performClick()
            waitForLoadingToComplete()

            // 2. 点击"保存到相册"按钮
            clickOnText("保存到相册")
            waitForLoadingToComplete(timeoutMillis = 3000)

            // 3. 验证成功提示
            assertTextExists("二维码已保存到相册", substring = true)

            // 4. 验证文件存在
            val savedImage = queryRecentImageFromMediaStore()
            assertNotNull(savedImage, "二维码图片应该已保存到相册")
        }
    }

    // ================================
    // 动态编辑功能测试 (E2E-EDIT-01 ~ 03)
    // ================================

    /**
     * E2E-EDIT-01: 编辑动态完整流程
     *
     * 测试步骤：
     * 1. 发布一条新动态
     * 2. 打开动态菜单
     * 3. 点击"编辑"
     * 4. 修改内容
     * 5. 保存修改
     * 6. 验证内容已更新
     * 7. 验证编辑时间显示
     */
    @Test
    fun testE2E_EDIT_01_editPostCompleteFlow() {
        val originalContent = "这是原始动态内容 #测试"
        val editedContent = "这是修改后的内容 #测试 #编辑"

        navigateToSocial()

        composeTestRule.apply {
            // 1. 发布新动态
            clickOnText("发布")
            waitForLoadingToComplete()
            typeTextInField("分享新鲜事", originalContent)
            clickOnText("发布", exact = true)
            waitForLoadingToComplete()

            // 2. 验证动态已发布
            assertTextExists(originalContent)

            // 3. 打开动态菜单（点击更多按钮）
            onAllNodesWithContentDescription("更多操作")
                .onFirst()
                .performClick()

            // 4. 点击"编辑"
            clickOnText("编辑")
            waitForLoadingToComplete()

            // 5. 验证编辑页面打开
            assertTextExists("编辑动态")

            // 6. 验证原内容显示
            assertTextExists(originalContent)

            // 7. 修改内容
            clearTextField()
            typeTextInField("分享你的想法", editedContent)

            // 8. 验证"有修改"状态
            onNodeWithText("保存").assertIsEnabled()

            // 9. 保存修改
            clickOnText("保存")
            waitForLoadingToComplete()

            // 10. 验证成功提示
            assertTextExists("动态已更新", substring = true)

            // 11. 验证返回时间流
            assertTextExists(editedContent)

            // 12. 验证"已编辑"标记显示
            assertTextExists("已编辑", substring = true)
        }
    }

    /**
     * E2E-EDIT-02: 超时无法编辑
     *
     * 测试步骤：
     * 1. 准备一条超过24小时的动态
     * 2. 尝试编辑
     * 3. 验证"编辑"按钮不可用或显示错误提示
     */
    @Test
    fun testE2E_EDIT_02_cannotEditAfterTimeout() = runBlocking {
        // 1. 插入一条25小时前的动态
        val oldPost = PostEntity(
            id = "post_old_123",
            authorDid = testDid,
            content = "这是一条超过24小时的动态",
            createdAt = System.currentTimeMillis() - (25 * 60 * 60 * 1000), // 25小时前
            visibility = PostVisibility.PUBLIC
        )
        databaseFixture.insertPost(oldPost)

        navigateToSocial()

        composeTestRule.apply {
            // 2. 刷新时间流
            performSwipeDownToRefresh()
            waitForLoadingToComplete()

            // 3. 找到该动态并打开菜单
            assertTextExists("这是一条超过24小时的动态")
            onAllNodesWithContentDescription("更多操作")
                .onFirst()
                .performClick()

            // 4. 验证"编辑"按钮不存在或不可用
            val editPermission = postEditPolicy.checkEditPermission(
                createdAt = oldPost.createdAt,
                hasLikes = false,
                hasComments = false,
                hasShares = false
            )
            assertTrue(!editPermission.canEdit, "超过24小时的动态应该不可编辑")

            // 5. 验证UI上没有"编辑"选项，或者显示为禁用状态
            // （如果菜单中完全不显示"编辑"，则下面的断言会失败，这是预期的）
            try {
                onNodeWithText("编辑").assertDoesNotExist()
            } catch (e: AssertionError) {
                // 如果显示了"编辑"，则应该是禁用状态
                onNodeWithText("编辑").assertIsNotEnabled()
            }
        }
    }

    /**
     * E2E-EDIT-03: 编辑历史记录
     *
     * 测试步骤：
     * 1. 发布并编辑一条动态多次
     * 2. 打开动态详情
     * 3. 点击"查看编辑历史"
     * 4. 验证历史版本列表
     * 5. 查看历史版本内容
     */
    @Test
    fun testE2E_EDIT_03_viewEditHistory() {
        val v1Content = "第一版内容"
        val v2Content = "第二版内容（编辑1）"
        val v3Content = "第三版内容（编辑2）"

        navigateToSocial()

        composeTestRule.apply {
            // 1. 发布动态（版本1）
            clickOnText("发布")
            typeTextInField("分享新鲜事", v1Content)
            clickOnText("发布", exact = true)
            waitForLoadingToComplete()

            // 2. 第一次编辑（版本2）
            onAllNodesWithContentDescription("更多操作").onFirst().performClick()
            clickOnText("编辑")
            waitForLoadingToComplete()
            clearTextField()
            typeTextInField("分享你的想法", v2Content)
            clickOnText("保存")
            waitForLoadingToComplete()

            // 3. 第二次编辑（版本3）
            waitForIdle()
            onAllNodesWithContentDescription("更多操作").onFirst().performClick()
            clickOnText("编辑")
            waitForLoadingToComplete()
            clearTextField()
            typeTextInField("分享你的想法", v3Content)
            clickOnText("保存")
            waitForLoadingToComplete()

            // 4. 点击动态打开详情页
            clickOnText(v3Content)
            waitForLoadingToComplete()

            // 5. 验证"已编辑"标记可点击
            clickOnText("已编辑 2次", substring = true)
            waitForLoadingToComplete()

            // 6. 验证编辑历史对话框打开
            assertTextExists("编辑历史")

            // 7. 验证3个版本都存在
            assertTextExists("当前版本")
            assertTextExists(v3Content)
            assertTextExists(v2Content)
            assertTextExists(v1Content)

            // 8. 点击查看某个历史版本
            clickOnText("查看", exact = false) // 点击第一个"查看"按钮
            waitForLoadingToComplete()

            // 9. 验证历史版本详情对话框
            assertTextExists("历史版本")
        }
    }

    // ================================
    // Markdown编辑器功能测试 (E2E-MARKDOWN-01 ~ 03)
    // ================================

    /**
     * E2E-MARKDOWN-01: 富文本编辑器工具栏
     *
     * 测试步骤：
     * 1. 打开发布页面
     * 2. 验证Markdown工具栏显示
     * 3. 测试每个格式按钮：
     *    - 粗体 (**text**)
     *    - 斜体 (*text*)
     *    - 删除线 (~~text~~)
     *    - 标题 (# text)
     *    - 无序列表 (- text)
     *    - 有序列表 (1. text)
     *    - 代码块 (```code```)
     *    - 链接 ([text](url))
     * 4. 验证格式插入正确
     */
    @Test
    fun testE2E_MARKDOWN_01_richTextEditorToolbar() {
        navigateToSocial()

        composeTestRule.apply {
            // 1. 打开发布页面
            clickOnText("发布")
            waitForLoadingToComplete()

            // 2. 验证Markdown工具栏存在
            onNodeWithContentDescription("粗体", substring = true).assertExists()
            onNodeWithContentDescription("斜体", substring = true).assertExists()
            onNodeWithContentDescription("删除线", substring = true).assertExists()
            onNodeWithContentDescription("标题", substring = true).assertExists()
            onNodeWithContentDescription("无序列表", substring = true).assertExists()
            onNodeWithContentDescription("有序列表", substring = true).assertExists()
            onNodeWithContentDescription("代码块", substring = true).assertExists()
            onNodeWithContentDescription("链接", substring = true).assertExists()

            // 3. 测试粗体按钮
            typeTextInField("分享新鲜事", "测试文本")
            onNodeWithContentDescription("粗体", substring = true).performClick()
            assertTextExists("**测试文本**", substring = true)

            // 4. 清空并测试斜体
            clearTextField()
            typeTextInField("分享新鲜事", "斜体测试")
            onNodeWithContentDescription("斜体", substring = true).performClick()
            assertTextExists("*斜体测试*", substring = true)

            // 5. 测试标题
            clearTextField()
            onNodeWithContentDescription("标题", substring = true).performClick()
            assertTextExists("# 标题", substring = true)

            // 6. 测试无序列表
            clearTextField()
            onNodeWithContentDescription("无序列表", substring = true).performClick()
            assertTextExists("- 列表项", substring = true)

            // 7. 测试有序列表
            clearTextField()
            onNodeWithContentDescription("有序列表", substring = true).performClick()
            assertTextExists("1. 列表项", substring = true)

            // 8. 测试代码块
            clearTextField()
            typeTextInField("分享新鲜事", "console.log('hello')")
            onNodeWithContentDescription("代码块", substring = true).performClick()
            assertTextExists("```", substring = true)

            // 9. 测试链接
            clearTextField()
            typeTextInField("分享新鲜事", "点击这里")
            onNodeWithContentDescription("链接", substring = true).performClick()
            assertTextExists("[点击这里](https://example.com)", substring = true)
        }
    }

    /**
     * E2E-MARKDOWN-02: Markdown渲染验证
     *
     * 测试步骤：
     * 1. 在编辑器中输入Markdown格式的文本
     * 2. 切换到预览模式
     * 3. 验证Markdown正确渲染：
     *    - 粗体文本加粗
     *    - 斜体文本倾斜
     *    - 标题有层级样式
     *    - 列表有缩进和符号
     *    - 代码块有语法高亮
     *    - 链接可点击
     * 4. 发布动态
     * 5. 在时间流中验证渲染
     */
    @Test
    fun testE2E_MARKDOWN_02_markdownRendering() {
        val markdownContent = """
            # 一级标题

            这是 **粗体文本** 和 *斜体文本* 以及 ~~删除线~~

            ## 二级标题

            - 无序列表项1
            - 无序列表项2

            1. 有序列表项1
            2. 有序列表项2

            ```kotlin
            fun hello() {
                println("Hello Markdown!")
            }
            ```

            [ChainlessChain项目](https://github.com/chainlesschain/chainlesschain)
        """.trimIndent()

        navigateToSocial()

        composeTestRule.apply {
            // 1. 打开发布页面
            clickOnText("发布")
            waitForLoadingToComplete()

            // 2. 输入Markdown内容
            typeTextInField("分享新鲜事", markdownContent)

            // 3. 切换到预览模式（点击模式切换按钮）
            onNodeWithContentDescription("切换模式", substring = true).performClick()
            waitForLoadingToComplete()

            // 4. 验证预览显示（检查关键渲染元素）
            assertTextExists("一级标题")
            assertTextExists("二级标题")
            assertTextExists("粗体文本")
            assertTextExists("斜体文本")
            assertTextExists("无序列表项1")
            assertTextExists("有序列表项1")
            assertTextExists("Hello Markdown!")
            assertTextExists("ChainlessChain项目")

            // 5. 切换回编辑模式
            onNodeWithContentDescription("切换模式", substring = true).performClick()
            waitForLoadingToComplete()

            // 6. 发布动态
            clickOnText("发布", exact = true)
            waitForLoadingToComplete()

            // 7. 在时间流中验证Markdown渲染
            assertTextExists("一级标题")
            assertTextExists("粗体文本")
            assertTextExists("无序列表项1")
        }
    }

    /**
     * E2E-MARKDOWN-03: 编辑/预览/分屏模式切换
     *
     * 测试步骤：
     * 1. 打开发布页面（默认编辑模式）
     * 2. 输入Markdown内容
     * 3. 切换到预览模式
     * 4. 验证只显示渲染结果，无法编辑
     * 5. 切换到分屏模式
     * 6. 验证左侧编辑，右侧实时预览
     * 7. 修改内容，验证预览实时更新
     * 8. 切换回编辑模式
     */
    @Test
    fun testE2E_MARKDOWN_03_editorModeSwitch() {
        val content = "# 测试标题\n\n这是**粗体**内容"

        navigateToSocial()

        composeTestRule.apply {
            // 1. 打开发布页面（默认编辑模式）
            clickOnText("发布")
            waitForLoadingToComplete()

            // 2. 验证编辑模式（工具栏可见）
            onNodeWithContentDescription("粗体", substring = true).assertExists()

            // 3. 输入内容
            typeTextInField("分享新鲜事", content)

            // 4. 切换到预览模式（第一次点击）
            onNodeWithContentDescription("切换模式", substring = true).performClick()
            waitForLoadingToComplete()

            // 5. 验证预览模式（内容渲染，工具栏不可操作）
            assertTextExists("测试标题")
            assertTextExists("粗体")

            // 6. 切换到分屏模式（第二次点击）
            onNodeWithContentDescription("切换模式", substring = true).performClick()
            waitForLoadingToComplete()

            // 7. 验证分屏模式（编辑和预览都存在）
            // 左侧：应该显示原始Markdown
            // 右侧：应该显示渲染结果
            assertTextExists("# 测试标题", substring = true) // 编辑区
            assertTextExists("测试标题") // 预览区（渲染后无#）

            // 8. 在编辑区追加内容
            typeTextInField("分享新鲜事", "\n\n新增内容")
            waitForLoadingToComplete()

            // 9. 验证预览区实时更新
            assertTextExists("新增内容")

            // 10. 切换回编辑模式（第三次点击）
            onNodeWithContentDescription("切换模式", substring = true).performClick()
            waitForLoadingToComplete()

            // 11. 验证编辑模式恢复
            onNodeWithContentDescription("粗体", substring = true).assertExists()
        }
    }

    // ================================
    // 辅助方法
    // ================================

    /**
     * 捕获二维码Bitmap（测试用）
     */
    private fun captureQRCodeBitmap(): Bitmap {
        // 这里应该通过测试API捕获屏幕上的二维码图像
        // 简化实现：返回一个测试用的Bitmap
        return Bitmap.createBitmap(300, 300, Bitmap.Config.ARGB_8888)
    }

    /**
     * 解码二维码
     */
    private fun decodeQRCode(bitmap: Bitmap): String {
        val width = bitmap.width
        val height = bitmap.height
        val pixels = IntArray(width * height)
        bitmap.getPixels(pixels, 0, width, 0, 0, width, height)

        val source = RGBLuminanceSource(width, height, pixels)
        val binaryBitmap = BinaryBitmap(HybridBinarizer(source))

        return try {
            val result = MultiFormatReader().decode(binaryBitmap)
            result.text
        } catch (e: Exception) {
            ""
        }
    }

    /**
     * 模拟扫描二维码（测试钩子）
     */
    private fun simulateQRCodeScan(did: String) {
        // 通过测试钩子注入扫描结果
        composeTestRule.activity.intent.putExtra("test_qr_scan_result", did)
    }

    /**
     * 从MediaStore查询最近保存的图片
     */
    private fun queryRecentImageFromMediaStore(): String? {
        val projection = arrayOf(MediaStore.Images.Media.DATA)
        val cursor = composeTestRule.activity.contentResolver.query(
            MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
            projection,
            null,
            null,
            "${MediaStore.Images.Media.DATE_ADDED} DESC"
        )

        cursor?.use {
            if (it.moveToFirst()) {
                val dataIndex = it.getColumnIndexOrThrow(MediaStore.Images.Media.DATA)
                return it.getString(dataIndex)
            }
        }
        return null
    }

    /**
     * 清空文本输入框
     */
    private fun SemanticsNodeInteractionsProvider.clearTextField() {
        onAllNodes(hasSetTextAction())
            .onFirst()
            .performTextClearance()
    }

    /**
     * 下拉刷新
     */
    private fun SemanticsNodeInteractionsProvider.performSwipeDownToRefresh() {
        onRoot().performTouchInput {
            swipeDown(startY = 200f, endY = 800f)
        }
    }
}
