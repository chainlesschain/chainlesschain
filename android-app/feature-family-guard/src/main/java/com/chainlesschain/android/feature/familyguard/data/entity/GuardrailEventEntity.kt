package com.chainlesschain.android.feature.familyguard.data.entity

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * M6 第 2 层护栏命中事件 (主文档 §3.6).
 *
 * **隐私契约: 只存类别 + tab + 时间，绝不存聊天原文** —— 上报家长的是
 * "事件类型 + 时间"，陪伴 tab 内容对家长永远黑盒。category / tab 存
 * :app RiskCategory / AiStudyTab 枚举 name。
 */
@Entity(
    tableName = "guardrail_event",
    indices = [
        Index(value = ["timestamp"], name = "idx_guardrail_event_ts"),
    ],
)
data class GuardrailEventEntity(
    @PrimaryKey(autoGenerate = true)
    @ColumnInfo(name = "id")
    val id: Long = 0L,

    @ColumnInfo(name = "category")
    val category: String,

    @ColumnInfo(name = "tab")
    val tab: String,

    @ColumnInfo(name = "timestamp")
    val timestamp: Long,
)
