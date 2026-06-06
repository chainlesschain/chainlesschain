package com.chainlesschain.android.presentation.aistudy

/**
 * AI 陪学 system-prompt 模板 + 学段/学科枚举 (M6 AI Tutor MVP)。
 *
 * 主文档 docs/design/AI陪学_主文档.md §3.6：双轨 system prompt 按 (学段, 学科) 派生；
 * 陪伴 tab 内置未成年护栏 (第 1 层 prompt 自约束；第 2 层 post-hoc 分类器留后续)。
 *
 * 纯 Kotlin、无依赖 —— 可直接单测 (AiStudyPromptsTest)。
 */

/** 学段 (主文档 §3.6 v0.2)。P=小学 / M=初中 / H=高中。 */
enum class GradeLevel(val code: String, val label: String, val band: String) {
    P1("P1", "小学一年级", "小学"),
    P2("P2", "小学二年级", "小学"),
    P3("P3", "小学三年级", "小学"),
    P4("P4", "小学四年级", "小学"),
    P5("P5", "小学五年级", "小学"),
    P6("P6", "小学六年级", "小学"),
    M1("M1", "初中一年级", "初中"),
    M2("M2", "初中二年级", "初中"),
    M3("M3", "初中三年级", "初中"),
    H1("H1", "高中一年级", "高中"),
    H2("H2", "高中二年级", "高中"),
    H3("H3", "高中三年级", "高中"),
}

/** 学科 (主文档 §3.6 v0.2，13 个)。 */
enum class Subject(val code: String, val label: String) {
    CHINESE("chinese", "语文"),
    MATH("math", "数学"),
    ENGLISH("english", "英语"),
    IDEOLOGY("ideology", "道法"),
    SCIENCE("science", "科学"),
    PE("pe", "体育"),
    PHYSICS("physics", "物理"),
    CHEMISTRY("chemistry", "化学"),
    BIOLOGY("biology", "生物"),
    HISTORY("history", "历史"),
    GEOGRAPHY("geography", "地理"),
    POLITICS("politics", "政治"),
    ICT("ict", "信息技术"),
}

/**
 * 孩子学习档案。grade/subject/nickname 都是"设置"性质 (非私密聊天)，可落盘。
 */
data class StudyProfile(
    val grade: GradeLevel = GradeLevel.P4,
    val subject: Subject = Subject.MATH,
    val nickname: String = "同学",
)

object AiStudyPrompts {

    /**
     * 学习 tab：按 (学段, 学科) 派生的辅导老师 prompt。
     * 含"作业模式引导"约束 (主文档 §3.6：拍照多题 → 引导思考而非直接给答案)。
     */
    fun learningSystemPrompt(profile: StudyProfile): String {
        val name = profile.nickname.ifBlank { "同学" }
        return """
            你是 $name 的 ${profile.grade.band}${profile.grade.label} ${profile.subject.label} 辅导老师。任务：
            - 温暖、平等、鼓励的语气，针对 ${profile.grade.band}学生的认知水平讲解，不要超纲。
            - 作业模式：如果像是在做作业（多道选择/计算/作文题、或拍照题目），不要直接给完整答案，
              先引导 $name 自己思考——拆解步骤、给提示、反问，让 ta 自己得出结论。
            - 讲完一个知识点后，出 1 道同类小题检验是否真懂。
            - 用中文回答，公式/步骤分行清晰。
        """.trimIndent()
    }

    /**
     * 学习 tab：在基础 prompt 后追加错题本 RAG 上下文块 (主文档 §3.6 学习 tab RAG)。
     * [retrievedContext] 为空时等价于 [learningSystemPrompt]。
     */
    fun learningSystemPrompt(profile: StudyProfile, retrievedContext: String): String {
        val base = learningSystemPrompt(profile)
        return if (retrievedContext.isBlank()) base else "$base\n\n$retrievedContext"
    }

    /**
     * 学习 tab + M5 任务联动 (主文档 §3.5/§3.6 AI 防作弊)。
     * 有进行中任务时，在 RAG prompt 后追加**强制引导模式**块：不给答案、只给思路。
     * [activeTask] 为 null 时等价于上面的两参重载。
     */
    fun learningSystemPrompt(
        profile: StudyProfile,
        retrievedContext: String,
        activeTask: StudyTask?,
    ): String {
        val base = learningSystemPrompt(profile, retrievedContext)
        if (activeTask == null) return base
        return "$base\n\n${guidedModeBlock(profile.nickname.ifBlank { "同学" }, activeTask)}"
    }

    private fun guidedModeBlock(name: String, task: StudyTask): String = """
        【任务进行中：${task.title}】$name 正在完成这项作业，对本任务的任何提问一律走「引导模式」：
        - 绝不直接给出最终答案 / 完整解题过程 / 作文成稿。
        - 只拆解思路、给提示、反问，引导 $name 自己写出答案。
        - 若 ta 反复索要答案，温和坚持引导，并提醒「自己想出来才学得会」。
    """.trimIndent()

    /**
     * 防作弊启发式 (纯文本，v0.1)：用户是否在直接索要答案/成稿。
     * 仅用于给任务 AI 调用 log 标 [AiCallKind]，供家长 review。
     */
    fun looksLikeAnswerSeeking(text: String): Boolean {
        if (text.isBlank()) return false
        val t = text.lowercase()
        return ANSWER_SEEKING_KEYWORDS.any { t.contains(it) }
    }

    private val ANSWER_SEEKING_KEYWORDS = listOf(
        "直接给答案", "直接告诉我答案", "答案是什么", "给我答案", "把答案",
        "帮我写完", "帮我写一篇", "替我写", "抄答案", "完整答案", "标准答案",
    )

    /**
     * 作业模式启发式 (v0.1，纯文本侧近似)。设计中完整判定需"拍照 + 多题"，端侧无图时
     * 用文本信号近似：出现"第N题/多个题号/多个问号/作业/练习"等。仅用于统计引导模式次数。
     */
    fun looksLikeHomework(text: String): Boolean {
        if (text.isBlank()) return false
        val t = text.lowercase()
        if (HOMEWORK_KEYWORDS.any { t.contains(it) }) return true
        // 多个题号 (1. 2. / (1)(2) / ①②) 或多个问号 → 像一组题
        val numbered = Regex("[(（]?\\d+[)）.、]").findAll(t).count()
        val questionMarks = t.count { it == '?' || it == '？' }
        return numbered >= 2 || questionMarks >= 2
    }

    private val HOMEWORK_KEYWORDS = listOf("作业", "练习题", "第几题", "这道题", "这几题", "做题")

    /**
     * 陪伴 tab：成长伙伴 + 未成年护栏 (主文档 §3.6 护栏模板，第 1 层 prompt 内置)。
     */
    fun companionSystemPrompt(nickname: String): String {
        val name = nickname.ifBlank { "同学" }
        return """
            你是 $name 的 AI 成长伙伴。任务：
            - 温暖、平等的语气，像朋友一样倾听，不说教。
            - 出现以下信号必须立刻温柔劝阻并提示找信任的成年人（家长 / 老师 / 心理老师）：
              · 自伤 / 自杀念头
              · 网络霸凌 / 性侵 / 家暴
              · 陌生人见面邀约
              · 涉黄 / 涉赌 / 涉毒
            - 不讨论：成人内容 / 暴力技巧 / 极端政治 / 极端宗教。
            - 不评价家长 / 老师 / 同学的人品。
            - 鼓励兴趣，但不过度推销课外班。
            - 若察觉 $name 持续低落，建议 ta 告诉家长或学校心理老师。
            - 用中文回答，简短、有温度。
        """.trimIndent()
    }
}
