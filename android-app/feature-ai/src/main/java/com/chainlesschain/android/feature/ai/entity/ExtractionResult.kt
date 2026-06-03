package com.chainlesschain.android.feature.ai.entity

/**
 * Extraction Result
 *
 * Contains the complete result of entity extraction from text.
 */
data class ExtractionResult(
    /**
     * List of extracted entities
     */
    val entities: List<ExtractedEntity>,

    /**
     * List of identified relations between entities
     */
    val relations: List<EntityRelation> = emptyList(),

    /**
     * Original source text
     */
    val sourceText: String,

    /**
     * Extraction timestamp
     */
    val timestamp: Long = System.currentTimeMillis(),

    /**
     * Processing duration in milliseconds
     */
    val processingTimeMs: Long = 0,

    /**
     * Whether LLM was used for extraction
     */
    val usedLLM: Boolean = false,

    /**
     * Extraction statistics
     */
    val stats: ExtractionStats = ExtractionStats()
) {
    /**
     * Get entities by type
     */
    fun getEntitiesByType(type: EntityType): List<ExtractedEntity> {
        return entities.filter { it.type == type }
    }

    /**
     * Get relations involving a specific entity
     */
    fun getRelationsFor(entityId: String): List<EntityRelation> {
        return relations.filter { it.involves(entityId) }
    }

    /**
     * Get unique entity count
     */
    val uniqueEntityCount: Int
        get() = entities.distinctBy { it.normalizedText to it.type }.size

    /**
     * Get entity type distribution
     */
    val typeDistribution: Map<EntityType, Int>
        get() = entities.groupBy { it.type }.mapValues { it.value.size }

    /**
     * Check if result is empty
     */
    val isEmpty: Boolean
        get() = entities.isEmpty()

    /**
     * Merge with another extraction result
     */
    fun merge(other: ExtractionResult): ExtractionResult {
        val mergedEntities = (entities + other.entities).distinctBy { it.id }
        val mergedRelations = (relations + other.relations).distinctBy { it.id }

        return copy(
            entities = mergedEntities,
            relations = mergedRelations,
            sourceText = sourceText + "\n" + other.sourceText,
            processingTimeMs = processingTimeMs + other.processingTimeMs,
            stats = stats.merge(other.stats)
        )
    }
}

/**
 * Extraction statistics
 */
data class ExtractionStats(
    /**
     * Number of regex patterns matched
     */
    val regexMatches: Int = 0,

    /**
     * Number of keyword matches
     */
    val keywordMatches: Int = 0,

    /**
     * Number of LLM-identified entities
     */
    val llmMatches: Int = 0,

    /**
     * Number of duplicates filtered
     */
    val duplicatesFiltered: Int = 0,

    /**
     * Total characters processed
     */
    val charactersProcessed: Int = 0
) {
    /**
     * Total matches
     */
    val totalMatches: Int
        get() = regexMatches + keywordMatches + llmMatches

    /**
     * Merge with another stats object
     */
    fun merge(other: ExtractionStats): ExtractionStats {
        return ExtractionStats(
            regexMatches = regexMatches + other.regexMatches,
            keywordMatches = keywordMatches + other.keywordMatches,
            llmMatches = llmMatches + other.llmMatches,
            duplicatesFiltered = duplicatesFiltered + other.duplicatesFiltered,
            charactersProcessed = charactersProcessed + other.charactersProcessed
        )
    }
}
