package com.chainlesschain.android.feature.p2p.ui.social

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import com.chainlesschain.android.core.database.entity.social.BlockedUserEntity
import org.junit.Rule
import org.junit.Test

/**
 * BlockedUsersScreen Compose UI E2E 测试（instrumented，CI emulator 跑）
 *
 * 锁定 v0 demo 残余（`blockedUsers = mutableStateOf(emptyList())` 写死 TODO）真接通：
 * - 空态显示 "没有屏蔽任何用户"
 * - loading 时不显示空态
 * - 有数据时显示行 + 解除按钮
 * - 点 "解除屏蔽" 触发 onUnblock(blockedDid)
 *
 * 直接驱动 `BlockedUsersContent`（stateless 拆分），绕开 mockk on final FriendViewModel
 * 在 emulator 上的 ExceptionInInitializerError——VM ↔ Content wiring 的单元测试已由
 * `FriendViewModelBlockedUsersTest` (JVM) 覆盖。
 */
class BlockedUsersScreenE2ETest {

    @get:Rule
    val composeTestRule = createComposeRule()

    @Test
    fun emptyState_showsNoBlockedUsersHint() {
        composeTestRule.setContent {
            BlockedUsersContent(
                blockedUsers = emptyList(),
                isLoading = false,
                onNavigateBack = {},
                onLoad = {},
                onUnblock = {}
            )
        }

        composeTestRule.onNodeWithText("没有屏蔽任何用户").assertIsDisplayed()
    }

    @Test
    fun loadingState_hidesEmptyHint() {
        composeTestRule.setContent {
            BlockedUsersContent(
                blockedUsers = emptyList(),
                isLoading = true,
                onNavigateBack = {},
                onLoad = {},
                onUnblock = {}
            )
        }

        // empty 与 loading 互斥
        composeTestRule.onNodeWithText("没有屏蔽任何用户").assertDoesNotExist()
    }

    @Test
    fun populatedState_rendersBlockedUserRow() {
        val blocked = BlockedUserEntity(
            id = "b1",
            blockerDid = "did:key:me",
            blockedDid = "did:key:zABC12345LONG_SUFFIX",
            reason = "广告 spam",
            createdAt = 1_700_000_000_000L
        )

        composeTestRule.setContent {
            BlockedUsersContent(
                blockedUsers = listOf(blocked),
                isLoading = false,
                onNavigateBack = {},
                onLoad = {},
                onUnblock = {}
            )
        }

        composeTestRule.onNodeWithText("原因: 广告 spam", substring = true).assertIsDisplayed()
        composeTestRule.onNodeWithText("解除屏蔽").assertIsDisplayed()
    }

    @Test
    fun clickUnblock_invokesCallbackWithBlockedDid() {
        val blocked = BlockedUserEntity(
            id = "b2",
            blockerDid = "did:key:me",
            blockedDid = "did:key:zTARGET",
            reason = null,
            createdAt = 1L
        )
        val unblockedDids = mutableListOf<String>()

        composeTestRule.setContent {
            BlockedUsersContent(
                blockedUsers = listOf(blocked),
                isLoading = false,
                onNavigateBack = {},
                onLoad = {},
                onUnblock = { did -> unblockedDids.add(did) }
            )
        }

        composeTestRule.onNodeWithText("解除屏蔽").performClick()
        composeTestRule.waitForIdle()

        assert(unblockedDids == listOf("did:key:zTARGET")) {
            "expected unblock called once with did:key:zTARGET, got=$unblockedDids"
        }
    }

    @Test
    fun onLoad_calledOnceOnComposition() {
        var loadCallCount = 0

        composeTestRule.setContent {
            BlockedUsersContent(
                blockedUsers = emptyList(),
                isLoading = false,
                onNavigateBack = {},
                onLoad = { loadCallCount++ },
                onUnblock = {}
            )
        }

        composeTestRule.waitForIdle()
        assert(loadCallCount == 1) {
            "expected onLoad called exactly once on first composition, got=$loadCallCount"
        }
    }
}
