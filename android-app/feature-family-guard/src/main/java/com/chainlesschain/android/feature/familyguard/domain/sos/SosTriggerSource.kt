package com.chainlesschain.android.feature.familyguard.domain.sos

/**
 * SOS 触发途径 (FAMILY-40). 主文档 §3.7 5 触发方式。
 *
 * [storageValue] 写入 sos_event.trigger_source 列; 不许改值 (破坏 on-disk)。
 * 实际触发硬件接入 (音量键连击 / 锁屏 widget / 密语 / 手表手势) 是 FAMILY-41 (设备层);
 * 本枚举仅定义类别 + 供 Repository 落库。
 */
enum class SosTriggerSource(val storageValue: String) {
    /** 音量减键 5 连击。 */
    VOLUME_BUTTON("volume_button"),

    /** 锁屏通知 action / lock-screen widget。 */
    LOCK_SCREEN("lock_screen"),

    /** 应用内大红按钮。 */
    IN_APP("in_app"),

    /** 陪伴 tab 自定义密语关键词。 */
    CODEWORD("codeword"),

    /** 智能手表配对手势 (v1.0+, FAMILY-41 留 stub)。 */
    WATCH_GESTURE("watch_gesture"),

    ;

    companion object {
        fun fromStorage(value: String): SosTriggerSource? =
            entries.firstOrNull { it.storageValue == value }
    }
}
