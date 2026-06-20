package com.chainlesschain.android.pdh.bridge

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import org.junit.Test
import kotlin.test.assertEquals

/**
 * Headless tests for the pure (Android-free) part of the L1 collect_files tool:
 * root resolution. The actual walk+ingest (cc subprocess + storage) is validated
 * on-device after a cc-bundle refresh that carries the `--roots` flag.
 */
class CollectFilesToolTest {

    @Test
    fun empty_args_yields_default_roots() {
        val roots = CollectFilesTool.resolveRoots(JsonObject(emptyMap()))
        assertEquals(CollectFilesTool.DEFAULT_ROOTS, roots)
    }

    @Test
    fun empty_roots_array_falls_back_to_default() {
        val args = buildJsonObject { putJsonArray("roots") {} }
        assertEquals(CollectFilesTool.DEFAULT_ROOTS, CollectFilesTool.resolveRoots(args))
    }

    @Test
    fun blank_only_roots_fall_back_to_default() {
        val args = buildJsonObject {
            putJsonArray("roots") { add("  "); add("") }
        }
        assertEquals(CollectFilesTool.DEFAULT_ROOTS, CollectFilesTool.resolveRoots(args))
    }

    @Test
    fun caller_roots_override_default_and_are_trimmed() {
        val args = buildJsonObject {
            putJsonArray("roots") {
                add(" /sdcard/Notes ")
                add("/sdcard/Books")
                add("   ")
            }
        }
        assertEquals(
            listOf("/sdcard/Notes", "/sdcard/Books"),
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
