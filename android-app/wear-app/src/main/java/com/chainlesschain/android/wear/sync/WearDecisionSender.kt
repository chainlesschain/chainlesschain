package com.chainlesschain.android.wear.sync

import android.content.Context
import com.google.android.gms.wearable.Wearable
import kotlinx.coroutines.tasks.await
import kotlinx.serialization.json.Json
import timber.log.Timber

/**
 * v1.2 #20 P0.2 Wear Phase 2 — watch → phone 决策回传。
 *
 * 用户在 [com.chainlesschain.android.wear.WearApprovalActivity] 点同意/拒绝
 * 后调本类 send(decision)。序列化 [ApprovalDecision] 走 message path
 * [ApprovalRequest.PATH_DECISION]，发到所有 connected phone node。phone 端的
 * `CcPhoneDecisionListener`（在 :app 模块）反序列化并喂回 AutoPushBus /
 * multisig signer / etc。
 *
 * 即使 sendMessage 失败也清掉本地 store — Phase 2 一次操作就清；Phase 3+
 * 加重试 / 离线队列再说。失败原因 log 出来供 debug。
 */
class WearDecisionSender(private val context: Context) {

    private val json = Json { encodeDefaults = false }

    suspend fun send(decision: ApprovalDecision): Boolean {
        val bytes = json.encodeToString(ApprovalDecision.serializer(), decision)
            .toByteArray(Charsets.UTF_8)
        val nodes = runCatching {
            Wearable.getNodeClient(context).connectedNodes.await()
        }.getOrElse {
            Timber.w(it, "WearDecisionSender: connectedNodes 查询失败 — decision 丢失")
            return false
        }
        if (nodes.isEmpty()) {
            Timber.w("WearDecisionSender: 无 connected phone node — decision 丢失")
            return false
        }
        val client = Wearable.getMessageClient(context)
        var ok = false
        for (node in nodes) {
            val result = runCatching {
                client.sendMessage(node.id, ApprovalRequest.PATH_DECISION, bytes).await()
            }
            result.onSuccess {
                ok = true
                Timber.i("WearDecisionSender → ${node.id} OK")
            }
            result.onFailure {
                Timber.w(it, "WearDecisionSender → ${node.id} FAIL")
            }
        }
        return ok
    }
}
