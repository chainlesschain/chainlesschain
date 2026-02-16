package com.chainlesschain.android.remote.ui.media

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.remote.commands.MediaCommands
import com.chainlesschain.android.remote.commands.AudioDevice
import com.chainlesschain.android.remote.commands.PlaybackStatus
import com.chainlesschain.android.remote.commands.PlaybackStatusResponse
import com.chainlesschain.android.remote.events.EventSubscriptionClient
import com.chainlesschain.android.remote.p2p.ConnectionState
import com.chainlesschain.android.remote.p2p.P2PClient
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import timber.log.Timber
import androidx.compose.runtime.Immutable
import javax.inject.Inject

/**
 * 媒体控制 ViewModel
 *
 * 功能：
 * - 音量控制
 * - 静音/取消静音
 * - 音频设备管理
 * - 媒体播放控制
 * - 音频录制
 * - 摄像头控制
 * - 均衡器
 * - 媒体库管理
 * - 播放列表
 */
@HiltViewModel
class MediaControlViewModel @Inject constructor(
    private val mediaCommands: MediaCommands,
    private val eventClient: EventSubscriptionClient,
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

    // 录制状态
    private val _recordingState = MutableStateFlow<RecordingState?>(null)
    val recordingState: StateFlow<RecordingState?> = _recordingState.asStateFlow()

    // 摄像头列表
    private val _cameras = MutableStateFlow<List<LocalCameraInfo>>(emptyList())
    val cameras: StateFlow<List<LocalCameraInfo>> = _cameras.asStateFlow()

    // 均衡器设置
    private val _equalizerBands = MutableStateFlow<List<Int>>(listOf(0, 0, 0, 0, 0, 0, 0, 0, 0, 0))
    val equalizerBands: StateFlow<List<Int>> = _equalizerBands.asStateFlow()

    // 均衡器预设
    private val _equalizerPresets = MutableStateFlow<List<String>>(emptyList())
    val equalizerPresets: StateFlow<List<String>> = _equalizerPresets.asStateFlow()

    // 媒体库
    private val _mediaLibrary = MutableStateFlow<List<LocalMediaItem>>(emptyList())
    val mediaLibrary: StateFlow<List<LocalMediaItem>> = _mediaLibrary.asStateFlow()

    // 播放列表
    private val _playlists = MutableStateFlow<List<LocalPlaylistInfo>>(emptyList())
    val playlists: StateFlow<List<LocalPlaylistInfo>> = _playlists.asStateFlow()

    // 当前播放列表
    private val _currentPlaylist = MutableStateFlow<LocalPlaylistInfo?>(null)
    val currentPlaylist: StateFlow<LocalPlaylistInfo?> = _currentPlaylist.asStateFlow()

    // 麦克风列表
    private val _microphones = MutableStateFlow<List<MicrophoneInfo>>(emptyList())
    val microphones: StateFlow<List<MicrophoneInfo>> = _microphones.asStateFlow()

    private var eventSubscriptionJob: Job? = null

    init {
        loadVolumeInfo()
        loadAudioDevices()
        loadPlaybackStatus()
        loadExtendedInfo()
        setupEventSubscription()
    }

    /**
     * 加载扩展信息
     */
    private fun loadExtendedInfo() {
        viewModelScope.launch {
            launch { loadCameras() }
            launch { loadEqualizerPresets() }
            launch { loadPlaylists() }
            launch { loadMicrophones() }
        }
    }

    /**
     * 设置事件订阅
     */
    private fun setupEventSubscription() {
        eventSubscriptionJob = viewModelScope.launch {
            // 订阅媒体事件
            eventClient.mediaEvents.collect { event ->
                when (event.method) {
                    "media.playback.state" -> {
                        // 更新播放状态
                        loadPlaybackStatus()
                    }
                    "media.volume.change" -> {
                        val volume = (event.params["volume"] as? Number)?.toInt()
                        val muted = event.params["muted"] as? Boolean
                        volume?.let { _currentVolume.value = it }
                        muted?.let { _isMuted.value = it }
                    }
                    "media.recording.state" -> {
                        val isRecording = event.params["isRecording"] as? Boolean ?: false
                        val duration = (event.params["duration"] as? Number)?.toLong() ?: 0
                        _recordingState.value = if (isRecording) {
                            RecordingState(
                                isRecording = true,
                                duration = duration,
                                recordingId = event.params["recordingId"] as? String
                            )
                        } else null
                    }
                }
            }
        }
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
        val newVolume = (_currentVolume.value + step).coerceIn(0, 100)
        setVolume(newVolume)
    }

    /**
     * 减少音量
     */
    fun volumeDown(step: Int = 5) {
        val newVolume = (_currentVolume.value - step).coerceIn(0, 100)
        setVolume(newVolume)
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
                val response = result.getOrNull()
                // Use playback field if available, otherwise construct from top-level fields
                _playbackStatus.value = response?.playback ?: response?.let {
                    PlaybackStatus(
                        title = it.title,
                        artist = it.artist,
                        album = it.album,
                        state = if (it.playing) "playing" else "paused"
                    )
                }
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

    // ==================== 录制功能 ====================

    /**
     * 开始录音
     */
    fun startRecording(deviceId: String? = null, format: String = "wav") {
        viewModelScope.launch {
            _uiState.update { it.copy(isExecuting = true) }

            val result = mediaCommands.startRecording(deviceId, format)

            if (result.isSuccess) {
                val response = result.getOrNull()
                _recordingState.value = RecordingState(
                    isRecording = true,
                    recordingId = response?.recordingId,
                    startTime = System.currentTimeMillis()
                )
                _uiState.update { it.copy(isExecuting = false) }
            } else {
                handleError(result.exceptionOrNull(), "开始录音失败")
            }
        }
    }

    /**
     * 停止录音
     */
    fun stopRecording() {
        viewModelScope.launch {
            val recordingId = _recordingState.value?.recordingId ?: return@launch

            val result = mediaCommands.stopRecording(recordingId)

            if (result.isSuccess) {
                val response = result.getOrNull()
                _recordingState.value = null
                _uiState.update { it.copy(
                    lastRecordingPath = response?.filePath,
                    lastAction = "recording_stopped"
                )}
            } else {
                handleError(result.exceptionOrNull(), "停止录音失败")
            }
        }
    }

    /**
     * 暂停录音
     */
    fun pauseRecording() {
        viewModelScope.launch {
            val recordingId = _recordingState.value?.recordingId ?: return@launch

            val result = mediaCommands.pauseRecording(recordingId)

            if (result.isSuccess) {
                _recordingState.update { it?.copy(isPaused = true) }
            } else {
                handleError(result.exceptionOrNull(), "暂停录音失败")
            }
        }
    }

    /**
     * 恢复录音
     */
    fun resumeRecording() {
        viewModelScope.launch {
            val recordingId = _recordingState.value?.recordingId ?: return@launch

            val result = mediaCommands.resumeRecording(recordingId)

            if (result.isSuccess) {
                _recordingState.update { it?.copy(isPaused = false) }
            } else {
                handleError(result.exceptionOrNull(), "恢复录音失败")
            }
        }
    }

    // ==================== 摄像头功能 ====================

    /**
     * 加载摄像头列表
     */
    private suspend fun loadCameras() {
        val result = mediaCommands.listCameras()
        if (result.isSuccess) {
            val cameraList = result.getOrNull()?.cameras?.map { cam ->
                LocalCameraInfo(
                    id = cam.id,
                    name = cam.name,
                    isDefault = cam.default
                )
            } ?: emptyList()
            _cameras.value = cameraList
        }
    }

    /**
     * 拍照
     */
    fun capturePhoto(cameraId: String? = null, format: String = "jpeg", quality: Int = 90) {
        viewModelScope.launch {
            _uiState.update { it.copy(isExecuting = true) }

            val result = mediaCommands.capturePhoto(cameraId, format, quality)

            if (result.isSuccess) {
                val response = result.getOrNull()
                _uiState.update { it.copy(
                    isExecuting = false,
                    lastCapturedPhoto = response?.imageData,
                    lastAction = "photo_captured"
                )}
            } else {
                handleError(result.exceptionOrNull(), "拍照失败")
            }
        }
    }

    // ==================== 均衡器功能 ====================

    /**
     * 加载均衡器预设
     */
    private suspend fun loadEqualizerPresets() {
        val result = mediaCommands.getEqualizerPresets()
        if (result.isSuccess) {
            val presets = result.getOrNull()?.presets?.map { it.name } ?: emptyList()
            _equalizerPresets.value = presets
        }
    }

    /**
     * 设置均衡器频段
     */
    fun setEqualizerBand(bandIndex: Int, value: Int) {
        val newBands = _equalizerBands.value.toMutableList()
        if (bandIndex in newBands.indices) {
            newBands[bandIndex] = value.coerceIn(-12, 12)
            _equalizerBands.value = newBands

            viewModelScope.launch {
                mediaCommands.setEqualizer(bands = newBands)
            }
        }
    }

    /**
     * 应用均衡器预设
     */
    fun applyEqualizerPreset(preset: String) {
        viewModelScope.launch {
            val result = mediaCommands.setEqualizer(preset = preset)
            if (result.isSuccess) {
                // 获取更新后的频段值
                val bands = result.getOrNull()?.bands?.map { it.gain }
                if (bands != null) {
                    _equalizerBands.value = bands
                }
                _uiState.update { it.copy(currentEqualizerPreset = preset) }
            } else {
                handleError(result.exceptionOrNull(), "应用预设失败")
            }
        }
    }

    /**
     * 重置均衡器
     */
    fun resetEqualizer() {
        _equalizerBands.value = listOf(0, 0, 0, 0, 0, 0, 0, 0, 0, 0)
        viewModelScope.launch {
            mediaCommands.setEqualizer(bands = _equalizerBands.value)
        }
    }

    // ==================== 媒体库功能 ====================

    /**
     * 扫描媒体库
     */
    fun scanMediaLibrary(path: String? = null) {
        viewModelScope.launch {
            _uiState.update { it.copy(isExecuting = true, isScanningLibrary = true) }

            val paths = path?.let { listOf(it) }
            val result = mediaCommands.scanMediaLibrary(paths)

            if (result.isSuccess) {
                val response = result.getOrNull()
                _uiState.update { it.copy(
                    isExecuting = false,
                    isScanningLibrary = false,
                    libraryItemCount = response?.scannedFiles ?: 0
                )}
                // 加载媒体库
                loadMediaLibrary()
            } else {
                handleError(result.exceptionOrNull(), "扫描媒体库失败")
            }
        }
    }

    /**
     * 加载媒体库
     */
    fun loadMediaLibrary(type: String = "all", limit: Int = 100) {
        viewModelScope.launch {
            val result = mediaCommands.searchMedia(
                query = "*",
                type = if (type == "all") null else type,
                limit = limit
            )

            if (result.isSuccess) {
                val items = result.getOrNull()?.results?.map { item ->
                    LocalMediaItem(
                        id = item.id,
                        title = item.title,
                        artist = item.artist,
                        album = item.album,
                        duration = item.duration?.toLong() ?: 0,
                        path = item.path,
                        type = item.type,
                        thumbnail = item.thumbnail
                    )
                } ?: emptyList()
                _mediaLibrary.value = items
            }
        }
    }

    /**
     * 播放媒体项
     */
    fun playMediaItem(mediaId: String) {
        viewModelScope.launch {
            val result = mediaCommands.playMedia(path = mediaId)
            if (result.isSuccess) {
                loadPlaybackStatus()
            } else {
                handleError(result.exceptionOrNull(), "播放失败")
            }
        }
    }

    // ==================== 播放列表功能 ====================

    /**
     * 加载播放列表
     */
    private suspend fun loadPlaylists() {
        val result = mediaCommands.getPlaylists()
        if (result.isSuccess) {
            val playlists = result.getOrNull()?.playlists?.map { pl ->
                LocalPlaylistInfo(
                    id = pl.id,
                    name = pl.name,
                    itemCount = pl.itemCount,
                    duration = pl.totalDuration.toLong()
                )
            } ?: emptyList()
            _playlists.value = playlists
        }
    }

    /**
     * 创建播放列表
     */
    fun createPlaylist(name: String) {
        viewModelScope.launch {
            val result = mediaCommands.createPlaylist(name)
            if (result.isSuccess) {
                loadPlaylists()
            } else {
                handleError(result.exceptionOrNull(), "创建播放列表失败")
            }
        }
    }

    /**
     * 添加到播放列表
     */
    fun addToPlaylist(playlistId: String, mediaIds: List<String>) {
        viewModelScope.launch {
            val result = mediaCommands.addToPlaylist(playlistId, mediaIds)
            if (result.isSuccess) {
                loadPlaylists()
            } else {
                handleError(result.exceptionOrNull(), "添加到播放列表失败")
            }
        }
    }

    /**
     * 播放播放列表
     */
    fun playPlaylist(playlistId: String, startIndex: Int = 0) {
        viewModelScope.launch {
            val result = mediaCommands.playPlaylist(playlistId, startIndex)
            if (result.isSuccess) {
                _currentPlaylist.value = _playlists.value.find { it.id == playlistId }
                loadPlaybackStatus()
            } else {
                handleError(result.exceptionOrNull(), "播放列表播放失败")
            }
        }
    }

    // ==================== 麦克风功能 ====================

    /**
     * 加载麦克风列表
     */
    private suspend fun loadMicrophones() {
        val result = mediaCommands.getInputDevices()
        if (result.isSuccess) {
            val mics = result.getOrNull()?.devices?.map { device ->
                MicrophoneInfo(
                    id = device.id ?: "",
                    name = device.name,
                    isDefault = device.default ?: false,
                    isMuted = false
                )
            } ?: emptyList()
            _microphones.value = mics
        }
    }

    /**
     * 设置麦克风静音
     */
    fun setMicrophoneMute(deviceId: String, muted: Boolean) {
        viewModelScope.launch {
            val result = if (muted) {
                mediaCommands.muteMicrophone()
            } else {
                mediaCommands.unmuteMicrophone()
            }
            if (result.isSuccess) {
                loadMicrophones()
            } else {
                handleError(result.exceptionOrNull(), "设置麦克风静音失败")
            }
        }
    }

    /**
     * 设置麦克风音量（增益）
     */
    fun setMicrophoneVolume(deviceId: String, volume: Int) {
        viewModelScope.launch {
            // Map volume (0-100) to gain (0-200, 100=normal)
            val gain = (volume.coerceIn(0, 100) * 2)
            val result = mediaCommands.setMicrophoneGain(gain)
            if (result.isFailure) {
                handleError(result.exceptionOrNull(), "设置麦克风音量失败")
            }
        }
    }

    override fun onCleared() {
        super.onCleared()
        eventSubscriptionJob?.cancel()
    }
}

// ==================== 数据类 ====================

/**
 * 录制状态
 */
@Immutable
data class RecordingState(
    val isRecording: Boolean = false,
    val isPaused: Boolean = false,
    val recordingId: String? = null,
    val startTime: Long = 0,
    val duration: Long = 0
)

/**
 * 摄像头信息（本地 UI 模型）
 */
data class LocalCameraInfo(
    val id: String,
    val name: String,
    val isDefault: Boolean
)

/**
 * 麦克风信息
 */
data class MicrophoneInfo(
    val id: String,
    val name: String,
    val isDefault: Boolean,
    val isMuted: Boolean
)

/**
 * 媒体项（本地 UI 模型）
 */
data class LocalMediaItem(
    val id: String,
    val title: String,
    val artist: String?,
    val album: String?,
    val duration: Long,
    val path: String,
    val type: String,
    val thumbnail: String?
)

/**
 * 播放列表信息（本地 UI 模型）
 */
data class LocalPlaylistInfo(
    val id: String,
    val name: String,
    val itemCount: Int,
    val duration: Long
)

/**
 * 媒体控制 UI 状态
 */
@Immutable
data class MediaControlUiState(
    val isExecuting: Boolean = false,
    val error: String? = null,
    val lastAction: String? = null,
    // 扩展状态
    val lastRecordingPath: String? = null,
    val lastCapturedPhoto: String? = null,
    val currentEqualizerPreset: String? = null,
    val isScanningLibrary: Boolean = false,
    val libraryItemCount: Int = 0
)
