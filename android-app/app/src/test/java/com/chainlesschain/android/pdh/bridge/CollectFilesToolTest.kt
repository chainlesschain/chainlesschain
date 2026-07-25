package com.chainlesschain.android.pdh.bridge

import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

/**
 * Headless tests for the pure (Android-free) part of the L1 collect_files tool:
 * root resolution. The actual walk+ingest (cc subprocess + storage) is validated
 * on-device with the pinned cc bundle.
 */
class CollectFilesToolTest {

    @Test
    fun empty_args_yields_default_roots() {
        val roots = CollectFilesTool.resolveRoots(JsonObject(emptyMap()))
        assertEquals(CollectFilesTool.DEFAULT_ROOTS, roots)
    }

    @Test
    fun explicit_empty_roots_array_is_rejected() {
        val args = buildJsonObject { putJsonArray("roots") {} }
        assertFailsWith<IllegalArgumentException> {
            CollectFilesTool.resolveRoots(args)
        }
    }

    @Test
    fun whitespace_only_root_is_preserved_exactly() {
        val args = buildJsonObject {
            putJsonArray("roots") { add("  ") }
        }
        assertEquals(listOf("  "), CollectFilesTool.resolveRoots(args))
    }

    @Test
    fun explicit_empty_root_is_rejected() {
        val args = buildJsonObject {
            putJsonArray("roots") { add("") }
        }
        assertFailsWith<IllegalArgumentException> {
            CollectFilesTool.resolveRoots(args)
        }
    }

    @Test
    fun non_array_or_null_roots_are_rejected() {
        assertFailsWith<IllegalArgumentException> {
            CollectFilesTool.resolveRoots(buildJsonObject { put("roots", "/sdcard/Documents") })
        }
        assertFailsWith<IllegalArgumentException> {
            CollectFilesTool.resolveRoots(buildJsonObject { put("roots", JsonNull) })
        }
    }

    @Test
    fun non_string_root_element_is_rejected() {
        val args = buildJsonObject {
            putJsonArray("roots") { add(42) }
        }
        assertFailsWith<IllegalArgumentException> {
            CollectFilesTool.resolveRoots(args)
        }
    }

    @Test
    fun caller_roots_override_default_without_rewriting_exact_paths() {
        val args = buildJsonObject {
            putJsonArray("roots") {
                add(" /sdcard/Notes ")
                add("/sdcard/Books")
                add("   ")
            }
        }
        assertEquals(
            listOf(" /sdcard/Notes ", "/sdcard/Books", "   "),
            CollectFilesTool.resolveRoots(args),
        )
    }

    @Test
    fun comma_inside_root_is_preserved_as_part_of_the_path() {
        val args = buildJsonObject {
            putJsonArray("roots") {
                add(" /sdcard/Projects/acme,inc ")
            }
        }
        assertEquals(
            listOf(" /sdcard/Projects/acme,inc "),
            CollectFilesTool.resolveRoots(args),
        )
    }

    @Test
    fun default_roots_are_documents_and_download() {
        assertEquals(
            listOf("/sdcard/Documents", "/sdcard/Download"),
            CollectFilesTool.DEFAULT_ROOTS,
        )
    }
}
