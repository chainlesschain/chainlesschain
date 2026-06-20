package com.chainlesschain.android.pdh.bridge

/**
 * Production PDH bridge tool set (Phase 1+) — replaces the Phase 0
 * [StubPdhToolHost]. Assembles the agent-callable tool list from the collect
 * tools the [PdhBridgeModule] constructs (it owns the Hilt-injected collectors):
 *   - pdh_ping            liveness
 *   - <collect tools>     L2 system / L3 app-login / L4 root-salvage
 *   - list_collectors     reflects each collector's layer + root requirement
 *
 * The module passes pre-built [Collector] entries (tool + metadata) so this
 * stays a thin assembler — new collectors register by adding one entry there.
 */
object PdhToolHost {

    /** A wired collect tool + its metadata for list_collectors. */
    data class Collector(
        val tool: PdhTool,
        val layer: String,
        val requiresRoot: Boolean,
    )

    fun tools(collectors: List<Collector>): List<PdhTool> = buildList {
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
