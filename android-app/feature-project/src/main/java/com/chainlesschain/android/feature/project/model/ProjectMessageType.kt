package com.chainlesschain.android.feature.project.model

/**
 * 项目聊天消息类型
 * 对应PC端的多种消息类型
 */
enum class ProjectMessageType {
    /**
     * 普通对话消息
     */
    NORMAL,

    /**
     * 系统消息（如连接状态、错误提示）
     */
    SYSTEM,

    /**
     * 任务计划消息（包含步骤列表）
     */
    TASK_PLAN,

    /**
     * 任务分析消息（AI对任务的理解）
     */
    TASK_ANALYSIS,

    /**
     * 意图确认消息（AI请求确认用户意图）
     */
    INTENT_CONFIRM,

    /**
     * 创建消息（文件/项目创建相关）
     */
    CREATION,

    /**
     * 代码块消息（纯代码内容）
     */
    CODE_BLOCK,

    /**
     * 文件引用消息（显示@引用的文件内容）
     */
    FILE_REFERENCE,

    /**
     * 执行结果消息（任务执行结果）
     */
    EXECUTION_RESULT;

    companion object {
        /**
         * 从字符串解析类型
         */
        fun fromString(value: String?): ProjectMessageType {
            return when (value?.uppercase()) {
                "NORMAL" -> NORMAL
                "SYSTEM" -> SYSTEM
                "TASK_PLAN" -> TASK_PLAN
                "TASK_ANALYSIS" -> TASK_ANALYSIS
                "INTENT_CONFIRM" -> INTENT_CONFIRM
                "CREATION" -> CREATION
                "CODE_BLOCK" -> CODE_BLOCK
                "FILE_REFERENCE" -> FILE_REFERENCE
                "EXECUTION_RESULT" -> EXECUTION_RESULT
                else -> NORMAL
            }
        }
    }
}
