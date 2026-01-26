package com.chainlesschain.android.core.database.fts

import androidx.room.Entity
import androidx.room.Fts4

/**
 * 项目文件全文搜索表 (FTS4)
 *
 * 用于快速搜索文件内容
 */
@Fts4(contentEntity = com.chainlesschain.android.core.database.entity.ProjectFileEntity::class)
@Entity(tableName = "project_files_fts")
data class ProjectFileFts(
    /**
     * 文件名
     */
    val name: String,

    /**
     * 文件路径
     */
    val path: String,

    /**
     * 文件内容
     */
    val content: String?,

    /**
     * 文件扩展名
     */
    val extension: String?
)
