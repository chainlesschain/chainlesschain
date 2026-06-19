package com.chainlesschain.android.feature.familyguard.data.repository

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import com.chainlesschain.android.feature.familyguard.data.preferences.selectedChildDataStore
import com.chainlesschain.android.feature.familyguard.domain.repository.SelectedChildStore
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

/**
 * [SelectedChildStore] 的 DataStore 实装 (多孩子选择, FAMILY-67 Phase 2)。
 *
 * 薄持久层；空 DID 视为清除。镜像 RolePreferencesDataSource 取向 (datastore-preferences
 * atomic write + 二进制编码)。
 */
@Singleton
class DataStoreSelectedChildStore @Inject constructor(
    @ApplicationContext private val context: Context,
) : SelectedChildStore {

    override fun observeSelectedChildDid(): Flow<String?> =
        context.selectedChildDataStore.data.map { prefs -> prefs[KEY_SELECTED_CHILD]?.takeIf { it.isNotBlank() } }

    override suspend fun setSelectedChild(childDid: String) {
        context.selectedChildDataStore.edit { prefs ->
            if (childDid.isBlank()) prefs.remove(KEY_SELECTED_CHILD) else prefs[KEY_SELECTED_CHILD] = childDid
        }
    }

    override suspend fun clear() {
        context.selectedChildDataStore.edit { prefs -> prefs.remove(KEY_SELECTED_CHILD) }
    }

    private companion object {
        // 字段名不可改 (破坏 DataStore-on-disk 兼容性)。
        val KEY_SELECTED_CHILD = stringPreferencesKey("selected_child_did")
    }
}
