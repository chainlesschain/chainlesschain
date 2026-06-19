package com.chainlesschain.android.presentation.familytask

import com.chainlesschain.android.feature.familyguard.domain.telemetry.ChildIdentityProvider
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
 * 解析：**孩子端**经 [ChildIdentityProvider] 取本机真实 child DID (角色 CHILD + 已建身份双闸)；
 * **家长端 / 未配置**回落演示常量 (家长端按配对关系解析「配对孩子 DID」待真配对流程，follow-up)。
 *
 * suspend：解析要查角色偏好 + DID 库 (IO)。
 */
interface FamilyStudyContext {

    /** 当前学习上下文的孩子 DID (任务存储键 + 报告积分查询键，须一致)。 */
    suspend fun childDid(): String
}

@Singleton
class DefaultFamilyStudyContext @Inject constructor(
    private val childIdentityProvider: ChildIdentityProvider,
) : FamilyStudyContext {

    // 孩子端 = 本机真实 child DID；家长端/未选角色/未建身份 → 回落演示常量。
    override suspend fun childDid(): String =
        childIdentityProvider.childDidOrNull() ?: DEMO_CHILD_DID

    private companion object {
        const val DEMO_CHILD_DID = "did:chain:local-child"
    }
}
