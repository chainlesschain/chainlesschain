package com.chainlesschain.android.pdh

/**
 * §3.5.12 对话内联结果视图(纯逻辑核)—— module 101 Phase 2。
 *
 * 区分"可信结构化结果"(skill 算出来的聚合:全貌/时间线/兴趣/消费/关系/命中)与
 * §3.5.11 的"不可信原始数据"(逐字私信/文件/vault 行)。前者以**视图卡**(可信)
 * 渲染,后者以**数据引用容器**(不可信)渲染。
 *
 * 本对象只做无状态的 工具→视图种类 映射,**纯函数、可单测**。完整的逐种类富视图
 * (时间线条带/兴趣 chips/消费条形)+ 跳转完整数据浏览器是 §9 / Phase 6 的事,
 * 本核 + 一张轻量视图卡是 Phase 2 的"前哨半边"。
 */
enum class ViewKind { OVERVIEW, TIMELINE, INTERESTS, SPENDING, RELATIONS, HITS }

object PdhResultView {

    /** 视图种类的中文标签(给视图卡标题)。 */
    fun label(kind: ViewKind): String = when (kind) {
        ViewKind.OVERVIEW -> "数据全貌"
        ViewKind.TIMELINE -> "时间线"
        ViewKind.INTERESTS -> "兴趣"
        ViewKind.SPENDING -> "消费"
        ViewKind.RELATIONS -> "关系"
        ViewKind.HITS -> "查询结果"
    }

    /**
     * 结构化"可信视图"工具 → [ViewKind];不是则 null(→ 走 §3.5.11 不可信 DATA 路径)。
     * 同时看 toolName 与 input —— `run_analysis(skill)` 的 skill 名常在 input 里。
     * 采集/打捞/文件/系统等返回原始内容的工具不在此列(→ DATA)。
     */
    fun viewKindOf(toolName: String?, input: String? = null): ViewKind? {
        val s = ((toolName ?: "") + " " + (input ?: "")).lowercase()
        // 采集/打捞/文件/系统 = 原始数据,绝不当可信视图(即便名字里恰好含关键词)。
        if (s.contains("collect_") || s.contains("salvage") || s.contains("read_file")) return null
        return when {
            s.contains("overview") -> ViewKind.OVERVIEW
            s.contains("timeline") -> ViewKind.TIMELINE
            s.contains("interest") -> ViewKind.INTERESTS
            s.contains("spending") || s.contains("spend") -> ViewKind.SPENDING
            s.contains("relation") || s.contains("footprint") -> ViewKind.RELATIONS
            s.contains("query_vault") || s.contains("event_detail") || s.contains("search") ||
                s.contains("run_analysis") || s.contains("analysis") -> ViewKind.HITS
            else -> null
        }
    }
}
