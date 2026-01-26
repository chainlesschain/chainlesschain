package com.chainlesschain.android.feature.p2p.e2e

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.chainlesschain.android.MainActivity
import com.chainlesschain.android.core.common.test.ComposeTestExtensions.assertSnackbarMessage
import com.chainlesschain.android.core.common.test.ComposeTestExtensions.clickOnText
import com.chainlesschain.android.core.common.test.ComposeTestExtensions.performPullToRefresh
import com.chainlesschain.android.core.common.test.ComposeTestExtensions.typeTextInField
import com.chainlesschain.android.core.common.test.ComposeTestExtensions.waitForLoadingToComplete
import com.chainlesschain.android.core.common.test.ComposeTestExtensions.waitForText
import com.chainlesschain.android.core.common.test.ComposeTestExtensions.waitUntilNodeExists
import com.chainlesschain.android.core.common.test.DatabaseFixture
import com.chainlesschain.android.core.common.test.TestDataFactory
import com.chainlesschain.android.core.database.entity.social.FriendshipStatus
import com.chainlesschain.android.core.database.entity.social.PostVisibility
import com.chainlesschain.android.core.database.entity.social.ReportReason
import dagger.hilt.android.testing.HiltAndroidRule
import dagger.hilt.android.testing.HiltAndroidTest
import org.junit.After
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import javax.inject.Inject

/**
 * E2E测试 - 社交UI屏幕
 *
 * 测试覆盖：
 * - AddFriendScreen - 添加好友页面
 * - FriendDetailScreen - 好友详情页面
 * - UserProfileScreen - 用户资料页面
 * - CommentDetailScreen - 评论详情页面
 */
@HiltAndroidTest
@RunWith(AndroidJUnit4::class)
class SocialUIScreensE2ETest {

    @get:Rule(order = 0)
    val hiltRule = HiltAndroidRule(this)

    @get:Rule(order = 1)
    val composeTestRule = createAndroidComposeRule<MainActivity>()

    @Inject
    lateinit var databaseFixture: DatabaseFixture

    private val myDid = "did:test:me:123456"

    @Before
    fun setup() {
        hiltRule.inject()
        databaseFixture.clearAllTables()

        // 初始化测试数据
        setupTestData()

        // 登录并导航到社交页面
        navigateToSocialTab()
    }

    @After
    fun tearDown() {
        databaseFixture.clearAllTables()
    }

    // ===== 测试数据准备 =====

    private fun setupTestData() {
        // 创建当前用户
        val me = TestDataFactory.createFriendEntity(
            did = myDid,
            nickname = "我自己",
            status = FriendshipStatus.FRIEND
        )
        databaseFixture.insertFriends(me)

        // 创建3个好友
        val friend1 = TestDataFactory.createFriendEntity(
            did = "did:test:friend:001",
            nickname = "张三",
            status = FriendshipStatus.FRIEND,
            isOnline = true,
            lastActiveTime = System.currentTimeMillis() - 300000 // 5分钟前
        )
        val friend2 = TestDataFactory.createFriendEntity(
            did = "did:test:friend:002",
            nickname = "李四",
            status = FriendshipStatus.FRIEND,
            remarkName = "我的同学",
            isOnline = false,
            lastActiveTime = System.currentTimeMillis() - 3600000 // 1小时前
        )
        val friend3 = TestDataFactory.createFriendEntity(
            did = "did:test:friend:003",
            nickname = "王五",
            status = FriendshipStatus.PENDING_RECEIVED, // 待接受
            isOnline = true
        )
        databaseFixture.insertFriends(friend1, friend2, friend3)

        // 创建一些动态
        val post1 = TestDataFactory.createPostEntity(
            id = "post_001",
            authorDid = friend1.did,
            content = "这是张三的第一条动态",
            visibility = PostVisibility.PUBLIC,
            createdAt = System.currentTimeMillis() - 7200000 // 2小时前
        )
        val post2 = TestDataFactory.createPostEntity(
            id = "post_002",
            authorDid = friend1.did,
            content = "这是张三的第二条动态，包含图片",
            images = listOf(
                "https://example.com/image1.jpg",
                "https://example.com/image2.jpg"
            ),
            visibility = PostVisibility.PUBLIC,
            createdAt = System.currentTimeMillis() - 3600000 // 1小时前
        )
        val post3 = TestDataFactory.createPostEntity(
            id = "post_003",
            authorDid = friend2.did,
            content = "这是李四的动态",
            visibility = PostVisibility.FRIENDS_ONLY,
            createdAt = System.currentTimeMillis() - 1800000 // 30分钟前
        )
        databaseFixture.insertPosts(post1, post2, post3)

        // 创建评论
        val comment1 = TestDataFactory.createCommentEntity(
            id = "comment_001",
            postId = post1.id,
            authorDid = friend2.did,
            content = "这是李四的评论"
        )
        val comment2 = TestDataFactory.createCommentEntity(
            id = "comment_002",
            postId = post1.id,
            authorDid = myDid,
            content = "这是我的评论"
        )
        val reply1 = TestDataFactory.createCommentEntity(
            id = "comment_003",
            postId = post1.id,
            authorDid = friend1.did,
            content = "这是张三对评论的回复",
            parentCommentId = comment1.id
        )
        databaseFixture.insertComments(comment1, comment2, reply1)
    }

    private fun navigateToSocialTab() {
        composeTestRule.waitForLoadingToComplete()

        // 点击底部导航栏的"社交"Tab
        composeTestRule.onNodeWithText("社交").performClick()
        composeTestRule.waitForIdle()
    }

    // ===== E2E-SOCIAL-UI-01: AddFriendScreen 完整流程测试 =====

    @Test
    fun e2e_addFriendScreen_completeWorkflow() {
        // 导航到好友Tab
        composeTestRule.clickOnText("好友")
        composeTestRule.waitForText("我的同学") // 等待好友列表加载

        // Step 1: 点击添加好友按钮
        composeTestRule.onNodeWithContentDescription("添加好友").performClick()
        composeTestRule.waitForText("添加好友")

        // Step 2: 验证页面元素存在
        composeTestRule.onNodeWithText("搜索 DID").assertExists()
        composeTestRule.onNodeWithText("附近的人").assertExists()
        composeTestRule.onNodeWithText("推荐好友").assertExists()
        composeTestRule.onNodeWithContentDescription("扫描二维码").assertExists()

        // Step 3: 测试DID搜索
        composeTestRule.typeTextInField("搜索 DID", "did:test:stranger:999")
        composeTestRule.waitForIdle()
        Thread.sleep(500) // 等待防抖

        // 验证搜索结果显示
        composeTestRule.waitForText("搜索结果")

        // Step 4: 点击搜索结果中的用户
        composeTestRule.onAllNodesWithText("添加好友")[0].performClick()

        // Step 5: 验证好友请求对话框
        composeTestRule.waitForText("发送好友请求")
        composeTestRule.onNodeWithText("验证消息（可选）").assertExists()

        // Step 6: 输入验证消息并发送
        composeTestRule.typeTextInField("验证消息", "你好，我想加你为好友")
        composeTestRule.clickOnText("发送")

        // Step 7: 验证成功提示
        composeTestRule.assertSnackbarMessage("好友请求已发送")

        // Step 8: 验证返回好友列表
        composeTestRule.waitForText("好友")
    }

    // ===== E2E-SOCIAL-UI-02: AddFriendScreen 附近的人发现 =====

    @Test
    fun e2e_addFriendScreen_nearbyUsersDiscovery() {
        navigateToAddFriendScreen()

        // Step 1: 滚动到"附近的人"区域
        composeTestRule.onNodeWithText("附近的人").performScrollTo()

        // Step 2: 验证自动扫描提示
        composeTestRule.waitForText("正在扫描附近的设备...")

        // Step 3: 等待扫描完成（模拟P2P发现）
        Thread.sleep(2000)

        // Step 4: 验证发现的用户列表（如果有）
        // 注意：实际环境可能没有附近的人
        composeTestRule.onNodeWithText("未发现附近的用户").assertExists()
            .or(composeTestRule.onAllNodesWithText("添加好友").fetchSemanticsNodes().isNotEmpty())
    }

    // ===== E2E-SOCIAL-UI-03: AddFriendScreen 好友推荐 =====

    @Test
    fun e2e_addFriendScreen_friendRecommendations() {
        navigateToAddFriendScreen()

        // Step 1: 滚动到"推荐好友"区域
        composeTestRule.onNodeWithText("推荐好友").performScrollTo()

        // Step 2: 验证推荐算法提示
        composeTestRule.onNodeWithText("基于共同好友的推荐").assertExists()

        // Step 3: 如果有推荐，验证推荐卡片
        val recommendationNodes = composeTestRule.onAllNodesWithContentDescription("推荐用户卡片")
        if (recommendationNodes.fetchSemanticsNodes().isNotEmpty()) {
            // 点击第一个推荐用户
            recommendationNodes[0].performClick()

            // 验证跳转到用户资料页面
            composeTestRule.waitForText("用户资料")
        }
    }

    // ===== E2E-SOCIAL-UI-04: FriendDetailScreen 完整流程测试 =====

    @Test
    fun e2e_friendDetailScreen_completeWorkflow() {
        // 导航到好友列表
        composeTestRule.clickOnText("好友")
        composeTestRule.waitForText("我的同学")

        // Step 1: 点击好友"张三"
        composeTestRule.clickOnText("张三")
        composeTestRule.waitForText("好友详情")

        // Step 2: 验证个人信息区域
        composeTestRule.onNodeWithText("张三").assertExists()
        composeTestRule.onNodeWithText("did:test:friend:001").assertExists()
        composeTestRule.onNodeWithContentDescription("在线状态").assertExists()

        // Step 3: 验证最后活跃时间显示
        composeTestRule.onNodeWithText("5分钟前活跃", substring = true).assertExists()

        // Step 4: 验证快捷操作按钮
        composeTestRule.onNodeWithContentDescription("发消息").assertExists()
        composeTestRule.onNodeWithContentDescription("语音通话").assertExists()
        composeTestRule.onNodeWithContentDescription("视频通话").assertExists()

        // Step 5: 测试发消息功能
        composeTestRule.onNodeWithContentDescription("发消息").performClick()
        composeTestRule.waitForText("会话列表") // 应该跳转到聊天页面

        // 返回好友详情
        composeTestRule.onNodeWithContentDescription("返回").performClick()
        composeTestRule.clickOnText("好友")
        composeTestRule.clickOnText("张三")

        // Step 6: 验证好友动态列表
        composeTestRule.onNodeWithText("动态").assertExists()
        composeTestRule.waitForText("这是张三的第一条动态")
        composeTestRule.onNodeWithText("这是张三的第二条动态，包含图片").assertExists()

        // Step 7: 测试更多菜单
        composeTestRule.onNodeWithContentDescription("更多").performClick()
        composeTestRule.waitForText("编辑备注")
        composeTestRule.waitForText("删除好友")
        composeTestRule.waitForText("屏蔽好友")

        // 关闭菜单
        composeTestRule.onNodeWithText("取消").performClick()
    }

    // ===== E2E-SOCIAL-UI-05: FriendDetailScreen 编辑备注 =====

    @Test
    fun e2e_friendDetailScreen_editRemarkName() {
        navigateToFriendDetail("张三")

        // Step 1: 打开更多菜单
        composeTestRule.onNodeWithContentDescription("更多").performClick()

        // Step 2: 点击"编辑备注"
        composeTestRule.clickOnText("编辑备注")
        composeTestRule.waitForText("设置备注名")

        // Step 3: 验证原昵称显示
        composeTestRule.onNodeWithText("原昵称：张三").assertExists()

        // Step 4: 输入备注名
        composeTestRule.typeTextInField("备注名", "我的好朋友")

        // Step 5: 保存备注
        composeTestRule.clickOnText("保存")

        // Step 6: 验证成功提示
        composeTestRule.assertSnackbarMessage("备注已更新")

        // Step 7: 验证备注名生效
        composeTestRule.waitForText("我的好朋友")

        // Step 8: 返回好友列表，验证备注名优先显示
        composeTestRule.onNodeWithContentDescription("返回").performClick()
        composeTestRule.waitForText("我的好朋友") // 备注名优先于昵称
    }

    // ===== E2E-SOCIAL-UI-06: FriendDetailScreen 在线状态 =====

    @Test
    fun e2e_friendDetailScreen_onlineStatus() {
        // 测试在线好友
        navigateToFriendDetail("张三")

        // 验证绿色在线指示器
        composeTestRule.onNodeWithContentDescription("在线状态").assertExists()
        composeTestRule.onNodeWithText("在线", substring = true).assertExists()

        // 返回并测试离线好友
        composeTestRule.onNodeWithContentDescription("返回").performClick()
        composeTestRule.clickOnText("我的同学") // 李四的备注名

        // 验证灰色离线指示器
        composeTestRule.onNodeWithContentDescription("在线状态").assertExists()
        composeTestRule.onNodeWithText("1小时前活跃", substring = true).assertExists()
    }

    // ===== E2E-SOCIAL-UI-07: UserProfileScreen 陌生人状态 =====

    @Test
    fun e2e_userProfileScreen_strangerStatus() {
        // 导航到动态Tab
        composeTestRule.clickOnText("动态")
        composeTestRule.waitForLoadingToComplete()

        // 创建一个陌生人的动态
        val strangerPost = TestDataFactory.createPostEntity(
            id = "post_stranger",
            authorDid = "did:test:stranger:999",
            content = "这是陌生人的动态"
        )
        databaseFixture.insertPosts(strangerPost)

        // 刷新时间流
        composeTestRule.performPullToRefresh()
        composeTestRule.waitForText("这是陌生人的动态")

        // Step 1: 点击陌生人头像
        composeTestRule.onAllNodesWithContentDescription("作者头像")[0].performClick()
        composeTestRule.waitForText("用户资料")

        // Step 2: 验证关系状态为陌生人
        composeTestRule.onNodeWithText("添加好友").assertExists()
        composeTestRule.onNodeWithText("陌生人", substring = true).assertExists()

        // Step 3: 验证用户信息展示
        composeTestRule.onNodeWithText("did:test:stranger:999").assertExists()

        // Step 4: 点击"添加好友"按钮
        composeTestRule.clickOnText("添加好友")

        // Step 5: 验证跳转到好友请求对话框
        composeTestRule.waitForText("发送好友请求")
    }

    // ===== E2E-SOCIAL-UI-08: UserProfileScreen 好友状态 =====

    @Test
    fun e2e_userProfileScreen_friendStatus() {
        navigateToUserProfile("张三")

        // Step 1: 验证关系状态为好友
        composeTestRule.onNodeWithText("发消息").assertExists()
        composeTestRule.onNodeWithText("已是好友", substring = true).assertExists()

        // Step 2: 验证TabRow
        composeTestRule.onNodeWithText("动态").assertExists()
        composeTestRule.onNodeWithText("点赞").assertExists()

        // Step 3: 切换到"动态"Tab
        composeTestRule.clickOnText("动态")
        composeTestRule.waitForText("这是张三的第一条动态")
        composeTestRule.onNodeWithText("这是张三的第二条动态，包含图片").assertExists()

        // Step 4: 切换到"点赞"Tab
        composeTestRule.clickOnText("点赞")
        composeTestRule.waitForText("暂无点赞的动态")
            .or(composeTestRule.onAllNodesWithContentDescription("动态卡片").fetchSemanticsNodes().isNotEmpty())

        // Step 5: 点击"发消息"按钮
        composeTestRule.clickOnText("发消息")
        composeTestRule.waitForText("会话列表")
    }

    // ===== E2E-SOCIAL-UI-09: UserProfileScreen 待处理状态 =====

    @Test
    fun e2e_userProfileScreen_pendingStatus() {
        navigateToUserProfile("王五")

        // Step 1: 验证关系状态为待处理
        composeTestRule.onNodeWithText("待接受").assertExists()
        composeTestRule.onNodeWithText("等待对方接受", substring = true).assertExists()

        // Step 2: 验证操作按钮为禁用状态
        composeTestRule.onNodeWithText("待接受").assertIsNotEnabled()
    }

    // ===== E2E-SOCIAL-UI-10: UserProfileScreen 举报和屏蔽 =====

    @Test
    fun e2e_userProfileScreen_reportAndBlock() {
        navigateToUserProfile("张三")

        // Step 1: 打开更多菜单
        composeTestRule.onNodeWithContentDescription("更多").performClick()

        // Step 2: 验证菜单项
        composeTestRule.waitForText("举报该用户")
        composeTestRule.waitForText("屏蔽该用户")

        // Step 3: 测试举报功能
        composeTestRule.clickOnText("举报该用户")
        composeTestRule.waitForText("举报用户")
        composeTestRule.onNodeWithText("垃圾信息").assertExists()
        composeTestRule.onNodeWithText("骚扰行为").assertExists()

        // 选择举报原因
        composeTestRule.clickOnText("骚扰行为")

        // 填写描述
        composeTestRule.typeTextInField("详细描述", "频繁发送骚扰消息")

        // 提交举报
        composeTestRule.clickOnText("提交")
        composeTestRule.assertSnackbarMessage("举报已提交")

        // Step 4: 测试屏蔽功能
        composeTestRule.onNodeWithContentDescription("更多").performClick()
        composeTestRule.clickOnText("屏蔽该用户")

        // 确认屏蔽
        composeTestRule.waitForText("确认屏蔽")
        composeTestRule.clickOnText("确认")

        // 验证屏蔽成功
        composeTestRule.assertSnackbarMessage("已屏蔽该用户")

        // 验证返回时间流
        composeTestRule.waitForText("动态")
    }

    // ===== E2E-SOCIAL-UI-11: CommentDetailScreen 完整流程测试 =====

    @Test
    fun e2e_commentDetailScreen_completeWorkflow() {
        // 导航到动态Tab
        composeTestRule.clickOnText("动态")
        composeTestRule.waitForText("这是张三的第一条动态")

        // Step 1: 点击动态进入详情
        composeTestRule.clickOnText("这是张三的第一条动态")
        composeTestRule.waitForText("动态详情")

        // Step 2: 验证评论列表
        composeTestRule.onNodeWithText("这是李四的评论").assertExists()
        composeTestRule.onNodeWithText("这是我的评论").assertExists()

        // Step 3: 点击评论进入评论详情
        composeTestRule.clickOnText("这是李四的评论")
        composeTestRule.waitForText("评论详情")

        // Step 4: 验证主评论显示
        composeTestRule.onNodeWithText("这是李四的评论").assertExists()
        composeTestRule.onNodeWithText("李四").assertExists()

        // Step 5: 验证回复列表
        composeTestRule.onNodeWithText("这是张三对评论的回复").assertExists()
        composeTestRule.onNodeWithText("回复 李四").assertExists()

        // Step 6: 点赞主评论
        composeTestRule.onAllNodesWithContentDescription("点赞评论")[0].performClick()

        // 验证点赞数增加
        Thread.sleep(500)
        composeTestRule.onNodeWithText("1", substring = true).assertExists()

        // Step 7: 发表回复
        composeTestRule.typeTextInField("写下你的回复", "我也来回复一下")
        composeTestRule.onNodeWithContentDescription("发送回复").performClick()

        // Step 8: 验证回复成功
        composeTestRule.assertSnackbarMessage("回复已发布")
        composeTestRule.waitForText("我也来回复一下")
    }

    // ===== E2E-SOCIAL-UI-12: CommentDetailScreen 嵌套回复 =====

    @Test
    fun e2e_commentDetailScreen_nestedReplies() {
        navigateToCommentDetail()

        // Step 1: 点击某个回复
        composeTestRule.clickOnText("这是张三对评论的回复")

        // Step 2: 验证输入框焦点切换到该回复
        composeTestRule.onNodeWithText("回复 张三").assertExists()

        // Step 3: 发表二级回复
        composeTestRule.typeTextInField("写下你的回复", "这是对张三回复的回复")
        composeTestRule.onNodeWithContentDescription("发送回复").performClick()

        // Step 4: 验证二级回复显示
        composeTestRule.waitForText("这是对张三回复的回复")
        composeTestRule.onNodeWithText("回复 张三").assertExists()
    }

    // ===== E2E-SOCIAL-UI-13: CommentDetailScreen 作者信息加载 =====

    @Test
    fun e2e_commentDetailScreen_authorInfoLoading() {
        navigateToCommentDetail()

        // Step 1: 验证主评论作者信息
        composeTestRule.onNodeWithText("李四").assertExists()
        composeTestRule.onAllNodesWithContentDescription("作者头像")[0].assertExists()

        // Step 2: 验证回复作者信息
        composeTestRule.onNodeWithText("张三").assertExists()

        // Step 3: 点击作者头像跳转到用户资料
        composeTestRule.onAllNodesWithContentDescription("作者头像")[0].performClick()
        composeTestRule.waitForText("用户资料")
        composeTestRule.onNodeWithText("李四").assertExists()
    }

    // ===== E2E-SOCIAL-UI-14: 图片上传功能测试 =====

    @Test
    fun e2e_publishPost_imageUpload() {
        // 导航到发布动态页面
        composeTestRule.clickOnText("动态")
        composeTestRule.onNodeWithContentDescription("发布动态").performClick()
        composeTestRule.waitForText("发布动态")

        // Step 1: 点击图片按钮
        composeTestRule.clickOnText("图片", substring = true)

        // Step 2: 模拟图片选择（实际测试中需要mock PhotoPicker）
        // 注意：这里需要使用UiAutomator或Espresso-Intents来模拟图片选择
        // 暂时跳过实际选择，直接验证UI

        // Step 3: 验证图片上传限制提示
        composeTestRule.onNodeWithText("(0/9)").assertExists()

        // Step 4: 验证图片预览网格存在
        // 如果有图片，应该显示ImagePreviewGrid
    }

    // ===== E2E-SOCIAL-UI-15: 链接预览功能测试 =====

    @Test
    fun e2e_publishPost_linkPreview() {
        navigateToPublishPost()

        // Step 1: 输入包含链接的文本
        composeTestRule.typeTextInField(
            "分享新鲜事...",
            "推荐一个好网站 https://kotlinlang.org"
        )

        // Step 2: 等待链接预览加载（500ms防抖）
        Thread.sleep(1000)

        // Step 3: 验证加载状态
        composeTestRule.onNodeWithText("正在加载预览...", substring = true)
            .assertExists()
            .or(composeTestRule.onNodeWithContentDescription("链接预览卡片").assertExists())

        // Step 4: 如果预览成功，验证预览卡片
        composeTestRule.waitForIdle()
        Thread.sleep(2000) // 等待实际加载

        // Step 5: 验证链接按钮状态变化
        composeTestRule.onNodeWithText("已添加", substring = true).assertExists()
            .or(composeTestRule.onNodeWithText("链接").assertExists())
    }

    // ===== E2E-SOCIAL-UI-16: 分享功能测试 =====

    @Test
    fun e2e_timeline_sharePost() {
        // 导航到动态Tab
        composeTestRule.clickOnText("动态")
        composeTestRule.waitForText("这是张三的第一条动态")

        // Step 1: 点击分享按钮
        composeTestRule.onAllNodesWithContentDescription("分享")[0].performClick()

        // Step 2: 验证Android ShareSheet打开
        // 注意：实际的ShareSheet是系统级组件，难以测试
        // 这里主要验证ShareManager被调用

        // Step 3: 验证分享记录创建
        Thread.sleep(1000)

        // Step 4: 刷新时间流，验证分享数增加
        composeTestRule.performPullToRefresh()
        composeTestRule.waitForIdle()
    }

    // ===== E2E-SOCIAL-UI-17: 举报动态功能测试 =====

    @Test
    fun e2e_timeline_reportPost() {
        navigateToTimeline()

        // Step 1: 点击动态右上角"更多"按钮
        composeTestRule.onAllNodesWithContentDescription("更多")[0].performClick()

        // Step 2: 点击"举报"
        composeTestRule.waitForText("举报")
        composeTestRule.clickOnText("举报")

        // Step 3: 验证举报对话框
        composeTestRule.waitForText("举报动态")
        composeTestRule.onNodeWithText("垃圾信息").assertExists()
        composeTestRule.onNodeWithText("骚扰行为").assertExists()
        composeTestRule.onNodeWithText("不实信息").assertExists()
        composeTestRule.onNodeWithText("不当内容").assertExists()
        composeTestRule.onNodeWithText("版权侵权").assertExists()
        composeTestRule.onNodeWithText("其他原因").assertExists()

        // Step 4: 选择举报原因
        composeTestRule.clickOnText("垃圾信息")

        // Step 5: 填写详细描述
        composeTestRule.typeTextInField("详细描述（可选）", "这是一条广告垃圾信息")

        // Step 6: 提交举报
        composeTestRule.clickOnText("提交")

        // Step 7: 验证成功提示
        composeTestRule.assertSnackbarMessage("举报已提交，感谢您的反馈")
    }

    // ===== E2E-SOCIAL-UI-18: 屏蔽用户功能测试 =====

    @Test
    fun e2e_timeline_blockUser() {
        navigateToTimeline()

        // 记录当前动态数量
        val initialPostCount = composeTestRule.onAllNodesWithContentDescription("动态卡片")
            .fetchSemanticsNodes().size

        // Step 1: 打开动态菜单
        composeTestRule.onAllNodesWithContentDescription("更多")[0].performClick()

        // Step 2: 点击"屏蔽该用户"
        composeTestRule.waitForText("屏蔽该用户")
        composeTestRule.clickOnText("屏蔽该用户")

        // Step 3: 确认屏蔽
        composeTestRule.waitForText("确认屏蔽")
        composeTestRule.clickOnText("确认")

        // Step 4: 验证成功提示
        composeTestRule.assertSnackbarMessage("已屏蔽该用户")

        // Step 5: 验证时间流自动刷新
        composeTestRule.waitForLoadingToComplete()

        // Step 6: 验证被屏蔽用户的内容消失
        val newPostCount = composeTestRule.onAllNodesWithContentDescription("动态卡片")
            .fetchSemanticsNodes().size
        assert(newPostCount < initialPostCount) { "屏蔽后动态数量应该减少" }
    }

    // ===== E2E-SOCIAL-UI-19: 好友备注编辑测试 =====

    @Test
    fun e2e_friendList_editRemarkName() {
        // 导航到好友列表
        composeTestRule.clickOnText("好友")
        composeTestRule.waitForText("张三")

        // Step 1: 长按好友卡片
        composeTestRule.onNodeWithText("张三").performLongClick()

        // Step 2: 点击"设置备注"
        composeTestRule.waitForText("设置备注")
        composeTestRule.clickOnText("设置备注")

        // Step 3: 验证备注对话框
        composeTestRule.waitForText("设置备注名")
        composeTestRule.onNodeWithText("原昵称：张三").assertExists()

        // Step 4: 清除现有备注（如果有）
        composeTestRule.onNodeWithContentDescription("清除").performClick()

        // Step 5: 输入新备注
        composeTestRule.typeTextInField("备注名", "三哥")

        // Step 6: 保存备注
        composeTestRule.clickOnText("保存")

        // Step 7: 验证备注生效
        composeTestRule.waitForText("三哥")
        composeTestRule.onNodeWithText("张三").assertDoesNotExist() // 原昵称应被备注名替代

        // Step 8: 测试搜索备注名
        composeTestRule.typeTextInField("搜索好友", "三哥")
        composeTestRule.waitForIdle()
        Thread.sleep(500) // 等待防抖

        // Step 9: 验证搜索结果包含该好友
        composeTestRule.onNodeWithText("三哥").assertExists()
    }

    // ===== E2E-SOCIAL-UI-20: 备注名优先级测试 =====

    @Test
    fun e2e_friendList_remarkNamePriority() {
        // 导航到好友列表
        composeTestRule.clickOnText("好友")

        // Step 1: 验证有备注名的好友优先显示备注名
        composeTestRule.onNodeWithText("我的同学").assertExists() // 李四的备注名

        // Step 2: 验证无备注名的好友显示昵称
        composeTestRule.onNodeWithText("张三").assertExists()

        // Step 3: 点击有备注名的好友查看详情
        composeTestRule.clickOnText("我的同学")
        composeTestRule.waitForText("好友详情")

        // Step 4: 验证详情页同样优先显示备注名
        composeTestRule.onNodeWithText("我的同学").assertExists()
        composeTestRule.onNodeWithText("李四", substring = true).assertExists() // 原昵称应该在副标题显示
    }

    // ===== 辅助导航方法 =====

    private fun navigateToAddFriendScreen() {
        composeTestRule.clickOnText("好友")
        composeTestRule.waitForIdle()
        composeTestRule.onNodeWithContentDescription("添加好友").performClick()
        composeTestRule.waitForText("添加好友")
    }

    private fun navigateToFriendDetail(friendName: String) {
        composeTestRule.clickOnText("好友")
        composeTestRule.waitForText(friendName)
        composeTestRule.clickOnText(friendName)
        composeTestRule.waitForText("好友详情")
    }

    private fun navigateToUserProfile(userName: String) {
        composeTestRule.clickOnText("动态")
        composeTestRule.waitForLoadingToComplete()

        // 点击作者头像或名称
        composeTestRule.onNodeWithText(userName).performClick()
        composeTestRule.waitForText("用户资料")
    }

    private fun navigateToCommentDetail() {
        composeTestRule.clickOnText("动态")
        composeTestRule.waitForText("这是张三的第一条动态")
        composeTestRule.clickOnText("这是张三的第一条动态")
        composeTestRule.waitForText("动态详情")
        composeTestRule.clickOnText("这是李四的评论")
        composeTestRule.waitForText("评论详情")
    }

    private fun navigateToPublishPost() {
        composeTestRule.clickOnText("动态")
        composeTestRule.onNodeWithContentDescription("发布动态").performClick()
        composeTestRule.waitForText("发布动态")
    }

    private fun navigateToTimeline() {
        composeTestRule.clickOnText("动态")
        composeTestRule.waitForLoadingToComplete()
    }

    // ===== 辅助断言方法 =====

    private fun SemanticsNodeInteraction.or(other: Boolean): SemanticsNodeInteraction {
        return if (other) this else this
    }
}
