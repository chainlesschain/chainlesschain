package com.chainlesschain.android.feature.familyguard.data.telemetry

import com.chainlesschain.android.feature.familyguard.domain.model.permissions.TelemetryLevel
import com.chainlesschain.android.feature.familyguard.domain.telemetry.ForegroundAppPayload
import com.chainlesschain.android.feature.familyguard.domain.telemetry.ForegroundAppRun
import com.chainlesschain.android.feature.familyguard.domain.telemetry.ForegroundAppSample
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
 * 调 [submitSample] → 内部 aggregator 决定是否切段 → 若切段则 emit TelemetryEvent。
 *
 * 单 source 实例可被多孩子共享 (家庭组多 child 切换时不需重启 source): aggregator
 * 只按 package 切段, 不绑 child_did, 故本类追踪 [currentChildDid] — 一旦 [submitSample]
 * 传入的 child 与在飞 run 所属 child 不同, 先 finalize 旧 run (归属旧 child) 再起新段,
 * 否则旧孩子的使用时长会被记到新孩子名下。
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

    /** 当前在飞 run 所属 child; null = 无在飞 run。切 child 时用它归属旧段。 */
    private var currentChildDid: String? = null

    override fun events(): Flow<TelemetryEvent> = _events.asSharedFlow()

    /**
     * 调用方传入 sample (package + timestamp) + 当前 child_did. 内部跑 aggregator,
     * 若 finalized 一段则包 [TelemetryEvent] emit。pause 态丢弃所有 emit。
     *
     * child 切换 (与在飞 run 所属 child 不同) 时, 先 finalize 旧 run 归属旧 child,
     * 再用新 sample 起新段, 避免跨孩子归属串号。
     */
    suspend fun submitSample(
        childDid: String,
        packageName: String,
        timestampMs: Long,
    ) {
        if (paused) return
        val previous = currentChildDid
        if (previous != null && previous != childDid) {
            aggregator.flush()?.let { _events.emit(toEvent(previous, it)) }
        }
        currentChildDid = childDid
        val finalized = aggregator.offer(ForegroundAppSample(packageName, timestampMs)) ?: return
        _events.emit(toEvent(childDid, finalized))
    }

    /** Service 关闭 / 切 child 时强 flush; 返 emit 数 (0 or 1). */
    suspend fun flushCurrent(childDid: String): Int {
        if (paused) return 0
        val finalized = aggregator.flush() ?: return 0
        _events.emit(toEvent(childDid, finalized))
        currentChildDid = null
        return 1
    }

    override suspend fun pause() {
        paused = true
        // pause 后丢现有 partial run (主文档 §3.2 v0.2 quiet hours / freeze 不补传)
        aggregator.flush()
        currentChildDid = null
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
            payload = ForegroundAppPayload.encode(run.packageName, run.durationMs),
            timestampMs = run.startMs,
            durationMs = run.durationMs,
            level = TelemetryLevel.L1,
        )

    companion object {
        const val KIND_RUN = "run"
    }
}
