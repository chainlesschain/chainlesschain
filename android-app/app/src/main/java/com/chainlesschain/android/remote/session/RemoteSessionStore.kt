package com.chainlesschain.android.remote.session

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import org.json.JSONObject

class RemoteSessionStore(context: Context) {
    private val prefs = EncryptedSharedPreferences.create(
        context,
        "remote_session_secure",
        MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    fun savePendingPairing(uri: String) {
        prefs.edit().putString(KEY_PENDING_URI, uri).apply()
    }

    fun consumePendingPairing(): String? {
        val value = prefs.getString(KEY_PENDING_URI, null)
        prefs.edit().remove(KEY_PENDING_URI).apply()
        return value
    }

    fun saveMetadata(pairing: RemoteSessionPairing, peerId: String) {
        val value = JSONObject()
            .put("remoteSessionId", pairing.remoteSessionId)
            .put("relayUrl", pairing.relayUrl)
            .put("hostPeerId", pairing.hostPeerId)
            .put("peerId", peerId)
            .put("pairedAt", System.currentTimeMillis())
            .toString()
        prefs.edit().putString(KEY_METADATA, value).remove(KEY_PENDING_URI).apply()
    }

    fun clear() {
        prefs.edit().remove(KEY_PENDING_URI).remove(KEY_METADATA).apply()
    }

    companion object {
        private const val KEY_PENDING_URI = "pending_pairing_uri"
        private const val KEY_METADATA = "session_metadata"
    }
}
