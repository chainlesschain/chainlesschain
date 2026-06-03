package com.chainlesschain.android.presentation.screens

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * SocialScreen tab 内容回归测试（不需要模拟器）
 *
 * 锁定 v0.x demo 残余被修复且不再回退：
 * - Friends tab 嵌入 FriendListScreen（之前只显示 social_friends_placeholder 字串）
 * - Timeline tab 嵌入 TimelineScreen（之前只显示 social_timeline_placeholder 字串）
 * - Notifications tab 用 NotificationCenterScreen（之前用基础内联 NotificationsTab）
 *
 * 与传统 compose-ui-test 相比：纯字符串断言，<1s，覆盖窄但 catch 主要的 placeholder 回归。
 */
class SocialScreenTabRegressionTest {

    private val source: String by lazy {
        val file = File("src/main/java/com/chainlesschain/android/presentation/screens/SocialScreen.kt")
        require(file.exists()) { "SocialScreen.kt not found at ${file.absolutePath}" }
        file.readText()
    }

    @Test
    fun `Friends tab embeds FriendListScreen (not placeholder text)`() {
        assertTrue("FriendListScreen 未在 SocialScreen 调用", source.contains("FriendListScreen("))
        // 确认 R.string.social_friends_placeholder 文本字串引用已下线
        assertFalse(
            "Friends tab 仍在用 social_friends_placeholder 字串——回退到 v0 demo",
            source.contains("R.string.social_friends_placeholder")
        )
    }

    @Test
    fun `Timeline tab embeds TimelineScreen (not placeholder text)`() {
        assertTrue("TimelineScreen 未在 SocialScreen 调用", source.contains("TimelineScreen("))
        assertFalse(
            "Timeline tab 仍在用 social_timeline_placeholder 字串——回退到 v0 demo",
            source.contains("R.string.social_timeline_placeholder")
        )
    }

    @Test
    fun `Notifications tab uses NotificationCenterScreen (not inline basic list)`() {
        assertTrue(
            "Notifications tab 未升级为 NotificationCenterScreen（缺筛选/标记已读/清理菜单）",
            source.contains("NotificationCenterScreen(")
        )
        // 旧的内联 NotificationsTab 函数应该已被删除
        assertFalse(
            "@Composable private fun NotificationsTab 残留——回退到 v0 demo basic 列表",
            source.contains("private fun NotificationsTab(")
        )
    }

    @Test
    fun `Timeline tab requires myDid resolved via DIDViewModel`() {
        // myDid 必须从 DIDViewModel 取，否则 Timeline 加载逻辑不正确
        assertTrue(source.contains("DIDViewModel"))
        assertTrue(source.contains("didDocument"))
    }

    @Test
    fun `onNavigateToBlockedUsers callback exposed to dropdown menu`() {
        assertTrue(
            "FriendListScreen onNavigateToBlockedUsers 未连接——屏蔽用户列表 dropdown 入口失效",
            source.contains("onNavigateToBlockedUsers = onNavigateToBlockedUsers")
        )
    }
}
