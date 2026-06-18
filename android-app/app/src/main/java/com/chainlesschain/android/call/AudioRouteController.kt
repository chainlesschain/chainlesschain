package com.chainlesschain.android.call

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import dagger.hilt.android.qualifiers.ApplicationContext
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

/**
 * FAMILY-67 通话音频路由 / 焦点（设计 §5）。
 *
 * 通话期：`MODE_IN_COMMUNICATION` + 申请音频焦点 + 默认听筒（可切扬声器）。结束恢复。
 * 接近传感器息屏由 UI 层（CallActivity）用 PROXIMITY_SCREEN_OFF_WAKE_LOCK 处理。
 */
@Singleton
class AudioRouteController @Inject constructor(
    @ApplicationContext private val context: Context,
) {
    private val am: AudioManager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    private var savedMode = AudioManager.MODE_NORMAL
    private var savedSpeaker = false
    private var focusRequest: AudioFocusRequest? = null

    /** 进入通话音频态。 */
    fun startCallAudio() {
        runCatching {
            savedMode = am.mode
            savedSpeaker = am.isSpeakerphoneOn
            requestFocus()
            am.mode = AudioManager.MODE_IN_COMMUNICATION
            am.isSpeakerphoneOn = false // 默认听筒
            Timber.i("[AudioRoute] call audio started (mode=IN_COMMUNICATION, earpiece)")
        }.onFailure { Timber.w(it, "[AudioRoute] startCallAudio failed") }
    }

    fun setSpeaker(on: Boolean) {
        runCatching { am.isSpeakerphoneOn = on }
    }

    fun isSpeakerOn(): Boolean = runCatching { am.isSpeakerphoneOn }.getOrDefault(false)

    /** 退出通话音频态，恢复原状。 */
    fun stopCallAudio() {
        runCatching {
            abandonFocus()
            am.mode = savedMode
            am.isSpeakerphoneOn = savedSpeaker
            Timber.i("[AudioRoute] call audio stopped (restored)")
        }.onFailure { Timber.w(it, "[AudioRoute] stopCallAudio failed") }
    }

    private fun requestFocus() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val attrs = AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                .build()
            val req = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
                .setAudioAttributes(attrs)
                .build()
            focusRequest = req
            am.requestAudioFocus(req)
        } else {
            @Suppress("DEPRECATION")
            am.requestAudioFocus(null, AudioManager.STREAM_VOICE_CALL, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
        }
    }

    private fun abandonFocus() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            focusRequest?.let { am.abandonAudioFocusRequest(it) }
            focusRequest = null
        } else {
            @Suppress("DEPRECATION")
            am.abandonAudioFocus(null)
        }
    }
}
