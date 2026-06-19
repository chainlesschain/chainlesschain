package com.chainlesschain.android.feature.familyguard.data.preferences

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.preferencesDataStore

/**
 * 「当前选中孩子」DataStore 实例 (多孩子选择, FAMILY-67 Phase 2)。
 *
 * 独立命名空间 [SELECTED_CHILD_DATA_STORE_NAME]，与角色/其他 DataStore 隔离 (同
 * [appRoleDataStore] 取向)。仅存一个孩子 DID 字符串，无 PII。
 */
internal const val SELECTED_CHILD_DATA_STORE_NAME = "family_guard_selected_child_prefs"

internal val Context.selectedChildDataStore: DataStore<Preferences> by preferencesDataStore(
    name = SELECTED_CHILD_DATA_STORE_NAME,
)
