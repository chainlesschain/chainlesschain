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
}

// 响应数据类

@Serializable
data class VolumeResponse(
    val success: Boolean,
    val volume: Int,
    val muted: Boolean,
    val platform: String
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
    val total: Int
)

@Serializable
data class AudioDevice(
    val id: String? = null,
    val name: String,
    val type: String,
    val default: Boolean? = null,
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
    val error: String? = null
)

@Serializable
data class MediaControlResponse(
    val success: Boolean,
    val action: String,
    val message: String
)
