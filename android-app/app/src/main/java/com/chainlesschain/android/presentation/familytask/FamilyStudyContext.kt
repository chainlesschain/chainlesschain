package com.chainlesschain.android.presentation.familytask

import com.chainlesschain.android.feature.familyguard.domain.model.MemberRole
import com.chainlesschain.android.feature.familyguard.domain.repository.FamilyRelationshipRepository
import com.chainlesschain.android.feature.familyguard.domain.telemetry.ChildIdentityProvider
import kotlinx.coroutines.flow.first
import javax.inject.Inject
import javax.inject.Singleton

/**
 * AI 陪学 当前「孩子」身份的单一真相源 (FAMILY-67 Phase 2)。
 *
 * 任务/积分按 childDid 存取；学情报告也须按**同一** childDid 读积分，否则报告查不到任务侧
 * 赚的分。把这个 DID 收敛到一个可注入的 seam —— [FamilyTaskViewModel] (存储) 与
 * [com.chainlesschain.android.presentation.aistudy.AiStudyViewModel] (报告读) 都经此取 DID，
 * 二者绝不能分叉 (分叉 → 报告积分恒 0)。
 *
 * 解析三段：
 *  1. **孩子端**：经 [ChildIdentityProvider] 取本机真实 child DID (角色 CHILD + 已建身份双闸)。
 *  2. **家长端**：本机非孩子时，从活跃 family_relationship 取 role_other==CHILD 的好友 DID
 *     (= 配对孩子)。多孩子取首个 (选择交互留 UI follow-up)。
 *  3. **未配置**：回落演示常量。
 *
 * suspend：解析要查角色偏好 + DID 库 + 关系库 (IO)。
 */
interface FamilyStudyContext {

    /** 当前学习上下文的孩子 DID (任务存储键 + 报告积分查询键，须一致)。 */
    suspend fun childDid(): String
}

@Singleton
class DefaultFamilyStudyContext @Inject constructor(
    private val childIdentityProvider: ChildIdentityProvider,
    private val relationshipRepository: FamilyRelationshipRepository,
) : FamilyStudyContext {

    override suspend fun childDid(): String {
        // 1) 孩子端：本机即孩子。
        childIdentityProvider.childDidOrNull()?.let { return it }
        // 2) 家长端：配对关系里 role_other==CHILD 的好友 DID (首个活跃孩子)。
        pairedChildDid()?.let { return it }
        // 3) 未配置：回落演示常量。
        return DEMO_CHILD_DID
    }

    private suspend fun pairedChildDid(): String? = runCatching {
        relationshipRepository.observeAllActive().first()
            .firstOrNull { MemberRole.fromStorage(it.roleOther) == MemberRole.CHILD }
            ?.friendDid
    }.getOrNull()

    private companion object {
        const val DEMO_CHILD_DID = "did:chain:local-child"
    }
}
