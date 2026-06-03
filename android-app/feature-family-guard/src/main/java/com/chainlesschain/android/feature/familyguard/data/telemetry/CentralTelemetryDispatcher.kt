package com.chainlesschain.android.feature.familyguard.data.telemetry

import com.chainlesschain.android.feature.familyguard.domain.emergency.UpstreamFreezer
import com.chainlesschain.android.feature.familyguard.domain.repository.ChildEventRepository
import com.chainlesschain.android.feature.familyguard.domain.telemetry.TelemetryEvent
import com.chainlesschain.android.feature.familyguard.domain.telemetry.TelemetryOutbox
import com.chainlesschain.android.feature.familyguard.domain.telemetry.TelemetrySource
import com.chainlesschain.android.feature.familyguard.domain.telemetry.TelemetryUploadGate
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import timber.log.Timber

/**
 * 中央 telemetry 调度器 (FAMILY-21 wiring).
 *
 * 订阅所有 [TelemetrySource] 的 [TelemetrySource.events] 流, 把每个事件走标准上行
 * 管线 ([process]):
 *
 *   source.events → [freeze 检查] → [TelemetryUploadGate 权限闸] →
 *   [ChildEventRepository.saveTelemetryEvent 落库] → [TelemetryOutbox 排上行]
 *
 * 同时观察 [UpstreamFreezer.isFrozen] (FAMILY-16 紧急解绑): freeze 时 pause 所有
 * source (真停采集, 非仅丢 emit), unfreeze 时 resume。
 *
 * [start] / [stop] 幂等; 由 :app AppInitializer (留 FAMILY-XX) 在进程启动时调
 * [start]。[process] 提为 public suspend, 便于单测直接驱动单事件而不经收集协程
 * (避免 hot-flow 时序 flaky, 见 [[android_runtest_sharedflow_unconfined_dispatcher]])。
 *
 * source 实例由 Hilt `@IntoSet` multibinding 注入 (见 FamilyGuardBindingsModule);
 * 新增 PDH / snapshot / accessibility source 时各加一条 `@Binds @IntoSet` 即自动
 * 纳入本调度器, 无需改本类。
 */
@Singleton
class CentralTelemetryDispatcher @Inject constructor(
    private val sources: Set<@JvmSuppressWildcards TelemetrySource>,
    private val uploadGate: TelemetryUploadGate,
    private val childEventRepository: ChildEventRepository,
    private val outbox: TelemetryOutbox,
    private val upstreamFreezer: UpstreamFreezer,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val jobs = mutableListOf<Job>()

    @Synchronized
    fun start() {
        if (jobs.isNotEmpty()) return // 幂等: 已启动

        // freeze 闸 → 暂停 / 恢复所有 source。StateFlow 启动即发当前值。
        jobs += scope.launch {
            upstreamFreezer.isFrozen.collect { frozen ->
                sources.forEach { src ->
                    runCatching { if (frozen) src.pause() else src.resume() }
                        .onFailure { Timber.w(it, "telemetry source %s pause/resume failed", src.sourceType) }
                }
            }
        }

        // 每个 source 一条收集协程; 单事件异常不应炸掉整条流。
        sources.forEach { src ->
            jobs += scope.launch {
                src.events().collect { event ->
                    runCatching { process(event) }
                        .onFailure { Timber.w(it, "telemetry event dropped on error (source=%s)", event.source) }
                }
            }
        }
        Timber.i("CentralTelemetryDispatcher started; %d source(s)", sources.size)
    }

    @Synchronized
    fun stop() {
        jobs.forEach { it.cancel() }
        jobs.clear()
    }

    /**
     * 单事件上行管线。提为 public 便于单测; 收集协程与 [start] 都经此。
     *
     * freeze 时直接丢 (二重保险, source 通常已 pause); 无授权 guardian 时不落库不
     * 上行; insert 命中去重 (rowId ≤ 0) 时不重复排上行。
     */
    suspend fun process(event: TelemetryEvent) {
        if (upstreamFreezer.isFrozen.value) return
        val guardians = uploadGate.permittedGuardians(event)
        if (guardians.isEmpty()) return
        val rowId = childEventRepository.saveTelemetryEvent(event)
        if (rowId <= 0L) return // OnConflictStrategy.IGNORE 命中 → 已存在, 不重复上行
        outbox.enqueue(event, rowId, guardians)
    }
}
