package com.chainlesschain.android.presentation.screens.voice

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.feature.ai.data.voice.VoiceModeManager
import com.chainlesschain.android.feature.ai.data.voice.VoiceModeState
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * VoiceMode 演示 ViewModel。M3 D1 配套 UI。
 *
 * 业务逻辑全在 [VoiceModeManager]，这里只做 viewModelScope 的 suspend 调用 + 配置开关。
 */
@HiltViewModel
class VoiceModeViewModel @Inject constructor(
    private val manager: VoiceModeManager,
) : ViewModel() {

    val state: StateFlow<VoiceModeState> = manager.state

    var continuousMode: Boolean
        get() = manager.continuousMode
        set(value) { manager.continuousMode = value }

    fun startRecording() {
        manager.startRecording()
    }

    fun stopAndProcess() {
        viewModelScope.launch {
            manager.stopAndProcess()
        }
    }

    fun cancel() {
        manager.cancel()
    }

    fun resetIdle() {
        manager.resetIdle()
    }

    fun resetConversation() {
        manager.resetConversation()
    }
}
