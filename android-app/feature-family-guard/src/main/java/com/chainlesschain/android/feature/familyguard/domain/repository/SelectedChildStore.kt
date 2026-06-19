package com.chainlesschain.android.feature.familyguard.domain.repository

import kotlinx.coroutines.flow.Flow

/**
 * 家长端「当前选中孩子」DID 的持久化 (多孩子选择, FAMILY-67 Phase 2)。
 *
 * 一个家长可配对多个孩子；AI 陪学 的任务/积分/报告都按单一 childDid 存取，需要一个"当前看
 * 哪个孩子"的选择。child 端本机即孩子、无需选择 → 该值仅家长端有意义。
 *
 * 由 [com.chainlesschain.android.presentation.familytask.FamilyStudyContext] 读取 (选中且仍是
 * 活跃孩子则用之，否则回落首个孩子)，由 ChildSelectionViewModel 写入。
 */
interface SelectedChildStore {

    /** 观察当前选中的孩子 DID；null = 未选 (调用方回落首个活跃孩子)。 */
    fun observeSelectedChildDid(): Flow<String?>

    /** 设为当前选中孩子。 */
    suspend fun setSelectedChild(childDid: String)

    /** 清除选择 (解绑该孩子 / 重置时)。 */
    suspend fun clear()
}
