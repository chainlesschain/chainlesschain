package com.chainlesschain.android.presentation.screens.turn

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.config.TurnServerPreferences
import com.chainlesschain.android.core.p2p.ice.IceServerConfig
import com.chainlesschain.android.core.p2p.ice.StunTestResult
import com.chainlesschain.android.core.p2p.ice.TurnServerCredentials
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import org.webrtc.PeerConnection
import javax.inject.Inject

/**
 * v1.1 issue #19 W3：TURN 中继 Settings 页 ViewModel。
 *
 * 包 [TurnServerPreferences] (持久化) + [IceServerConfig] (运行时 push) +
 * STUN 测试入口（onTestStun 复用 IceServerConfig.testStunServer）。
 *
 * 用户操作 → preferences 即时保存 → 同步 push 到 IceServerConfig（让下次 connect 生效）。
 */
@HiltViewModel
class TurnSettingsViewModel @Inject constructor(
    private val preferences: TurnServerPreferences,
    private val iceConfig: IceServerConfig,
) : ViewModel() {

    val turnServers: StateFlow<List<TurnServerCredentials>> = preferences.turnServers
    val transportPolicy: StateFlow<PeerConnection.IceTransportsType> = preferences.transportPolicy

    private val _testResult = MutableStateFlow<StunTestResult?>(null)
    val testResult: StateFlow<StunTestResult?> = _testResult.asStateFlow()

    fun addTurnServer(url: String, username: String, password: String): Boolean {
        val ok = preferences.addTurnServer(url, username, password)
        if (ok) {
            iceConfig.addTurnServer(url, username, password)
        }
        return ok
    }

    fun removeTurnServer(url: String) {
        preferences.removeTurnServer(url)
        iceConfig.removeTurnServer(url)
    }

    fun setTransportPolicy(policy: PeerConnection.IceTransportsType) {
        preferences.setTransportPolicy(policy)
        iceConfig.setIceTransportPolicy(policy)
    }

    fun testStun(url: String) {
        viewModelScope.launch {
            _testResult.value = null
            _testResult.value = iceConfig.testStunServer(url)
        }
    }

    fun clearTestResult() {
        _testResult.value = null
    }
}
