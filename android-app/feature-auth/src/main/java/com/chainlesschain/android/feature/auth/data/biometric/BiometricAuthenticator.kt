package com.chainlesschain.android.feature.auth.data.biometric

import android.content.Context
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import com.chainlesschain.android.core.common.Result
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.suspendCancellableCoroutine
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.coroutines.resume

/**
 * 生物识别认证器
 */
@Singleton
class BiometricAuthenticator @Inject constructor(
    @ApplicationContext private val context: Context
) {
    private val biometricManager = BiometricManager.from(context)

    /**
     * 检查生物识别是否可用
     */
    fun isBiometricAvailable(): BiometricAvailability {
        return when (biometricManager.canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG)) {
            BiometricManager.BIOMETRIC_SUCCESS ->
                BiometricAvailability.Available

            BiometricManager.BIOMETRIC_ERROR_NO_HARDWARE ->
                BiometricAvailability.NoHardware

            BiometricManager.BIOMETRIC_ERROR_HW_UNAVAILABLE ->
                BiometricAvailability.HardwareUnavailable

            BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED ->
                BiometricAvailability.NoneEnrolled

            BiometricManager.BIOMETRIC_ERROR_SECURITY_UPDATE_REQUIRED ->
                BiometricAvailability.SecurityUpdateRequired

            BiometricManager.BIOMETRIC_ERROR_UNSUPPORTED ->
                BiometricAvailability.Unsupported

            BiometricManager.BIOMETRIC_STATUS_UNKNOWN ->
                BiometricAvailability.Unknown

            else -> BiometricAvailability.Unknown
        }
    }

    /**
     * 进行生物识别认证
     */
    suspend fun authenticate(activity: FragmentActivity): Result<Unit> {
        return suspendCancellableCoroutine { continuation ->
            val executor = ContextCompat.getMainExecutor(context)

            val promptInfo = BiometricPrompt.PromptInfo.Builder()
                .setTitle("ChainlessChain 身份验证")
                .setSubtitle("使用生物识别解锁应用")
                .setNegativeButtonText("取消")
                .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
                .build()

            val biometricPrompt = BiometricPrompt(
                activity,
                executor,
                object : BiometricPrompt.AuthenticationCallback() {
                    override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                        Timber.w("Biometric authentication error: $errorCode - $errString")
                        if (continuation.isActive) {
                            continuation.resume(
                                Result.error(
                                    BiometricAuthException(errorCode, errString.toString()),
                                    errString.toString()
                                )
                            )
                        }
                    }

                    override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                        Timber.d("Biometric authentication succeeded")
                        if (continuation.isActive) {
                            continuation.resume(Result.success(Unit))
                        }
                    }

                    override fun onAuthenticationFailed() {
                        Timber.w("Biometric authentication failed")
                        // 不终止流程，让用户重试
                    }
                }
            )

            continuation.invokeOnCancellation {
                // 取消时清理资源
                Timber.d("Biometric authentication cancelled")
            }

            biometricPrompt.authenticate(promptInfo)
        }
    }

    /**
     * 生物识别可用性状态
     */
    sealed class BiometricAvailability {
        data object Available : BiometricAvailability()
        data object NoHardware : BiometricAvailability()
        data object HardwareUnavailable : BiometricAvailability()
        data object NoneEnrolled : BiometricAvailability()
        data object SecurityUpdateRequired : BiometricAvailability()
        data object Unsupported : BiometricAvailability()
        data object Unknown : BiometricAvailability()

        val isAvailable: Boolean
            get() = this is Available

        val message: String
            get() = when (this) {
                is Available -> "生物识别可用"
                is NoHardware -> "设备不支持生物识别"
                is HardwareUnavailable -> "生物识别硬件暂时不可用"
                is NoneEnrolled -> "未录入生物识别数据，请在系统设置中添加"
                is SecurityUpdateRequired -> "需要系统安全更新"
                is Unsupported -> "不支持生物识别"
                is Unknown -> "生物识别状态未知"
            }
    }

    /**
     * 生物识别异常
     */
    class BiometricAuthException(
        val errorCode: Int,
        message: String
    ) : Exception(message)
}
