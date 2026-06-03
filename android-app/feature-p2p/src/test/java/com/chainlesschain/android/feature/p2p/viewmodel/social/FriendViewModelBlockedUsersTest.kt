package com.chainlesschain.android.feature.p2p.viewmodel.social

import com.chainlesschain.android.core.common.Result
import com.chainlesschain.android.core.database.entity.social.BlockedUserEntity
import com.chainlesschain.android.core.did.manager.DIDManager
import com.chainlesschain.android.core.p2p.realtime.PresenceManager
import com.chainlesschain.android.core.p2p.realtime.RealtimeEventManager
import com.chainlesschain.android.feature.p2p.repository.social.FriendRepository
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * FriendViewModel.loadBlockedUsers / unblockFriend 测试
 *
 * 保护 BlockedUsersScreen 不再回到 demo——必须真实接通 DAO，且 unblock 走完整 unblockUser
 * 路径（同时清 BlockedUserEntity，避免孤儿记录）。
 */
@OptIn(ExperimentalCoroutinesApi::class)
class FriendViewModelBlockedUsersTest {

    private val testDispatcher = StandardTestDispatcher()
    private lateinit var friendRepository: FriendRepository
    private lateinit var realtime: RealtimeEventManager
    private lateinit var presence: PresenceManager
    private lateinit var didManager: DIDManager

    @Before
    fun setup() {
        Dispatchers.setMain(testDispatcher)
        friendRepository = mockk(relaxed = true)
        realtime = mockk(relaxed = true)
        presence = mockk(relaxed = true)
        didManager = mockk(relaxed = true)
        // FriendViewModel.init { startRealtimeListening() } 会订阅这些流
        every { realtime.friendRequestEvents } returns MutableSharedFlow()
        every { presence.presenceUpdates } returns MutableSharedFlow()
        // 默认其它列表为空，避免 init 块刷状态干扰
        every { friendRepository.getAllFriends() } returns flowOf(Result.Success(emptyList()))
        every { friendRepository.getAllGroups() } returns flowOf(Result.Success(emptyList()))
        every { friendRepository.getPendingRequests() } returns flowOf(Result.Success(emptyList()))
        every { friendRepository.getPendingRequestCount() } returns flowOf(Result.Success(0))
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    @Test
    fun `loadBlockedUsers populates state from FriendRepository`() = runTest {
        every { didManager.getCurrentDID() } returns "did:key:me"
        val blocked = listOf(
            BlockedUserEntity(
                id = "b1",
                blockerDid = "did:key:me",
                blockedDid = "did:key:bad",
                reason = "spam",
                createdAt = 1L
            )
        )
        every { friendRepository.getBlockedUsersList("did:key:me") } returns flowOf(Result.Success(blocked))

        val vm = FriendViewModel(friendRepository, realtime, presence, didManager)
        vm.loadBlockedUsers()
        advanceUntilIdle()

        val state = vm.uiState.value
        assertEquals(1, state.blockedUsers.size)
        assertEquals("did:key:bad", state.blockedUsers[0].blockedDid)
        assertEquals("加载完成后 isLoading=false", false, state.isLoadingBlockedUsers)
    }

    @Test
    fun `loadBlockedUsers does nothing when no DID (logged out)`() = runTest {
        every { didManager.getCurrentDID() } returns null
        val vm = FriendViewModel(friendRepository, realtime, presence, didManager)
        vm.loadBlockedUsers()
        advanceUntilIdle()

        assertTrue(vm.uiState.value.blockedUsers.isEmpty())
        // 不应去查 DAO
        coVerify(exactly = 0) { friendRepository.getBlockedUsersList(any()) }
    }

    @Test
    fun `unblockFriend routes through unblockUser when DID available`() = runTest {
        every { didManager.getCurrentDID() } returns "did:key:me"
        coEvery { friendRepository.unblockUser("did:key:me", "did:key:bad") } returns Result.Success(Unit)

        val vm = FriendViewModel(friendRepository, realtime, presence, didManager)
        vm.unblockFriend("did:key:bad")
        advanceUntilIdle()

        // 关键：走 unblockUser（带 myDid 清 BlockedUserEntity），而不是 unblockFriend（只清 flag）
        coVerify(exactly = 1) { friendRepository.unblockUser("did:key:me", "did:key:bad") }
        coVerify(exactly = 0) { friendRepository.unblockFriend("did:key:bad") }
    }

    @Test
    fun `unblockFriend falls back to flag-only unblock when DID missing`() = runTest {
        every { didManager.getCurrentDID() } returns null
        coEvery { friendRepository.unblockFriend("did:key:bad") } returns Result.Success(Unit)

        val vm = FriendViewModel(friendRepository, realtime, presence, didManager)
        vm.unblockFriend("did:key:bad")
        advanceUntilIdle()

        coVerify(exactly = 0) { friendRepository.unblockUser(any(), any()) }
        coVerify(exactly = 1) { friendRepository.unblockFriend("did:key:bad") }
    }
}
