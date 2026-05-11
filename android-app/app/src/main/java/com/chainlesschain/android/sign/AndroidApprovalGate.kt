package com.chainlesschain.android.sign

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import timber.log.Timber
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

/**
 * UI-driven [ApprovalGate] 真实现：把 [SignAsService] 等 backend 协程发起的
 * approval 请求桥接到 Compose UI，由 [ApprovalDialogHost] 弹出 [ApprovalDialog]
 * 给用户确认。
 *
 * 设计:
 *  - backend call `requestApproval(...)` → suspend，等用户决策
 *  - UI 观察 [pendingRequest] StateFlow，非 null 则渲染对话框
 *  - 用户点同意/拒绝/超时 → UI 调 [respondToApproval] / [cancelApproval] → 释放 backend
 *
 * Mutex 串行化并发请求（虽然 v1.0 SignAsService 单流程基本不会并发）；同一时刻
 * 最多一个 pending request，保证 UI 不会同时弹多个 dialog 互相覆盖。
 *
 * 真机 verify (M5 wire-up): 桌面调 sign.request → mobile-bridge 路由到 SignAsService
 * → 本 gate → ApprovalDialog 弹出 → 用户确认 → BiometricPrompt → StrongBox 签名 →
 * 返回桌面。
 */
@Singleton
class AndroidApprovalGate @Inject constructor() : ApprovalGate {

    private val _pendingRequest = MutableStateFlow<PendingRequest?>(null)
    val pendingRequest: StateFlow<PendingRequest?> = _pendingRequest.asStateFlow()

    private val serialMutex = Mutex()

    override suspend fun requestApproval(
        payloadDescription: String,
        payloadHash: String,
        requireBiometric: Boolean,
    ): ApprovalResult = requestApproval(
        category = ApprovalCategory.Sign,
        payloadDescription = payloadDescription,
        payloadHash = payloadHash,
        requireBiometric = requireBiometric,
    )

    override suspend fun requestApproval(
        category: ApprovalCategory,
        payloadDescription: String,
        payloadHash: String,
        requireBiometric: Boolean,
    ): ApprovalResult = serialMutex.withLock {
        val requestId = "apr-${UUID.randomUUID()}"
        val deferred = CompletableDeferred<ApprovalResult>()
        val req = PendingRequest(
            requestId = requestId,
            category = category,
            payloadDescription = payloadDescription,
            payloadHash = payloadHash,
            requireBiometric = requireBiometric,
            deferred = deferred,
        )
        Timber.i("ApprovalGate request: id=%s category=%s description=%s requireBiometric=%s",
            requestId, category, payloadDescription, requireBiometric)
        _pendingRequest.value = req
        try {
            val result = deferred.await()
            Timber.i("ApprovalGate %s resolved: approved=%s reason=%s",
                requestId, result.approved, result.deniedReason)
            result
        } finally {
            // 清理 pending（即便 deferred 由其它路径被 cancel）
            _pendingRequest.compareAndSet(req, null)
        }
    }

    /**
     * 用户在 UI 上做出决策（同意 / 拒绝 / biometric 失败）后由 [ApprovalDialogHost] 调。
     *
     * @return false 表示 [requestId] 不匹配当前 pending（已超时 / 已被其它路径 resolve）
     */
    fun respondToApproval(
        requestId: String,
        approved: Boolean,
        deniedReason: String? = null,
    ): Boolean {
        val current = _pendingRequest.value
        if (current == null || current.requestId != requestId) {
            Timber.w("ApprovalGate respond ignored: stale requestId=%s (current=%s)",
                requestId, current?.requestId)
            return false
        }
        val result = ApprovalResult(
            approved = approved,
            deniedReason = if (approved) null else (deniedReason ?: "user-declined"),
        )
        current.deferred.complete(result)
        return true
    }

    /** UI dialog 被 dismiss（手势 / 屏幕旋转）时把 pending 标记为用户取消。 */
    fun cancelPending(reason: String = "dismissed"): Boolean {
        val current = _pendingRequest.value ?: return false
        return respondToApproval(current.requestId, approved = false, deniedReason = reason)
    }

    data class PendingRequest(
        val requestId: String,
        val category: ApprovalCategory,
        val payloadDescription: String,
        val payloadHash: String,
        val requireBiometric: Boolean,
        internal val deferred: CompletableDeferred<ApprovalResult>,
    )
}
