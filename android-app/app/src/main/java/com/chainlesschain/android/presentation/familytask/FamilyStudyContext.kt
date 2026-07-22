package com.chainlesschain.android.presentation.familytask

<<<<<<< Updated upstream
import com.chainlesschain.android.feature.familyguard.domain.model.MemberRole
import com.chainlesschain.android.feature.familyguard.domain.repository.FamilyRelationshipRepository
import com.chainlesschain.android.feature.familyguard.domain.repository.SelectedChildStore
import com.chainlesschain.android.feature.familyguard.domain.telemetry.ChildIdentityProvider
import kotlinx.coroutines.flow.first
=======
>>>>>>> Stashed changes
import javax.inject.Inject
import javax.inject.Singleton

/**
 * AI 陪学 当前「孩子」身份的单一真相源 (FAMILY-67 Phase 2)。
 *
 * 任务/积分按 childDid 存取；学情报告也须按**同一** childDid 读积分，否则报告查不到任务侧
<<<<<<< Updated upstream
 * 赚的分。把这个 DID 收敛到一个可注入的 seam —— [FamilyTaskViewModel] (存储) 与
 * [com.chainlesschain.android.presentation.aistudy.AiStudyViewModel] (报告读) 都经此取 DID，
 * 二者绝不能分叉 (分叉 → 报告积分恒 0)。
 *
 * 解析三段：
 *  1. **孩子端**：经 [ChildIdentityProvider] 取本机真实 child DID (角色 CHILD + 已建身份双闸)。
 *  2. **家长端**：本机非孩子时，从活跃 family_relationship 取 role_other==CHILD 的好友 DID。
 *     多孩子时用 [SelectedChildStore] 的当前选择 (选中且仍是活跃孩子)，否则回落首个活跃孩子。
 *  3. **未配置**：回落演示常量。
 *
 * suspend：解析要查角色偏好 + DID 库 + 关系库 + 选择偏好 (IO)。
=======
 * 赚的分。把这个 DID 收敛到一个可注入的 seam：
 *  - **现状 (v0.1 演示)**：无配对流程，返回与 [FamilyTaskViewModel] 一致的固定本机 child DID。
 *  - **后续 (真配对)**：改本 impl 内部为 `ChildIdentityProvider.childDidOrNull()` (孩子端=本机 DID)
 *    / family_relationship 解析 (家长端=配对孩子 DID)，**并同步把 [FamilyTaskViewModel] 的
 *    DEMO_CHILD_DID 也切到本 seam**，二者绝不能分叉 (分叉 → 报告积分恒 0)。
 *
 * suspend：未来真解析要查 DID/关系库 (IO)。
>>>>>>> Stashed changes
 */
interface FamilyStudyContext {

    /** 当前学习上下文的孩子 DID (任务存储键 + 报告积分查询键，须一致)。 */
    suspend fun childDid(): String
}

@Singleton
<<<<<<< Updated upstream
class DefaultFamilyStudyContext @Inject constructor(
    private val childIdentityProvider: ChildIdentityProvider,
    private val relationshipRepository: FamilyRelationshipRepository,
    private val selectedChildStore: SelectedChildStore,
) : FamilyStudyContext {

    override suspend fun childDid(): String {
        // 1) 孩子端：本机即孩子。
        childIdentityProvider.childDidOrNull()?.let { return it }
        // 2) 家长端：当前选中孩子 (多孩子) / 首个活跃孩子。
        pairedChildDid()?.let { return it }
        // 3) 未配置：回落演示常量。
        return DEMO_CHILD_DID
    }

    private suspend fun pairedChildDid(): String? = runCatching {
        val children = relationshipRepository.observeAllActive().first()
            .filter { MemberRole.fromStorage(it.roleOther) == MemberRole.CHILD }
            .map { it.friendDid }
        if (children.isEmpty()) return@runCatching null
        // 选中且仍是活跃孩子 → 用之；否则首个 (选择失效/未选时的稳定回落)。
        val selected = selectedChildStore.observeSelectedChildDid().first()
        selected?.takeIf { it in children } ?: children.first()
    }.getOrNull()
=======
class DefaultFamilyStudyContext @Inject constructor() : FamilyStudyContext {

    // v0.1：与 FamilyTaskViewModel.DEMO_CHILD_DID 同值 (真配对落地时一并迁移到真实解析)。
    override suspend fun childDid(): String = DEMO_CHILD_DID
>>>>>>> Stashed changes

    private companion object {
        const val DEMO_CHILD_DID = "did:chain:local-child"
    }
}
