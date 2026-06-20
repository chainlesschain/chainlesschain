package com.chainlesschain.android.pdh.bridge

import com.chainlesschain.android.pdh.LocalCcRunner
import com.chainlesschain.android.pdh.LocalSystemDataSnapshotter

/**
 * Production PDH bridge tool set (Phase 1+) — replaces the Phase 0
 * [StubPdhToolHost]. Assembles the live tools the agent can call:
 *   - pdh_ping            liveness
 *   - collect_system_data L2 real collector (contacts + apps → vault)
 *   - list_collectors     reflects the actual wired collectors
 *
 * Phase 1 adds L2 (system data). Subsequent collectors (L3 app-api via
 * WebSignBridge, L4 db direct-read via frida/salvage, L1 files) register here
 * the same way — one [Collector] entry each, surfaced by list_collectors.
 */
object PdhToolHost {

    /** A wired collect tool + its metadata for list_collectors. */
    private data class Collector(
        val tool: PdhTool,
        val layer: String,
        val requiresRoot: Boolean,
    )

    fun tools(
        snapshotter: LocalSystemDataSnapshotter,
        ccRunner: LocalCcRunner,
    ): List<PdhTool> {
        val collectors = listOf(
            Collector(
                tool = CollectSystemDataTool(snapshotter, ccRunner),
                layer = "L2",
                requiresRoot = false,
            ),
            // Phase 1+ : add L3 (app-api) / L4 (db direct-read) / L1 (files) here.
        )
        return buildList {
            add(PdhPingTool)
            collectors.forEach { add(it.tool) }
            add(
                ListCollectorsTool(
                    collectors.map {
                        CollectorInfo(
                            name = it.tool.name,
                            description = it.tool.description,
                            layer = it.layer,
                            requiresRoot = it.requiresRoot,
                        )
                    },
                ),
            )
        }
    }
}
