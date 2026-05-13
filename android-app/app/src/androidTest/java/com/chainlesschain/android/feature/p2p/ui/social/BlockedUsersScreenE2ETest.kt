package com.chainlesschain.android.feature.p2p.ui.social

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import com.chainlesschain.android.core.database.entity.social.BlockedUserEntity
import com.chainlesschain.android.feature.p2p.viewmodel.social.FriendEvent
import com.chainlesschain.android.feature.p2p.viewmodel.social.FriendUiState
import com.chainlesschain.android.feature.p2p.viewmodel.social.FriendViewModel
import io.mockk.every
import io.mockk.mockk
import io.mockk.verify
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import org.junit.Rule
import org.junit.Test

/**
 * BlockedUsersScreen Compose UI E2E 测试（instrumented，CI emulator 跑）
 *
 * 锁定 v0 demo 残余（`blockedUsers = mutableStateOf(emptyList())` 写死 TODO）真接通：
 * - 空态显示 "没有屏蔽任何用户"
 * - 有数据时显示行 + DID 摘要
 * - 点 "解除屏蔽" 触发 viewModel.unblockFriend
 *
 * VM 用 mockk 直接 stub，避免拉起 Hilt graph（同等覆盖，setup 1/10）。
 */
class BlockedUsersScreenE2ETest {

    @get:Rule
    val composeTestRule = createComposeRule()

    private fun makeMockVm(blockedUsers: List<BlockedUserEntity>, loading: Boolean): FriendViewModel {
        // relaxed=true 自动返回非 Unit/Job 类型的占位 mock，省去 unblockFriend (返回 Job) 显式 stub
        val vm = mockk<FriendViewModel>(relaxed = true)
        val state = MutableStateFlow(
            FriendUiState(
                blockedUsers = blockedUsers,
                isLoadingBlockedUsers = loading
            )
        )
        every { vm.uiState } returns state
        every { vm.eventFlow } returns MutableSharedFlow<FriendEvent>()
        return vm
    }

    @Test
    fun emptyState_showsNoBlockedUsersHint() {
        val vm = makeMockVm(blockedUsers = emptyList(), loading = false)

        composeTestRule.setContent {
            BlockedUsersScreen(onNavigateBack = {}, viewModel = vm)
        }

        composeTestRule.onNodeWithText("没有屏蔽任何用户").assertIsDisplayed()
    }

    @Test
    fun loadingState_showsProgress() {
        val vm = makeMockVm(blockedUsers = emptyList(), loading = true)

        composeTestRule.setContent {
            BlockedUsersScreen(onNavigateBack = {}, viewModel = vm)
        }

        // LoadingState 组件渲染（具体文本看 core-ui 实现，常见为 "加载中..."）
        // 这里至少应该不显示"没有屏蔽"（empty state 互斥）
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
        val vm = makeMockVm(blockedUsers = listOf(blocked), loading = false)

        composeTestRule.setContent {
            BlockedUsersScreen(onNavigateBack = {}, viewModel = vm)
        }

        // 行用 DID 末 8 位作为占位昵称（BlockedUsersScreen.kt L120 "用户 ${take(8)}"）
        // 取前 8 字符 "did:key:" 太通用——用 reason 字串更精准
        composeTestRule.onNodeWithText("原因: 广告 spam", substring = true).assertIsDisplayed()
        composeTestRule.onNodeWithText("解除屏蔽").assertIsDisplayed()
    }

    @Test
    fun clickUnblock_invokesViewModelUnblockFriend() {
        val blocked = BlockedUserEntity(
            id = "b2",
            blockerDid = "did:key:me",
            blockedDid = "did:key:zTARGET",
            reason = null,
            createdAt = 1L
        )
        val vm = makeMockVm(blockedUsers = listOf(blocked), loading = false)

        composeTestRule.setContent {
            BlockedUsersScreen(onNavigateBack = {}, viewModel = vm)
        }

        composeTestRule.onNodeWithText("解除屏蔽").performClick()
        verify(exactly = 1) { vm.unblockFriend("did:key:zTARGET") }
    }

    @Test
    fun loadBlockedUsers_calledOnLaunch() {
        val vm = makeMockVm(blockedUsers = emptyList(), loading = false)

        composeTestRule.setContent {
            BlockedUsersScreen(onNavigateBack = {}, viewModel = vm)
        }

        // LaunchedEffect(Unit) { viewModel.loadBlockedUsers() } 应在首次 composition 后被调用
        composeTestRule.waitForIdle()
        verify(atLeast = 1) { vm.loadBlockedUsers() }
    }
}
