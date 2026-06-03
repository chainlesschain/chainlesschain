package com.chainlesschain.android.remote.voice

import android.util.Base64
import com.chainlesschain.android.feature.ai.data.voice.VoiceAudio
import com.chainlesschain.android.feature.ai.data.voice.VoiceChatBridge
import com.chainlesschain.android.feature.ai.data.voice.VoiceChatReply
import com.chainlesschain.android.remote.commands.AICommands
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

/**
 * VoiceMode chat / TTS REMOTE 桥接实现。
 *
 * feature-ai 模块不能 import app（依赖反向），所以这个 bridge 住在 app 侧，把
 * [AICommands.chat] / [AICommands.textToSpeech] 包装成 feature-ai 定义的
 * [VoiceChatBridge] 接口。Hilt 在 `VoiceBridgeModule` 里 @Binds 进 SingletonComponent。
 *
 * 注意：base64 解码 audioData 时用 `Base64.DEFAULT` —— 桌面 mobile-bridge-sync.js 序列化时
 * 也用同款编码（与 ASR 那边 NO_WRAP 不同方向）。
 */
@Singleton
class RemoteVoiceChatBridge @Inject constructor(
    private val aiCommands: AICommands,
) : VoiceChatBridge {

    override suspend fun chat(userText: String, conversationId: String?): Result<VoiceChatReply> {
        val r = aiCommands.chat(message = userText, conversationId = conversationId)
        return r.map { resp ->
            VoiceChatReply(reply = resp.reply, conversationId = resp.conversationId)
        }
    }

    override suspend fun synthesize(text: String): Result<VoiceAudio> {
        val r = aiCommands.textToSpeech(text = text)
        return r.mapCatching { resp ->
            if (!resp.success || resp.audioData.isBlank()) {
                throw IllegalStateException("TTS 返回为空或失败: success=${resp.success}")
            }
            val bytes = try {
                Base64.decode(resp.audioData, Base64.DEFAULT)
            } catch (e: IllegalArgumentException) {
                Timber.e(e, "RemoteVoiceChatBridge.synthesize: base64 decode failed")
                throw e
            }
            VoiceAudio(bytes = bytes, format = resp.format.ifBlank { "mp3" })
        }
    }
}
