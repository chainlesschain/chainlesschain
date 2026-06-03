package com.chainlesschain.android.feature.familyguard.data.preferences

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import com.chainlesschain.android.feature.familyguard.domain.model.AppRole
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

/**
 * 角色 + 选定时刻持久化层 (FAMILY-04). 是 [RolePreferencesRepository] 唯一
 * 数据源; 暴露的 [observeStoredRole] / [save] API 不含时间裁决 (24h 锁判定
 * 在 Repository 层)。
 *
 * 字段约束: role 写非 enum.name 值时 [observeStoredRole] 返回 null (悄默不抛),
 * 因为 enum 改名可能跨 app 升级发生; 错误恢复策略 = 退回到 Unselected, 让用户重选。
 */
@Singleton
class RolePreferencesDataSource @Inject constructor(
    private val dataStore: DataStore<Preferences>,
) {
    val observeStoredRole: Flow<StoredRole?> = dataStore.data.map { prefs ->
        val roleName = prefs[KEY_ROLE] ?: return@map null
        val selectedAt = prefs[KEY_SELECTED_AT] ?: return@map null
        val role = runCatching { AppRole.valueOf(roleName) }.getOrNull() ?: return@map null
        StoredRole(role = role, selectedAtMs = selectedAt)
    }

    suspend fun save(role: AppRole, selectedAtMs: Long) {
        dataStore.edit { prefs ->
            prefs[KEY_ROLE] = role.name
            prefs[KEY_SELECTED_AT] = selectedAtMs
        }
    }

    suspend fun clear() {
        dataStore.edit { prefs ->
            prefs.remove(KEY_ROLE)
            prefs.remove(KEY_SELECTED_AT)
        }
    }

    data class StoredRole(
        val role: AppRole,
        val selectedAtMs: Long,
    )

    companion object {
        // 字段名不可改 (会破坏 DataStore-on-disk 兼容性)。
        internal val KEY_ROLE = stringPreferencesKey("local_role")
        internal val KEY_SELECTED_AT = longPreferencesKey("local_role_selected_at_ms")
    }
}
