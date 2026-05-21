package com.chainlesschain.android.remote.ui.personalDataHub

import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Pure data-class schema tests for SystemDataLocalCollector output.
 *
 * The full ContentResolver / PackageManager integration is verified on real
 * devices (Path C smoke run on Xiaomi 24115RA8EC). What we **must** lock down
 * in unit tests is the JSON shape: it has to round-trip through WS → desktop
 * adapter `_syncViaSnapshot()` (in packages/personal-data-hub/lib/adapters/
 * system-data-android/adapter.js) without field renames or type drift.
 *
 * If desktop adapter starts reading `displayName` and our toMap emits
 * `display_name`, the schema mismatch is silent (empty contact list, no error)
 * — so these field-name asserts are load-bearing.
 */
class SystemDataLocalCollectorTest {

    @Test
    fun `Snapshot toMap emits exact schemaVersion + snapshottedAt + contacts + apps keys`() {
        val s = Snapshot(
            schemaVersion = SystemDataLocalCollector.SCHEMA_VERSION,
            snapshottedAt = 1_700_000_000_000L,
            contacts = emptyList(),
            apps = emptyList(),
        )
        val map = s.toMap()
        assertEquals(1, map["schemaVersion"])
        assertEquals(1_700_000_000_000L, map["snapshottedAt"])
        assertTrue((map["contacts"] as List<*>).isEmpty())
        assertTrue((map["apps"] as List<*>).isEmpty())
        assertEquals(setOf("schemaVersion", "snapshottedAt", "contacts", "apps"), map.keys)
    }

    @Test
    fun `Contact toMap field names match desktop adapter expectations`() {
        val c = Contact(
            lookupKey = "ck-1",
            displayName = "妈妈",
            phones = listOf("13800000001", "13900000001"),
            emails = listOf("mom@example.com"),
            starred = true,
            organization = "某公司",
            photoUri = "content://com.android.contacts/contacts/1/photo",
        )
        val map = c.toMap()
        // These names appear verbatim in
        // packages/personal-data-hub/lib/adapters/system-data-android/adapter.js
        // normalize() — drift breaks ingest.
        assertEquals("ck-1", map["lookupKey"])
        assertEquals("妈妈", map["displayName"])
        assertEquals(listOf("13800000001", "13900000001"), map["phones"])
        assertEquals(listOf("mom@example.com"), map["emails"])
        assertEquals(true, map["starred"])
        assertEquals("某公司", map["organization"])
        assertEquals("content://com.android.contacts/contacts/1/photo", map["photoUri"])
    }

    @Test
    fun `Contact toMap allows null organization + photoUri`() {
        val c = Contact(
            lookupKey = "ck-2",
            displayName = "同事",
            phones = emptyList(),
            emails = emptyList(),
            starred = false,
            organization = null,
            photoUri = null,
        )
        val map = c.toMap()
        assertNull(map["organization"])
        assertNull(map["photoUri"])
    }

    @Test
    fun `AppInfo toMap field names match desktop adapter expectations`() {
        val a = AppInfo(
            packageName = "com.tencent.mm",
            label = "微信",
            versionName = "8.0.42",
            versionCode = 2960,
            firstInstallTime = 1_690_000_000_000L,
            lastUpdateTime = 1_700_000_000_000L,
            isSystem = false,
        )
        val map = a.toMap()
        // Names cross-checked against adapter.js `raw.kind === "app"` branch.
        assertEquals("com.tencent.mm", map["packageName"])
        assertEquals("微信", map["label"])
        assertEquals("8.0.42", map["versionName"])
        assertEquals(2960, map["versionCode"])
        assertEquals(1_690_000_000_000L, map["firstInstallTime"])
        assertEquals(1_700_000_000_000L, map["lastUpdateTime"])
        assertEquals(false, map["isSystem"])
    }

    @Test
    fun `Snapshot includes contacts + apps with proper nesting`() {
        val s = Snapshot(
            schemaVersion = 1,
            snapshottedAt = 1L,
            contacts = listOf(
                Contact(
                    lookupKey = "ck-1",
                    displayName = "A",
                    phones = emptyList(),
                    emails = emptyList(),
                    starred = false,
                    organization = null,
                    photoUri = null,
                ),
            ),
            apps = listOf(
                AppInfo(
                    packageName = "com.foo",
                    label = "Foo",
                    versionName = "1.0",
                    versionCode = 1,
                    firstInstallTime = 1L,
                    lastUpdateTime = 2L,
                    isSystem = false,
                ),
            ),
        )
        val map = s.toMap()
        val contacts = map["contacts"] as List<*>
        val apps = map["apps"] as List<*>
        assertEquals(1, contacts.size)
        assertEquals(1, apps.size)
        @Suppress("UNCHECKED_CAST")
        assertEquals("ck-1", (contacts[0] as Map<String, *>)["lookupKey"])
        @Suppress("UNCHECKED_CAST")
        assertEquals("com.foo", (apps[0] as Map<String, *>)["packageName"])
    }

    @Test
    fun `SCHEMA_VERSION is 1 matching desktop adapter`() {
        // packages/personal-data-hub/lib/adapters/system-data-android/adapter.js
        // declares SNAPSHOT_SCHEMA_VERSION = 1. Bumping either side requires
        // bumping both — surface as a single explicit assertion to catch drift.
        assertEquals(1, SystemDataLocalCollector.SCHEMA_VERSION)
    }
}
