package com.chainlesschain.android.feature.p2p.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.core.did.manager.DIDManager
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import javax.inject.Inject

/**
 * 桌面配对 ViewModel — Android v1.1 W3.2 Flow A (issue #19)。
 *
 * **架构**：mobile 显示 QR + 6 位 code，desktop 扫码（`device-pairing-handler.js`
 * 的 `handleQRCodeScan`）。本 ViewModel 负责：
 *   1. 从 [DIDManager.currentIdentity] 取当前活跃 DID
 *   2. 生成 6 位数字配对码（与桌面 `validatePairingCode` 的 `^\d{6}$` 正则对齐）
 *   3. 拼出 QR JSON payload `{type:"device-pairing", code, did, deviceInfo, timestamp}`
 *      （与 desktop `device-pairing-handler.js::validatePairingCode` 字段对齐）
 *   4. 暴露 [pairingState] 状态机给 UI；5 分钟过期与 desktop 的 `pairingTimeout`
 *      （5 _ 60 _ 1000）对齐
 *
 * **未在本 commit**：
 *   - 真 QR bitmap 渲染（zxing 引入 → W3.3）
 *   - 桌面扫描后回的 `pairing:confirmation` 信令监听 → Completed 状态由 W3.3 触发
 *   - Settings 入口 + NavGraph 接线 → W3.1 commit 一起来
 *
 * **不与现有 [PairingViewModel] 复用**：那是 Signal Protocol 端到端会话配对
 * （peer-to-peer e2ee），不是 mobile↔desktop QR 配对。两个 ViewModel 并存。
 */
@HiltViewModel
class DesktopPairingViewModel @Inject constructor(
    private val didManager: DIDManager,
    private val deviceInfoProvider: PairingDeviceInfoProvider,
    private val clock: PairingClock = PairingClock.System,
    private val codeGenerator: PairingCodeGenerator = PairingCodeGenerator.Random,
) : ViewModel() {

    private val _pairingState = MutableStateFlow<DesktopPairingState>(DesktopPairingState.Idle)
    val pairingState: StateFlow<DesktopPairingState> = _pairingState.asStateFlow()

    private var expiryJob: Job? = null

    /**
     * 开始配对流程：生成 code + payload 进 Displaying 状态。idempotent — 反复调用
     * 会重置 code/timestamp。
     */
    fun startPairing() {
        viewModelScope.launch {
            try {
                val identity = didManager.currentIdentity.value
                    ?: run {
                        _pairingState.value = DesktopPairingState.Failed(
                            "未找到活跃 DID，先创建或导入身份",
                        )
                        return@launch
                    }
                val code = codeGenerator.generate()
                val timestamp = clock.nowMillis()
                val payload = PairingQrPayload(
                    type = "device-pairing",
                    code = code,
                    did = identity.did,
                    deviceInfo = PairingDeviceInfo(
                        deviceId = deviceInfoProvider.deviceId(),
                        name = deviceInfoProvider.name(),
                        platform = deviceInfoProvider.platform(),
                    ),
                    timestamp = timestamp,
                )
                _pairingState.value = DesktopPairingState.Displaying(
                    payload = payload,
                    payloadJson = JSON.encodeToString(payload),
                    expiresAt = timestamp + PAIRING_TIMEOUT_MS,
                )
                scheduleExpiry()
            } catch (e: Exception) {
                _pairingState.value = DesktopPairingState.Failed(e.message ?: "未知错误")
            }
        }
    }

    /**
     * 取消并回到 Idle。
     */
    fun cancelPairing() {
        expiryJob?.cancel()
        expiryJob = null
        _pairingState.value = DesktopPairingState.Idle
    }

    /**
     * W3.3 桌面端 `pairing:confirmation` 信令到达时由 listener 调用。
     * 当前 commit 暴露 internal API，方便 W3.3 + 单测触发。
     */
    internal fun markConfirmed() {
        if (_pairingState.value is DesktopPairingState.Displaying) {
            expiryJob?.cancel()
            expiryJob = null
            _pairingState.value = DesktopPairingState.Completed
        }
    }

    private fun scheduleExpiry() {
        expiryJob?.cancel()
        expiryJob = viewModelScope.launch {
            delay(PAIRING_TIMEOUT_MS)
            if (_pairingState.value is DesktopPairingState.Displaying) {
                _pairingState.value = DesktopPairingState.Expired
            }
        }
    }

    override fun onCleared() {
        super.onCleared()
        expiryJob?.cancel()
    }

    companion object {
        const val PAIRING_TIMEOUT_MS = 5L * 60 * 1000 // 与 desktop pairingTimeout 对齐
        private val JSON = Json {
            encodeDefaults = true
            prettyPrint = false
        }
    }
}

/**
 * Desktop 配对状态机。Flow A 视角（mobile 显示 QR）：
 *   Idle → Displaying → Completed | Expired | Failed
 */
sealed class DesktopPairingState {
    object Idle : DesktopPairingState()

    /**
     * 正在显示 QR 给桌面扫描。
     *
     * @param payload 结构化字段
     * @param payloadJson 已 JCS-style serialize 的 JSON 字符串，UI 直接 encode 进 QR bitmap
     * @param expiresAt epoch-ms，UI 可显示倒计时
     */
    data class Displaying(
        val payload: PairingQrPayload,
        val payloadJson: String,
        val expiresAt: Long,
    ) : DesktopPairingState()

    object Completed : DesktopPairingState()
    object Expired : DesktopPairingState()
    data class Failed(val error: String) : DesktopPairingState()
}

/**
 * QR 内容。字段与桌面 `device-pairing-handler.js::validatePairingCode` 严格对齐。
 */
@Serializable
data class PairingQrPayload(
    val type: String,
    val code: String,
    val did: String,
    val deviceInfo: PairingDeviceInfo,
    val timestamp: Long,
)

@Serializable
data class PairingDeviceInfo(
    val deviceId: String,
    val name: String,
    val platform: String,
)

/**
 * 抽象设备信息提供，方便测试注入 fake。生产 [com.chainlesschain.android.di.AndroidPairingDeviceInfoProvider]
 * 用 `Settings.Secure.ANDROID_ID` + `Build.MODEL`。
 */
interface PairingDeviceInfoProvider {
    fun deviceId(): String
    fun name(): String
    fun platform(): String
}

/**
 * 抽象时钟，测试可控时间。
 */
interface PairingClock {
    fun nowMillis(): Long

    object System : PairingClock {
        override fun nowMillis(): Long = java.lang.System.currentTimeMillis()
    }
}

/**
 * 6 位数字 code 生成器，测试可注入确定性 fake。
 */
interface PairingCodeGenerator {
    fun generate(): String

    object Random : PairingCodeGenerator {
        override fun generate(): String =
            (100000..999999).random().toString()
    }
}
