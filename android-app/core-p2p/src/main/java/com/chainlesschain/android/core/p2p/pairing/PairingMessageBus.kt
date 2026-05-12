package com.chainlesschain.android.core.p2p.pairing

import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Pairing 信令消息总线 — Android v1.1 W3.3b (issue #19)。
 *
 * **架构动机**：mobile↔desktop QR pairing 的 desktop 端确认信号
 * `{type:"pairing:confirmation", pairingCode, pcPeerId, deviceInfo, timestamp}`
 * 经 WebSocket 信令服务器到达 Android。`WebSocketSignalClient` 在 :app 模块、
 * `SignalClient` interface 也在 :app；`DesktopPairingViewModel` 在 feature-p2p
 * 不能反向依赖 :app。
 *
 * 本接口落在 core-p2p（:app 和 feature-p2p 都依赖），用 SharedFlow 解耦：
 *   - :app `WebSocketSignalClient` 在 handleSignalingMessage 里识别 pairing
 *     payload → [emit]
 *   - feature-p2p `DesktopPairingViewModel` 注入接口订阅 [confirmations]
 *     → 匹配 `pairingCode` → `markConfirmed`
 *
 * 不动 SignalClient interface 跨模块 refactor，与并行 session 的 SignalClient
 * 改动隔离。
 *
 * **Why SharedFlow not StateFlow**: pairing confirmation 是离散事件（每次配对
 * 只发一次），不是持续状态；多次配对会有多条 confirmation，需要 SharedFlow 的
 * 缓冲行为而非 StateFlow 的 "latest value" 语义。
 */
interface PairingMessageBus {
    /** 订阅 confirmation 事件流。多订阅者 broadcast，replay = 0（即时事件）。 */
    val confirmations: SharedFlow<PairingConfirmation>

    /** Producer 端调用：发布一条 confirmation（信令侧从 desktop 收到时）。 */
    fun emit(confirmation: PairingConfirmation)
}

/**
 * Desktop 经信令服务器发回的配对确认。字段与 desktop
 * `device-pairing-handler.js::sendConfirmation` 的 `confirmationMessage` 对齐。
 */
data class PairingConfirmation(
    /** 6 位 pairing code，与 mobile 显示给 desktop 的 [PairingQrPayload.code] 匹配 */
    val pairingCode: String,
    /** Desktop 的 peer-id，供 mobile 后续 WebRTC connect 用 */
    val pcPeerId: String,
    /** Desktop 端机器名 / platform 等元数据，可空 */
    val deviceInfo: Map<String, String>?,
    /** Desktop 发送时戳 epoch-ms */
    val timestamp: Long,
)

/**
 * 默认 Hilt 提供的单例 impl。replay = 0，缓冲 8 条防短时丢失。
 */
@Singleton
class DefaultPairingMessageBus @Inject constructor() : PairingMessageBus {

    private val _confirmations = MutableSharedFlow<PairingConfirmation>(
        replay = 0,
        extraBufferCapacity = 8,
    )
    override val confirmations: SharedFlow<PairingConfirmation> =
        _confirmations.asSharedFlow()

    override fun emit(confirmation: PairingConfirmation) {
        // tryEmit 同步路径：缓冲 8 条之内不阻塞；溢出返 false（调用方仅 best-effort log）
        _confirmations.tryEmit(confirmation)
    }
}
