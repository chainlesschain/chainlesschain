package com.chainlesschain.android.call

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.Ringtone
import android.media.RingtoneManager
import android.media.ToneGenerator
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import dagger.hilt.android.qualifiers.ApplicationContext
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

/**
 * FAMILY-67 通话铃声（P3+）。来电响系统默认铃声 + 振动（尊重响铃/静音模式）；去电播回铃音。
 * 由 [AndroidCallServiceLauncher] 按通话状态驱动：INCOMING→[startRinging]、OUTGOING(_RINGING)→
 * [startRingback]、其余/结束→[stop]。前台浮层与锁屏来电页都覆盖（在 Android 侧单例驱动，与 UI 解耦）。
 */
@Singleton
class CallRinger @Inject constructor(
    @ApplicationContext private val context: Context,
) {
    private val am: AudioManager? = context.getSystemService(Context.AUDIO_SERVICE) as? AudioManager

    @Volatile private var ringtone: Ringtone? = null
    @Volatile private var toneGen: ToneGenerator? = null
    @Volatile private var ringing = false

    private val vibrator: Vibrator? by lazy {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            (context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? VibratorManager)?.defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            context.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
        }
    }

    /** 来电：响铃 + 振动（静音模式只振动；振动模式只振动；正常模式响铃+振动）。 */
    @Synchronized
    fun startRinging() {
        if (ringing) return
        ringing = true
        val mode = am?.ringerMode ?: AudioManager.RINGER_MODE_NORMAL
        runCatching {
            if (mode == AudioManager.RINGER_MODE_NORMAL) {
                val uri = RingtoneManager.getActualDefaultRingtoneUri(context, RingtoneManager.TYPE_RINGTONE)
                    ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
                ringtone = RingtoneManager.getRingtone(context, uri)?.apply {
                    audioAttributes = AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build()
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) isLooping = true
                    play()
                }
            }
            if (mode != AudioManager.RINGER_MODE_SILENT) startVibrate()
        }.onFailure { Timber.w(it, "[CallRinger] startRinging failed") }
        Timber.d("[CallRinger] ringing (mode=$mode)")
    }

    /** 去电：回铃音（听筒/扬声器侧的「嘟——嘟——」）。 */
    @Synchronized
    fun startRingback() {
        if (ringing) return
        ringing = true
        runCatching {
            toneGen = ToneGenerator(AudioManager.STREAM_VOICE_CALL, 70).apply {
                startTone(ToneGenerator.TONE_SUP_RINGTONE) // 自带循环
            }
        }.onFailure { Timber.w(it, "[CallRinger] startRingback failed") }
    }

    @Synchronized
    fun stop() {
        if (!ringing) return
        ringing = false
        runCatching { ringtone?.stop() }
        runCatching { toneGen?.stopTone(); toneGen?.release() }
        runCatching { vibrator?.cancel() }
        ringtone = null; toneGen = null
        Timber.d("[CallRinger] stopped")
    }

    private fun startVibrate() {
        val v = vibrator ?: return
        if (!v.hasVibrator()) return
        val pattern = longArrayOf(0, 800, 1000) // wait, vibrate, pause —— 循环
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            v.vibrate(VibrationEffect.createWaveform(pattern, 0))
        } else {
            @Suppress("DEPRECATION")
            v.vibrate(pattern, 0)
        }
    }
}
