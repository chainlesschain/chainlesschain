package com.chainlesschain.android.feature.p2p.e2e

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.chainlesschain.android.MainActivity
import com.chainlesschain.android.core.common.test.TestDataFactory
import com.chainlesschain.android.core.database.test.DatabaseFixture
import com.chainlesschain.android.core.network.test.NetworkSimulator
import com.chainlesschain.android.core.network.test.enqueueImageUploadResponse
import com.chainlesschain.android.core.network.test.enqueueLinkPreviewResponse
import com.chainlesschain.android.test.*
import dagger.hilt.android.testing.HiltAndroidRule
import dagger.hilt.android.testing.HiltAndroidTest
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * 社交功能 E2E 测试
 *
 * 测试完整的社交功能流程：好友、动态、评论、分享等
 */
@HiltAndroidTest
@RunWith(AndroidJUnit4::class)
class SocialE2ETest {

    @get:Rule(order = 0)
    val hiltRule = HiltAndroidRule(this)

    @get:Rule(order = 1)
    val composeTestRule = createAndroidComposeRule<MainActivity>()

    @get:Rule(order = 2)
    val databaseFixture = DatabaseFixture()

    @get:Rule(order = 3)
    val networkSimulator = NetworkSimulator()

    private val testDid = "did:test:user:123"

    @Before
    fun setup() {
        hiltRule.inject()
        composeTestRule.waitForLoadingToComplete()
        navigateToSocial()
    }

    private fun navigateToSocial() {
        composeTestRule.apply {
            clickOnText("社交", substring = true)
            waitForLoadingToComplete()
        }
    }

    /**
     * E2E-SOCIAL-01: 添加好友 → 聊天
     */
    @Test
    fun testAddFriendAndChat() {
        val friendDid = "did:test:newfriend:456"

        composeTestRule.apply {
            // 1. 打开好友列表
            clickOnText("好友")
            waitForLoadingToComplete()

            // 2. 添加好友
            clickOnText("添加好友")
            waitForLoadingToComplete()

            // 3. 搜索好友
            typeTextInField("搜索", friendDid)
            waitForLoadingToComplete()
            assertTextExists(friendDid, substring = true)

            // 4. 发送好友请求
            clickOnText("添加")
            typeTextInField("验证消息", "Hello, let's be friends!")
            clickOnText("发送")
            assertSnackbarMessage("好友请求已发送")

            // 5. 模拟对方接受（在测试环境中直接更新状态）
            clickBackButton()
            performPullToRefresh()
            waitForLoadingToComplete()

            // 6. 查看好友详情
            clickOnText(friendDid, substring = true)
            waitForLoadingToComplete()

            // 7. 发起聊天
            clickOnText("发消息")
            waitForLoadingToComplete()

            // 8. 发送消息
            typeTextInField("输入消息", "Hi there!")
            clickOnText("发送")
            assertTextExists("Hi there!")
        }
    }

    /**
     * E2E-SOCIAL-02: 发布动态 → 点赞/评论
     */
    @Test
    fun testPublishPostWithLikeAndComment() {
        val postContent = "This is my E2E test post ${System.currentTimeMillis()}"

        composeTestRule.apply {
            // 1. 发布动态
            clickOnText("动态")
            onNode(hasContentDescription("发布动态") or hasText("发布")).performClick()
            waitForLoadingToComplete()

            typeTextInField("说点什么", postContent, clearFirst = false)
            clickOnText("发布")
            assertSnackbarMessage("动态已发布")

            // 2. 验证动态显示
            waitForText(postContent, timeoutMillis = 5000)
            assertTextExists(postContent)

            // 3. 点赞动态
            onNode(hasContentDescription("点赞")).performClick()
            assertSnackbarMessage("已点赞", timeoutMillis = 2000)

            // 4. 评论动态
            clickOnText("评论")
            waitForLoadingToComplete()

            typeTextInField("评论", "Great post!")
            clickOnText("发送")
            assertSnackbarMessage("评论已发布")

            // 5. 验证评论显示
            assertTextExists("Great post!")

            // 6. 点赞评论
            onNode(hasContentDescription("点赞评论")).performClick()
            waitForLoadingToComplete()
        }
    }

    /**
     * E2E-SOCIAL-03: 通知处理测试
     */
    @Test
    fun testNotificationHandling() {
        // 准备测试数据
        val notification = TestDataFactory.createNotificationEntity(
            title = "新的点赞",
            content = "有人赞了你的动态",
            actorDid = "did:test:actor"
        )

        composeTestRule.apply {
            // 1. 打开通知列表
            clickOnText("通知")
            waitForLoadingToComplete()

            // 2. 验证未读通知
            assertTextExists("新的点赞")
            assertTextExists("有人赞了你的动态", substring = true)

            // 3. 点击通知
            clickOnText("新的点赞")
            waitForLoadingToComplete()

            // 4. 跳转到对应动态
            assertTextExists("动态详情", substring = true)

            // 5. 返回通知列表
            clickBackButton()

            // 6. 标记所有已读
            clickOnText("全部已读")
            assertSnackbarMessage("已标记为已读")

            // 7. 验证通知已读
            performPullToRefresh()
            assertTextExists("没有未读通知", substring = true)
        }
    }

    /**
     * E2E-SOCIAL-04: 好友备注编辑测试
     */
    @Test
    fun testFriendRemarkEdit() {
        val friend = TestDataFactory.createFriendEntity(
            did = "did:test:friend:remark",
            nickname = "Original Name"
        )
        databaseFixture.insertFriends(friend)

        composeTestRule.apply {
            // 1. 打开好友列表
            clickOnText("好友")
            performPullToRefresh()

            // 2. 长按好友卡片
            onNode(hasText("Original Name")).performLongClick()

            // 3. 设置备注
            clickOnText("设置备注")
            waitForLoadingToComplete()

            typeTextInField("备注名", "Best Friend")
            clickOnText("保存")
            assertSnackbarMessage("备注名已更新")

            // 4. 验证备注显示
            assertTextExists("Best Friend")
            assertTextExists("Original Name") // 原昵称应该在下方

            // 5. 测试搜索备注名
            clickOnText("搜索")
            typeTextInField("搜索", "Best Friend")
            waitForLoadingToComplete()
            assertTextExists("Best Friend")
        }
    }

    /**
     * E2E-SOCIAL-05: 屏蔽用户测试
     */
    @Test
    fun testBlockUser() {
        val userToBlock = TestDataFactory.createFriendEntity(
            did = "did:test:block:user",
            nickname = "Block Test User"
        )
        databaseFixture.insertFriends(userToBlock)

        composeTestRule.apply {
            // 1. 打开好友列表
            clickOnText("好友")
            performPullToRefresh()

            // 2. 长按好友卡片
            onNode(hasText("Block Test User")).performLongClick()

            // 3. 屏蔽用户
            clickOnText("屏蔽好友")
            clickOnText("确认")
            assertSnackbarMessage("已屏蔽好友")

            // 4. 验证好友列表中不显示
            assertTextDoesNotExist("Block Test User")

            // 5. 查看屏蔽列表
            clickOnText("设置")
            clickOnText("屏蔽用户")
            waitForLoadingToComplete()
            assertTextExists("Block Test User")

            // 6. 取消屏蔽
            clickOnText("取消屏蔽")
            assertSnackbarMessage("已取消屏蔽")

            // 7. 返回好友列表验证
            clickBackButton()
            clickBackButton()
            performPullToRefresh()
            assertTextExists("Block Test User")
        }
    }

    /**
     * E2E-SOCIAL-06: 举报动态测试
     */
    @Test
    fun testReportPost() {
        val spamPost = TestDataFactory.createPostEntity(
            content = "Spam content - buy now!",
            authorDid = "did:test:spammer"
        )
        databaseFixture.insertPosts(spamPost)

        composeTestRule.apply {
            clickOnText("动态")
            performPullToRefresh()

            // 1. 长按动态卡片
            onNode(hasText("Spam content - buy now!")).performLongClick()

            // 2. 选择举报
            clickOnText("举报")
            waitForLoadingToComplete()

            // 3. 选择举报原因
            clickOnText("垃圾信息")

            // 4. 填写描述
            typeTextInField("详细描述", "This is clearly spam content", clearFirst = false)

            // 5. 提交举报
            clickOnText("提交")
            assertSnackbarMessage("举报已提交")

            // 6. 验证动态被标记（或隐藏）
            // 根据实际业务逻辑调整
        }
    }

    /**
     * E2E-SOCIAL-07: 分享功能测试
     */
    @Test
    fun testShareFunctionality() {
        val sharePost = TestDataFactory.createPostEntity(
            content = "Check out this awesome post!",
            authorDid = testDid
        )
        databaseFixture.insertPosts(sharePost)

        composeTestRule.apply {
            clickOnText("动态")
            performPullToRefresh()

            // 1. 点击分享按钮
            onNode(hasContentDescription("分享")).performClick()

            // 2. 验证分享面板打开（Android ShareSheet）
            // 注意：ShareSheet 是系统组件，可能需要特殊处理

            // 3. 验证分享计数增加
            performPullToRefresh()
            // 检查分享数（根据实际UI调整）
            assertTextExists("1 次分享", substring = true)
        }
    }

    /**
     * E2E-SOCIAL-08: 动态配图上传测试
     */
    @Test
    fun testPostImageUpload() {
        // 模拟图片上传响应
        networkSimulator.enqueueImageUploadResponse("https://example.com/image1.jpg")
        networkSimulator.enqueueImageUploadResponse("https://example.com/image2.jpg")

        composeTestRule.apply {
            clickOnText("动态")
            onNode(hasContentDescription("发布动态") or hasText("发布")).performClick()

            // 1. 选择图片
            clickOnText("图片")
            // 模拟选择2张图片（需要与实际图片选择器集成）
            waitForLoadingToComplete()

            // 2. 验证图片预览
            assertTextExists("2 张图片", substring = true)

            // 3. 填写内容
            typeTextInField("说点什么", "Post with images", clearFirst = false)

            // 4. 发布
            clickOnText("发布")

            // 5. 等待上传完成
            waitForText("动态已发布", timeoutMillis = 10000)

            // 6. 验证动态显示图片
            assertTextExists("Post with images")
            // 验证图片显示（根据实际UI调整）
        }
    }

    /**
     * E2E-SOCIAL-09: 链接预览测试
     */
    @Test
    fun testLinkPreview() {
        // 模拟链接预览响应
        networkSimulator.enqueueLinkPreviewResponse(
            title = "Kotlin Programming Language",
            description = "A modern programming language that makes developers happier",
            imageUrl = "https://kotlinlang.org/image.png"
        )

        composeTestRule.apply {
            clickOnText("动态")
            onNode(hasContentDescription("发布动态") or hasText("发布")).performClick()

            // 1. 输入包含链接的内容
            val contentWithLink = "Check out this awesome language: https://kotlinlang.org"
            typeTextInField("说点什么", contentWithLink, clearFirst = false)

            // 2. 等待链接预览加载
            waitForText("Kotlin Programming Language", timeoutMillis = 5000)

            // 3. 验证预览卡片
            assertTextExists("Kotlin Programming Language")
            assertTextExists("A modern programming language", substring = true)

            // 4. 移除预览（可选）
            onNode(hasContentDescription("移除预览")).performClick()
            assertTextDoesNotExist("Kotlin Programming Language")

            // 5. 发布
            clickOnText("发布")
            assertSnackbarMessage("动态已发布")
        }
    }

    /**
     * E2E-SOCIAL-10: 时间流滚动测试
     */
    @Test
    fun testTimelineScrolling() {
        // 插入多个测试动态
        val posts = TestDataFactory.createPostList(count = 30, authorDid = testDid)
        databaseFixture.insertPosts(*posts.toTypedArray())

        composeTestRule.apply {
            clickOnText("动态")
            performPullToRefresh()

            // 1. 验证初始加载
            assertTextExists("Test post content 0", substring = true)

            // 2. 滚动加载更多
            repeat(3) {
                scrollToBottom()
                waitForLoadingToComplete()
            }

            // 3. 验证后续内容加载
            assertTextExists("Test post content 20", substring = true)

            // 4. 滚动到底部
            scrollToBottom()
            waitForText("没有更多了", substring = true)

            // 5. 下拉刷新
            performPullToRefresh()
            waitForLoadingToComplete()

            // 6. 验证回到顶部
            assertTextExists("Test post content 0", substring = true)
        }
    }

    /**
     * E2E-SOCIAL-11: 评论详情测试
     */
    @Test
    fun testCommentDetail() {
        val post = TestDataFactory.createPostEntity(content = "Post with comments")
        val comment = TestDataFactory.createPostCommentEntity(
            postId = post.id,
            content = "Top level comment"
        )
        val reply = TestDataFactory.createPostCommentEntity(
            postId = post.id,
            content = "Reply to comment",
            parentCommentId = comment.id
        )

        databaseFixture.insertPosts(post)
        databaseFixture.insertComments(comment, reply)

        composeTestRule.apply {
            clickOnText("动态")
            performPullToRefresh()

            // 1. 进入动态详情
            clickOnText("Post with comments")
            waitForLoadingToComplete()

            // 2. 查看评论
            assertTextExists("Top level comment")

            // 3. 点击评论查看详情
            clickOnText("Top level comment")
            waitForLoadingToComplete()

            // 4. 验证回复显示
            assertTextExists("Reply to comment")

            // 5. 回复评论
            typeTextInField("回复", "Another reply")
            clickOnText("发送")
            assertSnackbarMessage("评论已发布")

            // 6. 验证新回复显示
            assertTextExists("Another reply")
        }
    }

    /**
     * E2E-SOCIAL-12: 用户资料查看测试
     */
    @Test
    fun testUserProfileView() {
        val user = TestDataFactory.createFriendEntity(
            did = "did:test:profile:user",
            nickname = "Profile Test User",
            bio = "This is my bio"
        )
        val userPosts = TestDataFactory.createPostList(count = 5, authorDid = user.did)

        databaseFixture.insertFriends(user)
        databaseFixture.insertPosts(*userPosts.toTypedArray())

        composeTestRule.apply {
            clickOnText("动态")
            performPullToRefresh()

            // 1. 点击用户头像/昵称
            clickOnText("Profile Test User")
            waitForLoadingToComplete()

            // 2. 验证用户资料显示
            assertTextExists("Profile Test User")
            assertTextExists("This is my bio")
            assertTextExists(user.did, substring = true)

            // 3. 查看用户动态
            assertTextExists("Test post content 0", substring = true)

            // 4. 滚动查看更多动态
            scrollToBottom()
            assertTextExists("Test post content 4", substring = true)

            // 5. 发送消息（如果是好友）
            clickOnText("发消息")
            waitForLoadingToComplete()
            assertTextExists("输入消息", substring = true)
        }
    }
}
