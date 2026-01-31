package com.chainlesschain.android.remote.data

import androidx.room.Entity
import androidx.room.PrimaryKey
import androidx.room.TypeConverter
import androidx.room.TypeConverters
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken

/**
 * 命令历史实体
 */
@Entity(tableName = "command_history")
@TypeConverters(Converters::class)
data class CommandHistoryEntity(
    @PrimaryKey(autoGenerate = true)
    val id: Long = 0,

    // 命令信息
    val namespace: String,          // ai, system, etc.
    val action: String,             // chat, screenshot, etc.
    val params: Map<String, Any>,   // 命令参数（JSON）

    // 执行结果
    val status: CommandStatus,      // success, failure, pending
    val result: String?,            // 执行结果（JSON）
    val error: String?,             // 错误信息

    // 元数据
    val deviceDid: String,          // PC 设备 DID
    val duration: Long = 0,         // 执行时长（ms）
    val timestamp: Long,            // 执行时间戳
    val createdAt: Long = System.currentTimeMillis()
)

/**
 * 命令状态
 */
enum class CommandStatus {
    SUCCESS,
    FAILURE,
    PENDING,
    CANCELLED
}

/**
 * 类型转换器
 */
class Converters {
    private val gson = Gson()

    @TypeConverter
    fun fromMap(value: Map<String, Any>): String {
        return gson.toJson(value)
    }

    @TypeConverter
    fun toMap(value: String): Map<String, Any> {
        val type = object : TypeToken<Map<String, Any>>() {}.type
        return gson.fromJson(value, type)
    }

    @TypeConverter
    fun fromCommandStatus(value: CommandStatus): String {
        return value.name
    }

    @TypeConverter
    fun toCommandStatus(value: String): CommandStatus {
        return CommandStatus.valueOf(value)
    }
}
