package com.chainlesschain.android.feature.project.editor

import com.chainlesschain.android.feature.project.ui.components.CodeFoldingManager
import com.chainlesschain.android.feature.project.ui.components.FoldableRegionType
import org.junit.Before
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * Unit tests for CodeFoldingManager and FoldingStateManager
 *
 * Tests:
 * 1. Detect foldable regions (functions, classes, comments)
 * 2. Control flow block detection
 * 3. Import grouping
 * 4. Toggle fold/unfold
 * 5. Fold all / unfold all
 * 6. Visible lines calculation
 * 7. Folding state persistence
 */
class CodeFoldingTest {

    private lateinit var kotlinFoldingManager: CodeFoldingManager
    private lateinit var javaFoldingManager: CodeFoldingManager
    private lateinit var pythonFoldingManager: CodeFoldingManager
    private lateinit var jsFoldingManager: CodeFoldingManager

    @Before
    fun setup() {
        kotlinFoldingManager = CodeFoldingManager("kotlin")
        javaFoldingManager = CodeFoldingManager("java")
        pythonFoldingManager = CodeFoldingManager("python")
        jsFoldingManager = CodeFoldingManager("javascript")
    }

    /**
     * Test 1: Detect Kotlin function regions
     */
    @Test
    fun `detectKotlinRegions should find functions`() {
        // Given
        val code = """
            fun greet(name: String) {
                println("Hello, ${"$"}name")
            }

            suspend fun fetchData() {
                // Implementation
            }
        """.trimIndent()

        // When
        val regions = kotlinFoldingManager.detectFoldableRegions(code)

        // Then
        val functions = regions.filter { it.type == FoldableRegionType.FUNCTION }
        assertEquals(2, functions.size)
        assertTrue(functions.any { it.preview.contains("greet") })
        assertTrue(functions.any { it.preview.contains("fetchData") })
    }

    /**
     * Test 2: Detect Kotlin class regions
     */
    @Test
    fun `detectKotlinRegions should find classes`() {
        // Given
        val code = """
            data class User(val name: String)

            class Repository {
                fun getData() {}
            }

            object Constants {
                const val MAX = 100
            }
        """.trimIndent()

        // When
        val regions = kotlinFoldingManager.detectFoldableRegions(code)

        // Then
        val classes = regions.filter { it.type == FoldableRegionType.CLASS }
        assertTrue(classes.size >= 2) // Repository and Constants (data class might be single-line)
    }

    /**
     * Test 3: Detect Kotlin control flow blocks
     */
    @Test
    fun `detectKotlinRegions should find control flow blocks`() {
        // Given
        val code = """
            fun calculate(x: Int) {
                if (x > 0) {
                    println("Positive")
                }

                when (x) {
                    0 -> println("Zero")
                    else -> println("Other")
                }

                for (i in 1..10) {
                    println(i)
                }
            }
        """.trimIndent()

        // When
        val regions = kotlinFoldingManager.detectFoldableRegions(code)

        // Then
        val controlFlow = regions.filter { it.type == FoldableRegionType.CONTROL_FLOW }
        assertTrue(controlFlow.size >= 3) // if, when, for
    }

    /**
     * Test 4: Detect import groups
     */
    @Test
    fun `detectImportGroups should group consecutive imports`() {
        // Given
        val code = """
            import android.os.Bundle
            import androidx.appcompat.app.AppCompatActivity
            import androidx.compose.runtime.*
            import kotlinx.coroutines.flow.Flow
            import kotlinx.coroutines.launch

            class MainActivity : AppCompatActivity() {}
        """.trimIndent()

        // When
        val regions = kotlinFoldingManager.detectFoldableRegions(code)

        // Then
        val imports = regions.filter { it.type == FoldableRegionType.IMPORT }
        assertEquals(1, imports.size)
        assertTrue(imports[0].preview.contains("5 lines")) // 5 import lines
    }

    /**
     * Test 5: Do not group imports if less than 3
     */
    @Test
    fun `detectImportGroups should not group less than 3 imports`() {
        // Given
        val code = """
            import android.os.Bundle
            import androidx.appcompat.app.AppCompatActivity

            class MainActivity : AppCompatActivity() {}
        """.trimIndent()

        // When
        val regions = kotlinFoldingManager.detectFoldableRegions(code)

        // Then
        val imports = regions.filter { it.type == FoldableRegionType.IMPORT }
        assertEquals(0, imports.size) // Should not create region for < 3 imports
    }

    /**
     * Test 6: Detect Java method regions
     */
    @Test
    fun `detectJavaRegions should find methods`() {
        // Given
        val code = """
            public class MyClass {
                public void greet(String name) {
                    System.out.println("Hello, " + name);
                }

                private int calculate(int x, int y) {
                    return x + y;
                }
            }
        """.trimIndent()

        // When
        val regions = javaFoldingManager.detectFoldableRegions(code)

        // Then
        val functions = regions.filter { it.type == FoldableRegionType.FUNCTION }
        assertTrue(functions.size >= 2)
    }

    /**
     * Test 7: Detect Java control flow blocks
     */
    @Test
    fun `detectJavaRegions should find control flow blocks`() {
        // Given
        val code = """
            public void process(int x) {
                if (x > 0) {
                    System.out.println("Positive");
                }

                try {
                    doSomething();
                } catch (Exception e) {
                    handleError();
                } finally {
                    cleanup();
                }
            }
        """.trimIndent()

        // When
        val regions = javaFoldingManager.detectFoldableRegions(code)

        // Then
        val controlFlow = regions.filter { it.type == FoldableRegionType.CONTROL_FLOW }
        assertTrue(controlFlow.size >= 3) // if, try, catch, finally
    }

    /**
     * Test 8: Detect Python function regions
     */
    @Test
    fun `detectPythonRegions should find functions`() {
        // Given
        val code = """
            def greet(name):
                print(f"Hello, {name}")

            async def fetch_data():
                await api.get_data()
        """.trimIndent()

        // When
        val regions = pythonFoldingManager.detectFoldableRegions(code)

        // Then
        val functions = regions.filter { it.type == FoldableRegionType.FUNCTION }
        assertTrue(functions.size >= 2)
    }

    /**
     * Test 9: Detect JavaScript/TypeScript functions
     */
    @Test
    fun `detectJavaScriptRegions should find functions`() {
        // Given
        val code = """
            function greet(name) {
                console.log("Hello, " + name);
            }

            const calculate = (x, y) => {
                return x + y;
            }
        """.trimIndent()

        // When
        val regions = jsFoldingManager.detectFoldableRegions(code)

        // Then
        val functions = regions.filter { it.type == FoldableRegionType.FUNCTION }
        assertTrue(functions.size >= 2)
    }

    /**
     * Test 10: Toggle fold/unfold region
     */
    @Test
    fun `toggleFold should add and remove region from folded set`() {
        // Given
        val code = """
            fun test() {
                println("Hello")
            }
        """.trimIndent()

        val regions = kotlinFoldingManager.detectFoldableRegions(code)
        val region = regions.first()

        // When - Fold
        kotlinFoldingManager.toggleFold(region)

        // Then
        assertTrue(kotlinFoldingManager.isRegionFolded(region))

        // When - Unfold
        kotlinFoldingManager.toggleFold(region)

        // Then
        assertFalse(kotlinFoldingManager.isRegionFolded(region))
    }

    /**
     * Test 11: Check if line is folded
     */
    @Test
    fun `isLineFolded should return true for lines in folded region`() {
        // Given
        val code = """
            fun test() {
                println("Line 1")
                println("Line 2")
                println("Line 3")
            }
        """.trimIndent()

        val regions = kotlinFoldingManager.detectFoldableRegions(code)
        val region = regions.first()

        kotlinFoldingManager.toggleFold(region)

        // When/Then
        assertFalse(kotlinFoldingManager.isLineFolded(0)) // First line (function declaration) visible
        assertTrue(kotlinFoldingManager.isLineFolded(1)) // Body lines hidden
        assertTrue(kotlinFoldingManager.isLineFolded(2))
    }

    /**
     * Test 12: Get visible lines
     */
    @Test
    fun `getVisibleLines should exclude folded region content`() {
        // Given
        val code = """
            fun test() {
                println("Line 1")
                println("Line 2")
            }
        """.trimIndent()

        val totalLines = code.lines().size
        val regions = kotlinFoldingManager.detectFoldableRegions(code)
        val region = regions.first()

        kotlinFoldingManager.toggleFold(region)

        // When
        val visibleLines = kotlinFoldingManager.getVisibleLines(totalLines)

        // Then
        assertTrue(visibleLines.contains(0)) // First line visible (shows "...")
        assertFalse(visibleLines.contains(1)) // Body hidden
        assertFalse(visibleLines.contains(2)) // Body hidden
        assertTrue(visibleLines.size < totalLines)
    }

    /**
     * Test 13: Fold all regions
     */
    @Test
    fun `foldAll should fold all detected regions`() {
        // Given
        val code = """
            fun test1() {
                println("A")
            }

            fun test2() {
                println("B")
            }
        """.trimIndent()

        val regions = kotlinFoldingManager.detectFoldableRegions(code)

        // When
        kotlinFoldingManager.foldAll(regions)

        // Then
        regions.forEach { region ->
            assertTrue(kotlinFoldingManager.isRegionFolded(region))
        }
    }

    /**
     * Test 14: Unfold all regions
     */
    @Test
    fun `unfoldAll should unfold all regions`() {
        // Given
        val code = """
            fun test1() {
                println("A")
            }

            fun test2() {
                println("B")
            }
        """.trimIndent()

        val regions = kotlinFoldingManager.detectFoldableRegions(code)
        kotlinFoldingManager.foldAll(regions)

        // When
        kotlinFoldingManager.unfoldAll()

        // Then
        regions.forEach { region ->
            assertFalse(kotlinFoldingManager.isRegionFolded(region))
        }
    }

    /**
     * Test 15: Detect nested regions
     */
    @Test
    fun `detectRegions should handle nested structures`() {
        // Given
        val code = """
            class MyClass {
                fun outerFunction() {
                    if (true) {
                        println("Nested")
                    }
                }
            }
        """.trimIndent()

        // When
        val regions = kotlinFoldingManager.detectFoldableRegions(code)

        // Then
        val classRegions = regions.filter { it.type == FoldableRegionType.CLASS }
        val functionRegions = regions.filter { it.type == FoldableRegionType.FUNCTION }
        val controlFlowRegions = regions.filter { it.type == FoldableRegionType.CONTROL_FLOW }

        assertTrue(classRegions.isNotEmpty())
        assertTrue(functionRegions.isNotEmpty())
        assertTrue(controlFlowRegions.isNotEmpty())
    }

    /**
     * Test 16: Detect block comments
     */
    @Test
    fun `detectRegions should find block comments`() {
        // Given
        val code = """
            /*
             * Multi-line comment
             * with multiple lines
             */
            fun test() {}
        """.trimIndent()

        // When
        val regions = kotlinFoldingManager.detectFoldableRegions(code)

        // Then
        val comments = regions.filter { it.type == FoldableRegionType.COMMENT }
        assertEquals(1, comments.size)
    }

    /**
     * Test 17: Ignore single-line blocks
     */
    @Test
    fun `detectRegions should ignore single-line blocks`() {
        // Given
        val code = """
            fun test() { println("Single line") }
        """.trimIndent()

        // When
        val regions = kotlinFoldingManager.detectFoldableRegions(code)

        // Then
        // Should not create region for single-line function
        assertEquals(0, regions.size)
    }
}
