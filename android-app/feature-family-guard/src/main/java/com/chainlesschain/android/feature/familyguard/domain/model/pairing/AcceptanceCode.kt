package com.chainlesschain.android.feature.familyguard.domain.model.pairing

/**
 * Pairing acceptance code (FAMILY-13).
 *
 * 6 位数字, 主文档 §3.1 v0.2: "二次密码确认 (防误扫)"。家长在生成 QR 时
 * 同时显示 acceptance code, 走线下/QQ 渠道告知孩子; QR 内仅含 hash(salt+code),
 * 即使 QR 被旁人截屏也无法直接接受。
 *
 * 与 RevivalCode (FAMILY-08) 区别:
 *   - AcceptanceCode: 配对一次性使用, TTL 10min, 防误扫 / 中间人
 *   - RevivalCode: 紧急解绑用, 长期保留, 防 stalkerware 滥用
 */
@JvmInline
value class AcceptanceCode(val value: String) {
    init {
        require(value.length == LENGTH) { "AcceptanceCode must be $LENGTH digits" }
        require(value.all { it.isDigit() }) { "AcceptanceCode must be digits only" }
    }

    companion object {
        const val LENGTH = 6
        const val MIN_VALUE = 100_000
        const val MAX_VALUE_EXCLUSIVE = 1_000_000
    }
}
