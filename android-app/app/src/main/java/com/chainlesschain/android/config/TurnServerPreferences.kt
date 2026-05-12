package com.chainlesschain.android.config

import android.content.Context
import android.content.SharedPreferences
import androidx.core.content.edit
import com.chainlesschain.android.core.p2p.ice.TurnServerCredentials
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.json.JSONArray
import org.json.JSONObject
import org.webrtc.PeerConnection
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

/**
 * v1.1 issue #19 W3：TURN 中继 user-config 持久化。
 *
 * 存：
 *  - user-defined TURN server entries (url + username + password)
 *  - iceTransportsType policy (ALL / RELAY / NOHOST)
 *
 * SharedPreferences-backed（per memory：keystore 类敏感凭证已有
 * `core-security/.../SecurePreferences`，但 TURN 凭证一般用 long-term username +
 * shared-secret，本身就在多个用户机器+服务器配置文件上明文存放，普通 SharedPreferences
 * 已足；如要加密升 EncryptedSharedPreferences 即可。
 *
 * StateFlow [turnServers] / [transportPolicy] 让 UI 实时反应；
 * [TurnServerSettingsLoader.applyToIceConfig] 在 AppInitializer 里同步到 IceServerConfig。
 */
@Singleton
class TurnServerPreferences @Inject constructor(
    @ApplicationContext context: Context,
) {
    private val prefs: SharedPreferences = context.getSharedPreferences(
        PREF_NAME,
        Context.MODE_PRIVATE,
    )

    private val _turnServers = MutableStateFlow<List<TurnServerCredentials>>(loadTurnServers())
    val turnServers: StateFlow<List<TurnServerCredentials>> = _turnServers.asStateFlow()

    private val _transportPolicy = MutableStateFlow(loadTransportPolicy())
    val transportPolicy: StateFlow<PeerConnection.IceTransportsType> = _transportPolicy.asStateFlow()

    fun addTurnServer(url: String, username: String, password: String): Boolean {
        if (url.isBlank() || username.isBlank() || password.isBlank()) {
            Timber.w("TurnServerPreferences.addTurnServer: blank field rejected")
            return false
        }
        val current = _turnServers.value
        if (current.any { it.url == url }) {
            Timber.w("TurnServerPreferences.addTurnServer: $url already exists")
            return false
        }
        val updated = current + TurnServerCredentials(url, username, password)
        _turnServers.value = updated
        save(updated)
        Timber.i("TurnServerPreferences: added $url (total=${updated.size})")
        return true
    }

    fun removeTurnServer(url: String): Boolean {
        val current = _turnServers.value
        val updated = current.filter { it.url != url }
        if (updated.size == current.size) return false
        _turnServers.value = updated
        save(updated)
        Timber.i("TurnServerPreferences: removed $url (total=${updated.size})")
        return true
    }

    fun setTransportPolicy(policy: PeerConnection.IceTransportsType) {
        _transportPolicy.value = policy
        prefs.edit { putString(KEY_POLICY, policy.name) }
        Timber.i("TurnServerPreferences: transportPolicy=$policy")
    }

    fun clearAll() {
        _turnServers.value = emptyList()
        _transportPolicy.value = PeerConnection.IceTransportsType.ALL
        prefs.edit {
            remove(KEY_TURN_SERVERS)
            remove(KEY_POLICY)
        }
    }

    private fun save(list: List<TurnServerCredentials>) {
        val arr = JSONArray()
        for (c in list) {
            arr.put(JSONObject().apply {
                put("url", c.url)
                put("username", c.username)
                put("password", c.password)
            })
        }
        prefs.edit { putString(KEY_TURN_SERVERS, arr.toString()) }
    }

    private fun loadTurnServers(): List<TurnServerCredentials> {
        val raw = prefs.getString(KEY_TURN_SERVERS, null) ?: return emptyList()
        return try {
            val arr = JSONArray(raw)
            (0 until arr.length()).mapNotNull { i ->
                val obj = arr.optJSONObject(i) ?: return@mapNotNull null
                val url = obj.optString("url")
                val username = obj.optString("username")
                val password = obj.optString("password")
                if (url.isBlank() || username.isBlank() || password.isBlank()) null
                else TurnServerCredentials(url, username, password)
            }
        } catch (e: Exception) {
            Timber.w(e, "TurnServerPreferences.loadTurnServers parse failure; resetting")
            emptyList()
        }
    }

    private fun loadTransportPolicy(): PeerConnection.IceTransportsType {
        val name = prefs.getString(KEY_POLICY, null) ?: return PeerConnection.IceTransportsType.ALL
        return try {
            PeerConnection.IceTransportsType.valueOf(name)
        } catch (e: IllegalArgumentException) {
            Timber.w(e, "TurnServerPreferences.loadTransportPolicy unknown value=$name; default ALL")
            PeerConnection.IceTransportsType.ALL
        }
    }

    companion object {
        private const val PREF_NAME = "turn_server_prefs"
        private const val KEY_TURN_SERVERS = "turn_servers_json"
        private const val KEY_POLICY = "ice_transport_policy"
    }
}
