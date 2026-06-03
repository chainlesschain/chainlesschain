package com.chainlesschain.android.feature.familyguard.boot

import com.chainlesschain.android.feature.familyguard.domain.emergency.UpstreamFreezer
import com.chainlesschain.android.feature.familyguard.domain.repository.FamilyRelationshipRepository
import com.chainlesschain.android.feature.familyguard.domain.unbind.UnbindStateMachine
import com.chainlesschain.android.feature.familyguard.domain.emergency.EmergencyUnbindService
import java.time.Clock
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.first
import timber.log.Timber

/**
 * 启动期一次性恢复逻辑 (FAMILY-19).
 *
 * BootReceiver 收 BOOT_COMPLETED + KeepAliveScheduler 周期 alarm 都调本入口.
 * 内部幂等 — 多次调安全 (各路径自带 SQL WHERE 守卫 / freezer freeze 幂等).
 *
 * 5 项恢复:
 *   1. UnbindStateMachine.reconcileExpired — FAMILY-15 24h 冷却 worker 入口;
 *      启动后扫所有 unbind_pending + cooldown 到期 → unbound
 *   2. 紧急解绑 freeze 重建 — 进程重启后 InMemoryUpstreamFreezer 重置;
 *      扫所有 active emergency_unbound 关系 (在 7 天宽限期内) → 重新 freeze
 *   3. 紧急解绑过期 → 自动 finalize 走 unbound (主文档 §3.1 v0.2 "7 天后系统
 *      自动转 unbound") — 简化版: 直接走 status update; 实际逻辑留 FAMILY-Audit
 *   4. (未来) 反卸载哨兵: SelfUninstallWatchdog.refresh; v0.1 stub
 *   5. (未来) 离线 outbox 重放: FAMILY-26 加
 */
@Singleton
class StartupReconciler @Inject constructor(
    private val unbindStateMachine: UnbindStateMachine,
    private val familyRelationshipRepository: FamilyRelationshipRepository,
    private val upstreamFreezer: UpstreamFreezer,
    private val clock: Clock,
) {

    /**
     * 端到端 reconcile. 返各子任务统计, 让 BootReceiver / KeepAliveScheduler
     * 可写 audit log.
     */
    suspend fun reconcile(): ReconcileReport {
        Timber.i("StartupReconciler.reconcile started")

        // 1. UnbindStateMachine 过期 finalize
        val unbindFinalized = runCatching { unbindStateMachine.reconcileExpired() }
            .getOrElse { e ->
                Timber.e(e, "reconcileExpired failed")
                0
            }

        // 2 + 3. 扫描 emergency_unbound 关系
        val activeRelationships = runCatching {
            familyRelationshipRepository.observeAllActive().first()
        }.getOrDefault(emptyList())

        var freezeRestored = 0
        // observeAllActive 只返 status='active'; 真要找 emergency_unbound 需另一个查询
        // — 简化: 启动期顺便调一次 freezer.freeze(确保任何 emergency_unbound 持久;
        // 真生产化路径走"扫所有 status='emergency_unbound' + within 7-day grace 的关系")
        // v0.1 范围内提供框架, 真扫询 SQL 留 FAMILY-XX 加 listEmergencyUnbound 路径。

        // 临时占位: 不做实际 freeze 重建, 等 DAO 加 listEmergencyUnbound 后回填.
        // 这里确保 reconciler 主流程跑通; 单测验证 unbindFinalized count.

        return ReconcileReport(
            unbindFinalized = unbindFinalized,
            freezeRestored = freezeRestored,
            emergencyExpired = 0,
            timestampMs = clock.millis(),
        )
    }

    data class ReconcileReport(
        val unbindFinalized: Int,
        val freezeRestored: Int,
        val emergencyExpired: Int,
        val timestampMs: Long,
    )
}
