package com.chainlesschain.android.remote.webrtc

import android.content.Context
import android.content.SharedPreferences
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import timber.log.Timber

/** [UrgentCallQuota.consume] 结果。 */
sealed interface UrgentQuotaResult {
    /** 放行；[remaining] = 本窗口剩余次数（已扣本次）。 */
    data class Allowed(val remaining: Int) : UrgentQuotaResult

    /** 超额；[resetAtMs] = 最早一次配额过期、可再强接通的时刻（epoch ms）。 */
    data class Exhausted(val resetAtMs: Long) : UrgentQuotaResult
}

/**
 * 强接通配额（FAMILY-36，依赖 FAMILY-32 URGENT）。
 *
 * 每个对端（targetDid）**滚动 24h 窗口最多 3 次**强接通；超额由调用方降级为普通呼叫
 * （FamilyCallRpcClient.urgentForce → invite(AUDIO)）。SharedPreferences 持久（JSON:
 * `{"<targetDid>": [ts1, ts2, ...]}` epoch ms），跨重启保留。
 *
 * 时间走 **显式 nowMs 参数**（不内部取墙钟）：(1) 单测可注固定时刻；(2) 调用方可喂
 * TimeAuthority 权威时间防改设备钟绕过配额（FAMILY-60 接进后）。
 *
 * UI 剩余配额显示调 [remaining]（peek，不扣）。
 */
@Singleton
class UrgentCallQuota @Inject constructor(
    @ApplicationContext context: Context,
) {
    private val prefs: SharedPreferences =
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    private val json = Json { ignoreUnknownKeys = true }

    /** 本窗口剩余次数（peek，不扣）。 */
    fun remaining(targetDid: String, nowMs: Long): Int {
        val pruned = prune(load()[targetDid].orEmpty(), nowMs)
        return (MAX_PER_WINDOW - pruned.size).coerceAtLeast(0)
    }

    /** 尝试消费一次强接通配额。Allowed 时已记账 + 持久化；Exhausted 不记。 */
    fun consume(targetDid: String, nowMs: Long): UrgentQuotaResult {
        val map = load()
        val pruned = prune(map[targetDid].orEmpty(), nowMs)
        if (pruned.size >= MAX_PER_WINDOW) {
            // 持久化 prune 结果（清掉过期项），不加新项。
            map[targetDid] = pruned
            save(map)
            val resetAtMs = pruned.min() + WINDOW_MS
            Timber.w("[UrgentCallQuota] $targetDid exhausted (${pruned.size}/$MAX_PER_WINDOW), reset@$resetAtMs")
            return UrgentQuotaResult.Exhausted(resetAtMs)
        }
        val updated = (pruned + nowMs).toMutableList()
        map[targetDid] = updated
        save(map)
        return UrgentQuotaResult.Allowed(remaining = MAX_PER_WINDOW - updated.size)
    }

    /** 清空（测试 / admin）。targetDid==null 清全部。 */
    fun reset(targetDid: String? = null) {
        if (targetDid == null) {
            prefs.edit().remove(KEY_QUOTA).apply()
            return
        }
        val map = load()
        map.remove(targetDid)
        save(map)
    }

    private fun prune(timestamps: List<Long>, nowMs: Long): List<Long> {
        val cutoff = nowMs - WINDOW_MS
        return timestamps.filter { it > cutoff }
    }

    private fun load(): MutableMap<String, List<Long>> {
        val raw = prefs.getString(KEY_QUOTA, null) ?: return mutableMapOf()
        return try {
            json.decodeFromString<Map<String, List<Long>>>(raw).toMutableMap()
        } catch (e: Exception) {
            Timber.w(e, "[UrgentCallQuota] decode failed, reset")
            mutableMapOf()
        }
    }

    private fun save(map: Map<String, List<Long>>) {
        // 丢掉空列表项保持紧凑。
        val compact = map.filterValues { it.isNotEmpty() }
        prefs.edit().putString(KEY_QUOTA, json.encodeToString(compact)).apply()
    }

    companion object {
        const val MAX_PER_WINDOW = 3
        const val WINDOW_MS = 24L * 60L * 60L * 1000L
        private const val PREFS_NAME = "urgent_call_quota_prefs"
        private const val KEY_QUOTA = "quota_json"
    }
}
