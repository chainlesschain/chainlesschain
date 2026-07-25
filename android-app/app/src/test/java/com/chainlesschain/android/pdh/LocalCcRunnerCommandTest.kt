package com.chainlesschain.android.pdh

import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class LocalCcRunnerCommandTest {

    @Test
    fun multiple_roots_are_encoded_as_repeated_root_pairs() {
        assertEquals(
            listOf(
                "--root",
                "/sdcard/Documents",
                "--root",
                "/sdcard/Download",
            ),
            buildSyncAdapterSourceArgs(
                inputPath = "",
                roots = listOf("/sdcard/Documents", "/sdcard/Download"),
            ),
        )
    }

    @Test
    fun comma_inside_root_remains_one_argv_value() {
        val root = "/sdcard/Projects/acme,inc"

        assertEquals(
            listOf("--root", root),
            buildSyncAdapterSourceArgs(inputPath = "", roots = listOf(root)),
        )
    }

    @Test
    fun legacy_cli_joins_unambiguous_roots() {
        assertEquals(
            listOf(
                "--roots",
                "/sdcard/Documents,/sdcard/Download",
            ),
            buildSyncAdapterSourceArgs(
                inputPath = "",
                roots = listOf("/sdcard/Documents", "/sdcard/Download"),
                repeatableRootSupported = false,
            ),
        )
    }

    @Test
    fun legacy_cli_rejects_ambiguous_root_characters() {
        assertFailsWith<IllegalArgumentException> {
            buildSyncAdapterSourceArgs(
                inputPath = "",
                roots = listOf("/sdcard/Projects/acme,inc"),
                repeatableRootSupported = false,
            )
        }
        assertFailsWith<IllegalArgumentException> {
            buildSyncAdapterSourceArgs(
                inputPath = "",
                roots = listOf(" /sdcard/Projects "),
                repeatableRootSupported = false,
            )
        }
        assertFailsWith<IllegalArgumentException> {
            buildSyncAdapterSourceArgs(
                inputPath = "",
                roots = listOf("\uFEFF/sdcard/Projects"),
                repeatableRootSupported = false,
            )
        }
        assertFailsWith<IllegalArgumentException> {
            buildSyncAdapterSourceArgs(
                inputPath = "",
                roots = listOf("/sdcard/Projects\u00A0"),
                repeatableRootSupported = false,
            )
        }
        assertFailsWith<IllegalArgumentException> {
            buildSyncAdapterSourceArgs(
                inputPath = "",
                roots = listOf("   "),
                repeatableRootSupported = false,
            )
        }
    }

    @Test
    fun repeatable_root_support_is_version_gated() {
        assertFalse(supportsRepeatableSyncRoot(null))
        assertFalse(supportsRepeatableSyncRoot("not-semver"))
        assertFalse(supportsRepeatableSyncRoot("0.162.176"))
        assertFalse(supportsRepeatableSyncRoot("0.162.177"))
        assertFalse(supportsRepeatableSyncRoot("0.162.178"))
        assertFalse(supportsRepeatableSyncRoot("0.162.179-beta.1"))
        assertFalse(supportsRepeatableSyncRoot("0.162.179-"))
        assertFalse(supportsRepeatableSyncRoot("0.162.179+"))
        assertFalse(supportsRepeatableSyncRoot("00.162.179"))
        assertFalse(supportsRepeatableSyncRoot(" 0.162.179"))
        assertFalse(supportsRepeatableSyncRoot("0.162.179 "))
        assertTrue(supportsRepeatableSyncRoot("0.162.179"))
        assertTrue(supportsRepeatableSyncRoot("0.162.179+build.42"))
        assertTrue(supportsRepeatableSyncRoot("0.163.0-beta.1"))
        assertTrue(supportsRepeatableSyncRoot("1.0.0"))
    }

    @Test
    fun empty_roots_keep_input_mode() {
        assertEquals(
            listOf("--input", "/data/local/tmp/snapshot.json"),
            buildSyncAdapterSourceArgs(
                inputPath = "/data/local/tmp/snapshot.json",
                roots = emptyList(),
            ),
        )
    }

    @Test
    fun null_roots_keep_input_mode() {
        assertEquals(
            listOf("--input", "/data/local/tmp/snapshot.json"),
            buildSyncAdapterSourceArgs(
                inputPath = "/data/local/tmp/snapshot.json",
                roots = null,
            ),
        )
    }

    @Test
    fun one_root_emits_one_root_pair() {
        assertEquals(
            listOf("--root", "/sdcard/Documents"),
            buildSyncAdapterSourceArgs(
                inputPath = "",
                roots = listOf("/sdcard/Documents"),
            ),
        )
    }
}
