package com.chainlesschain.android.remote.registry

import kotlinx.serialization.Serializable

/**
 * 远程 skill 元数据（设计文档 v0.2 §5.4 + M1 Android_REMOTE_commands_inventory）。
 *
 * 当前粒度：**file + method 双级**。
 *  - file 级：23 entries 对应 23 个 XCommands.kt（namespace / displayName / methodCount 等）
 *  - method 级：可选 [methods] 列表，由 SeedRegistry 提供部分高频 namespace 的初始值；
 *    其余通过 [RemoteSkillRegistry.updateFromRemote] 从桌面侧 mobile-skill-whitelist
 *    动态下发合并。
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

    /**
     * 方法级元数据（M4 D1）。可选；空 = 仅 file-level 数据，调用方按 namespace 默认值。
     *
     * SeedRegistry 当前为 knowledge.* / ai.* 提供 method 种子；其它 21 个 namespace
     * 等桌面 mobile-skill-whitelist 通过 updateFromRemote 下发。
     */
    val methods: List<MethodMetadata> = emptyList(),

    /**
     * 旧 namespace 名兼容窗口（M4 §8.3）。当 RemoteSkillRegistry 收到查询 alias 时，
     * 自动 resolve 到本 [namespace]。1 版兼容窗口后移除 alias，让调用方迁移到新 namespace。
     *
     * 示例：把 "browser.extension" 改名为 "extension" 时，旧 alias 留一版，让在飞的
     * 桌面端调用不会立刻 fail。
     */
    val aliases: List<String> = emptyList(),
) {
    init {
        require(namespace.isNotBlank()) { "namespace must not be blank" }
        require(displayName.isNotBlank()) { "displayName must not be blank" }
        require(methodCount > 0) { "methodCount must be positive, got $methodCount" }
        require(transport in VALID_TRANSPORTS) {
            "transport must be one of $VALID_TRANSPORTS, got $transport"
        }
        require(methods.size <= methodCount) {
            "methods list ($methods.size) must not exceed methodCount ($methodCount)"
        }
        val dupes = methods.groupBy { it.name }.filter { it.value.size > 1 }.keys
        require(dupes.isEmpty()) {
            "method names must be unique within namespace, duplicates: $dupes"
        }
        require(aliases.none { it == namespace }) {
            "alias must not equal namespace itself: $namespace"
        }
        require(aliases.none { it.isBlank() }) {
            "aliases must not contain blank entries: $aliases"
        }
    }

    companion object {
        val VALID_TRANSPORTS = setOf("handler-rpc", "extension-ws")
    }
}

/**
 * 方法级元数据（M4 D1）。
 *
 * 与 [SkillMetadata] 字段对应关系：
 *  - method-level [risk] / [requiresApproval] 默认 null = 走 SkillMetadata 的 namespace 级；
 *    非 null 时覆盖（用于"AI 大部分 mutating，但 ai.deleteConversation 标 Privileged"类细分）
 *
 * 参数信息保持 lightweight：仅记录 [paramCount] 和可选简短 [paramSummary]，不存类型签名 —
 * 后者太重且容易过时；UI 需要时直接看 Android 源码。
 */
@Serializable
data class MethodMetadata(
    /** 方法名，如 "chat" / "createNote" / "ocrImage"。namespace 内唯一。 */
    val name: String,

    /** 一句话描述，从 KDoc 第一行取。 */
    val description: String,

    /** 参数数量（含必填+可选+default）；仅展示用。 */
    val paramCount: Int,

    /** 可选简短参数清单文字版，如 "title, content, folderId?, tags?"。 */
    val paramSummary: String? = null,

    /** 返回类型 hint，去 wrapper：直接写 "ChatResponse"、"List<Note>"，省略 Result<...>. */
    val returnTypeHint: String? = null,

    /**
     * 风险覆盖。null 时继承 namespace 级 risk；
     * 设置时优先于 namespace（如 ai.* 整体 Mutating，但 ai.deleteConversation override Privileged）
     */
    val riskOverride: SkillRiskTag? = null,

    /**
     * 审批覆盖。null 时按 [riskOverride] 或 namespace 推导；
     * 设置时直接生效（如某个 Safe 方法因审计要求强制审批）。
     */
    val requiresApprovalOverride: Boolean? = null,
) {
    init {
        require(name.isNotBlank()) { "method name must not be blank" }
        require(paramCount >= 0) { "paramCount must be non-negative, got $paramCount" }
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
