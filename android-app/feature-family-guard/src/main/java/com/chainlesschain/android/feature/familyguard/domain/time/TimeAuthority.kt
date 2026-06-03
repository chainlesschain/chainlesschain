package com.chainlesschain.android.feature.familyguard.domain.time

/**
 * 权威时间服务 (FAMILY-60). 主文档 §3.4 v0.2 时间同步防绕过 —— 所有 M2 quiet hours /
 * M4 daily cap / M5 due / FAMILY-04 24h 锁评估时用 [authoritativeNow] 而非
 * `System.currentTimeMillis()`, 防孩子改设备墙钟/时区绕过时间约束。
 *
 * 机制 (默认实装 [com.chainlesschain.android.feature.familyguard.data.time.CristianTimeAuthority]):
 *   - 每 30min 经 [ParentTimeSource] 从家长端拉一次时间, 跑 Cristian 算法估单程延迟,
 *     把权威时间锚定到本机**单调时钟** ([MonotonicClock], 用户改墙钟不影响)。
 *   - [authoritativeNow] = 锚定权威时间 + 单调时钟自锚点以来的流逝。
 *   - [status] 比较墙钟与权威时间: 差 > 5min → [TimeAuthorityStatus.SKEW_DETECTED] (锁);
 *     离线 > 48h → [TimeAuthorityStatus.STALE] (温和档, 不锁)。
 */
interface TimeAuthority {

    /**
     * 当前权威 epoch ms。已同步则用单调时钟外推权威时间 (不受墙钟更改影响); 从未同步则
     * 退化到本机墙钟 (此时 [status] = NEVER_SYNCED, 调用方应按不可信处理)。
     */
    fun authoritativeNow(): Long

    /** 当前可信状态 (见 [TimeAuthorityStatus])。 */
    fun status(): TimeAuthorityStatus

    /** 时间是否完全可信 (= [TimeAuthorityStatus.TRUSTED])。 */
    fun isTimeTrusted(): Boolean

    /**
     * 是否应锁定时间约束功能 (= [TimeAuthorityStatus.SKEW_DETECTED]: 检测到改钟绕过)。
     * STALE / NEVER_SYNCED 不锁 (降温和档), 避免离线 / 首启永久锁死。
     */
    fun shouldLockTimeFeatures(): Boolean

    /**
     * 同步一次权威时间 (经 [ParentTimeSource])。由 30min 周期触发 (boot/keepalive 路径,
     * :app 接线)。@return true 同步成功并更新锚点; false 家长端不可达 (锚点不变)。
     */
    suspend fun sync(): Boolean
}
