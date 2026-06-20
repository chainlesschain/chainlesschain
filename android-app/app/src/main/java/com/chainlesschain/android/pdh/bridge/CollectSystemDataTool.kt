package com.chainlesschain.android.pdh.bridge

import com.chainlesschain.android.pdh.LocalCcRunner
import com.chainlesschain.android.pdh.LocalSystemDataSnapshotter
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject

/**
 * Phase 1, L2 (system data) — the first REAL PDH bridge collect tool. The agent
 * calls `mcp__pdh__collect_system_data`; this runs the on-device
 * [LocalSystemDataSnapshotter] (contacts + installed apps via ContentResolver /
 * PackageManager — no root, no signing) and ingests the snapshot into the local
 * vault via `cc hub sync-adapter system-data-android` (decision #15, "方案 i":
 * Kotlin collects → server spawns the existing cc ingest path → returns the
 * SyncReport). Mirrors the existing one-tap flow in HubLocalViewModel.
 *
 * Android-bound (ContentResolver + cc subprocess) → validated on-device, not in
 * the headless protocol tests. `call` blocks (runBlocking) for the collect +
 * ingest duration — the bridge marks PDH tools `longRunning`, so the agent loop
 * exempts them from the per-call timeout.
 */
class CollectSystemDataTool(
    private val snapshotter: LocalSystemDataSnapshotter,
    private val ccRunner: LocalCcRunner,
) : PdhTool {

    override val name = "collect_system_data"
    override val description =
        "Collect this device's system data (contacts + installed apps) into the " +
            "personal vault. No root or login required."
    override val inputSchema = buildJsonObject {
        put("type", "object")
        putJsonObject("properties") {}
    }

    override fun call(args: JsonObject): JsonElement = runBlocking {
        val snap = snapshotter.snapshotAll()
        when (val r = ccRunner.syncAdapter(ADAPTER, snap.snapshotPath)) {
            is LocalCcRunner.CcResult.Ok -> buildJsonObject {
                put("status", "ok")
                put("adapter", ADAPTER)
                put("contacts", snap.contactsCount)
                put("apps", snap.appsCount)
                put("contactsPermissionGranted", snap.contactsPermissionGranted)
                put("ingested", r.report.ingested)
                put("invalidCount", r.report.invalidCount)
                put("kgTriples", r.report.kgTriples)
                put("ragDocs", r.report.ragDocs)
                put("durationMs", r.report.durationMs)
            }
            is LocalCcRunner.CcResult.Failed -> throw RuntimeException(
                "system-data sync failed: ${r.reason}" +
                    (r.exitCode?.let { " (exit $it)" } ?: ""),
            )
        }
    }

    companion object {
        private const val ADAPTER = "system-data-android"
    }
}
