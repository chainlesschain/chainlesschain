package com.chainlesschain.android.presentation.familytask

import com.chainlesschain.android.feature.familyguard.domain.telemetry.ChildIdentityProvider
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

class DefaultFamilyStudyContextTest {

    private fun ctx(did: String?) = DefaultFamilyStudyContext(
        object : ChildIdentityProvider {
            override suspend fun childDidOrNull(): String? = did
        },
    )

    @Test
    fun `resolves real child DID on child device`() = runTest {
        assertEquals("did:key:real-child", ctx("did:key:real-child").childDid())
    }

    @Test
    fun `falls back to demo DID when no child identity (parent or unconfigured)`() = runTest {
        // 与 FamilyTaskViewModel 任务侧回落同值 → 报告积分查询键一致 (不分叉)。
        assertEquals("did:chain:local-child", ctx(null).childDid())
    }
}
