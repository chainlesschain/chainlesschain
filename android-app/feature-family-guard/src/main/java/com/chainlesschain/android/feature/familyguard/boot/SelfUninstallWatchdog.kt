package com.chainlesschain.android.feature.familyguard.boot

import javax.inject.Inject
import javax.inject.Singleton
import timber.log.Timber

/**
 * 自卸载哨兵 (FAMILY-19 stub).
 *
 * 主文档 §3.1 v0.2 反卸载机制: "DPC uninstall_blocked 标志 + root 强卸 →
 * 设备指纹掉线超 6h, 家长端通知 + 自动开'紧急寻找'模式". 真实接入分 4 路:
 *   1. DPC setUninstallBlocked (FAMILY-Enforce 档 2)
 *   2. PackageManager 监听 ACTION_PACKAGE_REMOVING — 但本进程已被 kill,
 *      故守护进程不能在 app 进程内, 需独立 Magisk module 守护
 *   3. Magisk init.d daemon — 监测 PackageManager 看本包是否在; 不在则
 *      从 /data/local/tmp/recovery.apk 静默重装 (root 需 + Magisk)
 *   4. 家长端心跳超 6h 触发"紧急寻找" (FAMILY-XX P2P signaling)
 *
 * v0.1 范围: 仅暴露接口 + log; 真接通 DPC 路径走 FAMILY-Enforce 档 2,
 * Magisk daemon 路径走 FAMILY-XX (独立 ticket, 需 NDK + Magisk SDK)。
 *
 * 见 [[android_wechat_collector_phase_12_10]] 自启拉活 + 反卸载模式参考 +
 * spike 3 §5.1 多重保活栈 layer 5.
 */
@Singleton
class SelfUninstallWatchdog @Inject constructor() {

    /**
     * Stub: v0.1 仅 log; FAMILY-Enforce 档 2 + FAMILY-XX 接 DPC + Magisk daemon
     * 后填实. 调用方 (BootReceiver 等) 仍可调本入口让流程链 future-proof.
     */
    fun ensureMonitoring() {
        Timber.i(
            "SelfUninstallWatchdog.ensureMonitoring STUB — DPC + Magisk daemon land in FAMILY-Enforce + future ticket",
        )
    }

    /**
     * 远程触发的"紧急寻找"模式 (主文档 §3.1 v0.2 反逃避策略). 家长端心跳超 6h
     * 后调 (FAMILY-XX P2P signaling); v0.1 仅 log.
     */
    fun enterEmergencyTracking(reason: String) {
        Timber.w("SelfUninstallWatchdog.enterEmergencyTracking STUB reason=$reason")
    }
}
