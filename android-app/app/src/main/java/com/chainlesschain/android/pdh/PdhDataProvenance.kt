package com.chainlesschain.android.pdh

/**
 * §3.5.11 不可信数据视觉隔离(纯逻辑核)—— module 101 Phase 2。
 *
 * 工具返回的内容是**被读取的数据**(私信 / 网页 / 文件正文 / vault 行),不是
 * AI 的判断。把它配对到调用它的工具,推出**来源归属** + 是否**不可信**(外部
 * 内容),供 UI 用独立「数据引用」容器渲染——让 prompt injection 文案即便混进来
 * 也显形为带来源徽章的数据,不冒充系统话术(§7.2 的 UI 半边)。
 *
 * 配对(记住上一个 tool_use)是有状态的,放在 ViewModel;本对象只做无状态的
 * 工具名→来源映射,**纯函数、可单测**。
 */
object PdhDataProvenance {

    /** 一段工具数据的来源归属。 */
    data class Provenance(val label: String, val untrusted: Boolean)

    /**
     * 工具名(可含 `mcp__pdh__` 前缀)→ 来源标签 + 是否不可信。
     * 采集/打捞/文件/系统/vault 类返回的是"数据"(untrusted=true);ping/列表等
     * 控制类不是数据内容(untrusted=false,但仍以 DATA 行渲染、不当 AI 话术)。
     */
    fun sourceOf(toolName: String?): Provenance {
        val t = (toolName ?: "").lowercase()
        return when {
            t.contains("collect_app_data") -> Provenance("App 采集", true)
            t.contains("salvage") -> Provenance("取证打捞", true)
            t.contains("collect_files") || t.contains("read_file") -> Provenance("文件", true)
            t.contains("collect_system_data") -> Provenance("系统数据", true)
            t.contains("query_vault") ||
                t.contains("search") ||
                t.contains("run_analysis") ||
                t.contains("event_detail") ||
                t.contains("data_overview") -> Provenance("你的 vault", true)
            t.isEmpty() -> Provenance("工具结果", false)
            else -> Provenance("工具结果", false)
        }
    }
}
