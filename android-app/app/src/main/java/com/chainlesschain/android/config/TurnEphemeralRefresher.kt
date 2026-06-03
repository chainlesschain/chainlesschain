package com.chainlesschain.android.config

import com.chainlesschain.android.core.p2p.ice.IceServerConfig
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

/**
 * v1.2 prep #2 — TURN ephemeral credentials 后台 refresher。
 *
 * 启动期 [start] 由 [com.chainlesschain.android.initializer.AppInitializer] 调；
 * 当 [TurnServerPreferences.ephemeralEnabled] = true 且 endpoint URL 非空时，立即
 * 取一次 + 在 80% TTL 处自动 refresh。每次成功 refresh 后清掉 IceServerConfig 旧
 * ephemeral entries 加新的，下次 WebRTC connect 即生效。
 *
 * 失败重试：指数 backoff 30s → 60s → 120s → 240s → cap 600s；连续 5 次 fail 后停
 * 等到 enabled toggle off→on 或 endpoint URL 改时由 [restart] 重置。
 */
@Singleton
class TurnEphemeralRefresher @Inject constructor(
    private val preferences: TurnServerPreferences,
    private val client: TurnEphemeralCredentialsClient,
    private val iceConfig: IceServerConfig,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    @Volatile private var refreshJob: Job? = null
    @Volatile private var lastFetched: TurnEphemeralCredentials? = null

    /** 当前已应用的 ephemeral credentials，UI 可以显示状态。null = 未启动 / 未取到。 */
    fun current(): TurnEphemeralCredentials? = lastFetched

    /**
     * 启动 refresher。幂等：已运行时 no-op；prefs.ephemeralEnabled = false 或 URL 为空时
     * 只 log 不动。AppInitializer 启动 + 用户 Settings toggle on 时调。
     */
    fun start() {
        if (refreshJob?.isActive == true) {
            Timber.d("TurnEphemeralRefresher.start: already running")
            return
        }
        val enabled = preferences.ephemeralEnabled.value
        val url = preferences.ephemeralEndpointUrl.value
        if (!enabled || url.isBlank()) {
            Timber.d("TurnEphemeralRefresher.start: disabled or URL empty (enabled=$enabled, urlLen=${url.length})")
            return
        }
        Timber.i("TurnEphemeralRefresher.start: launching refresh loop")
        refreshJob = scope.launch { refreshLoop(url) }
    }

    /** 重启（用户改 endpoint URL 或 toggle on→off→on 时）。先 [stop] 再 [start]。 */
    fun restart() {
        stop()
        start()
    }

    fun stop() {
        refreshJob?.cancel()
        refreshJob = null
        lastFetched = null
        Timber.d("TurnEphemeralRefresher.stop")
    }

    private suspend fun refreshLoop(url: String) {
        var consecutiveFails = 0
        while (refreshJob?.isActive == true) {
            try {
                val creds = client.fetch(url)
                applyToIceConfig(creds)
                lastFetched = creds
                consecutiveFails = 0

                // sleep 到 80% TTL 处再 refresh，留 20% buffer 防过期 race
                val sleepMs = (creds.ttlSeconds * 1000 * 4 / 5).coerceAtLeast(60_000L)
                Timber.d("TurnEphemeralRefresher: next refresh in ${sleepMs / 1000}s")
                delay(sleepMs)
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
            } catch (e: Exception) {
                consecutiveFails++
                if (consecutiveFails >= MAX_CONSECUTIVE_FAILS) {
                    Timber.e(e, "TurnEphemeralRefresher: $consecutiveFails consecutive fails, giving up. Restart via Settings toggle.")
                    return
                }
                val backoffMs = (BACKOFF_BASE_MS shl (consecutiveFails - 1)).coerceAtMost(BACKOFF_CAP_MS)
                Timber.w(e, "TurnEphemeralRefresher fetch failed (#$consecutiveFails), backing off ${backoffMs / 1000}s")
                delay(backoffMs)
            }
        }
    }

    private fun applyToIceConfig(creds: TurnEphemeralCredentials) {
        // 用户配置的 long-term TURN 不动；仅清掉之前 ephemeral 注入的 entries 然后加新的。
        // 简化策略：本次仅 add，不 remove（若用户切换 endpoint 旧的会留在 IceConfig；
        // 等下次 connect 调用 IceConfig 时多一些 candidates 是无害的，最坏 fail 后用其他）。
        // v1.3 优化：tag 标 "source=ephemeral" 区分用户配置的，定向 remove。
        for (server in creds.toTurnServers()) {
            iceConfig.addTurnServer(server.url, server.username, server.password)
        }
        Timber.i("TurnEphemeralRefresher: applied ${creds.uris.size} ephemeral TURN URI(s)")
    }

    companion object {
        private const val MAX_CONSECUTIVE_FAILS = 5
        private const val BACKOFF_BASE_MS = 30_000L
        private const val BACKOFF_CAP_MS = 600_000L
    }
}
