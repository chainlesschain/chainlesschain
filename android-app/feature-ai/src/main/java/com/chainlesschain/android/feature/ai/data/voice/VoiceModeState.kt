package com.chainlesschain.android.feature.ai.data.voice

/**
 * VoiceMode 状态机。
 *
 * 转移：
 *   Idle → Recording (startRecording)
 *   Recording → Transcribing (stopAndProcess)
 *   Transcribing → Thinking (ASR 成功) | Failed(TRANSCRIBE)
 *   Thinking → Speaking (chat 成功) | Failed(CHAT)
 *   Speaking → Done (TTS+播放成功) | Failed(TTS|PLAY)
 *   Done → Recording (continuousMode=true) | Idle (resetIdle/cancel)
 *   Failed → Idle (resetIdle)
 *   Any → Idle (cancel)
 */
sealed class VoiceModeState {
    data object Idle : VoiceModeState()
    data object Recording : VoiceModeState()
    data object Transcribing : VoiceModeState()
    data class Thinking(val userText: String) : VoiceModeState()
    data class Speaking(val userText: String, val replyText: String) : VoiceModeState()
    data class Done(val userText: String, val replyText: String) : VoiceModeState()
    data class Failed(val stage: Stage, val message: String) : VoiceModeState() {
        enum class Stage { PERMISSION, RECORDING, TRANSCRIBE, CHAT, TTS, PLAY }
    }
}
