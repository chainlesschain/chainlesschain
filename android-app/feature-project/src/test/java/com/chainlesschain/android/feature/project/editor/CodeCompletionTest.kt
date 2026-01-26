package com.chainlesschain.android.feature.project.editor

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.runTest
import org.junit.Before
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Unit tests for CodeCompletionEngine
 *
 * Tests:
 * 1. Keyword completion for multiple languages
 * 2. Snippet expansion with tab stops
 * 3. Symbol extraction from file content
 * 4. Local variable detection
 * 5. Context-aware filtering
 * 6. Priority sorting
 * 7. Completion application
 */
@OptIn(ExperimentalCoroutinesApi::class)
class CodeCompletionTest {

    private lateinit var completionEngine: CodeCompletionEngine
    private lateinit var keywordProvider: KeywordProvider
    private lateinit var snippetProvider: SnippetProvider
    private lateinit var scopeAnalyzer: ScopeAnalyzer
    private lateinit var contextAnalyzer: ContextAnalyzer

    @Before
    fun setup() {
        completionEngine = CodeCompletionEngine()
        keywordProvider = KeywordProvider
        snippetProvider = SnippetProvider
        scopeAnalyzer = ScopeAnalyzer
        contextAnalyzer = ContextAnalyzer
    }

    /**
     * Test 1: Kotlin keyword completion
     */
    @Test
    fun `getKeywords should return Kotlin keywords`() {
        // When
        val keywords = keywordProvider.getKeywords("kotlin")

        // Then
        assertTrue(keywords.size > 50) // At least 50 Kotlin keywords
        assertTrue(keywords.any { it.label == "fun" })
        assertTrue(keywords.any { it.label == "class" })
        assertTrue(keywords.any { it.label == "when" })
        assertTrue(keywords.any { it.label == "suspend" })
    }

    /**
     * Test 2: Java keyword completion
     */
    @Test
    fun `getKeywords should return Java keywords`() {
        // When
        val keywords = keywordProvider.getKeywords("java")

        // Then
        assertTrue(keywords.size > 40)
        assertTrue(keywords.any { it.label == "public" })
        assertTrue(keywords.any { it.label == "class" })
        assertTrue(keywords.any { it.label == "interface" })
        assertTrue(keywords.any { it.label == "synchronized" })
    }

    /**
     * Test 3: Python keyword completion
     */
    @Test
    fun `getKeywords should return Python keywords`() {
        // When
        val keywords = keywordProvider.getKeywords("python")

        // Then
        assertTrue(keywords.size > 30)
        assertTrue(keywords.any { it.label == "def" })
        assertTrue(keywords.any { it.label == "class" })
        assertTrue(keywords.any { it.label == "async" })
        assertTrue(keywords.any { it.label == "lambda" })
    }

    /**
     * Test 4: Language detection from file extension
     */
    @Test
    fun `detectLanguage should identify language from extension`() {
        // When/Then
        assertEquals("kotlin", keywordProvider.detectLanguage("MyFile.kt"))
        assertEquals("java", keywordProvider.detectLanguage("MyClass.java"))
        assertEquals("python", keywordProvider.detectLanguage("script.py"))
        assertEquals("javascript", keywordProvider.detectLanguage("app.js"))
        assertEquals("typescript", keywordProvider.detectLanguage("component.tsx"))
        assertEquals("unknown", keywordProvider.detectLanguage("data.json"))
    }

    /**
     * Test 5: Snippet retrieval for Kotlin
     */
    @Test
    fun `getSnippets should return Kotlin snippets`() {
        // When
        val snippets = snippetProvider.getSnippets("kotlin")

        // Then
        assertTrue(snippets.size >= 15)
        assertTrue(snippets.any { it.label == "fun" })
        assertTrue(snippets.any { it.label == "class" })
        assertTrue(snippets.any { it.label == "when" })
    }

    /**
     * Test 6: Snippet tab stop parsing
     */
    @Test
    fun `parseTabStops should extract placeholders correctly`() {
        // Given
        val snippet = CodeSnippet(
            label = "fun",
            description = "Function",
            template = "fun \${1:functionName}(\${2:params}): \${3:Unit} {\n    \${0:// TODO}\n}"
        )

        // When
        val tabStops = snippet.parseTabStops()

        // Then
        assertEquals(4, tabStops.size)
        assertEquals(0, tabStops[0].order)
        assertEquals("// TODO", tabStops[0].placeholder)
        assertEquals(1, tabStops[1].order)
        assertEquals("functionName", tabStops[1].placeholder)
    }

    /**
     * Test 7: Extract functions from Kotlin code
     */
    @Test
    fun `analyzeKotlin should extract function symbols`() {
        // Given
        val kotlinCode = """
            package com.example

            fun greet(name: String) {
                println("Hello, ${"$"}name")
            }

            private suspend fun fetchData() {
                // Implementation
            }
        """.trimIndent()

        // When
        val symbols = scopeAnalyzer.analyzeFile(kotlinCode, "kotlin")

        // Then
        val functions = symbols.filter { it.type == SymbolType.FUNCTION }
        assertEquals(2, functions.size)
        assertTrue(functions.any { it.name == "greet" })
        assertTrue(functions.any { it.name == "fetchData" })
    }

    /**
     * Test 8: Extract classes from Kotlin code
     */
    @Test
    fun `analyzeKotlin should extract class symbols`() {
        // Given
        val kotlinCode = """
            data class User(val name: String, val age: Int)

            class Repository {
                fun getData() {}
            }

            object Constants {
                const val MAX_SIZE = 100
            }
        """.trimIndent()

        // When
        val symbols = scopeAnalyzer.analyzeFile(kotlinCode, "kotlin")

        // Then
        val classes = symbols.filter { it.type == SymbolType.CLASS }
        assertEquals(3, classes.size) // User, Repository, Constants
        assertTrue(classes.any { it.name == "User" })
        assertTrue(classes.any { it.name == "Repository" })
        assertTrue(classes.any { it.name == "Constants" })
    }

    /**
     * Test 9: Extract local variables
     */
    @Test
    fun `extractLocalVariables should find variables in scope`() {
        // Given
        val kotlinCode = """
            fun calculate() {
                val x = 10
                var y = 20
                val result = x + y
                // Cursor here
            }
        """.trimIndent()

        val cursorPosition = kotlinCode.indexOf("// Cursor")

        // When
        val localVars = scopeAnalyzer.extractLocalVariables(kotlinCode, cursorPosition, "kotlin")

        // Then
        assertTrue(localVars.size >= 3)
        assertTrue(localVars.any { it.name == "x" })
        assertTrue(localVars.any { it.name == "y" })
        assertTrue(localVars.any { it.name == "result" })
    }

    /**
     * Test 10: Detect import statement context
     */
    @Test
    fun `analyzeContext should detect import statement`() {
        // Given
        val code = "import com.example."
        val cursorPosition = code.length

        // When
        val context = contextAnalyzer.analyzeContext(code, cursorPosition, "kotlin")

        // Then
        assertEquals(CompletionContext.ImportStatement, context)
    }

    /**
     * Test 11: Detect member access context
     */
    @Test
    fun `analyzeContext should detect member access`() {
        // Given
        val code = "user."
        val cursorPosition = code.length

        // When
        val context = contextAnalyzer.analyzeContext(code, cursorPosition, "kotlin")

        // Then
        assertEquals(CompletionContext.MemberAccess, context)
    }

    /**
     * Test 12: Filter completions by context
     */
    @Test
    fun `filterByContext should filter for import statements`() {
        // Given
        val completions = listOf(
            CompletionItem("MyClass", CompletionItemType.CLASS, "Class"),
            CompletionItem("myFunction", CompletionItemType.FUNCTION, "Function"),
            CompletionItem("myVariable", CompletionItemType.VARIABLE, "Variable")
        )

        // When
        val filtered = contextAnalyzer.filterByContext(
            completions,
            CompletionContext.ImportStatement
        )

        // Then
        assertEquals(1, filtered.size)
        assertEquals("MyClass", filtered[0].label)
        assertEquals(CompletionItemType.CLASS, filtered[0].type)
    }

    /**
     * Test 13: Filter completions for member access
     */
    @Test
    fun `filterByContext should filter for member access`() {
        // Given
        val completions = listOf(
            CompletionItem("MyClass", CompletionItemType.CLASS, "Class"),
            CompletionItem("getName", CompletionItemType.FUNCTION, "Function"),
            CompletionItem("age", CompletionItemType.VARIABLE, "Property")
        )

        // When
        val filtered = contextAnalyzer.filterByContext(
            completions,
            CompletionContext.MemberAccess
        )

        // Then
        assertEquals(2, filtered.size)
        assertTrue(filtered.all {
            it.type == CompletionItemType.FUNCTION || it.type == CompletionItemType.VARIABLE
        })
    }

    /**
     * Test 14: Extract prefix from cursor position
     */
    @Test
    fun `extractPrefix should get word before cursor`() {
        // Given
        val code = "fun myFunc"
        val cursorPosition = code.length

        // When
        val prefix = completionEngine.extractPrefix(code, cursorPosition)

        // Then
        assertEquals("myFunc", prefix)
    }

    /**
     * Test 15: Apply completion to text
     */
    @Test
    fun `applyCompletion should replace prefix with completion`() {
        // Given
        val code = "fun myFu"
        val cursorPosition = code.length
        val completion = CompletionItem(
            label = "myFunction",
            type = CompletionItemType.SNIPPET,
            description = "Function",
            insertText = "myFunction()"
        )

        // When
        val (newCode, newCursor) = completionEngine.applyCompletion(code, cursorPosition, completion)

        // Then
        assertEquals("fun myFunction()", newCode)
        assertEquals("fun myFunction()".length, newCursor)
    }

    /**
     * Test 16: Full completion workflow (keywords + snippets + symbols)
     */
    @Test
    fun `getCompletions should return combined results`() = runTest {
        // Given
        val fileContent = """
            fun greet(name: String) {
                println("Hello")
            }

            fun cal
        """.trimIndent()

        val cursorPosition = fileContent.indexOf("cal") + 3
        val prefix = "cal"

        // When
        val completions = completionEngine.getCompletions(
            fileContent = fileContent,
            fileName = "test.kt",
            cursorPosition = cursorPosition,
            prefix = prefix
        )

        // Then
        assertTrue(completions.isNotEmpty())
        // Should find "greet" function symbol
        assertTrue(completions.any { it.label.startsWith(prefix, ignoreCase = true) })
    }

    /**
     * Test 17: Priority sorting (local vars > keywords > snippets)
     */
    @Test
    fun `getCompletions should sort by priority`() = runTest {
        // Given
        val fileContent = """
            fun test() {
                val result = 10
                val res
            }
        """.trimIndent()

        val cursorPosition = fileContent.indexOf("val res") + 7
        val prefix = "res"

        // When
        val completions = completionEngine.getCompletions(
            fileContent = fileContent,
            fileName = "test.kt",
            cursorPosition = cursorPosition,
            prefix = prefix
        )

        // Then
        assertTrue(completions.isNotEmpty())
        // Local variable "result" should have highest priority
        val firstCompletion = completions.first()
        assertEquals("result", firstCompletion.label)
        assertTrue(firstCompletion.priority >= 10) // Local vars have priority 10
    }

    /**
     * Test 18: Completion trigger detection
     */
    @Test
    fun `getCompletionTrigger should detect member access`() {
        // Given
        val code = "user."
        val cursorPosition = code.length

        // When
        val trigger = completionEngine.getCompletionTrigger(code, cursorPosition)

        // Then
        assertEquals(CompletionTrigger.MEMBER_ACCESS, trigger)
    }

    /**
     * Test 19: Detect annotation trigger
     */
    @Test
    fun `getCompletionTrigger should detect annotation`() {
        // Given
        val code = "@"
        val cursorPosition = code.length

        // When
        val trigger = completionEngine.getCompletionTrigger(code, cursorPosition)

        // Then
        assertEquals(CompletionTrigger.ANNOTATION, trigger)
    }

    /**
     * Test 20: Symbol cache performance
     */
    @Test
    fun `preAnalyzeFile should cache symbols for faster access`() = runTest {
        // Given
        val fileContent = """
            class MyClass {
                fun myMethod() {}
            }
        """.trimIndent()
        val fileName = "MyClass.kt"

        // When - Pre-analyze
        completionEngine.preAnalyzeFile(fileContent, fileName)

        // Then - Subsequent calls should use cache
        val startTime = System.currentTimeMillis()
        completionEngine.getCompletions(fileContent, fileName, 10, "my")
        val duration = System.currentTimeMillis() - startTime

        // Should be fast (< 100ms) due to caching
        assertTrue(duration < 100)
    }

    /**
     * Test 21: Clear cache
     */
    @Test
    fun `clearCache should remove cached symbols`() {
        // Given
        val fileName = "test.kt"
        completionEngine.clearCache(fileName)

        // When/Then - No exception should be thrown
        completionEngine.clearCache() // Clear all
    }
}
