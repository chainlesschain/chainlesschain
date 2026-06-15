package com.chainlesschain.android.feature.p2p.viewmodel.social

import com.chainlesschain.android.core.common.Result
import com.chainlesschain.android.core.database.entity.social.FriendEntity
import com.chainlesschain.android.core.database.entity.social.FriendStatus
import com.chainlesschain.android.core.p2p.realtime.RealtimeEventManager
import com.chainlesschain.android.feature.p2p.repository.social.FriendRepository
import io.mockk.Runs
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.just
import io.mockk.mockk
import io.mockk.slot
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Before
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * #1 扫码/输入 DID 加好友 — 离线互加单元测试。
 *
 * 用户报"扫码无法加好友": 根因之一是旧逻辑把好友置为 PENDING 并依赖请求经 P2P 信令送达对端;
 * 无信令/不同网段时永远停在 PENDING。修复改为**离线互加**: 通过对方已验证 DID(二维码)找到 ta
 * 即本地确认为 ACCEPTED 好友, 双方各加一次即互为好友。这里断言该语义, 无需真机/P2P。
 */
@OptIn(ExperimentalCoroutinesApi::class)
class AddFriendViewModelTest {

    private val dispatcher = UnconfinedTestDispatcher()
    private lateinit var friendRepository: FriendRepository
    private lateinit var realtime: RealtimeEventManager

    @Before
    fun setUp() {
        Dispatchers.setMain(dispatcher)
        friendRepository = mockk(relaxed = true)
        realtime = mockk(relaxed = true)
        // init {} 会拉这两条流, 给空结果即可。
        every { friendRepository.getNearbyUsers() } returns flowOf(Result.success(emptyList()))
        every { friendRepository.getRecommendedFriends() } returns flowOf(Result.success(emptyList()))
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private fun newVm() = AddFriendViewModel(friendRepository, realtime)

    @Test
    fun `sendFriendRequest adds peer as ACCEPTED friend offline (no P2P needed)`() = runTest(dispatcher) {
        coEvery { friendRepository.isFriend(any()) } returns Result.success(false)
        val captured = slot<FriendEntity>()
        coEvery { friendRepository.addFriend(capture(captured)) } returns Result.success(Unit)
        coEvery { realtime.sendFriendRequest(any(), any()) } just Runs

        val vm = newVm()
        val events = mutableListOf<AddFriendEvent>()
        backgroundScope.launch { vm.eventFlow.collect { events.add(it) } }

        vm.sendFriendRequest("did:key:zPeer12345", "你好")

        // 关键: 落库的好友状态是 ACCEPTED (不是 PENDING), did 为对方。
        assertEquals("did:key:zPeer12345", captured.captured.did)
        assertEquals(FriendStatus.ACCEPTED, captured.captured.status)
        // 提示 + 事件正确, 且 realtime 通知 best-effort 发出。
        assertTrue(events.any { it is AddFriendEvent.ShowToast && it.message == "已添加为好友" })
        assertTrue(events.any { it is AddFriendEvent.FriendRequestSent && it.did == "did:key:zPeer12345" })
        coVerify(exactly = 1) { realtime.sendFriendRequest("did:key:zPeer12345", "你好") }
    }

    @Test
    fun `sendFriendRequest is idempotent when already a friend`() = runTest(dispatcher) {
        coEvery { friendRepository.isFriend(any()) } returns Result.success(true)

        val vm = newVm()
        val events = mutableListOf<AddFriendEvent>()
        backgroundScope.launch { vm.eventFlow.collect { events.add(it) } }

        vm.sendFriendRequest("did:key:zPeer12345")

        coVerify(exactly = 0) { friendRepository.addFriend(any()) }
        assertTrue(events.any { it is AddFriendEvent.ShowToast && it.message == "对方已经是你的好友" })
    }
}
