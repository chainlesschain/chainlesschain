package com.chainlesschain.android.feature.familyguard.data.telemetry

import com.chainlesschain.android.feature.familyguard.domain.model.permissions.TelemetryLevel
import com.chainlesschain.android.feature.familyguard.domain.telemetry.ForegroundAppRun
import com.chainlesschain.android.feature.familyguard.domain.telemetry.TelemetryEvent
import com.chainlesschain.android.feature.familyguard.domain.telemetry.TelemetrySource
import com.chainlesschain.android.feature.familyguard.domain.telemetry.TelemetrySourceType
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.asSharedFlow

/**
 * [TelemetrySource] 参考实装 (FAMILY-21). Wrap 现有 [ForegroundAppAggregator] +
 * 把 finalized [ForegroundAppRun] 包成 [TelemetryEvent] emit 给订阅方。
 *
 * ForegroundAppTimer Android Service (留 FAMILY-XX) 每分钟 poll UsageStats →
 * 调 [emit] → 内部 aggregator 决定是否切段 → 若切段则 emit TelemetryEvent。
 *
 * 当前 child_did 由调用方在 emit 时传入; 单 source 不绑死 child_did 让多孩子
 * 场景共享同一 source 实例 (家庭组多 child 切换时不需重启 source)。
 */
@Singleton
class ForegroundAppTelemetrySource @Inject constructor(
    private val aggregator: ForegroundAppAggregator = ForegroundAppAggregator(),
) : TelemetrySource {

    override val sourceType: TelemetrySourceType = TelemetrySourceType.FOREGROUND_APP

    private val _events = MutableSharedFlow<TelemetryEvent>(
        replay = 0,
        extraBufferCapacity = 64,
        onBufferOverflow = BufferOverflow.DROP_OLDEST,
    )

    @Volatile
    private var paused: Boolean = false

    override fun events(): Flow<TelemetryEvent> = _events.asSharedFlow()

    /**
     * 调用方传入 sample (package + timestamp) + 当前 child_did. 内部跑 aggregator,
     * 若 finalized 一段则包 [TelemetryEvent] emit。pause 态丢弃所有 emit。
     */
    suspend fun submitSample(
        childDid: String,
        packageName: String,
        timestampMs: Long,
    ) {
        if (paused) return
        val sample = com.chainlesschain.android.feature.familyguard.domain.telemetry
            .ForegroundAppSample(packageName, timestampMs)
        val finalized = aggregator.offer(sample) ?: return
        _events.emit(toEvent(childDid, finalized))
    }

    /** Service 关闭 / 切 child 时强 flush; 返 emit 数 (0 or 1). */
    suspend fun flushCurrent(childDid: String): Int {
        if (paused) return 0
        val finalized = aggregator.flush() ?: return 0
        _events.emit(toEvent(childDid, finalized))
        return 1
    }

    override suspend fun pause() {
        paused = true
        // pause 后丢现有 partial run (主文档 §3.2 v0.2 quiet hours / freeze 不补传)
        aggregator.flush()
    }

    override suspend fun resume() {
        paused = false
    }

    override fun isPaused(): Boolean = paused

    private fun toEvent(childDid: String, run: ForegroundAppRun): TelemetryEvent =
        TelemetryEvent(
            childDid = childDid,
            source = TelemetrySourceType.FOREGROUND_APP,
            kind = KIND_RUN,
            payload = """{"package":"${escape(run.packageName)}","duration_ms":${run.durationMs}}""",
            timestampMs = run.startMs,
            durationMs = run.durationMs,
            level = TelemetryLevel.L1,
        )

    private fun escape(s: String): String =
        s.replace("\\", "\\\\").replace("\"", "\\\"")

    companion object {
        const val KIND_RUN = "run"
    }
}
