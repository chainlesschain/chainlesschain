package com.chainlesschain.android.core.p2p.config

/**
 * P2P 功能开关
 *
 * 用于控制新功能的启用/禁用，支持安全回滚
 * 所有新功能默认关闭，确保向后兼容
 */
object P2PFeatureFlags {

    /**
     * 启用信令消息确认机制
     *
     * 开启后，信令消息将包含 ACK/NACK 机制，
     * 确保消息可靠传递
     */
    @Volatile
    var enableMessageAck = false

    /**
     * 启用分片恢复机制
     *
     * 开启后，支持分片丢失检测和重传请求
     */
    @Volatile
    var enableFragmentRecovery = false

    /**
     * 启用 TURN 服务器回退
     *
     * 开启后，ICE 连接失败时自动切换到 TURN 中继模式
     */
    @Volatile
    var enableTurnFallback = false

    /**
     * 启用连接质量监控
     *
     * 开启后，实时监控连接质量并自适应调整参数
     */
    @Volatile
    var enableQualityMonitor = false

    /**
     * 启用重复分片检测
     *
     * 开启后，检测并丢弃重复的消息分片
     */
    @Volatile
    var enableDuplicateDetection = false

    /**
     * 启用批量 ACK
     *
     * 开启后，ACK 消息将聚合发送以减少网络开销
     */
    @Volatile
    var enableBatchAck = false

    /**
     * 重置所有开关为默认值
     */
    fun resetToDefaults() {
        enableMessageAck = false
        enableFragmentRecovery = false
        enableTurnFallback = false
        enableQualityMonitor = false
        enableDuplicateDetection = false
        enableBatchAck = false
    }

    /**
     * 启用所有实验性功能
     *
     * 仅用于测试环境
     */
    fun enableAllExperimental() {
        enableMessageAck = true
        enableFragmentRecovery = true
        enableTurnFallback = true
        enableQualityMonitor = true
        enableDuplicateDetection = true
        enableBatchAck = true
    }

    /**
     * 获取当前配置摘要
     */
    fun getConfigSummary(): Map<String, Boolean> = mapOf(
        "enableMessageAck" to enableMessageAck,
        "enableFragmentRecovery" to enableFragmentRecovery,
        "enableTurnFallback" to enableTurnFallback,
        "enableQualityMonitor" to enableQualityMonitor,
        "enableDuplicateDetection" to enableDuplicateDetection,
        "enableBatchAck" to enableBatchAck
    )
}
