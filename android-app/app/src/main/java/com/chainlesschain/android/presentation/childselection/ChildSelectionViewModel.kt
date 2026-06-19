package com.chainlesschain.android.presentation.childselection

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.feature.familyguard.domain.model.MemberRole
import com.chainlesschain.android.feature.familyguard.domain.repository.FamilyRelationshipRepository
import com.chainlesschain.android.feature.familyguard.domain.repository.SelectedChildStore
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.launch
import javax.inject.Inject

/** 一个可选的孩子条目。[shortId] 取 DID 末段供 UI 展示 (暂无真实昵称源，留 follow-up)。 */
data class ChildItem(val did: String, val shortId: String)

data class ChildSelectionUiState(
    val children: List<ChildItem> = emptyList(),
    /** 当前选中 (且仍是活跃孩子) 的 DID；null = 未选 (UI 提示按首个看)。 */
    val selectedDid: String? = null,
)

/**
 * 多孩子选择 ViewModel (FAMILY-67 Phase 2)。
 *
 * 家长配对多个孩子时，列出活跃孩子 + 当前选择，让家长切换"当前看哪个孩子"。选择经
 * [SelectedChildStore] 持久，[com.chainlesschain.android.presentation.familytask.FamilyStudyContext]
 * 据此决定任务/积分/报告的 childDid。child 端本机即孩子、无需此屏。
 */
@HiltViewModel
class ChildSelectionViewModel @Inject constructor(
    private val relationshipRepository: FamilyRelationshipRepository,
    private val selectedChildStore: SelectedChildStore,
) : ViewModel() {

    private val _uiState = MutableStateFlow(ChildSelectionUiState())
    val uiState: StateFlow<ChildSelectionUiState> = _uiState.asStateFlow()

    init {
        viewModelScope.launch {
            combine(
                relationshipRepository.observeAllActive(),
                selectedChildStore.observeSelectedChildDid(),
            ) { rels, selected ->
                val children = rels
                    .filter { MemberRole.fromStorage(it.roleOther) == MemberRole.CHILD }
                    .map { ChildItem(it.friendDid, it.friendDid.takeLast(SHORT_ID_LEN)) }
                // 选择失效 (孩子已解绑) → 不高亮，回落逻辑在 FamilyStudyContext。
                val effectiveSelected = selected?.takeIf { sel -> children.any { it.did == sel } }
                ChildSelectionUiState(children = children, selectedDid = effectiveSelected)
            }.collect { _uiState.value = it }
        }
    }

    /** 选某孩子为当前 (持久化)。 */
    fun select(childDid: String) {
        viewModelScope.launch { selectedChildStore.setSelectedChild(childDid) }
    }

    private companion object {
        const val SHORT_ID_LEN = 8
    }
}
