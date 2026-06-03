package com.chainlesschain.android.feature.project.search

import timber.log.Timber
import com.chainlesschain.android.core.database.entity.ProjectFileEntity
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.withContext
import java.util.regex.Pattern
import java.util.regex.PatternSyntaxException
import androidx.compose.runtime.Immutable
import javax.inject.Inject
import javax.inject.Singleton

/**
 * File Search Manager
 *
 * Provides comprehensive file search capabilities:
 * - File name search with fuzzy matching
 * - Full-text content search
 * - Regex pattern support
 * - Search history and suggestions
 */
@Singleton
class FileSearchManager @Inject constructor() {

    companion object {
        private const val MAX_SEARCH_RESULTS = 100
        private const val MAX_CONTENT_PREVIEW_LENGTH = 150
        private const val MAX_SEARCH_HISTORY = 20
    }

    // Search state
    private val _searchState = MutableStateFlow(SearchState())
    val searchState: StateFlow<SearchState> = _searchState.asStateFlow()

    // Search history
    private val _searchHistory = MutableStateFlow<List<String>>(emptyList())
    val searchHistory: StateFlow<List<String>> = _searchHistory.asStateFlow()

    /**
     * Search for files by name
     *
     * @param query Search query
     * @param files List of files to search
     * @param options Search options
     * @return List of matching file results
     */
    suspend fun searchByName(
        query: String,
        files: List<ProjectFileEntity>,
        options: SearchOptions = SearchOptions()
    ): List<FileSearchResult> = withContext(Dispatchers.Default) {
        if (query.isBlank()) {
            return@withContext emptyList()
        }

        _searchState.value = _searchState.value.copy(isSearching = true)

        try {
            val normalizedQuery = if (options.caseSensitive) query else query.lowercase()
            val results = mutableListOf<FileSearchResult>()

            for (file in files) {
                if (file.type == "folder" && !options.includeFolders) continue

                val fileName = if (options.caseSensitive) file.name else file.name.lowercase()
                val filePath = if (options.caseSensitive) file.path else file.path.lowercase()

                val matchResult = when {
                    options.useRegex -> matchRegex(normalizedQuery, fileName, filePath)
                    options.fuzzyMatch -> fuzzyMatch(normalizedQuery, fileName, filePath)
                    options.wholeWord -> wholeWordMatch(normalizedQuery, fileName)
                    else -> simpleMatch(normalizedQuery, fileName, filePath)
                }

                if (matchResult != null) {
                    results.add(
                        FileSearchResult(
                            file = file,
                            matchType = matchResult.matchType,
                            matchScore = matchResult.score,
                            matchRanges = matchResult.ranges,
                            preview = null
                        )
                    )
                }

                if (results.size >= MAX_SEARCH_RESULTS) break
            }

            // Sort by match score (higher is better)
            val sortedResults = results.sortedByDescending { it.matchScore }

            // Update search state
            _searchState.value = _searchState.value.copy(
                isSearching = false,
                lastQuery = query,
                resultCount = sortedResults.size
            )

            // Add to history
            addToSearchHistory(query)

            sortedResults
        } catch (e: Exception) {
            Timber.e(e, "Search error")
            _searchState.value = _searchState.value.copy(
                isSearching = false,
                error = e.message
            )
            emptyList()
        }
    }

    /**
     * Search file contents
     *
     * @param query Search query
     * @param files List of files with content to search
     * @param options Search options
     * @return List of content search results
     */
    suspend fun searchContent(
        query: String,
        files: List<ProjectFileEntity>,
        options: SearchOptions = SearchOptions()
    ): List<ContentSearchResult> = withContext(Dispatchers.Default) {
        if (query.isBlank()) {
            return@withContext emptyList()
        }

        _searchState.value = _searchState.value.copy(isSearching = true)

        try {
            val results = mutableListOf<ContentSearchResult>()
            val pattern = if (options.useRegex) {
                try {
                    val flags = if (options.caseSensitive) 0 else Pattern.CASE_INSENSITIVE
                    Pattern.compile(query, flags)
                } catch (e: PatternSyntaxException) {
                    Timber.w("Invalid regex pattern: $query")
                    null
                }
            } else null

            for (file in files) {
                // Skip folders and files without content
                if (file.type == "folder" || file.content.isNullOrBlank()) continue

                // Skip binary files
                if (isBinaryFile(file.extension)) continue

                val content = file.content ?: continue
                val matches = findContentMatches(query, content, pattern, options)

                if (matches.isNotEmpty()) {
                    results.add(
                        ContentSearchResult(
                            file = file,
                            matches = matches,
                            matchCount = matches.size
                        )
                    )
                }

                if (results.size >= MAX_SEARCH_RESULTS) break
            }

            // Sort by match count (more matches first)
            val sortedResults = results.sortedByDescending { it.matchCount }

            _searchState.value = _searchState.value.copy(
                isSearching = false,
                lastQuery = query,
                resultCount = sortedResults.sumOf { it.matchCount }
            )

            addToSearchHistory(query)

            sortedResults
        } catch (e: Exception) {
            Timber.e(e, "Content search error")
            _searchState.value = _searchState.value.copy(
                isSearching = false,
                error = e.message
            )
            emptyList()
        }
    }

    /**
     * Combined search (file names + content)
     */
    suspend fun search(
        query: String,
        files: List<ProjectFileEntity>,
        options: SearchOptions = SearchOptions()
    ): CombinedSearchResult = withContext(Dispatchers.Default) {
        val fileResults = searchByName(query, files, options)
        val contentResults = if (options.searchContent) {
            searchContent(query, files, options)
        } else {
            emptyList()
        }

        CombinedSearchResult(
            fileMatches = fileResults,
            contentMatches = contentResults,
            totalCount = fileResults.size + contentResults.sumOf { it.matchCount }
        )
    }

    // --- Matching algorithms ---

    private fun simpleMatch(query: String, fileName: String, filePath: String): MatchResult? {
        return when {
            fileName.contains(query) -> MatchResult(
                matchType = MatchType.NAME_CONTAINS,
                score = if (fileName == query) 100 else 80,
                ranges = findMatchRanges(fileName, query)
            )
            filePath.contains(query) -> MatchResult(
                matchType = MatchType.PATH_CONTAINS,
                score = 60,
                ranges = emptyList()
            )
            else -> null
        }
    }

    private fun fuzzyMatch(query: String, fileName: String, filePath: String): MatchResult? {
        val nameScore = calculateFuzzyScore(query, fileName)
        val pathScore = calculateFuzzyScore(query, filePath) * 0.5f  // Path matches worth less

        return when {
            nameScore > 0.5f -> MatchResult(
                matchType = MatchType.FUZZY_NAME,
                score = (nameScore * 100).toInt(),
                ranges = emptyList()
            )
            pathScore > 0.3f -> MatchResult(
                matchType = MatchType.FUZZY_PATH,
                score = (pathScore * 100).toInt(),
                ranges = emptyList()
            )
            else -> null
        }
    }

    private fun matchRegex(query: String, fileName: String, filePath: String): MatchResult? {
        return try {
            val pattern = Pattern.compile(query, Pattern.CASE_INSENSITIVE)
            when {
                pattern.matcher(fileName).find() -> MatchResult(
                    matchType = MatchType.REGEX_NAME,
                    score = 90,
                    ranges = emptyList()
                )
                pattern.matcher(filePath).find() -> MatchResult(
                    matchType = MatchType.REGEX_PATH,
                    score = 70,
                    ranges = emptyList()
                )
                else -> null
            }
        } catch (e: PatternSyntaxException) {
            null
        }
    }

    private fun wholeWordMatch(query: String, fileName: String): MatchResult? {
        val pattern = Pattern.compile("\\b${Pattern.quote(query)}\\b", Pattern.CASE_INSENSITIVE)
        return if (pattern.matcher(fileName).find()) {
            MatchResult(
                matchType = MatchType.WHOLE_WORD,
                score = 95,
                ranges = emptyList()
            )
        } else null
    }

    /**
     * Calculate fuzzy match score (0.0 - 1.0)
     * Uses simplified Levenshtein-based scoring
     */
    private fun calculateFuzzyScore(query: String, target: String): Float {
        if (query.isEmpty() || target.isEmpty()) return 0f
        if (query == target) return 1f
        if (target.contains(query)) return 0.9f

        // Check if all query characters appear in order
        var queryIdx = 0
        var consecutiveMatches = 0
        var totalMatches = 0
        var lastMatchIdx = -1

        for (i in target.indices) {
            if (queryIdx < query.length && target[i] == query[queryIdx]) {
                totalMatches++
                if (lastMatchIdx == i - 1) consecutiveMatches++
                lastMatchIdx = i
                queryIdx++
            }
        }

        if (queryIdx < query.length) return 0f  // Not all chars found

        // Score based on match quality
        val matchRatio = totalMatches.toFloat() / target.length
        val consecutiveBonus = consecutiveMatches.toFloat() / query.length * 0.3f

        return (matchRatio + consecutiveBonus).coerceIn(0f, 1f)
    }

    private fun findMatchRanges(text: String, query: String): List<IntRange> {
        val ranges = mutableListOf<IntRange>()
        var start = 0

        while (true) {
            val idx = text.indexOf(query, start, ignoreCase = true)
            if (idx == -1) break
            ranges.add(idx until (idx + query.length))
            start = idx + 1
        }

        return ranges
    }

    private fun findContentMatches(
        query: String,
        content: String,
        pattern: Pattern?,
        options: SearchOptions
    ): List<ContentMatch> {
        val matches = mutableListOf<ContentMatch>()
        val lines = content.lines()

        lines.forEachIndexed { lineIndex, line ->
            val matcher = if (pattern != null) {
                pattern.matcher(line)
            } else {
                val searchLine = if (options.caseSensitive) line else line.lowercase()
                val searchQuery = if (options.caseSensitive) query else query.lowercase()

                if (searchLine.contains(searchQuery)) {
                    // Create simple matcher result
                    var idx = 0
                    while (true) {
                        val foundIdx = searchLine.indexOf(searchQuery, idx)
                        if (foundIdx == -1) break

                        val preview = createPreview(line, foundIdx, query.length)
                        matches.add(
                            ContentMatch(
                                lineNumber = lineIndex + 1,
                                columnStart = foundIdx,
                                columnEnd = foundIdx + query.length,
                                lineContent = line,
                                preview = preview
                            )
                        )
                        idx = foundIdx + 1
                    }
                }
                null
            }

            if (matcher != null) {
                while (matcher.find()) {
                    val preview = createPreview(line, matcher.start(), matcher.end() - matcher.start())
                    matches.add(
                        ContentMatch(
                            lineNumber = lineIndex + 1,
                            columnStart = matcher.start(),
                            columnEnd = matcher.end(),
                            lineContent = line,
                            preview = preview
                        )
                    )
                }
            }
        }

        return matches.take(50)  // Limit matches per file
    }

    private fun createPreview(line: String, matchStart: Int, matchLength: Int): String {
        val contextSize = 30
        val start = maxOf(0, matchStart - contextSize)
        val end = minOf(line.length, matchStart + matchLength + contextSize)

        return buildString {
            if (start > 0) append("...")
            append(line.substring(start, end))
            if (end < line.length) append("...")
        }.take(MAX_CONTENT_PREVIEW_LENGTH)
    }

    private fun isBinaryFile(extension: String?): Boolean {
        return extension?.lowercase() in listOf(
            "png", "jpg", "jpeg", "gif", "bmp", "ico", "webp",
            "mp3", "mp4", "wav", "avi", "mkv", "mov",
            "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx",
            "zip", "rar", "7z", "tar", "gz",
            "exe", "dll", "so", "dylib",
            "class", "dex", "apk", "aar"
        )
    }

    private fun addToSearchHistory(query: String) {
        if (query.isBlank()) return

        val current = _searchHistory.value.toMutableList()
        current.remove(query)
        current.add(0, query)

        _searchHistory.value = current.take(MAX_SEARCH_HISTORY)
    }

    /**
     * Clear search history
     */
    fun clearHistory() {
        _searchHistory.value = emptyList()
    }

    /**
     * Clear current search state
     */
    fun clearSearch() {
        _searchState.value = SearchState()
    }

    /**
     * Get search suggestions based on history and file names
     */
    fun getSuggestions(
        query: String,
        files: List<ProjectFileEntity>
    ): List<SearchSuggestion> {
        if (query.isBlank()) {
            // Return recent searches
            return _searchHistory.value.take(5).map {
                SearchSuggestion(text = it, type = SuggestionType.HISTORY)
            }
        }

        val suggestions = mutableListOf<SearchSuggestion>()

        // Add matching history items
        _searchHistory.value
            .filter { it.contains(query, ignoreCase = true) }
            .take(3)
            .forEach {
                suggestions.add(SearchSuggestion(text = it, type = SuggestionType.HISTORY))
            }

        // Add matching file names
        files
            .filter { it.name.contains(query, ignoreCase = true) }
            .take(5)
            .forEach {
                suggestions.add(SearchSuggestion(text = it.name, type = SuggestionType.FILE))
            }

        return suggestions.distinctBy { it.text }.take(8)
    }
}

// --- Data classes ---

@Immutable
data class SearchState(
    val isSearching: Boolean = false,
    val lastQuery: String = "",
    val resultCount: Int = 0,
    val error: String? = null
)

data class SearchOptions(
    val caseSensitive: Boolean = false,
    val wholeWord: Boolean = false,
    val useRegex: Boolean = false,
    val fuzzyMatch: Boolean = true,
    val includeFolders: Boolean = false,
    val searchContent: Boolean = false
)

data class FileSearchResult(
    val file: ProjectFileEntity,
    val matchType: MatchType,
    val matchScore: Int,
    val matchRanges: List<IntRange>,
    val preview: String?
)

data class ContentSearchResult(
    val file: ProjectFileEntity,
    val matches: List<ContentMatch>,
    val matchCount: Int
)

data class ContentMatch(
    val lineNumber: Int,
    val columnStart: Int,
    val columnEnd: Int,
    val lineContent: String,
    val preview: String
)

data class CombinedSearchResult(
    val fileMatches: List<FileSearchResult>,
    val contentMatches: List<ContentSearchResult>,
    val totalCount: Int
)

data class SearchSuggestion(
    val text: String,
    val type: SuggestionType
)

enum class SuggestionType {
    HISTORY,
    FILE,
    FOLDER,
    EXTENSION
}

enum class MatchType {
    NAME_CONTAINS,
    PATH_CONTAINS,
    FUZZY_NAME,
    FUZZY_PATH,
    REGEX_NAME,
    REGEX_PATH,
    WHOLE_WORD
}

private data class MatchResult(
    val matchType: MatchType,
    val score: Int,
    val ranges: List<IntRange>
)
