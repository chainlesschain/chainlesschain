package com.chainlesschain.android.feature.familyguard.domain.time

/**
 * 单调时钟抽象 (FAMILY-60). 默认实装包 `SystemClock.elapsedRealtime()` —— 自开机起
 * 单调递增 (含深睡), **用户改墙钟 / 时区不影响**, 故是 [TimeAuthority] 防改钟绕过的基石。
 *
 * 接口化让 JVM 单测能注入可控时钟模拟网络延迟 / 时间推进 (SystemClock 是 Android API,
 * 纯 JVM 测试不可调)。
 *
 * 注: elapsedRealtime 仅在**重启**时归零; 进程重启 (未重启设备) 仍连续。[TimeAuthority]
 * 的同步锚点只存内存 (不跨重启持久, 否则重启后旧 monotonic 锚失效), 重启后 NEVER_SYNCED
 * 直到下次同步。
 */
interface MonotonicClock {

    /** 自开机起的单调毫秒数 (含深睡); 不受墙钟/时区更改影响。 */
    fun elapsedRealtimeMs(): Long
}
