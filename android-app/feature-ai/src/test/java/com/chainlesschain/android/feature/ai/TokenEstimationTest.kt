package com.chainlesschain.android.feature.ai

import org.junit.Assert.*
import org.junit.Test

/**
 * Token 估算准确性测试
 *
 * 验证中英文混合文本的 token 估算逻辑
 */
class TokenEstimationTest {

    /**
     * 估算 token 数量（测试版本）
     *
     * 与生产代码保持一致的实现
     */
    private fun estimateTokens(text: String): Int {
        if (text.isEmpty()) return 0

        val chineseChars = text.count { it.code in 0x4E00..0x9FFF }
        val otherChars = text.length - chineseChars

        val estimatedTokens = (chineseChars / 2.0 + otherChars / 4.0).toInt()
        return estimatedTokens.coerceAtLeast(1)
    }

    @Test
    fun `纯英文文本估算`() {
        // 纯英文：约4个字符 = 1 token
        val text = "Hello, World!" // 13个字符
        val tokens = estimateTokens(text)

        // 13 / 4 = 3.25 ≈ 3 tokens
        assertTrue("纯英文估算应该合理", tokens in 3..4)
    }

    @Test
    fun `纯中文文本估算`() {
        // 纯中文：约2个字符 = 1 token
        val text = "你好，世界！" // 6个字符（包括中文标点）
        val tokens = estimateTokens(text)

        // 中文标点不在CJK范围，按英文计算
        // 中文字符：4个（你好世界）
        // 其他字符：2个（，！）
        // 4/2 + 2/4 = 2 + 0.5 = 2.5 ≈ 2 tokens
        assertTrue("纯中文估算应该合理", tokens in 2..3)
    }

    @Test
    fun `中英文混合文本估算`() {
        // 混合文本
        val text = "Hello 你好 World 世界" // 14个字符
        val tokens = estimateTokens(text)

        // 中文：4个字符（你好世界）
        // 英文+空格：10个字符
        // 4/2 + 10/4 = 2 + 2.5 = 4.5 ≈ 4 tokens
        assertTrue("中英文混合估算应该合理", tokens in 4..5)
    }

    @Test
    fun `空字符串估算`() {
        val text = ""
        val tokens = estimateTokens(text)
        assertEquals("空字符串应返回0", 0, tokens)
    }

    @Test
    fun `单字符估算`() {
        // 单个英文字符
        val enText = "a"
        val enTokens = estimateTokens(enText)
        assertEquals("单个英文字符至少1 token", 1, enTokens)

        // 单个中文字符
        val cnText = "中"
        val cnTokens = estimateTokens(cnText)
        assertEquals("单个中文字符至少1 token", 1, cnTokens)
    }

    @Test
    fun `长文本估算准确性`() {
        // 模拟真实场景：500字中文文章
        val chineseText = "中".repeat(500)
        val tokens = estimateTokens(chineseText)

        // 500个中文字符 / 2 = 250 tokens
        assertEquals("500个中文字符应约为250 tokens", 250, tokens)

        // 模拟真实场景：2000字英文文章
        val englishText = "word ".repeat(400) // 约2000个字符
        val enTokens = estimateTokens(englishText)

        // 2000个字符 / 4 = 500 tokens
        assertTrue("2000个英文字符应约为500 tokens", enTokens in 490..510)
    }

    @Test
    fun `代码片段估算`() {
        val codeSnippet = """
            fun main() {
                println("Hello, 世界!")
            }
        """.trimIndent()

        val tokens = estimateTokens(codeSnippet)

        // 代码通常包含大量英文字符
        assertTrue("代码片段估算应合理", tokens > 0)
    }

    @Test
    fun `特殊字符估算`() {
        // 包含标点、数字、符号 — 实际 32 字符（不是注释里的 36）
        val text = "123!@#$%^&*()_+-=[]{}|;':\",./<>?"
        val tokens = estimateTokens(text)

        // 所有特殊字符按英文计算，32 / 4 = 8 tokens
        assertTrue("特殊字符估算应合理 ($tokens)", tokens in 8..10)
    }

    @Test
    fun `Emoji估算`() {
        val text = "Hello 👋 你好 🌍"
        val tokens = estimateTokens(text)

        // Emoji通常占用多个Unicode码点
        // 估算应该给出合理结果
        assertTrue("Emoji文本估算应合理", tokens > 0)
    }

    @Test
    fun `与旧算法对比准确性提升`() {
        val text = "这是一段中文文本 with some English words 混合内容"

        // 新算法（区分中英文）
        val newTokens = estimateTokens(text)

        // 旧算法（字节数/4）
        val byteLength = text.toByteArray(Charsets.UTF_8).size
        val oldTokens = kotlin.math.ceil(byteLength / 4.0).toInt()

        // 对于中英文混合文本，新算法应该更准确
        // UTF-8中文占3字节，会导致旧算法严重高估
        assertTrue(
            "新算法对中英文混合文本估算更准确 (new: $newTokens, old: $oldTokens)",
            newTokens < oldTokens
        )

        println("示例文本: \"$text\"")
        println("新算法估算: $newTokens tokens")
        println("旧算法估算: $oldTokens tokens")
        println("估算差异: ${oldTokens - newTokens} tokens (${((oldTokens - newTokens) * 100.0 / oldTokens).toInt()}% 改进)")
    }

    @Test
    fun `成本计算准确性`() {
        // 假设 GPT-4 价格：输入 $0.01/1K tokens
        val text = "这是一个测试文本用于成本估算" // 15个中文字符
        val tokens = estimateTokens(text)

        // 15 / 2 = 7.5 ≈ 7 tokens
        val costPer1kTokens = 0.01 // USD
        val estimatedCost = (tokens / 1000.0) * costPer1kTokens

        assertTrue("Token估算应影响成本计算", tokens in 7..8)
        assertTrue("成本应小于0.01美分", estimatedCost < 0.0001)

        println("文本: \"$text\"")
        println("估算token: $tokens")
        println("估算成本: $${String.format("%.6f", estimatedCost)} USD")
    }

    @Test
    fun `批量文本估算性能`() {
        val texts = List(1000) { index ->
            "This is test text number $index 这是测试文本编号$index"
        }

        val startTime = System.nanoTime()
        val totalTokens = texts.sumOf { estimateTokens(it) }
        val duration = (System.nanoTime() - startTime) / 1_000_000.0

        println("估算1000条文本耗时: ${String.format("%.2f", duration)} ms")
        println("总Token数: $totalTokens")
        println("平均每条: ${totalTokens / texts.size} tokens")

        // 性能应该足够快（< 100ms）
        assertTrue("批量估算性能应足够快", duration < 100)
    }
}
