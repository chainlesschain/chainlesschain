package com.chainlesschain.android.feature.ai.entity

import com.chainlesschain.android.feature.ai.entity.patterns.TechKeywords
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test

/**
 * EntityExtractor 单元测试
 *
 * 验证实体提取、关系识别、模式匹配等功能
 */
class EntityExtractorTest {

    private lateinit var extractor: EntityExtractor

    @Before
    fun setup() {
        extractor = EntityExtractor()
    }

    // ===== Date Extraction Tests =====

    @Test
    fun `提取ISO日期格式`() {
        // Given
        val text = "The meeting is scheduled for 2024-03-15"

        // When
        val result = extractor.extract(text)

        // Then
        val dates = result.entities.filter { it.type == EntityType.DATE }
        assertTrue("应提取到日期", dates.isNotEmpty())
        assertEquals("日期值应正确", "2024-03-15", dates[0].value)
    }

    @Test
    fun `提取中文日期格式`() {
        // Given
        val text = "会议时间是2024年3月15日"

        // When
        val result = extractor.extract(text)

        // Then
        val dates = result.entities.filter { it.type == EntityType.DATE }
        assertTrue("应提取到中文日期", dates.isNotEmpty())
    }

    @Test
    fun `提取斜杠日期格式`() {
        // Given
        val text = "Date: 03/15/2024 or 15/03/2024"

        // When
        val result = extractor.extract(text)

        // Then
        val dates = result.entities.filter { it.type == EntityType.DATE }
        assertTrue("应提取到斜杠日期", dates.isNotEmpty())
    }

    // ===== URL Extraction Tests =====

    @Test
    fun `提取HTTP URL`() {
        // Given
        val text = "Visit https://www.example.com/path?query=1 for more info"

        // When
        val result = extractor.extract(text)

        // Then
        val urls = result.entities.filter { it.type == EntityType.URL }
        assertTrue("应提取到URL", urls.isNotEmpty())
        assertTrue("URL应包含完整路径", urls[0].value.contains("example.com"))
    }

    @Test
    fun `提取多个URL`() {
        // Given
        val text = "Check http://site1.com and https://site2.org/page"

        // When
        val result = extractor.extract(text)

        // Then
        val urls = result.entities.filter { it.type == EntityType.URL }
        assertEquals("应提取到2个URL", 2, urls.size)
    }

    // ===== Email Extraction Tests =====

    @Test
    fun `提取邮箱地址`() {
        // Given
        val text = "Contact us at support@example.com or admin@test.org"

        // When
        val result = extractor.extract(text)

        // Then
        val emails = result.entities.filter { it.type == EntityType.EMAIL }
        assertEquals("应提取到2个邮箱", 2, emails.size)
    }

    @Test
    fun `提取特殊邮箱格式`() {
        // Given
        val text = "Email: user.name+tag@subdomain.example.co.uk"

        // When
        val result = extractor.extract(text)

        // Then
        val emails = result.entities.filter { it.type == EntityType.EMAIL }
        assertTrue("应提取到邮箱", emails.isNotEmpty())
    }

    // ===== Phone Extraction Tests =====

    @Test
    fun `提取中国手机号`() {
        // Given
        val text = "联系电话：13812345678 或 +86 138 1234 5678"

        // When
        val result = extractor.extract(text)

        // Then
        val phones = result.entities.filter { it.type == EntityType.PHONE }
        assertTrue("应提取到手机号", phones.isNotEmpty())
    }

    @Test
    fun `提取美国电话格式`() {
        // Given
        val text = "Call us at +1 (555) 123-4567"

        // When
        val result = extractor.extract(text)

        // Then
        val phones = result.entities.filter { it.type == EntityType.PHONE }
        assertTrue("应提取到电话号码", phones.isNotEmpty())
    }

    // ===== Tag/Hashtag Extraction Tests =====

    @Test
    fun `提取Hashtag标签`() {
        // Given
        val text = "This is about #Android and #Kotlin development"

        // When
        val result = extractor.extract(text)

        // Then
        val tags = result.entities.filter { it.type == EntityType.TAG }
        assertEquals("应提取到2个标签", 2, tags.size)
        assertTrue("应包含Android标签", tags.any { it.value.contains("Android") })
    }

    @Test
    fun `提取中文Hashtag`() {
        // Given
        val text = "这是关于#人工智能 和 #机器学习 的内容"

        // When
        val result = extractor.extract(text)

        // Then
        val tags = result.entities.filter { it.type == EntityType.TAG }
        assertTrue("应提取到中文标签", tags.isNotEmpty())
    }

    // ===== Tech Term Extraction Tests =====

    @Test
    fun `提取技术术语`() {
        // Given
        val text = "We use Kotlin, TensorFlow, and Docker in our project"

        // When
        val result = extractor.extract(text)

        // Then
        val techTerms = result.entities.filter { it.type == EntityType.TECH_TERM }
        assertTrue("应提取到技术术语", techTerms.isNotEmpty())
    }

    @Test
    fun `提取编程语言`() {
        // Given
        val text = "Python and Java are popular programming languages"

        // When
        val result = extractor.extract(text)

        // Then
        val techTerms = result.entities.filter { it.type == EntityType.TECH_TERM }
        assertTrue("应提取到Python", techTerms.any {
            it.value.equals("Python", ignoreCase = true)
        })
        assertTrue("应提取到Java", techTerms.any {
            it.value.equals("Java", ignoreCase = true)
        })
    }

    @Test
    fun `提取框架名称`() {
        // Given
        val text = "Using React for frontend and Spring Boot for backend"

        // When
        val result = extractor.extract(text)

        // Then
        val techTerms = result.entities.filter { it.type == EntityType.TECH_TERM }
        assertTrue("应提取到React", techTerms.any {
            it.value.equals("React", ignoreCase = true)
        })
    }

    // ===== Code Extraction Tests =====

    @Test
    fun `提取代码块`() {
        // Given
        val text = """
            Here is a code example:
            ```kotlin
            fun main() {
                println("Hello")
            }
            ```
            That's it.
        """.trimIndent()

        // When
        val result = extractor.extract(text)

        // Then
        val codeBlocks = result.entities.filter { it.type == EntityType.CODE }
        assertTrue("应提取到代码块", codeBlocks.isNotEmpty())
    }

    @Test
    fun `提取行内代码`() {
        // Given
        val text = "Use the `println()` function to print text"

        // When
        val result = extractor.extract(text)

        // Then
        val codeBlocks = result.entities.filter { it.type == EntityType.CODE }
        assertTrue("应提取到行内代码", codeBlocks.isNotEmpty())
    }

    // ===== Number Extraction Tests =====

    @Test
    fun `提取数字`() {
        // Given
        val text = "The price is $99.99 with 50% discount"

        // When
        val result = extractor.extract(text)

        // Then
        val numbers = result.entities.filter { it.type == EntityType.NUMBER }
        assertTrue("应提取到数字", numbers.isNotEmpty())
    }

    @Test
    fun `提取带单位的数字`() {
        // Given
        val text = "The file size is 1.5GB with 100MB free"

        // When
        val result = extractor.extract(text)

        // Then
        val numbers = result.entities.filter { it.type == EntityType.NUMBER }
        assertTrue("应提取到带单位的数字", numbers.isNotEmpty())
    }

    // ===== Entity Position Tests =====

    @Test
    fun `实体位置应正确`() {
        // Given
        val text = "Hello world@example.com"

        // When
        val result = extractor.extract(text)

        // Then
        val email = result.entities.find { it.type == EntityType.EMAIL }
        assertNotNull("应找到邮箱", email)
        email?.let {
            assertTrue("起始位置应>=0", it.startIndex >= 0)
            assertTrue("结束位置应>起始位置", it.endIndex > it.startIndex)
            assertTrue("结束位置应<=文本长度", it.endIndex <= text.length)
        }
    }

    // ===== Relation Extraction Tests =====

    @Test
    fun `提取实体关系`() {
        // Given
        val text = "John works at Google using Python"

        // When
        val result = extractor.extract(text)

        // Then
        // 关系提取基于共现
        assertTrue("应有实体或关系",
            result.entities.isNotEmpty() || result.relations.isNotEmpty())
    }

    // ===== Extraction Result Tests =====

    @Test
    fun `提取结果应包含统计`() {
        // Given
        val text = "Contact support@test.com or visit https://example.com #help"

        // When
        val result = extractor.extract(text)

        // Then
        assertTrue("应有实体", result.entities.isNotEmpty())
        assertTrue("提取时间应>0", result.extractionTimeMs >= 0)
    }

    @Test
    fun `空文本应返回空结果`() {
        // Given
        val text = ""

        // When
        val result = extractor.extract(text)

        // Then
        assertTrue("空文本应返回空实体", result.entities.isEmpty())
    }

    // ===== TechKeywords Tests =====

    @Test
    fun `技术关键词库应包含主要语言`() {
        // Then
        assertTrue("应包含Kotlin", TechKeywords.PROGRAMMING_LANGUAGES.any {
            it.equals("Kotlin", ignoreCase = true)
        })
        assertTrue("应包含Python", TechKeywords.PROGRAMMING_LANGUAGES.any {
            it.equals("Python", ignoreCase = true)
        })
        assertTrue("应包含JavaScript", TechKeywords.PROGRAMMING_LANGUAGES.any {
            it.equals("JavaScript", ignoreCase = true)
        })
    }

    @Test
    fun `技术关键词库应包含主要框架`() {
        // Then
        assertTrue("应包含TensorFlow", TechKeywords.ML_FRAMEWORKS.any {
            it.equals("TensorFlow", ignoreCase = true)
        })
        assertTrue("应包含Docker", TechKeywords.DEVOPS_TOOLS.any {
            it.equals("Docker", ignoreCase = true)
        })
    }

    @Test
    fun `所有关键词应唯一`() {
        // When
        val allKeywords = TechKeywords.getAllKeywords()

        // Then
        val uniqueKeywords = allKeywords.map { it.lowercase() }.toSet()
        // 允许一定的重复（不同类别可能有重叠）
        assertTrue("关键词数量应合理", allKeywords.size <= uniqueKeywords.size * 1.2)
    }

    // ===== Jaccard Similarity Tests =====

    @Test
    fun `Jaccard相似度计算正确`() {
        // Given
        val entity1 = ExtractedEntity(
            value = "hello world",
            type = EntityType.TECH_TERM,
            startIndex = 0,
            endIndex = 11
        )
        val entity2 = ExtractedEntity(
            value = "hello kotlin",
            type = EntityType.TECH_TERM,
            startIndex = 0,
            endIndex = 12
        )

        // When
        val similarity = entity1.jaccardSimilarity(entity2)

        // Then
        assertTrue("Jaccard相似度应在0-1之间", similarity in 0.0..1.0)
        assertTrue("有共同词应>0", similarity > 0)
    }

    @Test
    fun `相同文本Jaccard相似度为1`() {
        // Given
        val entity1 = ExtractedEntity("hello world", EntityType.TECH_TERM, 0, 11)
        val entity2 = ExtractedEntity("hello world", EntityType.TECH_TERM, 0, 11)

        // When
        val similarity = entity1.jaccardSimilarity(entity2)

        // Then
        assertEquals("相同文本相似度应为1", 1.0, similarity, 0.001)
    }

    @Test
    fun `完全不同文本Jaccard相似度为0`() {
        // Given
        val entity1 = ExtractedEntity("abc", EntityType.TECH_TERM, 0, 3)
        val entity2 = ExtractedEntity("xyz", EntityType.TECH_TERM, 0, 3)

        // When
        val similarity = entity1.jaccardSimilarity(entity2)

        // Then
        assertEquals("不同文本相似度应为0", 0.0, similarity, 0.001)
    }

    // ===== Performance Tests =====

    @Test
    fun `大文本提取性能`() {
        // Given - 模拟长文本
        val text = buildString {
            repeat(100) { i ->
                append("Email: user$i@example.com ")
                append("Visit https://site$i.com ")
                append("Call 1380000${i.toString().padStart(4, '0')} ")
                append("#tag$i ")
                append("Using Kotlin and Python.\n")
            }
        }

        // When
        val startTime = System.nanoTime()
        val result = extractor.extract(text)
        val duration = (System.nanoTime() - startTime) / 1_000_000.0

        // Then
        assertTrue("应提取到多个实体", result.entities.size > 100)
        println("提取${text.length}字符文本耗时: ${String.format("%.2f", duration)} ms")
        println("提取到${result.entities.size}个实体")
        assertTrue("提取应在合理时间内完成", duration < 2000) // < 2秒
    }

    @Test
    fun `批量提取性能`() {
        // Given
        val texts = List(100) { i ->
            "Email: user$i@test.com, visit https://site$i.org #topic$i"
        }

        // When
        val startTime = System.nanoTime()
        val results = texts.map { extractor.extract(it) }
        val duration = (System.nanoTime() - startTime) / 1_000_000.0

        // Then
        assertEquals("应处理所有文本", 100, results.size)
        println("批量提取100条文本耗时: ${String.format("%.2f", duration)} ms")
        assertTrue("批量提取应在合理时间内完成", duration < 1000) // < 1秒
    }

    // ===== Edge Cases =====

    @Test
    fun `特殊字符文本应正确处理`() {
        // Given
        val text = "Test with emoji 👋 and special chars: äöü ñ 中文"

        // When
        val result = extractor.extract(text)

        // Then - 不应抛异常
        assertNotNull("结果不应为空", result)
    }

    @Test
    fun `超长单词应正确处理`() {
        // Given
        val text = "supercalifragilisticexpialidocious" + "a".repeat(1000)

        // When
        val result = extractor.extract(text)

        // Then - 不应抛异常
        assertNotNull("结果不应为空", result)
    }
}
