package com.chainlesschain.android.config

import com.chainlesschain.android.core.p2p.ice.TurnServerCredentials
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import timber.log.Timber
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import javax.inject.Singleton

/**
 * v1.2 prep #2 — TURN ephemeral credentials HTTP client (Twilio /turn-credentials shape)。
 *
 * 期望响应 JSON shape:
 * ```json
 * {
 *   "username": "1736500000:user-id",
 *   "password": "base64HmacSha1...",
 *   "ttl": 86400,
 *   "uris": ["turn:turn.example.com:3478?transport=tcp", "turn:turn.example.com:80"]
 * }
 * ```
 *
 * 容错：缺 ttl 返默认 24h；缺 uris 返空 list；username/password 必填，缺则 fail。
 *
 * 不持久化结果 — 调用方拿 [TurnEphemeralCredentials] 直接灌进 IceServerConfig，
 * 下一次连接生效；过期前由 [TurnEphemeralRefresher] 自动 refresh。
 */
@Singleton
class TurnEphemeralCredentialsClient @Inject constructor() {

    private val http: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .build()

    /**
     * GET endpoint → 解析 → 返 [TurnEphemeralCredentials]。
     *
     * @throws IllegalArgumentException endpointUrl 非 https / 必填字段缺
     * @throws java.io.IOException 网络失败 / 4xx / 5xx
     */
    suspend fun fetch(endpointUrl: String): TurnEphemeralCredentials = withContext(Dispatchers.IO) {
        require(endpointUrl.startsWith("https://")) {
            "ephemeral endpoint must be https:// (got prefix=${endpointUrl.take(10)})"
        }
        val req = Request.Builder().url(endpointUrl).get().build()
        http.newCall(req).execute().use { resp ->
            if (!resp.isSuccessful) {
                throw java.io.IOException("HTTP ${resp.code}: ${resp.message}")
            }
            val body = resp.body?.string()
                ?: throw java.io.IOException("empty body")
            parseResponse(body)
        }
    }

    internal fun parseResponse(json: String): TurnEphemeralCredentials {
        val obj = JSONObject(json)
        val username = obj.optString("username").takeIf { it.isNotBlank() }
            ?: throw IllegalArgumentException("missing 'username'")
        val password = obj.optString("password").takeIf { it.isNotBlank() }
            ?: throw IllegalArgumentException("missing 'password'")
        val ttlSec = obj.optLong("ttl", DEFAULT_TTL_SEC)
        val urisJson = obj.optJSONArray("uris") ?: JSONArray()
        val uris = (0 until urisJson.length())
            .mapNotNull { urisJson.optString(it).takeIf { s -> s.isNotBlank() } }
        Timber.i(
            "TurnEphemeralCredentialsClient: fetched %d URI(s), ttl=%ds (username len=%d)",
            uris.size, ttlSec, username.length,
        )
        return TurnEphemeralCredentials(
            username = username,
            password = password,
            ttlSeconds = ttlSec,
            uris = uris,
            fetchedAtMs = System.currentTimeMillis(),
        )
    }

    companion object {
        const val DEFAULT_TTL_SEC: Long = 24 * 60 * 60  // 24h
    }
}

/**
 * Ephemeral credentials snapshot. [expiresAtMs] = fetchedAtMs + ttlSeconds*1000；refresher
 * 在 80% TTL 处主动 refresh 防过期 race。
 */
data class TurnEphemeralCredentials(
    val username: String,
    val password: String,
    val ttlSeconds: Long,
    val uris: List<String>,
    val fetchedAtMs: Long,
) {
    val expiresAtMs: Long get() = fetchedAtMs + ttlSeconds * 1000
    fun isExpired(nowMs: Long = System.currentTimeMillis()): Boolean = nowMs >= expiresAtMs

    /** 转 [TurnServerCredentials] list（每 URI 一个 entry，username/password 共用）。 */
    fun toTurnServers(): List<TurnServerCredentials> =
        uris.map { TurnServerCredentials(url = it, username = username, password = password) }
}
