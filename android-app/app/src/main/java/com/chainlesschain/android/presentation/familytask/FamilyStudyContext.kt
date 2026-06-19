package com.chainlesschain.android.presentation.familytask

import javax.inject.Inject
import javax.inject.Singleton

/**
 * AI 陪学 当前「孩子」身份的单一真相源 (FAMILY-67 Phase 2)。
 *
 * 任务/积分按 childDid 存取；学情报告也须按**同一** childDid 读积分，否则报告查不到任务侧
 * 赚的分。把这个 DID 收敛到一个可注入的 seam：
 *  - **现状 (v0.1 演示)**：无配对流程，返回与 [FamilyTaskViewModel] 一致的固定本机 child DID。
 *  - **后续 (真配对)**：改本 impl 内部为 `ChildIdentityProvider.childDidOrNull()` (孩子端=本机 DID)
 *    / family_relationship 解析 (家长端=配对孩子 DID)，**并同步把 [FamilyTaskViewModel] 的
 *    DEMO_CHILD_DID 也切到本 seam**，二者绝不能分叉 (分叉 → 报告积分恒 0)。
 *
 * suspend：未来真解析要查 DID/关系库 (IO)。
 */
interface FamilyStudyContext {

    /** 当前学习上下文的孩子 DID (任务存储键 + 报告积分查询键，须一致)。 */
    suspend fun childDid(): String
}

@Singleton
class DefaultFamilyStudyContext @Inject constructor() : FamilyStudyContext {

    // v0.1：与 FamilyTaskViewModel.DEMO_CHILD_DID 同值 (真配对落地时一并迁移到真实解析)。
    override suspend fun childDid(): String = DEMO_CHILD_DID

    private companion object {
        const val DEMO_CHILD_DID = "did:chain:local-child"
    }
}
