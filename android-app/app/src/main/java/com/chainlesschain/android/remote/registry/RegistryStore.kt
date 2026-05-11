package com.chainlesschain.android.remote.registry

import android.content.Context
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import timber.log.Timber
import java.io.File
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Registry 持久化到 `filesDir/remote_skill_registry.json`。
 *
 * 设计：
 *  - 启动期从 disk load；如不存在 → 用 [SeedRegistry] 作为 fallback
 *  - [RemoteSkillRegistry.updateFromRemote] 接收桌面下发的新版后调用 [save]
 *  - 解析失败 / 文件损坏时清空磁盘，回到 seed（一次性 best-effort）
 */
@Singleton
class RegistryStore @Inject constructor(
    @ApplicationContext private val context: Context,
) {

    private val json = Json {
        prettyPrint = true
        ignoreUnknownKeys = true
        encodeDefaults = true
    }

    fun load(): List<SkillMetadata> {
        val file = File(context.filesDir, FILE_NAME)
        if (!file.exists()) return emptyList()
        return try {
            val wrapper = json.decodeFromString<StorageWrapper>(file.readText())
            if (wrapper.version != CURRENT_VERSION) {
                Timber.w("Registry version mismatch (stored=%d, expected=%d), discarding",
                    wrapper.version, CURRENT_VERSION)
                file.delete()
                return emptyList()
            }
            wrapper.skills
        } catch (e: Exception) {
            Timber.e(e, "Failed to load registry, clearing")
            file.delete()
            emptyList()
        }
    }

    fun save(skills: List<SkillMetadata>) {
        val wrapper = StorageWrapper(version = CURRENT_VERSION, skills = skills)
        val file = File(context.filesDir, FILE_NAME)
        try {
            file.writeText(json.encodeToString(wrapper))
            Timber.d("Registry saved: %d skills", skills.size)
        } catch (e: Exception) {
            Timber.e(e, "Failed to save registry")
        }
    }

    fun clear() {
        File(context.filesDir, FILE_NAME).delete()
    }

    @Serializable
    private data class StorageWrapper(
        val version: Int,
        val skills: List<SkillMetadata>,
    )

    companion object {
        const val FILE_NAME = "remote_skill_registry.json"
        const val CURRENT_VERSION = 1
    }
}
