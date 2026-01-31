package com.chainlesschain.android.feature.p2p.viewmodel.social

import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.core.did.manager.DIDManager
import com.chainlesschain.android.core.ui.components.QRCodeGenerator
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import timber.log.Timber
import javax.inject.Inject

/**
 * 二维码扫描ViewModel
 *
 * 功能：
 * - 处理扫描到的二维码
 * - 验证签名
 * - 解析二维码数据
 * - 手电筒控制
 *
 * @since v0.31.0
 */
@HiltViewModel
class QRCodeScannerViewModel @Inject constructor(
    private val didManager: DIDManager
) : ViewModel() {

    /**
     * UI状态
     */
    data class QRCodeScannerUiState(
        val isFlashlightOn: Boolean = false,
        val isProcessing: Boolean = false,
        val lastScannedQRCode: String? = null
    )

    private val _uiState = MutableStateFlow(QRCodeScannerUiState())
    val uiState: StateFlow<QRCodeScannerUiState> = _uiState.asStateFlow()

    private val _events = MutableSharedFlow<QRCodeScannerEvent>()
    val events: SharedFlow<QRCodeScannerEvent> = _events.asSharedFlow()

    /**
     * 切换手电筒
     */
    fun toggleFlashlight() {
        _uiState.update { it.copy(isFlashlightOn = !it.isFlashlightOn) }
        Timber.d("Flashlight toggled: ${_uiState.value.isFlashlightOn}")
    }

    /**
     * 处理扫描到的二维码
     */
    fun processQRCode(qrCode: String) = viewModelScope.launch {
        // 防止重复处理同一个二维码
        if (_uiState.value.lastScannedQRCode == qrCode && _uiState.value.isProcessing) {
            return@launch
        }

        _uiState.update {
            it.copy(
                isProcessing = true,
                lastScannedQRCode = qrCode
            )
        }

        try {
            // 验证二维码格式
            if (!QRCodeGenerator.isValidChainlessChainQRCode(qrCode)) {
                _events.emit(QRCodeScannerEvent.ScanError("无效的二维码格式"))
                _uiState.update { it.copy(isProcessing = false) }
                return@launch
            }

            // 解析二维码内容
            val qrCodeData = parseQRCode(qrCode)
            when (qrCodeData) {
                is QRCodeData.AddFriend -> {
                    // 验证签名
                    val isValid = verifyDIDSignature(
                        qrCodeData.did,
                        qrCodeData.signature,
                        qrCodeData.timestamp
                    )

                    if (!isValid) {
                        _events.emit(QRCodeScannerEvent.ScanError("签名验证失败"))
                        _uiState.update { it.copy(isProcessing = false) }
                        return@launch
                    }

                    // 检查时间戳（24小时内有效）
                    val now = System.currentTimeMillis()
                    if (now - qrCodeData.timestamp > 24 * 60 * 60 * 1000) {
                        _events.emit(QRCodeScannerEvent.ScanError("二维码已过期（有效期24小时）"))
                        _uiState.update { it.copy(isProcessing = false) }
                        return@launch
                    }

                    // 扫描成功
                    _events.emit(QRCodeScannerEvent.ScanSuccess(qrCode))
                    Timber.d("QR code scan success: AddFriend - ${qrCodeData.did}")
                }

                is QRCodeData.PostShare -> {
                    _events.emit(QRCodeScannerEvent.ScanSuccess(qrCode))
                    Timber.d("QR code scan success: PostShare - ${qrCodeData.postId}")
                }

                is QRCodeData.GroupInvite -> {
                    _events.emit(QRCodeScannerEvent.ScanSuccess(qrCode))
                    Timber.d("QR code scan success: GroupInvite - ${qrCodeData.groupId}")
                }

                is QRCodeData.Unknown -> {
                    _events.emit(QRCodeScannerEvent.ScanError("未知的二维码类型"))
                }
            }
        } catch (e: Exception) {
            Timber.e(e, "Failed to process QR code")
            _events.emit(QRCodeScannerEvent.ScanError("处理失败：${e.message}"))
        } finally {
            _uiState.update { it.copy(isProcessing = false) }
        }
    }

    /**
     * 解析二维码内容
     */
    private fun parseQRCode(qrCode: String): QRCodeData {
        return try {
            val uri = Uri.parse(qrCode)
            when (uri.host) {
                "add-friend" -> {
                    val did = uri.getQueryParameter("did")
                        ?: return QRCodeData.Unknown("Missing did parameter")
                    val signature = uri.getQueryParameter("sig")
                        ?: return QRCodeData.Unknown("Missing sig parameter")
                    val timestamp = uri.getQueryParameter("ts")?.toLongOrNull()
                        ?: return QRCodeData.Unknown("Invalid timestamp")

                    QRCodeData.AddFriend(did, signature, timestamp)
                }

                "post" -> {
                    val postId = uri.getQueryParameter("id")
                        ?: return QRCodeData.Unknown("Missing post id")
                    QRCodeData.PostShare(postId)
                }

                "group" -> {
                    val groupId = uri.getQueryParameter("id")
                        ?: return QRCodeData.Unknown("Missing group id")
                    val inviteCode = uri.getQueryParameter("invite")
                        ?: return QRCodeData.Unknown("Missing invite code")
                    QRCodeData.GroupInvite(groupId, inviteCode)
                }

                else -> QRCodeData.Unknown("Unknown host: ${uri.host}")
            }
        } catch (e: Exception) {
            Timber.e(e, "Failed to parse QR code")
            QRCodeData.Unknown("Parse error: ${e.message}")
        }
    }

    /**
     * 验证DID签名
     */
    private suspend fun verifyDIDSignature(
        did: String,
        signatureHex: String,
        timestamp: Long
    ): Boolean {
        return try {
            // 将十六进制签名转换为字节数组
            val signature = hexToBytes(signatureHex)

            // 验证签名（参数顺序：message, signature, did）
            val message = timestamp.toString()
            didManager.verify(message.toByteArray(), signature, did)
        } catch (e: Exception) {
            Timber.e(e, "Signature verification failed")
            false
        }
    }

    /**
     * 十六进制字符串转字节数组
     */
    private fun hexToBytes(hex: String): ByteArray {
        val cleanHex = hex.removePrefix("0x")
        return cleanHex.chunked(2)
            .map { it.toInt(16).toByte() }
            .toByteArray()
    }
}

/**
 * 二维码数据
 */
sealed class QRCodeData {
    /** 添加好友 */
    data class AddFriend(
        val did: String,
        val signature: String,
        val timestamp: Long
    ) : QRCodeData()

    /** 动态分享 */
    data class PostShare(val postId: String) : QRCodeData()

    /** 群组邀请 */
    data class GroupInvite(
        val groupId: String,
        val inviteCode: String
    ) : QRCodeData()

    /** 未知类型 */
    data class Unknown(val reason: String) : QRCodeData()
}

/**
 * 扫描事件
 */
sealed class QRCodeScannerEvent {
    /** 扫描成功 */
    data class ScanSuccess(val qrCode: String) : QRCodeScannerEvent()

    /** 扫描错误 */
    data class ScanError(val message: String) : QRCodeScannerEvent()
}
