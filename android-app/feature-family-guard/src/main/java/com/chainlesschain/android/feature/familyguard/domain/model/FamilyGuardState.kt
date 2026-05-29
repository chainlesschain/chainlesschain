package com.chainlesschain.android.feature.familyguard.domain.model

/**
 * FamilyGuardForegroundService 持久通知状态机 (FAMILY-05).
 *
 * 4 态对齐主文档 §3.1 "FamilyGuardForegroundService 通知文案按 family_relationship
 * 状态动态变 (监管中 / 旁观中 / 待机 / 紧急)"。
 *
 * 与 [com.chainlesschain.android.feature.familyguard.domain.model.RoleLockState]
 * 完全独立: RoleLockState 描述本机角色锁; FamilyGuardState 描述运行时家庭守护服务
 * 当前在干嘛。两者通过 ViewModel / Controller 在调用方组合。
 */
enum class FamilyGuardState {
    /** 待机: app 装好 / 角色已选, 暂无 active family_relationship 或孩子端无监管 */
    IDLE,

    /** 监管中: 孩子端常态; 家长端正在拉 telemetry */
    MONITORING,

    /** 旁观中: 家长在静音旁观孩子屏 (M3 SILENT_OBSERVE 进行中) */
    OBSERVING,

    /** 紧急: SOS 已触发, 或强接通进行中, 全屏红色横幅 */
    URGENT,
    ;

    /** 状态对应的 NotificationChannel id; 见 NotificationChannels。 */
    val channelId: String
        get() = when (this) {
            IDLE, MONITORING -> NotificationChannels.STATUS_LOW
            OBSERVING, URGENT -> NotificationChannels.ALERT_HIGH
        }

    /** 通知正文; UI 拷贝以中文呈现 (国内市场首发, 后续 i18n 落 strings.xml)。 */
    fun displayText(): String = when (this) {
        IDLE -> "家庭守护待机中"
        MONITORING -> "家庭守护监管中"
        OBSERVING -> "正在被家长查看屏幕"
        URGENT -> "⚠️ 紧急联络中"
    }
}

/**
 * NotificationChannel 常量集中托管, 避免散落字面值。
 *
 * channelId 命名格式 "family_guard_<purpose>" 保持名空间隔离 (与 :app 其他 channel
 * 如 location_capture / pc_notifications 不冲突)。
 */
object NotificationChannels {
    /** 待机 / 监管 — IMPORTANCE_LOW, 无声; 仅状态栏图标。 */
    const val STATUS_LOW = "family_guard_status"

    /** 旁观 / 紧急 — IMPORTANCE_HIGH, 强提示 + 颜色化 + 绕过勿扰。 */
    const val ALERT_HIGH = "family_guard_alert"
}
