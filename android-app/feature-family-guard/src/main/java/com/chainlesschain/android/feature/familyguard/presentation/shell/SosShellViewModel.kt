package com.chainlesschain.android.feature.familyguard.presentation.shell

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.core.did.manager.DIDManager
import com.chainlesschain.android.feature.familyguard.domain.repository.SosEventRepository
import com.chainlesschain.android.feature.familyguard.domain.sos.SosTransitionResult
import com.chainlesschain.android.feature.familyguard.domain.sos.SosTriggerSource
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import timber.log.Timber

/**
 * 家庭 tab SOS 大红按钮的真实触发 (FAMILY-40 接通)。
 *
 * 把 [FamilyShellScreen] 的 SOS click 从 v0.1 的占位 snackbar 升级为真写库:
 *   click → 二次确认 → [SosEventRepository.trigger] 落 pending sos_event
 *         → 展示"已发送 + 5 分钟内可撤销" → 撤销走 cancelAsFalseAlarm。
 *
 * 单机限制: 真实场景 childDid 来自配对 + 角色=CHILD ([ChildIdentityProvider])。
 * 本机若尚未配对 / 选角色, 退化用本机 DID 作触发身份, 让 SOS 在单设备也能跑通
 * (事件落 pending, 状态机/撤销窗口/审计均真实)。广播家长 / 录音 / 硬件触发是
 * 后续 ticket (FAMILY-41/42/43)。
 */
@HiltViewModel
class SosShellViewModel @Inject constructor(
    private val sosEventRepository: SosEventRepository,
    private val didManager: DIDManager,
) : ViewModel() {

    private val _uiState = MutableStateFlow<SosUiState>(SosUiState.Idle)
    val uiState: StateFlow<SosUiState> = _uiState.asStateFlow()

    /** 真正发送一条紧急求助 (二次确认后调用)。 */
    fun triggerSos() {
        if (_uiState.value is SosUiState.Sending) return
        val selfDid = didManager.getCurrentDID()
        if (selfDid.isNullOrBlank()) {
            _uiState.update { SosUiState.Error("请先在「我的」里完成身份设置后再使用紧急求助。") }
            return
        }
        _uiState.update { SosUiState.Sending }
        viewModelScope.launch {
            try {
                val event = sosEventRepository.trigger(
                    childDid = selfDid,
                    familyGroupId = DEFAULT_GROUP_ID,
                    source = SosTriggerSource.IN_APP,
                )
                _uiState.update { SosUiState.Sent(eventId = event.id) }
            } catch (e: Exception) {
                Timber.e(e, "SOS trigger failed")
                _uiState.update { SosUiState.Error("发送失败: ${e.message ?: "未知错误"}") }
            }
        }
    }

    /** 误触撤销 (5 分钟窗口内有效)。 */
    fun cancelAsFalseAlarm(eventId: String) {
        viewModelScope.launch {
            try {
                when (val r = sosEventRepository.cancelAsFalseAlarm(eventId, reason = "用户误触撤销")) {
                    is SosTransitionResult.Success -> _uiState.update { SosUiState.Cancelled }
                    is SosTransitionResult.CancelWindowExpired ->
                        _uiState.update { SosUiState.Error("已超过 5 分钟撤销窗口，无法撤销。") }
                    else -> _uiState.update { SosUiState.Error("撤销失败 ($r)。") }
                }
            } catch (e: Exception) {
                Timber.e(e, "SOS cancel failed")
                _uiState.update { SosUiState.Error("撤销失败: ${e.message ?: "未知错误"}") }
            }
        }
    }

    /** 关闭任意结果提示, 回到初始态。 */
    fun dismiss() {
        _uiState.update { SosUiState.Idle }
    }

    private companion object {
        // 单机退化用的默认家庭组 id (与 FamilyMembersViewModel 占位一致)。
        const val DEFAULT_GROUP_ID = "default-group-id"
    }
}

/** SOS 按钮交互状态。 */
sealed interface SosUiState {
    data object Idle : SosUiState
    data object Sending : SosUiState
    data class Sent(val eventId: String) : SosUiState
    data object Cancelled : SosUiState
    data class Error(val message: String) : SosUiState
}
