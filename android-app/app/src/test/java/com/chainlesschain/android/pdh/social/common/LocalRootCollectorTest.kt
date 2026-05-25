package com.chainlesschain.android.pdh.social.common

import kotlinx.coroutines.test.runTest
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/**
 * Phase B0 — contract test for the shared [LocalRootCollector] interface
 * + [LocalSnapshotResult] sealed hierarchy.
 *
 * Verifies:
 *  - Sealed class exhaustiveness — a `when` over the result type compiles
 *    with the documented 5 cases (Ok / NoCredentials / NoRoot / NoDbKey /
 *    ExtractFailed; Failed is also a case)
 *  - Ok's `perCategoryCounts.values.sum()` equals `totalEvents` (callers
 *    rely on this invariant for the UI summary)
 *  - Default `diagnosticFields = emptyMap()` so platforms can omit
 *
 * These tests are deliberately data-class-shape only — no Android SDK
 * dependency, no mockk needed, pure JVM.
 */
class LocalRootCollectorTest {

    @Test
    fun `Ok totalEvents matches perCategoryCounts sum (caller invariant)`() {
        val ok = LocalSnapshotResult.Ok(
            snapshotPath = "/tmp/snap.json",
            totalEvents = 100,
            perCategoryCounts = mapOf("msg" to 60, "follow" to 30, "favorite" to 10),
            snapshottedAt = 1716383021000L,
        )
        assertEquals(ok.totalEvents, ok.perCategoryCounts.values.sum())
    }

    @Test
    fun `Ok diagnosticFields defaults to empty`() {
        val ok = LocalSnapshotResult.Ok(
            snapshotPath = "/tmp/snap.json",
            totalEvents = 0,
            perCategoryCounts = emptyMap(),
            snapshottedAt = 1L,
        )
        assertTrue(ok.diagnosticFields.isEmpty())
    }

    @Test
    fun `NoDbKey carries provider string for UI discrimination`() {
        val err = LocalSnapshotResult.NoDbKey("frida")
        assertEquals("frida", err.provider)

        val err2 = LocalSnapshotResult.NoDbKey("md5")
        assertEquals("md5", err2.provider)
    }

    @Test
    fun `ExtractFailed carries reason + optional message`() {
        val a = LocalSnapshotResult.ExtractFailed("source-db-missing")
        assertEquals("source-db-missing", a.reason)
        assertEquals(null, a.message)

        val b = LocalSnapshotResult.ExtractFailed("decrypt-failed", "wrong PRAGMA profile")
        assertEquals("decrypt-failed", b.reason)
        assertEquals("wrong PRAGMA profile", b.message)
    }

    @Test
    fun `sealed when is exhaustive over documented 6 cases`() {
        // Compile-time check via exhaustive when expression — if a new
        // case is added without updating this test, the compiler will
        // error here, forcing the maintainer to deal with it.
        val results = listOf<LocalSnapshotResult>(
            LocalSnapshotResult.Ok(
                snapshotPath = "/x",
                totalEvents = 0,
                perCategoryCounts = emptyMap(),
                snapshottedAt = 0L,
            ),
            LocalSnapshotResult.NoCredentials,
            LocalSnapshotResult.NoRoot,
            LocalSnapshotResult.NoDbKey("test"),
            LocalSnapshotResult.ExtractFailed("test"),
            LocalSnapshotResult.Failed("test"),
        )
        val descriptions = results.map { r ->
            when (r) {
                is LocalSnapshotResult.Ok -> "ok"
                LocalSnapshotResult.NoCredentials -> "no-creds"
                LocalSnapshotResult.NoRoot -> "no-root"
                is LocalSnapshotResult.NoDbKey -> "no-key"
                is LocalSnapshotResult.ExtractFailed -> "extract"
                is LocalSnapshotResult.Failed -> "failed"
            }
        }
        assertEquals(6, descriptions.size)
        assertEquals(setOf("ok", "no-creds", "no-root", "no-key", "extract", "failed"), descriptions.toSet())
    }

    @Test
    fun `collector contract — fake implementation can return any result`() = runTest {
        // Smoke test: a fake collector returning NoRoot satisfies the interface.
        val fake = object : LocalRootCollector {
            override suspend fun snapshot() = LocalSnapshotResult.NoRoot
        }
        val r = fake.snapshot()
        assertNotNull(r)
        assertTrue(r is LocalSnapshotResult.NoRoot)
    }
}
