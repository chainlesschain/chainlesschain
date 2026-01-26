package com.chainlesschain.android.feature.p2p.moderation

import com.chainlesschain.android.core.llm.LLMAdapter
import com.chainlesschain.android.core.llm.Message
import com.chainlesschain.android.core.model.Result
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test

/**
 * ContentModerator 单元测试
 *
 * 测试覆盖：
 * 1. 审核功能测试（7个测试）
 * 2. 批量审核测试（1个测试）
 * 3. JSON解析测试（5个测试）
 * 4. 可用性检查测试（3个测试）
 * 5. 枚举解析测试（3个测试）
 * 6. 参数验证测试（2个测试）
 *
 * 总计：21个测试用例
 */
class ContentModeratorTest {

    private lateinit var llmAdapter: LLMAdapter
    private lateinit var contentModerator: ContentModerator

    @Before
    fun setup() {
        llmAdapter = mockk<LLMAdapter>()
        contentModerator = ContentModerator(llmAdapter)
    }

    // ==================== 审核功能测试 ====================

    @Test
    fun `moderateContent should detect clean content`() = runTest {
        // 模拟LLM返回无违规结果
        val mockResponse = """
            {
              "is_violation": false,
              "violation_categories": [],
              "severity": "NONE",
              "confidence": 0.95,
              "reason": "内容符合社区规范",
              "suggestion": "允许发布"
            }
        """.trimIndent()

        coEvery { llmAdapter.chat(any(), any(), any(), any()) } returns mockResponse

        val cleanContent = "今天天气真好，适合出去散步。"
        val result = contentModerator.moderateContent(cleanContent)

        // 验证结果
        assertTrue(result is Result.Success)
        val moderationResult = (result as Result.Success).data
        assertFalse(moderationResult.isViolation)
        assertEquals(ModerationSeverity.NONE, moderationResult.severity)
        assertTrue(moderationResult.violationCategories.isEmpty())
        assertTrue(moderationResult.confidence > 0.9)
    }

    @Test
    fun `moderateContent should detect sexual content violation`() = runTest {
        val mockResponse = """
            {
              "is_violation": true,
              "violation_categories": ["SEXUAL_CONTENT"],
              "severity": "HIGH",
              "confidence": 0.98,
              "reason": "包含露骨的性描述",
              "suggestion": "立即删除，警告用户"
            }
        """.trimIndent()

        coEvery { llmAdapter.chat(any(), any(), any(), any()) } returns mockResponse

        val sexualContent = "这是一段包含色情内容的文本"
        val result = contentModerator.moderateContent(sexualContent)

        assertTrue(result is Result.Success)
        val moderationResult = (result as Result.Success).data
        assertTrue(moderationResult.isViolation)
        assertEquals(ModerationSeverity.HIGH, moderationResult.severity)
        assertTrue(moderationResult.violationCategories.contains(ViolationCategory.SEXUAL_CONTENT))
        assertTrue(moderationResult.confidence > 0.95)
    }

    @Test
    fun `moderateContent should detect violence violation`() = runTest {
        val mockResponse = """
            {
              "is_violation": true,
              "violation_categories": ["VIOLENCE"],
              "severity": "HIGH",
              "confidence": 0.96,
              "reason": "包含暴力威胁和血腥描述",
              "suggestion": "删除并封禁用户"
            }
        """.trimIndent()

        coEvery { llmAdapter.chat(any(), any(), any(), any()) } returns mockResponse

        val violentContent = "我要杀了你！"
        val result = contentModerator.moderateContent(violentContent)

        assertTrue(result is Result.Success)
        val moderationResult = (result as Result.Success).data
        assertTrue(moderationResult.isViolation)
        assertTrue(moderationResult.violationCategories.contains(ViolationCategory.VIOLENCE))
    }

    @Test
    fun `moderateContent should detect hate speech violation`() = runTest {
        val mockResponse = """
            {
              "is_violation": true,
              "violation_categories": ["HATE_SPEECH"],
              "severity": "HIGH",
              "confidence": 0.97,
              "reason": "包含针对特定群体的歧视性言论",
              "suggestion": "删除内容，警告用户"
            }
        """.trimIndent()

        coEvery { llmAdapter.chat(any(), any(), any(), any()) } returns mockResponse

        val hateSpeech = "某种族群体的歧视性言论"
        val result = contentModerator.moderateContent(hateSpeech)

        assertTrue(result is Result.Success)
        val moderationResult = (result as Result.Success).data
        assertTrue(moderationResult.isViolation)
        assertTrue(moderationResult.violationCategories.contains(ViolationCategory.HATE_SPEECH))
    }

    @Test
    fun `moderateContent should detect multiple violations`() = runTest {
        val mockResponse = """
            {
              "is_violation": true,
              "violation_categories": ["SEXUAL_CONTENT", "VIOLENCE", "HARASSMENT"],
              "severity": "HIGH",
              "confidence": 0.99,
              "reason": "内容同时包含色情、暴力和骚扰元素",
              "suggestion": "立即删除并永久封禁"
            }
        """.trimIndent()

        coEvery { llmAdapter.chat(any(), any(), any(), any()) } returns mockResponse

        val multiViolationContent = "严重违规内容"
        val result = contentModerator.moderateContent(multiViolationContent)

        assertTrue(result is Result.Success)
        val moderationResult = (result as Result.Success).data
        assertTrue(moderationResult.isViolation)
        assertEquals(3, moderationResult.violationCategories.size)
        assertEquals(ModerationSeverity.HIGH, moderationResult.severity)
    }

    @Test
    fun `moderateContent should handle low severity violations`() = runTest {
        val mockResponse = """
            {
              "is_violation": true,
              "violation_categories": ["HARASSMENT"],
              "severity": "LOW",
              "confidence": 0.75,
              "reason": "含有轻微的不当言论",
              "suggestion": "给予警告，允许修改后发布"
            }
        """.trimIndent()

        coEvery { llmAdapter.chat(any(), any(), any(), any()) } returns mockResponse

        val lowSeverityContent = "你真笨"
        val result = contentModerator.moderateContent(lowSeverityContent)

        assertTrue(result is Result.Success)
        val moderationResult = (result as Result.Success).data
        assertTrue(moderationResult.isViolation)
        assertEquals(ModerationSeverity.LOW, moderationResult.severity)
    }

    @Test
    fun `moderateContent should handle LLM error`() = runTest {
        coEvery { llmAdapter.chat(any(), any(), any(), any()) } throws Exception("LLM服务不可用")

        val result = contentModerator.moderateContent("测试内容")

        assertTrue(result is Result.Error)
    }

    // ==================== 批量审核测试 ====================

    @Test
    fun `moderateBatch should moderate multiple contents`() = runTest {
        // 第一条内容：干净
        val cleanResponse = """
            {
              "is_violation": false,
              "violation_categories": [],
              "severity": "NONE",
              "confidence": 0.95,
              "reason": "内容符合规范",
              "suggestion": "允许发布"
            }
        """.trimIndent()

        // 第二条内容：违规
        val violationResponse = """
            {
              "is_violation": true,
              "violation_categories": ["SEXUAL_CONTENT"],
              "severity": "HIGH",
              "confidence": 0.98,
              "reason": "包含色情内容",
              "suggestion": "删除"
            }
        """.trimIndent()

        // Mock返回不同结果
        coEvery { llmAdapter.chat(any(), any(), any(), any()) } returnsMany listOf(
            cleanResponse,
            violationResponse
        )

        val contents = listOf("正常内容", "违规内容")
        val result = contentModerator.moderateBatch(contents)

        assertTrue(result is Result.Success)
        val results = (result as Result.Success).data
        assertEquals(2, results.size)
        assertFalse(results[0].isViolation)
        assertTrue(results[1].isViolation)
    }

    // ==================== JSON解析测试 ====================

    @Test
    fun `parseModerationResult should parse clean JSON`() {
        val jsonResponse = """
            {
              "is_violation": true,
              "violation_categories": ["VIOLENCE"],
              "severity": "MEDIUM",
              "confidence": 0.85,
              "reason": "测试原因",
              "suggestion": "测试建议"
            }
        """.trimIndent()

        val result = contentModerator.parseModerationResult(jsonResponse)

        assertTrue(result.isViolation)
        assertEquals(1, result.violationCategories.size)
        assertEquals(ViolationCategory.VIOLENCE, result.violationCategories[0])
        assertEquals(ModerationSeverity.MEDIUM, result.severity)
        assertEquals(0.85, result.confidence, 0.01)
        assertEquals("测试原因", result.reason)
        assertEquals("测试建议", result.suggestion)
    }

    @Test
    fun `parseModerationResult should handle markdown code blocks`() {
        val markdownResponse = """
            ```json
            {
              "is_violation": false,
              "violation_categories": [],
              "severity": "NONE",
              "confidence": 0.9,
              "reason": "正常",
              "suggestion": "发布"
            }
            ```
        """.trimIndent()

        val result = contentModerator.parseModerationResult(markdownResponse)

        assertFalse(result.isViolation)
        assertEquals(ModerationSeverity.NONE, result.severity)
    }

    @Test
    fun `parseModerationResult should handle malformed JSON`() {
        val malformedJson = "这不是JSON"

        val result = contentModerator.parseModerationResult(malformedJson)

        // 应该返回安全默认值
        assertFalse(result.isViolation)
        assertEquals(0.0, result.confidence, 0.01)
        assertTrue(result.reason.contains("解析审核结果失败"))
    }

    @Test
    fun `parseModerationResult should handle empty violation categories`() {
        val jsonResponse = """
            {
              "is_violation": false,
              "violation_categories": [],
              "severity": "NONE",
              "confidence": 0.9,
              "reason": "正常",
              "suggestion": "发布"
            }
        """.trimIndent()

        val result = contentModerator.parseModerationResult(jsonResponse)

        assertTrue(result.violationCategories.isEmpty())
    }

    @Test
    fun `parseModerationResult should ignore unknown violation categories`() {
        val jsonResponse = """
            {
              "is_violation": true,
              "violation_categories": ["VIOLENCE", "UNKNOWN_TYPE", "HATE_SPEECH"],
              "severity": "HIGH",
              "confidence": 0.9,
              "reason": "测试",
              "suggestion": "删除"
            }
        """.trimIndent()

        val result = contentModerator.parseModerationResult(jsonResponse)

        // 未知类型应该被忽略
        assertEquals(2, result.violationCategories.size)
        assertTrue(result.violationCategories.contains(ViolationCategory.VIOLENCE))
        assertTrue(result.violationCategories.contains(ViolationCategory.HATE_SPEECH))
    }

    // ==================== 可用性检查测试 ====================

    @Test
    fun `isAvailable should return true when LLM is working`() = runTest {
        coEvery { llmAdapter.chat(any(), any(), any(), any()) } returns "test"

        val isAvailable = contentModerator.isAvailable()

        assertTrue(isAvailable)
    }

    @Test
    fun `isAvailable should return false when LLM throws exception`() = runTest {
        coEvery { llmAdapter.chat(any(), any(), any(), any()) } throws Exception("服务不可用")

        val isAvailable = contentModerator.isAvailable()

        assertFalse(isAvailable)
    }

    @Test
    fun `isAvailable should call LLM with minimal parameters`() = runTest {
        coEvery { llmAdapter.chat(any(), any(), any(), any()) } returns "ok"

        contentModerator.isAvailable()

        coVerify {
            llmAdapter.chat(
                messages = any(),
                model = "gpt-4o-mini",
                maxTokens = 10,
                temperature = null
            )
        }
    }

    // ==================== 枚举解析测试 ====================

    @Test
    fun `ViolationCategory fromString should parse valid categories`() {
        assertEquals(ViolationCategory.SEXUAL_CONTENT, ViolationCategory.fromString("SEXUAL_CONTENT"))
        assertEquals(ViolationCategory.VIOLENCE, ViolationCategory.fromString("VIOLENCE"))
        assertEquals(ViolationCategory.HATE_SPEECH, ViolationCategory.fromString("HATE_SPEECH"))
        assertEquals(ViolationCategory.HARASSMENT, ViolationCategory.fromString("HARASSMENT"))
        assertEquals(ViolationCategory.SELF_HARM, ViolationCategory.fromString("SELF_HARM"))
        assertEquals(ViolationCategory.ILLEGAL_ACTIVITY, ViolationCategory.fromString("ILLEGAL_ACTIVITY"))
    }

    @Test
    fun `ViolationCategory fromString should return null for invalid input`() {
        assertNull(ViolationCategory.fromString("INVALID_TYPE"))
        assertNull(ViolationCategory.fromString(null))
        assertNull(ViolationCategory.fromString(""))
    }

    @Test
    fun `ModerationSeverity fromString should parse valid severities`() {
        assertEquals(ModerationSeverity.NONE, ModerationSeverity.fromString("NONE"))
        assertEquals(ModerationSeverity.LOW, ModerationSeverity.fromString("LOW"))
        assertEquals(ModerationSeverity.MEDIUM, ModerationSeverity.fromString("MEDIUM"))
        assertEquals(ModerationSeverity.HIGH, ModerationSeverity.fromString("HIGH"))
    }

    // ==================== 参数验证测试 ====================

    @Test
    fun `moderateContent should reject empty content`() = runTest {
        val result = contentModerator.moderateContent("")

        assertTrue(result is Result.Error)
        val error = (result as Result.Error).exception
        assertTrue(error is IllegalArgumentException)
        assertTrue(error.message?.contains("不能为空") == true)
    }

    @Test
    fun `moderateBatch should return empty list for empty input`() = runTest {
        val result = contentModerator.moderateBatch(emptyList())

        assertTrue(result is Result.Success)
        val results = (result as Result.Success).data
        assertTrue(results.isEmpty())
    }
}
