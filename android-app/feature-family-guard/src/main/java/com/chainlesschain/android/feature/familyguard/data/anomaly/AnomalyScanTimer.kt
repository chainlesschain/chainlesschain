package com.chainlesschain.android.feature.familyguard.data.anomaly

import com.chainlesschain.android.feature.familyguard.data.dao.ChildEventDao
import com.chainlesschain.android.feature.familyguard.domain.anomaly.AnomalyConfig
import com.chainlesschain.android.feature.familyguard.domain.anomaly.AnomalyDetector
import com.chainlesschain.android.feature.familyguard.domain.anomaly.GuardianAnomalyNotifier
import com.chainlesschain.android.feature.familyguard.domain.repository.AnomalyRepository
import com.chainlesschain.android.feature.familyguard.domain.telemetry.ChildIdentityProvider
import com.chainlesschain.android.feature.familyguard.domain.telemetry.ForegroundAppPayload
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
 * 异常扫描定时器 (FAMILY-27). 主文档 §3.2 "AnomalyDetector 每 15min 跑"。
 *
 * 每 [SCAN_INTERVAL_MS] 一次 [scanOnce]:
 *   childDidOrNull (角色 + DID 闸) → 查 24h 窗口事件 + 30d 前历史包名 →
 *   [AnomalyDetector.detect] → 逐条 [AnomalyRepository.record] (去重) →
 *   **仅新落库** (rowId > 0) 的调 [GuardianAnomalyNotifier.notifyGuardians] 一次。
 *
 * 无独立 foreground service —— 由常驻的
 * [com.chainlesschain.android.feature.familyguard.service.FamilyGuardForegroundService]
 * 在 onCreate [start] / onDestroy [stop] 托管 (同 ForegroundAppTimer 模式)。
 *
 * 自闸: childDidOrNull 在家长端 / 未选角色返 null → 扫描早返不工作。[scanOnce] 提为
 * public suspend 便于单测直驱单次扫描 (不经 while-delay 生产协程, 避开
 * [[android_runtest_production_scope_hang]])。
 */
@Singleton
class AnomalyScanTimer @Inject constructor(
    private val childIdentityProvider: ChildIdentityProvider,
    private val childEventDao: ChildEventDao,
    private val detector: AnomalyDetector,
    private val repository: AnomalyRepository,
    private val notifier: GuardianAnomalyNotifier,
    private val config: AnomalyConfig,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    @Volatile
    private var job: Job? = null

    @Synchronized
    fun start() {
        if (job?.isActive == true) return // 幂等
        job = scope.launch {
            while (isActive) {
                runCatching { scanOnce(System.currentTimeMillis()) }
                    .onFailure { Timber.w(it, "anomaly scan failed") }
                delay(SCAN_INTERVAL_MS)
            }
        }
    }

    @Synchronized
    fun stop() {
        job?.cancel()
        job = null
    }

    /**
     * 单次扫描。非孩子端早返。窗口 = [nowMs - SCAN_WINDOW_MS, nowMs] (覆盖单日聚合规则);
     * priorPackages = [nowMs - PRIOR_LOOKBACK_MS, windowStart) 内的前台包名 (首见规则用)。
     */
    suspend fun scanOnce(nowMs: Long) {
        val childDid = childIdentityProvider.childDidOrNull() ?: return
        val windowStart = nowMs - SCAN_WINDOW_MS
        val priorStart = nowMs - PRIOR_LOOKBACK_MS

        val windowEvents = childEventDao.querySince(childDid, windowStart)
        val priorPackages = childEventDao
            .querySourceRange(childDid, SOURCE_FOREGROUND_APP, priorStart, windowStart)
            .mapNotNull { ForegroundAppPayload.decodePackageOrNull(it.payload) }
            .toSet()

        val anomalies = detector.detect(childDid, windowEvents, priorPackages, nowMs, config)
        for (anomaly in anomalies) {
            val rowId = repository.record(anomaly)
            if (rowId > 0L) notifier.notifyGuardians(anomaly) // 去重命中 (≤0) 不重复推送
        }
    }

    companion object {
        /** 扫描间隔; 主文档 §3.2 "每 15min 跑"。 */
        const val SCAN_INTERVAL_MS: Long = 15 * 60_000L

        /** 扫描回看窗口 (24h, 覆盖单日游戏 / 充值聚合规则)。 */
        const val SCAN_WINDOW_MS: Long = 24 * 60 * 60_000L

        /** 首见规则历史回看 (30 天, 主文档 "30 天内首次进入未知 app")。 */
        const val PRIOR_LOOKBACK_MS: Long = 30L * 24 * 60 * 60_000L

        private const val SOURCE_FOREGROUND_APP = "foreground_app"
    }
}
