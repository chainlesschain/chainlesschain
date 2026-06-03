package com.chainlesschain.android.feature.familyguard.data.telemetry

import com.chainlesschain.android.feature.familyguard.domain.telemetry.ForegroundAppRun
import com.chainlesschain.android.feature.familyguard.domain.telemetry.ForegroundAppSample

/**
 * 前台 app 聚合器 (FAMILY-20).
 *
 * 主文档 §3.2 v0.2 设计决策: "同 app 连续使用 30min 合一行, 磁盘量缩 30x"。
 *
 * Pure state machine:
 *   - 持有 currentRun = (packageName, startMs, lastSampleMs)
 *   - [offer] 一个 sample:
 *     · 若 sample.package == currentRun.packageName 且 (sample.ts - currentRun.startMs)
 *       < [MAX_RUN_MS] → 延伸 currentRun.lastSampleMs, 返 null
 *     · 否则 → 强制 flush 当前 run (返 finalized ForegroundAppRun) + 启新 run
 *   - [flush] 显式强制 finalize 当前 run (供进程退出 / 服务 destroy 调)
 *
 * 不接 IO; 全 pure; 单测可 100% 覆盖 state transition。
 *
 * 边界:
 *   - 单 sample 后立即 flush: 返 ForegroundAppRun(start=ts, end=ts), duration=0
 *   - 同 package 连续 31min: 30min 时强制 flush, 后续 sample 启新 run
 *   - 不同 package: 立即 flush + 启新
 *   - 时序乱序 (sample.ts < currentRun.startMs): 视为 reset, 强制 flush 然后启新 run
 */
class ForegroundAppAggregator(
    private val maxRunMs: Long = MAX_RUN_MS,
) {
    private var currentRun: PartialRun? = null

    /**
     * @return finalized [ForegroundAppRun] 若 sample 触发段切换; 否则 null (延伸态)。
     */
    fun offer(sample: ForegroundAppSample): ForegroundAppRun? {
        val current = currentRun
        if (current == null) {
            currentRun = PartialRun(
                packageName = sample.packageName,
                startMs = sample.timestampMs,
                lastSampleMs = sample.timestampMs,
            )
            return null
        }

        val samePackage = sample.packageName == current.packageName
        val runDuration = sample.timestampMs - current.startMs
        val withinMaxRun = runDuration in 0 until maxRunMs

        if (samePackage && withinMaxRun) {
            // 延伸当前 run
            currentRun = current.copy(lastSampleMs = sample.timestampMs)
            return null
        }

        // 切换或强制截断: 走 flush + 启新
        val finalized = current.toRun()
        currentRun = PartialRun(
            packageName = sample.packageName,
            startMs = sample.timestampMs,
            lastSampleMs = sample.timestampMs,
        )
        return finalized
    }

    /**
     * 显式 finalize 当前 run; 之后 currentRun 清空。常在:
     *   - Service.onDestroy / onTaskRemoved 调用 (防丢)
     *   - 切 child_did (孩子端切账号场景) 调用
     */
    fun flush(): ForegroundAppRun? {
        val finalized = currentRun?.toRun()
        currentRun = null
        return finalized
    }

    /** Test / 监控用: 当前是否有进行中的 run. */
    fun isRunning(): Boolean = currentRun != null

    private data class PartialRun(
        val packageName: String,
        val startMs: Long,
        val lastSampleMs: Long,
    ) {
        fun toRun(): ForegroundAppRun = ForegroundAppRun(
            packageName = packageName,
            startMs = startMs,
            endMs = lastSampleMs,
        )
    }

    companion object {
        /** 主文档 §3.2 v0.2 硬编码: 30 min 强制 flush. */
        const val MAX_RUN_MS: Long = 30L * 60L * 1000L
    }
}
