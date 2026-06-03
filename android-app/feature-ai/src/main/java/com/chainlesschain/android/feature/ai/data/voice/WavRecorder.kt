package com.chainlesschain.android.feature.ai.data.voice

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import androidx.core.content.ContextCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import timber.log.Timber
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * 16 kHz mono PCM 录音 → WAV 文件。
 *
 * 给 Volcengine 一句话识别用 —— ASR 接受 wav/pcm/m4a 等，wav 16k mono 16-bit
 * 是兼容性最好的组合。文件存到 cacheDir，识别完调用方应自行删除。
 */
@javax.inject.Singleton
class WavRecorder @javax.inject.Inject constructor(
    @dagger.hilt.android.qualifiers.ApplicationContext private val context: Context
) : AudioRecorder {

    private val sampleRate = 16_000
    private val channelConfig = AudioFormat.CHANNEL_IN_MONO
    private val audioFormat = AudioFormat.ENCODING_PCM_16BIT

    @Volatile private var recorder: AudioRecord? = null
    @Volatile private var pcmBuffer: ByteArrayOutputStream? = null
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    @Volatile private var captureJob: Job? = null

    /** 是否有 RECORD_AUDIO 权限 */
    override fun hasPermission(): Boolean = ContextCompat.checkSelfPermission(
        context, Manifest.permission.RECORD_AUDIO
    ) == PackageManager.PERMISSION_GRANTED

    /** 开始录音；幂等（重复调用先丢弃旧的） */
    override fun start(): Boolean {
        cancel()  // 清理旧实例
        if (!hasPermission()) {
            Timber.w("WavRecorder.start: no RECORD_AUDIO permission")
            return false
        }

        val minBuf = AudioRecord.getMinBufferSize(sampleRate, channelConfig, audioFormat)
        if (minBuf <= 0) {
            Timber.e("WavRecorder.start: getMinBufferSize returned $minBuf")
            return false
        }
        val bufSize = minBuf * 2

        val ar = try {
            // hasPermission() 上面已检查过，此处 RECORD_AUDIO 已确保授予
            AudioRecord(
                MediaRecorder.AudioSource.MIC,
                sampleRate,
                channelConfig,
                audioFormat,
                bufSize
            )
        } catch (e: SecurityException) {
            Timber.e(e, "WavRecorder.start: AudioRecord SecurityException")
            return false
        }
        if (ar.state != AudioRecord.STATE_INITIALIZED) {
            Timber.e("WavRecorder.start: AudioRecord not initialized (state=${ar.state})")
            ar.release()
            return false
        }

        val pcmOut = ByteArrayOutputStream()
        recorder = ar
        pcmBuffer = pcmOut

        try {
            ar.startRecording()
        } catch (e: IllegalStateException) {
            Timber.e(e, "WavRecorder.start: startRecording failed")
            ar.release()
            recorder = null
            return false
        }

        captureJob = scope.launch {
            val readBuf = ByteArray(bufSize)
            while (isActive && recorder?.recordingState == AudioRecord.RECORDSTATE_RECORDING) {
                val n = recorder?.read(readBuf, 0, readBuf.size) ?: -1
                if (n > 0) {
                    pcmOut.write(readBuf, 0, n)
                }
            }
        }
        Timber.i("WavRecorder.start: recording 16kHz mono PCM (bufSize=$bufSize)")
        return true
    }

    /**
     * 停止录音并写入 WAV 文件。返回 null 表示失败 / 空录音。
     */
    override suspend fun stopAndWriteWav(): File? {
        val ar = recorder ?: return null
        val pcmOut = pcmBuffer
        captureJob?.cancelAndJoin()
        captureJob = null
        try {
            ar.stop()
        } catch (e: IllegalStateException) {
            Timber.w(e, "WavRecorder.stop: AudioRecord.stop threw (already stopped?)")
        }
        ar.release()
        recorder = null
        pcmBuffer = null

        val pcmBytes = pcmOut?.toByteArray() ?: return null
        if (pcmBytes.isEmpty()) {
            Timber.w("WavRecorder.stop: empty PCM")
            return null
        }

        val wavFile = File(context.cacheDir, "voice_${System.currentTimeMillis()}.wav")
        FileOutputStream(wavFile).use { fos ->
            writeWavHeader(fos, pcmBytes.size, sampleRate)
            fos.write(pcmBytes)
        }
        Timber.i("WavRecorder.stop: wrote ${pcmBytes.size}B PCM → ${wavFile.absolutePath}")
        return wavFile
    }

    /** 取消录音 + 丢弃数据 */
    override fun cancel() {
        captureJob?.cancel()
        captureJob = null
        try {
            recorder?.stop()
        } catch (_: Exception) { }
        recorder?.release()
        recorder = null
        pcmBuffer = null
    }

    private fun writeWavHeader(out: FileOutputStream, pcmDataSize: Int, sampleRate: Int) {
        val totalDataLen = pcmDataSize + 36
        val byteRate = sampleRate * 1 * 16 / 8 // mono 16-bit
        val header = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN)
        header.put("RIFF".toByteArray())
        header.putInt(totalDataLen)
        header.put("WAVE".toByteArray())
        header.put("fmt ".toByteArray())
        header.putInt(16)             // sub-chunk size for PCM
        header.putShort(1)            // PCM
        header.putShort(1)            // mono
        header.putInt(sampleRate)
        header.putInt(byteRate)
        header.putShort(2)            // block align (2 = mono * 16-bit)
        header.putShort(16)           // bits per sample
        header.put("data".toByteArray())
        header.putInt(pcmDataSize)
        out.write(header.array())
    }
}
