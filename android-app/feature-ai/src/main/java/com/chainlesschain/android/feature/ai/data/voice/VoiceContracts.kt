package com.chainlesschain.android.feature.ai.data.voice

import java.io.File

/**
 * 录音器抽象，便于单测 fake。WavRecorder 实现此接口。
 */
interface AudioRecorder {
    fun hasPermission(): Boolean
    fun start(): Boolean
    suspend fun stopAndWriteWav(): File?
    fun cancel()
}

/**
 * ASR 引擎抽象，便于单测 fake。VolcengineAsrClient 实现此接口。
 */
interface AsrEngine {
    suspend fun transcribe(audioFile: File): String
}

/**
 * 音频播放器抽象。Android 端用 MediaPlayer 实现；测试用 fake。
 */
interface AudioPlayer {
    /** 播放完成后 resume；失败返回 false 并把 throwable 塞 lastError */
    suspend fun play(audioBytes: ByteArray, format: String = "mp3"): Boolean
    fun stop()
}

/**
 * VoiceMode 跨模块通道。feature-ai 不能依赖 app，所以把 REMOTE chat / TTS 抽成接口
 * 让 app 模块（持有 RemoteCommandClient）做实装注入。
 */
interface VoiceChatBridge {
    /**
     * 调用桌面 LLM 对话。第一次 conversationId=null，桌面创建并回传，后续传同一 id 维持上下文。
     */
    suspend fun chat(userText: String, conversationId: String?): Result<VoiceChatReply>

    /**
     * 调用桌面 TTS 把文本合成音频；返回原始字节 + 格式（mp3/wav/ogg）。
     */
    suspend fun synthesize(text: String): Result<VoiceAudio>
}

data class VoiceChatReply(val reply: String, val conversationId: String)

data class VoiceAudio(val bytes: ByteArray, val format: String) {
    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (other !is VoiceAudio) return false
        return format == other.format && bytes.contentEquals(other.bytes)
    }
    override fun hashCode(): Int = 31 * bytes.contentHashCode() + format.hashCode()
}
