package com.chainlesschain.android.core.blockchain.crypto

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
 * Biometric authentication for transaction signing
 * Provides user verification before signing sensitive operations
 */
@Singleton
class BiometricSigner @Inject constructor(
    @ApplicationContext private val context: Context,
    private val keystoreManager: KeystoreManager,
    private val walletCoreAdapter: WalletCoreAdapter
) {
    private val biometricManager = BiometricManager.from(context)

    /**
     * Check if biometric authentication is available
     */
    fun isBiometricAvailable(): BiometricStatus {
        return when (biometricManager.canAuthenticate(
            BiometricManager.Authenticators.BIOMETRIC_STRONG or
                    BiometricManager.Authenticators.DEVICE_CREDENTIAL
        )) {
            BiometricManager.BIOMETRIC_SUCCESS -> BiometricStatus.AVAILABLE
            BiometricManager.BIOMETRIC_ERROR_NO_HARDWARE -> BiometricStatus.NO_HARDWARE
            BiometricManager.BIOMETRIC_ERROR_HW_UNAVAILABLE -> BiometricStatus.HARDWARE_UNAVAILABLE
            BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED -> BiometricStatus.NOT_ENROLLED
            BiometricManager.BIOMETRIC_ERROR_SECURITY_UPDATE_REQUIRED -> BiometricStatus.SECURITY_UPDATE_REQUIRED
            else -> BiometricStatus.UNKNOWN_ERROR
        }
    }

    /**
     * Check if strong biometric (fingerprint, face) is available
     */
    fun isStrongBiometricAvailable(): Boolean {
        return biometricManager.canAuthenticate(
            BiometricManager.Authenticators.BIOMETRIC_STRONG
        ) == BiometricManager.BIOMETRIC_SUCCESS
    }

    /**
     * Sign transaction hash with biometric authentication
     */
    suspend fun signWithBiometric(
        activity: FragmentActivity,
        walletId: String,
        transactionHash: ByteArray,
        title: String = "Confirm Transaction",
        subtitle: String = "Authenticate to sign transaction",
        description: String? = null
    ): Result<ByteArray> {
        // First check if biometric is available
        if (isBiometricAvailable() != BiometricStatus.AVAILABLE) {
            return Result.error(
                BiometricException(BiometricStatus.NO_HARDWARE),
                "Biometric authentication not available"
            )
        }

        // Authenticate user
        val authResult = authenticateUser(activity, title, subtitle, description)
        if (authResult is Result.Error) {
            return authResult
        }

        // Retrieve private key after authentication
        val privateKeyResult = keystoreManager.retrievePrivateKey(walletId)
        if (privateKeyResult is Result.Error) {
            return Result.error(privateKeyResult.exception, privateKeyResult.message)
        }

        val privateKey = (privateKeyResult as Result.Success).data

        // Sign the transaction
        return try {
            val signature = walletCoreAdapter.signHash(transactionHash, privateKey)

            // Clear private key from memory
            privateKey.fill(0)

            signature
        } finally {
            // Ensure private key is cleared even if signing fails
            privateKey.fill(0)
        }
    }

    /**
     * Authenticate user with biometric
     */
    suspend fun authenticateUser(
        activity: FragmentActivity,
        title: String = "Authentication Required",
        subtitle: String = "Verify your identity",
        description: String? = null,
        negativeButtonText: String = "Cancel",
        allowDeviceCredential: Boolean = true
    ): Result<Unit> = suspendCancellableCoroutine { continuation ->
        try {
            val executor = ContextCompat.getMainExecutor(context)

            val callback = object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                    Timber.d("Biometric authentication succeeded")
                    if (continuation.isActive) {
                        continuation.resume(Result.success(Unit))
                    }
                }

                override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                    Timber.w("Biometric authentication error: $errorCode - $errString")
                    if (continuation.isActive) {
                        val status = mapErrorCode(errorCode)
                        continuation.resume(
                            Result.error(
                                BiometricException(status),
                                errString.toString()
                            )
                        )
                    }
                }

                override fun onAuthenticationFailed() {
                    Timber.d("Biometric authentication failed (not recognized)")
                    // Don't complete the continuation - allow retry
                }
            }

            val biometricPrompt = BiometricPrompt(activity, executor, callback)

            val promptInfoBuilder = BiometricPrompt.PromptInfo.Builder()
                .setTitle(title)
                .setSubtitle(subtitle)

            if (description != null) {
                promptInfoBuilder.setDescription(description)
            }

            if (allowDeviceCredential) {
                promptInfoBuilder.setAllowedAuthenticators(
                    BiometricManager.Authenticators.BIOMETRIC_STRONG or
                            BiometricManager.Authenticators.DEVICE_CREDENTIAL
                )
            } else {
                promptInfoBuilder
                    .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
                    .setNegativeButtonText(negativeButtonText)
            }

            val promptInfo = promptInfoBuilder.build()

            biometricPrompt.authenticate(promptInfo)

            continuation.invokeOnCancellation {
                biometricPrompt.cancelAuthentication()
            }
        } catch (e: Exception) {
            Timber.e(e, "Failed to show biometric prompt")
            if (continuation.isActive) {
                continuation.resume(Result.error(e, "Failed to show biometric prompt"))
            }
        }
    }

    /**
     * Confirm sensitive operation with biometric
     */
    suspend fun confirmOperation(
        activity: FragmentActivity,
        operationType: OperationType,
        details: String? = null
    ): Result<Unit> {
        val (title, subtitle) = when (operationType) {
            OperationType.SEND_TRANSACTION -> "Confirm Transaction" to "Authenticate to send"
            OperationType.SIGN_MESSAGE -> "Sign Message" to "Authenticate to sign"
            OperationType.EXPORT_KEY -> "Export Private Key" to "Authenticate to export"
            OperationType.DELETE_WALLET -> "Delete Wallet" to "Authenticate to delete"
            OperationType.CHANGE_SETTINGS -> "Change Settings" to "Authenticate to change"
        }

        return authenticateUser(
            activity = activity,
            title = title,
            subtitle = subtitle,
            description = details
        )
    }

    /**
     * Map biometric error code to status
     */
    private fun mapErrorCode(errorCode: Int): BiometricStatus {
        return when (errorCode) {
            BiometricPrompt.ERROR_CANCELED,
            BiometricPrompt.ERROR_USER_CANCELED,
            BiometricPrompt.ERROR_NEGATIVE_BUTTON -> BiometricStatus.USER_CANCELED

            BiometricPrompt.ERROR_LOCKOUT,
            BiometricPrompt.ERROR_LOCKOUT_PERMANENT -> BiometricStatus.LOCKED_OUT

            BiometricPrompt.ERROR_NO_BIOMETRICS -> BiometricStatus.NOT_ENROLLED

            BiometricPrompt.ERROR_HW_NOT_PRESENT -> BiometricStatus.NO_HARDWARE

            BiometricPrompt.ERROR_HW_UNAVAILABLE -> BiometricStatus.HARDWARE_UNAVAILABLE

            BiometricPrompt.ERROR_TIMEOUT -> BiometricStatus.TIMEOUT

            else -> BiometricStatus.UNKNOWN_ERROR
        }
    }
}

/**
 * Biometric availability status
 */
enum class BiometricStatus {
    AVAILABLE,
    NO_HARDWARE,
    HARDWARE_UNAVAILABLE,
    NOT_ENROLLED,
    SECURITY_UPDATE_REQUIRED,
    USER_CANCELED,
    LOCKED_OUT,
    TIMEOUT,
    UNKNOWN_ERROR
}

/**
 * Operation types requiring biometric confirmation
 */
enum class OperationType {
    SEND_TRANSACTION,
    SIGN_MESSAGE,
    EXPORT_KEY,
    DELETE_WALLET,
    CHANGE_SETTINGS
}

/**
 * Biometric authentication exception
 */
class BiometricException(
    val status: BiometricStatus
) : Exception("Biometric authentication failed: $status")
