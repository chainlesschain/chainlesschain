package com.chainlesschain.android.feature.familyguard.domain.model.permissions

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

/**
 * Family-friend 关系权限 (FAMILY-12). 主文档 §3.1 v0.2 permissions JSON
 * 字段集合的类型化封装 — 21 字段, 覆盖 telemetry / 通话 / 规则 / 任务 /
 * 支付 / 位置 / SOS / 奖励 / 陪伴 9 大类。
 *
 * 序列化用 [encode] / [decode]; family_relationship.permissions TEXT 列存
 * encode 输出, 即 [Json] 标准 JSON。SerialName 注解保证字段名跨版本兼容
 * (Kotlin 字段名改了不破坏 on-disk 兼容性)。
 *
 * 不强求 cross-field 校验在这里做 (e.g. quiet_hours 累计 ≤ 上限);
 * 那是 Repository 业务层职责 [validate]。
 */
@Serializable
data class FamilyPermissions(

    // ─── Telemetry (主文档 §3.2) ───

    @SerialName("telemetry_level")
    val telemetryLevel: TelemetryLevel = TelemetryLevel.L1,

    @SerialName("telemetry_apps_blocklist")
    val telemetryAppsBlocklist: List<String> = emptyList(),

    @SerialName("telemetry_quiet_hours")
    val telemetryQuietHours: List<QuietHourWindow> = emptyList(),

    /** v0.2: 单日累计私有时段上限 (min); 默认 240 = 4h。 */
    @SerialName("_quiet_hours_max_per_day_min")
    val _quietHoursMaxPerDayMin: Int = DEFAULT_QUIET_HOURS_MAX_MIN,

    // ─── 通讯 / 通话 (主文档 §3.3) ───

    @SerialName("allow_message")
    val allowMessage: Boolean = true,

    @SerialName("allow_audio_call")
    val allowAudioCall: Boolean = true,

    @SerialName("allow_video_call")
    val allowVideoCall: Boolean = true,

    @SerialName("allow_silent_observe")
    val allowSilentObserve: Boolean = false,

    @SerialName("allow_force_pickup")
    val allowForcePickup: Boolean = false,

    @SerialName("allow_remote_view")
    val allowRemoteView: Boolean = false,

    // ─── 规则 / 任务 (主文档 §3.4 §3.5) ───

    @SerialName("allow_rule_edit")
    val allowRuleEdit: Boolean = false,

    @SerialName("allow_task_assign")
    val allowTaskAssign: Boolean = false,

    @SerialName("allow_app_disable")
    val allowAppDisable: Boolean = false,

    @SerialName("allow_app_hide")
    val allowAppHide: Boolean = false,

    // ─── 支付 / 审批 (M4 档 3) ───

    @SerialName("allow_payment_veto")
    val allowPaymentVeto: Boolean = false,

    // ─── 位置 / 围栏 (主文档 §3.8) ───

    @SerialName("allow_location_view")
    val allowLocationView: Boolean = false,

    @SerialName("allow_geofence_edit")
    val allowGeofenceEdit: Boolean = false,

    // ─── M7 SOS / M9 奖励 ───

    @SerialName("allow_sos_receive")
    val allowSosReceive: Boolean = false,

    @SerialName("allow_reward_grant")
    val allowRewardGrant: Boolean = false,

    // ─── M6 AI 陪学陪伴 ───

    @SerialName("allow_companion_summary")
    val allowCompanionSummary: CompanionSummaryAccess = CompanionSummaryAccess.STATS_ONLY,

    // ─── 紧急解绑 (主文档 §3.1 v0.2, 仅孩子→家长方向) ───

    @SerialName("allow_emergency_unbind")
    val allowEmergencyUnbind: Boolean = false,
) {
    companion object {
        const val DEFAULT_QUIET_HOURS_MAX_MIN = 240 // 4h, 主文档 §3.2 v0.2 上限

        /** Json 配置 — 忽略未知键便于跨版本兼容; encode 默认不省略默认值便于审计。 */
        val codec: Json = Json {
            ignoreUnknownKeys = true
            encodeDefaults = true
        }

        fun decode(json: String): FamilyPermissions =
            codec.decodeFromString(serializer(), json)

        fun encode(permissions: FamilyPermissions): String =
            codec.encodeToString(permissions)
    }
}

/** 业务校验异常; 与 [InvalidFamilyMembershipException] 风格对齐。 */
class InvalidFamilyPermissionsException(
    message: String,
    cause: Throwable? = null,
) : IllegalArgumentException(message, cause)
