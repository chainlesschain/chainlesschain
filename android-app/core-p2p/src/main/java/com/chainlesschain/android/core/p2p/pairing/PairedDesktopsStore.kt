package com.chainlesschain.android.core.p2p.pairing

import android.content.Context
import android.content.SharedPreferences
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 持久化已配对桌面列表 — v1.3+ (issue #21)。
 *
 * 解决「扫码成功 → 退出扫码屏 → 首页『未连接桌面』」的 UX 反直觉：
 * `PairedDevicesViewModel` 之前读 `p2pClient.connectedPeers`（live WS 连接），
 * 而 ScanDesktopPairing 走 signaling forward 路径不创建持久 P2PClient
 * 连接，扫码完信令一断 connectedPeers 立即空。
 *
 * 本类把 ScanDesktopPairingViewModel 成功路径里的 desktop 元数据写
 * SharedPreferences (JSON list)，首页 [PairedDesktopsViewModel] 读这里，
 * 不再依赖 live 连接 — 配对一次就一直显示「已连接」直到用户主动解除。
 *
 * 数据 schema 简单：列表 by pcPeerId 去重，最新 paired 时间 + lastSeenAt。
 */
@Singleton
class PairedDesktopsStore @Inject constructor(
    @ApplicationContext private val context: Context,
) {

    companion object {
        private const val PREFS_NAME = "paired_desktops_prefs"
        private const val KEY_LIST = "desktops_json"
    }

    private val prefs: SharedPreferences by lazy {
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    }

    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

    private val _devices = MutableStateFlow<List<PairedDesktop>>(loadFromPrefs())
    val devices: StateFlow<List<PairedDesktop>> = _devices.asStateFlow()

    /**
     * 写入或更新一个已配对桌面（by pcPeerId 去重）。Idempotent — 多次扫同
     * 一桌面会更新 lastPairedAt 而非重复加入。
     */
    fun upsert(desktop: PairedDesktop) {
        val current = _devices.value.toMutableList()
        val existingIdx = current.indexOfFirst { it.pcPeerId == desktop.pcPeerId }
        if (existingIdx >= 0) {
            current[existingIdx] = desktop.copy(pairedAt = current[existingIdx].pairedAt)
        } else {
            current.add(desktop)
        }
        _devices.value = current
        saveToPrefs(current)
        Timber.i("[PairedDesktopsStore] upsert ${desktop.pcPeerId.take(12)}… name=${desktop.deviceName} (total=${current.size})")
    }

    fun remove(pcPeerId: String) {
        val filtered = _devices.value.filterNot { it.pcPeerId == pcPeerId }
        _devices.value = filtered
        saveToPrefs(filtered)
        Timber.i("[PairedDesktopsStore] removed ${pcPeerId.take(12)}… (total=${filtered.size})")
    }

    fun clear() {
        _devices.value = emptyList()
        prefs.edit().remove(KEY_LIST).apply()
    }

    private fun loadFromPrefs(): List<PairedDesktop> {
        val raw = prefs.getString(KEY_LIST, null) ?: return emptyList()
        return try {
            json.decodeFromString(ListSerializer(PairedDesktop.serializer()), raw)
        } catch (e: Exception) {
            Timber.w(e, "[PairedDesktopsStore] decode failed, returning empty")
            emptyList()
        }
    }

    private fun saveToPrefs(list: List<PairedDesktop>) {
        try {
            val s = json.encodeToString(ListSerializer(PairedDesktop.serializer()), list)
            prefs.edit().putString(KEY_LIST, s).apply()
        } catch (e: Exception) {
            Timber.w(e, "[PairedDesktopsStore] encode failed")
        }
    }
}

@Serializable
data class PairedDesktop(
    val pcPeerId: String,
    val deviceName: String,
    val platform: String = "desktop",
    /** 局域网 ws URL（QR 里的 signalingUrl 字段，可能过期）。 */
    val lanSignalingUrl: String? = null,
    /** 公网中继 URL，远程模式 fallback。 */
    val relayUrl: String? = null,
    val pairedAt: Long = System.currentTimeMillis(),
    /** 最近一次成功通信时间，用于「最近活跃」展示（暂未串）。 */
    val lastSeenAt: Long = System.currentTimeMillis(),
)
