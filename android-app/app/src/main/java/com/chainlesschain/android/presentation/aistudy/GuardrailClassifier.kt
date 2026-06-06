package com.chainlesschain.android.presentation.aistudy

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 未成年护栏风险类别 (主文档 §3.6 护栏模板)。
 */
enum class RiskCategory(val label: String) {
    SELF_HARM("自伤/自杀"),
    BULLYING("霸凌/暴力侵害"),
    STRANGER_MEETUP("陌生人见面邀约"),
    ILLICIT("涉黄/涉赌/涉毒"),
}

/**
 * 一次护栏命中。**只含类别 + 时间，绝不含原文** —— 这是 §3.6 第 2 层护栏的隐私契约：
 * 上报家长的是"事件类型 + 时间"而非聊天内容 (陪伴 tab 内容对家长永远黑盒)。
 */
data class GuardrailFinding(
    val category: RiskCategory,
    val tab: AiStudyTab,
    val timestamp: Long,
)

/**
 * §3.6 护栏第 2 层：post-hoc 端侧分类器。
 *
 * 第 1 层是 system prompt 自约束 (见 [AiStudyPrompts])；第 2 层在**用户输入**侧
 * 独立做端侧规则检测，命中即记一条 [GuardrailFinding]。纯端侧、纯逻辑、可单测，
 * 不依赖 LLM —— 即使模型被越狱/绕过，这一层仍会捕获并记事件类型。
 *
 * 接口化以便 ViewModel 注入 fake，也便于后续替换为更强的端侧小模型。
 */
interface GuardrailClassifier {
    /** 对一段用户文本分类；返回命中的类别 (可能多类)，无命中返回空。 */
    fun classify(text: String): Set<RiskCategory>
}

/**
 * 关键词/规则版分类器 (v0.1)。中文场景下关键词命中率高、零依赖、可解释。
 *
 * 注意：这是**保守**检测 —— 宁可漏报也别误伤正常聊天的体验，真正的兜底是 prompt 第 1 层。
 * 命中只用于给家长一个"事件类型 + 时间"信号，不阻断对话、不上报内容。
 */
@Singleton
class KeywordGuardrailClassifier @Inject constructor() : GuardrailClassifier {

    override fun classify(text: String): Set<RiskCategory> {
        if (text.isBlank()) return emptySet()
        val t = text.lowercase()
        val hits = LinkedHashSet<RiskCategory>()
        for ((category, keywords) in RULES) {
            if (keywords.any { t.contains(it) }) hits += category
        }
        return hits
    }

    private companion object {
        // 关键词均为小写匹配。覆盖常见直白表达，刻意保守。
        val RULES: Map<RiskCategory, List<String>> = mapOf(
            RiskCategory.SELF_HARM to listOf(
                "自杀", "不想活", "活不下去", "想死", "结束生命", "割腕", "跳楼", "轻生",
            ),
            RiskCategory.BULLYING to listOf(
                "被打", "被欺负", "霸凌", "校园暴力", "被孤立", "性侵", "猥亵", "家暴", "被威胁",
            ),
            RiskCategory.STRANGER_MEETUP to listOf(
                "网友约我", "陌生人约", "约我见面", "私下见面", "线下见面", "约我出去玩",
            ),
            RiskCategory.ILLICIT to listOf(
                "黄赌毒", "赌博", "下注", "色情", "毒品", "吸毒", "约炮",
            ),
        )
    }
}

/**
 * 护栏命中事件的落点。**只存类别 + 时间**，与 [GuardrailFinding] 的隐私契约一致。
 *
 * v0.1 内存态 (退出即清)；后续可换成写入主 vault 的 anomaly 表 + 推家长。
 * 接口化以便 ViewModel 单测断言。
 */
interface GuardrailEventSink {
    val findings: StateFlow<List<GuardrailFinding>>
    fun record(finding: GuardrailFinding)
}

@Singleton
class InMemoryGuardrailEventSink @Inject constructor() : GuardrailEventSink {
    private val _findings = MutableStateFlow<List<GuardrailFinding>>(emptyList())
    override val findings: StateFlow<List<GuardrailFinding>> = _findings.asStateFlow()

    override fun record(finding: GuardrailFinding) {
        _findings.update { it + finding }
    }
}
