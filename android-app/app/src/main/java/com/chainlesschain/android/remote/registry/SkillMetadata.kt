package com.chainlesschain.android.remote.registry

import kotlinx.serialization.Serializable

/**
 * 远程 skill 元数据（设计文档 v0.2 §5.4 + M1 Android_REMOTE_commands_inventory）。
 *
 * 当前粒度：**file 级**（23 entries 对应 23 个 XCommands.kt）。method 级元数据
 * 由 [RemoteSkillRegistry.updateFromRemote] 在桌面侧实施后下发并合并。
 */
@Serializable
data class SkillMetadata(
    /** 命名空间，如 "ai" / "extension" / "system.info"；唯一标识。 */
    val namespace: String,

    /** UI 展示名，如 "AI 对话" / "Chrome 扩展控制"。 */
    val displayName: String,

    /** 一句话描述。 */
    val description: String,

    /**
     * 类别，用于 UI 分组：
     *  - "ai"：LLM / 多模态 / RAG
     *  - "browser"：浏览器自动化 / Chrome 扩展 / 用户浏览器
     *  - "system"：系统操作（电源 / 进程 / 网络 / 显示 / 存储）
     *  - "data"：文件 / 剪贴板 / 知识库 / 历史
     *  - "ui"：通知 / 媒体 / 输入
     *  - "control"：远控桌面 / 应用管理
     *  - "infra"：device pairing / security / workflow
     */
    val category: String,

    /** 风险等级（[SkillRiskTag]）。决定默认是否需 ApprovalUI。 */
    val risk: SkillRiskTag,

    /**
     * 是否强制 ApprovalUI 二次确认。
     * 默认从 [risk] 推导：[SkillRiskTag.Privileged] → true，其余 false。
     */
    val requiresApproval: Boolean = (risk == SkillRiskTag.Privileged),

    /**
     * 传输通道：
     *  - "handler-rpc"：常规 desktop-app-vue/.../remote/handlers/X-handler.js
     *  - "extension-ws"：browser-extension/ 子系统（Chrome 扩展 WebSocket，仅 ExtensionCommands）
     */
    val transport: String = "handler-rpc",

    /** Android 端 XCommands.kt 文件名（仅供调试索引；不参与运行时调度）。 */
    val androidSourceFile: String,

    /** 该文件下 RPC 入口数量（即 suspend fun 数）；仅供 UI 展示。 */
    val methodCount: Int,
) {
    init {
        require(namespace.isNotBlank()) { "namespace must not be blank" }
        require(displayName.isNotBlank()) { "displayName must not be blank" }
        require(methodCount > 0) { "methodCount must be positive, got $methodCount" }
        require(transport in VALID_TRANSPORTS) {
            "transport must be one of $VALID_TRANSPORTS, got $transport"
        }
    }

    companion object {
        val VALID_TRANSPORTS = setOf("handler-rpc", "extension-ws")
    }
}

/**
 * 风险三档（M1 inventory §F5）：
 *  - Safe：只读 / 查询，桌面侧默认放行，仅需 Ed25519 签名
 *  - Mutating：改桌面状态但局部可逆（剪贴板设、文件写、通知触发），默认 opt-in 才放行
 *  - Privileged：高敏 / 不可逆 / 系统级（shutdown / kill / 大额支付），强 ApprovalUI + StrongBox 签名
 */
@Serializable
enum class SkillRiskTag {
    Safe,
    Mutating,
    Privileged;

    fun rank(): Int = when (this) {
        Safe -> 0
        Mutating -> 1
        Privileged -> 2
    }
}
