package com.chainlesschain.android.feature.ai.data.voice

import timber.log.Timber
import java.io.File
import javax.inject.Inject
import javax.inject.Singleton

/**
 * v1.1 issue #19 W4：ASR 引擎路由器。
 *
 * 实 [AsrEngine] 接口；transcribe 时按 [AsrEnginePreferences.engine] 当前值委托给：
 *  - [AsrEngineChoice.Volcengine] → [VolcengineAsrClient]
 *  - [AsrEngineChoice.Whisper] → [WhisperAsrEngine] (v1.1 stub 抛 [WhisperNotInstalledException])
 *
 * 用户在 Settings → ASR 引擎切换无需重启 app —— 下次 transcribe 即生效（preferences 是
 * 即读，无 cache）。
 *
 * AIModule.provideAsrEngine 改为返回本 router（替代直接返 VolcengineAsrClient），让
 * 现有 VoiceModeManager / 任何 AsrEngine 调用方透明 multi-engine。
 */
@Singleton
class AsrEngineRouter @Inject constructor(
    private val preferences: AsrEnginePreferences,
    private val volcengine: VolcengineAsrClient,
    private val whisper: WhisperAsrEngine,
) : AsrEngine {

    override suspend fun transcribe(audioFile: File): String {
        val engine = preferences.engine.value
        Timber.d("AsrEngineRouter.transcribe: routing to $engine (audio=%s)", audioFile.name)
        return when (engine) {
            AsrEngineChoice.Volcengine -> volcengine.transcribe(audioFile)
            AsrEngineChoice.Whisper -> whisper.transcribe(audioFile)
        }
    }
}
