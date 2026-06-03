package com.chainlesschain.android.feature.familyguard.data.preferences

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.preferencesDataStore

/**
 * DataStore 实例 (FAMILY-04).
 *
 * 顶级文件名 [DATA_STORE_NAME]; 与 :app 的其他 DataStore 命名空间隔离避免冲突。
 * EncryptedSharedPreferences 在这里 overkill — 角色字段不含 PII (家长/孩子选择),
 * 且 datastore-preferences 已用 atomic write + 二进制 proto 编码避免明文易读。
 *
 * 由 [com.chainlesschain.android.feature.familyguard.di.FamilyGuardModule]
 * 通过 [appRoleDataStore] 扩展取值, 注入 [RolePreferencesDataSource]。
 */
internal const val DATA_STORE_NAME = "family_guard_role_prefs"

internal val Context.appRoleDataStore: DataStore<Preferences> by preferencesDataStore(
    name = DATA_STORE_NAME,
)
