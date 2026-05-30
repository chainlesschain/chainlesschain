package com.chainlesschain.android.feature.familyguard.boot

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.chainlesschain.android.feature.familyguard.domain.model.FamilyGuardState
import com.chainlesschain.android.feature.familyguard.domain.repository.FamilyGuardServiceController
import dagger.hilt.android.AndroidEntryPoint
import javax.inject.Inject
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import timber.log.Timber

/**
 * 开机自启 + 反卸载哨兵 BroadcastReceiver (FAMILY-19).
 *
 * 注册 BOOT_COMPLETED (manifest) + QUICKBOOT_POWERON (HTC 类设备兼容) + LOCKED_BOOT_COMPLETED
 * (Android 7+ direct boot). 收到任一即:
 *   1. 拉起 FamilyGuardForegroundService 到 IDLE 状态 (FAMILY-05) — 用户可见
 *   2. 跑 StartupReconciler.reconcile() 处理:
 *      · UnbindStateMachine.reconcileExpired (FAMILY-15 24h 冷却 worker)
 *      · 紧急解绑 freeze 重建 (FAMILY-16; InMemoryUpstreamFreezer 进程重启 lose state)
 *   3. KeepAliveScheduler.schedule() — 周期 30min 兜底
 *
 * 验收 (ticket FAMILY-19): "开机自启 < 60s" — onReceive 立刻 startForegroundService
 * + 异步 reconcile, 完成 < 5s 在 fixture; 真机 OS 启动 + 系统授权流程主要受
 * setup wizard 延迟影响, BootReceiver 自身贡献 < 5s.
 */
@AndroidEntryPoint
class BootReceiver : BroadcastReceiver() {

    @Inject lateinit var serviceController: FamilyGuardServiceController
    @Inject lateinit var startupReconciler: StartupReconciler
    @Inject lateinit var keepAliveScheduler: KeepAliveScheduler

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action
        Timber.i("BootReceiver received action=$action")
        if (!ACCEPTED_ACTIONS.contains(action)) {
            Timber.w("BootReceiver ignoring unknown action: $action")
            return
        }

        // 1. 立刻拉起前台服务到 IDLE; setState 异步, 不阻塞 onReceive 10s 上限
        serviceController.setState(FamilyGuardState.IDLE)

        // 2. KeepAlive 周期 alarm
        keepAliveScheduler.schedule()

        // 3. Reconciler 走 IO 协程; goAsync 让广播保持 alive 直到完成
        val pendingResult = goAsync()
        scope.launch {
            try {
                val report = startupReconciler.reconcile()
                Timber.i("StartupReconciler completed: $report")
            } catch (e: Exception) {
                Timber.e(e, "StartupReconciler failed")
            } finally {
                pendingResult.finish()
            }
        }
    }

    companion object {
        const val ACTION_QUICKBOOT_POWERON = "android.intent.action.QUICKBOOT_POWERON"
        const val ACTION_HTC_QUICKBOOT_POWERON = "com.htc.intent.action.QUICKBOOT_POWERON"

        val ACCEPTED_ACTIONS: Set<String> = setOf(
            Intent.ACTION_BOOT_COMPLETED,
            Intent.ACTION_LOCKED_BOOT_COMPLETED, // Android 7+ direct boot
            ACTION_QUICKBOOT_POWERON,
            ACTION_HTC_QUICKBOOT_POWERON,
        )
    }
}

/**
 * KeepAliveScheduler 周期 alarm 触发的 receiver. 与 BootReceiver 区别仅在 action;
 * 共享同一 reconciler + serviceController, 保活路径单一入口好维护。
 */
@AndroidEntryPoint
class KeepAliveReceiver : BroadcastReceiver() {

    @Inject lateinit var serviceController: FamilyGuardServiceController
    @Inject lateinit var startupReconciler: StartupReconciler

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != KeepAliveScheduler.ACTION_KEEP_ALIVE) return
        Timber.i("KeepAliveReceiver fired")

        // 拉起服务 — 已运行则 setState 切 IDLE 是 no-op; 被杀则重新 startForeground
        serviceController.setState(FamilyGuardState.IDLE)

        val pendingResult = goAsync()
        scope.launch {
            try {
                val report = startupReconciler.reconcile()
                Timber.i("KeepAlive reconciler: $report")
            } catch (e: Exception) {
                Timber.e(e, "KeepAlive reconciler failed")
            } finally {
                pendingResult.finish()
            }
        }
    }
}
