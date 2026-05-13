package com.chainlesschain.android.feature.p2p.repository.social

import com.chainlesschain.android.core.did.manager.DIDManager
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class DefaultSelfProfileProviderTest {

    @Test
    fun `returns null when no current DID (logged out)`() = runTest {
        val mgr = mockk<DIDManager>(relaxed = true)
        every { mgr.getCurrentDID() } returns null
        val provider = DefaultSelfProfileProvider(mgr)
        assertNull(provider.loadSelfProfile())
    }

    @Test
    fun `returns DID-suffix placeholder nickname matching MyQRCodeViewModel convention`() = runTest {
        val mgr = mockk<DIDManager>(relaxed = true)
        val fakeDid = "did:key:z6MkpTHR8VNsBxYAAW123hash7890"
        every { mgr.getCurrentDID() } returns fakeDid

        val snapshot = DefaultSelfProfileProvider(mgr).loadSelfProfile()
        requireNotNull(snapshot)
        assertEquals(fakeDid, snapshot.did)
        // 占位规则与 MyQRCodeViewModel.kt L100 保持一致：用 DID 末 8 位
        assertEquals("用户${fakeDid.takeLast(8)}", snapshot.nickname)
        assertNull("默认 provider 不提供头像", snapshot.avatarUrl)
        assertNull("默认 provider 不提供 bio", snapshot.bio)
    }
}
