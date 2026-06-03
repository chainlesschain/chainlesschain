package com.chainlesschain.android.feature.p2p.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.core.did.manager.DIDManager
import com.chainlesschain.android.core.p2p.config.SignalingConfig
import com.chainlesschain.android.core.p2p.pairing.PairedPeer
import com.chainlesschain.android.core.p2p.pairing.PairedPeersStore
import com.chainlesschain.android.core.p2p.pairing.PairingSignalingGate
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.contentOrNull
import timber.log.Timber
import javax.inject.Inject

/**
 * Mobile 端扫描桌面 QR ViewModel — Android v1.1 W3.7 Flow B (issue #19)。
 *
 * 用户在 Settings → "扫描桌面 QR" 进入摄像头扫码屏，扫到 desktop QR (payload
 * type="desktop-pairing") 后:
 *   1. parse + validate (type / code regex / pcPeerId / timestamp 不超 5min)
 *   2. （v1.1 暂跳本地写库 — 桌面 paired_devices 由 desktop side W3.4a 表负责，
 *       mobile 端只在桌面 ack 后更新 UI）
 *   3. 拿当前 mobile DID + deviceInfo，构 ack payload，经 [PairingSignalingGate]
 *      送到 desktop pcPeerId
 *   4. UI 显示 Success → 用户可返回 Settings
 *
 * Validation 与 desktop `validatePairingCode` 反向对齐（desktop 端检查 mobile
 * 发的 device-pairing；这里检查 desktop 发的 desktop-pairing）。
 */
@HiltViewModel
class ScanDesktopPairingViewModel @Inject constructor(
    private val didManager: DIDManager,
    private val signalingGate: PairingSignalingGate,
    private val signalingConfig: SignalingConfig,
    private val pairedPeersStore: PairedPeersStore,
    private val deviceInfoProvider: PairingDeviceInfoProvider,
    private val clock: PairingClock = PairingClock.System,
) : ViewModel() {

    private val _state = MutableStateFlow<ScanDesktopPairingState>(ScanDesktopPairingState.Scanning)
    val state: StateFlow<ScanDesktopPairingState> = _state.asStateFlow()

    private val json = Json { ignoreUnknownKeys = true }

    /**
     * QRCodeScannerScreen 扫到 QR 时回调本方法。重复扫同 QR 是 idempotent
     * （第二次直接走 Success 路径，不发重复 ack）。
     */
    fun onQrScanned(rawJson: String) {
        if (_state.value !is ScanDesktopPairingState.Scanning) {
            Timber.d("[ScanDesktopPairing] not in Scanning state, ignoring")
            return
        }
        viewModelScope.launch {
            try {
                Timber.i("[ScanDesktopPairing] raw QR (len=${rawJson.length}): ${rawJson.take(200)}")
                val rootElement = json.parseToJsonElement(rawJson)
                if (rootElement !is JsonObject) {
                    // 用户扫到的不是 desktop pairing JSON object — 可能是 DID 字符串、URL、或其他 QR。
                    val preview = rawJson.take(60)
                    _state.value = ScanDesktopPairingState.Failed(
                        "扫到的 QR 不是桌面配对码，请扫桌面 → 设置 → 移动桥 → 重新生成的 QR\n收到: $preview",
                    )
                    return@launch
                }
                val payload = rootElement
                val type = payload["type"]?.jsonPrimitive?.contentOrNull
                if (type != "desktop-pairing") {
                    _state.value = ScanDesktopPairingState.Failed("不是桌面配对 QR (type=$type)")
                    return@launch
                }
                val code = payload["code"]?.jsonPrimitive?.contentOrNull
                if (code == null || !Regex("^\\d{6}$").matches(code)) {
                    _state.value = ScanDesktopPairingState.Failed("配对码必须是 6 位数字")
                    return@launch
                }
                val pcPeerId = payload["pcPeerId"]?.jsonPrimitive?.contentOrNull
                if (pcPeerId.isNullOrBlank()) {
                    _state.value = ScanDesktopPairingState.Failed("缺少 pcPeerId")
                    return@launch
                }
                val timestamp = payload["timestamp"]?.jsonPrimitive?.contentOrNull?.toLongOrNull()
                    ?: 0L
                val age = clock.nowMillis() - timestamp
                if (age > PAIRING_TIMEOUT_MS) {
                    _state.value = ScanDesktopPairingState.Failed(
                        "QR 已过期 (${age / 1000}s > 300s)，请桌面重新生成",
                    )
                    return@launch
                }
                val desktopDeviceInfo = payload["deviceInfo"]?.jsonObject
                val desktopName = desktopDeviceInfo?.get("name")?.jsonPrimitive?.contentOrNull
                    ?: "Desktop"

                // v1.3+ 零配置：QR 含 signalingUrl 时立刻持久化到 SignalingConfig，
                // 后续 PairingSignalingGate.sendAck 会读到这个 URL。修复 #21 中
                // "Connect timeout" 复现（debug 默认 192.168.1.1 占位、NSD mDNS
                // 多播被路由器抑制）。
                val signalingUrl = payload["signalingUrl"]?.jsonPrimitive?.contentOrNull
                if (!signalingUrl.isNullOrBlank() && signalingUrl.startsWith("ws")) {
                    signalingConfig.setCustomSignalingUrl(signalingUrl)
                    Timber.i("[ScanDesktopPairing] ✓ persisted signalingUrl from QR: $signalingUrl")
                }
                // v1.3+ 中继 URL：与 LAN URL 解耦，sendAck 失败时 fallback 到这里。
                // 桌面 dev 默认 wss://signaling.chainlesschain.com（已部署）。
                val relayUrl = payload["relayUrl"]?.jsonPrimitive?.contentOrNull
                if (!relayUrl.isNullOrBlank() && relayUrl.startsWith("ws")) {
                    signalingConfig.setRelayUrl(relayUrl)
                    Timber.i("[ScanDesktopPairing] ✓ persisted relayUrl from QR: $relayUrl")
                }

                val identity = didManager.currentIdentity.value
                if (identity == null) {
                    _state.value = ScanDesktopPairingState.Failed("本地未找到 DID，请先创建身份")
                    return@launch
                }

                _state.value = ScanDesktopPairingState.Sending(desktopName)

                val ackPayload: Map<String, Any?> = mapOf(
                    "type" to "pair-ack",
                    "pairingCode" to code,
                    "mobileDid" to identity.did,
                    "deviceInfo" to mapOf(
                        "deviceId" to deviceInfoProvider.deviceId(),
                        "name" to deviceInfoProvider.name(),
                        "platform" to deviceInfoProvider.platform(),
                    ),
                    "timestamp" to clock.nowMillis(),
                )
                // v1.3+：先试 LAN，失败 → 自动切到中继再试一次。
                // 桌面 outbound 也长连中继，所以同 pcPeerId 在两处都登记，
                // 不用区分目标地址。
                var sendResult = signalingGate.sendAck(pcPeerId, ackPayload)
                if (sendResult.isFailure) {
                    val lanErr = sendResult.exceptionOrNull()?.message ?: "?"
                    Timber.w("[ScanDesktopPairing] LAN sendAck failed ($lanErr), falling back to relay")
                    // 切 URL 前 reset signaling — 否则 gate 的 registeredPeerId 缓存会
                    // 让 ensureRegistered 短路，不真的重连新 URL。
                    signalingGate.reset()
                    val relayUrl = signalingConfig.getRelayUrl()
                    signalingConfig.setCustomSignalingUrl(relayUrl)
                    Timber.i("[ScanDesktopPairing] switching to relay: $relayUrl")
                    sendResult = signalingGate.sendAck(pcPeerId, ackPayload)
                    if (sendResult.isFailure) {
                        val relayErr = sendResult.exceptionOrNull()?.message ?: "信令发送失败"
                        _state.value = ScanDesktopPairingState.Failed(
                            "通知桌面失败 (LAN: $lanErr; 中继: $relayErr)",
                        )
                        return@launch
                    }
                    Timber.i("[ScanDesktopPairing] ✓ relay sendAck succeeded — remote mode")
                }
                // v1.3+ plan B — ICE servers (STUN/TURN) + 24h 凭证；直接原样存 JSON
                val iceServersJson = payload["iceServers"]?.toString()
                val iceExpiry = payload["iceExpiry"]?.jsonPrimitive?.contentOrNull
                    ?.toLongOrNull() ?: 0L

                // v1.3+ 持久化：写本地 prefs，让首页 DesktopConnectionCard 不再读
                // live WS 连接（扫码后信令立刻断），改读这个表 → 显示"已连接 X 台"
                pairedPeersStore.upsert(
                    PairedPeer(
                        pcPeerId = pcPeerId,
                        deviceName = desktopName,
                        platform = desktopDeviceInfo?.get("platform")?.jsonPrimitive?.contentOrNull
                            ?: "desktop",
                        lanSignalingUrl = signalingUrl,
                        relayUrl = relayUrl,
                        iceServersJson = iceServersJson,
                        iceExpiry = iceExpiry,
                        pairedAt = clock.nowMillis(),
                        lastSeenAt = clock.nowMillis(),
                    ),
                )
                _state.value = ScanDesktopPairingState.Success(desktopName)
                Timber.i("[ScanDesktopPairing] ✓ paired with $desktopName ($pcPeerId)")
            } catch (e: Exception) {
                Timber.e(e, "[ScanDesktopPairing] onQrScanned failed")
                _state.value = ScanDesktopPairingState.Failed(e.message ?: "未知错误")
            }
        }
    }

    fun retry() {
        _state.value = ScanDesktopPairingState.Scanning
    }

    companion object {
        private const val PAIRING_TIMEOUT_MS = 5L * 60 * 1000
    }
}

/**
 * 扫描桌面 QR 状态机:
 *   Scanning → Sending → Success | Failed
 */
sealed class ScanDesktopPairingState {
    object Scanning : ScanDesktopPairingState()
    data class Sending(val desktopName: String) : ScanDesktopPairingState()
    data class Success(val desktopName: String) : ScanDesktopPairingState()
    data class Failed(val error: String) : ScanDesktopPairingState()
}
