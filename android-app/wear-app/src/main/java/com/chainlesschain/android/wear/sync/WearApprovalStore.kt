package com.chainlesschain.android.wear.sync

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import timber.log.Timber

/**
 * v1.2 #20 P0.2 Wear Phase 1 — 内存中的 pending approval 列表 + 决策回放。
 *
 * Phase 0 仅静态占位；Phase 1 [CcWearListenerService] 收到 /cc/push 后 upsert 到本
 * store；WearMainActivity 订阅 [requests] StateFlow 实时刷 UI。
 *
 * 内存暂存 — wear 重启后丢；这是有意的（重要 approval 手机端会重发；watch 不该
 * 独立持久化高价值 payload，防丢失 / 防越权）。
 *
 * Singleton 不用 Hilt — wear-app Phase 0 决定不引 DI 框架；改 object companion。
 */
object WearApprovalStore {
    private val _requests = MutableStateFlow<List<ApprovalRequest>>(emptyList())
    val requests: StateFlow<List<ApprovalRequest>> = _requests.asStateFlow()

    /** Upsert by request.id；同 id 替换内容（手机重发场景）。 */
    fun upsert(request: ApprovalRequest) {
        val current = _requests.value
        val next = if (current.any { it.id == request.id }) {
            current.map { if (it.id == request.id) request else it }
        } else {
            current + request
        }
        _requests.value = next
        Timber.i("WearApprovalStore.upsert: ${request.id} (kind=${request.kind})")
    }

    /** 用户决定后移除（无论 approved 与否）。 */
    fun remove(requestId: String) {
        _requests.value = _requests.value.filter { it.id != requestId }
        Timber.d("WearApprovalStore.remove: $requestId")
    }

    /** 全清 — testing / sign-out。 */
    fun clear() {
        _requests.value = emptyList()
    }

    /** 当前数量，便于 Tile / Complication 查询。 */
    fun pendingCount(): Int = _requests.value.size
}
