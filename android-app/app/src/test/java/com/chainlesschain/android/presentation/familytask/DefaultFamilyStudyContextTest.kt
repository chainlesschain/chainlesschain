package com.chainlesschain.android.presentation.familytask

import com.chainlesschain.android.feature.familyguard.data.entity.FamilyRelationshipEntity
import com.chainlesschain.android.feature.familyguard.domain.repository.FamilyRelationshipRepository
import com.chainlesschain.android.feature.familyguard.domain.telemetry.ChildIdentityProvider
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

class DefaultFamilyStudyContextTest {

    private fun rel(friendDid: String, roleOther: String) = FamilyRelationshipEntity(
        id = 1L, familyGroupId = "fg", friendDid = friendDid,
        roleSelf = "parent", roleOther = roleOther, boundAt = 1L,
        permissions = "{}", status = "active", createdAt = 1L, updatedAt = 1L,
    )

    private fun ctx(
        childDid: String?,
        relations: List<FamilyRelationshipEntity> = emptyList(),
    ): DefaultFamilyStudyContext {
        val rels = mockk<FamilyRelationshipRepository>(relaxed = true)
        every { rels.observeAllActive() } returns flowOf(relations)
        return DefaultFamilyStudyContext(
            object : ChildIdentityProvider {
                override suspend fun childDidOrNull(): String? = childDid
            },
            rels,
        )
    }

    @Test
    fun `child device resolves own real child DID (relationship not consulted)`() = runTest {
        assertEquals("did:key:real-child", ctx("did:key:real-child").childDid())
    }

    @Test
    fun `parent device resolves paired child DID from active relationship`() = runTest {
        val did = ctx(
            childDid = null, // 非孩子端
            relations = listOf(
                rel("did:key:other-parent", "parent"), // 忽略非孩子关系
                rel("did:key:paired-child", "child"),
            ),
        ).childDid()
        assertEquals("did:key:paired-child", did)
    }

    @Test
    fun `falls back to demo DID when not child and no paired child relationship`() = runTest {
        // 与 FamilyTaskViewModel 任务侧回落同值 → 报告积分查询键一致 (不分叉)。
        assertEquals("did:chain:local-child", ctx(null).childDid())
    }
}
