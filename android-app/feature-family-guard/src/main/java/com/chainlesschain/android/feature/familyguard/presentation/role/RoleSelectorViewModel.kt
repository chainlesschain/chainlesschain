package com.chainlesschain.android.feature.familyguard.presentation.role

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.feature.familyguard.domain.model.AppRole
import com.chainlesschain.android.feature.familyguard.domain.model.RoleLockState
import com.chainlesschain.android.feature.familyguard.domain.repository.RolePreferencesRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

/**
 * FAMILY-04 ViewModel. UI state 直接镜像 [RoleLockState] + 用户交互 (transient)。
 *
 * 不在此层做时间裁决 — 24h 锁完全由 Repository 提供, ViewModel 仅做选择 +
 * 错误提示 (例如 "已锁, 无法切换")。
 */
@HiltViewModel
class RoleSelectorViewModel @Inject constructor(
    private val rolePreferencesRepository: RolePreferencesRepository,
) : ViewModel() {

    /**
     * 当前 lock state, lazy 收 Flow; 在订阅停止 5s 后保留最后值, 屏幕重建无闪烁。
     * 初值 [RoleLockState.Unselected] 在 Repository 拉到真实 stored value 前作为
     * 占位 — 真实 state 微秒级 emit 覆盖, 用户感知不到。
     */
    val lockState: StateFlow<RoleLockState> = rolePreferencesRepository
        .observeLockState()
        .stateIn(
            scope = viewModelScope,
            started = SharingStarted.WhileSubscribed(5_000),
            initialValue = RoleLockState.Unselected,
        )

    private val _userMessage = MutableStateFlow<UserMessage?>(null)
    val userMessage: StateFlow<UserMessage?> = _userMessage.asStateFlow()

    fun onRoleClicked(role: AppRole) {
        viewModelScope.launch {
            // Fresh-read 而非读 lockState.value, 原因:
            //   1. stateIn(WhileSubscribed) 在没有 collector 订阅时不会拉
            //      upstream, lockState.value 返回 initialValue (stale)。
            //   2. 用户点击和上一次 Flow emit 之间可能有竞态; 拿最权威的现状。
            when (val current = rolePreferencesRepository.observeLockState().first()) {
                RoleLockState.Unselected -> {
                    rolePreferencesRepository.select(role)
                    _userMessage.value = UserMessage.RoleSelected(role)
                }
                is RoleLockState.LockPending -> {
                    val changed = rolePreferencesRepository.tryChangeRole(role)
                    _userMessage.value = if (changed) {
                        UserMessage.RoleSelected(role)
                    } else {
                        // tryChangeRole 返 false 唯一可能: state 在 first() 之后
                        // 被外部并发改成 Locked, 极小概率但不能假定不会发生。
                        UserMessage.RoleLocked
                    }
                    // 防 lint 抱怨变量未读
                    @Suppress("UNUSED_VARIABLE") val unused = current.role
                }
                is RoleLockState.Locked -> {
                    _userMessage.value = UserMessage.RoleLocked
                }
            }
        }
    }

    fun consumeMessage() {
        _userMessage.value = null
    }

    sealed interface UserMessage {
        data class RoleSelected(val role: AppRole) : UserMessage
        data object RoleLocked : UserMessage
    }
}
