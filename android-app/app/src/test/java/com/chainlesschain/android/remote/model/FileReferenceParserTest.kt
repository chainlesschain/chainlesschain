package com.chainlesschain.android.remote.model

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Unit tests for FileReferenceParser
 */
class FileReferenceParserTest {

    @Test
    fun `parse extracts simple file references`() {
        val input = "Check @src/main.kt and @README.md"
        val refs = FileReferenceParser.parse(input)

        assertEquals(2, refs.size)
        assertEquals("src/main.kt", refs[0].path)
        assertEquals("README.md", refs[1].path)
    }

    @Test
    fun `parse extracts quoted file references with spaces`() {
        val input = """Check @"path with spaces/file.txt" please"""
        val refs = FileReferenceParser.parse(input)

        assertEquals(1, refs.size)
        assertEquals("path with spaces/file.txt", refs[0].path)
    }

    @Test
    fun `parse handles mixed references`() {
        val input = """Look at @simple.kt and @"complex path/file.js" together"""
        val refs = FileReferenceParser.parse(input)

        assertEquals(2, refs.size)
        assertEquals("complex path/file.js", refs[0].path) // Quoted found first
        assertEquals("simple.kt", refs[1].path)
    }

    @Test
    fun `parse returns empty list when no references`() {
        val input = "No file references here"
        val refs = FileReferenceParser.parse(input)

        assertTrue(refs.isEmpty())
    }

    @Test
    fun `parse ignores email addresses`() {
        val input = "Contact user@example.com for help"
        val refs = FileReferenceParser.parse(input)

        // Should not match email (no file extension pattern)
        assertTrue(refs.isEmpty())
    }

    @Test
    fun `getPartialReference returns partial when typing reference`() {
        val input = "Check @src/ma"
        val partial = FileReferenceParser.getPartialReference(input, input.length)

        assertEquals("src/ma", partial)
    }

    @Test
    fun `getPartialReference returns null when not typing reference`() {
        val input = "Just normal text"
        val partial = FileReferenceParser.getPartialReference(input, input.length)

        assertNull(partial)
    }

    @Test
    fun `getPartialReference returns empty string right after @`() {
        val input = "Check @"
        val partial = FileReferenceParser.getPartialReference(input, input.length)

        assertEquals("", partial)
    }

    @Test
    fun `shouldShowFilePicker returns true when @ is typed at start`() {
        val input = "@"
        val result = FileReferenceParser.shouldShowFilePicker(input, 1)

        assertTrue(result)
    }

    @Test
    fun `shouldShowFilePicker returns true when @ is typed after space`() {
        val input = "Check @"
        val result = FileReferenceParser.shouldShowFilePicker(input, input.length)

        assertTrue(result)
    }

    @Test
    fun `shouldShowFilePicker returns false for email patterns`() {
        val input = "user@"
        val result = FileReferenceParser.shouldShowFilePicker(input, input.length)

        assertFalse(result)
    }

    @Test
    fun `insertReference inserts at cursor with partial replacement`() {
        val input = "Check @ma"
        val cursorPos = input.length
        val file = FileReference.fromPath("main.kt")

        val (newText, newPos) = FileReferenceParser.insertReference(input, cursorPos, file)

        assertEquals("Check @main.kt ", newText)
        assertEquals(17, newPos) // After "main.kt "
    }

    @Test
    fun `insertReference handles files with spaces using quotes`() {
        val input = "Check "
        val cursorPos = input.length
        val file = FileReference.fromPath("my file.kt")

        val (newText, newPos) = FileReferenceParser.insertReference(input, cursorPos, file)

        assertEquals("Check @\"my file.kt\" ", newText)
    }

    @Test
    fun `stripReferences removes all file references`() {
        val input = "Check @file.kt and @\"other.js\" for issues"
        val result = FileReferenceParser.stripReferences(input)

        assertEquals("Check and for issues", result)
    }

    @Test
    fun `segmentText correctly identifies reference segments`() {
        val input = "Look at @file.kt here"
        val segments = FileReferenceParser.segmentText(input)

        assertEquals(3, segments.size)
        assertEquals("Look at ", segments[0].text)
        assertFalse(segments[0].isReference)
        assertEquals("@file.kt", segments[1].text)
        assertTrue(segments[1].isReference)
        assertEquals(" here", segments[2].text)
        assertFalse(segments[2].isReference)
    }

    @Test
    fun `filterFiles filters by query`() {
        val files = listOf(
            FileReference.fromPath("src/main.kt"),
            FileReference.fromPath("src/test.kt"),
            FileReference.fromPath("README.md")
        )

        val result = FileReferenceParser.filterFiles(files, "main")

        assertEquals(1, result.size)
        assertEquals("main.kt", result[0].name)
    }

    @Test
    fun `filterFiles returns first 10 when query is empty`() {
        val files = (1..20).map { FileReference.fromPath("file$it.kt") }

        val result = FileReferenceParser.filterFiles(files, "")

        assertEquals(10, result.size)
    }

    @Test
    fun `filterFiles prioritizes name starts with query`() {
        val files = listOf(
            FileReference.fromPath("subMain.kt"),
            FileReference.fromPath("main.kt"),
            FileReference.fromPath("mainTest.kt")
        )

        val result = FileReferenceParser.filterFiles(files, "main")

        // main.kt and mainTest.kt should come before subMain.kt
        assertTrue(result[0].name.startsWith("main", ignoreCase = true))
    }

    @Test
    fun `FileReference fromPath correctly parses path components`() {
        val ref = FileReference.fromPath("src/main/kotlin/App.kt")

        assertEquals("src/main/kotlin/App.kt", ref.path)
        assertEquals("App.kt", ref.name)
        assertEquals("kt", ref.extension)
        assertFalse(ref.isDirectory)
    }

    @Test
    fun `FileReference fromPath handles files without extension`() {
        val ref = FileReference.fromPath("Makefile")

        assertEquals("Makefile", ref.name)
        assertNull(ref.extension)
    }
}
