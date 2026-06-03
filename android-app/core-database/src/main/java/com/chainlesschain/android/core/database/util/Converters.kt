package com.chainlesschain.android.core.database.util

import androidx.room.TypeConverter
import com.chainlesschain.android.core.database.entity.FileCategory
import com.chainlesschain.android.core.database.entity.ImportType
import com.chainlesschain.android.core.database.entity.ImportSource
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

/**
 * Room类型转换器
 *
 * 用于将复杂类型存储到数据库
 */
class Converters {

    private val json = Json { ignoreUnknownKeys = true }

    /**
     * List<String> <-> String (JSON)
     */
    @TypeConverter
    fun fromStringList(value: List<String>?): String? {
        return value?.let { json.encodeToString(it) }
    }

    @TypeConverter
    fun toStringList(value: String?): List<String>? {
        return value?.let {
            try { json.decodeFromString(it) } catch (_: Exception) { emptyList() }
        }
    }

    /**
     * Map<String, String> <-> String (JSON)
     */
    @TypeConverter
    fun fromStringMap(value: Map<String, String>?): String? {
        return value?.let { json.encodeToString(it) }
    }

    @TypeConverter
    fun toStringMap(value: String?): Map<String, String>? {
        return value?.let {
            try { json.decodeFromString(it) } catch (_: Exception) { emptyMap() }
        }
    }

    /**
     * FileCategory <-> String
     */
    @TypeConverter
    fun fromFileCategory(value: FileCategory): String {
        return value.name
    }

    @TypeConverter
    fun toFileCategory(value: String): FileCategory {
        return try {
            FileCategory.valueOf(value)
        } catch (e: IllegalArgumentException) {
            FileCategory.OTHER
        }
    }

    /**
     * ImportType <-> String
     */
    @TypeConverter
    fun fromImportType(value: ImportType): String {
        return value.name
    }

    @TypeConverter
    fun toImportType(value: String): ImportType {
        return try {
            ImportType.valueOf(value)
        } catch (e: IllegalArgumentException) {
            ImportType.COPY
        }
    }

    /**
     * ImportSource <-> String
     */
    @TypeConverter
    fun fromImportSource(value: ImportSource): String {
        return value.name
    }

    @TypeConverter
    fun toImportSource(value: String): ImportSource {
        return try {
            ImportSource.valueOf(value)
        } catch (e: IllegalArgumentException) {
            ImportSource.FILE_BROWSER
        }
    }
}
