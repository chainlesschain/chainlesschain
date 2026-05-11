package com.chainlesschain.android.remote.p2p

import javax.inject.Inject
import javax.inject.Singleton

/**
 * 多命名空间组合 [CommandRouter]。P2PClient 注入本实现，按 method 前缀分发：
 *  - `sync.*` → [SyncCommandRouter]（Phase 3d M3 step D.5）
 *  - `approval.*` → [ApprovalCommandRouter]（M4 D2）
 *  - `task.*` → [TaskProgressCommandRouter]（M4 ProgressViewer）
 *
 * 未识别命名空间抛 [IllegalArgumentException] → [P2PClient] 转
 * `ErrorCodes.METHOD_NOT_FOUND` 错误响应。
 *
 * 加新命名空间：注入新 router + when 分支即可，[RemoteModule] 的 binding 不动。
 */
@Singleton
class CompositeCommandRouter @Inject constructor(
    private val syncRouter: SyncCommandRouter,
    private val approvalRouter: ApprovalCommandRouter,
    private val taskRouter: TaskProgressCommandRouter,
) : CommandRouter {

    override suspend fun route(method: String, params: Map<String, Any>): Any? {
        return when {
            method.startsWith("sync.") -> syncRouter.route(method, params)
            method.startsWith("approval.") -> approvalRouter.route(method, params)
            method.startsWith("task.") -> taskRouter.route(method, params)
            else -> throw IllegalArgumentException("Method namespace not handled: $method")
        }
    }
}
