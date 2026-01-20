package com.chainlesschain.android.feature.project.model

/**
 * AI思考的各个阶段
 * 用于可视化显示AI的思考过程
 */
enum class ThinkingStage {
    /**
     * 理解问题阶段
     */
    UNDERSTANDING,

    /**
     * 分析上下文阶段
     */
    ANALYZING,

    /**
     * 规划回答阶段
     */
    PLANNING,

    /**
     * 生成内容阶段
     */
    GENERATING;

    /**
     * 获取显示名称
     */
    fun getDisplayName(): String = when (this) {
        UNDERSTANDING -> "理解问题"
        ANALYZING -> "分析上下文"
        PLANNING -> "规划回答"
        GENERATING -> "生成内容"
    }

    /**
     * 获取简短描述
     */
    fun getShortDescription(): String = when (this) {
        UNDERSTANDING -> "正在理解您的问题..."
        ANALYZING -> "正在分析项目上下文..."
        PLANNING -> "正在规划回答内容..."
        GENERATING -> "正在生成回答..."
    }

    companion object {
        /**
         * 获取所有阶段的有序列表
         */
        fun getAllStages(): List<ThinkingStage> = listOf(
            UNDERSTANDING,
            ANALYZING,
            PLANNING,
            GENERATING
        )

        /**
         * 根据响应进度估算当前阶段
         */
        fun estimateStageFromProgress(hasStartedStreaming: Boolean, tokenCount: Int): ThinkingStage {
            return when {
                !hasStartedStreaming && tokenCount == 0 -> UNDERSTANDING
                !hasStartedStreaming -> ANALYZING
                tokenCount < 50 -> PLANNING
                else -> GENERATING
            }
        }
    }
}
