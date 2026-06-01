package com.chainlesschain.android.feature.familyguard.domain.telemetry

/**
 * Plan C snapshot writer 采集的一条记录 (FAMILY-22).
 *
 * 由 :app 层 ContentResolver 直采器 (LocalSystemDataSnapshotter 及其扩展) 产出, 经
 * [com.chainlesschain.android.feature.familyguard.data.telemetry.SnapshotTelemetrySource.submitRecords]
 * 打上 child_did 维度 (主文档 §3.2 "Plan C snapshot writer + child_did") 后进 telemetry
 * 上行管线。
 *
 * 用类型无关的 [fields] map 承载各类记录的字段 (通讯录: name/numbers; 通话:
 * number/type/duration_sec; 短信: address/type; 通知: package/title), 与
 * child_event.payload "自由 JSON" 约定一致, 新增字段不破坏 schema。
 *
 * @property occurredAtMs 事件发生时刻 epoch ms (通话/短信/通知时间; 通讯录用采集时刻)
 * @property fields 类型相关字段; 值统一 String (number 等也转字符串, 跨类型统一序列化)
 */
data class SnapshotRecord(
    val type: SnapshotRecordType,
    val occurredAtMs: Long,
    val fields: Map<String, String>,
)
