package com.chainlesschain.android.presentation.aistudy

/**
 * 错题本 RAG 检索 (纯逻辑)。
 *
 * 给定用户当前提问 + 学习档案，从错题本里选出最相关的 K 条注入学习 prompt 上下文，
 * 实现"学习 tab RAG（错题本）"。端侧、零依赖、可单测。
 *
 * 排序信号 (从强到弱)：
 *  1. 学科匹配 (硬过滤：只在当前学科内检索)
 *  2. 知识点 / 题面 与提问的 token 重叠度
 *  3. 复习次数越少越优先 (间隔重复：薄弱项先复习)
 *  4. 越新的错题略优先
 */
object MistakeRetriever {

    private const val DEFAULT_TOP_K = 3

    /**
     * @param query 用户当前提问
     * @param profile 学习档案 (用 subject 做硬过滤)
     * @param all 错题本全量快照
     * @return 相关度从高到低、至多 [topK] 条；query 与档案均无信号时返回空。
     */
    fun retrieve(
        query: String,
        profile: StudyProfile,
        all: List<MistakeEntry>,
        topK: Int = DEFAULT_TOP_K,
    ): List<MistakeEntry> {
        if (all.isEmpty() || topK <= 0) return emptyList()
        val queryTokens = tokenize(query)

        val sameSubject = all.filter { it.subject == profile.subject }
        if (sameSubject.isEmpty()) return emptyList()

        val scored = sameSubject.map { entry -> entry to score(entry, queryTokens) }
        // 提问无可匹配 token 时不硬塞无关错题，避免污染 prompt。
        val relevant = scored.filter { it.second > 0.0 }
        if (relevant.isEmpty()) return emptyList()

        return relevant
            .sortedWith(
                compareByDescending<Pair<MistakeEntry, Double>> { it.second }
                    .thenBy { it.first.reviewCount }
                    .thenByDescending { it.first.createdAt },
            )
            .take(topK)
            .map { it.first }
    }

    /**
     * 把检索到的错题渲染成可注入 system prompt 的上下文块。空列表返回空串。
     */
    fun renderContext(entries: List<MistakeEntry>): String {
        if (entries.isEmpty()) return ""
        val lines = entries.mapIndexed { i, e ->
            "${i + 1}. [${e.knowledgeNode}] 题目：${e.question}；ta 之前的错误：${e.wrongAnswer}；正确：${e.correctAnswer}"
        }
        return buildString {
            append("【该同学的相关错题，请结合这些薄弱点讲解，但不要直接照抄答案】\n")
            append(lines.joinToString("\n"))
        }
    }

    private fun score(entry: MistakeEntry, queryTokens: Set<String>): Double {
        if (queryTokens.isEmpty()) return 0.0
        val nodeTokens = tokenize(entry.knowledgeNode)
        val questionTokens = tokenize(entry.question)
        // 知识点命中权重高于题面命中。
        val nodeHits = nodeTokens.count { it in queryTokens }
        val questionHits = questionTokens.count { it in queryTokens }
        return nodeHits * 2.0 + questionHits * 1.0
    }

    /**
     * 极简中文友好分词：抽连续的 字母/数字 串，并把 CJK 文本切成 2-gram。
     * 不追求语言学正确，只为 token 重叠打分够用。
     */
    private fun tokenize(text: String): Set<String> {
        if (text.isBlank()) return emptySet()
        val lower = text.lowercase()
        val tokens = LinkedHashSet<String>()

        // 1) 字母数字串
        Regex("[a-z0-9]+").findAll(lower).forEach { tokens += it.value }

        // 2) CJK 2-gram (相邻两汉字)
        val cjk = lower.filter { it.code in 0x4E00..0x9FFF }
        for (i in 0 until cjk.length - 1) {
            tokens += cjk.substring(i, i + 2)
        }
        // 单字也保留 (短词如 "氧" "酸")
        cjk.forEach { tokens += it.toString() }

        return tokens
    }
}
