package com.chainlesschain.android.feature.familyguard.presentation.usageaccess

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.feature.familyguard.domain.model.AppRole
import com.chainlesschain.android.feature.familyguard.domain.model.selectedRole
import com.chainlesschain.android.feature.familyguard.domain.repository.RolePreferencesRepository
import com.chainlesschain.android.feature.familyguard.domain.telemetry.ForegroundAppQuery
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn

/**
 * Usage Access 授权卡 ViewModel (FAMILY-20).
 *
 * 把「本机角色」(RolePreferencesRepository) 与「PACKAGE_USAGE_STATS 是否已授予」
 * ([ForegroundAppQuery.isAccessGranted]) 合成卡片可见态 [UsageAccessUiState]:
 *   - 非 CHILD 端 → [UsageAccessUiState.Hidden] (家长端不采前台 app, 不显卡)
 *   - CHILD 端已授权 → [UsageAccessUiState.Granted] (卡隐藏, 不打扰)
 *   - CHILD 端未授权 → [UsageAccessUiState.Denied] (显 CTA, 引导去系统设置)
 *
 * Usage Access 是 appop 特殊权限, 没有 runtime 弹窗 —— 只能跳系统设置让用户手动开,
 * 返回后调 [recheck] 重新查实际授予态。
 */
@HiltViewModel
class UsageAccessViewModel @Inject constructor(
    private val foregroundAppQuery: ForegroundAppQuery,
    rolePreferencesRepository: RolePreferencesRepository,
) : ViewModel() {

    private val granted = MutableStateFlow(foregroundAppQuery.isAccessGranted())

    val uiState: StateFlow<UsageAccessUiState> = combine(
        rolePreferencesRepository.observeLockState(),
        granted,
    ) { lockState, isGranted ->
        when {
            lockState.selectedRole() != AppRole.CHILD -> UsageAccessUiState.Hidden
            isGranted -> UsageAccessUiState.Granted
            else -> UsageAccessUiState.Denied
        }
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(5_000),
        initialValue = UsageAccessUiState.Hidden,
    )

    /** 从系统设置返回后 (onResume) 重新查实际授予态, 刷新卡片可见性。 */
    fun recheck() {
        granted.value = foregroundAppQuery.isAccessGranted()
    }
}

/** Usage Access 卡片可见态。 */
enum class UsageAccessUiState {
    /** 非 CHILD 端 / 未选角色: 不显卡。 */
    Hidden,

    /** CHILD 端已授权: 不显卡 (不打扰)。 */
    Granted,

    /** CHILD 端未授权: 显 CTA 引导去系统设置。 */
    Denied,
}
