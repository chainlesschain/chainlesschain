package com.chainlesschain.android.feature.project.model

/**
 * AI聊天的上下文模式
 * 对应PC端的三种上下文模式
 */
enum class ChatContextMode {
    /**
     * 项目模式 - 包含项目整体结构和所有文件列表
     */
    PROJECT,

    /**
     * 文件模式 - 包含当前选中文件的完整内容
     */
    FILE,

    /**
     * 全局模式 - 无特定上下文，通用AI助手
     */
    GLOBAL;

    /**
     * 获取显示名称
     */
    fun getDisplayName(): String = when (this) {
        PROJECT -> "项目"
        FILE -> "文件"
        GLOBAL -> "全局"
    }

    /**
     * 获取描述
     */
    fun getDescription(): String = when (this) {
        PROJECT -> "AI了解整个项目结构"
        FILE -> "AI专注于当前文件"
        GLOBAL -> "通用AI助手模式"
    }

    /**
     * 获取图标资源名称
     */
    fun getIconName(): String = when (this) {
        PROJECT -> "folder"
        FILE -> "file"
        GLOBAL -> "globe"
    }
}
