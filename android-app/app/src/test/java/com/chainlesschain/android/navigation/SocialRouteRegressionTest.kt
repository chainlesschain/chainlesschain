package com.chainlesschain.android.navigation

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * SocialRoute 结构性回归测试（不需要模拟器）
 *
 * 直接读 NavGraph.kt 源文件断言：
 * 1. 7 个社交路由不再是 `registerPlaceholder(...)` 占位（v0.x demo 残余）
 * 2. NotificationCenter / BlockedUsers 两个新路由已注册
 * 3. Screen sealed class 的路由字串没被意外改名（破坏 deep link 兼容）
 *
 * 与传统 compose-ui-test 相比：不需要 Hilt graph、不需要 Compose runtime、
 * 不需要 emulator——纯文本断言，跑 JVM 单测 <1s。覆盖范围窄，但能 catch 80%
 * 的"重新引入 placeholder"和"路由字串漂移"回归。
 */
class SocialRouteRegressionTest {

    private val navGraphSource: String by lazy {
        // 测试运行目录是 app/，文件在 app/src/main/...
        val file = File("src/main/java/com/chainlesschain/android/navigation/NavGraph.kt")
        require(file.exists()) {
            "NavGraph.kt not found at ${file.absolutePath} (cwd=${File(".").absolutePath})"
        }
        file.readText()
    }

    @Test
    fun `Screen route ids are stable (deep-link contract)`() {
        // 这些 route 字串可能出现在 system push、外部 share intent、桌面端通知里。
        // 改这些 = 破坏 v0.x 装机的兼容性，必须显式改本表。
        assertEquals("publish_post", Screen.PublishPost.route)
        assertEquals("post_detail", Screen.PostDetail.route)
        assertEquals("friend_detail", Screen.FriendDetail.route)
        assertEquals("user_profile", Screen.UserProfile.route)
        assertEquals("add_friend", Screen.AddFriend.route)
        assertEquals("comment_detail", Screen.CommentDetail.route)
        assertEquals("edit_post", Screen.EditPost.route)
        assertEquals("notification_center", Screen.NotificationCenter.route)
        assertEquals("blocked_users", Screen.BlockedUsers.route)
    }

    @Test
    fun `Screen createRoute helpers preserve argument shape`() {
        assertEquals("post_detail/abc123", Screen.PostDetail.createRoute("abc123"))
        assertEquals("friend_detail/did:key:alice", Screen.FriendDetail.createRoute("did:key:alice"))
        assertEquals("user_profile/did:key:bob", Screen.UserProfile.createRoute("did:key:bob"))
        assertEquals("comment_detail/c-1", Screen.CommentDetail.createRoute("c-1"))
        assertEquals("edit_post/p-7", Screen.EditPost.createRoute("p-7"))
    }

    @Test
    fun `social routes no longer use registerPlaceholder (v0 demo residue)`() {
        // 这是把 demo 锁出的核心 fence——确保社交路由的 composable 真的有内容。
        val socialRouteTokens = listOf(
            "Screen.PublishPost.route",
            "Screen.PostDetail.route",
            "Screen.FriendDetail.route",
            "Screen.UserProfile.route",
            "Screen.AddFriend.route",
            "Screen.CommentDetail.route",
            "Screen.EditPost.route"
        )
        socialRouteTokens.forEach { token ->
            val placeholderPattern = Regex("""registerPlaceholder\s*\([^)]*?$token""")
            assertFalse(
                "Found registerPlaceholder(...) wired to $token — social route regressed to demo placeholder",
                placeholderPattern.containsMatchIn(navGraphSource)
            )
        }
    }

    @Test
    fun `NotificationCenter and BlockedUsers composables are registered`() {
        assertTrue(
            "Screen.NotificationCenter.route 未在 NavHost 注册",
            navGraphSource.contains("composable(Screen.NotificationCenter.route)")
        )
        assertTrue(
            "NotificationCenterScreen composable 未被引用",
            navGraphSource.contains("NotificationCenterScreen(")
        )
        assertTrue(
            "Screen.BlockedUsers.route 未在 NavHost 注册",
            navGraphSource.contains("composable(Screen.BlockedUsers.route)")
        )
        assertTrue(
            "BlockedUsersScreen composable 未被引用",
            navGraphSource.contains("BlockedUsersScreen(")
        )
    }

    @Test
    fun `social screens are imported (not stubs)`() {
        val expected = listOf(
            "PublishPostScreen",
            "PostDetailScreen",
            "FriendDetailScreen",
            "UserProfileScreen",
            "AddFriendScreen",
            "CommentDetailScreen",
            "EditPostScreen",
            "NotificationCenterScreen",
            "BlockedUsersScreen"
        )
        expected.forEach { screen ->
            assertTrue(
                "feature.p2p.ui.social.$screen 未在 NavGraph 导入——确认占位换实屏",
                navGraphSource.contains("com.chainlesschain.android.feature.p2p.ui.social.$screen")
            )
        }
    }

    @Test
    fun `MainContainer threads onNavigateToBlockedUsers to NavGraph`() {
        // 这个回调链 NavGraph → MainContainer → SocialScreen → FriendListScreen dropdown
        // 缺一处 BlockedUsersScreen 就不可达。回归探测的最便宜信号是 NavGraph 里有这一行。
        assertTrue(
            "缺少 onNavigateToBlockedUsers wiring 到 BlockedUsers route",
            navGraphSource.contains("onNavigateToBlockedUsers = { navController.navigate(Screen.BlockedUsers.route) }")
        )
    }
}
