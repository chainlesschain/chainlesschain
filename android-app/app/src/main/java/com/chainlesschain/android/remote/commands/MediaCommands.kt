package com.chainlesschain.android.remote.commands

import com.chainlesschain.android.remote.client.RemoteCommandClient
import kotlinx.serialization.Serializable
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 媒体控制命令 API
 *
 * 提供类型安全的媒体控制相关命令
 */
@Singleton
class MediaCommands @Inject constructor(
    private val client: RemoteCommandClient
) {
    /**
     * 获取当前音量
     */
    suspend fun getVolume(): Result<VolumeResponse> {
        return client.invoke("media.getVolume", emptyMap())
    }

    /**
     * 设置音量
     *
     * @param volume 音量值 (0-100)
     */
    suspend fun setVolume(volume: Int): Result<SetVolumeResponse> {
        val params = mapOf("volume" to volume)
        return client.invoke("media.setVolume", params)
    }

    /**
     * 静音
     */
    suspend fun mute(): Result<MuteResponse> {
        return client.invoke("media.mute", emptyMap())
    }

    /**
     * 取消静音
     */
    suspend fun unmute(): Result<MuteResponse> {
        return client.invoke("media.unmute", emptyMap())
    }

    /**
     * 切换静音状态
     */
    suspend fun toggleMute(): Result<MuteResponse> {
        return client.invoke("media.toggleMute", emptyMap())
    }

    /**
     * 获取音频设备列表
     */
    suspend fun getDevices(): Result<AudioDevicesResponse> {
        return client.invoke("media.getDevices", emptyMap())
    }

    /**
     * 播放系统声音
     *
     * @param sound 系统声音类型：default, error, warning, info, question
     * @param file 自定义声音文件路径（可选，优先于 sound）
     */
    suspend fun playSound(
        sound: String = "default",
        file: String? = null
    ): Result<PlaySoundResponse> {
        val params = mutableMapOf<String, Any>("sound" to sound)
        file?.let { params["file"] = it }

        return client.invoke("media.playSound", params)
    }

    /**
     * 停止声音播放
     */
    suspend fun stopSound(): Result<StopSoundResponse> {
        return client.invoke("media.stopSound", emptyMap())
    }

    /**
     * 获取媒体播放状态
     */
    suspend fun getPlaybackStatus(): Result<PlaybackStatusResponse> {
        return client.invoke("media.getPlaybackStatus", emptyMap())
    }

    /**
     * 媒体控制
     *
     * @param action 控制动作：play, pause, toggle, next, previous, stop
     */
    suspend fun mediaControl(action: String): Result<MediaControlResponse> {
        val params = mapOf("action" to action)
        return client.invoke("media.mediaControl", params)
    }

    /**
     * 播放
     */
    suspend fun play(): Result<MediaControlResponse> = mediaControl("play")

    /**
     * 暂停
     */
    suspend fun pause(): Result<MediaControlResponse> = mediaControl("pause")

    /**
     * 播放/暂停切换
     */
    suspend fun toggle(): Result<MediaControlResponse> = mediaControl("toggle")

    /**
     * 下一曲
     */
    suspend fun next(): Result<MediaControlResponse> = mediaControl("next")

    /**
     * 上一曲
     */
    suspend fun previous(): Result<MediaControlResponse> = mediaControl("previous")

    /**
     * 停止
     */
    suspend fun stop(): Result<MediaControlResponse> = mediaControl("stop")

    // ==================== 音频设备管理 ====================

    /**
     * 设置默认输出设备
     *
     * @param deviceId 设备 ID
     */
    suspend fun setOutputDevice(deviceId: String): Result<SetDeviceResponse> {
        return client.invoke("media.setOutputDevice", mapOf("deviceId" to deviceId))
    }

    /**
     * 设置默认输入设备
     *
     * @param deviceId 设备 ID
     */
    suspend fun setInputDevice(deviceId: String): Result<SetDeviceResponse> {
        return client.invoke("media.setInputDevice", mapOf("deviceId" to deviceId))
    }

    /**
     * 获取输入设备（麦克风）列表
     */
    suspend fun getInputDevices(): Result<AudioDevicesResponse> {
        return client.invoke("media.getInputDevices", emptyMap())
    }

    /**
     * 获取输出设备（扬声器）列表
     */
    suspend fun getOutputDevices(): Result<AudioDevicesResponse> {
        return client.invoke("media.getOutputDevices", emptyMap())
    }

    // ==================== 应用音量控制 ====================

    /**
     * 获取应用音量列表
     */
    suspend fun getAppVolumes(): Result<AppVolumesResponse> {
        return client.invoke("media.getAppVolumes", emptyMap())
    }

    /**
     * 设置应用音量
     *
     * @param appId 应用 ID
     * @param volume 音量 (0-100)
     */
    suspend fun setAppVolume(
        appId: String,
        volume: Int
    ): Result<SetAppVolumeResponse> {
        return client.invoke("media.setAppVolume", mapOf(
            "appId" to appId,
            "volume" to volume
        ))
    }

    /**
     * 静音应用
     *
     * @param appId 应用 ID
     * @param mute 是否静音
     */
    suspend fun muteApp(
        appId: String,
        mute: Boolean
    ): Result<SetAppVolumeResponse> {
        return client.invoke("media.muteApp", mapOf(
            "appId" to appId,
            "mute" to mute
        ))
    }

    // ==================== 音频录制 ====================

    /**
     * 开始录音
     *
     * @param deviceId 输入设备 ID（可选）
     * @param format 格式 (wav, mp3, ogg)
     * @param sampleRate 采样率
     * @param channels 通道数 (1 单声道, 2 立体声)
     */
    suspend fun startRecording(
        deviceId: String? = null,
        format: String = "wav",
        sampleRate: Int = 44100,
        channels: Int = 2
    ): Result<RecordingStartResponse> {
        val params = mutableMapOf<String, Any>(
            "format" to format,
            "sampleRate" to sampleRate,
            "channels" to channels
        )
        deviceId?.let { params["deviceId"] = it }
        return client.invoke("media.startRecording", params)
    }

    /**
     * 停止录音
     *
     * @param recordingId 录音 ID
     * @param savePath 保存路径（可选）
     */
    suspend fun stopRecording(
        recordingId: String,
        savePath: String? = null
    ): Result<RecordingStopResponse> {
        val params = mutableMapOf<String, Any>("recordingId" to recordingId)
        savePath?.let { params["savePath"] = it }
        return client.invoke("media.stopRecording", params)
    }

    /**
     * 暂停录音
     *
     * @param recordingId 录音 ID
     */
    suspend fun pauseRecording(recordingId: String): Result<RecordingControlResponse> {
        return client.invoke("media.pauseRecording", mapOf("recordingId" to recordingId))
    }

    /**
     * 恢复录音
     *
     * @param recordingId 录音 ID
     */
    suspend fun resumeRecording(recordingId: String): Result<RecordingControlResponse> {
        return client.invoke("media.resumeRecording", mapOf("recordingId" to recordingId))
    }

    /**
     * 获取录音状态
     *
     * @param recordingId 录音 ID
     */
    suspend fun getRecordingStatus(recordingId: String): Result<RecordingStatusResponse> {
        return client.invoke("media.getRecordingStatus", mapOf("recordingId" to recordingId))
    }

    /**
     * 列出录音
     */
    suspend fun listRecordings(): Result<RecordingsListResponse> {
        return client.invoke("media.listRecordings", emptyMap())
    }

    // ==================== 麦克风控制 ====================

    /**
     * 获取麦克风状态
     */
    suspend fun getMicrophoneStatus(): Result<MicrophoneStatusResponse> {
        return client.invoke("media.getMicrophoneStatus", emptyMap())
    }

    /**
     * 静音麦克风
     */
    suspend fun muteMicrophone(): Result<MicrophoneControlResponse> {
        return client.invoke("media.muteMicrophone", emptyMap())
    }

    /**
     * 取消静音麦克风
     */
    suspend fun unmuteMicrophone(): Result<MicrophoneControlResponse> {
        return client.invoke("media.unmuteMicrophone", emptyMap())
    }

    /**
     * 获取麦克风音量级别
     */
    suspend fun getMicrophoneLevel(): Result<MicrophoneLevelResponse> {
        return client.invoke("media.getMicrophoneLevel", emptyMap())
    }

    /**
     * 设置麦克风增益
     *
     * @param gain 增益 (0-200, 100=正常)
     */
    suspend fun setMicrophoneGain(gain: Int): Result<MicrophoneControlResponse> {
        return client.invoke("media.setMicrophoneGain", mapOf("gain" to gain))
    }

    // ==================== 播放位置控制 ====================

    /**
     * 跳转到指定位置
     *
     * @param position 位置（秒）
     */
    suspend fun seek(position: Double): Result<SeekResponse> {
        return client.invoke("media.seek", mapOf("position" to position))
    }

    /**
     * 快进
     *
     * @param seconds 秒数
     */
    suspend fun fastForward(seconds: Int = 10): Result<SeekResponse> {
        return client.invoke("media.fastForward", mapOf("seconds" to seconds))
    }

    /**
     * 快退
     *
     * @param seconds 秒数
     */
    suspend fun rewind(seconds: Int = 10): Result<SeekResponse> {
        return client.invoke("media.rewind", mapOf("seconds" to seconds))
    }

    /**
     * 获取播放位置
     */
    suspend fun getPosition(): Result<PositionResponse> {
        return client.invoke("media.getPosition", emptyMap())
    }

    // ==================== 播放模式 ====================

    /**
     * 设置重复模式
     *
     * @param mode 模式 (off, one, all)
     */
    suspend fun setRepeatMode(mode: String): Result<PlayModeResponse> {
        return client.invoke("media.setRepeatMode", mapOf("mode" to mode))
    }

    /**
     * 设置随机播放
     *
     * @param enabled 是否启用
     */
    suspend fun setShuffle(enabled: Boolean): Result<PlayModeResponse> {
        return client.invoke("media.setShuffle", mapOf("enabled" to enabled))
    }

    /**
     * 获取播放模式
     */
    suspend fun getPlayMode(): Result<PlayModeResponse> {
        return client.invoke("media.getPlayMode", emptyMap())
    }

    // ==================== 均衡器 ====================

    /**
     * 获取均衡器设置
     */
    suspend fun getEqualizer(): Result<EqualizerResponse> {
        return client.invoke("media.getEqualizer", emptyMap())
    }

    /**
     * 设置均衡器
     *
     * @param bands 频段值列表
     * @param preset 预设名称（可选）
     */
    suspend fun setEqualizer(
        bands: List<Int>? = null,
        preset: String? = null
    ): Result<EqualizerResponse> {
        val params = mutableMapOf<String, Any>()
        bands?.let { params["bands"] = it }
        preset?.let { params["preset"] = it }
        return client.invoke("media.setEqualizer", params)
    }

    /**
     * 获取均衡器预设列表
     */
    suspend fun getEqualizerPresets(): Result<EqualizerPresetsResponse> {
        return client.invoke("media.getEqualizerPresets", emptyMap())
    }

    // ==================== 媒体文件播放 ====================

    /**
     * 播放媒体文件
     *
     * @param path 文件路径
     * @param volume 音量
     * @param loop 是否循环
     */
    suspend fun playMedia(
        path: String,
        volume: Int = 100,
        loop: Boolean = false
    ): Result<PlayMediaResponse> {
        return client.invoke("media.playMedia", mapOf(
            "path" to path,
            "volume" to volume,
            "loop" to loop
        ))
    }

    /**
     * 播放 URL
     *
     * @param url 媒体 URL
     * @param volume 音量
     */
    suspend fun playUrl(
        url: String,
        volume: Int = 100
    ): Result<PlayMediaResponse> {
        return client.invoke("media.playUrl", mapOf(
            "url" to url,
            "volume" to volume
        ))
    }

    /**
     * 获取媒体信息
     *
     * @param path 文件路径
     */
    suspend fun getMediaInfo(path: String): Result<MediaInfoResponse> {
        return client.invoke("media.getMediaInfo", mapOf("path" to path))
    }

    // ==================== 摄像头 ====================

    /**
     * 列出摄像头
     */
    suspend fun listCameras(): Result<CamerasListResponse> {
        return client.invoke("media.listCameras", emptyMap())
    }

    /**
     * 拍照
     *
     * @param cameraId 摄像头 ID（可选）
     * @param format 格式 (png, jpeg)
     * @param quality 质量 (1-100)
     */
    suspend fun capturePhoto(
        cameraId: String? = null,
        format: String = "jpeg",
        quality: Int = 90
    ): Result<CapturePhotoResponse> {
        val params = mutableMapOf<String, Any>(
            "format" to format,
            "quality" to quality
        )
        cameraId?.let { params["cameraId"] = it }
        return client.invoke("media.capturePhoto", params)
    }

    /**
     * 开始摄像头预览
     *
     * @param cameraId 摄像头 ID
     * @param fps 帧率
     * @param quality 质量
     */
    suspend fun startCameraPreview(
        cameraId: String? = null,
        fps: Int = 15,
        quality: Int = 60
    ): Result<CameraPreviewResponse> {
        val params = mutableMapOf<String, Any>(
            "fps" to fps,
            "quality" to quality
        )
        cameraId?.let { params["cameraId"] = it }
        return client.invoke("media.startCameraPreview", params)
    }

    /**
     * 停止摄像头预览
     *
     * @param previewId 预览 ID
     */
    suspend fun stopCameraPreview(previewId: String): Result<CameraPreviewStopResponse> {
        return client.invoke("media.stopCameraPreview", mapOf("previewId" to previewId))
    }

    /**
     * 获取摄像头预览帧
     *
     * @param previewId 预览 ID
     */
    suspend fun getCameraFrame(previewId: String): Result<CameraFrameResponse> {
        return client.invoke("media.getCameraFrame", mapOf("previewId" to previewId))
    }

    // ==================== 音频流 ====================

    /**
     * 开始音频流
     *
     * @param deviceId 设备 ID
     * @param format 格式
     * @param sampleRate 采样率
     */
    suspend fun startAudioStream(
        deviceId: String? = null,
        format: String = "pcm",
        sampleRate: Int = 44100
    ): Result<AudioStreamStartResponse> {
        val params = mutableMapOf<String, Any>(
            "format" to format,
            "sampleRate" to sampleRate
        )
        deviceId?.let { params["deviceId"] = it }
        return client.invoke("media.startAudioStream", params)
    }

    /**
     * 停止音频流
     *
     * @param streamId 流 ID
     */
    suspend fun stopAudioStream(streamId: String): Result<AudioStreamStopResponse> {
        return client.invoke("media.stopAudioStream", mapOf("streamId" to streamId))
    }

    /**
     * 获取音频流数据
     *
     * @param streamId 流 ID
     */
    suspend fun getAudioStreamData(streamId: String): Result<AudioStreamDataResponse> {
        return client.invoke("media.getAudioStreamData", mapOf("streamId" to streamId))
    }

    // ==================== 媒体库 ====================

    /**
     * 扫描媒体库
     *
     * @param paths 扫描路径
     * @param types 媒体类型 (audio, video, image)
     */
    suspend fun scanMediaLibrary(
        paths: List<String>? = null,
        types: List<String> = listOf("audio", "video", "image")
    ): Result<MediaScanResponse> {
        val params = mutableMapOf<String, Any>("types" to types)
        paths?.let { params["paths"] = it }
        return client.invoke("media.scanMediaLibrary", params)
    }

    /**
     * 搜索媒体库
     *
     * @param query 搜索关键词
     * @param type 媒体类型
     * @param limit 最大数量
     */
    suspend fun searchMedia(
        query: String,
        type: String? = null,
        limit: Int = 50
    ): Result<MediaSearchResponse> {
        val params = mutableMapOf<String, Any>(
            "query" to query,
            "limit" to limit
        )
        type?.let { params["type"] = it }
        return client.invoke("media.searchMedia", params)
    }

    /**
     * 获取播放列表
     */
    suspend fun getPlaylists(): Result<PlaylistsResponse> {
        return client.invoke("media.getPlaylists", emptyMap())
    }

    /**
     * 创建播放列表
     *
     * @param name 名称
     * @param items 项目列表
     */
    suspend fun createPlaylist(
        name: String,
        items: List<String> = emptyList()
    ): Result<PlaylistResponse> {
        return client.invoke("media.createPlaylist", mapOf(
            "name" to name,
            "items" to items
        ))
    }

    /**
     * 添加到播放列表
     *
     * @param playlistId 播放列表 ID
     * @param items 项目列表
     */
    suspend fun addToPlaylist(
        playlistId: String,
        items: List<String>
    ): Result<PlaylistUpdateResponse> {
        return client.invoke("media.addToPlaylist", mapOf(
            "playlistId" to playlistId,
            "items" to items
        ))
    }

    /**
     * 播放播放列表
     *
     * @param playlistId 播放列表 ID
     * @param startIndex 起始索引
     */
    suspend fun playPlaylist(
        playlistId: String,
        startIndex: Int = 0
    ): Result<PlayPlaylistResponse> {
        return client.invoke("media.playPlaylist", mapOf(
            "playlistId" to playlistId,
            "startIndex" to startIndex
        ))
    }
}

// 响应数据类

@Serializable
data class VolumeResponse(
    val success: Boolean,
    val volume: Int? = null,
    val level: Int? = null,
    val muted: Boolean,
    val platform: String? = null
)

@Serializable
data class SetVolumeResponse(
    val success: Boolean,
    val volume: Int,
    val message: String
)

@Serializable
data class MuteResponse(
    val success: Boolean,
    val muted: Boolean,
    val message: String
)

@Serializable
data class AudioDevicesResponse(
    val success: Boolean,
    val devices: List<AudioDevice>,
    val total: Int? = null,
    val defaultOutput: String? = null,
    val defaultInput: String? = null
)

@Serializable
data class AudioDevice(
    val id: String? = null,
    val name: String,
    val type: String,
    val default: Boolean? = null,
    val isDefault: Boolean? = null,
    val driver: String? = null,
    val format: String? = null,
    val state: String? = null,
    val manufacturer: String? = null
)

@Serializable
data class PlaySoundResponse(
    val success: Boolean,
    val sound: String,
    val message: String
)

@Serializable
data class StopSoundResponse(
    val success: Boolean,
    val message: String
)

@Serializable
data class PlaybackStatusResponse(
    val success: Boolean,
    val playing: Boolean,
    val title: String? = null,
    val artist: String? = null,
    val album: String? = null,
    val error: String? = null,
    val playback: PlaybackStatus? = null
)

/**
 * 播放状态详情
 */
@Serializable
data class PlaybackStatus(
    val title: String? = null,
    val artist: String? = null,
    val album: String? = null,
    val state: String? = null,
    val duration: Double? = null,
    val position: Double? = null
)

@Serializable
data class MediaControlResponse(
    val success: Boolean,
    val action: String,
    val message: String
)

// ==================== 设备管理响应 ====================

@Serializable
data class SetDeviceResponse(
    val success: Boolean,
    val deviceId: String,
    val deviceName: String,
    val message: String? = null
)

// ==================== 应用音量响应 ====================

@Serializable
data class AppVolumesResponse(
    val success: Boolean,
    val apps: List<AppVolumeInfo>,
    val total: Int
)

@Serializable
data class AppVolumeInfo(
    val appId: String,
    val appName: String,
    val volume: Int,
    val muted: Boolean,
    val icon: String? = null
)

@Serializable
data class SetAppVolumeResponse(
    val success: Boolean,
    val appId: String,
    val volume: Int,
    val muted: Boolean,
    val message: String? = null
)

// ==================== 录音响应 ====================

@Serializable
data class RecordingStartResponse(
    val success: Boolean,
    val recordingId: String,
    val format: String? = null,
    val sampleRate: Int? = null,
    val channels: Int? = null,
    val deviceName: String? = null,
    val displayId: Int? = null,
    val fps: Int? = null,
    val quality: Int? = null,
    val includeAudio: Boolean? = null,
    val startTime: Long? = null
)

@Serializable
data class RecordingStopResponse(
    val success: Boolean,
    val recordingId: String,
    val filePath: String,
    val duration: Double? = null,
    val fileSize: Long,
    val format: String? = null,
    val frameCount: Long? = null
)

@Serializable
data class RecordingControlResponse(
    val success: Boolean,
    val recordingId: String,
    val status: String,
    val message: String? = null
)

@Serializable
data class RecordingStatusResponse(
    val success: Boolean,
    val recordingId: String,
    val status: String,  // "recording", "paused", "stopped"
    val duration: Double? = null,
    val fileSize: Long? = null,
    val peakLevel: Double? = null,
    val frameCount: Long? = null,
    val estimatedSize: Long? = null,
    val paused: Boolean? = null
)

@Serializable
data class RecordingsListResponse(
    val success: Boolean,
    val recordings: List<RecordingInfo>,
    val total: Int
)

@Serializable
data class RecordingInfo(
    val recordingId: String,
    val status: String,
    val startTime: Long? = null,
    val duration: Double? = null,
    val format: String? = null,
    val displayId: Int? = null,
    val paused: Boolean? = null
)

// ==================== 麦克风响应 ====================

@Serializable
data class MicrophoneStatusResponse(
    val success: Boolean,
    val muted: Boolean,
    val gain: Int,
    val deviceName: String,
    val level: Double? = null
)

@Serializable
data class MicrophoneControlResponse(
    val success: Boolean,
    val muted: Boolean? = null,
    val gain: Int? = null,
    val message: String? = null
)

@Serializable
data class MicrophoneLevelResponse(
    val success: Boolean,
    val level: Double,  // 0-1
    val peakLevel: Double,
    val rmsLevel: Double
)

// ==================== 播放位置响应 ====================

@Serializable
data class SeekResponse(
    val success: Boolean,
    val position: Double,
    val duration: Double,
    val message: String? = null
)

@Serializable
data class PositionResponse(
    val success: Boolean,
    val position: Double,
    val duration: Double,
    val percent: Double
)

// ==================== 播放模式响应 ====================

@Serializable
data class PlayModeResponse(
    val success: Boolean,
    val repeatMode: String,  // "off", "one", "all"
    val shuffle: Boolean
)

// ==================== 均衡器响应 ====================

@Serializable
data class EqualizerResponse(
    val success: Boolean,
    val enabled: Boolean,
    val preset: String? = null,
    val bands: List<EqualizerBand>
)

@Serializable
data class EqualizerBand(
    val frequency: Int,  // Hz
    val gain: Int  // dB, typically -12 to +12
)

@Serializable
data class EqualizerPresetsResponse(
    val success: Boolean,
    val presets: List<EqualizerPreset>,
    val total: Int
)

@Serializable
data class EqualizerPreset(
    val name: String,
    val bands: List<Int>
)

// ==================== 媒体文件响应 ====================

@Serializable
data class PlayMediaResponse(
    val success: Boolean,
    val path: String,
    val duration: Double? = null,
    val format: String? = null,
    val message: String? = null
)

@Serializable
data class MediaInfoResponse(
    val success: Boolean,
    val path: String,
    val type: String,  // "audio", "video", "image"
    val format: String,
    val duration: Double? = null,
    val width: Int? = null,
    val height: Int? = null,
    val bitrate: Int? = null,
    val sampleRate: Int? = null,
    val channels: Int? = null,
    val codec: String? = null,
    val title: String? = null,
    val artist: String? = null,
    val album: String? = null,
    val year: Int? = null,
    val fileSize: Long
)

// ==================== 摄像头响应 ====================

@Serializable
data class CamerasListResponse(
    val success: Boolean,
    val cameras: List<CameraInfo>,
    val total: Int
)

@Serializable
data class CameraInfo(
    val id: String,
    val name: String,
    val type: String,  // "integrated", "external"
    val resolutions: List<String>? = null,
    val default: Boolean = false
)

@Serializable
data class CapturePhotoResponse(
    val success: Boolean,
    val imageData: String,  // Base64
    val format: String,
    val width: Int,
    val height: Int,
    val size: Int,
    val cameraId: String
)

@Serializable
data class CameraPreviewResponse(
    val success: Boolean,
    val previewId: String,
    val cameraId: String,
    val fps: Int,
    val width: Int,
    val height: Int
)

@Serializable
data class CameraPreviewStopResponse(
    val success: Boolean,
    val previewId: String,
    val frameCount: Int,
    val duration: Double
)

@Serializable
data class CameraFrameResponse(
    val success: Boolean,
    val previewId: String,
    val frameData: String,  // Base64
    val timestamp: Long,
    val frameNumber: Int
)

// ==================== 音频流响应 ====================

@Serializable
data class AudioStreamStartResponse(
    val success: Boolean,
    val streamId: String,
    val format: String,
    val sampleRate: Int,
    val channels: Int
)

@Serializable
data class AudioStreamStopResponse(
    val success: Boolean,
    val streamId: String,
    val duration: Double,
    val bytesStreamed: Long
)

@Serializable
data class AudioStreamDataResponse(
    val success: Boolean,
    val streamId: String,
    val data: String,  // Base64
    val timestamp: Long,
    val chunkSize: Int
)

// ==================== 媒体库响应 ====================

@Serializable
data class MediaScanResponse(
    val success: Boolean,
    val scannedFiles: Int,
    val newFiles: Int,
    val updatedFiles: Int,
    val duration: Long
)

@Serializable
data class MediaSearchResponse(
    val success: Boolean,
    val results: List<MediaItem>,
    val total: Int
)

@Serializable
data class MediaItem(
    val id: String,
    val path: String,
    val type: String,
    val title: String,
    val artist: String? = null,
    val album: String? = null,
    val duration: Double? = null,
    val thumbnail: String? = null
)

@Serializable
data class PlaylistsResponse(
    val success: Boolean,
    val playlists: List<PlaylistInfo>,
    val total: Int
)

@Serializable
data class PlaylistInfo(
    val id: String,
    val name: String,
    val itemCount: Int,
    val totalDuration: Double,
    val createdAt: Long,
    val updatedAt: Long
)

@Serializable
data class PlaylistResponse(
    val success: Boolean,
    val playlist: PlaylistDetail
)

@Serializable
data class PlaylistDetail(
    val id: String,
    val name: String,
    val items: List<MediaItem>,
    val itemCount: Int,
    val totalDuration: Double
)

@Serializable
data class PlaylistUpdateResponse(
    val success: Boolean,
    val playlistId: String,
    val itemCount: Int,
    val message: String? = null
)

@Serializable
data class PlayPlaylistResponse(
    val success: Boolean,
    val playlistId: String,
    val currentIndex: Int,
    val currentItem: MediaItem? = null
)
