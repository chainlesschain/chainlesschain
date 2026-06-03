package com.chainlesschain.android.feature.familyguard.data.time

import com.chainlesschain.android.feature.familyguard.domain.time.MonotonicClock
import com.chainlesschain.android.feature.familyguard.domain.time.ParentTimeSource
import com.chainlesschain.android.feature.familyguard.domain.time.TimeAuthority
import com.chainlesschain.android.feature.familyguard.domain.time.TimeAuthorityStatus
import java.time.Clock
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.math.abs
import timber.log.Timber

/**
 * [TimeAuthority] 默认实装 (FAMILY-60). Cristian 算法 + 单调时钟锚定。
 *
 * 同步: t0 = monotonic; parentMs = 家长端响应时刻 epoch; t2 = monotonic; RTT = t2-t0;
 * 估家长端在 t2 的时间 ≈ parentMs + RTT/2 (Cristian: 假设上下行延迟对称)。锚点
 * ([Anchor]) 记 (authoritativeMsAtSync = parentMs+RTT/2, monotonicAtSync = t2)。
 *
 * [authoritativeNow] = authoritativeMsAtSync + (monotonic_now - monotonicAtSync) —— 全程
 * 走单调时钟, 用户改墙钟/时区不影响权威时间。[status] 拿权威时间对比墙钟 ([wallClock])
 * 算 skew。
 *
 * 锚点仅存内存 (@Volatile): monotonic (elapsedRealtime) 重启归零, 跨重启的旧锚无效, 故
 * 进程重启后 NEVER_SYNCED 直到下次 [sync]。
 */
@Singleton
class CristianTimeAuthority @Inject constructor(
    private val wallClock: Clock,
    private val monotonicClock: MonotonicClock,
    private val parentTimeSource: ParentTimeSource,
) : TimeAuthority {

    private data class Anchor(val authoritativeMsAtSync: Long, val monotonicAtSync: Long)

    @Volatile
    private var anchor: Anchor? = null

    override suspend fun sync(): Boolean {
        val t0 = monotonicClock.elapsedRealtimeMs()
        val parentMs = parentTimeSource.fetchParentEpochMs()
        if (parentMs == null) {
            Timber.d("TimeAuthority.sync: parent time unreachable; anchor unchanged")
            return false
        }
        val t2 = monotonicClock.elapsedRealtimeMs()
        val rtt = (t2 - t0).coerceAtLeast(0)
        anchor = Anchor(
            authoritativeMsAtSync = parentMs + rtt / 2,
            monotonicAtSync = t2,
        )
        Timber.i("TimeAuthority.sync ok: rtt=%dms anchored", rtt)
        return true
    }

    override fun authoritativeNow(): Long {
        val a = anchor ?: return wallClock.millis() // 未同步: 退墙钟 (status=NEVER_SYNCED)
        return a.authoritativeMsAtSync + (monotonicClock.elapsedRealtimeMs() - a.monotonicAtSync)
    }

    override fun status(): TimeAuthorityStatus {
        val a = anchor ?: return TimeAuthorityStatus.NEVER_SYNCED
        val sinceSyncMs = monotonicClock.elapsedRealtimeMs() - a.monotonicAtSync
        // 离线过久优先降温和档 (不锁), 防全断网永久锁死 (主文档 §3.4)。
        if (sinceSyncMs > STALE_THRESHOLD_MS) return TimeAuthorityStatus.STALE
        val skew = abs(wallClock.millis() - authoritativeNow())
        return if (skew > SKEW_THRESHOLD_MS) {
            TimeAuthorityStatus.SKEW_DETECTED
        } else {
            TimeAuthorityStatus.TRUSTED
        }
    }

    override fun isTimeTrusted(): Boolean = status() == TimeAuthorityStatus.TRUSTED

    override fun shouldLockTimeFeatures(): Boolean = status() == TimeAuthorityStatus.SKEW_DETECTED

    companion object {
        /** 墙钟与权威时间偏差锁阈值 (主文档 §3.4: 5min)。 */
        const val SKEW_THRESHOLD_MS = 5L * 60 * 1000

        /** 离线降温和档阈值 (主文档 §3.4: 48h)。 */
        const val STALE_THRESHOLD_MS = 48L * 60 * 60 * 1000
    }
}
