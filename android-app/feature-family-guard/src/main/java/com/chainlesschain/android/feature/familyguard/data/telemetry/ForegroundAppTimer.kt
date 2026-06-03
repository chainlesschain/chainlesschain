package com.chainlesschain.android.feature.familyguard.data.telemetry

import com.chainlesschain.android.feature.familyguard.domain.telemetry.ChildIdentityProvider
import com.chainlesschain.android.feature.familyguard.domain.telemetry.ForegroundAppQuery
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import timber.log.Timber

/**
 * 前台 app 采样定时器 (FAMILY-20).
 *
 * 每 [POLL_INTERVAL_MS] 轮询一次:
 *   childDidOrNull (角色 + DID 闸) → Usage Access 闸 → 查前台包 →
 *   [ForegroundAppTelemetrySource.submitSample]
 *
 * source 内的 [ForegroundAppAggregator] 把同 app 连续采样合成一段, 30min 强制切段。
 * 没有独立 foreground service —— 本定时器由已常驻的
 * [com.chainlesschain.android.feature.familyguard.service.FamilyGuardForegroundService]
 * 在 onCreate [start] / onDestroy [stop] 托管 (Android 14 specialUse 不宜起第二个 FGS)。
 *
 * 自闸: childDidOrNull 在家长端 / 未选角色时返 null, 故定时器在非孩子端轮询即早返,
 * 不采集。[pollOnce] 提为 public suspend 便于单测直驱单次轮询 (不经
 * while-delay 生产协程, 避开 [[android_runtest_production_scope_hang]])。
 */
@Singleton
class ForegroundAppTimer @Inject constructor(
    private val query: ForegroundAppQuery,
    private val childIdentityProvider: ChildIdentityProvider,
    private val source: ForegroundAppTelemetrySource,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    @Volatile
    private var job: Job? = null

    /** 上次轮询墙钟 (查询窗口下界); 0 = 尚未轮询。 */
    @Volatile
    private var lastPollMs: Long = 0L

    /** 最近已知前台包; 窗口内无新前台事件时沿用 (用户停在同一 app 不切换)。 */
    @Volatile
    private var lastForegroundPackage: String? = null

    @Synchronized
    fun start() {
        if (job?.isActive == true) return // 幂等
        lastPollMs = 0L
        lastForegroundPackage = null
        job = scope.launch {
            while (isActive) {
                runCatching { pollOnce(System.currentTimeMillis()) }
                    .onFailure { Timber.w(it, "foreground app poll failed") }
                delay(POLL_INTERVAL_MS)
            }
        }
    }

    @Synchronized
    fun stop() {
        job?.cancel()
        job = null
        // best-effort flush 在飞段 (进程存活时); 失败 / 进程被杀则段丢, 符合 §3.2 不补传。
        scope.launch {
            runCatching {
                childIdentityProvider.childDidOrNull()?.let { source.flushCurrent(it) }
            }
        }
    }

    /**
     * 单次轮询。childDid 闸 + Usage Access 闸都过后才查前台包并提交。
     * 窗口内无前台事件时沿用 [lastForegroundPackage] 让停留时长继续累计。
     */
    suspend fun pollOnce(nowMs: Long) {
        val childDid = childIdentityProvider.childDidOrNull() ?: return
        if (!query.isAccessGranted()) return
        val since = if (lastPollMs > 0L) lastPollMs else nowMs - POLL_WINDOW_MS
        val pkg = query.currentForegroundPackage(since, nowMs) ?: lastForegroundPackage
        lastPollMs = nowMs
        if (pkg == null) return // 还没观察到任何前台 app
        lastForegroundPackage = pkg
        source.submitSample(childDid, pkg, nowMs)
    }

    companion object {
        /** 轮询间隔; 主文档 §3.2 v0.2 "分钟轮询"。 */
        const val POLL_INTERVAL_MS: Long = 60_000L

        /** 首次轮询回看窗口 (lastPollMs 未设时), 取 2× 间隔覆盖启动抖动。 */
        const val POLL_WINDOW_MS: Long = 2 * POLL_INTERVAL_MS
    }
}
