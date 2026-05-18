package com.chainlesschain.android.presentation.screens.turn

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.config.TurnEphemeralCredentials
import com.chainlesschain.android.config.TurnEphemeralRefresher
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
    // v1.2 prep #2: ephemeral mode refresher
    private val ephemeralRefresher: TurnEphemeralRefresher,
) : ViewModel() {

    val turnServers: StateFlow<List<TurnServerCredentials>> = preferences.turnServers
    val transportPolicy: StateFlow<PeerConnection.IceTransportsType> = preferences.transportPolicy

    // v1.2 prep #2 ephemeral state for UI
    val ephemeralEnabled: StateFlow<Boolean> = preferences.ephemeralEnabled
    val ephemeralEndpointUrl: StateFlow<String> = preferences.ephemeralEndpointUrl

    private val _testResult = MutableStateFlow<StunTestResult?>(null)
    val testResult: StateFlow<StunTestResult?> = _testResult.asStateFlow()

    /** v1.2 prep #2：当前 refresher 取到的 ephemeral creds snapshot；UI 可显示状态。 */
    fun currentEphemeral(): TurnEphemeralCredentials? = ephemeralRefresher.current()

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

    // ===== v1.2 prep #2 ephemeral mode =====

    fun setEphemeralEnabled(enabled: Boolean) {
        preferences.setEphemeralEnabled(enabled)
        // toggle on → 立即启动 refresher 取 token；off → cancel loop
        ephemeralRefresher.restart()
    }

    fun setEphemeralEndpointUrl(url: String) {
        preferences.setEphemeralEndpointUrl(url)
        // URL 变化时 enabled 已 on 则重启 refresher 用新 URL
        if (preferences.ephemeralEnabled.value) {
            ephemeralRefresher.restart()
        }
    }
}
