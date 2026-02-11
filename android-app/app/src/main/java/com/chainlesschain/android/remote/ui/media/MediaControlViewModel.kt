package com.chainlesschain.android.remote.ui.media

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.remote.commands.MediaCommands
import com.chainlesschain.android.remote.commands.AudioDevice
import com.chainlesschain.android.remote.commands.PlaybackStatus
import com.chainlesschain.android.remote.p2p.ConnectionState
import com.chainlesschain.android.remote.p2p.P2PClient
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import timber.log.Timber
import javax.inject.Inject

/**
 * 媒体控制 ViewModel
 *
 * 功能：
 * - 音量控制
 * - 静音/取消静音
 * - 音频设备管理
 * - 媒体播放控制
 */
@HiltViewModel
class MediaControlViewModel @Inject constructor(
    private val mediaCommands: MediaCommands,
    private val p2pClient: P2PClient
) : ViewModel() {

    // UI 状态
    private val _uiState = MutableStateFlow(MediaControlUiState())
    val uiState: StateFlow<MediaControlUiState> = _uiState.asStateFlow()

    // 连接状态
    val connectionState: StateFlow<ConnectionState> = p2pClient.connectionState

    // 当前音量
    private val _currentVolume = MutableStateFlow(50)
    val currentVolume: StateFlow<Int> = _currentVolume.asStateFlow()

    // 是否静音
    private val _isMuted = MutableStateFlow(false)
    val isMuted: StateFlow<Boolean> = _isMuted.asStateFlow()

    // 音频设备列表
    private val _audioDevices = MutableStateFlow<List<AudioDevice>>(emptyList())
    val audioDevices: StateFlow<List<AudioDevice>> = _audioDevices.asStateFlow()

    // 播放状态
    private val _playbackStatus = MutableStateFlow<PlaybackStatus?>(null)
    val playbackStatus: StateFlow<PlaybackStatus?> = _playbackStatus.asStateFlow()

    init {
        loadVolumeInfo()
        loadAudioDevices()
        loadPlaybackStatus()
    }

    /**
     * 加载音量信息
     */
    fun loadVolumeInfo() {
        viewModelScope.launch {
            val result = mediaCommands.getVolume()

            if (result.isSuccess) {
                val response = result.getOrNull()
                _currentVolume.value = response?.volume ?: 50
                _isMuted.value = response?.muted ?: false
            } else {
                Timber.w(result.exceptionOrNull(), "获取音量信息失败")
            }
        }
    }

    /**
     * 设置音量
     */
    fun setVolume(volume: Int) {
        val clampedVolume = volume.coerceIn(0, 100)
        viewModelScope.launch {
            _uiState.update { it.copy(isExecuting = true) }

            val result = mediaCommands.setVolume(clampedVolume)

            if (result.isSuccess) {
                _currentVolume.value = clampedVolume
                _uiState.update { it.copy(isExecuting = false) }
            } else {
                handleError(result.exceptionOrNull(), "设置音量失败")
            }
        }
    }

    /**
     * 增加音量
     */
    fun volumeUp(step: Int = 5) {
        viewModelScope.launch {
            val result = mediaCommands.volumeUp(step)

            if (result.isSuccess) {
                val newVolume = result.getOrNull()?.volume ?: (_currentVolume.value + step)
                _currentVolume.value = newVolume.coerceIn(0, 100)
            } else {
                handleError(result.exceptionOrNull(), "增加音量失败")
            }
        }
    }

    /**
     * 减少音量
     */
    fun volumeDown(step: Int = 5) {
        viewModelScope.launch {
            val result = mediaCommands.volumeDown(step)

            if (result.isSuccess) {
                val newVolume = result.getOrNull()?.volume ?: (_currentVolume.value - step)
                _currentVolume.value = newVolume.coerceIn(0, 100)
            } else {
                handleError(result.exceptionOrNull(), "减少音量失败")
            }
        }
    }

    /**
     * 静音
     */
    fun mute() {
        viewModelScope.launch {
            _uiState.update { it.copy(isExecuting = true) }

            val result = mediaCommands.mute()

            if (result.isSuccess) {
                _isMuted.value = true
                _uiState.update { it.copy(isExecuting = false) }
            } else {
                handleError(result.exceptionOrNull(), "静音失败")
            }
        }
    }

    /**
     * 取消静音
     */
    fun unmute() {
        viewModelScope.launch {
            _uiState.update { it.copy(isExecuting = true) }

            val result = mediaCommands.unmute()

            if (result.isSuccess) {
                _isMuted.value = false
                _uiState.update { it.copy(isExecuting = false) }
            } else {
                handleError(result.exceptionOrNull(), "取消静音失败")
            }
        }
    }

    /**
     * 切换静音状态
     */
    fun toggleMute() {
        viewModelScope.launch {
            val result = mediaCommands.toggleMute()

            if (result.isSuccess) {
                _isMuted.value = result.getOrNull()?.muted ?: !_isMuted.value
            } else {
                handleError(result.exceptionOrNull(), "切换静音失败")
            }
        }
    }

    /**
     * 加载音频设备
     */
    fun loadAudioDevices() {
        viewModelScope.launch {
            val result = mediaCommands.getDevices()

            if (result.isSuccess) {
                _audioDevices.value = result.getOrNull()?.devices ?: emptyList()
            } else {
                Timber.w(result.exceptionOrNull(), "获取音频设备失败")
            }
        }
    }

    /**
     * 加载播放状态
     */
    fun loadPlaybackStatus() {
        viewModelScope.launch {
            val result = mediaCommands.getPlaybackStatus()

            if (result.isSuccess) {
                _playbackStatus.value = result.getOrNull()?.playback
            } else {
                Timber.w(result.exceptionOrNull(), "获取播放状态失败")
            }
        }
    }

    /**
     * 媒体控制 - 播放/暂停
     */
    fun playPause() {
        mediaControl("playPause")
    }

    /**
     * 媒体控制 - 下一曲
     */
    fun nextTrack() {
        mediaControl("next")
    }

    /**
     * 媒体控制 - 上一曲
     */
    fun previousTrack() {
        mediaControl("previous")
    }

    /**
     * 媒体控制 - 停止
     */
    fun stop() {
        mediaControl("stop")
    }

    /**
     * 通用媒体控制
     */
    private fun mediaControl(action: String) {
        viewModelScope.launch {
            _uiState.update { it.copy(isExecuting = true) }

            val result = mediaCommands.mediaControl(action)

            if (result.isSuccess) {
                _uiState.update { it.copy(
                    isExecuting = false,
                    lastAction = action
                )}
                // 刷新播放状态
                delay(300)
                loadPlaybackStatus()
            } else {
                handleError(result.exceptionOrNull(), "媒体控制失败")
            }
        }
    }

    /**
     * 刷新所有信息
     */
    fun refresh() {
        loadVolumeInfo()
        loadAudioDevices()
        loadPlaybackStatus()
    }

    /**
     * 处理错误
     */
    private fun handleError(throwable: Throwable?, defaultMessage: String) {
        val error = throwable?.message ?: defaultMessage
        Timber.e(throwable, defaultMessage)
        _uiState.update { it.copy(
            isExecuting = false,
            error = error
        )}
    }

    /**
     * 清除错误
     */
    fun clearError() {
        _uiState.update { it.copy(error = null) }
    }
}

/**
 * 媒体控制 UI 状态
 */
data class MediaControlUiState(
    val isExecuting: Boolean = false,
    val error: String? = null,
    val lastAction: String? = null
)
