package com.chainlesschain.android.feature.familyguard.domain.model

/**
 * 复活码明文值对象 (FAMILY-08).
 *
 * **极度敏感**: 仅在 [com.chainlesschain.android.feature.familyguard.domain
 * .repository.RevivalCodeRepository.generateNewCode] 返回时存在;
 * UI 消费 (RevivalCodeDisplayCard 显示给用户记录) 后立刻让出引用, 不缓存,
 * 不写日志, 不入 Sync outbox。
 *
 * 6 位数字范围 100000..999999 (首位非零, 避免视觉与 "000123" 混淆),
 * 实际熵约 19.93 bit (log2(9e5) ≈ 19.78) + 16-byte salt 抵抗 rainbow table
 * + 3 次错锁 24h 抵抗在线暴破。
 *
 * 离线攻击场景: SQLCipher key 泄露 + revival_code 表导出 → 仍需 SHA-256
 * 900,000 次哈希破解 (毫秒级, 因为是 6 位数字), 故安全模型依赖于 SQLCipher
 * 不可破; 长期 (≥ 5 年) 替代方案可改用更长 code 或 PBKDF2 stretching, 但
 * FAMILY-08 范围保持产品体验 (6 位用户记得住) + 接受当前威胁模型。
 */
@JvmInline
value class RevivalCode(val value: String) {
    init {
        require(value.length == LENGTH) { "RevivalCode must be $LENGTH digits" }
        require(value.all { it.isDigit() }) { "RevivalCode must be digits only" }
    }

    companion object {
        const val LENGTH = 6
        const val MIN_VALUE = 100_000
        const val MAX_VALUE_EXCLUSIVE = 1_000_000
    }
}
