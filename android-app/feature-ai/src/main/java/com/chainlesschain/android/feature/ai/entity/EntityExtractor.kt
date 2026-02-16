package com.chainlesschain.android.feature.ai.entity

import timber.log.Timber
import com.chainlesschain.android.feature.ai.data.llm.LLMAdapter
import com.chainlesschain.android.feature.ai.domain.model.Message
import com.chainlesschain.android.feature.ai.domain.model.MessageRole
import com.chainlesschain.android.feature.ai.entity.patterns.TechKeywords
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Entity Extractor
 *
 * Extracts entities and relationships from text using pattern matching
 * and optional LLM enhancement. Supports 11 entity types and 10 relation types.
 *
 * Features:
 * - Regex-based extraction (dates, URLs, emails, phones, tags)
 * - 140+ tech keyword recognition
 * - Optional LLM-enhanced extraction for complex entities
 * - Jaccard similarity for entity deduplication
 * - Relationship inference between entities
 *
 * Aligns with iOS implementation patterns.
 */
@Singleton
class EntityExtractor @Inject constructor() {

    companion object {
        // Regex patterns for entity extraction
        private val URL_PATTERN = Regex(
            """https?://[^\s<>"{}|\\^`\[\]]+""",
            RegexOption.IGNORE_CASE
        )

        private val EMAIL_PATTERN = Regex(
            """[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}"""
        )

        private val PHONE_PATTERN = Regex(
            """(\+?\d{1,4}[-.\s]?)?(\(?\d{1,4}\)?[-.\s]?)?\d{1,4}[-.\s]?\d{1,4}[-.\s]?\d{1,9}"""
        )

        private val TAG_PATTERN = Regex(
            """#[a-zA-Z\u4e00-\u9fff][a-zA-Z0-9\u4e00-\u9fff_-]*"""
        )

        // Date patterns (ISO, common formats)
        private val DATE_PATTERNS = listOf(
            Regex("""\d{4}[-/]\d{1,2}[-/]\d{1,2}"""), // 2024-01-15
            Regex("""\d{1,2}[-/]\d{1,2}[-/]\d{2,4}"""), // 01/15/2024
            Regex("""\d{4}年\d{1,2}月\d{1,2}日"""), // 2024年1月15日
            Regex("""(今天|明天|昨天|后天|前天)"""),
            Regex("""(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)""", RegexOption.IGNORE_CASE),
            Regex("""(星期[一二三四五六日天])""")
        )

        // Code pattern (backticks, common code indicators)
        private val CODE_PATTERN = Regex(
            """`[^`]+`|```[\s\S]*?```"""
        )

        // Number pattern (with optional units)
        private val NUMBER_PATTERN = Regex(
            """\b\d+(?:\.\d+)?(?:\s*(?:KB|MB|GB|TB|ms|s|min|h|px|em|rem|%))?\b""",
            RegexOption.IGNORE_CASE
        )

        // Similarity threshold for deduplication
        private const val SIMILARITY_THRESHOLD = 0.8f
    }

    // Optional LLM adapter for enhanced extraction
    private var llmAdapter: LLMAdapter? = null

    /**
     * Set LLM adapter for enhanced extraction
     */
    fun setLLMAdapter(adapter: LLMAdapter) {
        llmAdapter = adapter
    }

    /**
     * Extract entities from text
     *
     * @param text Source text
     * @param useLLM Whether to use LLM for enhanced extraction
     * @param types Specific entity types to extract (null for all)
     * @return Extraction result with entities and relations
     */
    suspend fun extract(
        text: String,
        useLLM: Boolean = false,
        types: Set<EntityType>? = null
    ): ExtractionResult = withContext(Dispatchers.Default) {
        val startTime = System.currentTimeMillis()

        if (text.isBlank()) {
            return@withContext ExtractionResult(
                entities = emptyList(),
                sourceText = text,
                timestamp = startTime
            )
        }

        val entities = mutableListOf<ExtractedEntity>()
        var regexMatches = 0
        var keywordMatches = 0
        var llmMatches = 0

        // Extract URLs
        if (types == null || types.contains(EntityType.URL)) {
            val urls = extractByPattern(text, URL_PATTERN, EntityType.URL)
            entities.addAll(urls)
            regexMatches += urls.size
        }

        // Extract emails
        if (types == null || types.contains(EntityType.EMAIL)) {
            val emails = extractByPattern(text, EMAIL_PATTERN, EntityType.EMAIL)
            entities.addAll(emails)
            regexMatches += emails.size
        }

        // Extract phone numbers
        if (types == null || types.contains(EntityType.PHONE)) {
            val phones = extractByPattern(text, PHONE_PATTERN, EntityType.PHONE)
                .filter { it.text.length >= 7 } // Filter out too short matches
            entities.addAll(phones)
            regexMatches += phones.size
        }

        // Extract tags
        if (types == null || types.contains(EntityType.TAG)) {
            val tags = extractByPattern(text, TAG_PATTERN, EntityType.TAG)
            entities.addAll(tags)
            regexMatches += tags.size
        }

        // Extract dates
        if (types == null || types.contains(EntityType.DATE)) {
            DATE_PATTERNS.forEach { pattern ->
                val dates = extractByPattern(text, pattern, EntityType.DATE)
                entities.addAll(dates)
                regexMatches += dates.size
            }
        }

        // Extract code snippets
        if (types == null || types.contains(EntityType.CODE)) {
            val codes = extractByPattern(text, CODE_PATTERN, EntityType.CODE)
            entities.addAll(codes)
            regexMatches += codes.size
        }

        // Extract numbers
        if (types == null || types.contains(EntityType.NUMBER)) {
            val numbers = extractByPattern(text, NUMBER_PATTERN, EntityType.NUMBER)
            entities.addAll(numbers)
            regexMatches += numbers.size
        }

        // Extract tech terms using keyword matching
        if (types == null || types.contains(EntityType.TECH_TERM)) {
            val techTerms = extractTechTerms(text)
            entities.addAll(techTerms)
            keywordMatches += techTerms.size
        }

        // Optional LLM-enhanced extraction
        if (useLLM && llmAdapter != null) {
            try {
                val llmEntities = extractWithLLM(text, types)
                entities.addAll(llmEntities)
                llmMatches += llmEntities.size
            } catch (e: Exception) {
                Timber.e(e, "LLM extraction failed")
            }
        }

        // Deduplicate entities
        val (deduplicated, duplicateCount) = deduplicateEntities(entities)

        // Infer relations
        val relations = inferRelations(deduplicated, text)

        val endTime = System.currentTimeMillis()

        ExtractionResult(
            entities = deduplicated,
            relations = relations,
            sourceText = text,
            timestamp = startTime,
            processingTimeMs = endTime - startTime,
            usedLLM = useLLM && llmAdapter != null,
            stats = ExtractionStats(
                regexMatches = regexMatches,
                keywordMatches = keywordMatches,
                llmMatches = llmMatches,
                duplicatesFiltered = duplicateCount,
                charactersProcessed = text.length
            )
        )
    }

    /**
     * Extract entities by regex pattern
     */
    private fun extractByPattern(
        text: String,
        pattern: Regex,
        type: EntityType
    ): List<ExtractedEntity> {
        return pattern.findAll(text).map { match ->
            val contextStart = (match.range.first - 30).coerceAtLeast(0)
            val contextEnd = (match.range.last + 30).coerceAtMost(text.length)

            ExtractedEntity(
                text = match.value,
                type = type,
                confidence = 0.95f,
                startOffset = match.range.first,
                endOffset = match.range.last + 1,
                context = text.substring(contextStart, contextEnd)
            )
        }.toList()
    }

    /**
     * Extract tech terms using keyword matching
     */
    private fun extractTechTerms(text: String): List<ExtractedEntity> {
        val entities = mutableListOf<ExtractedEntity>()
        val keywords = TechKeywords.findKeywords(text)

        for (keyword in keywords) {
            val regex = Regex("\\b${Regex.escape(keyword)}\\b", RegexOption.IGNORE_CASE)
            regex.findAll(text).forEach { match ->
                entities.add(
                    ExtractedEntity(
                        text = match.value,
                        type = EntityType.TECH_TERM,
                        confidence = 0.9f,
                        startOffset = match.range.first,
                        endOffset = match.range.last + 1,
                        metadata = mapOf("category" to TechKeywords.getCategory(keyword))
                    )
                )
            }
        }

        return entities
    }

    /**
     * Extract entities using LLM
     */
    private suspend fun extractWithLLM(
        text: String,
        types: Set<EntityType>?
    ): List<ExtractedEntity> {
        val adapter = llmAdapter ?: return emptyList()

        val typeHint = types?.joinToString(", ") { it.displayName } ?: "all types"
        val prompt = """
            Extract named entities from the following text.
            Entity types to extract: $typeHint

            For each entity found, output in this format:
            ENTITY: [entity text] | TYPE: [entity type] | CONFIDENCE: [0.0-1.0]

            Text:
            $text

            Entities:
        """.trimIndent()

        val messages = listOf(
            Message(
                id = UUID.randomUUID().toString(),
                conversationId = "extraction",
                role = MessageRole.USER,
                content = prompt,
                createdAt = System.currentTimeMillis()
            )
        )

        return try {
            val response = adapter.chat(messages, "gpt-4", maxTokens = 1000)
            parseLLMResponse(response)
        } catch (e: Exception) {
            Timber.e(e, "LLM extraction error")
            emptyList()
        }
    }

    /**
     * Parse LLM response to extract entities
     */
    private fun parseLLMResponse(response: String): List<ExtractedEntity> {
        val entities = mutableListOf<ExtractedEntity>()
        val lines = response.lines()

        for (line in lines) {
            if (line.startsWith("ENTITY:")) {
                try {
                    val parts = line.split("|").map { it.trim() }
                    if (parts.size >= 2) {
                        val entityText = parts[0].removePrefix("ENTITY:").trim()
                        val typeStr = parts[1].removePrefix("TYPE:").trim()
                        val confidence = if (parts.size >= 3) {
                            parts[2].removePrefix("CONFIDENCE:").trim().toFloatOrNull() ?: 0.8f
                        } else 0.8f

                        val type = EntityType.fromString(typeStr)
                        if (type != null) {
                            entities.add(
                                ExtractedEntity(
                                    text = entityText,
                                    type = type,
                                    confidence = confidence
                                )
                            )
                        }
                    }
                } catch (e: Exception) {
                    Timber.w("Failed to parse entity line: $line")
                }
            }
        }

        return entities
    }

    /**
     * Deduplicate entities using Jaccard similarity
     */
    private fun deduplicateEntities(
        entities: List<ExtractedEntity>
    ): Pair<List<ExtractedEntity>, Int> {
        if (entities.isEmpty()) return Pair(emptyList(), 0)

        val deduplicated = mutableListOf<ExtractedEntity>()
        var duplicateCount = 0

        for (entity in entities) {
            val isDuplicate = deduplicated.any { existing ->
                entity.similarityTo(existing) >= SIMILARITY_THRESHOLD
            }

            if (!isDuplicate) {
                deduplicated.add(entity)
            } else {
                duplicateCount++
            }
        }

        return Pair(deduplicated, duplicateCount)
    }

    /**
     * Infer relations between entities
     */
    private fun inferRelations(
        entities: List<ExtractedEntity>,
        text: String
    ): List<EntityRelation> {
        val relations = mutableListOf<EntityRelation>()

        // Infer co-occurrence relations
        for (i in entities.indices) {
            for (j in i + 1 until entities.size) {
                val e1 = entities[i]
                val e2 = entities[j]

                // Check proximity in text
                if (e1.hasPosition && e2.hasPosition) {
                    val distance = kotlin.math.abs(e1.startOffset - e2.startOffset)
                    if (distance < 100) { // Within 100 characters
                        relations.add(
                            EntityRelation(
                                sourceEntityId = e1.id,
                                targetEntityId = e2.id,
                                relationType = RelationType.RELATED_TO,
                                confidence = 1f - (distance / 100f),
                                evidence = getTextBetween(text, e1, e2)
                            )
                        )
                    }
                }

                // Tech term using URL (e.g., "Python documentation at https://...")
                if (e1.type == EntityType.TECH_TERM && e2.type == EntityType.URL) {
                    relations.add(
                        EntityRelation(
                            sourceEntityId = e1.id,
                            targetEntityId = e2.id,
                            relationType = RelationType.MENTIONS,
                            confidence = 0.7f
                        )
                    )
                }

                // Date relations
                if (e1.type == EntityType.DATE || e2.type == EntityType.DATE) {
                    val (dateEntity, otherEntity) = if (e1.type == EntityType.DATE) {
                        e1 to e2
                    } else {
                        e2 to e1
                    }
                    relations.add(
                        EntityRelation(
                            sourceEntityId = otherEntity.id,
                            targetEntityId = dateEntity.id,
                            relationType = RelationType.OCCURS_AT,
                            confidence = 0.6f
                        )
                    )
                }
            }
        }

        return relations
    }

    /**
     * Get text between two entities
     */
    private fun getTextBetween(
        text: String,
        e1: ExtractedEntity,
        e2: ExtractedEntity
    ): String? {
        if (!e1.hasPosition || !e2.hasPosition) return null

        val start = minOf(e1.endOffset, e2.endOffset)
        val end = maxOf(e1.startOffset, e2.startOffset)

        return if (start < end && end <= text.length) {
            text.substring(start, end).trim()
        } else null
    }

    /**
     * Calculate Jaccard similarity between two strings
     */
    fun jaccardSimilarity(a: String, b: String): Float {
        val setA = a.lowercase().toSet()
        val setB = b.lowercase().toSet()
        val intersection = setA.intersect(setB).size
        val union = setA.union(setB).size
        return if (union > 0) intersection.toFloat() / union else 0f
    }
}
