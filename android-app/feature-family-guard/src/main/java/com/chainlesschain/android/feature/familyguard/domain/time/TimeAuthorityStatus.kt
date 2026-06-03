package com.chainlesschain.android.feature.familyguard.domain.time

/**
 * 权威时间可信状态 (FAMILY-60). 主文档 §3.4 v0.2 时间同步防绕过。
 *
 * 时间相关功能 (quiet hours / daily cap / due / 24h 锁) 据此决定执行强度:
 *   - [TRUSTED]       → 正常执行
 *   - [SKEW_DETECTED] → 墙钟与权威时间差 > 5min (疑似改钟绕过) → **锁** + 推家长
 *   - [STALE]         → 离线 > 48h 未同步 → 降"温和档" (不锁, 防全断网永久锁死)
 *   - [NEVER_SYNCED]  → 进程启动后尚未成功同步 → 无基线, 同温和档 (不锁)
 */
enum class TimeAuthorityStatus {
    TRUSTED,
    SKEW_DETECTED,
    STALE,
    NEVER_SYNCED,
}
