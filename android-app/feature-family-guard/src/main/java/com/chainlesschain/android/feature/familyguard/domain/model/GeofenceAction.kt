package com.chainlesschain.android.feature.familyguard.domain.model

/**
 * 围栏触发后要执行的动作 (FAMILY-54，主文档 §3.8)。
 *
 * geofence.on_enter_action / on_exit_action / on_late_action 三列存的是动作字面量
 * （见 [com.chainlesschain.android.feature.familyguard.data.entity.GeofenceEntity]）:
 *   - "notify_parent"      → [NotifyParent]
 *   - "silent"             → [Silent] (显式"不打扰"; dispatcher no-op，但仍出现在引擎
 *                            输出里供审计区分"配了 silent" vs "没配/解析失败")
 *   - "lock_app:<pkg>"     → [LockApp]
 *   - "unlock_app:<pkg>"   → [UnlockApp]
 *
 * 未知 / 空 / 缺包名 → [parse] 返 null（引擎据此跳过该触发，不产生 ResolvedGeofenceAction）。
 * 真正下发（推送 / 锁应用）在后续 dispatcher（接 FAMILY-04 enforce + 推送通道），
 * 本枚举只做**解析**，纯逻辑可单测。
 */
sealed interface GeofenceAction {

    data object NotifyParent : GeofenceAction

    data object Silent : GeofenceAction

    data class LockApp(val packageName: String) : GeofenceAction

    data class UnlockApp(val packageName: String) : GeofenceAction

    companion object {
        private const val LOCK_PREFIX = "lock_app:"
        private const val UNLOCK_PREFIX = "unlock_app:"

        fun parse(raw: String?): GeofenceAction? {
            val v = raw?.trim().orEmpty()
            return when {
                v == "notify_parent" -> NotifyParent
                v == "silent" -> Silent
                v.startsWith(LOCK_PREFIX) ->
                    v.substringAfter(LOCK_PREFIX).takeIf { it.isNotBlank() }?.let { LockApp(it) }
                v.startsWith(UNLOCK_PREFIX) ->
                    v.substringAfter(UNLOCK_PREFIX).takeIf { it.isNotBlank() }?.let { UnlockApp(it) }
                else -> null
            }
        }
    }
}
