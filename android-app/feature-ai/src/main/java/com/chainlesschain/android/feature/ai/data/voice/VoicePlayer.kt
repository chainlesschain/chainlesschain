package com.chainlesschain.android.feature.ai.data.voice

import android.content.Context
import android.media.MediaPlayer
import kotlinx.coroutines.suspendCancellableCoroutine
import timber.log.Timber
import java.io.File
import java.io.FileOutputStream
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.coroutines.resume

/**
 * MediaPlayer 包装。写到 cacheDir 临时文件再播放，避免 setDataSource(byteArrayInputStream) 在
 * mp3 上的解码失败（MediaPlayer 不支持 InputStream，只支持 FileDescriptor / Uri / path）。
 *
 * 播放完成后 suspendCancellableCoroutine resume。取消时调 stop() 直接撤掉 player。
 */
@Singleton
class VoicePlayer @Inject constructor(
    @dagger.hilt.android.qualifiers.ApplicationContext private val context: Context
) : AudioPlayer {

    @Volatile private var player: MediaPlayer? = null

    override suspend fun play(audioBytes: ByteArray, format: String): Boolean {
        if (audioBytes.isEmpty()) {
            Timber.w("VoicePlayer.play: empty bytes")
            return false
        }
        stop()
        val ext = format.lowercase().ifBlank { "mp3" }
        val tmp = File(context.cacheDir, "tts_${System.currentTimeMillis()}.$ext")
        FileOutputStream(tmp).use { it.write(audioBytes) }

        return try {
            suspendCancellableCoroutine { cont ->
                val mp = MediaPlayer()
                player = mp
                mp.setOnPreparedListener { it.start() }
                mp.setOnCompletionListener {
                    Timber.d("VoicePlayer.play: complete (${tmp.name})")
                    cleanup(tmp)
                    if (cont.isActive) cont.resume(true)
                }
                mp.setOnErrorListener { _, what, extra ->
                    Timber.e("VoicePlayer.play: error what=$what extra=$extra (${tmp.name})")
                    cleanup(tmp)
                    if (cont.isActive) cont.resume(false)
                    true
                }
                cont.invokeOnCancellation {
                    Timber.d("VoicePlayer.play: cancelled (${tmp.name})")
                    cleanup(tmp)
                }
                try {
                    mp.setDataSource(tmp.absolutePath)
                    mp.prepareAsync()
                } catch (e: Exception) {
                    Timber.e(e, "VoicePlayer.play: setDataSource failed")
                    cleanup(tmp)
                    if (cont.isActive) cont.resume(false)
                }
            }
        } catch (e: Exception) {
            Timber.e(e, "VoicePlayer.play: top-level fail")
            cleanup(tmp)
            false
        }
    }

    override fun stop() {
        player?.let { mp ->
            try {
                if (mp.isPlaying) mp.stop()
            } catch (_: IllegalStateException) { /* already released */ }
            try {
                mp.release()
            } catch (_: Exception) { }
        }
        player = null
    }

    private fun cleanup(tmp: File) {
        player?.let {
            try { it.release() } catch (_: Exception) { }
        }
        player = null
        try { tmp.delete() } catch (_: Exception) { }
    }
}
