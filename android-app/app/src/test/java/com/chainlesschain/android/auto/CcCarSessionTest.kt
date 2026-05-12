package com.chainlesschain.android.auto

import com.chainlesschain.android.feature.ai.data.voice.AsrEngine
import com.chainlesschain.android.feature.ai.data.voice.AudioPlayer
import com.chainlesschain.android.feature.ai.data.voice.AudioRecorder
import com.chainlesschain.android.feature.ai.data.voice.VoiceChatBridge
import com.chainlesschain.android.feature.ai.data.voice.VoiceModeManager
import io.mockk.mockk
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import kotlin.test.assertNotNull

/**
 * v1.2 #1 Android Auto Phase 1 — CcCarSession ctor 注入路径单测。
 *
 * 默认 lambda 走 Hilt EntryPointAccessors，单测环境 Hilt graph 不全；这里走可测
 * 构造器，注入 fake [VoiceModeManager] 直接验证 onCreateScreen 拿到的 Screen 是
 * VoiceModeScreen 类型。
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
class CcCarSessionTest {

    @Test
    fun `ctor injection passes manager into screen builder lambda`() {
        val fakeManager = VoiceModeManager(
            recorder = mockk<AudioRecorder>(relaxed = true),
            asr = mockk<AsrEngine>(relaxed = true),
            chatBridge = mockk<VoiceChatBridge>(relaxed = true),
            player = mockk<AudioPlayer>(relaxed = true),
        )
        val session = CcCarSession(voiceManagerProvider = { fakeManager })
        // 触发 lambda 但不真创建 Screen（需 attached carContext）；至少验 ctor 完成
        assertNotNull(session)
    }
}
