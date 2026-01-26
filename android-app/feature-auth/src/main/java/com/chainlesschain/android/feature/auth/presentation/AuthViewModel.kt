package com.chainlesschain.android.feature.auth.presentation

import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.core.common.Result
import com.chainlesschain.android.feature.auth.data.biometric.BiometricAuthenticator
import com.chainlesschain.android.feature.auth.data.repository.AuthRepository
import com.chainlesschain.android.feature.auth.domain.model.User
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import timber.log.Timber
import javax.inject.Inject

/**
 * 认证ViewModel
 */
@HiltViewModel
class AuthViewModel @Inject constructor(
    private val authRepository: AuthRepository,
    private val biometricAuthenticator: BiometricAuthenticator
) : ViewModel() {

    private val _uiState = MutableStateFlow(AuthUiState())
    val uiState: StateFlow<AuthUiState> = _uiState.asStateFlow()

    init {
        checkSetupStatus()
        checkBiometricAvailability()
    }

    /**
     * 检查是否已完成初始设置
     */
    private fun checkSetupStatus() {
        viewModelScope.launch {
            val isSetupComplete = authRepository.isSetupComplete()
            _uiState.update { it.copy(isSetupComplete = isSetupComplete) }

            // 如果已设置，检查是否启用生物识别
            if (isSetupComplete) {
                val user = authRepository.getCurrentUser()
                _uiState.update { it.copy(biometricEnabled = user?.biometricEnabled ?: false) }
            }
        }
    }

    /**
     * 检查生物识别可用性
     */
    private fun checkBiometricAvailability() {
        val availability = biometricAuthenticator.isBiometricAvailable()
        _uiState.update {
            it.copy(
                biometricAvailable = availability.isAvailable,
                biometricMessage = availability.message
            )
        }
    }

    /**
     * 设置PIN码（注册）
     */
    fun setupPIN(pin: String) {
        if (pin.length != 6) {
            _uiState.update { it.copy(error = "PIN码必须是6位数字") }
            return
        }

        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }

            when (val result = authRepository.register(pin)) {
                is Result.Success -> {
                    Timber.d("PIN setup successful")
                    _uiState.update {
                        it.copy(
                            isLoading = false,
                            isSetupComplete = true,
                            isAuthenticated = true,
                            currentUser = result.data
                        )
                    }
                }

                is Result.Error -> {
                    Timber.e(result.exception, "PIN setup failed")
                    _uiState.update {
                        it.copy(
                            isLoading = false,
                            error = result.message ?: "设置PIN码失败"
                        )
                    }
                }

                else -> {}
            }
        }
    }

    /**
     * 验证PIN码（登录）
     */
    fun verifyPIN(pin: String) {
        if (pin.length != 6) {
            _uiState.update { it.copy(error = "PIN码必须是6位数字") }
            return
        }

        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }

            when (val result = authRepository.verifyPIN(pin)) {
                is Result.Success -> {
                    Timber.d("PIN verification successful, user=${result.data?.id}")
                    _uiState.update {
                        it.copy(
                            isLoading = false,
                            isAuthenticated = true,
                            currentUser = result.data,
                            error = null
                        )
                    }
                    Timber.d("uiState updated: isAuthenticated=${_uiState.value.isAuthenticated}, currentUser=${_uiState.value.currentUser?.id}")
                }

                is Result.Error -> {
                    Timber.w("PIN verification failed")
                    _uiState.update {
                        it.copy(
                            isLoading = false,
                            error = result.message ?: "PIN码错误",
                            pinAttempts = it.pinAttempts + 1
                        )
                    }
                }

                else -> {}
            }
        }
    }

    /**
     * 生物识别认证
     */
    fun authenticateWithBiometric(activity: FragmentActivity) {
        if (!_uiState.value.biometricAvailable) {
            _uiState.update { it.copy(error = "生物识别不可用") }
            return
        }

        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }

            when (val result = biometricAuthenticator.authenticate(activity)) {
                is Result.Success -> {
                    Timber.d("Biometric authentication successful")
                    // 生物识别成功后，获取当前用户信息
                    val user = authRepository.getCurrentUser()
                    _uiState.update {
                        it.copy(
                            isLoading = false,
                            isAuthenticated = true,
                            currentUser = user
                        )
                    }
                }

                is Result.Error -> {
                    Timber.w("Biometric authentication failed")
                    _uiState.update {
                        it.copy(
                            isLoading = false,
                            error = result.message ?: "生物识别失败"
                        )
                    }
                }

                else -> {}
            }
        }
    }

    /**
     * 启用生物识别
     */
    fun enableBiometric(activity: FragmentActivity) {
        viewModelScope.launch {
            // 先进行一次生物识别测试
            when (biometricAuthenticator.authenticate(activity)) {
                is Result.Success -> {
                    authRepository.setBiometricEnabled(true)
                    _uiState.update { it.copy(biometricEnabled = true) }
                    Timber.d("Biometric enabled")
                }

                is Result.Error -> {
                    _uiState.update { it.copy(error = "生物识别验证失败") }
                }

                else -> {}
            }
        }
    }

    /**
     * 禁用生物识别
     */
    fun disableBiometric() {
        viewModelScope.launch {
            authRepository.setBiometricEnabled(false)
            _uiState.update { it.copy(biometricEnabled = false) }
            Timber.d("Biometric disabled")
        }
    }

    /**
     * 清除错误
     */
    fun clearError() {
        _uiState.update { it.copy(error = null) }
    }

    /**
     * 退出登录
     */
    fun logout() {
        viewModelScope.launch {
            authRepository.logout()
            _uiState.update {
                it.copy(
                    isAuthenticated = false,
                    currentUser = null,
                    error = null
                )
                // 保持 isSetupComplete = true，因为PIN码仍然存在
            }
        }
    }
}

/**
 * 认证UI状态
 */
data class AuthUiState(
    val isLoading: Boolean = false,
    val isSetupComplete: Boolean = false,
    val isAuthenticated: Boolean = false,
    val currentUser: User? = null,
    val error: String? = null,
    val pinAttempts: Int = 0,
    val biometricAvailable: Boolean = false,
    val biometricEnabled: Boolean = false,
    val biometricMessage: String? = null
)
