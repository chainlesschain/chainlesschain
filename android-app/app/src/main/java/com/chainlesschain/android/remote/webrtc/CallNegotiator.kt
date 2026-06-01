package com.chainlesschain.android.remote.webrtc

import javax.inject.Inject

/** WebRTC 通话角色（FAMILY-31）。 */
enum class CallRole {
    /** 主叫：createOffer → 等 answer。 */
    INITIATOR,

    /** 被叫：等 offer → 回 answer（DataChannel 经 onDataChannel 受领）。 */
    RESPONDER,
}

/**
 * 通话角色协商（FAMILY-31，Spike 2 §5.2）。
 *
 * mobile↔mobile 双方可同时 connect，必须**确定性**地各自算出互补角色，避免双方都
 * createOffer（WebRTC glare）。规则：
 *
 *   - **字典序选 initiator**：`localPeerId < targetPeerId` → INITIATOR，否则 RESPONDER。
 *     两端用同一规则独立计算 → 恰好一端 INITIATOR、一端 RESPONDER，无需额外协商往返。
 *   - **echo-loop 防御**：`localPeerId == targetPeerId` 抛错 —— 自己呼自己会让信令服务器把
 *     消息回环到自身（见 [[feedback_currentpeerid_target_vs_self_trap]] 真机事故）。
 *   - **collision 重试**：极少数真 glare（两端都已发 offer）时，字典序**大**者退让，
 *     [COLLISION_RETRY_MS] 后重发；小者保持 initiator。保证恰好一端重试。
 *
 * 纯无状态逻辑 → 100% 单测覆盖（acceptance「人造 collision 测试通过」）。真实 call 流
 * 调用方（P2PClient / FamilyCallRpcClient）在 FAMILY-34 接 family.call.* envelope 时接入。
 */
class CallNegotiator @Inject constructor() {

    /**
     * 算本端在与 [targetPeerId] 的通话中的角色。
     * @throws IllegalArgumentException 当 local == target（echo-loop）。
     */
    fun decideRole(localPeerId: String, targetPeerId: String): CallRole {
        require(localPeerId != targetPeerId) {
            "echo-loop guard: localPeerId == targetPeerId ($localPeerId); 不能呼叫自己"
        }
        return if (localPeerId < targetPeerId) CallRole.INITIATOR else CallRole.RESPONDER
    }

    /** [decideRole] 的便利包装 → 直接喂 WebRTCClient.connect(isInitiator=...)。 */
    fun isInitiator(localPeerId: String, targetPeerId: String): Boolean =
        decideRole(localPeerId, targetPeerId) == CallRole.INITIATOR

    /**
     * 真 glare（两端都发了 offer）时，本端是否应退让重试。字典序大者退让，
     * [COLLISION_RETRY_MS] 后重发；小者不退（保持 initiator）。
     * @throws IllegalArgumentException 当 local == target。
     */
    fun shouldRetryOnCollision(localPeerId: String, targetPeerId: String): Boolean {
        require(localPeerId != targetPeerId) {
            "echo-loop guard: localPeerId == targetPeerId ($localPeerId)"
        }
        return localPeerId > targetPeerId
    }

    companion object {
        /** glare 退让重试延迟（Spike 2 §5.2）。 */
        const val COLLISION_RETRY_MS: Long = 200L
    }
}
