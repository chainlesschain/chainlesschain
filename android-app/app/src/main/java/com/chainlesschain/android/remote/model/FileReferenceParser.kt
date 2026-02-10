package com.chainlesschain.android.remote.model

/**
 * Parser for @file references in chat input
 *
 * Supports formats:
 * - @filename.ext
 * - @path/to/file.ext
 * - @"file with spaces.ext"
 */
object FileReferenceParser {

    // Regex patterns for file references
    private val SIMPLE_FILE_PATTERN = Regex("""@([a-zA-Z0-9_\-./\\]+\.[a-zA-Z0-9]+)""")
    private val QUOTED_FILE_PATTERN = Regex("""@"([^"]+)"""")
    private val AT_TRIGGER_PATTERN = Regex("""@(\S*)$""")

    /**
     * Parse all @file references from input text
     *
     * @param input The chat input text
     * @return List of FileReference objects found in the input
     */
    fun parse(input: String): List<FileReference> {
        val references = mutableListOf<FileReference>()

        // First, find quoted file references
        QUOTED_FILE_PATTERN.findAll(input).forEach { match ->
            val path = match.groupValues[1]
            references.add(FileReference.fromPath(path))
        }

        // Then find simple file references (not already captured by quoted)
        SIMPLE_FILE_PATTERN.findAll(input).forEach { match ->
            val path = match.groupValues[1]
            // Avoid duplicates
            if (references.none { it.path == path }) {
                references.add(FileReference.fromPath(path))
            }
        }

        return references
    }

    /**
     * Check if the user is currently typing an @ reference
     *
     * @param input Current input text
     * @param cursorPosition Current cursor position
     * @return The partial file name being typed, or null if not typing a reference
     */
    fun getPartialReference(input: String, cursorPosition: Int): String? {
        if (cursorPosition > input.length) return null

        val textBeforeCursor = input.substring(0, cursorPosition)
        val match = AT_TRIGGER_PATTERN.find(textBeforeCursor)

        return match?.groupValues?.get(1)
    }

    /**
     * Check if file picker should be shown
     *
     * @param input Current input text
     * @param cursorPosition Current cursor position
     * @return true if user just typed @ and file picker should appear
     */
    fun shouldShowFilePicker(input: String, cursorPosition: Int): Boolean {
        if (cursorPosition <= 0 || cursorPosition > input.length) return false

        // Check if user just typed @
        if (input[cursorPosition - 1] == '@') {
            // Make sure it's not escaped or part of an email
            val before = if (cursorPosition > 1) input[cursorPosition - 2] else ' '
            return before == ' ' || before == '\n' || before == '\t' || cursorPosition == 1
        }

        return false
    }

    /**
     * Insert a file reference at the current cursor position
     *
     * @param input Current input text
     * @param cursorPosition Current cursor position
     * @param file The file to reference
     * @return Pair of (new input text, new cursor position)
     */
    fun insertReference(input: String, cursorPosition: Int, file: FileReference): Pair<String, Int> {
        val partialRef = getPartialReference(input, cursorPosition)

        // Format the file reference
        val refText = if (file.path.contains(" ")) {
            "@\"${file.path}\""
        } else {
            "@${file.path}"
        }

        return if (partialRef != null) {
            // Replace the partial reference
            val atPosition = cursorPosition - partialRef.length - 1 // -1 for @
            val before = input.substring(0, atPosition)
            val after = input.substring(cursorPosition)
            val newText = "$before$refText $after"
            val newPosition = atPosition + refText.length + 1
            Pair(newText, newPosition)
        } else {
            // Insert at cursor position
            val before = input.substring(0, cursorPosition)
            val after = input.substring(cursorPosition)
            val newText = "$before$refText $after"
            val newPosition = cursorPosition + refText.length + 1
            Pair(newText, newPosition)
        }
    }

    /**
     * Remove file references from text (get plain message)
     *
     * @param input Input text with references
     * @return Text with references removed
     */
    fun stripReferences(input: String): String {
        var result = input

        // Remove quoted references
        result = QUOTED_FILE_PATTERN.replace(result, "")

        // Remove simple references
        result = SIMPLE_FILE_PATTERN.replace(result, "")

        // Clean up extra spaces
        return result.replace(Regex("""\s+"""), " ").trim()
    }

    /**
     * Highlight file references in text for display
     *
     * @param input Input text with references
     * @return List of text segments with reference flags
     */
    fun segmentText(input: String): List<TextSegment> {
        val segments = mutableListOf<TextSegment>()
        var lastEnd = 0

        // Combine all matches and sort by position
        val allMatches = mutableListOf<MatchResult>()
        allMatches.addAll(QUOTED_FILE_PATTERN.findAll(input).toList())
        allMatches.addAll(SIMPLE_FILE_PATTERN.findAll(input).toList())
        allMatches.sortBy { it.range.first }

        // Remove overlapping matches (prefer quoted)
        val filteredMatches = mutableListOf<MatchResult>()
        for (match in allMatches) {
            if (filteredMatches.none { it.range.first <= match.range.first && it.range.last >= match.range.last }) {
                filteredMatches.add(match)
            }
        }

        for (match in filteredMatches) {
            // Add text before the match
            if (match.range.first > lastEnd) {
                segments.add(TextSegment(input.substring(lastEnd, match.range.first), false))
            }

            // Add the reference
            segments.add(TextSegment(match.value, true))
            lastEnd = match.range.last + 1
        }

        // Add remaining text
        if (lastEnd < input.length) {
            segments.add(TextSegment(input.substring(lastEnd), false))
        }

        return segments
    }

    /**
     * Filter files by partial name
     *
     * @param files Available files
     * @param query Partial file name query
     * @return Filtered and sorted list of matching files
     */
    fun filterFiles(files: List<FileReference>, query: String): List<FileReference> {
        if (query.isEmpty()) return files.take(10)

        val lowerQuery = query.lowercase()

        return files
            .filter { file ->
                file.name.lowercase().contains(lowerQuery) ||
                file.path.lowercase().contains(lowerQuery)
            }
            .sortedWith(compareBy(
                // Prioritize name starts with query
                { !it.name.lowercase().startsWith(lowerQuery) },
                // Then by name length (shorter is better)
                { it.name.length },
                // Then alphabetically
                { it.name.lowercase() }
            ))
            .take(10)
    }
}

/**
 * Text segment for highlighted display
 */
data class TextSegment(
    val text: String,
    val isReference: Boolean
)
