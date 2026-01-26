package com.chainlesschain.android.feature.project.ui.components

/**
 * Code folding manager for code editor
 *
 * Detects and manages foldable code regions:
 * - Function/method bodies
 * - Class/struct bodies
 * - Block comments
 * - Control flow blocks (if, for, while, etc.)
 * - Import statements
 */
class CodeFoldingManager(
    private val language: String?
) {
    // Folded regions (line ranges)
    private val foldedRegions = mutableSetOf<IntRange>()

    /**
     * Detect foldable regions in code
     */
    fun detectFoldableRegions(content: String): List<FoldableRegion> {
        val lines = content.lines()
        return when (language?.lowercase()) {
            "kt", "kotlin" -> detectKotlinRegions(lines)
            "java" -> detectJavaRegions(lines)
            "py", "python" -> detectPythonRegions(lines)
            "js", "javascript", "ts", "typescript" -> detectJavaScriptRegions(lines)
            "swift" -> detectSwiftRegions(lines)
            else -> emptyList()
        }
    }

    /**
     * Toggle fold state for a region
     */
    fun toggleFold(region: FoldableRegion) {
        val range = region.startLine..region.endLine
        if (range in foldedRegions) {
            foldedRegions.remove(range)
        } else {
            foldedRegions.add(range)
        }
    }

    /**
     * Check if a line is in a folded region
     */
    fun isLineFolded(lineNumber: Int): Boolean {
        return foldedRegions.any { lineNumber in it }
    }

    /**
     * Check if a region is folded
     */
    fun isRegionFolded(region: FoldableRegion): Boolean {
        return (region.startLine..region.endLine) in foldedRegions
    }

    /**
     * Get visible lines (excluding folded regions)
     */
    fun getVisibleLines(totalLines: Int): List<Int> {
        val allLines = (0 until totalLines).toSet()
        val hiddenLines = foldedRegions.flatMap { range ->
            // Keep the start line visible (shows "...")
            (range.first + 1..range.last).toList()
        }.toSet()
        return (allLines - hiddenLines).sorted()
    }

    /**
     * Fold all regions
     */
    fun foldAll(regions: List<FoldableRegion>) {
        foldedRegions.clear()
        foldedRegions.addAll(regions.map { it.startLine..it.endLine })
    }

    /**
     * Unfold all regions
     */
    fun unfoldAll() {
        foldedRegions.clear()
    }

    // Language-specific region detection

    private fun detectKotlinRegions(lines: List<String>): List<FoldableRegion> {
        val regions = mutableListOf<FoldableRegion>()
        val stack = mutableListOf<Pair<Int, FoldableRegionType>>() // (lineIndex, type)

        // Detect import groups
        regions.addAll(detectImportGroups(lines))

        lines.forEachIndexed { index, line ->
            val trimmed = line.trim()

            // Function/class/object declaration
            when {
                trimmed.startsWith("fun ") ||
                trimmed.startsWith("class ") ||
                trimmed.startsWith("object ") ||
                trimmed.startsWith("interface ") ||
                trimmed.startsWith("enum class ") ||
                trimmed.contains(" class {") ||
                trimmed.contains(" object {") -> {
                    if (trimmed.endsWith("{")) {
                        val type = when {
                            trimmed.startsWith("fun ") -> FoldableRegionType.FUNCTION
                            else -> FoldableRegionType.CLASS
                        }
                        stack.add(index to type)
                    }
                }
                // Control flow blocks
                trimmed.startsWith("if ") ||
                trimmed.startsWith("if(") ||
                trimmed.startsWith("else if ") ||
                trimmed.startsWith("else if(") ||
                trimmed.startsWith("else {") ||
                trimmed.startsWith("when ") ||
                trimmed.startsWith("when(") ||
                trimmed.startsWith("for ") ||
                trimmed.startsWith("for(") ||
                trimmed.startsWith("while ") ||
                trimmed.startsWith("while(") ||
                trimmed.startsWith("do {") -> {
                    if (trimmed.endsWith("{")) {
                        stack.add(index to FoldableRegionType.CONTROL_FLOW)
                    }
                }
                trimmed.startsWith("/*") && !trimmed.endsWith("*/") -> {
                    stack.add(index to FoldableRegionType.COMMENT)
                }
                trimmed.endsWith("*/") && stack.lastOrNull()?.second == FoldableRegionType.COMMENT -> {
                    val (start, type) = stack.removeLast()
                    if (index > start) {
                        regions.add(FoldableRegion(start, index, type, lines[start].trim()))
                    }
                }
                trimmed == "}" && stack.isNotEmpty() -> {
                    val (start, type) = stack.removeLast()
                    if (index > start && type != FoldableRegionType.COMMENT) {
                        regions.add(FoldableRegion(start, index, type, lines[start].trim()))
                    }
                }
            }
        }

        return regions
    }

    private fun detectJavaRegions(lines: List<String>): List<FoldableRegion> {
        val regions = mutableListOf<FoldableRegion>()
        val stack = mutableListOf<Pair<Int, FoldableRegionType>>()

        // Detect import groups
        regions.addAll(detectImportGroups(lines))

        lines.forEachIndexed { index, line ->
            val trimmed = line.trim()

            when {
                (trimmed.startsWith("public ") || trimmed.startsWith("private ") ||
                 trimmed.startsWith("protected ")) &&
                (trimmed.contains(" class ") || trimmed.contains(" interface ") ||
                 trimmed.contains(" enum ")) -> {
                    if (trimmed.endsWith("{")) {
                        stack.add(index to FoldableRegionType.CLASS)
                    }
                }
                trimmed.matches(Regex(".*\\s+\\w+\\s*\\([^)]*\\)\\s*\\{.*")) -> {
                    // Method declaration
                    stack.add(index to FoldableRegionType.FUNCTION)
                }
                // Control flow blocks
                trimmed.startsWith("if ") ||
                trimmed.startsWith("if(") ||
                trimmed.startsWith("else if ") ||
                trimmed.startsWith("else if(") ||
                trimmed.startsWith("else {") ||
                trimmed.startsWith("switch ") ||
                trimmed.startsWith("switch(") ||
                trimmed.startsWith("for ") ||
                trimmed.startsWith("for(") ||
                trimmed.startsWith("while ") ||
                trimmed.startsWith("while(") ||
                trimmed.startsWith("do {") ||
                trimmed.startsWith("try {") ||
                trimmed.startsWith("catch ") ||
                trimmed.startsWith("catch(") ||
                trimmed.startsWith("finally {") -> {
                    if (trimmed.endsWith("{")) {
                        stack.add(index to FoldableRegionType.CONTROL_FLOW)
                    }
                }
                trimmed.startsWith("/*") && !trimmed.endsWith("*/") -> {
                    stack.add(index to FoldableRegionType.COMMENT)
                }
                trimmed.endsWith("*/") && stack.lastOrNull()?.second == FoldableRegionType.COMMENT -> {
                    val (start, type) = stack.removeLast()
                    if (index > start) {
                        regions.add(FoldableRegion(start, index, type, lines[start].trim()))
                    }
                }
                trimmed == "}" && stack.isNotEmpty() -> {
                    val (start, type) = stack.removeLast()
                    if (index > start && type != FoldableRegionType.COMMENT) {
                        regions.add(FoldableRegion(start, index, type, lines[start].trim()))
                    }
                }
            }
        }

        return regions
    }

    private fun detectPythonRegions(lines: List<String>): List<FoldableRegion> {
        val regions = mutableListOf<FoldableRegion>()
        var currentIndent = 0
        var blockStart: Int? = null
        var blockType: FoldableRegionType? = null

        lines.forEachIndexed { index, line ->
            if (line.isBlank()) return@forEachIndexed

            val indent = line.takeWhile { it.isWhitespace() }.length
            val trimmed = line.trim()

            when {
                trimmed.startsWith("def ") -> {
                    blockStart?.let { start ->
                        regions.add(FoldableRegion(start, index - 1, blockType!!, lines[start].trim()))
                    }
                    blockStart = index
                    blockType = FoldableRegionType.FUNCTION
                    currentIndent = indent
                }
                trimmed.startsWith("class ") -> {
                    blockStart?.let { start ->
                        regions.add(FoldableRegion(start, index - 1, blockType!!, lines[start].trim()))
                    }
                    blockStart = index
                    blockType = FoldableRegionType.CLASS
                    currentIndent = indent
                }
                trimmed.startsWith("\"\"\"") || trimmed.startsWith("'''") -> {
                    // Multiline string/docstring
                    val quote = if (trimmed.startsWith("\"\"\"")) "\"\"\"" else "'''"
                    if (trimmed.indexOf(quote, 3) == -1) {
                        // Start of multiline
                        blockStart = index
                        blockType = FoldableRegionType.COMMENT
                        currentIndent = indent
                    } else if (blockType == FoldableRegionType.COMMENT && blockStart != null) {
                        // End of multiline
                        val start = blockStart!!
                        val type = blockType!!
                        regions.add(FoldableRegion(start, index, type, lines[start].trim()))
                        blockStart = null
                        blockType = null
                    }
                }
                indent <= currentIndent && blockStart != null -> {
                    // End of current block
                    val start = blockStart!!
                    val type = blockType!!
                    regions.add(FoldableRegion(start, index - 1, type, lines[start].trim()))
                    blockStart = null
                    blockType = null
                }
            }
        }

        // Close last block if any
        blockStart?.let { start ->
            val type = blockType!!
            regions.add(FoldableRegion(start, lines.size - 1, type, lines[start].trim()))
        }

        return regions
    }

    private fun detectJavaScriptRegions(lines: List<String>): List<FoldableRegion> {
        val regions = mutableListOf<FoldableRegion>()
        val stack = mutableListOf<Pair<Int, FoldableRegionType>>()

        // Detect import groups
        regions.addAll(detectImportGroups(lines))

        lines.forEachIndexed { index, line ->
            val trimmed = line.trim()

            when {
                trimmed.startsWith("function ") ||
                trimmed.matches(Regex("^(const|let|var)\\s+\\w+\\s*=\\s*\\([^)]*\\)\\s*=>\\s*\\{.*")) ||
                trimmed.matches(Regex("^\\w+\\s*\\([^)]*\\)\\s*\\{.*")) -> {
                    if (trimmed.endsWith("{")) {
                        stack.add(index to FoldableRegionType.FUNCTION)
                    }
                }
                trimmed.startsWith("class ") -> {
                    if (trimmed.endsWith("{")) {
                        stack.add(index to FoldableRegionType.CLASS)
                    }
                }
                // Control flow blocks
                trimmed.startsWith("if ") ||
                trimmed.startsWith("if(") ||
                trimmed.startsWith("else if ") ||
                trimmed.startsWith("else if(") ||
                trimmed.startsWith("else {") ||
                trimmed.startsWith("switch ") ||
                trimmed.startsWith("switch(") ||
                trimmed.startsWith("for ") ||
                trimmed.startsWith("for(") ||
                trimmed.startsWith("while ") ||
                trimmed.startsWith("while(") ||
                trimmed.startsWith("do {") ||
                trimmed.startsWith("try {") ||
                trimmed.startsWith("catch ") ||
                trimmed.startsWith("catch(") ||
                trimmed.startsWith("finally {") -> {
                    if (trimmed.endsWith("{")) {
                        stack.add(index to FoldableRegionType.CONTROL_FLOW)
                    }
                }
                trimmed.startsWith("/*") && !trimmed.endsWith("*/") -> {
                    stack.add(index to FoldableRegionType.COMMENT)
                }
                trimmed.endsWith("*/") && stack.lastOrNull()?.second == FoldableRegionType.COMMENT -> {
                    val (start, type) = stack.removeLast()
                    if (index > start) {
                        regions.add(FoldableRegion(start, index, type, lines[start].trim()))
                    }
                }
                trimmed == "}" && stack.isNotEmpty() -> {
                    val (start, type) = stack.removeLast()
                    if (index > start && type != FoldableRegionType.COMMENT) {
                        regions.add(FoldableRegion(start, index, type, lines[start].trim()))
                    }
                }
            }
        }

        return regions
    }

    private fun detectSwiftRegions(lines: List<String>): List<FoldableRegion> {
        // Similar to Kotlin but with Swift-specific syntax
        val regions = mutableListOf<FoldableRegion>()
        val stack = mutableListOf<Pair<Int, FoldableRegionType>>()

        // Detect import groups
        regions.addAll(detectImportGroups(lines))

        lines.forEachIndexed { index, line ->
            val trimmed = line.trim()

            when {
                trimmed.startsWith("func ") ||
                trimmed.startsWith("class ") ||
                trimmed.startsWith("struct ") ||
                trimmed.startsWith("enum ") ||
                trimmed.startsWith("protocol ") ||
                trimmed.startsWith("extension ") -> {
                    if (trimmed.endsWith("{")) {
                        val type = if (trimmed.startsWith("func "))
                            FoldableRegionType.FUNCTION else FoldableRegionType.CLASS
                        stack.add(index to type)
                    }
                }
                // Control flow blocks
                trimmed.startsWith("if ") ||
                trimmed.startsWith("else if ") ||
                trimmed.startsWith("else {") ||
                trimmed.startsWith("guard ") ||
                trimmed.startsWith("switch ") ||
                trimmed.startsWith("for ") ||
                trimmed.startsWith("while ") ||
                trimmed.startsWith("do {") ||
                trimmed.startsWith("catch ") -> {
                    if (trimmed.endsWith("{")) {
                        stack.add(index to FoldableRegionType.CONTROL_FLOW)
                    }
                }
                trimmed.startsWith("/*") && !trimmed.endsWith("*/") -> {
                    stack.add(index to FoldableRegionType.COMMENT)
                }
                trimmed.endsWith("*/") && stack.lastOrNull()?.second == FoldableRegionType.COMMENT -> {
                    val (start, type) = stack.removeLast()
                    if (index > start) {
                        regions.add(FoldableRegion(start, index, type, lines[start].trim()))
                    }
                }
                trimmed == "}" && stack.isNotEmpty() -> {
                    val (start, type) = stack.removeLast()
                    if (index > start && type != FoldableRegionType.COMMENT) {
                        regions.add(FoldableRegion(start, index, type, lines[start].trim()))
                    }
                }
            }
        }

        return regions
    }

    /**
     * Detect import grouping regions
     *
     * Groups consecutive import statements into a foldable region
     */
    private fun detectImportGroups(lines: List<String>): List<FoldableRegion> {
        val regions = mutableListOf<FoldableRegion>()
        var importStart: Int? = null
        var lastImportLine: Int? = null

        lines.forEachIndexed { index, line ->
            val trimmed = line.trim()

            if (trimmed.startsWith("import ") || trimmed.startsWith("from ")) {
                if (importStart == null) {
                    importStart = index
                }
                lastImportLine = index
            } else if (trimmed.isNotBlank() && importStart != null && lastImportLine != null) {
                // End of import group (non-blank, non-import line)
                val start = importStart!!
                val end = lastImportLine!!

                // Only create region if there are at least 3 imports
                if (end - start >= 2) {
                    regions.add(FoldableRegion(
                        startLine = start,
                        endLine = end,
                        type = FoldableRegionType.IMPORT,
                        preview = "imports (${end - start + 1} lines)"
                    ))
                }

                importStart = null
                lastImportLine = null
            }
        }

        // Handle imports at end of file
        if (importStart != null && lastImportLine != null) {
            val start = importStart!!
            val end = lastImportLine!!
            if (end - start >= 2) {
                regions.add(FoldableRegion(
                    startLine = start,
                    endLine = end,
                    type = FoldableRegionType.IMPORT,
                    preview = "imports (${end - start + 1} lines)"
                ))
            }
        }

        return regions
    }
}

/**
 * Foldable code region
 */
data class FoldableRegion(
    val startLine: Int,
    val endLine: Int,
    val type: FoldableRegionType,
    val preview: String // First line content for preview
)

/**
 * Type of foldable region
 */
enum class FoldableRegionType {
    FUNCTION,
    CLASS,
    COMMENT,
    IMPORT,
    CONTROL_FLOW
}
