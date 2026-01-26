package com.chainlesschain.android.feature.p2p.viewmodel.social

import android.content.ContentValues
import android.content.Context
import android.graphics.Bitmap
import android.os.Environment
import android.provider.MediaStore
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.core.did.manager.DIDManager
import com.chainlesschain.android.core.ui.components.QRCodeGenerator
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import timber.log.Timber
import java.io.OutputStream
import javax.inject.Inject

/**
 * 我的二维码ViewModel
 *
 * 功能：
 * - 生成个人DID二维码（含签名）
 * - 保存二维码到相册
 * - 分享二维码
 *
 * @since v0.31.0
 */
@HiltViewModel
class MyQRCodeViewModel @Inject constructor(
    @ApplicationContext private val context: Context,
    private val didManager: DIDManager
) : ViewModel() {

    /**
     * UI状态
     */
    data class MyQRCodeUiState(
        val did: String = "",
        val nickname: String = "",
        val avatarUrl: String? = null,
        val qrCodeBitmap: Bitmap? = null,
        val isLoading: Boolean = false,
        val errorMessage: String? = null
    )

    private val _uiState = MutableStateFlow(MyQRCodeUiState())
    val uiState: StateFlow<MyQRCodeUiState> = _uiState.asStateFlow()

    private val _events = MutableSharedFlow<MyQRCodeEvent>()
    val events: SharedFlow<MyQRCodeEvent> = _events.asSharedFlow()

    /**
     * 生成二维码
     */
    fun generateQRCode() = viewModelScope.launch {
        _uiState.update { it.copy(isLoading = true, errorMessage = null) }

        try {
            // 获取当前用户DID身份
            val identity = didManager.currentIdentity.value
                ?: throw IllegalStateException("用户身份未初始化，请先完成注册")

            val myDid = identity.did

            // 生成时间戳并签名（防止二维码被复制滥用）
            val timestamp = System.currentTimeMillis().toString()
            val signatureBytes = didManager.sign(timestamp)
            val signature = bytesToHex(signatureBytes)

            // 生成二维码内容（URL格式）
            val qrContent = QRCodeGenerator.generateDIDQRCode(myDid, signature)

            // 生成二维码图片
            val qrBitmap = QRCodeGenerator.generateQRCode(
                content = qrContent,
                size = 512
                // 可选：添加App Logo
                // logo = BitmapFactory.decodeResource(context.resources, R.drawable.app_logo)
            )

            _uiState.update {
                it.copy(
                    did = myDid,
                    nickname = "用户${myDid.takeLast(8)}", // TODO: 从用户资料获取昵称
                    avatarUrl = null, // TODO: 从用户资料获取头像
                    qrCodeBitmap = qrBitmap,
                    isLoading = false
                )
            }

            Timber.d("QR code generated successfully for DID: $myDid")
        } catch (e: Exception) {
            Timber.e(e, "Failed to generate QR code")
            _uiState.update {
                it.copy(
                    isLoading = false,
                    errorMessage = "生成二维码失败：${e.message}"
                )
            }
            _events.emit(MyQRCodeEvent.GenerateError(e.message ?: "未知错误"))
        }
    }

    /**
     * 保存二维码到相册
     */
    fun saveToGallery() = viewModelScope.launch {
        val bitmap = _uiState.value.qrCodeBitmap
        if (bitmap == null) {
            _events.emit(MyQRCodeEvent.SaveError("二维码未生成"))
            return@launch
        }

        try {
            val fileName = "ChainlessChain_QR_${System.currentTimeMillis()}.png"

            // Android 10+ 使用MediaStore API
            val contentValues = ContentValues().apply {
                put(MediaStore.Images.Media.DISPLAY_NAME, fileName)
                put(MediaStore.Images.Media.MIME_TYPE, "image/png")
                put(MediaStore.Images.Media.RELATIVE_PATH, "${Environment.DIRECTORY_PICTURES}/ChainlessChain")
                put(MediaStore.Images.Media.IS_PENDING, 1)
            }

            val resolver = context.contentResolver
            val imageUri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, contentValues)

            imageUri?.let { uri ->
                // 写入图片数据
                val outputStream: OutputStream? = resolver.openOutputStream(uri)
                outputStream?.use {
                    bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)
                }

                // 标记为已完成
                contentValues.clear()
                contentValues.put(MediaStore.Images.Media.IS_PENDING, 0)
                resolver.update(uri, contentValues, null, null)

                Timber.d("QR code saved to gallery: $uri")
                _events.emit(MyQRCodeEvent.SaveSuccess(uri.toString()))
            } ?: run {
                Timber.e("Failed to create image URI")
                _events.emit(MyQRCodeEvent.SaveError("无法保存图片"))
            }
        } catch (e: Exception) {
            Timber.e(e, "Failed to save QR code to gallery")
            _events.emit(MyQRCodeEvent.SaveError(e.message ?: "保存失败"))
        }
    }

    /**
     * 分享二维码
     */
    fun shareQRCode() = viewModelScope.launch {
        // TODO: 实现分享功能（将在后续实现）
        // 可以使用Android ShareSheet或生成临时文件后分享
        _events.emit(MyQRCodeEvent.ShareTriggered)
        Timber.d("Share QR code triggered")
    }

    /**
     * 字节数组转十六进制字符串
     */
    private fun bytesToHex(bytes: ByteArray): String {
        return bytes.joinToString("") { "%02x".format(it) }
    }
}

/**
 * 我的二维码事件
 */
sealed class MyQRCodeEvent {
    /** 生成错误 */
    data class GenerateError(val message: String) : MyQRCodeEvent()

    /** 保存成功 */
    data class SaveSuccess(val uri: String) : MyQRCodeEvent()

    /** 保存错误 */
    data class SaveError(val message: String) : MyQRCodeEvent()

    /** 分享触发 */
    object ShareTriggered : MyQRCodeEvent()
}
