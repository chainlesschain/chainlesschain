package com.chainlesschain.android.remote.ui.desktop

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Base64
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.remote.commands.DesktopCommands
import com.chainlesschain.android.remote.commands.DisplayInfo
import com.chainlesschain.android.remote.commands.StatsResponse
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * 远程桌面 ViewModel
 *
 * 管理远程桌面会话状态和屏幕帧更新
 */
@HiltViewModel
class RemoteDesktopViewModel @Inject constructor(
    private val desktopCommands: DesktopCommands
) : ViewModel() {

    private val _uiState = MutableStateFlow(RemoteDesktopUiState())
    val uiState: StateFlow<RemoteDesktopUiState> = _uiState.asStateFlow()

    private val _currentFrame = MutableStateFlow<Bitmap?>(null)
    val currentFrame: StateFlow<Bitmap?> = _currentFrame.asStateFlow()

    private val _displays = MutableStateFlow<List<DisplayInfo>>(emptyList())
    val displays: StateFlow<List<DisplayInfo>> = _displays.asStateFlow()

    private val _statistics = MutableStateFlow<StatsResponse?>(null)
    val statistics: StateFlow<StatsResponse?> = _statistics.asStateFlow()

    private var frameUpdateJob: Job? = null
    private var sessionId: String? = null
    private var deviceDid: String? = null

    /**
     * 开始远程桌面会话
     */
    fun startSession(
        did: String,
        displayId: Int? = null,
        quality: Int = 80,
        maxFps: Int = 30
    ) {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }

            try {
                // 1. 开始会话
                val result = desktopCommands.startSession(
                    displayId = displayId,
                    quality = quality,
                    maxFps = maxFps
                )

                result.fold(
                    onSuccess = { response ->
                        sessionId = response.sessionId
                        deviceDid = did

                        _uiState.update {
                            it.copy(
                                isLoading = false,
                                isConnected = true,
                                sessionId = response.sessionId,
                                quality = response.quality,
                                maxFps = response.maxFps,
                                captureInterval = response.captureInterval,
                                inputControlEnabled = response.inputControlEnabled,
                                currentDisplay = displayId ?: response.displays.firstOrNull { it.primary == true }?.id
                            )
                        }

                        _displays.value = response.displays

                        // 2. 开始帧更新循环
                        startFrameUpdateLoop(response.captureInterval)
                    },
                    onFailure = { error ->
                        _uiState.update {
                            it.copy(
                                isLoading = false,
                                error = "启动会话失败: ${error.message}"
                            )
                        }
                    }
                )
            } catch (e: Exception) {
                _uiState.update {
                    it.copy(
                        isLoading = false,
                        error = "启动会话异常: ${e.message}"
                    )
                }
            }
        }
    }

    /**
     * 停止远程桌面会话
     */
    fun stopSession() {
        viewModelScope.launch {
            val sid = sessionId ?: return@launch

            try {
                // 停止帧更新循环
                frameUpdateJob?.cancel()
                frameUpdateJob = null

                // 停止会话
                desktopCommands.stopSession(sid).fold(
                    onSuccess = { response ->
                        _uiState.update {
                            it.copy(
                                isConnected = false,
                                sessionId = null,
                                totalFrames = response.frameCount,
                                totalBytes = response.bytesSent,
                                duration = response.duration
                            )
                        }

                        // 清空当前帧并回收内存
                        _currentFrame.value?.recycle()
                        _currentFrame.value = null
                    },
                    onFailure = { error ->
                        _uiState.update {
                            it.copy(
                                isConnected = false,
                                error = "停止会话失败: ${error.message}"
                            )
                        }
                    }
                )

                sessionId = null
                deviceDid = null
            } catch (e: Exception) {
                _uiState.update {
                    it.copy(error = "停止会话异常: ${e.message}")
                }
            }
        }
    }

    /**
     * 切换显示器
     */
    fun switchDisplay(displayId: Int) {
        viewModelScope.launch {
            val sid = sessionId ?: return@launch

            try {
                desktopCommands.switchDisplay(sid, displayId).fold(
                    onSuccess = {
                        _uiState.update { it.copy(currentDisplay = displayId) }
                    },
                    onFailure = { error ->
                        _uiState.update {
                            it.copy(error = "切换显示器失败: ${error.message}")
                        }
                    }
                )
            } catch (e: Exception) {
                _uiState.update {
                    it.copy(error = "切换显示器异常: ${e.message}")
                }
            }
        }
    }

    /**
     * 发送鼠标移动
     */
    fun sendMouseMove(x: Int, y: Int) {
        val sid = sessionId ?: return

        viewModelScope.launch {
            try {
                desktopCommands.sendMouseMove(sid, x, y)
            } catch (e: Exception) {
                // 忽略鼠标移动错误（避免日志污染）
            }
        }
    }

    /**
     * 发送鼠标点击
     */
    fun sendMouseClick(button: String = "left", double: Boolean = false) {
        val sid = sessionId ?: return

        viewModelScope.launch {
            try {
                desktopCommands.sendMouseClick(sid, button, double).fold(
                    onSuccess = { /* 成功 */ },
                    onFailure = { error ->
                        _uiState.update {
                            it.copy(error = "发送点击失败: ${error.message}")
                        }
                    }
                )
            } catch (e: Exception) {
                _uiState.update {
                    it.copy(error = "发送点击异常: ${e.message}")
                }
            }
        }
    }

    /**
     * 发送鼠标滚轮
     */
    fun sendMouseScroll(deltaX: Int, deltaY: Int) {
        val sid = sessionId ?: return

        viewModelScope.launch {
            try {
                desktopCommands.sendMouseScroll(sid, deltaX, deltaY)
            } catch (e: Exception) {
                // 忽略滚轮错误
            }
        }
    }

    /**
     * 发送按键
     */
    fun sendKeyPress(key: String, modifiers: List<String> = emptyList()) {
        val sid = sessionId ?: return

        viewModelScope.launch {
            try {
                desktopCommands.sendKeyPress(sid, key, modifiers).fold(
                    onSuccess = { /* 成功 */ },
                    onFailure = { error ->
                        _uiState.update {
                            it.copy(error = "发送按键失败: ${error.message}")
                        }
                    }
                )
            } catch (e: Exception) {
                _uiState.update {
                    it.copy(error = "发送按键异常: ${e.message}")
                }
            }
        }
    }

    /**
     * 发送文本输入
     */
    fun sendTextInput(text: String) {
        val sid = sessionId ?: return

        viewModelScope.launch {
            try {
                desktopCommands.sendTextInput(sid, text).fold(
                    onSuccess = { /* 成功 */ },
                    onFailure = { error ->
                        _uiState.update {
                            it.copy(error = "发送文本失败: ${error.message}")
                        }
                    }
                )
            } catch (e: Exception) {
                _uiState.update {
                    it.copy(error = "发送文本异常: ${e.message}")
                }
            }
        }
    }

    /**
     * 加载显示器列表
     */
    fun loadDisplays() {
        viewModelScope.launch {
            try {
                desktopCommands.getDisplays().fold(
                    onSuccess = { response ->
                        _displays.value = response.displays
                    },
                    onFailure = { error ->
                        _uiState.update {
                            it.copy(error = "获取显示器列表失败: ${error.message}")
                        }
                    }
                )
            } catch (e: Exception) {
                _uiState.update {
                    it.copy(error = "获取显示器列表异常: ${e.message}")
                }
            }
        }
    }

    /**
     * 加载性能统计
     */
    fun loadStatistics() {
        viewModelScope.launch {
            try {
                desktopCommands.getStats().fold(
                    onSuccess = { stats ->
                        _statistics.value = stats
                    },
                    onFailure = { /* 忽略统计错误 */ }
                )
            } catch (e: Exception) {
                // 忽略统计异常
            }
        }
    }

    /**
     * 清除错误
     */
    fun clearError() {
        _uiState.update { it.copy(error = null) }
    }

    /**
     * 开始帧更新循环
     */
    private fun startFrameUpdateLoop(intervalMs: Int) {
        frameUpdateJob?.cancel()

        frameUpdateJob = viewModelScope.launch {
            var consecutiveErrors = 0
            val maxConsecutiveErrors = 5

            while (isActive) {
                val sid = sessionId ?: break

                try {
                    // 获取帧
                    val result = desktopCommands.getFrame(
                        sessionId = sid,
                        displayId = _uiState.value.currentDisplay
                    )

                    result.fold(
                        onSuccess = { frame ->
                            // 解码 Base64 为 Bitmap
                            val bitmap = decodeFrameToBitmap(frame.frameData)

                            if (bitmap != null) {
                                // Recycle previous frame to prevent memory leak
                                _currentFrame.value?.recycle()
                                _currentFrame.value = bitmap

                                // 更新统计
                                _uiState.update {
                                    it.copy(
                                        totalFrames = it.totalFrames + 1,
                                        totalBytes = it.totalBytes + frame.size,
                                        lastFrameTimestamp = frame.timestamp,
                                        avgCaptureTime = frame.captureTime,
                                        avgEncodeTime = frame.encodeTime,
                                        avgFrameSize = frame.size
                                    )
                                }

                                // 重置错误计数
                                consecutiveErrors = 0
                            } else {
                                consecutiveErrors++
                            }
                        },
                        onFailure = { error ->
                            consecutiveErrors++

                            if (consecutiveErrors >= maxConsecutiveErrors) {
                                _uiState.update {
                                    it.copy(
                                        isConnected = false,
                                        error = "连接已断开: ${error.message}"
                                    )
                                }
                                break
                            }
                        }
                    )
                } catch (e: Exception) {
                    consecutiveErrors++

                    if (consecutiveErrors >= maxConsecutiveErrors) {
                        _uiState.update {
                            it.copy(
                                isConnected = false,
                                error = "连接异常: ${e.message}"
                            )
                        }
                        break
                    }
                }

                // 等待下一帧
                delay(intervalMs.toLong())
            }
        }
    }

    /**
     * 解码 Base64 帧数据为 Bitmap
     */
    private fun decodeFrameToBitmap(base64Data: String): Bitmap? {
        return try {
            val bytes = Base64.decode(base64Data, Base64.DEFAULT)
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
        } catch (e: Exception) {
            null
        }
    }

    override fun onCleared() {
        super.onCleared()
        frameUpdateJob?.cancel()
        _currentFrame.value?.recycle()
        _currentFrame.value = null
    }
}

/**
 * 远程桌面 UI 状态
 */
data class RemoteDesktopUiState(
    val isLoading: Boolean = false,
    val isConnected: Boolean = false,
    val sessionId: String? = null,
    val quality: Int = 80,
    val maxFps: Int = 30,
    val captureInterval: Int = 33,
    val inputControlEnabled: Boolean = false,
    val currentDisplay: Int? = null,
    val totalFrames: Int = 0,
    val totalBytes: Long = 0,
    val duration: Long = 0,
    val lastFrameTimestamp: Long = 0,
    val avgCaptureTime: Long = 0,
    val avgEncodeTime: Long = 0,
    val avgFrameSize: Int = 0,
    val error: String? = null
)
