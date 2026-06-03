package com.chainlesschain.android.core.p2p.discovery

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.os.Build
import com.chainlesschain.android.core.p2p.config.SignalingConfig
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.withTimeout
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Phase 3d v1.3: 用 Android NsdManager 在局域网搜索桌面端 mDNS 广播的
 * `_chainlesschain-signaling._tcp.local` 服务，自动写入 SharedPreferences
 * `signaling_prefs/custom_signaling_url`，免去手填 IP。
 *
 * 设计：
 * - 启动时调一次 [discoverAndPersist] (Application.delayedInit / coroutine)。
 * - 找到就写 prefs；没找到就静默放过（用户仍可手填 / 走 DEBUG_SIGNALING_URL
 *   fallback）。SignalingConfig 自身永远先读 prefs，本类只负责写。
 * - 同一服务多实例（多桌面同网段）情况下取第一个，由用户手动选择是 v1.4
 *   范畴。
 *
 * 平台细节：
 * - NsdManager 服务类型必须严格 `_<type>._tcp` —— 不能加 `.local` 后缀
 *   (Android Bonjour 客户端自加)。
 * - resolveService 在 API 21+ 一直可用；Android 14 (API 34) 引入新的
 *   registerServiceInfoCallback / discoverServices(callback) 异步 API，
 *   旧 API 仍兼容，这里只用旧 API 减少分支。
 */
@Singleton
class SignalingNsdAutoDiscovery @Inject constructor(
    @ApplicationContext private val context: Context,
    private val signalingConfig: SignalingConfig
) {

    private val nsdManager: NsdManager? by lazy {
        context.getSystemService(Context.NSD_SERVICE) as? NsdManager
    }

    /**
     * 阻塞式发现 + 持久化。返回找到的 ws URL 或 null（超时 / 失败）。
     *
     * @param timeoutMs 总超时，包括 discoverServices + resolveService 的总时间。
     */
    suspend fun discoverAndPersist(timeoutMs: Long = 5_000L): String? {
        val nsd = nsdManager
        if (nsd == null) {
            Timber.w("[SignalingNsd] NsdManager unavailable on this device")
            return null
        }

        val resolvedUrl = CompletableDeferred<String?>()
        var pendingService: NsdServiceInfo? = null
        var discoveryStarted = false

        val resolveListener = object : NsdManager.ResolveListener {
            override fun onResolveFailed(serviceInfo: NsdServiceInfo?, errorCode: Int) {
                Timber.w(
                    "[SignalingNsd] resolve failed code=$errorCode " +
                        "service=${serviceInfo?.serviceName}"
                )
                if (!resolvedUrl.isCompleted) {
                    resolvedUrl.complete(null)
                }
            }

            override fun onServiceResolved(serviceInfo: NsdServiceInfo) {
                val host = serviceInfo.host?.hostAddress
                val port = serviceInfo.port
                if (host == null || port <= 0) {
                    Timber.w(
                        "[SignalingNsd] resolved but missing host/port: " +
                            "host=$host port=$port"
                    )
                    if (!resolvedUrl.isCompleted) {
                        resolvedUrl.complete(null)
                    }
                    return
                }
                val url = "ws://$host:$port"
                Timber.i(
                    "[SignalingNsd] ✓ resolved service ${serviceInfo.serviceName} → $url"
                )
                if (!resolvedUrl.isCompleted) {
                    resolvedUrl.complete(url)
                }
            }
        }

        val discoveryListener = object : NsdManager.DiscoveryListener {
            override fun onStartDiscoveryFailed(serviceType: String?, errorCode: Int) {
                Timber.w(
                    "[SignalingNsd] start discovery failed code=$errorCode " +
                        "type=$serviceType"
                )
                if (!resolvedUrl.isCompleted) {
                    resolvedUrl.complete(null)
                }
            }

            override fun onStopDiscoveryFailed(serviceType: String?, errorCode: Int) {
                Timber.w(
                    "[SignalingNsd] stop discovery failed code=$errorCode " +
                        "type=$serviceType"
                )
            }

            override fun onDiscoveryStarted(serviceType: String?) {
                Timber.d("[SignalingNsd] discovery started type=$serviceType")
                discoveryStarted = true
            }

            override fun onDiscoveryStopped(serviceType: String?) {
                Timber.d("[SignalingNsd] discovery stopped type=$serviceType")
            }

            override fun onServiceFound(serviceInfo: NsdServiceInfo) {
                Timber.i(
                    "[SignalingNsd] service found: ${serviceInfo.serviceName} " +
                        "type=${serviceInfo.serviceType}"
                )
                if (pendingService != null || resolvedUrl.isCompleted) {
                    return
                }
                pendingService = serviceInfo
                try {
                    nsd.resolveService(serviceInfo, resolveListener)
                } catch (e: Exception) {
                    Timber.w(e, "[SignalingNsd] resolveService threw")
                    if (!resolvedUrl.isCompleted) {
                        resolvedUrl.complete(null)
                    }
                }
            }

            override fun onServiceLost(serviceInfo: NsdServiceInfo?) {
                Timber.d("[SignalingNsd] service lost: ${serviceInfo?.serviceName}")
            }
        }

        try {
            nsd.discoverServices(
                SERVICE_TYPE,
                NsdManager.PROTOCOL_DNS_SD,
                discoveryListener
            )
        } catch (e: Exception) {
            Timber.e(e, "[SignalingNsd] discoverServices threw")
            return null
        }

        val url = try {
            withTimeout(timeoutMs) { resolvedUrl.await() }
        } catch (_: TimeoutCancellationException) {
            Timber.i("[SignalingNsd] discovery timed out after ${timeoutMs}ms — manual config still works")
            null
        } finally {
            if (discoveryStarted) {
                try {
                    nsd.stopServiceDiscovery(discoveryListener)
                } catch (e: Exception) {
                    Timber.w(e, "[SignalingNsd] stopServiceDiscovery threw")
                }
            }
        }

        if (url != null && url.isNotBlank()) {
            try {
                signalingConfig.setCustomSignalingUrl(url)
                Timber.i("[SignalingNsd] ✓ persisted signaling URL → $url (Android ${Build.VERSION.SDK_INT})")
            } catch (e: Exception) {
                Timber.w(e, "[SignalingNsd] persist URL threw")
            }
        }
        return url
    }

    companion object {
        /** Must match desktop SignalingMdnsAdvertiser SERVICE_TYPE/PROTOCOL */
        const val SERVICE_TYPE = "_chainlesschain-signaling._tcp"
    }
}
