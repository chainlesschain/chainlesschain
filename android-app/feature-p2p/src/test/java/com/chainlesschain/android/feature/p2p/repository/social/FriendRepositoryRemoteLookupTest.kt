package com.chainlesschain.android.feature.p2p.repository.social

import com.chainlesschain.android.core.common.Result
import com.chainlesschain.android.core.database.dao.social.BlockedUserDao
import com.chainlesschain.android.core.database.dao.social.FriendDao
import com.chainlesschain.android.core.database.entity.social.FriendEntity
import com.chainlesschain.android.core.database.entity.social.FriendStatus
import com.chainlesschain.android.core.p2p.discovery.NSDDiscovery
import com.chainlesschain.android.core.p2p.realtime.RealtimeEventManager
import com.chainlesschain.android.core.p2p.realtime.SelfProfileSnapshot
import dagger.Lazy
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * FriendRepository.searchUserByDid 路径测试
 *
 * 验证 v0.x demo 残余被真正修掉：
 * - 本地命中：不走 P2P
 * - 本地未命中：调 RealtimeEventManager.queryProfile，命中即返回
 * - 远端超时：返回 null（不抛错）
 */
@OptIn(ExperimentalCoroutinesApi::class)
class FriendRepositoryRemoteLookupTest {

    private lateinit var friendDao: FriendDao
    private lateinit var blockedDao: BlockedUserDao
    private lateinit var nsd: NSDDiscovery
    private lateinit var realtime: RealtimeEventManager
    private lateinit var syncAdapter: Lazy<SocialSyncAdapter>
    private lateinit var repo: FriendRepository

    @Before
    fun setup() {
        friendDao = mockk(relaxed = true)
        blockedDao = mockk(relaxed = true)
        nsd = mockk(relaxed = true)
        realtime = mockk(relaxed = true)
        syncAdapter = Lazy { mockk<SocialSyncAdapter>(relaxed = true) }
        repo = FriendRepository(
            friendDao = friendDao,
            blockedUserDao = blockedDao,
            nsdDiscovery = nsd,
            realtimeEventManager = realtime,
            syncAdapter = syncAdapter
        )
    }

    @Test
    fun `searchUserByDid uses local friend record when present`() = runTest {
        val local = FriendEntity(
            did = "did:key:friend",
            nickname = "Alice",
            avatar = "a.png",
            bio = "bio",
            status = FriendStatus.ACCEPTED,
            addedAt = 0L
        )
        coEvery { friendDao.getFriendByDid("did:key:friend") } returns local

        val result = repo.searchUserByDid("did:key:friend")
        assertTrue(result is Result.Success)
        val data = (result as Result.Success).data
        assertNotNull(data)
        assertEquals("Alice", data!!.nickname)
        assertEquals(true, data.isFriend)
        // 本地命中——不应触发 P2P 查询，节省流量
        coVerify(exactly = 0) { realtime.queryProfile(any(), any()) }
    }

    @Test
    fun `searchUserByDid falls back to P2P query when DID not local`() = runTest {
        coEvery { friendDao.getFriendByDid("did:key:remote") } returns null
        coEvery { realtime.queryProfile("did:key:remote", any()) } returns SelfProfileSnapshot(
            did = "did:key:remote",
            nickname = "Bob",
            avatarUrl = null,
            bio = "remote bio"
        )

        val result = repo.searchUserByDid("did:key:remote")
        assertTrue(result is Result.Success)
        val data = (result as Result.Success).data
        assertNotNull("远端命中应返回非空 UserSearchResult", data)
        assertEquals("Bob", data!!.nickname)
        assertEquals("remote bio", data.bio)
        assertEquals("远端用户默认 isFriend=false", false, data.isFriend)
        coVerify(exactly = 1) { realtime.queryProfile("did:key:remote", any()) }
    }

    @Test
    fun `searchUserByDid returns null Success on P2P timeout`() = runTest {
        coEvery { friendDao.getFriendByDid("did:key:absent") } returns null
        coEvery { realtime.queryProfile("did:key:absent", any()) } returns null

        val result = repo.searchUserByDid("did:key:absent")
        // 重要：超时不抛错——UI 应显示"未找到"，不要弹错误对话框
        assertTrue("超时返回 Result.Success(null) 而非 Error", result is Result.Success)
        assertNull((result as Result.Success).data)
    }

    @Test
    fun `searchUserByDid wraps DAO exception as Result-Error`() = runTest {
        coEvery { friendDao.getFriendByDid("did:key:x") } throws RuntimeException("db corrupted")

        val result = repo.searchUserByDid("did:key:x")
        assertTrue("DAO 异常应包装为 Result.Error", result is Result.Error)
    }
}
