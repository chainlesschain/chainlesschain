package com.chainlesschain.android.feature.familyguard.data.telemetry

import com.chainlesschain.android.feature.familyguard.domain.telemetry.SnapshotPayload
import com.chainlesschain.android.feature.familyguard.domain.telemetry.SnapshotRecord
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
 * Plan C snapshot 数据源 (FAMILY-22). 把 ContentResolver 直采的通讯录 / 通话 / 短信 /
 * 通知记录打上 child_did 维度 (主文档 §3.2 "Plan C snapshot writer + child_did"), 包成
 * [TelemetryEvent] emit 进 [com.chainlesschain.android.feature.familyguard.data.telemetry.CentralTelemetryDispatcher]。
 *
 * 与 [ForegroundAppTelemetrySource] 同构: 自身不持有采集硬件/IPC, 由外部 (Plan C 直采器)
 * 调 [submitRecords] / [submitRecord] 推入。**采集器在 :app 层** (LocalSystemDataSnapshotter
 * 及其扩展, family-guard 库不能反向依赖 :app); :app 在每次快照后调本 source 的 submit
 * 即把记录接进上行管线 —— 该 :app 侧 wire-up 是 FAMILY-22 的剩余接线点 (同 FAMILY-21
 * ForegroundAppTelemetrySource 先落、FAMILY-20 timer 后接的次序)。
 *
 * level 取 [SnapshotRecord.type] 的 defaultLevel; 真正能否上行由 FamilyPermissionChecker
 * (FAMILY-25 上行权限闸) + QuietHoursEngine (FAMILY-24) 把关。pause 态 (quiet hours /
 * emergency freeze) 丢弃所有 emit。
 */
@Singleton
class SnapshotTelemetrySource @Inject constructor() : TelemetrySource {

    override val sourceType: TelemetrySourceType = TelemetrySourceType.SNAPSHOT_WRITER

    private val _events = MutableSharedFlow<TelemetryEvent>(
        replay = 0,
        extraBufferCapacity = 128,
        onBufferOverflow = BufferOverflow.DROP_OLDEST,
    )

    @Volatile
    private var paused: Boolean = false

    override fun events(): Flow<TelemetryEvent> = _events.asSharedFlow()

    /** 推一条快照记录 (归属 [childDid]); pause 态丢弃。返 emit 数 (0 or 1)。 */
    suspend fun submitRecord(childDid: String, record: SnapshotRecord): Int {
        if (paused) return 0
        _events.emit(toEvent(childDid, record))
        return 1
    }

    /** 批量推 (一次快照多条记录); pause 态全丢。返实际 emit 数。 */
    suspend fun submitRecords(childDid: String, records: List<SnapshotRecord>): Int {
        if (paused) return 0
        var emitted = 0
        for (record in records) {
            _events.emit(toEvent(childDid, record))
            emitted++
        }
        return emitted
    }

    override suspend fun pause() {
        paused = true
    }

    override suspend fun resume() {
        paused = false
    }

    override fun isPaused(): Boolean = paused

    private fun toEvent(childDid: String, record: SnapshotRecord): TelemetryEvent =
        TelemetryEvent(
            childDid = childDid,
            source = TelemetrySourceType.SNAPSHOT_WRITER,
            kind = record.type.storageValue,
            payload = SnapshotPayload.encode(record.fields),
            timestampMs = record.occurredAtMs,
            durationMs = 0L,
            level = record.type.defaultLevel,
        )
}
