package com.chainlesschain.android.wear

import com.chainlesschain.agent.protocol.generated.ApprovalDecision
import com.chainlesschain.android.auto.AutoApprovalDecision
import com.chainlesschain.android.auto.AutoPushBus
import com.chainlesschain.android.core.agentprotocol.ApprovalDecisionEnvelope
import com.chainlesschain.android.core.agentprotocol.toLegacyApproved
import com.chainlesschain.android.push.NotificationPayload
import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.WearableListenerService
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import timber.log.Timber
import javax.inject.Inject

/**
 * v1.2 #20 P0.2 Wear Phase 2 — phone-side decision listener。
 *
 * 接收 watch → phone 的 `/cc/decision` message。反序列化
 * [ApprovalDecisionEnvelope]
 * 后路由：
 *   - id 前缀 "mp:" → marketplace approval：emit AutoPushBus.userDecision，让
 *     Auto Phase 2 已建的 ApprovalCoordinator (后续 commit) 决定走 multisig
 *     sign / cancel 或直接 consume
 *   - id 前缀 "sys:" → SystemAlert 类：仅 log + emit AutoPushBus (audit 用)
 *   - 未知前缀 → log warn，no-op
 *
 * @AndroidEntryPoint 让 service 走 Hilt graph 注入 [AutoPushBus]。
 *
 * Phase 2 不直接调 multisig sign / cancel — 那需要 watch 端有 signer 私钥，
 * v1.2 我们不放 wear 端私钥（设计 §9 安全 #4）。Phase 3+ 评估方案：
 *   - 选 A：watch 决定 forward 到 phone，phone 用自己持有的 signer key 完成签名
 *   - 选 B：watch 端单独 keystore + StrongBox enclave (Wear OS 4+ 支持) 走 m-of-n 中一签
 */
@AndroidEntryPoint
class CcPhoneDecisionListener : WearableListenerService() {

    @Inject lateinit var autoPushBus: AutoPushBus

    private val json = Json { ignoreUnknownKeys = true; isLenient = true }
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onMessageReceived(messageEvent: MessageEvent) {
        super.onMessageReceived(messageEvent)
        if (messageEvent.path != PATH_DECISION) {
            // 其它 path 留给别的 listener，这里只关心决策回传
            return
        }
        val raw = runCatching { messageEvent.data.toString(Charsets.UTF_8) }
            .getOrElse {
                Timber.w(it, "CcPhoneDecisionListener: utf-8 decode failed")
                return
            }
        val envelope = runCatching { json.decodeFromString<ApprovalDecisionEnvelope>(raw) }
            .getOrElse {
                Timber.w(it, "CcPhoneDecisionListener: malformed payload")
                return
            }
        val decision = runCatching { envelope.resolveDecision() }
            .getOrElse {
                Timber.w(it, "CcPhoneDecisionListener: invalid approval decision")
                return
            }
        Timber.i(
            "CcPhoneDecisionListener: requestId=${envelope.requestId} " +
                "decision=${decision::class.simpleName}",
        )
        // 不阻塞 callback 线程，分发到 IO scope。
        scope.launch { route(envelope, decision) }
    }

    /** 测试 hook：路由逻辑可单独验。 */
    internal suspend fun route(
        envelope: ApprovalDecisionEnvelope,
        decision: ApprovalDecision = envelope.resolveDecision(),
    ) {
        val resourceType = resourceTypeFromId(envelope.requestId)
        when (resourceType) {
            "marketplace" -> emitAutoDecision(envelope, decision, kind = "marketplace.purchase")
            "system" -> emitAutoDecision(envelope, decision, kind = "system.alert")
            else -> Timber.w(
                "CcPhoneDecisionListener.route: unknown requestId prefix → no-op: ${envelope.requestId}",
            )
        }
    }

    private suspend fun emitAutoDecision(
        envelope: ApprovalDecisionEnvelope,
        decision: ApprovalDecision,
        kind: String,
    ) {
        // 构造 placeholder NotificationPayload — AutoPushBus.userDecision 需要
        // payload 引用。Phase 3 起换 ApprovalCoordinator 后可直接传 requestId。
        val placeholder = NotificationPayload.SystemAlertNotice(
            title = "wear-decision",
            body = "${envelope.requestId}|$kind",
        )
        autoPushBus.userDecision(
            AutoApprovalDecision(
                payload = placeholder,
                approved = decision.toLegacyApproved(),
            ),
        )
    }

    companion object {
        /** 与 wear-app sync.ApprovalRequest.PATH_DECISION 严格对齐。 */
        const val PATH_DECISION = "/cc/decision"

        /** 从 wire-format id 推断 resource type — wear-app 用 "mp:" / "sys:" 前缀。 */
        fun resourceTypeFromId(id: String): String = when {
            id.startsWith("mp:") -> "marketplace"
            id.startsWith("sys:") -> "system"
            else -> "unknown"
        }
    }
}
